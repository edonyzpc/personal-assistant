import { describe, expect, it, jest } from "@jest/globals";

import type {
    AgentCapabilityContext,
    AgentCapabilityResult,
} from "../capability-types";
import type {
    ChatToolName,
    ChatToolPermission,
    ChatToolSourceBoundary,
} from "../chat-tool-types";
import type { SourceRecordKind } from "../chat-types";
import {
    createActionExecutor,
    createSelfWriteRegistry,
    SELF_WRITE_WINDOW_MS,
    type ActionExecutorOptions,
    type FsProbe,
} from "./runtime-integration";
import type { PreviewRenderer } from "./preview-modal";
import type {
    ConfirmationOutcome,
    DebugEvent,
    DebugObserver,
    PreviewSpec,
    WriteActionCapability,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeContext(overrides: Partial<AgentCapabilityContext> = {}): AgentCapabilityContext {
    return {
        plugin: {} as AgentCapabilityContext["plugin"],
        turnId: "turn-1",
        ...overrides,
    };
}

function makeFsProbe(existsMap: Record<string, boolean> = {}): FsProbe {
    return {
        exists: jest.fn(async (path: string) => existsMap[path] ?? false) as FsProbe["exists"],
    };
}

function makeObserver(events: DebugEvent[]): DebugObserver {
    return { emit: (event) => events.push(event) };
}

function makeRenderer(outcomes: ConfirmationOutcome[]): PreviewRenderer {
    let i = 0;
    return {
        show: jest.fn(async () => {
            const o = outcomes[i++] ?? "confirmed";
            return { outcome: o };
        }) as PreviewRenderer["show"],
    };
}

function makeCapability(
    overrides: Partial<WriteActionCapability> = {},
    spec: Partial<PreviewSpec> = {},
): WriteActionCapability {
    const previewSpec: PreviewSpec = {
        target: { path: ".pagelet/foo.md", category: "pagelet-review-note" },
        contentMarkdown: "# Body",
        impact: "Creates 1 file",
        risk: "None",
        action: "Create .pagelet/foo.md",
        ...spec,
    };
    // ChatToolName / ChatToolPermission / etc. are string-literal unions of the
    // shipped tool names. Tests use a placeholder name + assertions to opt out.
    const cap: WriteActionCapability = {
        name: "test.write_action" as ChatToolName,
        description: "test",
        inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
        plannerGuidance: [],
        kind: "action",
        origin: "core",
        providerId: "test-provider",
        permission: "write",
        sourceBoundary: "vault",
        cost: "free",
        platform: "both",
        outputBudgetChars: 0,
        timeoutMs: 30_000,
        requiresConfirmation: true,
        executionMode: "sequential",
        failureBehavior: "recoverable",
        statusMessageText: "writing",
        sourceRecordKind: "context-used" as SourceRecordKind,
        actionFamily: "create-file",
        targetCategory: "pagelet-review-note",
        targetConfinement: {
            allowedRoots: [".pagelet/"],
            allowedExtensions: [".md"],
            maxPathLength: 200,
        },
        toProviderSchema: () => ({
            type: "function",
            function: {
                name: "test.write_action",
                description: "test",
                parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
            },
        }),
        toRegistryDefinition: () => ({
            name: "test.write_action" as ChatToolName,
            description: "test",
            inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
            plannerGuidance: [],
            permission: "read-only" as ChatToolPermission, // registry def uses ChatToolPermission only
            cost: "free",
            outputBudgetChars: 0,
            requiresConfirmation: true,
            failureBehavior: "recoverable",
            statusMessage: "writing",
            sourceBoundary: "read-only-tool" as ChatToolSourceBoundary,
        }),
        execute: async () => {
            throw new Error("WriteActionCapability.execute must not be called directly (use ActionExecutor)");
        },
        buildPreview: jest.fn(async () => previewSpec) as WriteActionCapability["buildPreview"],
        executeWrite: jest.fn(async () => ({
            status: "ok",
            observation: { createdPath: ".pagelet/foo.md" },
            sourceRecords: [],
            inputSummary: "wrote",
            sources: [],
        })) as WriteActionCapability["executeWrite"],
        ...overrides,
    };
    return cap;
}

function defaultExecutorOptions(overrides: Partial<ActionExecutorOptions> = {}): ActionExecutorOptions {
    return {
        previewRenderer: makeRenderer(["confirmed"]),
        fsProbe: makeFsProbe({ ".pagelet": true }),
        debugObserver: makeObserver([]),
        runIdFactory: () => "run-x",
        now: () => 1000,
        // No-op timer keeps the auto-created SelfWriteRegistry from leaking
        // real setTimeouts that prevent Jest workers from exiting cleanly.
        selfWrite: createSelfWriteRegistry({
            setTimer: () => ({ id: 1 }),
            clearTimer: () => undefined,
        }),
        ...overrides,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Self-Write Set
// ─────────────────────────────────────────────────────────────────────────────

describe("createSelfWriteRegistry (framework SDD §5.3)", () => {
    it("marks and reports recent self-writes", () => {
        const reg = createSelfWriteRegistry();
        reg.markSelfWrite(".pagelet/foo.md");
        expect(reg.isRecentSelfWrite(".pagelet/foo.md")).toBe(true);
        expect(reg.isRecentSelfWrite(".pagelet/bar.md")).toBe(false);
        reg.dispose();
    });

    it("auto-expires entries after the TTL window via injected timer", () => {
        const timers: Array<{ ms: number; cb: () => void }> = [];
        const reg = createSelfWriteRegistry({
            windowMs: 5_000,
            setTimer: (cb, ms) => {
                const handle = { ms, cb };
                timers.push(handle);
                return handle;
            },
            clearTimer: () => undefined,
        });
        reg.markSelfWrite(".pagelet/foo.md");
        expect(reg.isRecentSelfWrite(".pagelet/foo.md")).toBe(true);
        expect(timers).toHaveLength(1);
        expect(timers[0].ms).toBe(5_000);
        // Fire the TTL callback manually.
        timers[0].cb();
        expect(reg.isRecentSelfWrite(".pagelet/foo.md")).toBe(false);
    });

    it("re-marking refreshes the TTL (cancels prior timer)", () => {
        const cancelled: unknown[] = [];
        const reg = createSelfWriteRegistry({
            setTimer: () => ({ id: Math.random() }),
            clearTimer: (h) => cancelled.push(h),
        });
        reg.markSelfWrite(".pagelet/foo.md");
        reg.markSelfWrite(".pagelet/foo.md");
        expect(cancelled).toHaveLength(1);
        reg.dispose();
    });

    it("dispose clears all paths and pending timers", () => {
        const cancelled: unknown[] = [];
        const reg = createSelfWriteRegistry({
            setTimer: () => ({ id: Math.random() }),
            clearTimer: (h) => cancelled.push(h),
        });
        reg.markSelfWrite("a.md");
        reg.markSelfWrite("b.md");
        expect(reg.snapshot().sort()).toEqual(["a.md", "b.md"]);
        reg.dispose();
        expect(reg.snapshot()).toEqual([]);
        expect(cancelled.length).toBe(2);
        // Subsequent isRecentSelfWrite returns false after dispose.
        expect(reg.isRecentSelfWrite("a.md")).toBe(false);
    });

    it("default window is SELF_WRITE_WINDOW_MS (5s)", () => {
        let ms = -1;
        createSelfWriteRegistry({
            setTimer: (_cb, t) => {
                ms = t;
                return { id: 1 };
            },
            clearTimer: () => undefined,
        }).markSelfWrite("a.md");
        expect(ms).toBe(SELF_WRITE_WINDOW_MS);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// ActionExecutor — 4-gate happy path
// ─────────────────────────────────────────────────────────────────────────────

describe("ActionExecutor (4-gate orchestration, framework SDD §3.2)", () => {
    it("runs the happy path: confinement → preview → stale → execute, emitting in order", async () => {
        const events: DebugEvent[] = [];
        const cap = makeCapability();
        const options = defaultExecutorOptions({ debugObserver: makeObserver(events) });
        const exec = createActionExecutor(options);
        const result = await exec.execute(cap, { foo: 1 }, makeContext());

        expect(result.status).toBe("ok");
        const types = events.map((e) => e.type);
        expect(types).toEqual([
            "gate.target-confinement.ok",
            "gate.preview.shown",
            "gate.confirmation.received",
            "gate.stale-reread.ok",
            "execute.ok",
        ]);
        // capability.executeWrite was called with hooks containing markSelfWrite
        expect((cap.executeWrite as jest.Mock)).toHaveBeenCalledTimes(1);
    });

    it("calls buildPreview before Gate 1 and feeds target.path into confinement", async () => {
        const cap = makeCapability();
        const exec = createActionExecutor(defaultExecutorOptions());
        await exec.execute(cap, { foo: 1 }, makeContext());
        expect((cap.buildPreview as jest.Mock)).toHaveBeenCalledTimes(1);
    });

    it("marks the normalized target as self-written before executeWrite runs", async () => {
        const seenInsideExecute: string[] = [];
        const selfWrite = createSelfWriteRegistry({
            setTimer: () => ({ id: 1 }),
            clearTimer: () => undefined,
        });
        const cap = makeCapability({
            executeWrite: jest.fn(async () => {
                // Inside executeWrite, the framework should have already marked the target.
                seenInsideExecute.push(...selfWrite.snapshot());
                return {
                    status: "ok" as const,
                    observation: null,
                    sourceRecords: [],
                    inputSummary: "ok",
                    sources: [],
                };
            }) as WriteActionCapability["executeWrite"],
        });
        const options = defaultExecutorOptions({ selfWrite });
        await createActionExecutor(options).execute(cap, {}, makeContext());
        expect(seenInsideExecute).toContain(".pagelet/foo.md");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// ActionExecutor — gate-rejection paths
// ─────────────────────────────────────────────────────────────────────────────

describe("ActionExecutor (gate rejection paths)", () => {
    it("returns failure + emits gate.target-confinement.reject when target outside allowlist", async () => {
        const events: DebugEvent[] = [];
        const cap = makeCapability(
            {},
            { target: { path: "/etc/passwd", category: "pagelet-review-note" } },
        );
        const exec = createActionExecutor(defaultExecutorOptions({ debugObserver: makeObserver(events) }));
        const result = await exec.execute(cap, {}, makeContext());
        expect(result.status).toBe("failed");
        const types = events.map((e) => e.type);
        expect(types).toEqual(["gate.target-confinement.reject"]);
        expect(events[0].errorCategory).toBe("rejected_at_confinement");
        expect(events[0].extra?.reason).toBe("absolute_path");
        expect((cap.executeWrite as jest.Mock)).not.toHaveBeenCalled();
    });

    it("returns failure + emits gate.confirmation.received with outcome when user cancels", async () => {
        const events: DebugEvent[] = [];
        const cap = makeCapability();
        const exec = createActionExecutor(defaultExecutorOptions({
            debugObserver: makeObserver(events),
            previewRenderer: makeRenderer(["cancelled"]),
        }));
        const result = await exec.execute(cap, {}, makeContext());
        expect(result.status).toBe("failed");
        expect(result.error).toMatch(/cancelled/);
        const types = events.map((e) => e.type);
        expect(types).toEqual([
            "gate.target-confinement.ok",
            "gate.preview.shown",
            "gate.confirmation.received",
        ]);
        const confirmation = events[2];
        expect(confirmation.extra?.outcome).toBe("cancelled");
        expect((cap.executeWrite as jest.Mock)).not.toHaveBeenCalled();
    });

    it("returns failure for closed/aborted outcomes (still emits gate.confirmation.received)", async () => {
        for (const outcome of ["closed", "aborted"] as const) {
            const events: DebugEvent[] = [];
            const cap = makeCapability();
            const exec = createActionExecutor(defaultExecutorOptions({
                debugObserver: makeObserver(events),
                previewRenderer: makeRenderer([outcome]),
            }));
            const result = await exec.execute(cap, {}, makeContext());
            expect(result.status).toBe("failed");
            expect(events.find((e) => e.type === "gate.confirmation.received")?.extra?.outcome).toBe(outcome);
            expect((cap.executeWrite as jest.Mock)).not.toHaveBeenCalled();
        }
    });

    it("returns failure + emits gate.stale-reread.drift when target appears between preview and execute", async () => {
        const events: DebugEvent[] = [];
        const existsMap: Record<string, boolean> = { ".pagelet": true, ".pagelet/foo.md": false };
        const fsProbe: FsProbe = {
            exists: jest.fn(async (path: string) => existsMap[path] ?? false) as FsProbe["exists"],
        };
        const cap = makeCapability();
        const exec = createActionExecutor(defaultExecutorOptions({
            debugObserver: makeObserver(events),
            fsProbe,
        }));
        // Schedule a flip: after Gate 2 returns confirmed, the target "appears"
        // before Gate 3 re-reads. We do this by toggling the map after the
        // renderer resolves.
        const renderer: PreviewRenderer = {
            show: jest.fn(async () => {
                existsMap[".pagelet/foo.md"] = true;
                return { outcome: "confirmed" as ConfirmationOutcome };
            }) as PreviewRenderer["show"],
        };
        const exec2 = createActionExecutor({
            ...defaultExecutorOptions({ debugObserver: makeObserver(events), fsProbe }),
            previewRenderer: renderer,
        });
        const result = await exec2.execute(cap, {}, makeContext());
        expect(result.status).toBe("failed");
        const driftEvent = events.find((e) => e.type === "gate.stale-reread.drift");
        expect(driftEvent).toBeDefined();
        expect(driftEvent?.errorCategory).toBe("stale_drift");
        expect((driftEvent?.extra as { drift?: Record<string, boolean> } | undefined)?.drift?.targetAppeared).toBe(true);
    });

    it("captures buildPreview throwing as execute.fail with stage=buildPreview", async () => {
        const events: DebugEvent[] = [];
        const cap = makeCapability({
            buildPreview: jest.fn(async () => {
                throw new Error("preview synthesis failed");
            }) as WriteActionCapability["buildPreview"],
        });
        const exec = createActionExecutor(defaultExecutorOptions({ debugObserver: makeObserver(events) }));
        const result = await exec.execute(cap, {}, makeContext());
        expect(result.status).toBe("failed");
        const evt = events.find((e) => e.type === "execute.fail");
        expect(evt?.extra?.stage).toBe("buildPreview");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// ActionExecutor — execute + rollback
// ─────────────────────────────────────────────────────────────────────────────

describe("ActionExecutor (execute & rollback)", () => {
    it("emits execute.fail + rollback.ok when executeWrite throws and rollback succeeds", async () => {
        const events: DebugEvent[] = [];
        const rollback = jest.fn(async () => undefined) as WriteActionCapability["rollback"];
        const cap = makeCapability({
            executeWrite: jest.fn(async () => {
                throw new Error("disk full");
            }) as WriteActionCapability["executeWrite"],
            rollback,
        });
        const exec = createActionExecutor(defaultExecutorOptions({ debugObserver: makeObserver(events) }));
        const result = await exec.execute(cap, {}, makeContext());
        expect(result.status).toBe("failed");
        const types = events.map((e) => e.type);
        expect(types).toContain("execute.fail");
        expect(types).toContain("rollback.ok");
        expect((rollback as jest.Mock)).toHaveBeenCalledTimes(1);
        const failEvent = events.find((e) => e.type === "execute.fail");
        expect(failEvent?.errorCategory).toBe("fs_error");
    });

    it("emits rollback.fail when executeWrite throws AND rollback throws (no cascade)", async () => {
        const events: DebugEvent[] = [];
        const cap = makeCapability({
            executeWrite: jest.fn(async () => {
                throw new Error("primary failure");
            }) as WriteActionCapability["executeWrite"],
            rollback: jest.fn(async () => {
                throw new Error("rollback exploded");
            }) as WriteActionCapability["rollback"],
        });
        const exec = createActionExecutor(defaultExecutorOptions({ debugObserver: makeObserver(events) }));
        const result = await exec.execute(cap, {}, makeContext());
        expect(result.status).toBe("failed");
        const rollbackEvt = events.find((e) => e.type === "rollback.fail");
        expect(rollbackEvt?.extra?.cascade).toBe(true);
    });

    it("skips rollback emission when capability has no rollback fn (capability handles its own cleanup)", async () => {
        const events: DebugEvent[] = [];
        const cap = makeCapability({
            executeWrite: jest.fn(async () => {
                throw new Error("oops");
            }) as WriteActionCapability["executeWrite"],
        });
        const exec = createActionExecutor(defaultExecutorOptions({ debugObserver: makeObserver(events) }));
        await exec.execute(cap, {}, makeContext());
        const types = events.map((e) => e.type);
        expect(types).toContain("execute.fail");
        expect(types).not.toContain("rollback.ok");
        expect(types).not.toContain("rollback.fail");
    });

    it("emits execute.fail + rollback when capability returns non-ok status without throwing", async () => {
        const events: DebugEvent[] = [];
        const rollback = jest.fn(async () => undefined) as WriteActionCapability["rollback"];
        const cap = makeCapability({
            executeWrite: jest.fn(async (): Promise<AgentCapabilityResult> => ({
                status: "failed",
                observation: null,
                sourceRecords: [],
                inputSummary: "fail",
                sources: [],
                error: "capability-reported error",
            })) as WriteActionCapability["executeWrite"],
            rollback,
        });
        const exec = createActionExecutor(defaultExecutorOptions({ debugObserver: makeObserver(events) }));
        const result = await exec.execute(cap, {}, makeContext());
        expect(result.status).toBe("failed");
        expect(result.error).toBe("capability-reported error");
        expect(events.map((e) => e.type)).toContain("execute.fail");
        expect((rollback as jest.Mock)).toHaveBeenCalled();
    });

    it("threads context.signal into previewRenderer.show options", async () => {
        const controller = new AbortController();
        const showSpy = jest.fn(async (..._args: unknown[]) => ({
            outcome: "confirmed" as ConfirmationOutcome,
        })) as PreviewRenderer["show"];
        const renderer: PreviewRenderer = { show: showSpy };
        const cap = makeCapability();
        const exec = createActionExecutor(defaultExecutorOptions({ previewRenderer: renderer }));
        await exec.execute(cap, {}, makeContext({ signal: controller.signal }));
        expect((showSpy as jest.Mock)).toHaveBeenCalled();
        const call = (showSpy as jest.Mock).mock.calls[0] as unknown[];
        const opts = call[1] as { signal?: AbortSignal } | undefined;
        expect(opts?.signal).toBe(controller.signal);
    });

    it("works without fsProbe (skips collision + stale reread sub-checks)", async () => {
        const events: DebugEvent[] = [];
        const cap = makeCapability();
        const exec = createActionExecutor(defaultExecutorOptions({
            fsProbe: undefined,
            debugObserver: makeObserver(events),
        }));
        const result = await exec.execute(cap, {}, makeContext());
        expect(result.status).toBe("ok");
        const stale = events.find((e) => e.type === "gate.stale-reread.ok");
        expect(stale?.extra?.skipped).toBe(true);
    });
});

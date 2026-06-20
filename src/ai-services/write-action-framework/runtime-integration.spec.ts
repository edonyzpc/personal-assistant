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
        host: {} as AgentCapabilityContext["host"],
        turnId: "turn-1",
        ...overrides,
    };
}

type TestFsProbe = FsProbe & {
    _existsMock: jest.MockedFunction<FsProbe["exists"]>;
    _readMock: jest.MockedFunction<FsProbe["read"]>;
};

type TestWriteActionCapability = WriteActionCapability & {
    _buildPreviewMock: jest.MockedFunction<WriteActionCapability["buildPreview"]>;
    _executeWriteMock: jest.MockedFunction<WriteActionCapability["executeWrite"]>;
};

function makeFsProbe(existsMap: Record<string, boolean> = {}): TestFsProbe {
    const existsMock = jest.fn(async (path: string) => existsMap[path] ?? false) as jest.MockedFunction<FsProbe["exists"]>;
    const readMock = jest.fn(async () => "") as jest.MockedFunction<FsProbe["read"]>;
    return {
        exists: existsMock,
        read: readMock,
        _existsMock: existsMock,
        _readMock: readMock,
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
): TestWriteActionCapability {
    const previewSpec: PreviewSpec = {
        operationType: "create-file",
        actionFamily: "pagelet-review-note",
        capabilityId: "test.write_action",
        target: {
            kind: "vault-path",
            displayPath: ".pagelet/foo.md",
            folder: ".pagelet/",
            filename: "foo.md",
        },
        contentPreview: {
            format: "markdown",
            body: "# Body",
            byteSize: 6,
        },
        impact: {
            usesAiProvider: false,
            usesAiCredits: false,
            affectsExternalState: false,
        },
        riskNotes: [],
        confirmCopy: { confirmLabel: "Confirm", cancelLabel: "Cancel" },
        ...spec,
    };
    const initialTargetPath = previewSpec.target.displayPath;
    const buildPreviewMock = jest.fn(async () => previewSpec) as jest.MockedFunction<WriteActionCapability["buildPreview"]>;
    const executeWriteMock = jest.fn(async () => ({
        status: "ok" as const,
        observation: { createdPath: ".pagelet/foo.md" },
        sourceRecords: [],
        inputSummary: "wrote",
        sources: [],
    })) as jest.MockedFunction<WriteActionCapability["executeWrite"]>;
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
        getTargetPath: ((): WriteActionCapability["getTargetPath"] =>
            (() => initialTargetPath))(),
        buildPreview: buildPreviewMock,
        executeWrite: executeWriteMock,
        ...overrides,
    };
    return Object.assign(cap, {
        _buildPreviewMock: buildPreviewMock,
        _executeWriteMock: executeWriteMock,
    });
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
        expect(cap._executeWriteMock).toHaveBeenCalledTimes(1);
    });

    it("calls buildPreview before Gate 1 and feeds target.path into confinement", async () => {
        const cap = makeCapability();
        const exec = createActionExecutor(defaultExecutorOptions());
        await exec.execute(cap, { foo: 1 }, makeContext());
        expect(cap._buildPreviewMock).toHaveBeenCalledTimes(1);
    });

    it("re-marks self-write on the success path so a slow executeWrite cannot age out the TTL (Fix #7)", async () => {
        const markCalls: string[] = [];
        const selfWrite = createSelfWriteRegistry({
            setTimer: () => ({ id: 1 }),
            clearTimer: () => undefined,
        });
        // Wrap selfWrite to record every markSelfWrite invocation.
        const wrapped = {
            ...selfWrite,
            markSelfWrite: (path: string) => {
                markCalls.push(path);
                selfWrite.markSelfWrite(path);
            },
        };
        const cap = makeCapability();
        await createActionExecutor(defaultExecutorOptions({ selfWrite: wrapped }))
            .execute(cap, {}, makeContext());
        // Two marks for the same path: one pre-execute, one post-execute (Fix #7).
        expect(markCalls.filter((p) => p === ".pagelet/foo.md")).toHaveLength(2);
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
        const cap = makeCapability({
            getTargetPath: () => "/etc/passwd",
        });
        const exec = createActionExecutor(defaultExecutorOptions({ debugObserver: makeObserver(events) }));
        const result = await exec.execute(cap, {}, makeContext());
        expect(result.status).toBe("failed");
        const types = events.map((e) => e.type);
        expect(types).toEqual(["gate.target-confinement.reject"]);
        expect(events[0].errorCategory).toBe("rejected_at_confinement");
        expect(events[0].extra?.reason).toBe("absolute_path");
        expect(cap._executeWriteMock).not.toHaveBeenCalled();
        // Fix #3: buildPreview is NOT called when getTargetPath fails
        // confinement, since Gate 1 runs first.
        expect(cap._buildPreviewMock).not.toHaveBeenCalled();
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
        expect(cap._executeWriteMock).not.toHaveBeenCalled();
    });

    it("returns failure for cancelled/aborted outcomes (still emits gate.confirmation.received)", async () => {
        for (const outcome of ["cancelled", "aborted"] as const) {
            const events: DebugEvent[] = [];
            const cap = makeCapability();
            const exec = createActionExecutor(defaultExecutorOptions({
                debugObserver: makeObserver(events),
                previewRenderer: makeRenderer([outcome]),
            }));
            const result = await exec.execute(cap, {}, makeContext());
            expect(result.status).toBe("failed");
            expect(events.find((e) => e.type === "gate.confirmation.received")?.extra?.outcome).toBe(outcome);
            expect(cap._executeWriteMock).not.toHaveBeenCalled();
        }
    });

    it("returns failure + emits gate.stale-reread.drift when target appears between preview and execute", async () => {
        const events: DebugEvent[] = [];
        const existsMap: Record<string, boolean> = { ".pagelet": true, ".pagelet/foo.md": false };
        const fsProbe: FsProbe = {
            exists: jest.fn(async (path: string) => existsMap[path] ?? false) as FsProbe["exists"],
            read: jest.fn(async () => "") as FsProbe["read"],
        };
        const cap = makeCapability();
        createActionExecutor(defaultExecutorOptions({
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
        expect(driftEvent?.errorCategory).toBe("stale_target");
        expect((driftEvent?.extra as { drift?: Record<string, boolean> } | undefined)?.drift?.targetAppeared).toBe(true);
    });

    it("uses content-hash stale re-read mode when the capability requests it", async () => {
        const events: DebugEvent[] = [];
        let targetExistsChecks = 0;
        let content = "before preview";
        const readMock = jest.fn(async () => content) as jest.MockedFunction<FsProbe["read"]>;
        const fsProbe: FsProbe = {
            exists: jest.fn(async (path: string) => {
                if (path === ".pagelet") return true;
                if (path === ".pagelet/foo.md") {
                    targetExistsChecks += 1;
                    return targetExistsChecks > 1;
                }
                return false;
            }) as FsProbe["exists"],
            read: readMock,
        };
        const renderer: PreviewRenderer = {
            show: jest.fn(async () => {
                content = "after preview";
                return { outcome: "confirmed" as ConfirmationOutcome };
            }) as PreviewRenderer["show"],
        };
        const cap = makeCapability({
            staleRereadMode: "content-hash",
        });
        const exec = createActionExecutor(defaultExecutorOptions({
            debugObserver: makeObserver(events),
            fsProbe,
            previewRenderer: renderer,
        }));

        const result = await exec.execute(cap, {}, makeContext());

        expect(result.status).toBe("failed");
        expect(readMock).toHaveBeenCalledTimes(2);
        const driftEvent = events.find((e) => e.type === "gate.stale-reread.drift");
        expect(driftEvent?.errorCategory).toBe("stale_target");
        expect((driftEvent?.extra as { drift?: Record<string, boolean> } | undefined)?.drift?.contentChanged)
            .toBe(true);
        expect(cap._executeWriteMock).not.toHaveBeenCalled();
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
        expect(evt?.errorCategory).toBe("user_aborted");
    });

    it("returns failure + emits gate.target-confinement.reject when getTargetPath throws (Fix #5)", async () => {
        const events: DebugEvent[] = [];
        const cap = makeCapability({
            getTargetPath: () => {
                throw new Error("input missing target");
            },
        });
        const exec = createActionExecutor(defaultExecutorOptions({ debugObserver: makeObserver(events) }));
        const result = await exec.execute(cap, {}, makeContext());
        expect(result.status).toBe("failed");
        const evt = events.find((e) => e.type === "gate.target-confinement.reject");
        expect(evt?.extra?.stage).toBe("getTargetPath");
        expect(evt?.errorCategory).toBe("user_aborted");
        expect(cap._buildPreviewMock).not.toHaveBeenCalled();
        expect(cap._executeWriteMock).not.toHaveBeenCalled();
    });

    it("rejects when spec.target.displayPath disagrees with getTargetPath (Fix #3)", async () => {
        const events: DebugEvent[] = [];
        const cap = makeCapability(
            { getTargetPath: () => ".pagelet/foo.md" },
            { target: { kind: "vault-path", displayPath: ".pagelet/other.md", folder: ".pagelet/", filename: "other.md" } },
        );
        const exec = createActionExecutor(defaultExecutorOptions({ debugObserver: makeObserver(events) }));
        const result = await exec.execute(cap, {}, makeContext());
        expect(result.status).toBe("failed");
        const evt = events.find((e) => e.type === "gate.target-confinement.reject");
        expect(evt?.errorCategory).toBe("rejected_at_confinement");
        expect(evt?.extra?.reason).toBe("path mismatch between getTargetPath and buildPreview");
        expect(cap._executeWriteMock).not.toHaveBeenCalled();
    });

    it("returns failure + emits gate.confirmation.received with renderWarnings when preview render throws (Fix #5)", async () => {
        const events: DebugEvent[] = [];
        const renderer: PreviewRenderer = {
            show: jest.fn(async () => {
                throw new Error("modal mount exploded");
            }) as PreviewRenderer["show"],
        };
        const cap = makeCapability();
        const exec = createActionExecutor(defaultExecutorOptions({
            debugObserver: makeObserver(events),
            previewRenderer: renderer,
        }));
        const result = await exec.execute(cap, {}, makeContext());
        expect(result.status).toBe("failed");
        const evt = events.find((e) => e.type === "gate.confirmation.received");
        expect(evt?.errorCategory).toBe("preview_render_failed");
        expect(evt?.extra?.outcome).toBe("aborted");
        expect(cap._executeWriteMock).not.toHaveBeenCalled();
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

    it("skips rollback emission when capability has no rollback fn AND fsProbe lacks remove (no safety net wired)", async () => {
        const events: DebugEvent[] = [];
        const cap = makeCapability({
            executeWrite: jest.fn(async () => {
                throw new Error("oops");
            }) as WriteActionCapability["executeWrite"],
        });
        // Default fsProbe (makeFsProbe) lacks `remove`, so the framework
        // safety net cannot run; rollback emit chain stays silent.
        const exec = createActionExecutor(defaultExecutorOptions({ debugObserver: makeObserver(events) }));
        await exec.execute(cap, {}, makeContext());
        const types = events.map((e) => e.type);
        expect(types).toContain("execute.fail");
        expect(types).not.toContain("rollback.ok");
        expect(types).not.toContain("rollback.fail");
    });

    it("auto-removes create-file target via fsProbe.remove when executeWrite throws (Fix #4)", async () => {
        const events: DebugEvent[] = [];
        const removeCalls: string[] = [];
        const fsProbe: FsProbe = {
            exists: jest.fn(async (path: string) => path === ".pagelet") as FsProbe["exists"],
            read: jest.fn(async () => "") as FsProbe["read"],
            remove: jest.fn(async (path: string) => {
                removeCalls.push(path);
            }) as NonNullable<FsProbe["remove"]>,
        };
        const cap = makeCapability({
            executeWrite: jest.fn(async () => {
                throw new Error("disk full");
            }) as WriteActionCapability["executeWrite"],
        });
        const exec = createActionExecutor(defaultExecutorOptions({
            debugObserver: makeObserver(events),
            fsProbe,
        }));
        const result = await exec.execute(cap, {}, makeContext());
        expect(result.status).toBe("failed");
        expect(removeCalls).toEqual([".pagelet/foo.md"]);
        const rollbackOk = events.find(
            (e) => e.type === "rollback.ok" && e.extra?.layer === "framework",
        );
        expect(rollbackOk).toBeDefined();
        expect(rollbackOk?.extra?.normalizedPath).toBe(".pagelet/foo.md");
        expect(rollbackOk?.extra?.cascade).toBe(false);
    });

    it("runs capability rollback AND framework auto-remove when both wired (Fix #4 cascade)", async () => {
        const events: DebugEvent[] = [];
        const fsProbe: FsProbe = {
            exists: jest.fn(async (path: string) => path === ".pagelet") as FsProbe["exists"],
            read: jest.fn(async () => "") as FsProbe["read"],
            remove: jest.fn(async () => undefined) as NonNullable<FsProbe["remove"]>,
        };
        const rollback = jest.fn(async () => undefined) as WriteActionCapability["rollback"];
        const cap = makeCapability({
            executeWrite: jest.fn(async () => {
                throw new Error("nope");
            }) as WriteActionCapability["executeWrite"],
            rollback,
        });
        const exec = createActionExecutor(defaultExecutorOptions({
            debugObserver: makeObserver(events),
            fsProbe,
        }));
        await exec.execute(cap, {}, makeContext());
        const okEvents = events.filter((e) => e.type === "rollback.ok");
        expect(okEvents).toHaveLength(2);
        const layers = okEvents.map((e) => e.extra?.layer);
        expect(layers).toEqual(expect.arrayContaining(["capability", "framework"]));
        const frameworkEvt = okEvents.find((e) => e.extra?.layer === "framework");
        expect(frameworkEvt?.extra?.cascade).toBe(true);
        expect((rollback as jest.Mock)).toHaveBeenCalledTimes(1);
        expect((fsProbe.remove as jest.Mock)).toHaveBeenCalledWith(".pagelet/foo.md");
    });

    it("emits rollback.fail layer=framework with fs_error when fsProbe.remove throws (Fix #4)", async () => {
        const events: DebugEvent[] = [];
        const fsProbe: FsProbe = {
            exists: jest.fn(async (path: string) => path === ".pagelet") as FsProbe["exists"],
            read: jest.fn(async () => "") as FsProbe["read"],
            remove: jest.fn(async () => {
                throw new Error("permission denied");
            }) as NonNullable<FsProbe["remove"]>,
        };
        const cap = makeCapability({
            executeWrite: jest.fn(async () => {
                throw new Error("disk gone");
            }) as WriteActionCapability["executeWrite"],
        });
        const exec = createActionExecutor(defaultExecutorOptions({
            debugObserver: makeObserver(events),
            fsProbe,
        }));
        await exec.execute(cap, {}, makeContext());
        const failEvt = events.find(
            (e) => e.type === "rollback.fail" && e.extra?.layer === "framework",
        );
        expect(failEvt).toBeDefined();
        expect(failEvt?.errorCategory).toBe("fs_error");
        expect(failEvt?.extra?.normalizedPath).toBe(".pagelet/foo.md");
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
        const call = (showSpy as jest.Mock).mock.calls[0];
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

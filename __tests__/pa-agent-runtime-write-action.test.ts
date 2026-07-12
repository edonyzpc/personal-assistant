/**
 * Integration test for Write Action Framework v1 wiring into PaAgentRuntime
 * (Track A · A3 acceptance — see docs/archive/sdd-rollout-plan.md §3.2 + framework
 * SDD §5.2).
 *
 * Goal: exercise the `createWriteActionAwareToolExecutor` seam end-to-end on
 * top of a real {@link CapabilityRegistry}, real {@link createActionExecutor}
 * (4 gates), and real {@link createPaAgentCapabilityToolExecutor} (chat-runtime
 * fallthrough path). Stubs are limited to the things that would otherwise
 * require Obsidian/UI:
 *   - PreviewRenderer (returns a queued ConfirmationOutcome list)
 *   - DebugObserver (collects events for assertion)
 *   - FsProbe (in-memory exists map)
 *   - PluginManager (settings + log shim)
 *
 * Covers the 4 scenarios listed in the rollout plan + the chat-runtime
 * passthrough invariant:
 *   1. Happy path: write-action capability runs through all 4 gates and
 *      reaches executeWrite; debug emit chain matches the expected sequence.
 *   2. Reject-at-registration: chat-runtime PolicyEngine defaults reject
 *      WriteActionCapability at register() time → never reaches executeWrite.
 *   3. User cancel: confirmation outcome "cancelled" → executeWrite skipped
 *      and a recoverable_error PaAgentToolExecutionResult is surfaced.
 *   4. Stale drift: snapshot delta between Gate 2 (capture) and Gate 3
 *      (re-check) blocks execution → executeWrite never invoked.
 *   5. Passthrough: `kind="tool"` capabilities still route through the
 *      base executor (chat tools keep working with framework wired in).
 */

import { describe, expect, it, jest } from "@jest/globals";

import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import { PolicyEngine } from "../src/ai-services/policy-engine";
import {
    createActionExecutor,
    createSelfWriteRegistry,
} from "../src/ai-services/write-action-framework/runtime-integration";
import type {
    ActionExecutor,
    FsProbe,
    SelfWriteRegistry,
} from "../src/ai-services/write-action-framework";
import type {
    ConfirmationOutcome,
    DebugEvent,
    DebugObserver,
    PreviewSpec,
    PreviewRenderer,
    WriteActionCapability,
} from "../src/ai-services/write-action-framework";
import { createPaAgentCapabilityToolExecutor } from "../src/ai-services/pa-agent-host-tools";
import { createWriteActionAwareToolExecutor } from "../src/ai-services/pa-agent-runtime";
import { createCoreToolCapabilities } from "../src/ai-services/capability-adapter";
import { createCurrentNoteContextTool } from "../src/ai-services/chat-tools";
import type {
    AgentCapability,
    AgentCapabilityContext,
    AgentCapabilityResult,
    AgentPermissionFuture,
} from "../src/ai-services/capability-types";
import type {
    ChatToolName,
    ChatToolPermission,
    ChatToolSourceBoundary,
} from "../src/ai-services/chat-tool-types";
import type { SourceRecordKind } from "../src/ai-services/chat-types";
import type {
    PaAgentToolCall,
    PaAgentToolExecutionInput,
} from "../src/ai-services/pa-agent-loop";

jest.mock("obsidian");

// ─────────────────────────────────────────────────────────────────────────────
// Stubs
// ─────────────────────────────────────────────────────────────────────────────

function fakePlugin(settings: Record<string, unknown> = {}): AgentCapabilityContext["host"] {
    return {
        settings: { debug: false, ...settings },
        log: () => undefined,
    } as never;
}

function makeFsProbe(existsMap: Record<string, boolean> = {}, contentMap: Record<string, string> = {}): FsProbe {
    return {
        exists: jest.fn(async (path: string) => existsMap[path] ?? false) as FsProbe["exists"],
        read: jest.fn(async (path: string) => contentMap[path] ?? "") as FsProbe["read"],
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

function makeNoopSelfWriteRegistry(): SelfWriteRegistry {
    // Inject no-op timers so Jest workers exit cleanly (the default
    // implementation uses real setTimeout which Jest fake timers wouldn't catch).
    return createSelfWriteRegistry({
        setTimer: () => ({ id: 1 }),
        clearTimer: () => undefined,
    });
}

const WRITE_TOOL_NAME = "test.write_action" as ChatToolName;

function makeWriteCapability(
    overrides: Partial<WriteActionCapability> = {},
    specOverrides: Partial<PreviewSpec> = {},
): WriteActionCapability {
    const previewSpec: PreviewSpec = {
        operationType: "create-file",
        actionFamily: "pagelet-review-note",
        capabilityId: WRITE_TOOL_NAME,
        target: {
            kind: "vault-path",
            displayPath: ".pagelet/foo.md",
            folder: ".pagelet/",
            filename: "foo.md",
        },
        contentPreview: {
            format: "markdown",
            body: "# Generated review body",
            byteSize: 24,
        },
        impact: {
            usesAiProvider: false,
            usesAiCredits: false,
            affectsExternalState: false,
        },
        riskNotes: [],
        confirmCopy: { confirmLabel: "Confirm", cancelLabel: "Cancel" },
        ...specOverrides,
    };
    const initialTargetPath = previewSpec.target.displayPath;
    return {
        name: WRITE_TOOL_NAME,
        description: "Test write action capability",
        inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
        plannerGuidance: [],
        kind: "action",
        origin: "core",
        providerId: "test-provider",
        permission: "local-filesystem-write" as AgentPermissionFuture,
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
                name: WRITE_TOOL_NAME,
                description: "Test write action capability",
                parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
            },
        }),
        toRegistryDefinition: () => ({
            name: WRITE_TOOL_NAME,
            description: "Test write action capability",
            inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
            plannerGuidance: [],
            permission: "read-only" as ChatToolPermission,
            cost: "free",
            outputBudgetChars: 0,
            requiresConfirmation: true,
            failureBehavior: "recoverable",
            statusMessage: "writing",
            sourceBoundary: "read-only-tool" as ChatToolSourceBoundary,
        }),
        // SDD §3.2: WriteActionCapability.execute MUST throw so accidental
        // direct calls never bypass the 4 gates.
        execute: async () => {
            throw new Error("WriteActionCapability.execute must not be called directly (use ActionExecutor)");
        },
        // Fix #3: synchronous + pure target-path extractor consumed by Gate 1.
        getTargetPath: ((): WriteActionCapability["getTargetPath"] =>
            (() => initialTargetPath))(),
        buildPreview: jest.fn(async () => previewSpec) as WriteActionCapability["buildPreview"],
        executeWrite: jest.fn(async () => ({
            status: "ok" as const,
            observation: { createdPath: previewSpec.target.displayPath },
            sourceRecords: [],
            inputSummary: `wrote ${previewSpec.target.displayPath}`,
            sources: [],
        })) as WriteActionCapability["executeWrite"],
        ...overrides,
    };
}

interface RuntimeTestHarness {
    registry: CapabilityRegistry;
    actionExecutor: ActionExecutor;
    selfWrite: SelfWriteRegistry;
    events: DebugEvent[];
}

interface RuntimeHarnessOverrides {
    policyEngine?: PolicyEngine;
    renderer?: PreviewRenderer;
    fsProbe?: FsProbe;
    now?: () => number;
}

function buildReviewModeHarness(overrides: RuntimeHarnessOverrides = {}): RuntimeTestHarness {
    const events: DebugEvent[] = [];
    const policy =
        overrides.policyEngine
        ?? new PolicyEngine({
            platform: "desktop",
            runKind: "review",
            allowWrite: true,
            allowedActionPermissions: ["local-filesystem-write"],
        });
    const registry = new CapabilityRegistry({ policyEngine: policy });
    const selfWrite = makeNoopSelfWriteRegistry();
    const actionExecutor = createActionExecutor({
        previewRenderer: overrides.renderer ?? makeRenderer(["confirmed"]),
        fsProbe: overrides.fsProbe ?? makeFsProbe({ ".pagelet": true }),
        selfWrite,
        debugObserver: makeObserver(events),
        runIdFactory: () => "run-test",
        now: overrides.now ?? (() => 1000),
    });
    return { registry, actionExecutor, selfWrite, events };
}

function buildToolCall(
    name: string,
    input: Record<string, unknown> = {},
    overrides: Partial<PaAgentToolCall> = {},
): PaAgentToolCall {
    return {
        type: "toolCall",
        id: "call-1",
        index: 0,
        name: name as ChatToolName,
        input,
        ...overrides,
    } as PaAgentToolCall;
}

function buildExecutionInput(
    name: string,
    input: Record<string, unknown> = {},
): PaAgentToolExecutionInput {
    return {
        runId: "run-1",
        turnId: "turn-1",
        turnIndex: 0,
        userInput: "write a review note",
        toolCall: buildToolCall(name, input),
        signal: new AbortController().signal,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("PA Agent runtime — Write Action Framework integration (Track A · A3)", () => {
    it("routes kind=action capabilities through the 4-gate ActionExecutor and emits the expected debug chain", async () => {
        const harness = buildReviewModeHarness();
        const capability = makeWriteCapability();
        expect(harness.registry.register(capability)).toBe(true);

        const baseExecutor = createPaAgentCapabilityToolExecutor({
            registry: harness.registry,
            host: fakePlugin(),
            platform: "desktop",
        });
        const executor = createWriteActionAwareToolExecutor({
            baseExecutor,
            actionExecutor: harness.actionExecutor,
            registry: harness.registry,
            host: fakePlugin(),
            platform: "desktop",
        });

        const result = await executor.execute(buildExecutionInput(WRITE_TOOL_NAME));

        // PaAgentLoop sees a success outcome carrying capability metadata.
        expect(result.outcome).toBe("success");
        expect(result.metadata?.tool).toBe(WRITE_TOOL_NAME);
        expect(result.metadata?.ok).toBe(true);
        expect(result.promptText).toContain(".pagelet/foo.md");

        // Capability hooks executed in the right order.
        expect(capability.buildPreview).toHaveBeenCalledTimes(1);
        expect(capability.executeWrite).toHaveBeenCalledTimes(1);
        // Note: capability.execute must remain untouched (throws on direct call).
        // Implicitly verified by the test not crashing — the framework never calls it.

        // Debug emit chain: 4 gates + execute.ok in order. We don't assert
        // payload internals (covered by runtime-integration.spec.ts) — only
        // sequencing + capabilityId routing here.
        const types = harness.events.map((e) => e.type);
        expect(types).toEqual([
            "gate.target-confinement.ok",
            "gate.preview.shown",
            "gate.confirmation.received",
            "gate.stale-reread.ok",
            "execute.ok",
        ]);
        for (const event of harness.events) {
            expect(event.capabilityId).toBe(WRITE_TOOL_NAME);
            expect(event.runId).toBe("run-test");
            expect(event.turnId).toBe("turn-1");
        }

        // Self-write registry was marked before executeWrite so the caller's
        // modify listener (if any) can skip its own ripple.
        expect(harness.selfWrite.snapshot()).toContain(".pagelet/foo.md");
    });

    it("rejects WriteActionCapability registration when PolicyEngine is in chat runtime defaults", () => {
        // Chat runtime default: runKind=chat, allowWrite=false → kind=action rejected at register().
        const chatPolicy = new PolicyEngine({ platform: "desktop" });
        const registry = new CapabilityRegistry({ policyEngine: chatPolicy });
        const capability = makeWriteCapability();

        // register() returns true (capability is recorded for diagnostics) but
        // policy decision is logged. The functional contract we care about is
        // that ANY attempt to execute it via the registry pipeline yields a
        // policy-rejected ChatToolResult — preserving chat-runtime safety.
        registry.register(capability);
        const diagnostics = registry.listDiagnostics();
        expect(diagnostics.some((d) => d.capabilityName === WRITE_TOOL_NAME && d.type === "policy")).toBe(true);

        // listDefinitions excludes kind=action even when registered.
        const definitions = registry.listDefinitions();
        expect(definitions.find((d) => d.name === WRITE_TOOL_NAME)).toBeUndefined();
    });

    it("does not reach executeWrite when the user cancels the preview modal", async () => {
        const harness = buildReviewModeHarness({
            renderer: makeRenderer(["cancelled"]),
        });
        const capability = makeWriteCapability();
        harness.registry.register(capability);

        const baseExecutor = createPaAgentCapabilityToolExecutor({
            registry: harness.registry,
            host: fakePlugin(),
            platform: "desktop",
        });
        const executor = createWriteActionAwareToolExecutor({
            baseExecutor,
            actionExecutor: harness.actionExecutor,
            registry: harness.registry,
            host: fakePlugin(),
            platform: "desktop",
        });

        const result = await executor.execute(buildExecutionInput(WRITE_TOOL_NAME));

        // PaAgentLoop sees recoverable_error so the model can self-correct.
        expect(result.outcome).toBe("recoverable_error");
        expect(result.metadata?.ok).toBe(false);
        expect(capability.executeWrite).not.toHaveBeenCalled();

        // Debug emit chain stops after confirmation.received and never reaches
        // stale-reread or execute.
        const types = harness.events.map((e) => e.type);
        expect(types).toEqual([
            "gate.target-confinement.ok",
            "gate.preview.shown",
            "gate.confirmation.received",
        ]);
    });

    it("blocks execution and emits stale-reread.drift when the snapshot changes between Gate 2 and Gate 3", async () => {
        // fsProbe returns different `exists` results across calls to simulate
        // a concurrent file creation while the preview was shown.
        let calls = 0;
        const probe: FsProbe = {
            exists: jest.fn(async (path: string) => {
                if (path === ".pagelet") return true;
                if (path === ".pagelet/foo.md") {
                    calls += 1;
                    // 1st call (Gate 1 collision check) — file missing.
                    // 2nd call (Gate 2 snapshot) — still missing.
                    // 3rd call (Gate 3 re-check) — file appeared → drift.
                    return calls >= 3;
                }
                return false;
            }) as FsProbe["exists"],
            read: jest.fn(async () => "") as FsProbe["read"],
        };
        const harness = buildReviewModeHarness({ fsProbe: probe });
        const capability = makeWriteCapability();
        harness.registry.register(capability);

        const baseExecutor = createPaAgentCapabilityToolExecutor({
            registry: harness.registry,
            host: fakePlugin(),
            platform: "desktop",
        });
        const executor = createWriteActionAwareToolExecutor({
            baseExecutor,
            actionExecutor: harness.actionExecutor,
            registry: harness.registry,
            host: fakePlugin(),
            platform: "desktop",
        });

        const result = await executor.execute(buildExecutionInput(WRITE_TOOL_NAME));

        expect(result.outcome).toBe("recoverable_error");
        expect(capability.executeWrite).not.toHaveBeenCalled();
        const types = harness.events.map((e) => e.type);
        expect(types).toContain("gate.stale-reread.drift");
        expect(types).not.toContain("execute.ok");
    });

    it("passes kind=tool capabilities through to the base chat-runtime executor unchanged", async () => {
        const harness = buildReviewModeHarness();
        // Register a real read-only chat tool alongside the write-action
        // capability to prove dispatch is per-capability. We use
        // get_current_note_context because it touches a Jest-mocked
        // workspace gracefully (no active note → it returns its own
        // recoverable_error result rather than crashing), which is enough
        // to verify that the base executor — not the framework — handled it.
        const [currentNoteCap] = createCoreToolCapabilities([createCurrentNoteContextTool()]);
        if (!currentNoteCap) throw new Error("expected current-note capability");
        harness.registry.registerMany([currentNoteCap]);
        harness.registry.register(makeWriteCapability());

        const baseExecutor = createPaAgentCapabilityToolExecutor({
            registry: harness.registry,
            host: fakePlugin({ app: { workspace: {} } }),
            platform: "desktop",
        });
        const executor = createWriteActionAwareToolExecutor({
            baseExecutor,
            actionExecutor: harness.actionExecutor,
            registry: harness.registry,
            host: fakePlugin({ app: { workspace: {} } }),
            platform: "desktop",
        });

        // Spy on the base executor to confirm dispatch routing.
        const baseSpy = jest.spyOn(baseExecutor, "execute");

        // kind=tool path: base executor is called regardless of result content.
        await executor.execute(
            buildExecutionInput("get_current_note_context", { mode: "metadata" }),
        );
        expect(baseSpy).toHaveBeenCalledTimes(1);

        // Action capability still routes through ActionExecutor — base executor
        // is NOT invoked again for the write-action call.
        baseSpy.mockClear();
        const actionResult = await executor.execute(buildExecutionInput(WRITE_TOOL_NAME));
        expect(actionResult.outcome).toBe("success");
        expect(baseSpy).not.toHaveBeenCalled();

        // No write-action debug events leaked into the kind=tool call (the
        // first invocation should not have populated the observer; the second
        // populated all 5 events).
        expect(harness.events.filter((e) => e.capabilityId === "get_current_note_context")).toHaveLength(0);
        expect(harness.events.filter((e) => e.capabilityId === WRITE_TOOL_NAME).length).toBeGreaterThan(0);
    });

    it("rejects malformed action capabilities instead of falling back to direct execute", async () => {
        const harness = buildReviewModeHarness();
        const directExecute = jest.fn(async (): Promise<AgentCapabilityResult> => ({
            status: "ok",
            observation: { bypassed: true },
            sourceRecords: [],
            inputSummary: "bypassed",
            sources: [],
        }));
        const capability = {
            ...makeWriteCapability({ execute: directExecute as AgentCapability["execute"] }),
            executeWrite: undefined,
        } as unknown as WriteActionCapability;
        harness.registry.register(capability);

        const baseExecutor = createPaAgentCapabilityToolExecutor({
            registry: harness.registry,
            host: fakePlugin(),
            platform: "desktop",
        });
        const executor = createWriteActionAwareToolExecutor({
            baseExecutor,
            actionExecutor: harness.actionExecutor,
            registry: harness.registry,
            host: fakePlugin(),
            platform: "desktop",
        });
        const baseSpy = jest.spyOn(baseExecutor, "execute");

        const result = await executor.execute(buildExecutionInput(WRITE_TOOL_NAME));

        expect(result.outcome).toBe("policy_rejected");
        expect(result.metadata?.reason).toBe("missing_execute_write");
        expect(baseSpy).not.toHaveBeenCalled();
        expect(directExecute).not.toHaveBeenCalled();
        expect(harness.events).toHaveLength(0);
    });

    it("preserves scope rejection semantics for malformed action capabilities", async () => {
        const harness = buildReviewModeHarness();
        const directExecute = jest.fn(async (): Promise<AgentCapabilityResult> => ({
            status: "ok",
            observation: { bypassed: true },
            sourceRecords: [],
            inputSummary: "bypassed",
            sources: [],
        }));
        const capability = {
            ...makeWriteCapability({ execute: directExecute as AgentCapability["execute"] }),
            executeWrite: undefined,
        } as unknown as WriteActionCapability;
        harness.registry.register(capability);

        const baseExecutor = createPaAgentCapabilityToolExecutor({
            registry: harness.registry,
            host: fakePlugin(),
            platform: "desktop",
        });
        const executor = createWriteActionAwareToolExecutor({
            baseExecutor,
            actionExecutor: harness.actionExecutor,
            registry: harness.registry,
            host: fakePlugin(),
            platform: "desktop",
            allowedToolNames: new Set<string>(["something_else"]),
        });

        const result = await executor.execute(buildExecutionInput(WRITE_TOOL_NAME));

        expect(result.outcome).toBe("policy_rejected");
        expect(result.metadata?.reason).toBe("tool_outside_user_requested_scope");
        expect(directExecute).not.toHaveBeenCalled();
        expect(harness.events).toHaveLength(0);
    });

    it("returns schema_invalid before invoking ActionExecutor when prepareAndValidate fails", async () => {
        const harness = buildReviewModeHarness();
        const capability = makeWriteCapability({
            // Force a validation failure. The chat-runtime executor consumes
            // schema_invalid before reaching execute() — the action-aware
            // wrapper must preserve the same ordering.
            prepareAndValidate: ((): AgentCapability["prepareAndValidate"] => () => ({
                ok: false,
                error: new Error("invalid path"),
            }))(),
        });
        harness.registry.register(capability);

        const baseExecutor = createPaAgentCapabilityToolExecutor({
            registry: harness.registry,
            host: fakePlugin(),
            platform: "desktop",
        });
        const executor = createWriteActionAwareToolExecutor({
            baseExecutor,
            actionExecutor: harness.actionExecutor,
            registry: harness.registry,
            host: fakePlugin(),
            platform: "desktop",
        });

        const result = await executor.execute(buildExecutionInput(WRITE_TOOL_NAME, { path: "bad" }));
        expect(result.outcome).toBe("schema_invalid");
        expect(result.metadata?.reason).toBe("input_validation_failed");
        expect(capability.buildPreview).not.toHaveBeenCalled();
        expect(capability.executeWrite).not.toHaveBeenCalled();
        expect(harness.events).toHaveLength(0);
    });

    it("rejects with policy_rejected outcome when PolicyEngine denies the action capability (Fix #2)", async () => {
        // Chat-runtime PolicyEngine → action capabilities denied at canExecute.
        const policyDenyHarness = buildReviewModeHarness({
            policyEngine: new PolicyEngine({ platform: "desktop" }),
        });
        const capability = makeWriteCapability();
        policyDenyHarness.registry.register(capability);

        const baseExecutor = createPaAgentCapabilityToolExecutor({
            registry: policyDenyHarness.registry,
            host: fakePlugin(),
            platform: "desktop",
        });
        const executor = createWriteActionAwareToolExecutor({
            baseExecutor,
            actionExecutor: policyDenyHarness.actionExecutor,
            registry: policyDenyHarness.registry,
            host: fakePlugin(),
            platform: "desktop",
        });

        const result = await executor.execute(buildExecutionInput(WRITE_TOOL_NAME));
        expect(result.outcome).toBe("policy_rejected");
        expect(result.metadata?.reason).toBe("policy_denied_capability");
        expect(capability.buildPreview).not.toHaveBeenCalled();
        expect(capability.executeWrite).not.toHaveBeenCalled();
        // Framework debug observer did not emit anything (we short-circuited
        // before reaching the action executor).
        expect(policyDenyHarness.events).toHaveLength(0);
    });

    it("rejects with policy_rejected outcome when allowedToolNames excludes the action (Fix #6)", async () => {
        const harness = buildReviewModeHarness();
        const capability = makeWriteCapability();
        harness.registry.register(capability);

        const baseExecutor = createPaAgentCapabilityToolExecutor({
            registry: harness.registry,
            host: fakePlugin(),
            platform: "desktop",
        });
        const executor = createWriteActionAwareToolExecutor({
            baseExecutor,
            actionExecutor: harness.actionExecutor,
            registry: harness.registry,
            host: fakePlugin(),
            platform: "desktop",
            allowedToolNames: new Set<string>(["something_else"]),
        });

        const result = await executor.execute(buildExecutionInput(WRITE_TOOL_NAME));
        expect(result.outcome).toBe("policy_rejected");
        expect(result.metadata?.reason).toBe("tool_outside_user_requested_scope");
        expect(capability.buildPreview).not.toHaveBeenCalled();
        expect(harness.events).toHaveLength(0);
    });

    it("emits CapabilityUsageEvent (status=invoked) on the success path (Fix #2)", async () => {
        const usageEvents: Array<{ status: string; capabilityName: string }> = [];
        const policy = new PolicyEngine({
            platform: "desktop",
            runKind: "review",
            allowWrite: true,
            allowedActionPermissions: ["local-filesystem-write"],
        });
        const registry = new CapabilityRegistry({
            policyEngine: policy,
            telemetryEnabled: true,
            onCapabilityEvent: (event) => {
                usageEvents.push({ status: event.status, capabilityName: event.capabilityName });
            },
        });
        const capability = makeWriteCapability();
        registry.register(capability);

        const selfWrite = makeNoopSelfWriteRegistry();
        const actionExecutor = createActionExecutor({
            previewRenderer: makeRenderer(["confirmed"]),
            fsProbe: makeFsProbe({ ".pagelet": true }),
            selfWrite,
            debugObserver: makeObserver([]),
            runIdFactory: () => "run-x",
            now: () => 1000,
        });
        const baseExecutor = createPaAgentCapabilityToolExecutor({
            registry,
            host: fakePlugin(),
            platform: "desktop",
        });
        const executor = createWriteActionAwareToolExecutor({
            baseExecutor,
            actionExecutor,
            registry,
            host: fakePlugin(),
            platform: "desktop",
        });
        const result = await executor.execute(buildExecutionInput(WRITE_TOOL_NAME));
        expect(result.outcome).toBe("success");
        expect(usageEvents).toContainEqual({
            status: "invoked",
            capabilityName: WRITE_TOOL_NAME,
        });
    });
});

/* Copyright 2023 edonyzpc */

/**
 * Track C · C2 — Cancel / abort paths must produce zero file writes and
 * zero `execute.ok`/`execute.fail` debug events.
 *
 * The Write Action Framework SDD §2.1 lifecycle maps every non-`confirmed`
 * preview outcome to a hard stop BEFORE the execute phase:
 *
 *   - "cancelled" → user clicked secondary / ESC / ✕ / clicked outside
 *   - "aborted"   → external AbortSignal fired (turn cancelled / unload)
 *   - "timeout"   → reserved for Operations Agent mode (v1 never emits)
 *
 * For each non-confirm outcome, we assert two invariants:
 *
 *   1. No `vault.adapter.write` is ever called — the user must not see a
 *      review note appear on disk for an action they declined.
 *   2. No `execute.ok` AND no `execute.fail` debug event is emitted —
 *      the framework's `failure(...)` short-circuit at runtime-integration.ts
 *      `outcome !== "confirmed"` deliberately returns BEFORE the executor
 *      reaches the execute span. A regression here would mislead audit
 *      consumers (and confuse the developer running `ConsoleDebugObserver`).
 *
 * The third sub-test exercises the actual modal's `onClose` path
 * (`src/ai-services/write-action-framework/preview-modal.ts:199-208`), which
 * maps an unresolved modal close to "cancelled". Plugins that opened the
 * modal and then unloaded mid-flight rely on this — without the assertion
 * we'd ship a UI regression where ESC silently looked like a confirm.
 */

import { describe, expect, it, jest } from "@jest/globals";

import type { AgentCapabilityContext } from "../src/ai-services/capability-types";
import {
    WriteActionPreviewModal,
    type ConfirmationOutcome,
    type DebugEvent,
    type DebugObserver,
    type FsProbe,
    type PreviewRenderer,
    type PreviewShowOptions,
    type PreviewShowResult,
    type PreviewSpec,
} from "../src/ai-services/write-action-framework";

import {
    createPaReviewRuntime,
} from "../src/pagelet/pa-review-runtime";
import {
    PAGELET_SCHEMA_VERSION,
    type PageletReviewResult,
} from "../src/pagelet/pa-review-schemas";
import { PAGELET_DEFAULTS, type PageletSettings } from "../src/settings/pagelet";
import {
    type PageletWriteReviewOutputInput,
} from "../src/pagelet/pa-review-tool-provider";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_DATE = new Date(Date.UTC(2026, 5, 3, 14, 30, 45));

function makeReviewResult(): PageletReviewResult {
    return {
        schema_version: PAGELET_SCHEMA_VERSION,
        detected_language: "en",
        suggestions: [
            {
                source_id: "seg-1",
                kind: "clarify",
                rationale: "Needs a clearer scope statement near the opening line.",
                proposed_action: "Add a one-sentence scope note after the title.",
            },
        ],
        overall_remark: "Solid draft; one scope clarification away from a publish.",
    };
}

function makeInput(overrides: Partial<PageletWriteReviewOutputInput> = {}): PageletWriteReviewOutputInput {
    return {
        sourcePath: "notes/draft.md",
        reviewResult: makeReviewResult(),
        mode: "basic",
        detectedLanguage: "en",
        dateOverride: FIXED_DATE,
        ...overrides,
    };
}

function makeContext(extras: Partial<AgentCapabilityContext> = {}): AgentCapabilityContext {
    return {
        plugin: undefined as unknown as AgentCapabilityContext["plugin"],
        turnId: "turn-cancel-abort",
        ...extras,
    };
}

interface RecordingAdapter {
    exists: jest.Mock<(p: string) => Promise<boolean>>;
    mkdir: jest.Mock<(p: string) => Promise<void>>;
    write: jest.Mock<(p: string, d: string) => Promise<void>>;
    remove: jest.Mock<(p: string) => Promise<void>>;
}

function makeAdapter(): RecordingAdapter {
    // Gate 1's confinement probe calls `fs.exists(folder)` to confirm the
    // `.pagelet/` parent exists before the write is even shown. We resolve
    // exactly that one folder path to true and everything else (including
    // the actual review-note file) to false — `false` for the file path is
    // what the framework needs to clear the name-collision check.
    return {
        exists: jest.fn(async (p: string): Promise<boolean> => p === ".pagelet") as RecordingAdapter["exists"],
        mkdir: jest.fn(async () => undefined) as RecordingAdapter["mkdir"],
        write: jest.fn(async () => undefined) as RecordingAdapter["write"],
        remove: jest.fn(async () => undefined) as RecordingAdapter["remove"],
    };
}

function rendererThatReturns(outcome: ConfirmationOutcome): PreviewRenderer {
    return {
        show: jest.fn(async (): Promise<PreviewShowResult> => ({ outcome })) as unknown as PreviewRenderer["show"],
    };
}

function recordingObserver(): DebugObserver & { events: DebugEvent[] } {
    const events: DebugEvent[] = [];
    return {
        events,
        emit(event: DebugEvent): void {
            events.push(event);
        },
    };
}

function buildRuntime(renderer: PreviewRenderer, observer: DebugObserver) {
    const adapter = makeAdapter();
    const settings: PageletSettings = { ...PAGELET_DEFAULTS };
    const fakeApp = { vault: { adapter } } as unknown as Parameters<typeof createPaReviewRuntime>[0]["app"];
    const runtime = createPaReviewRuntime({
        app: fakeApp,
        getPageletSettings: () => settings,
        previewRenderer: renderer,
        fsProbe: adapter as unknown as FsProbe,
        debugObserver: observer,
    });
    return { runtime, adapter };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Pagelet cancel / abort paths (Track C · C2)", () => {
    it("cancelled outcome → no write, no execute.ok / execute.fail emit", async () => {
        const observer = recordingObserver();
        const { runtime, adapter } = buildRuntime(rendererThatReturns("cancelled"), observer);

        const result = await runtime.actionExecutor.execute(
            runtime.toolProvider.capability,
            makeInput(),
            makeContext(),
        );

        // The framework synthesizes a failure result with a user-safe nil
        // message (no toast text); the capability never ran.
        expect(result.status).toBe("failed");
        expect(adapter.write).not.toHaveBeenCalled();

        const types = observer.events.map((e) => e.type);
        // Gate 1/2 still emit (we did get as far as showing the preview).
        expect(types).toContain("gate.target-confinement.ok");
        expect(types).toContain("gate.preview.shown");
        expect(types).toContain("gate.confirmation.received");
        // CRITICAL: execute.* MUST NOT be emitted — the framework's
        // `outcome !== "confirmed"` short-circuit at
        // runtime-integration.ts:401 returns BEFORE the execute span.
        expect(types).not.toContain("execute.ok");
        expect(types).not.toContain("execute.fail");
        expect(types).not.toContain("rollback.ok");
        expect(types).not.toContain("rollback.fail");
        // Self-write registry stays empty — nothing was written.
        expect(runtime.selfWriteSnapshot()).toEqual([]);

        runtime.dispose();
    });

    it("aborted outcome → no write, no execute.* emit, surfaces user-safe message", async () => {
        const observer = recordingObserver();
        const { runtime, adapter } = buildRuntime(rendererThatReturns("aborted"), observer);

        const result = await runtime.actionExecutor.execute(
            runtime.toolProvider.capability,
            makeInput(),
            makeContext(),
        );

        expect(result.status).toBe("failed");
        // The framework's failure(...) attaches a user-safe message when the
        // outcome was aborted (see runtime-integration.ts:402-406). We
        // explicitly assert this so a future refactor doesn't silently drop
        // the toast the plugin shows.
        expect(result.userSafeMessage).toBe("Action was aborted.");
        expect(adapter.write).not.toHaveBeenCalled();

        const types = observer.events.map((e) => e.type);
        expect(types).not.toContain("execute.ok");
        expect(types).not.toContain("execute.fail");
        runtime.dispose();
    });

    it("AbortSignal fired before show() resolves → no write, observer sees aborted outcome", async () => {
        // This is the "user closed the chat tab while the preview was open"
        // path. We model it by giving the renderer an AbortController that
        // fires immediately, and using a renderer that respects the signal
        // (matching the ObsidianPreviewRenderer contract).
        const observer = recordingObserver();
        let observedSignalAborted = false;
        const renderer: PreviewRenderer = {
            show: jest.fn(async (_spec: PreviewSpec, options?: PreviewShowOptions): Promise<PreviewShowResult> => {
                if (options?.signal?.aborted) {
                    observedSignalAborted = true;
                    return { outcome: "aborted" } as PreviewShowResult;
                }
                return { outcome: "confirmed" } as PreviewShowResult;
            }) as unknown as PreviewRenderer["show"],
        };
        const { runtime, adapter } = buildRuntime(renderer, observer);
        const controller = new AbortController();
        controller.abort();

        const result = await runtime.actionExecutor.execute(
            runtime.toolProvider.capability,
            makeInput(),
            makeContext({ signal: controller.signal }),
        );

        expect(observedSignalAborted).toBe(true);
        expect(result.status).toBe("failed");
        expect(adapter.write).not.toHaveBeenCalled();
        const types = observer.events.map((e) => e.type);
        expect(types).not.toContain("execute.ok");
        expect(types).not.toContain("execute.fail");
        runtime.dispose();
    });

    it("WriteActionPreviewModal.onClose without resolve maps to 'cancelled' (preview-modal.ts:199-208)", () => {
        // Reach into the underlying modal class to assert the ESC / ✕ /
        // click-outside path resolves to "cancelled". The framework's own
        // preview-modal.spec covers this in depth; we re-assert the slice
        // Pagelet directly depends on so a refactor of the modal class
        // surfaces here as well as in the framework suite.
        const outcomes: ConfirmationOutcome[] = [];
        // Minimal App stub: the modal touches `app` only when its
        // contentPreview is markdown (via MarkdownRenderer). We feed a
        // plain-text spec to avoid the markdown render branch.
        const fakeApp = {} as unknown as ConstructorParameters<typeof WriteActionPreviewModal>[0];
        const spec = {
            operationType: "create-file" as const,
            actionFamily: "create-file",
            capabilityId: "pagelet.write_review_output",
            target: {
                kind: "vault-path" as const,
                displayPath: ".pagelet/test.md",
                folder: ".pagelet/",
                filename: "test.md",
            },
            contentPreview: {
                format: "plain-text" as const,
                body: "body",
                byteSize: 4,
            },
            impact: {
                usesAiProvider: false,
                usesAiCredits: false,
                affectsExternalState: false,
            },
            riskNotes: [],
            confirmCopy: { confirmLabel: "Save", cancelLabel: "Cancel" },
        };
        const modal = new WriteActionPreviewModal(fakeApp, spec, (outcome) => outcomes.push(outcome));
        // Replace the inherited Obsidian `contentEl` stub with a minimal
        // object exposing the `empty()` method onClose calls.
        // The shared __mocks__/obsidian.ts Modal sets contentEl to `{}`,
        // so we patch only what the close path needs.
        (modal as unknown as { contentEl: { empty: () => void } }).contentEl = {
            empty: (): void => undefined,
        };

        // Simulate the user pressing ESC: Obsidian invokes onClose without
        // a prior resolve. Per preview-modal.ts:199-208 this must map to
        // "cancelled".
        modal.onClose();
        expect(outcomes).toEqual(["cancelled"]);

        // Calling onClose a second time must NOT emit again (settled flag).
        modal.onClose();
        expect(outcomes).toEqual(["cancelled"]);
    });

    it("preview renderer throws → no write, framework emits 'preview_render_failed' on confirmation event", async () => {
        // Belt-and-suspenders: a renderer fault (e.g., Obsidian internals
        // throw mid-render) must NOT cause a write. The framework treats it
        // as a render failure + returns a user-safe message; the capability
        // is never invoked.
        const observer = recordingObserver();
        const throwingRenderer: PreviewRenderer = {
            show: jest.fn(async () => {
                throw new Error("modal mount failed");
            }) as unknown as PreviewRenderer["show"],
        };
        const { runtime, adapter } = buildRuntime(throwingRenderer, observer);

        const result = await runtime.actionExecutor.execute(
            runtime.toolProvider.capability,
            makeInput(),
            makeContext(),
        );

        expect(result.status).toBe("failed");
        expect(adapter.write).not.toHaveBeenCalled();
        const failed = observer.events.find((e) => e.type === "gate.confirmation.received");
        expect(failed?.errorCategory).toBe("preview_render_failed");
        const types = observer.events.map((e) => e.type);
        expect(types).not.toContain("execute.ok");
        expect(types).not.toContain("execute.fail");

        runtime.dispose();
    });
});

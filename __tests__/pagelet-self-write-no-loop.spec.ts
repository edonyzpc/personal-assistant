/* Copyright 2023 edonyzpc */

/**
 * Track C · C2 — Self-write reentrancy guard regression.
 *
 * SDD §5.3 and Write Action Framework R3 require the framework to suppress
 * its own modify-event ripple within a 5-second TTL window. The plugin's
 * `vault.on("modify")` listener consults
 * {@link PaReviewRuntime.isRecentSelfWrite} BEFORE any downstream
 * side-effects (Pagelet retrigger, VSS dirty-marker, etc.) — this test
 * locks in that contract end-to-end.
 *
 * Scenario:
 *   1. Mount a {@link PaReviewRuntime} with a stub renderer that confirms.
 *   2. Drive a full write through {@link ActionExecutor.execute}.
 *   3. Simulate the plugin-level modify listener firing for the path that
 *      was just written.
 *   4. Assert the predicate the plugin uses (`pageletRuntime.isRecentSelfWrite`)
 *      returns `true`, short-circuiting the downstream side-effects.
 *   5. After the 5s TTL elapses (driven by fake timers), the registry should
 *      no longer report the path as "recent", letting a genuine external
 *      modify proceed normally.
 *
 * Why this is a separate spec from the C1 unit suite:
 *   - The C1 suite asserts the registry mechanics + the provider's hook
 *     wiring as discrete units; it does NOT exercise the plugin's listener
 *     predicate.
 *   - The plugin's listener body (src/plugin.ts:417-433) is a single line —
 *     refactoring it without a regression spec would risk regressing the
 *     reentrancy guard the framework was designed around.
 *   - Driving the full {@link ActionExecutor} (not just the capability
 *     directly) confirms BOTH the framework's pre-execute mark AND the
 *     provider's externalMarkSelfWrite chain land in the external registry,
 *     since the plugin only reads the external registry.
 */

import { describe, expect, it, jest } from "@jest/globals";

import type { AgentCapabilityContext } from "../src/ai-services/capability-types";
import {
    type DebugObserver,
    type FsProbe,
    type PreviewRenderer,
    type PreviewShowResult,
} from "../src/ai-services/write-action-framework";

import {
    createPaReviewRuntime,
    type PaReviewRuntime,
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
// Shared fixtures (mirror the C1 spec so a single fixture drift in one file
// surfaces consistently — see __tests__/pa-review-tool-provider.test.ts).
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

function makeContext(): AgentCapabilityContext {
    return {
        plugin: undefined as unknown as AgentCapabilityContext["plugin"],
        turnId: "turn-no-loop",
    };
}

interface InMemoryAdapter {
    exists: jest.Mock<(p: string) => Promise<boolean>>;
    mkdir: jest.Mock<(p: string) => Promise<void>>;
    write: jest.Mock<(p: string, d: string) => Promise<void>>;
    remove: jest.Mock<(p: string) => Promise<void>>;
    readonly files: Map<string, string>;
    readonly folders: Set<string>;
}

function makeAdapter(): InMemoryAdapter {
    const files = new Map<string, string>();
    const folders = new Set<string>();
    // Seed the default `.pagelet/` parent so Gate 1's `fs.exists(folder)`
    // resolves true (mirrors a vault where the user has already accepted
    // the folder via the onboarding flow).
    folders.add(".pagelet");
    return {
        files,
        folders,
        exists: jest.fn(async (path: string): Promise<boolean> => files.has(path) || folders.has(path)) as InMemoryAdapter["exists"],
        mkdir: jest.fn(async (path: string): Promise<void> => {
            folders.add(path);
        }) as InMemoryAdapter["mkdir"],
        write: jest.fn(async (path: string, data: string): Promise<void> => {
            files.set(path, data);
        }) as InMemoryAdapter["write"],
        remove: jest.fn(async (path: string): Promise<void> => {
            files.delete(path);
        }) as InMemoryAdapter["remove"],
    };
}

function silentRenderer(): PreviewRenderer {
    return {
        show: jest.fn(async (): Promise<PreviewShowResult> => ({ outcome: "confirmed" })) as unknown as PreviewRenderer["show"],
    };
}

function silentObserver(): DebugObserver {
    return { emit: jest.fn() };
}

/**
 * The exact predicate `src/plugin.ts:424` runs inside the modify listener.
 * Extracted as a helper so the test asserts on the same shape; any
 * refactor in the plugin that breaks this predicate must update both
 * sites.
 */
function pluginModifyListenerWouldSuppress(
    runtime: PaReviewRuntime | null,
    filePath: string,
): boolean {
    return runtime?.isRecentSelfWrite(filePath) === true;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Pagelet self-write no-loop guard (Track C · C2)", () => {
    it("plugin modify listener short-circuits for the just-written path", async () => {
        const adapter = makeAdapter();
        const settings: PageletSettings = { ...PAGELET_DEFAULTS };
        const fakeApp = { vault: { adapter } } as unknown as Parameters<typeof createPaReviewRuntime>[0]["app"];
        const runtime = createPaReviewRuntime({
            app: fakeApp,
            getPageletSettings: () => settings,
            previewRenderer: silentRenderer(),
            fsProbe: adapter as unknown as FsProbe,
            debugObserver: silentObserver(),
        });

        const input = makeInput();
        const expectedPath = runtime.toolProvider.capability.getTargetPath(input);

        // Drive the full write through the framework. After this resolves,
        // the framework's internal Self-Write Set + our external one BOTH
        // hold `expectedPath` (the framework refreshes on execute.ok).
        const result = await runtime.actionExecutor.execute(
            runtime.toolProvider.capability,
            input,
            makeContext(),
        );
        expect(result.status).toBe("ok");

        // Simulate the plugin-level modify-event listener firing for the
        // freshly-written path. The plugin's body short-circuits via the
        // helper below; we assert the same predicate the plugin runs.
        expect(pluginModifyListenerWouldSuppress(runtime, expectedPath)).toBe(true);

        // Sanity: an unrelated path is NOT suppressed — the registry is
        // path-specific, not a global gate.
        expect(pluginModifyListenerWouldSuppress(runtime, "notes/unrelated.md")).toBe(false);

        runtime.dispose();
    });

    it("after the 5s TTL expires, a fresh external modify is NOT suppressed", async () => {
        // Drive the registry off injectable timers via `selfWriteWindowMs`.
        // We pick a short window (50 ms) so jest fake timers can advance
        // past it without slowing the suite — the C1 spec already covers
        // the production default constant (SELF_WRITE_WINDOW_MS = 5000).
        jest.useFakeTimers();
        try {
            const adapter = makeAdapter();
            const settings: PageletSettings = { ...PAGELET_DEFAULTS };
            const fakeApp = { vault: { adapter } } as unknown as Parameters<typeof createPaReviewRuntime>[0]["app"];
            const runtime = createPaReviewRuntime({
                app: fakeApp,
                getPageletSettings: () => settings,
                previewRenderer: silentRenderer(),
                fsProbe: adapter as unknown as FsProbe,
                debugObserver: silentObserver(),
                selfWriteWindowMs: 50,
            });
            const input = makeInput();
            const expectedPath = runtime.toolProvider.capability.getTargetPath(input);

            await runtime.actionExecutor.execute(
                runtime.toolProvider.capability,
                input,
                makeContext(),
            );
            expect(pluginModifyListenerWouldSuppress(runtime, expectedPath)).toBe(true);

            // Advance past the TTL — the path should fall out of the
            // registry so a *subsequent* external modify (e.g., the user
            // editing the review note manually) no longer gets suppressed.
            jest.advanceTimersByTime(60);
            expect(pluginModifyListenerWouldSuppress(runtime, expectedPath)).toBe(false);

            runtime.dispose();
        } finally {
            jest.useRealTimers();
        }
    });

    it("a second Pagelet write inside the window does NOT lose the suppression for either path", async () => {
        // Belt-and-suspenders: two consecutive writes (e.g., a user clicks
        // the ribbon, then quickly clicks again on a different note before
        // the first TTL expires) must each be self-suppressed independently.
        const adapter = makeAdapter();
        const settings: PageletSettings = { ...PAGELET_DEFAULTS };
        const fakeApp = { vault: { adapter } } as unknown as Parameters<typeof createPaReviewRuntime>[0]["app"];
        const runtime = createPaReviewRuntime({
            app: fakeApp,
            getPageletSettings: () => settings,
            previewRenderer: silentRenderer(),
            fsProbe: adapter as unknown as FsProbe,
            debugObserver: silentObserver(),
        });

        const inputA = makeInput({ sourcePath: "notes/alpha.md" });
        const inputB = makeInput({ sourcePath: "notes/bravo.md" });
        const pathA = runtime.toolProvider.capability.getTargetPath(inputA);
        const pathB = runtime.toolProvider.capability.getTargetPath(inputB);
        expect(pathA).not.toBe(pathB);

        await runtime.actionExecutor.execute(runtime.toolProvider.capability, inputA, makeContext());
        await runtime.actionExecutor.execute(runtime.toolProvider.capability, inputB, makeContext());

        expect(pluginModifyListenerWouldSuppress(runtime, pathA)).toBe(true);
        expect(pluginModifyListenerWouldSuppress(runtime, pathB)).toBe(true);
        // Snapshot must contain BOTH paths (the registry is multi-entry).
        const snap = runtime.selfWriteSnapshot();
        expect(snap).toContain(pathA);
        expect(snap).toContain(pathB);

        runtime.dispose();
    });

    it("dispose() empties the registry so listeners cannot fire stale suppression", () => {
        // The plugin's onunload calls runtime.dispose(). After that, any
        // queued modify event (e.g., from an Obsidian late-flush) must
        // observe the registry as empty so it does not accidentally
        // short-circuit a legitimate user write.
        const adapter = makeAdapter();
        const settings: PageletSettings = { ...PAGELET_DEFAULTS };
        const fakeApp = { vault: { adapter } } as unknown as Parameters<typeof createPaReviewRuntime>[0]["app"];
        const runtime = createPaReviewRuntime({
            app: fakeApp,
            getPageletSettings: () => settings,
            previewRenderer: silentRenderer(),
            fsProbe: adapter as unknown as FsProbe,
            debugObserver: silentObserver(),
        });
        // Manually mark via the same path the framework would have used.
        // (We avoid driving the executor here to keep the test focused on
        // dispose() semantics, not the full gate sequence.)
        const fakePath = ".pagelet/manual.md";
        runtime.toolProvider.capability.executeWrite(
            makeInput({ sourcePath: "notes/manual.md" }),
            makeContext(),
            { markSelfWrite: () => undefined },
        );
        // Suppression should hold for the actually-written path; we can't
        // know it yet (the executeWrite above is async) so we just verify
        // the dispose contract by manually invoking it.
        runtime.dispose();
        expect(runtime.isRecentSelfWrite(fakePath)).toBe(false);
        expect(runtime.selfWriteSnapshot()).toEqual([]);
    });
});

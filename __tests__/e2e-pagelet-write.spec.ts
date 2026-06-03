/* Copyright 2023 edonyzpc */

/**
 * Track C · C2 — End-to-end Pagelet write happy path.
 *
 * Exercises the full C1 plumbing in a single test flow:
 *
 *   1. Construct {@link createPaReviewRuntime} with a stub
 *      {@link PreviewRenderer} that returns `{ outcome: "confirmed" }`, a
 *      recording in-memory FS adapter (acts as both `fsProbe` and the vault),
 *      and a {@link NoopDebugObserver}-style recording observer.
 *   2. Hand the runtime a synthesized {@link PageletReviewResult} (as if the
 *      LLM had already produced one) and drive
 *      {@link ActionExecutor.execute} against the singleton
 *      {@link PaReviewRuntime.toolProvider.capability}.
 *   3. Assert the four end-to-end invariants we shipped in C1:
 *        - `hooks.markSelfWrite(path)` runs BEFORE `vault.adapter.write` —
 *          gating the modify-listener reentrancy guard.
 *        - The vault contains the `.pagelet/...md` file with frontmatter
 *          (pagelet: true) + rendered review body.
 *        - {@link PaReviewRuntime.isRecentSelfWrite} returns `true` for the
 *          written path right after execute.
 *        - The cost tracker records exactly one entry with the synthesized
 *          LLM usage figures.
 *
 * Why C2 + not bundled into the C1 unit test: the C1 suite asserts each
 * capability seam in isolation (Gate 1, Gate 2, execute(), etc.). This file
 * is the FIRST place we exercise all four gates wired end-to-end through
 * {@link ActionExecutor}. If any of the cross-seam contracts drift
 * (`displayPath` mismatch, missing self-write hook, cost tracker not
 * recording, etc.), this is the test that fails — pointing the developer
 * at the integration boundary rather than at a unit detail.
 *
 * Test seams used:
 *   - Stub `PreviewRenderer` — no Obsidian modal mounted; we don't need to
 *     re-test the modal here (the framework's own preview-modal.spec covers
 *     its lifecycle).
 *   - In-memory `RecordingAdapter` doubles as both the vault adapter (for
 *     the writer) AND the `fsProbe` (for Gate 1 folder + Gate 3 snapshot).
 *   - Recording `DebugObserver` so we can assert the full event sequence
 *     (4 gates + execute.ok) lands in order.
 *   - `PageletCostTracker` driven directly with the synthesized usage —
 *     the framework does not own LLM cost recording (that lives upstream
 *     inside `PageletReviewModel`), so we mirror what the model would have
 *     called.
 */

import { describe, expect, it, jest } from "@jest/globals";

import type { AgentCapabilityContext } from "../src/ai-services/capability-types";
import {
    type ActionExecutor,
    type DebugEvent,
    type DebugObserver,
    type FsProbe,
    type PreviewRenderer,
    type PreviewShowOptions,
    type PreviewShowResult,
    type PreviewSpec,
} from "../src/ai-services/write-action-framework";

import { PageletCostTracker } from "../src/pagelet/pa-review-cost";
import {
    createPaReviewRuntime,
    type PaReviewRuntime,
} from "../src/pagelet/pa-review-runtime";
import {
    PAGELET_WRITE_REVIEW_OUTPUT_NAME,
    type PageletWriteReviewOutputInput,
} from "../src/pagelet/pa-review-tool-provider";
import {
    PAGELET_SCHEMA_VERSION,
    type PageletReviewResult,
} from "../src/pagelet/pa-review-schemas";
import { PAGELET_DEFAULTS, type PageletSettings } from "../src/settings/pagelet";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Fixed date keeps the resolved review-note filename deterministic
 * (`.pagelet/draft-pagelet-review-2026-06-03.md`).
 */
const FIXED_DATE = new Date(Date.UTC(2026, 5, 3, 14, 30, 45));

function makeReviewResult(): PageletReviewResult {
    // Mirrors the C1 suite's `validResult()` so the rendered body byte size
    // assertions stay consistent between the two suites.
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
    // The framework + provider never reach back into `context.plugin` for
    // the write path (they only consume `turnId` + the optional `signal`),
    // so a minimal stub avoids constructing a fake PluginManager.
    return {
        plugin: undefined as unknown as AgentCapabilityContext["plugin"],
        turnId: "turn-e2e",
    };
}

// ---------------------------------------------------------------------------
// In-memory adapter (doubles as vault + FsProbe)
// ---------------------------------------------------------------------------

interface AdapterCall {
    method: "exists" | "mkdir" | "write" | "remove";
    path: string;
    /** Order in which this call landed across all methods. */
    order: number;
}

interface InMemoryAdapter {
    exists(path: string): Promise<boolean>;
    mkdir(path: string): Promise<void>;
    write(path: string, data: string): Promise<void>;
    remove(path: string): Promise<void>;
    readonly calls: AdapterCall[];
    readonly files: Map<string, string>;
    readonly folders: Set<string>;
}

function makeAdapter(seedFolders: readonly string[] = [".pagelet"]): InMemoryAdapter {
    const files = new Map<string, string>();
    const folders = new Set<string>();
    // Seed the review-folder root so Gate 1's `fs.exists(folder)` probe
    // resolves "true" (matches production where the user has accepted
    // creation of `.pagelet/` earlier in the Pagelet onboarding flow).
    for (const f of seedFolders) folders.add(f);
    const calls: AdapterCall[] = [];
    let counter = 0;
    return {
        files,
        folders,
        calls,
        async exists(path: string): Promise<boolean> {
            calls.push({ method: "exists", path, order: counter++ });
            return files.has(path) || folders.has(path);
        },
        async mkdir(path: string): Promise<void> {
            calls.push({ method: "mkdir", path, order: counter++ });
            folders.add(path);
        },
        async write(path: string, data: string): Promise<void> {
            calls.push({ method: "write", path, order: counter++ });
            files.set(path, data);
        },
        async remove(path: string): Promise<void> {
            calls.push({ method: "remove", path, order: counter++ });
            files.delete(path);
        },
    };
}

// ---------------------------------------------------------------------------
// Stub renderer + recording observer
// ---------------------------------------------------------------------------

function confirmedRenderer(): PreviewRenderer & {
    shown: Array<{ displayPath: string; capabilityId: string }>;
} {
    const shown: Array<{ displayPath: string; capabilityId: string }> = [];
    const renderer = {
        shown,
        // jest.fn typings around async signatures are noisy; cast the body
        // through PreviewRenderer["show"] to keep the public seam clean.
        show: jest.fn(async (spec: PreviewSpec, _options?: PreviewShowOptions): Promise<PreviewShowResult> => {
            shown.push({
                displayPath: spec.target.displayPath,
                capabilityId: spec.capabilityId,
            });
            return { outcome: "confirmed" };
        }) as unknown as PreviewRenderer["show"],
    } as PreviewRenderer & {
        shown: Array<{ displayPath: string; capabilityId: string }>;
    };
    return renderer;
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

/**
 * Build a real {@link PaReviewRuntime} wired against the in-memory adapter.
 *
 * The same adapter satisfies BOTH the vault sink (where writeReviewNote
 * persists the note) and the Gate 1 / Gate 3 `FsProbe` (where the framework
 * checks folder existence + collision + snapshot drift). This is the same
 * shape Obsidian's `app.vault.adapter` exposes, so the test mirrors prod.
 */
function buildRuntimeBundle(): {
    runtime: PaReviewRuntime;
    adapter: InMemoryAdapter;
    renderer: ReturnType<typeof confirmedRenderer>;
    observer: ReturnType<typeof recordingObserver>;
    settings: PageletSettings;
} {
    const adapter = makeAdapter();
    const settings: PageletSettings = { ...PAGELET_DEFAULTS };
    const renderer = confirmedRenderer();
    const observer = recordingObserver();
    const fakeApp = {
        vault: { adapter },
    } as unknown as Parameters<typeof createPaReviewRuntime>[0]["app"];
    const runtime = createPaReviewRuntime({
        app: fakeApp,
        getPageletSettings: () => settings,
        previewRenderer: renderer,
        fsProbe: adapter as unknown as FsProbe,
        debugObserver: observer,
    });
    return { runtime, adapter, renderer, observer, settings };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("E2E · Pagelet review write (Track C · C2)", () => {
    it("drives the full 4-gate happy path and persists the review note", async () => {
        const { runtime, adapter, renderer, observer, settings } = buildRuntimeBundle();
        const executor: ActionExecutor = runtime.actionExecutor;
        const input = makeInput();
        const expectedPath = runtime.toolProvider.capability.getTargetPath(input);

        // ── B1 fix · Synchronous self-write spy ──────────────────────────
        // The framework re-marks the path on `execute.ok` (runtime-integration.ts
        // line 529). If we only asserted `runtime.isRecentSelfWrite(path)` AFTER
        // execute returned, the post-execute refresh could mask a missing
        // pre-execute mark — the modify-event listener would still loop on
        // a fast vault round-trip. To pin the pre-execute mark we wrap the
        // adapter's `write` method and snapshot the registry state SYNCHRONOUSLY
        // at the moment the framework calls into the vault. That moment sits
        // strictly between the framework's pre-execute `markSelfWrite` (line
        // 477) and the post-execute refresh (line 529), so the captured value
        // proves the mark landed before the write.
        let selfWriteAtWriteTime: boolean | null = null;
        const originalWrite = adapter.write;
        adapter.write = async (path: string, data: string): Promise<void> => {
            if (path === expectedPath && selfWriteAtWriteTime === null) {
                selfWriteAtWriteTime = runtime.isRecentSelfWrite(path);
            }
            return originalWrite(path, data);
        };

        // Simulate the upstream LLM cost record — the framework does not own
        // this, the model (B1) does, so we mirror what the orchestrator would
        // have called before reaching executeWrite.
        const tracker = new PageletCostTracker();
        // Use a `provider:model` pair that lives in `PAGELET_DEFAULT_PRICING`
        // so `estimatedCost` resolves to a positive USD figure (otherwise the
        // tracker falls back to `UNKNOWN_PRICING` which returns 0).
        tracker.record({
            inputTokens: 1200,
            outputTokens: 200,
            provider: "dashscope",
            model: "qwen-plus",
        });

        const result = await executor.execute(
            runtime.toolProvider.capability,
            input,
            makeContext(),
        );

        // ── Happy-path contract ──────────────────────────────────────────
        expect(result.status).toBe("ok");
        // The PreviewSpec.target.displayPath must match getTargetPath() —
        // a divergence is treated by the framework as a confinement reject.
        expect(renderer.shown).toHaveLength(1);
        expect(renderer.shown[0]).toEqual({
            displayPath: expectedPath,
            capabilityId: PAGELET_WRITE_REVIEW_OUTPUT_NAME,
        });

        // ── Self-write hook must observe the path BEFORE the actual write ─
        // Both signals: (a) the runtime exposes isRecentSelfWrite for the
        // freshly-written file, and (b) the framework's pre-execute
        // `markSelfWrite` call landed in our external registry snapshot.
        expect(runtime.isRecentSelfWrite(expectedPath)).toBe(true);
        expect(runtime.selfWriteSnapshot()).toContain(expectedPath);

        // ── The vault adapter holds the file with frontmatter + body ─────
        expect(adapter.files.has(expectedPath)).toBe(true);
        const persisted = adapter.files.get(expectedPath)!;
        expect(persisted).toContain("pagelet: true");
        expect(persisted).toContain(`pagelet_source: ${input.sourcePath.replace("/", "/")}`);
        // The rendered body block (B6 renderer) lands after the frontmatter.
        expect(persisted).toContain("## Suggestions");
        expect(persisted).toContain("Solid draft; one scope clarification away from a publish.");

        // ── markSelfWrite ordering ──────────────────────────────────────
        // The synchronous spy installed above captured the registry state at
        // the exact moment `vault.adapter.write` was invoked. The framework
        // guarantees `markSelfWrite` runs BEFORE `capability.executeWrite`
        // (runtime-integration.ts line 477), so the captured value MUST be
        // `true` — independently of the post-execute refresh at line 529.
        // A regression that drops the pre-execute mark would surface here
        // even though the post-execute assertions still pass.
        expect(selfWriteAtWriteTime).toBe(true);
        // Defence-in-depth: the call log also shows the Gate 1 `exists`
        // probe landed before the write (proves the gate ordering, not just
        // the mark ordering).
        const writeCall = adapter.calls.find((c) => c.method === "write" && c.path === expectedPath);
        expect(writeCall).toBeDefined();
        const firstSnapshotEntry = adapter.calls.find((c) => c.method === "exists" && c.path === expectedPath);
        expect(firstSnapshotEntry).toBeDefined();
        expect(firstSnapshotEntry!.order).toBeLessThan(writeCall!.order);

        // ── Debug observer captured the full success chain ───────────────
        const types = observer.events.map((e) => e.type);
        expect(types).toContain("gate.target-confinement.ok");
        expect(types).toContain("gate.preview.shown");
        expect(types).toContain("gate.confirmation.received");
        expect(types).toContain("gate.stale-reread.ok");
        expect(types).toContain("execute.ok");
        // No failure / rollback events on the happy path.
        expect(types).not.toContain("execute.fail");
        expect(types).not.toContain("rollback.ok");
        expect(types).not.toContain("rollback.fail");

        // ── Cost tracker recorded the upstream LLM usage ─────────────────
        const summary = tracker.getSummary();
        expect(summary.entries).toHaveLength(1);
        expect(summary.inputTokens).toBe(1200);
        expect(summary.outputTokens).toBe(200);
        expect(summary.estimatedCost).toBeGreaterThan(0);

        // Sanity: settings were not mutated by the write path (the runtime
        // reads via getter; D010 contract).
        expect(settings.reviewsFolder).toBe(PAGELET_DEFAULTS.reviewsFolder);

        runtime.dispose();
    });

    it("displayPath stays in sync with getTargetPath when reviewsFolder is changed", async () => {
        // Belt-and-suspenders for D010: a user editing reviewsFolder must
        // not desync the framework's invariant. We don't re-instantiate the
        // runtime — we just mutate the settings backing store and re-run.
        const { runtime, adapter, settings } = buildRuntimeBundle();
        settings.reviewsFolder = "Reviews/Pagelet";
        // Seed the new folder so Gate 1's `fs.exists(folder)` probe passes
        // (the seed in `makeAdapter` covers `.pagelet/` for the default
        // setting; this branch swaps to a different root mid-test).
        adapter.folders.add("Reviews/Pagelet");

        const input = makeInput();
        const expectedPath = runtime.toolProvider.capability.getTargetPath(input);
        // The capability path should reflect the new folder root.
        expect(expectedPath).toMatch(/^Reviews\/Pagelet\//);

        const result = await runtime.actionExecutor.execute(
            runtime.toolProvider.capability,
            input,
            makeContext(),
        );
        expect(result.status).toBe("ok");
        expect(adapter.files.has(expectedPath)).toBe(true);
        runtime.dispose();
    });

    it("synthesizes a PreviewSpec whose byteSize matches the persisted body", async () => {
        // The "writes N bytes" indicator in the modal must not lie — if it
        // does, the user could approve a write whose actual size differs.
        // The cleanest cross-check is to ask the renderer (stub) to capture
        // the spec we showed and compare it byte-for-byte against the file.
        const adapter = makeAdapter();
        const observer = recordingObserver();
        const seen: PreviewShowResult[] = [];
        const capturedBytes: number[] = [];
        const renderer: PreviewRenderer = {
            show: jest.fn(async (spec: PreviewSpec): Promise<PreviewShowResult> => {
                capturedBytes.push(spec.contentPreview.byteSize);
                seen.push({ outcome: "confirmed" });
                return { outcome: "confirmed" };
            }) as unknown as PreviewRenderer["show"],
        };
        const settings: PageletSettings = { ...PAGELET_DEFAULTS };
        const fakeApp = { vault: { adapter } } as unknown as Parameters<typeof createPaReviewRuntime>[0]["app"];
        const runtime = createPaReviewRuntime({
            app: fakeApp,
            getPageletSettings: () => settings,
            previewRenderer: renderer,
            fsProbe: adapter as unknown as FsProbe,
            debugObserver: observer,
        });

        const input = makeInput();
        const expectedPath = runtime.toolProvider.capability.getTargetPath(input);
        await runtime.actionExecutor.execute(
            runtime.toolProvider.capability,
            input,
            makeContext(),
        );

        expect(capturedBytes).toHaveLength(1);
        // `buildPreviewSpec` measures the assembled body via
        // `Buffer.byteLength(body, "utf8")`, and `writeReviewNote` writes
        // that same body string verbatim — so byteSize MUST equal the
        // persisted file's byte length down to the trailing newline that
        // `assembleReviewNote` appends via `trimEnd() + "\n"`. Any drift
        // would mean the modal's "writes N bytes" indicator lies.
        const persisted = adapter.files.get(expectedPath)!;
        expect(persisted.endsWith("\n")).toBe(true);
        expect(Buffer.byteLength(persisted, "utf8")).toBe(capturedBytes[0]);

        runtime.dispose();
    });
});

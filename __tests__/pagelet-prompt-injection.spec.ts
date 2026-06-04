/* Copyright 2023 edonyzpc */

/**
 * Track C · C2 — Prompt-injection fixtures rejected at Gate 1.
 *
 * The Write Action Framework SDD §8.3 lists 5 canonical injection vectors
 * a malicious LLM might try in order to escape Pagelet's `.pagelet/`
 * confinement. The framework's target-confinement gate (Gate 1) MUST reject
 * each one BEFORE `buildPreview` or `executeWrite` ever runs.
 *
 * The 5 fixtures here are the concrete `getTargetPath` outputs a malicious
 * LLM might force by tampering with the upstream input shape. We map them
 * to the SDD's intent table (`inject-absolute-path`, `inject-traversal`,
 * etc.) and assert two invariants for each:
 *
 *   1. `vault.adapter.write` is NEVER called — the file system stays clean
 *      regardless of how convincing the injected text is.
 *   2. The debug observer fires `gate.target-confinement.reject` with
 *      `errorCategory: "rejected_at_confinement"`, so audit consumers can
 *      tell "denied by safety" from "user cancelled" or "fs error".
 *
 * Why we drive these through the live capability (and not the bare
 * confinement helper): the SDD invariant we ship is "Pagelet's capability,
 * wired through ActionExecutor, refuses these fixtures". If the capability
 * later gained a custom `getTargetPath` rewrite that sneaked past Gate 1,
 * the helper-only test wouldn't catch it.
 *
 * Note: SDD §8.3 also lists `inject-bypass-confirm` and `inject-fake-target`
 * fixtures. Those are NOT Gate 1 concerns — `bypass-confirm` is enforced
 * by the preview modal (the LLM-produced text cannot suppress the modal),
 * and `fake-target` is enforced by the framework's
 * `displayPath === normalizedPath` cross-check (asserted by the C1 unit
 * suite). We deliberately keep this spec focused on Gate 1 rejection so a
 * single failure here narrows the blast radius cleanly.
 */

import { describe, expect, it, jest } from "@jest/globals";

import type { AgentCapabilityContext } from "../src/ai-services/capability-types";
import {
    type DebugEvent,
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
import {
    PAGELET_DEFAULTS,
    mergePageletSettings,
    normalizeReviewsFolder,
    type PageletSettings,
} from "../src/settings/pagelet";
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

function makeContext(): AgentCapabilityContext {
    return {
        plugin: undefined as unknown as AgentCapabilityContext["plugin"],
        turnId: "turn-injection",
    };
}

interface RecordingAdapter {
    exists: jest.Mock<(p: string) => Promise<boolean>>;
    mkdir: jest.Mock<(p: string) => Promise<void>>;
    write: jest.Mock<(p: string, d: string) => Promise<void>>;
    remove: jest.Mock<(p: string) => Promise<void>>;
}

/**
 * Make an in-memory adapter that pretends a single set of folders already
 * exists. Defaults to `[".pagelet"]` (the production Pagelet root) so the
 * benign control + sanitiser sub-tests can reach Gate 2 and beyond. Pass
 * `[]` for the injection fixture sub-tests so Gate 1's `fs.exists(folder)`
 * probe also gets exercised — though the sync-stage rejections (absolute
 * path / parent-traversal / etc.) usually catch those candidates before
 * the async probe even runs.
 */
function makeAdapter(seedFolders: readonly string[] = [".pagelet"]): RecordingAdapter {
    const folderSet = new Set(seedFolders);
    return {
        exists: jest.fn(async (p: string): Promise<boolean> => folderSet.has(p)) as RecordingAdapter["exists"],
        mkdir: jest.fn(async () => undefined) as RecordingAdapter["mkdir"],
        write: jest.fn(async () => undefined) as RecordingAdapter["write"],
        remove: jest.fn(async () => undefined) as RecordingAdapter["remove"],
    };
}

function confirmingRenderer(): PreviewRenderer & { calls: number } {
    let calls = 0;
    const r = {
        // Should never be called — Gate 1 rejects first. The counter lets
        // us assert that explicitly per fixture.
        get calls(): number {
            return calls;
        },
        show: jest.fn(async (): Promise<PreviewShowResult> => {
            calls++;
            return { outcome: "confirmed" };
        }) as unknown as PreviewRenderer["show"],
    };
    return r as PreviewRenderer & { calls: number };
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

function buildRuntime(): {
    runtime: PaReviewRuntime;
    adapter: RecordingAdapter;
    renderer: ReturnType<typeof confirmingRenderer>;
    observer: ReturnType<typeof recordingObserver>;
} {
    const adapter = makeAdapter();
    const settings: PageletSettings = { ...PAGELET_DEFAULTS };
    const renderer = confirmingRenderer();
    const observer = recordingObserver();
    const fakeApp = { vault: { adapter } } as unknown as Parameters<typeof createPaReviewRuntime>[0]["app"];
    const runtime = createPaReviewRuntime({
        app: fakeApp,
        getPageletSettings: () => settings,
        previewRenderer: renderer,
        fsProbe: adapter as unknown as FsProbe,
        debugObserver: observer,
    });
    return { runtime, adapter, renderer, observer };
}

/**
 * Each fixture supplies one `sourcePath` value that, given the
 * `getTargetPath` rewrite in the capability, produces a candidate path
 * Gate 1 must reject. The capability's `getTargetPath` flows through
 * `resolveReviewNotePath`, which sanitises the source basename — so the
 * easiest way to force an injection path is to override `reviewsFolder`
 * in the runtime's settings backing store (an LLM cannot do this, but a
 * compromised plugin author OR a future settings-injection bug could).
 *
 * We split the fixtures into two flavours:
 *   - sourcePath-only injection: malicious sourcePath that still resolves
 *     to the allowed folder (the sanitiser keeps these in `.pagelet/`).
 *     These should NOT reject — they prove the sanitiser fence is doing
 *     its job. We assert one such case as a defensive baseline.
 *   - reviewsFolder injection: a tampered folder setting that points to
 *     a forbidden root. These map 1:1 to SDD §8.3's `inject-absolute-path`,
 *     `inject-traversal`, etc.
 */

interface InjectionFixture {
    id: string;
    description: string;
    /** Folder override that drives `resolveReviewNotePath` into a bad place. */
    reviewsFolder: string;
    /** Optional source path override. Defaults to `"notes/x.md"`. */
    sourcePath?: string;
    /**
     * Pin the framework's confinement reject reason so fixture intent does
     * not silently drift. Without this pin, a refactor that moves a fixture
     * from (say) `absolute_path` to `folder_missing` would still pass the
     * generic `rejected_at_confinement` assertion — yet the security story
     * has materially changed (folder_missing only rejects because the
     * test mock didn't seed the folder, which production would).
     *
     * Values map 1:1 to `ConfinementRejectReason` in
     * `src/ai-services/write-action-framework/target-confinement.ts`.
     */
    expectedReason: string;
    /**
     * Honest note about why this fixture lands on `expectedReason` rather
     * than the SDD-named reason (e.g. `inject-absolute-path` lists
     * "absolute_path" but the writer's `normalizeReviewsFolder` strips the
     * leading `/` before the framework sees the path, so the actual
     * rejection reason is `folder_missing`). Surfaces production-vs-test
     * gaps inline next to each fixture so reviewers can see them at a
     * glance.
     */
    productionGapNote?: string;
}

const SDD_8_3_FIXTURES: readonly InjectionFixture[] = [
    {
        id: "inject-absolute-path",
        description: "/etc/passwd — absolute system path (SDD §8.3 row 1)",
        reviewsFolder: "/etc/passwd",
        // `normalizeReviewsFolder` (pa-review-file-io.ts:325) strips the
        // leading `/` so by the time the framework sees the candidate it is
        // already `etc/passwd/...` — sync `absolute_path` check never fires.
        // The mock adapter does not seed `etc/passwd`, so async Gate 1
        // rejects with `folder_missing`. On a system where `etc/passwd`
        // happens to exist as a vault-relative folder (vanishingly unlikely
        // for the literal name; very real for other absolute paths that
        // collapse to existing relative folders) the gate would NOT reject
        // here — only the per-capability allowlist would. See the
        // production-gap test below.
        expectedReason: "folder_missing",
        productionGapNote: "absolute-path scrub happens before the framework sees the candidate",
    },
    {
        id: "inject-traversal",
        description: "../../config.json — parent-traversal escape (SDD §8.3 row 2)",
        reviewsFolder: "../../config.json",
        // Sync gate catches the `..` segment regardless of FS state — this
        // fixture is the most production-faithful of the bunch.
        expectedReason: "parent_traversal",
    },
    {
        id: "inject-into-pa-config",
        description: ".obsidian/plugins/personal-assistant/data.json — adjacent escape",
        reviewsFolder: ".obsidian/plugins/personal-assistant",
        sourcePath: "data.json",
        // Two layers of defence reject this candidate in production:
        //   (1) settings-layer `normalizeReviewsFolder` (H-B3.2 /
        //       v2.2.0-beta.1) coerces the bad folder back to `.pagelet`
        //       before the capability ever sees it; AND
        //   (2) framework Gate 1 `forbidden_dotfolder` denylist (#358)
        //       rejects any candidate whose top-level segment is
        //       `.obsidian`/`.git`/`.trash`/`.obsidian.bak`, regardless
        //       of what `allowedRoots` the caller wired.
        // This fixture exercises layer (2): the test harness bypasses
        // the settings-layer scrub by feeding the bad folder directly
        // to the capability, so Gate 1's intrinsic denylist must catch
        // it. Pinned to `forbidden_dotfolder` so a regression that
        // removes the denylist downgrades the assertion (vs. silently
        // landing on the looser `folder_missing` from the mock FS).
        expectedReason: "forbidden_dotfolder",
        productionGapNote: "framework Gate 1 denylist (#358) independently rejects .obsidian/* even if a future caller bypasses the settings layer",
    },
    {
        id: "inject-drive-letter",
        description: "C:\\evil — Windows drive-letter prefix rejected by sync stage",
        reviewsFolder: "C:\\evil",
        // Sync gate catches `^[a-zA-Z]:` before normalize. Production-faithful.
        expectedReason: "drive_letter",
    },
    {
        id: "inject-path-too-long",
        description: "300-char filename — exceeds capability's maxPathLength: 200",
        reviewsFolder: ".pagelet",
        sourcePath: `${"a".repeat(300)}.md`,
        // Sync length check on the assembled candidate path.
        expectedReason: "path_too_long",
    },
] as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Pagelet prompt-injection fixtures (Track C · C2; SDD §8.3)", () => {
    it.each(SDD_8_3_FIXTURES)(
        "$id: $description → Gate 1 reject, no write, observer emits rejected_at_confinement",
        async (fixture) => {
            const adapter = makeAdapter();
            const settings: PageletSettings = {
                ...PAGELET_DEFAULTS,
                reviewsFolder: fixture.reviewsFolder,
            };
            const renderer = confirmingRenderer();
            const observer = recordingObserver();
            const fakeApp = { vault: { adapter } } as unknown as Parameters<typeof createPaReviewRuntime>[0]["app"];
            const runtime = createPaReviewRuntime({
                app: fakeApp,
                getPageletSettings: () => settings,
                previewRenderer: renderer,
                fsProbe: adapter as unknown as FsProbe,
                debugObserver: observer,
            });

            const input = makeInput(
                fixture.sourcePath ? { sourcePath: fixture.sourcePath } : {},
            );
            const result = await runtime.actionExecutor.execute(
                runtime.toolProvider.capability,
                input,
                makeContext(),
            );

            // ── Hard invariants ──────────────────────────────────────────
            expect(result.status).toBe("failed");
            expect(adapter.write).not.toHaveBeenCalled();
            // Renderer must NOT have been reached — the preview is a UX
            // surface for confirmed paths only. Showing it for a rejected
            // path would leak the rejected path to the user as if it were
            // legitimate.
            expect(renderer.calls).toBe(0);
            // The observer must record a single rejection at the
            // target-confinement gate. We don't constrain other events
            // (the framework emits no execute.* on this path).
            const rejects = observer.events.filter(
                (e) => e.type === "gate.target-confinement.reject"
                    && e.errorCategory === "rejected_at_confinement",
            );
            expect(rejects).toHaveLength(1);
            // B2 fix · Pin the framework's confinement reject reason.
            // Without this pin, a fixture that silently shifted from one
            // reason to another (e.g., `absolute_path` → `folder_missing`,
            // exposing the production gap noted in fixture metadata) would
            // still pass the generic `rejected_at_confinement` check.
            expect(rejects[0]?.extra?.reason).toBe(fixture.expectedReason);
            // execute.* MUST NOT fire — the framework stopped before the
            // execute span.
            const types = observer.events.map((e) => e.type);
            expect(types).not.toContain("execute.ok");
            expect(types).not.toContain("execute.fail");

            runtime.dispose();
        },
    );

    it("settings-layer validator stops `.obsidian/plugins/personal-assistant` BEFORE the framework ever sees it (H-B3.2 / PR #356 B2 fix)", async () => {
        // History: this test used to seed `.obsidian/plugins/personal-assistant`
        // as `reviewsFolder` and assert the framework wrote there happily —
        // a real production gap because `PaReviewToolProvider` derives
        // `targetConfinement.allowedRoots` directly from `settings.reviewsFolder`
        // (pa-review-tool-provider.ts:285-296), so Gate 1 would have nothing
        // to reject.
        //
        // The fix (shipped in v2.2.0-beta.1) lives at the settings boundary:
        // `normalizeReviewsFolder` in `src/settings/pagelet/index.ts` rejects
        // `.obsidian/` (and absolute paths / parent-traversal / drive letters
        // / control chars) up front, falling back to the `.pagelet` default
        // and surfacing an inline UI error. The capability shape is
        // unchanged — the boundary just never widens.
        //
        // This test now asserts the **two arms** of the new contract:
        //   1. The validator rejects the forbidden folder (returns default
        //      + error code) so nothing forbidden ever lands in the
        //      persisted settings.
        //   2. If a runtime is built from settings that went through
        //      `mergePageletSettings`, the framework receives `.pagelet`
        //      (not `.obsidian/...`) and writes there — i.e. the framework
        //      never even gets the chance to refuse, because the boundary
        //      already coerced.
        const forbidden = ".obsidian/plugins/personal-assistant";

        // ── Arm 1 — settings-layer rejection ─────────────────────────────
        const validation = normalizeReviewsFolder(forbidden);
        expect(validation.value).toBe(PAGELET_DEFAULTS.reviewsFolder);
        expect(validation.error).toBe("obsidian_config");
        expect(validation.input).toBe(forbidden);

        // The same path coming in through `mergePageletSettings` (the
        // data.json load boundary) also fails closed — a corrupted /
        // attacker-poisoned settings file cannot smuggle in a forbidden
        // root.
        const merged = mergePageletSettings({ reviewsFolder: forbidden });
        expect(merged.reviewsFolder).toBe(PAGELET_DEFAULTS.reviewsFolder);

        // ── Arm 2 — runtime built from coerced settings writes into the
        // safe default folder, never into `.obsidian/…`. We seed BOTH
        // `.obsidian/...` (so a regression that bypassed the validator
        // would also pass the FS-exists probe and surface the bug) AND the
        // default `.pagelet` folder (so the safe write path can land).
        const adapter = makeAdapter([forbidden, PAGELET_DEFAULTS.reviewsFolder]);
        const renderer = confirmingRenderer();
        const observer = recordingObserver();
        const fakeApp = { vault: { adapter } } as unknown as Parameters<typeof createPaReviewRuntime>[0]["app"];
        const runtime = createPaReviewRuntime({
            app: fakeApp,
            getPageletSettings: () => merged,
            previewRenderer: renderer,
            fsProbe: adapter as unknown as FsProbe,
            debugObserver: observer,
        });

        const result = await runtime.actionExecutor.execute(
            runtime.toolProvider.capability,
            makeInput({ sourcePath: "data.json" }),
            makeContext(),
        );

        expect(result.status).toBe("ok");
        expect(adapter.write).toHaveBeenCalledTimes(1);
        // The crux: the actually-written path lives under `.pagelet/`, NOT
        // under `.obsidian/...`, EVEN THOUGH the original input asked for
        // the forbidden folder. Settings layer scrubbed it BEFORE the
        // capability could derive an allowedRoot from it.
        const writtenPath = adapter.write.mock.calls[0]![0];
        expect(writtenPath.startsWith(`${PAGELET_DEFAULTS.reviewsFolder}/`)).toBe(true);
        expect(writtenPath).not.toContain(".obsidian");

        runtime.dispose();
    });

    it("benign control fixture (clean .pagelet/ target) still flows through to the renderer", async () => {
        // Without this control, all assertions above would also pass if
        // Gate 1 were *always* rejecting. The control proves the harness
        // is exercising the real gate (not a stuck-closed gate).
        const { runtime, adapter, renderer, observer } = buildRuntime();
        const result = await runtime.actionExecutor.execute(
            runtime.toolProvider.capability,
            makeInput(),
            makeContext(),
        );
        expect(result.status).toBe("ok");
        expect(adapter.write).toHaveBeenCalledTimes(1);
        expect(renderer.calls).toBe(1);
        const types = observer.events.map((e) => e.type);
        expect(types).toContain("execute.ok");
        runtime.dispose();
    });

    it("LLM-supplied sourcePath with absolute-path chars is sanitised, not rejected at Gate 1", async () => {
        // The sanitiser in `pa-review-file-io.ts:sanitizeSourceBaseName`
        // strips path separators + reserved chars from a source basename
        // BEFORE the framework's confinement gate sees the path. This is a
        // defence-in-depth contract: an LLM-coerced sourcePath like
        // `"/etc/passwd"` cannot reach the framework as a literal `/etc/...`
        // candidate. We assert the sanitised candidate is INSIDE the
        // allowed root so the framework treats it as a valid review-note
        // target, AND the file lands in `.pagelet/`, NOT at the malicious
        // location.
        const { runtime, adapter } = buildRuntime();
        const sanitisedTarget = runtime.toolProvider.capability.getTargetPath(
            makeInput({ sourcePath: "/etc/passwd" }),
        );
        expect(sanitisedTarget.startsWith(".pagelet/")).toBe(true);
        expect(sanitisedTarget.endsWith(".md")).toBe(true);

        const result = await runtime.actionExecutor.execute(
            runtime.toolProvider.capability,
            makeInput({ sourcePath: "/etc/passwd" }),
            makeContext(),
        );
        expect(result.status).toBe("ok");
        expect(adapter.write).toHaveBeenCalledTimes(1);
        // The actually-written path MUST be the sanitised one, NOT the raw
        // "/etc/passwd" the LLM injected.
        const writeCall = adapter.write.mock.calls[0]!;
        expect(writeCall[0]).toBe(sanitisedTarget);
        expect(writeCall[0]).not.toContain("/etc/");

        runtime.dispose();
    });

    it("framework rejects the long-path fixture for the documented length reason", async () => {
        // Cross-check on the `inject-path-too-long` fixture: the observer's
        // reject event should carry `extra.reason: "path_too_long"`. This
        // single-fixture deep-dive guards against a future refactor that
        // would silently widen the path-length cap.
        const adapter = makeAdapter();
        const settings: PageletSettings = {
            ...PAGELET_DEFAULTS,
            reviewsFolder: ".pagelet",
        };
        const observer = recordingObserver();
        const fakeApp = { vault: { adapter } } as unknown as Parameters<typeof createPaReviewRuntime>[0]["app"];
        const runtime = createPaReviewRuntime({
            app: fakeApp,
            getPageletSettings: () => settings,
            previewRenderer: confirmingRenderer(),
            fsProbe: adapter as unknown as FsProbe,
            debugObserver: observer,
        });

        await runtime.actionExecutor.execute(
            runtime.toolProvider.capability,
            makeInput({ sourcePath: `${"a".repeat(300)}.md` }),
            makeContext(),
        );
        const reject = observer.events.find(
            (e) => e.type === "gate.target-confinement.reject",
        );
        expect(reject?.extra?.reason).toBe("path_too_long");

        runtime.dispose();
    });
});

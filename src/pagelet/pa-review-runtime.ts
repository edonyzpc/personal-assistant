/* Copyright 2023 edonyzpc */

/**
 * Pagelet — Write Action Framework runtime composer.
 *
 * Sits between {@link createPaReviewToolProvider} (the capability declaration)
 * and the plugin shell (`src/plugin.ts`). The plugin treats this as the single
 * owner of Pagelet's framework wiring:
 *
 *   - One {@link SelfWriteRegistry} per plugin instance (5s TTL per SDD §5.3).
 *   - One {@link ActionExecutor} that orchestrates the 4-gate write lifecycle
 *     (target-confinement → preview → stale-reread → executeWrite).
 *   - One {@link PreviewRenderer} mounted against the Obsidian `App` so the
 *     mutex helper can serialize concurrent confirm modals (SDD §5.2).
 *   - One {@link PaReviewToolProvider} singleton that the {@link ActionExecutor}
 *     drives whenever the Pagelet review pipeline needs to persist a note.
 *
 * Why this lives in `src/pagelet/` (NOT `src/ai-services/`):
 *  - The Write Action Framework is generic; Pagelet's review semantics are
 *    not. Keeping the composer next to the capability description prevents
 *    `pa-agent-runtime.ts` from accumulating Pagelet-shaped knobs.
 *  - The plugin only imports this module — never the framework internals.
 *
 * Why the external SelfWriteRegistry (rather than re-using PaAgentRuntime's
 * private one):
 *  - `PaAgentRuntime` keeps its registry private (see lines 705-706 there)
 *    and is constructed per-turn by `chat-service.ts`, so its lifetime is
 *    shorter than the plugin. Pagelet's reentrancy guard must outlive any
 *    individual review turn (a vault `modify` ripple can fire seconds after
 *    the write returns), so the registry must live at the plugin layer.
 *  - The plugin's `vault.on("modify")` listener consults
 *    {@link PaReviewRuntime.isRecentSelfWrite} to suppress its own writes
 *    without ever touching the framework internals.
 *  - We keep both registries in sync by passing the external
 *    {@link SelfWriteRegistry.markSelfWrite} into the provider via
 *    {@link CreatePaReviewToolProviderOptions.externalMarkSelfWrite}; the
 *    provider's `executeWrite` calls BOTH the framework hook (refreshes the
 *    internal TTL) and the external marker (drives the plugin's listener).
 *
 * What this file does NOT do:
 *  - Run the LLM. {@link PageletReviewModel} (B1) owns that.
 *  - Manage rate limits / cost. {@link PageletCostTracker} +
 *    {@link PageletRateLimiter} (B4) do.
 *  - Render suggestion cards. {@link buildSuggestionCardMarkup} (B5) does.
 *  - Decide WHEN to invoke a review. The plugin's command and UI callbacks
 *    own that.
 */

import type { App } from "obsidian";

import {
    ConsoleDebugObserver,
    createActionExecutor,
    createSelfWriteRegistry,
    createDefaultObsidianPreviewRenderer,
    NOOP_DEBUG_OBSERVER,
    SELF_WRITE_WINDOW_MS,
    type ActionExecutor,
    type DebugObserver,
    type FsProbe,
    type PreviewRenderer,
} from "../ai-services/write-action-framework";
import type { PageletLocale } from "../locales/pagelet";
import type { PageletSettings } from "../settings/pagelet";

import {
    createPaReviewToolProvider,
    type PaReviewToolProvider,
    type PageletReviewToolSettings,
    type PageletReviewToolVaultLike,
} from "./pa-review-tool-provider";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Read-only view of the Pagelet write-action wiring. Exposed for the plugin
 * shell + tests; never returned to capability authors (they get
 * {@link WriteActionExecuteHooks} from the framework instead).
 */
export interface PaReviewRuntime {
    /** The singleton capability provider Pagelet registers. */
    readonly toolProvider: PaReviewToolProvider;
    /**
     * Drive a write through the 4-gate orchestrator. The Pagelet review
     * pipeline calls this once it has a {@link PageletReviewResult} and the
     * user-visible suggestion card has been built (B5). The framework also
     * uses this when the planner ever decides to invoke
     * {@link PAGELET_WRITE_REVIEW_OUTPUT_NAME} from an agent loop.
     */
    readonly actionExecutor: ActionExecutor;
    /**
     * Identical to {@link SelfWriteRegistry.isRecentSelfWrite}; aliased so the
     * plugin's modify listener can take a stable function reference without
     * holding the registry directly.
     */
    isRecentSelfWrite(path: string): boolean;
    /**
     * Build the options bundle a chat-style runtime (`PaAgentRuntime`) needs
     * to register Pagelet in review mode. Returned as a value so callers can
     * spread it into a `new PaAgentRuntime(...)` invocation without having
     * to know which fields to forward.
     *
     * NOTE: This bundle's `additionalCapabilityProviders` contains the SAME
     * provider singleton this runtime owns. Registering the provider on
     * multiple registries is safe — the provider is stateless apart from the
     * `getSettings` getter, and the framework guarantees only one ActionExecutor
     * mutates the registry's TTL state.
     */
    buildPaAgentRuntimeOptions(): PaReviewPaAgentOptionsBundle;
    /**
     * Release per-runtime resources. MUST be called from the plugin's
     * `onunload` so the 5s TTL timers held by the external
     * {@link SelfWriteRegistry} don't keep Node alive after a hot-reload.
     */
    dispose(): void;
    /** Diagnostic snapshot of currently-tracked self-write paths. */
    selfWriteSnapshot(): string[];
}

/**
 * Shape returned by {@link PaReviewRuntime.buildPaAgentRuntimeOptions}.
 * Matches the slice of `PaAgentRuntimeOptions` callers need to spread.
 *
 * Kept as a structural type (not an import) so this module stays free of
 * the heavy `pa-agent-runtime.ts` dependency tree at import time.
 */
export interface PaReviewPaAgentOptionsBundle {
    policyOptions: {
        runKind: "review";
        allowWrite: true;
        allowedActionPermissions: ["local-filesystem-write"];
    };
    writeAction: {
        previewRenderer: PreviewRenderer;
        fsProbe?: FsProbe;
        debugObserver: DebugObserver;
    };
    additionalCapabilityProviders: readonly [PaReviewToolProvider];
}

/**
 * Factory options for {@link createPaReviewRuntime}.
 *
 * `getPageletSettings` is invoked on every read (capability targetConfinement
 * derivation, executeWrite path resolution) so the user can edit
 * `reviewsFolder` without re-instantiating the runtime.
 *
 * `getLocale` defaults to `"en"`; passing the plugin's UI locale getter keeps
 * the preview modal's confirm/cancel labels in sync with the rest of the UI.
 *
 * `debugObserver` and `fsProbe` give tests a seam to inject deterministic
 * doubles; production callers should pass the defaults
 * ({@link createDefaultObsidianPreviewRenderer} + `app.vault.adapter`).
 */
export interface CreatePaReviewRuntimeOptions {
    app: App;
    getPageletSettings: () => PageletSettings;
    getLocale?: () => PageletLocale;
    /**
     * Optional override for the Obsidian-backed preview renderer. Defaults to
     * {@link createDefaultObsidianPreviewRenderer}(`app`). Tests substitute a
     * recording renderer to drive the 4-gate orchestrator without rendering
     * real Obsidian modals.
     */
    previewRenderer?: PreviewRenderer;
    /**
     * Optional override for the FS probe (Gate 1 + Gate 3 + create-file
     * rollback). Defaults to `app.vault.adapter`. Set to `null` to opt out
     * (Gate 3 short-circuits as success; recommended only for test runs).
     */
    fsProbe?: FsProbe | null;
    /**
     * Optional override for the DebugObserver. Defaults to
     * {@link ConsoleDebugObserver} when the plugin runs in debug mode, else
     * {@link NOOP_DEBUG_OBSERVER}. Tests typically pass a recording observer.
     */
    debugObserver?: DebugObserver;
    /**
     * Toggle for the default observer fallback. Has no effect when an
     * explicit `debugObserver` is supplied. The plugin passes
     * `plugin.settings.debug`.
     */
    debug?: boolean;
    /**
     * Optional override for the self-write TTL window. Defaults to
     * {@link SELF_WRITE_WINDOW_MS} (5s, per framework SDD §5.3). Tests
     * shorten this to keep timer accounting fast.
     */
    selfWriteWindowMs?: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a {@link PaReviewRuntime}. Caller responsibilities:
 *
 *   - Hold the returned runtime for the lifetime of the plugin.
 *   - Wire {@link PaReviewRuntime.isRecentSelfWrite} into the plugin's
 *     `vault.on("modify")` listener BEFORE the listener forwards the event
 *     downstream (so the suppression is observable to all downstream
 *     consumers, not just one).
 *   - Call {@link PaReviewRuntime.dispose} from the plugin's `onunload` hook.
 *
 * Construction is cheap (no async work, no timer setup until the first
 * `markSelfWrite`); safe to call lazily when the first review is triggered.
 */
export function createPaReviewRuntime(
    options: CreatePaReviewRuntimeOptions,
): PaReviewRuntime {
    const { app } = options;

    // External self-write registry. Lives at the plugin layer because the
    // modify-event ripple can outlive any individual review turn and the
    // PaAgentRuntime-internal registry has a per-turn lifetime.
    const externalSelfWrite = createSelfWriteRegistry(
        options.selfWriteWindowMs !== undefined
            ? { windowMs: options.selfWriteWindowMs }
            : {},
    );

    // The provider singleton. We thread the external markSelfWrite hook so
    // the provider's executeWrite marks the plugin-facing registry in
    // addition to the framework's internal one.
    const settingsView: () => PageletReviewToolSettings = () => ({
        reviewsFolder: options.getPageletSettings().reviewsFolder,
    });
    const vault: PageletReviewToolVaultLike = app.vault;
    const toolProvider = createPaReviewToolProvider({
        getSettings: settingsView,
        vault,
        ...(options.getLocale ? { getLocale: options.getLocale } : {}),
        externalMarkSelfWrite: (path: string) => externalSelfWrite.markSelfWrite(path),
    });

    // Preview renderer — mutex-wrapped Obsidian modal by default.
    const previewRenderer = options.previewRenderer ?? createDefaultObsidianPreviewRenderer(app);

    // FS probe — Obsidian's adapter satisfies the FsProbe shape (exists +
    // remove). Explicit `null` opt-out so tests can run without a probe.
    const fsProbe: FsProbe | undefined = options.fsProbe === null
        ? undefined
        : (options.fsProbe ?? (app.vault.adapter as unknown as FsProbe));

    // Debug observer — Console when debug=true, NOOP otherwise. Caller
    // override always wins.
    const debugObserver: DebugObserver = options.debugObserver
        ?? (options.debug ? new ConsoleDebugObserver() : NOOP_DEBUG_OBSERVER);

    // ActionExecutor — drives the 4-gate orchestrator. We pass our external
    // SelfWriteRegistry so the framework's internal mark/refresh ops AND our
    // provider's mark op converge on the same TTL state. Test runs that want
    // to inspect the internal vs external distinction can construct two
    // executors and compare snapshots.
    const actionExecutor = createActionExecutor({
        previewRenderer,
        ...(fsProbe ? { fsProbe } : {}),
        selfWrite: externalSelfWrite,
        debugObserver,
    });

    const runtime: PaReviewRuntime = {
        toolProvider,
        actionExecutor,
        isRecentSelfWrite(path: string): boolean {
            return externalSelfWrite.isRecentSelfWrite(path);
        },
        buildPaAgentRuntimeOptions(): PaReviewPaAgentOptionsBundle {
            return {
                policyOptions: {
                    runKind: "review",
                    allowWrite: true,
                    allowedActionPermissions: ["local-filesystem-write"],
                },
                writeAction: {
                    previewRenderer,
                    ...(fsProbe ? { fsProbe } : {}),
                    debugObserver,
                },
                additionalCapabilityProviders: [toolProvider] as const,
            };
        },
        dispose(): void {
            externalSelfWrite.dispose();
        },
        selfWriteSnapshot(): string[] {
            return externalSelfWrite.snapshot();
        },
    };
    return runtime;
}

// Re-export framework constants Pagelet callers may need without forcing
// them to know the framework's path layout.
export { SELF_WRITE_WINDOW_MS };

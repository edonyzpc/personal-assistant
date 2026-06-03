/* Copyright 2023 edonyzpc */

/**
 * Pagelet — Write Action Framework v1 capability provider (Track C · C1).
 *
 * Wires Pagelet's review-note writer into the Write Action Framework v1
 * 4-gate orchestrator (`src/ai-services/write-action-framework/**`). The
 * framework guarantees that any write through this capability flows through:
 *
 *   Gate 1 (target-confinement) → Gate 2 (preview modal) →
 *   Gate 3 (stale re-read)      → executeWrite
 *
 * What lives here:
 *  - {@link PaReviewToolProvider} — `CapabilityProvider` that exposes exactly
 *    one `WriteActionCapability` named `pagelet.write_review_output`.
 *  - {@link createPaReviewToolProvider} — factory accepting settings/IO seams.
 *  - The capability implementation itself (kept inline so the file is a
 *    self-contained read).
 *
 * What this file does NOT do:
 *  - Construct the framework's `ActionExecutor`. The runtime caller (see
 *    `pa-review-runtime.ts`) owns that. We only describe the capability.
 *  - Mutate global state. Each `load()` call returns a fresh capability
 *    array bound to the same singleton; the framework calls `execute()` only
 *    via `ActionExecutor`, never directly.
 *  - Cost / rate-limit gating. That happens upstream inside `PageletReviewModel`
 *    BEFORE `reviewResult` is materialized — by the time we get here, the LLM
 *    call has already happened, so `impact.usesAiProvider = false`.
 *
 * Design notes worth flagging:
 *  - `getTargetPath` MUST be sync + pure. We resolve via `resolveReviewNotePath`
 *    (B6 helper, already pure). The framework asserts
 *    `spec.target.displayPath === getTargetPath(input)`; both flow through
 *    `resolveReviewNotePath`, so they cannot drift.
 *  - `executeWrite` calls `hooks.markSelfWrite(path)` BEFORE `vault.adapter.write`
 *    (B6's `writeReviewNote` already supports the hook). The framework refreshes
 *    the TTL on success; we belt-and-suspenders mark proactively to suppress
 *    the modify-event ripple.
 *  - `execute()` MUST throw — the framework SDD §3.2 invariant. Calling
 *    `execute` directly would bypass all 4 gates; we make that loud.
 */

import type { App, TFile } from "obsidian";

import type {
    AgentCapabilityContext,
    AgentCapabilityResult,
    CapabilityProvider,
    ProviderLoadContext,
    ProviderLoadResult,
} from "../ai-services/capability-types";
import type {
    ChatToolName,
    ChatToolPermission,
    ChatToolSourceBoundary,
} from "../ai-services/chat-tools";
import type { SourceRecordKind } from "../ai-services/chat-types";
import type {
    PreviewSpec,
    WriteActionCapability,
    WriteActionExecuteHooks,
} from "../ai-services/write-action-framework";
import { pageletT, type PageletLocale } from "../locales/pagelet";
import type { PageletSettings } from "../settings/pagelet";

import {
    assembleReviewNote,
    buildReviewMetadata,
    formatPageletIsoTimestamp,
    normalizeReviewsFolder as normalizePageletReviewsFolder,
    resolveReviewNotePath,
    writeReviewNote,
    type PageletReviewFileIOSettings,
    type PageletReviewIOAdapter,
} from "./pa-review-file-io";
import {
    type PageletLanguageCode,
    type PageletReviewMetadata,
    type PageletReviewResult,
} from "./pa-review-schemas";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Stable capability name. Matches the identifier the framework spec / debug
 * observer tests reference (see `write-action-framework/debug-observer.spec.ts`).
 * The `pagelet.*` namespace prefix avoids collisions with PA's chat tools.
 */
export const PAGELET_WRITE_REVIEW_OUTPUT_NAME = "pagelet.write_review_output" as const;

/**
 * Stable provider id used by `CapabilityRegistry` for telemetry / dedupe.
 * Mirrors the `pa-pagelet` data-plugin attribute used in DOM markup.
 */
export const PAGELET_PROVIDER_ID = "pa-pagelet" as const;

/**
 * Per-capability path length cap. Framework's default is 200; pagelet stems
 * can grow long (CJK sanitized names + date suffix + collision suffix), so
 * we anchor explicitly even though the value matches the framework default.
 */
const PAGELET_MAX_PATH_LENGTH = 200;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Input shape this capability accepts. Distinct from `PageletReviewInput`
 * (which describes the LLM input): by the time we reach the write capability
 * the LLM has already produced a `PageletReviewResult`, and we ALSO need
 * the metadata fields (mode, language, costUsd) that the SuggestionCard
 * carries alongside the result.
 *
 * The runtime caller (`PaReviewRuntime`) builds this struct from the
 * `PageletReviewOutcome` + per-trigger context (source note path, settings).
 */
export interface PageletWriteReviewOutputInput {
    /** Source note vault-relative path. */
    sourcePath: string;
    /** Validated LLM review result (B1 schema). */
    reviewResult: PageletReviewResult;
    /** "basic" or "deeper" — surfaces in frontmatter. */
    mode: PageletReviewMetadata["pagelet_mode"];
    /** Detected note language (B1). */
    detectedLanguage: PageletLanguageCode;
    /** Optional cost recorded for this review (D022). */
    costUsd?: number;
    /** Optional provider id for frontmatter (e.g., "qwen"). */
    provider?: string;
    /** Optional model id for frontmatter (e.g., "qwen-plus"). */
    model?: string;
    /**
     * Optional injected date — defaults to `new Date()`. Tests use this for
     * deterministic filenames; scheduled-review prototypes can lean on it.
     */
    dateOverride?: Date;
    /**
     * Optional injected ISO-8601 timestamp for `pagelet_created_at`. When
     * omitted the writer derives one from `dateOverride ?? new Date()` via
     * `formatPageletIsoTimestamp` (UTC `+00:00`).
     */
    nowIso?: () => string;
}

/**
 * Settings slice the provider reads. Independent from the full
 * `PageletSettings` so callers can pass a literal in tests, and so a future
 * settings refactor can adjust the surface without touching this module.
 */
export type PageletReviewToolSettings = PageletReviewFileIOSettings;

/**
 * Vault accessor we depend on. Real `App['vault']` satisfies it (via
 * structural compatibility); tests can pass a recording stub.
 */
export interface PageletReviewToolVaultLike {
    adapter: PageletReviewIOAdapter;
}

/**
 * Factory options for {@link createPaReviewToolProvider}.
 *
 * `getSettings` returns the most-recent settings each load. Wrapping it as a
 * getter (rather than capturing at construction) lets the user tweak
 * `reviewsFolder` without re-instantiating the provider.
 *
 * `getLocale` defaults to `"en"` when omitted; the provider only reads it
 * for the `confirmCopy` labels rendered inside the framework's preview modal.
 */
export interface CreatePaReviewToolProviderOptions {
    getSettings: () => PageletReviewToolSettings;
    vault: PageletReviewToolVaultLike;
    getLocale?: () => PageletLocale;
    /**
     * Optional override for the i18n loader. Defaults to the shared
     * `pageletT`; tests can pass a recording stub to assert label resolution
     * without exercising the JSON dictionary.
     */
    translator?: (key: string, locale: PageletLocale) => string;
    /**
     * Optional hook the provider calls in addition to `hooks.markSelfWrite`
     * during `executeWrite`. The Pagelet runtime (`pa-review-runtime.ts`)
     * passes its plugin-facing {@link SelfWriteRegistry.markSelfWrite} here
     * so the plugin's `vault.on("modify")` reentrancy guard sees the path,
     * not just the framework's internal per-turn registry.
     *
     * Called BEFORE the actual `vault.adapter.write` (mirrors the timing of
     * the framework hook). Safe to omit when the provider is exercised in
     * isolation (e.g., unit tests without a runtime).
     */
    externalMarkSelfWrite?: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Capability implementation
// ---------------------------------------------------------------------------

interface ResolvedCapabilityContext {
    settings: PageletReviewToolSettings;
    vault: PageletReviewToolVaultLike;
    locale: PageletLocale;
    translate: (key: string, locale: PageletLocale) => string;
    externalMarkSelfWrite?: (path: string) => void;
}

function resolveContext(opts: CreatePaReviewToolProviderOptions): ResolvedCapabilityContext {
    return {
        settings: opts.getSettings(),
        vault: opts.vault,
        locale: opts.getLocale ? opts.getLocale() : "en",
        translate: opts.translator ?? pageletT,
        ...(opts.externalMarkSelfWrite ? { externalMarkSelfWrite: opts.externalMarkSelfWrite } : {}),
    };
}

/**
 * Parse + minimally validate the runtime input. Kept loose because
 * `PageletReviewInputSchema` describes the LLM input shape, not the writer
 * input shape; the writer fields are simpler so we do explicit guards.
 */
function parseWriteInput(input: unknown): PageletWriteReviewOutputInput {
    if (!input || typeof input !== "object") {
        throw new TypeError("pagelet.write_review_output input must be an object");
    }
    const candidate = input as Record<string, unknown>;
    const sourcePath = candidate.sourcePath;
    if (typeof sourcePath !== "string" || sourcePath.length === 0) {
        throw new TypeError("pagelet.write_review_output input.sourcePath must be a non-empty string");
    }
    const reviewResult = candidate.reviewResult;
    if (!reviewResult || typeof reviewResult !== "object") {
        throw new TypeError("pagelet.write_review_output input.reviewResult must be an object");
    }
    const mode = candidate.mode;
    if (mode !== "basic" && mode !== "deeper") {
        throw new TypeError("pagelet.write_review_output input.mode must be \"basic\" or \"deeper\"");
    }
    const detectedLanguage = candidate.detectedLanguage;
    if (detectedLanguage !== "zh" && detectedLanguage !== "en") {
        throw new TypeError("pagelet.write_review_output input.detectedLanguage must be \"zh\" or \"en\"");
    }
    return {
        sourcePath,
        reviewResult: reviewResult as PageletReviewResult,
        mode,
        detectedLanguage,
        ...(typeof candidate.costUsd === "number" ? { costUsd: candidate.costUsd } : {}),
        ...(typeof candidate.provider === "string" ? { provider: candidate.provider } : {}),
        ...(typeof candidate.model === "string" ? { model: candidate.model } : {}),
        ...(candidate.dateOverride instanceof Date ? { dateOverride: candidate.dateOverride } : {}),
        ...(typeof candidate.nowIso === "function" ? { nowIso: candidate.nowIso as () => string } : {}),
    };
}

/**
 * Pure helper — used by both `getTargetPath` (Gate 1) and `buildPreview`
 * (Gate 2) so the two paths cannot drift. The framework asserts they match.
 *
 * Reads ONLY from the input + settings; never touches the vault adapter or
 * FS. This is the synchronous contract Gate 1 requires.
 */
function computeTargetPath(
    input: PageletWriteReviewOutputInput,
    settings: PageletReviewToolSettings,
): string {
    return resolveReviewNotePath({
        sourcePath: input.sourcePath,
        settings,
        date: input.dateOverride ?? new Date(),
    });
}

/**
 * Derive the per-capability confinement config from settings. The folder
 * is dynamic (D010) — if the user picks a non-default reviewsFolder we
 * MUST update the allowlist so the path passes Gate 1.
 *
 * `allowedRoots` always includes the configured folder; we deliberately do
 * NOT also include `.pagelet/` as a fallback because that would silently
 * allow writes outside the user's intended folder.
 */
function buildConfinement(settings: PageletReviewToolSettings): {
    allowedRoots: string[];
    allowedExtensions: string[];
    maxPathLength: number;
} {
    const folder = normalizePageletReviewsFolder(settings.reviewsFolder);
    return {
        allowedRoots: [`${folder}/`],
        allowedExtensions: [".md"],
        maxPathLength: PAGELET_MAX_PATH_LENGTH,
    };
}

/**
 * Build the typed PreviewSpec (framework SDD §2.1).
 *
 * The body is assembled via B6's helpers so it byte-for-byte matches what
 * `writeReviewNote` will persist. `byteSize` is computed against the same
 * body string so the modal's "writes N bytes" indicator never lies.
 */
function buildPreviewSpec(
    input: PageletWriteReviewOutputInput,
    settings: PageletReviewToolSettings,
    translate: ResolvedCapabilityContext["translate"],
    locale: PageletLocale,
): PreviewSpec {
    const targetPath = computeTargetPath(input, settings);
    const lastSlash = targetPath.lastIndexOf("/");
    const folder = lastSlash >= 0 ? targetPath.substring(0, lastSlash + 1) : "";
    const filename = lastSlash >= 0 ? targetPath.substring(lastSlash + 1) : targetPath;

    const isoTimestamp = input.nowIso
        ? input.nowIso()
        : formatPageletIsoTimestamp(input.dateOverride ?? new Date());
    const metadata = buildReviewMetadata({
        sourcePath: input.sourcePath,
        mode: input.mode,
        detectedLanguage: input.detectedLanguage,
        createdAtIso: isoTimestamp,
        ...(typeof input.costUsd === "number" ? { costUsd: input.costUsd } : {}),
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.model ? { model: input.model } : {}),
    });
    const body = assembleReviewNote(metadata, input.reviewResult);
    const byteSize = Buffer.byteLength(body, "utf8");

    return {
        operationType: "create-file",
        actionFamily: "create-file",
        capabilityId: PAGELET_WRITE_REVIEW_OUTPUT_NAME,
        target: {
            kind: "vault-path",
            displayPath: targetPath,
            folder,
            filename,
        },
        contentPreview: {
            format: "markdown",
            body,
            byteSize,
        },
        impact: {
            // The LLM call already happened upstream inside PageletReviewModel
            // before the trigger flow reached the framework. The write
            // capability itself is offline.
            usesAiProvider: false,
            usesAiCredits: false,
            // Vault writes are local-only; no network / external state mutation.
            affectsExternalState: false,
        },
        riskNotes: [],
        confirmCopy: {
            confirmLabel: translate("pagelet.preview.confirm", locale),
            cancelLabel: translate("pagelet.preview.cancel", locale),
        },
    };
}

/**
 * Build the singleton `WriteActionCapability` instance. Capability is
 * stateless apart from the captured `ctxRef` getter; safe to register once
 * per runtime + reuse across many invocations.
 */
function buildCapability(opts: CreatePaReviewToolProviderOptions): WriteActionCapability {
    const ctxOf = () => resolveContext(opts);

    const capability: WriteActionCapability = {
        // ── AgentCapability surface ─────────────────────────────────────
        name: PAGELET_WRITE_REVIEW_OUTPUT_NAME as ChatToolName,
        description: "Persist a Pagelet review note via the Write Action Framework v1.",
        inputSchema: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
        },
        plannerGuidance: [],
        kind: "action",
        origin: "core",
        providerId: PAGELET_PROVIDER_ID,
        permission: "local-filesystem-write",
        sourceBoundary: "vault",
        cost: "free",
        platform: "both",
        outputBudgetChars: 0,
        timeoutMs: 30_000,
        requiresConfirmation: true,
        executionMode: "sequential",
        failureBehavior: "recoverable",
        statusMessageText: "Writing Pagelet review",
        sourceRecordKind: "context-used" satisfies SourceRecordKind,

        // ── WriteActionCapability surface ───────────────────────────────
        actionFamily: "create-file",
        targetCategory: "pagelet-review-note",
        get targetConfinement() {
            // Derive on every read so a settings change (reviewsFolder) is
            // picked up without re-instantiating the capability.
            return buildConfinement(ctxOf().settings);
        },

        toProviderSchema: () => ({
            type: "function",
            function: {
                name: PAGELET_WRITE_REVIEW_OUTPUT_NAME,
                description: "Persist a Pagelet review note via the Write Action Framework v1.",
                parameters: {
                    type: "object",
                    properties: {},
                    required: [],
                    additionalProperties: false,
                },
            },
        }),
        toRegistryDefinition: () => ({
            name: PAGELET_WRITE_REVIEW_OUTPUT_NAME as ChatToolName,
            description: "Persist a Pagelet review note via the Write Action Framework v1.",
            inputSchema: {
                type: "object",
                properties: {},
                required: [],
                additionalProperties: false,
            },
            plannerGuidance: [],
            // CapabilityRegistry definition pre-dates write tiers; map to the
            // closest valid ChatToolPermission. PolicyEngine.canExecute
            // re-checks the AgentCapability.permission field (the write tier
            // above) — this registry-definition value is for the legacy chat
            // schema export and never gates the write itself.
            permission: "read-only" as ChatToolPermission,
            cost: "free",
            outputBudgetChars: 0,
            requiresConfirmation: true,
            failureBehavior: "recoverable",
            statusMessage: "Writing Pagelet review",
            sourceBoundary: "read-only-tool" as ChatToolSourceBoundary,
        }),

        // ── Framework gates ─────────────────────────────────────────────
        getTargetPath(rawInput: unknown): string {
            // Sync + pure: validate the input shape and resolve the path.
            // The framework reads this BEFORE buildPreview to fail-fast on
            // out-of-allowlist paths without rendering anything.
            const parsed = parseWriteInput(rawInput);
            return computeTargetPath(parsed, ctxOf().settings);
        },

        async buildPreview(rawInput: unknown, _context: AgentCapabilityContext): Promise<PreviewSpec> {
            const parsed = parseWriteInput(rawInput);
            const ctx = ctxOf();
            return buildPreviewSpec(parsed, ctx.settings, ctx.translate, ctx.locale);
        },

        async executeWrite(
            rawInput: unknown,
            _context: AgentCapabilityContext,
            hooks: WriteActionExecuteHooks,
        ): Promise<AgentCapabilityResult> {
            const parsed = parseWriteInput(rawInput);
            const ctx = ctxOf();
            // Compose markSelfWrite so both the framework's per-turn registry
            // (`hooks.markSelfWrite`) AND the plugin-facing external registry
            // (when wired via `options.externalMarkSelfWrite`) see the same
            // path. Called BEFORE the actual `vault.adapter.write` inside
            // `writeReviewNote` (B6 honors `input.markSelfWrite?.(finalPath)`).
            const composedMarkSelfWrite = ctx.externalMarkSelfWrite
                ? (path: string) => {
                    hooks.markSelfWrite(path);
                    ctx.externalMarkSelfWrite?.(path);
                }
                : hooks.markSelfWrite;
            const writeResult = await writeReviewNote({
                sourcePath: parsed.sourcePath,
                reviewResult: parsed.reviewResult,
                settings: ctx.settings,
                vault: ctx.vault,
                mode: parsed.mode,
                detectedLanguage: parsed.detectedLanguage,
                ...(parsed.dateOverride ? { dateOverride: parsed.dateOverride } : {}),
                ...(typeof parsed.costUsd === "number" ? { costUsd: parsed.costUsd } : {}),
                ...(parsed.provider ? { provider: parsed.provider } : {}),
                ...(parsed.model ? { model: parsed.model } : {}),
                ...(parsed.nowIso ? { nowIso: parsed.nowIso } : {}),
                markSelfWrite: composedMarkSelfWrite,
            });

            return {
                status: "ok",
                observation: {
                    createdPath: writeResult.path,
                    created: writeResult.created,
                    metadata: writeResult.metadata,
                },
                sourceRecords: [
                    {
                        kind: "context-used",
                        dedupKey: `pagelet:${writeResult.path}`,
                        capabilityName: PAGELET_WRITE_REVIEW_OUTPUT_NAME,
                        providerId: PAGELET_PROVIDER_ID,
                        sourceBoundary: "vault",
                        path: writeResult.path,
                        title: writeResult.path,
                        citationEligible: false,
                        statusOnly: true,
                    },
                ],
                inputSummary: `pagelet review for ${parsed.sourcePath}`,
                sources: [],
            };
        },

        async execute(_input: unknown, _context: AgentCapabilityContext): Promise<AgentCapabilityResult> {
            // Framework SDD §3.2 invariant: never call execute() directly.
            // ActionExecutor drives capability.executeWrite via the 4 gates.
            throw new Error(
                "pagelet.write_review_output.execute() must not be invoked directly — "
                + "route through the Write Action Framework's ActionExecutor "
                + "(see src/ai-services/write-action-framework/runtime-integration.ts).",
            );
        },
    };
    return capability;
}

// ---------------------------------------------------------------------------
// CapabilityProvider
// ---------------------------------------------------------------------------

/**
 * `CapabilityProvider` wrapper. Returns the singleton capability on every
 * `load()` so the registry can rebuild its catalog without re-instantiating
 * the underlying writer.
 *
 * Pagelet is gated by `settings.pagelet.enabled` upstream (the runtime
 * checks before constructing the provider), so the provider itself always
 * reports `available`. If the runtime decides to disable Pagelet, it simply
 * stops registering this provider.
 */
export interface PaReviewToolProvider extends CapabilityProvider {
    /** The capability instance held by this provider — exposed for tests. */
    readonly capability: WriteActionCapability;
}

export function createPaReviewToolProvider(
    options: CreatePaReviewToolProviderOptions,
): PaReviewToolProvider {
    const capability = buildCapability(options);
    return {
        id: PAGELET_PROVIDER_ID,
        displayName: "Pagelet review writer",
        required: false,
        kind: "tool-provider",
        platform: "both",
        capability,
        async load(_context: ProviderLoadContext): Promise<ProviderLoadResult> {
            return {
                status: "available",
                capabilities: [capability],
            };
        },
        async execute(
            name: string,
            input: unknown,
            context: AgentCapabilityContext,
        ): Promise<AgentCapabilityResult> {
            // The framework's ActionExecutor calls capability.executeWrite
            // directly (not provider.execute). This provider.execute path is
            // reserved for non-action capabilities; for our write capability,
            // dispatching here would skip Gate 1-3, so we surface the
            // mistake loudly rather than silently writing.
            if (name === PAGELET_WRITE_REVIEW_OUTPUT_NAME) {
                throw new Error(
                    "pagelet.write_review_output must be executed via the Write Action Framework "
                    + "(ActionExecutor.execute), not CapabilityProvider.execute.",
                );
            }
            throw new Error(`Unknown capability ${name} for provider ${PAGELET_PROVIDER_ID}.`);
        },
    };
}

// ---------------------------------------------------------------------------
// Convenience helper for Obsidian-backed callers
// ---------------------------------------------------------------------------

/**
 * Construct a {@link PaReviewToolProvider} bound to an Obsidian `App` and
 * full `PageletSettings` snapshot. The plugin's onload site uses this
 * helper; standalone callers (e.g., tests with a mock vault) can call
 * {@link createPaReviewToolProvider} directly with a literal settings slice.
 */
export function createPaReviewToolProviderForApp(
    app: App,
    getPageletSettings: () => PageletSettings,
    getLocale?: () => PageletLocale,
): PaReviewToolProvider {
    return createPaReviewToolProvider({
        getSettings: () => ({ reviewsFolder: getPageletSettings().reviewsFolder }),
        vault: app.vault,
        ...(getLocale ? { getLocale } : {}),
    });
}

// Re-export for tests that need to inspect the helper used by both gates.
export { computeTargetPath as __computeTargetPathForTest };

// Suppress unused-warning sentinel: TFile is referenced from doc-strings only,
// kept in scope so future "trigger from active TFile" helpers can import the
// type without re-introducing the obsidian dependency.
type _TFileSentinel = TFile;
void (null as unknown as _TFileSentinel);

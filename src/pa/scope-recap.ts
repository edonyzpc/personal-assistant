import {
    hasForbiddenPersistedTextFields,
    validateSourceRefPathShape,
    type GeneratedReviewNote,
    type PersistedSourceRef,
    type ReviewQueueScope,
} from "./contracts";
import { normalizeVaultPath, stableHash, cloneSourceRef } from "./helpers";

export type ScopeRecapSectionType = "summary" | "theme" | "tension" | "open_question" | "next_review_action";
export type ScopeRecapStaleStatus = "fresh" | "stale" | "low-coverage" | "boundary-changed";

export interface ScopeRecapSourceNote {
    path: string;
    title?: string;
    content?: string;
    tags?: readonly string[];
    modifiedAt?: string;
    isGenerated?: boolean;
    sourceRefs?: readonly PersistedSourceRef[];
    /** Local adapter classification for candidates intentionally not transferred. */
    skipReason?: ScopeRecapSkippedSource["reason"];
    /** Non-sensitive aggregate label shown with the skipped count. */
    skipLabel?: string;
}

export interface ScopeRecapSkippedSource {
    reason: "data_boundary" | "generated_source" | "unreadable" | "out_of_scope";
    count: number;
    label: string;
}

export interface ScopeRecapCoverage {
    totalSourceCount: number;
    includedSourceCount: number;
    skippedSourceCount: number;
    coverageRatio: number;
}

export interface ScopeRecapItem {
    id: string;
    section: ScopeRecapSectionType;
    title: string;
    summary: string;
    /** Concrete reason this cross-note relationship is worth attention now. */
    whyItMatters?: string;
    sourceRefs: PersistedSourceRef[];
    generatedAt: string;
    generatedHelper: true;
    status: "candidate" | "accepted" | "dismissed";
}

export interface ScopeRecapRunResult {
    id: string;
    scope: ReviewQueueScope;
    /** Stable snapshot of the normalized scope and every candidate source. Optional only for legacy in-memory fixtures. */
    sourceSnapshotId?: string;
    generatedAt: string;
    ttlDays: number;
    staleStatus: ScopeRecapStaleStatus;
    sourceCoverage: ScopeRecapCoverage;
    skippedSources: ScopeRecapSkippedSource[];
    summary: ScopeRecapItem;
    themes: ScopeRecapItem[];
    tensions: ScopeRecapItem[];
    openQuestions: ScopeRecapItem[];
    nextReviewActions: ScopeRecapItem[];
    sourceRefs: PersistedSourceRef[];
    dataBoundarySnapshotId: string;
    providerInfo?: { provider: string; model: string };
}

export type ScopeRecapAttemptOutcome =
    | "success"
    | "insufficient_sources"
    | "provider_unavailable"
    | "provider_error"
    | "budget_blocked"
    | "timeout"
    | "empty"
    | "malformed"
    | "quality_rejected";

export interface ScopeRecapAttemptCost {
    inputTokens?: number;
    outputTokens?: number;
    estimatedCost?: number;
    currency?: "USD";
    pricingKnown?: boolean;
}

/** Diagnostics-only metadata. It never substitutes for a valid artifact. */
export interface ScopeRecapAttemptStatus {
    attemptedAt: string;
    outcome: ScopeRecapAttemptOutcome;
    scope: Pick<ReviewQueueScope, "kind">;
    sourceSnapshotId: string;
    dataBoundarySnapshotId: string;
    providerCallMade: boolean;
    includedSourceCount: number;
    cost?: ScopeRecapAttemptCost;
}

export interface ScopeRecapLocalOverviewSource {
    path: string;
    title: string;
    modifiedAt?: string;
    changed: boolean;
}

/**
 * Synchronous, explanation-only facts for an explicit Recap open.
 * This object deliberately has no theme, tension, inference, or action fields.
 */
export interface ScopeRecapLocalOverview {
    kind: "local_scope_overview";
    generatedAt: string;
    scope: ReviewQueueScope;
    sourceSnapshotId: string;
    dataBoundarySnapshotId: string;
    sourceCoverage: ScopeRecapCoverage;
    includedSources: ScopeRecapLocalOverviewSource[];
    skippedSources: ScopeRecapSkippedSource[];
}

export type ScopeRecapPreparationResult =
    | {
        status: "ready";
        artifact: ScopeRecapRunResult;
        attempt: ScopeRecapAttemptStatus & { outcome: "success" };
        localOverview: ScopeRecapLocalOverview;
    }
    | {
        status: "no_reliable_insight";
        artifact: null;
        attempt: ScopeRecapAttemptStatus & {
            outcome: Exclude<ScopeRecapAttemptOutcome, "success">;
        };
        localOverview: ScopeRecapLocalOverview;
    };

export type ScopeRecapArtifactInvalidReason =
    | "not_fresh"
    | "scope_mismatch"
    | "source_snapshot_mismatch"
    | "data_boundary_mismatch"
    | "expired"
    | "invalid_generated_at";

export type ScopeRecapArtifactCurrentness =
    | { current: true }
    | { current: false; reason: ScopeRecapArtifactInvalidReason };

export interface ScopeRecapArtifactCurrentnessInput {
    scope: ReviewQueueScope;
    sourceSnapshotId: string;
    dataBoundarySnapshotId: string;
    now?: Date | (() => Date);
}

export type ScopeRecapProactiveQualityFailureReason =
    | "not_fresh"
    | "no_concrete_insight"
    | "insufficient_distinct_sources";

export type ScopeRecapProactiveQualityResult =
    | { eligible: true; insight: ScopeRecapItem; fingerprint: string }
    | { eligible: false; reason: ScopeRecapProactiveQualityFailureReason };

export interface BuildScopeRecapOptions {
    now?: Date | (() => Date);
    scope?: ReviewQueueScope;
    ttlDays?: number;
    dataBoundarySnapshotId?: string;
    isPathAllowed?: (path: string) => boolean;
    includeGeneratedSources?: boolean;
    changedSourcePaths?: readonly string[];
    /** Explicit invalidation signal; ordinary boundary exclusions are not a change. */
    dataBoundaryChanged?: boolean;
}

export type ScopeRecapGeneratedNoteResult =
    | { ok: true; note: GeneratedReviewNote }
    | { ok: false; reason: "no_accepted_items" | "unsafe_recap" };

const DEFAULT_TTL_DAYS = 30;

function nowDate(now: BuildScopeRecapOptions["now"]): Date {
    const value = typeof now === "function" ? now() : now;
    return value ? new Date(value.getTime()) : new Date();
}

function basenameFromPath(path: string): string {
    const name = normalizeVaultPath(path).split("/").pop() ?? path;
    return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

function noteTitle(note: ScopeRecapSourceNote): string {
    return note.title?.trim() || basenameFromPath(note.path);
}

function normalizeTag(tag: string): string {
    return tag.trim().replace(/^#+/, "").toLowerCase();
}

function uniqueStrings(values: readonly string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizedScopeValue(scope: ReviewQueueScope): {
    kind: ReviewQueueScope["kind"];
    label: string;
    paths: string[];
    tags: string[];
} {
    return {
        kind: scope.kind,
        label: scope.label?.trim() ?? "",
        paths: uniqueStrings((scope.paths ?? []).map(normalizeVaultPath)).sort(),
        tags: uniqueStrings((scope.tags ?? []).map(normalizeTag)).sort(),
    };
}

function scopesMatch(left: ReviewQueueScope, right: ReviewQueueScope): boolean {
    return JSON.stringify(normalizedScopeValue(left)) === JSON.stringify(normalizedScopeValue(right));
}

/**
 * Hash the complete source snapshot without generation time or cache identity.
 * Content and mtime are both included so same-length edits cannot remain fresh.
 */
export function buildScopeRecapSourceSnapshotId(
    scope: ReviewQueueScope,
    sourceNotes: readonly ScopeRecapSourceNote[],
): string {
    const sources = sourceNotes
        .map((note) => ({
            path: normalizeVaultPath(note.path),
            content: note.content ?? "",
            modifiedAt: note.modifiedAt?.trim() ?? "",
            skipReason: note.skipReason ?? "",
        }))
        .sort((left, right) => (
            left.path.localeCompare(right.path)
            || left.modifiedAt.localeCompare(right.modifiedAt)
            || left.content.localeCompare(right.content)
        ));
    return `recap-snapshot-${stableHash(JSON.stringify({
        scope: normalizedScopeValue(scope),
        sources,
    }))}`;
}

function sourceRefsAreValid(refs: readonly PersistedSourceRef[]): boolean {
    return refs.length > 0
        && refs.every((ref) => validateSourceRefPathShape(ref).ok)
        && !hasForbiddenPersistedTextFields(refs);
}

function sourceRefForNote(note: ScopeRecapSourceNote, generatedAt: string, whyShown: string): PersistedSourceRef {
    const existing = note.sourceRefs?.find((ref) => validateSourceRefPathShape(ref).ok);
    if (existing) {
        return {
            ...cloneSourceRef(existing),
            whyShown: uniqueStrings([...(existing.whyShown ?? []), whyShown]),
        };
    }
    const path = normalizeVaultPath(note.path);
    return {
        path,
        generatedAt,
        contentHash: stableHash(note.content ?? ""),
        evidenceStrength: "medium",
        whyShown: [whyShown],
    };
}

function makeScope(notes: readonly ScopeRecapSourceNote[], fallback?: ReviewQueueScope): ReviewQueueScope {
    if (fallback) {
        return {
            ...fallback,
            paths: fallback.paths ? [...fallback.paths] : undefined,
            tags: fallback.tags ? [...fallback.tags] : undefined,
        };
    }
    const paths = notes.map((note) => normalizeVaultPath(note.path)).filter(Boolean);
    return {
        kind: paths.length === 1 ? "current_note" : "selected_notes",
        paths,
    };
}

function normalizeSources(
    sourceNotes: readonly ScopeRecapSourceNote[],
    options: BuildScopeRecapOptions,
): { included: ScopeRecapSourceNote[]; skippedSources: ScopeRecapSkippedSource[] } {
    const included: ScopeRecapSourceNote[] = [];
    const skipped = new Map<ScopeRecapSkippedSource["reason"], ScopeRecapSkippedSource>();
    const addSkip = (reason: ScopeRecapSkippedSource["reason"], label: string) => {
        const current = skipped.get(reason) ?? { reason, count: 0, label };
        current.count += 1;
        skipped.set(reason, current);
    };
    const seen = new Set<string>();
    for (const note of sourceNotes) {
        const path = normalizeVaultPath(note.path);
        if (!path || seen.has(path)) continue;
        seen.add(path);
        if (note.skipReason) {
            addSkip(note.skipReason, note.skipLabel ?? "Source skipped");
            continue;
        }
        if (options.isPathAllowed && !options.isPathAllowed(path)) {
            addSkip("data_boundary", "Skipped by Data Boundary");
            continue;
        }
        if (note.isGenerated && !options.includeGeneratedSources) {
            addSkip("generated_source", "Generated sources skipped");
            continue;
        }
        included.push({
            ...note,
            path,
            title: noteTitle(note),
            tags: uniqueStrings((note.tags ?? []).map(normalizeTag)),
            sourceRefs: sourceRefsAreValid(note.sourceRefs ?? [])
                ? note.sourceRefs?.map(cloneSourceRef)
                : undefined,
        });
    }
    return { included, skippedSources: [...skipped.values()] };
}

export function buildScopeRecap(
    sourceNotes: readonly ScopeRecapSourceNote[],
    options: BuildScopeRecapOptions = {},
): ScopeRecapRunResult {
    const generatedAt = nowDate(options.now).toISOString();
    const { included, skippedSources } = normalizeSources(sourceNotes, options);
    const sourceRefs = included.map((note) => sourceRefForNote(note, generatedAt, "Included in scope recap."));
    const coverage: ScopeRecapCoverage = {
        totalSourceCount: sourceNotes.length,
        includedSourceCount: included.length,
        skippedSourceCount: skippedSources.reduce((sum, entry) => sum + entry.count, 0),
        coverageRatio: sourceNotes.length > 0 ? included.length / sourceNotes.length : 0,
    };
    const scope = makeScope(included, options.scope);
    const changed = new Set((options.changedSourcePaths ?? []).map(normalizeVaultPath));
    const staleStatus: ScopeRecapStaleStatus = changed.size > 0
        ? "stale"
        : options.dataBoundaryChanged
            ? "boundary-changed"
            : included.length < 2
                ? "low-coverage"
                : "fresh";
    const summary = makeItem({
        section: "summary",
        title: "Scope summary",
        summary: included.length === 0
            ? "No source-backed recap is available for this scope."
            : `This scope is based on ${included.length} source note${included.length === 1 ? "" : "s"} and should be treated as a derived review map.`,
        sourceRefs: sourceRefs.slice(0, Math.max(1, Math.min(3, sourceRefs.length))),
        generatedAt,
        idParts: ["summary", scope.kind, ...(scope.paths ?? [])],
    });
    const recap: ScopeRecapRunResult = {
        id: `recap-${stableHash(`${scope.kind}:${(scope.paths ?? []).join("|")}:${generatedAt}`)}`,
        scope,
        sourceSnapshotId: buildScopeRecapSourceSnapshotId(scope, sourceNotes),
        generatedAt,
        ttlDays: options.ttlDays ?? DEFAULT_TTL_DAYS,
        staleStatus,
        sourceCoverage: coverage,
        skippedSources,
        summary,
        themes: buildThemeItems(included, generatedAt),
        tensions: buildTensionItems(included, generatedAt),
        openQuestions: buildQuestionItems(included, generatedAt),
        nextReviewActions: buildActionItems(included, generatedAt),
        sourceRefs,
        dataBoundarySnapshotId: options.dataBoundarySnapshotId ?? "data_boundary:scope_recap",
    };
    return recap;
}

function makeItem(input: {
    section: ScopeRecapSectionType;
    title: string;
    summary: string;
    whyItMatters?: string;
    sourceRefs: PersistedSourceRef[];
    generatedAt: string;
    idParts: readonly string[];
}): ScopeRecapItem {
    return {
        id: `recap-${input.section}-${stableHash(input.idParts.join("|"))}`,
        section: input.section,
        title: input.title,
        summary: input.summary,
        ...(input.whyItMatters ? { whyItMatters: input.whyItMatters } : {}),
        sourceRefs: input.sourceRefs.map(cloneSourceRef),
        generatedAt: input.generatedAt,
        generatedHelper: true,
        status: "candidate",
    };
}

function buildThemeItems(notes: readonly ScopeRecapSourceNote[], generatedAt: string): ScopeRecapItem[] {
    const byTag = new Map<string, ScopeRecapSourceNote[]>();
    for (const note of notes) {
        for (const tag of note.tags ?? []) {
            const group = byTag.get(tag) ?? [];
            group.push(note);
            byTag.set(tag, group);
        }
    }
    return [...byTag.entries()]
        .filter(([, group]) => group.length >= 2)
        .slice(0, 6)
        .map(([tag, group]) => makeItem({
            section: "theme",
            title: `Theme: #${tag}`,
            summary: `#${tag} appears across ${group.length} source notes.`,
            sourceRefs: group.slice(0, 5).map((note) => sourceRefForNote(note, generatedAt, `Theme source for #${tag}.`)),
            generatedAt,
            idParts: ["theme", tag],
        }));
}

function buildTensionItems(notes: readonly ScopeRecapSourceNote[], generatedAt: string): ScopeRecapItem[] {
    const groups = new Map<string, Map<string, ScopeRecapSourceNote[]>>();
    for (const note of notes) {
        for (const signal of extractTensionSignals(note.content ?? "")) {
            const byValue = groups.get(signal.key) ?? new Map<string, ScopeRecapSourceNote[]>();
            const bucket = byValue.get(signal.value) ?? [];
            bucket.push(note);
            byValue.set(signal.value, bucket);
            groups.set(signal.key, byValue);
        }
    }
    return [...groups.entries()]
        .filter(([, byValue]) => byValue.size >= 2)
        .slice(0, 4)
        .map(([key, byValue]) => {
            const sourceNotes = [...byValue.values()].flat().slice(0, 6);
            return makeItem({
                section: "tension",
                title: `Tension: ${key}`,
                summary: `Source notes disagree on ${key}; review the sources before treating this as resolved.`,
                sourceRefs: sourceNotes.map((note) => sourceRefForNote(note, generatedAt, `Tension source for ${key}.`)),
                generatedAt,
                idParts: ["tension", key, ...[...byValue.keys()].sort()],
            });
        });
}

function buildQuestionItems(notes: readonly ScopeRecapSourceNote[], generatedAt: string): ScopeRecapItem[] {
    const items: ScopeRecapItem[] = [];
    for (const note of notes) {
        const question = firstQuestion(note.content ?? "");
        if (!question) continue;
        items.push(makeItem({
            section: "open_question",
            title: `Open question: ${noteTitle(note)}`,
            summary: question,
            sourceRefs: [sourceRefForNote(note, generatedAt, "Open question source.")],
            generatedAt,
            idParts: ["question", note.path, question],
        }));
        if (items.length >= 4) break;
    }
    if (items.length > 0 || notes.length === 0) return items;
    const sourceRefs = notes.slice(0, 2).map((note) => sourceRefForNote(note, generatedAt, "Review question source."));
    return [makeItem({
        section: "open_question",
        title: "Open question: next review",
        summary: "What should be reviewed or confirmed before this scope becomes durable knowledge?",
        sourceRefs,
        generatedAt,
        idParts: ["question", "next-review", ...sourceRefs.map((ref) => ref.path)],
    })];
}

function buildActionItems(notes: readonly ScopeRecapSourceNote[], generatedAt: string): ScopeRecapItem[] {
    if (notes.length === 0) return [];
    const sourceRefs = notes.slice(0, 3).map((note) => sourceRefForNote(note, generatedAt, "Next review action source."));
    return [makeItem({
        section: "next_review_action",
        title: "Next review action",
        summary: "Inspect the source notes before saving an insight, confirming memory, or creating an index note.",
        sourceRefs,
        generatedAt,
        idParts: ["action", ...sourceRefs.map((ref) => ref.path)],
    })];
}

function extractTensionSignals(content: string): Array<{ key: string; value: string }> {
    const signals: Array<{ key: string; value: string }> = [];
    const pattern = /(?:^|\n)\s*(status|decision|preference|constraint|task constraint|scope state)\s*[:：]\s*([^\n]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
        const key = match[1].toLowerCase().replace(/\s+/g, "_");
        const value = match[2].trim().toLowerCase().replace(/[.#*_`[\]]/g, "").slice(0, 80);
        if (value) signals.push({ key, value });
    }
    return signals;
}

function firstQuestion(content: string): string | null {
    return content.split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length >= 8 && line.includes("?")) ?? null;
}

function allRecapItems(recap: ScopeRecapRunResult): ScopeRecapItem[] {
    return [
        recap.summary,
        ...recap.themes,
        ...recap.tensions,
        ...recap.openQuestions,
        ...recap.nextReviewActions,
    ];
}

function concreteRecapItems(recap: ScopeRecapRunResult): ScopeRecapItem[] {
    return [
        ...recap.tensions,
        ...recap.openQuestions,
        ...recap.themes,
    ];
}

function distinctValidSourcePaths(item: ScopeRecapItem): string[] {
    return uniqueStrings(item.sourceRefs
        .filter((ref) => validateSourceRefPathShape(ref).ok)
        .map((ref) => normalizeVaultPath(ref.path)))
        .sort();
}

const GENERIC_WHY_IT_MATTERS_TEXT = new Set([
    "important",
    "veryimportant",
    "thisisimportant",
    "itisimportant",
    "itmatters",
    "thismatters",
    "relevant",
    "thisisrelevant",
    "notable",
    "significant",
    "meaningful",
    "worthattention",
    "worthnoting",
    "thisisworthnoting",
    "needsattention",
    "thisneedsattention",
    "重要",
    "很重要",
    "非常重要",
    "这很重要",
    "值得关注",
    "值得注意",
    "需要注意",
    "需要注意这一点",
    "这一点需要注意",
    "有意义",
    "很有意义",
    "具有重要意义",
    "关键",
    "很关键",
]);

const CONCRETE_WHY_IT_MATTERS_SIGNAL = /(?:\b(?:because|therefore|thus|otherwise|before|until|affect(?:s|ed|ing)?|impact(?:s|ed|ing)?|consequence(?:s)?|risk(?:s|ed|ing)?|conflict(?:s|ed|ing)?|contradict(?:s|ed|ing|ion|ory)?|depend(?:s|ed|ing)?|require(?:s|d)?|requiring|need(?:s|ed|ing)?|prevent(?:s|ed|ing)?|enable(?:s|d)?|enabling|block(?:s|ed|ing)?|change(?:s|d)?|changing|decid(?:e|es|ed|ing)|determin(?:e|es|ed|ing)|govern(?:s|ed|ing)?|mak(?:e|es|ing)|lead(?:s|ing)?|led|result(?:s|ed|ing)?|resolv(?:e|es|ed|ing)|unresolved|mean(?:s|ing)?|impl(?:y|ies|ied|ying)|trade-?off(?:s)?)\b|因为|所以|因此|意味着|影响|后果|风险|冲突|矛盾|取决于|依赖|需要|阻碍|促进|决定了|决定着|导致|造成|带来|关系到|关乎|违背|抵触|不一致|相互(?:支持|冲突|矛盾|依赖|强化)|必须先|应当先|应该先|之前|直到|否则|无法|不能)/iu;

const GENERIC_WHY_IT_MATTERS_PATTERN = /^(?:(?:this|it)\s+)?(?:needs?\s+(?:more\s+)?attention|makes?\s+(?:it\s+)?(?:important|relevant|significant|meaningful))(?:\s+(?:before\s+(?:acting|proceeding)|now|here))?[\p{P}\p{S}\s]*$|^(?:这|这一点)?(?:需要更多关注|值得更多关注|使(?:它|其)?(?:很)?重要)(?:再行动)?[\p{P}\p{S}\s]*$/iu;

function normalizeScopeRecapQualityText(value: string): string {
    return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeComparableScopeRecapQualityText(value: string): string {
    return normalizeScopeRecapQualityText(value)
        .replace(/^(?:(?:summary|why\s+it\s+matters|why|reason)|(?:摘要|为什么重要|意义|原因))\s*[:：-]\s*/iu, "")
        .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function isNearRepeatScopeRecapQualityText(left: string, right: string): boolean {
    if (left === right) return true;
    const [longer, shorter] = left.length >= right.length ? [left, right] : [right, left];
    return shorter.length >= 8
        && longer.includes(shorter)
        && longer.length - shorter.length <= 16;
}

function hasConcreteWhyItMatters(item: ScopeRecapItem): boolean {
    const whyItMatters = item.whyItMatters?.trim();
    if (!whyItMatters) return false;

    const normalizedWhy = normalizeScopeRecapQualityText(whyItMatters);
    const comparableWhy = normalizeComparableScopeRecapQualityText(whyItMatters);
    if (comparableWhy.length < 8 || GENERIC_WHY_IT_MATTERS_TEXT.has(comparableWhy)) return false;
    if (GENERIC_WHY_IT_MATTERS_PATTERN.test(normalizedWhy)) return false;
    if (isNearRepeatScopeRecapQualityText(
        comparableWhy,
        normalizeComparableScopeRecapQualityText(item.summary),
    )) return false;

    return CONCRETE_WHY_IT_MATTERS_SIGNAL.test(normalizedWhy);
}

/** Select a structured, source-backed observation; summaries and actions never qualify. */
export function selectStrongestConcreteScopeRecapInsight(
    recap: ScopeRecapRunResult,
    minimumDistinctSources = 2,
): ScopeRecapItem | null {
    const sectionWeight: Readonly<Record<ScopeRecapSectionType, number>> = {
        summary: 0,
        theme: 1,
        open_question: 2,
        tension: 3,
        next_review_action: 0,
    };
    const eligible = concreteRecapItems(recap).filter((item) => (
        item.title.trim().length > 0
        && item.summary.trim().length > 0
        && hasConcreteWhyItMatters(item)
        && distinctValidSourcePaths(item).length >= minimumDistinctSources
    ));
    eligible.sort((left, right) => (
        sectionWeight[right.section] - sectionWeight[left.section]
        || distinctValidSourcePaths(right).length - distinctValidSourcePaths(left).length
        || left.id.localeCompare(right.id)
    ));
    return eligible[0] ?? null;
}

/** Stable across regeneration of the same substantive insight. */
export function buildScopeRecapInsightFingerprint(
    scope: ReviewQueueScope,
    insight: ScopeRecapItem,
): string {
    const normalizeText = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
    return `recap-insight-${stableHash(JSON.stringify({
        scope: normalizedScopeValue(scope),
        section: insight.section,
        title: normalizeText(insight.title),
        summary: normalizeText(insight.summary),
        whyItMatters: normalizeText(insight.whyItMatters ?? ""),
        sourcePaths: distinctValidSourcePaths(insight),
    }))}`;
}

export function evaluateScopeRecapProactiveQuality(
    recap: ScopeRecapRunResult,
): ScopeRecapProactiveQualityResult {
    if (recap.staleStatus !== "fresh") return { eligible: false, reason: "not_fresh" };
    const concreteItems = concreteRecapItems(recap).filter((item) => (
        item.title.trim().length > 0 && item.summary.trim().length > 0
    ));
    if (concreteItems.length === 0) return { eligible: false, reason: "no_concrete_insight" };
    const insight = selectStrongestConcreteScopeRecapInsight(recap, 2);
    if (!insight) return { eligible: false, reason: "insufficient_distinct_sources" };
    return {
        eligible: true,
        insight,
        fingerprint: buildScopeRecapInsightFingerprint(recap.scope, insight),
    };
}

export function evaluateScopeRecapArtifactCurrentness(
    artifact: ScopeRecapRunResult,
    input: ScopeRecapArtifactCurrentnessInput,
): ScopeRecapArtifactCurrentness {
    if (artifact.staleStatus !== "fresh") return { current: false, reason: "not_fresh" };
    if (!scopesMatch(artifact.scope, input.scope)) return { current: false, reason: "scope_mismatch" };
    if (artifact.sourceSnapshotId !== input.sourceSnapshotId) {
        return { current: false, reason: "source_snapshot_mismatch" };
    }
    if (artifact.dataBoundarySnapshotId !== input.dataBoundarySnapshotId) {
        return { current: false, reason: "data_boundary_mismatch" };
    }
    const generatedAt = Date.parse(artifact.generatedAt);
    if (!Number.isFinite(generatedAt)) return { current: false, reason: "invalid_generated_at" };
    const ttlMs = artifact.ttlDays * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || nowDate(input.now).getTime() >= generatedAt + ttlMs) {
        return { current: false, reason: "expired" };
    }
    return { current: true };
}

export function buildScopeRecapLocalOverview(
    sourceNotes: readonly ScopeRecapSourceNote[],
    options: BuildScopeRecapOptions & { maxSources?: number } = {},
): ScopeRecapLocalOverview {
    const generatedAt = nowDate(options.now).toISOString();
    const { included, skippedSources } = normalizeSources(sourceNotes, options);
    const scope = makeScope(included, options.scope);
    const changed = new Set((options.changedSourcePaths ?? []).map(normalizeVaultPath));
    const maxSources = Math.max(1, Math.min(20, Math.floor(options.maxSources ?? 5)));
    const skippedSourceCount = skippedSources.reduce((sum, entry) => sum + entry.count, 0);
    return {
        kind: "local_scope_overview",
        generatedAt,
        scope,
        sourceSnapshotId: buildScopeRecapSourceSnapshotId(scope, sourceNotes),
        dataBoundarySnapshotId: options.dataBoundarySnapshotId ?? "data_boundary:scope_recap",
        sourceCoverage: {
            totalSourceCount: sourceNotes.length,
            includedSourceCount: included.length,
            skippedSourceCount,
            coverageRatio: sourceNotes.length > 0 ? included.length / sourceNotes.length : 0,
        },
        includedSources: included.slice(0, maxSources).map((note) => ({
            path: note.path,
            title: noteTitle(note),
            ...(note.modifiedAt ? { modifiedAt: note.modifiedAt } : {}),
            changed: changed.has(note.path),
        })),
        skippedSources,
    };
}

export function buildScopeRecapMarkdown(recap: ScopeRecapRunResult, acceptedItemIds: readonly string[]): string {
    const accepted = new Set(acceptedItemIds);
    const acceptedItems = allRecapItems(recap).filter((item) => accepted.has(item.id));
    const lines = [
        "---",
        "pagelet: true",
        "pa: scope-recap",
        `generatedAt: ${recap.generatedAt}`,
        `staleStatus: ${recap.staleStatus}`,
        "---",
        "",
        "# Scope Recap",
        "",
        `Generated: ${recap.generatedAt}`,
        `Scope: ${recap.scope.label ?? recap.scope.kind}`,
        `Coverage: ${recap.sourceCoverage.includedSourceCount}/${recap.sourceCoverage.totalSourceCount} source notes (${Math.round(recap.sourceCoverage.coverageRatio * 100)}%)`,
        `Stale status: ${recap.staleStatus}`,
        "",
    ];
    if (recap.skippedSources.length > 0) {
        lines.push("## Skipped Sources", "");
        for (const skipped of recap.skippedSources) {
            lines.push(`- ${skipped.label}: ${skipped.count}`);
        }
        lines.push("");
    }
    const groups: Array<[string, ScopeRecapSectionType]> = [
        ["Summary", "summary"],
        ["Themes", "theme"],
        ["Tensions", "tension"],
        ["Open Questions", "open_question"],
        ["Next Review Actions", "next_review_action"],
    ];
    for (const [title, section] of groups) {
        const items = acceptedItems.filter((item) => item.section === section);
        if (items.length === 0) continue;
        lines.push(`## ${title}`, "");
        for (const item of items) {
            lines.push(`### ${item.title}`);
            lines.push(item.summary);
            lines.push("");
            lines.push("Sources:");
            for (const ref of item.sourceRefs) {
                lines.push(`- [[${ref.path}]]${ref.evidenceStrength ? ` (${ref.evidenceStrength})` : ""}`);
            }
            lines.push("");
        }
    }
    return lines.join("\n").trimEnd() + "\n";
}

export function buildScopeRecapGeneratedNote(
    recap: ScopeRecapRunResult,
    acceptedItemIds: readonly string[],
    targetFolder: string,
): ScopeRecapGeneratedNoteResult {
    const acceptedItems = allRecapItems(recap).filter((item) => acceptedItemIds.includes(item.id));
    if (acceptedItems.length === 0) return { ok: false, reason: "no_accepted_items" };
    if (hasForbiddenPersistedTextFields(acceptedItems) || acceptedItems.some((item) => !sourceRefsAreValid(item.sourceRefs))) {
        return { ok: false, reason: "unsafe_recap" };
    }
    const markdown = buildScopeRecapMarkdown(recap, acceptedItemIds);
    const date = recap.generatedAt.slice(0, 10);
    const fileName = `pagelet-scope-recap-${date}.md`;
    const normalizedTargetFolder = normalizeVaultPath(targetFolder) || ".pagelet";
    return {
        ok: true,
        note: {
            markdown,
            fileName,
            targetFolder: normalizedTargetFolder,
            targetPath: `${normalizedTargetFolder}/${fileName}`,
            sources: uniqueStrings(acceptedItems.flatMap((item) => item.sourceRefs.map((ref) => `[[${ref.path}]]`))),
            tokenCost: { input: 0, output: 0 },
            confirmationPrompt: {
                title: "Save scope recap?",
                message: `Create a recap note with ${acceptedItems.length} accepted item${acceptedItems.length === 1 ? "" : "s"}. Source notes are not modified.`,
                confirmText: "Save recap",
            },
        },
    };
}

export function scopeRecapCanAnswerAsFact(_recap: ScopeRecapRunResult): false {
    return false;
}

export function scopeRecapToConfirmedMemory(): { ok: false; reason: "recap_not_source_truth" } {
    return { ok: false, reason: "recap_not_source_truth" };
}

// ---------------------------------------------------------------------------
// LLM-backed Scope Recap
// ---------------------------------------------------------------------------

export interface RecapLlmInsight {
    title: string;
    summary: string;
    whyItMatters: string;
    sourceNoteTitles: string[];
    section: "theme" | "tension" | "open_question";
}

export type GenerateRecapInsightsCallback = (input: {
    scope: ReviewQueueScope;
    noteDigests: Array<{ title: string; digest: string; tags: string[] }>;
}) => Promise<unknown>;

/**
 * Extract a compact digest from a source note for LLM consumption.
 * Produces: Title + Headings (## lines) + First paragraph of content.
 */
export function extractNoteDigest(note: ScopeRecapSourceNote): string {
    const title = noteTitle(note);
    const content = note.content ?? "";
    const lines = content.split(/\r?\n/);

    const headings: string[] = [];
    let firstParagraph = "";
    let inFirstParagraph = false;
    const paragraphLines: string[] = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (/^#{2,}\s+/.test(trimmed)) {
            headings.push(trimmed);
        }
        if (!firstParagraph) {
            if (!inFirstParagraph && trimmed.length > 0 && !trimmed.startsWith("#")) {
                inFirstParagraph = true;
                paragraphLines.push(trimmed);
            } else if (inFirstParagraph) {
                if (trimmed.length === 0 || trimmed.startsWith("#")) {
                    firstParagraph = paragraphLines.join(" ");
                } else {
                    paragraphLines.push(trimmed);
                }
            }
        }
    }
    if (!firstParagraph && paragraphLines.length > 0) {
        firstParagraph = paragraphLines.join(" ");
    }

    const parts: string[] = [`Title: ${title}`];
    if (headings.length > 0) {
        parts.push(`Headings: ${headings.join(" | ")}`);
    }
    if (firstParagraph) {
        parts.push(`First paragraph: ${firstParagraph}`);
    }
    return parts.join("\n");
}

function isStrictRecapLlmInsight(value: unknown): value is RecapLlmInsight {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.title === "string"
        && candidate.title.trim().length > 0
        && typeof candidate.summary === "string"
        && candidate.summary.trim().length > 0
        && typeof candidate.whyItMatters === "string"
        && candidate.whyItMatters.trim().length > 0
        && Array.isArray(candidate.sourceNoteTitles)
        && candidate.sourceNoteTitles.length > 0
        && candidate.sourceNoteTitles.every((title) => typeof title === "string" && title.trim().length > 0)
        && (candidate.section === "theme" || candidate.section === "tension" || candidate.section === "open_question");
}

type ScopeRecapFailedAttemptOutcome = Exclude<ScopeRecapAttemptOutcome, "success">;

/**
 * Strict preparation boundary. A fresh artifact needs at least one concrete
 * insight backed by an unambiguous source note. The separate proactive gate
 * still requires two distinct source notes before it may interrupt the user.
 */
export async function prepareScopeRecapWithLlm(
    sourceNotes: readonly ScopeRecapSourceNote[],
    generateInsights: GenerateRecapInsightsCallback,
    options: BuildScopeRecapOptions = {},
): Promise<ScopeRecapPreparationResult> {
    const generatedAt = nowDate(options.now).toISOString();
    const { included, skippedSources } = normalizeSources(sourceNotes, options);
    const sourceRefs = included.map((note) => sourceRefForNote(note, generatedAt, "Included in scope recap."));
    const coverage: ScopeRecapCoverage = {
        totalSourceCount: sourceNotes.length,
        includedSourceCount: included.length,
        skippedSourceCount: skippedSources.reduce((sum, entry) => sum + entry.count, 0),
        coverageRatio: sourceNotes.length > 0 ? included.length / sourceNotes.length : 0,
    };
    const scope = makeScope(included, options.scope);
    const sourceSnapshotId = buildScopeRecapSourceSnapshotId(scope, sourceNotes);
    const dataBoundarySnapshotId = options.dataBoundarySnapshotId ?? "data_boundary:scope_recap";
    const changed = new Set((options.changedSourcePaths ?? []).map(normalizeVaultPath));
    const staleStatus: ScopeRecapStaleStatus = changed.size > 0
        ? "stale"
        : options.dataBoundaryChanged
            ? "boundary-changed"
            : included.length < 1
                ? "low-coverage"
                : "fresh";
    const summary = makeItem({
        section: "summary",
        title: "Scope summary",
        summary: included.length === 0
            ? "No source-backed recap is available for this scope."
            : `This scope is based on ${included.length} source note${included.length === 1 ? "" : "s"} and should be treated as a derived review map.`,
        sourceRefs: sourceRefs.slice(0, Math.max(1, Math.min(3, sourceRefs.length))),
        generatedAt,
        idParts: ["summary", scope.kind, ...(scope.paths ?? [])],
    });
    const localOverview = buildScopeRecapLocalOverview(sourceNotes, {
        ...options,
        now: new Date(generatedAt),
    });
    const attemptBase = {
        attemptedAt: generatedAt,
        // Diagnostics retain only the scope class. Paths, tags, labels, and
        // note titles belong to the local overview/artifact, not attempt state.
        scope: { kind: scope.kind },
        sourceSnapshotId,
        dataBoundarySnapshotId,
        includedSourceCount: included.length,
    };
    const fail = (
        outcome: ScopeRecapFailedAttemptOutcome,
        providerCallMade: boolean,
    ): ScopeRecapPreparationResult => ({
        status: "no_reliable_insight",
        artifact: null,
        attempt: { ...attemptBase, outcome, providerCallMade },
        localOverview,
    });

    if (included.length < 1) return fail("insufficient_sources", false);
    if (staleStatus !== "fresh") return fail("quality_rejected", false);

    const noteDigests = included.map((note) => ({
        title: noteTitle(note),
        digest: extractNoteDigest(note),
        tags: [...(note.tags ?? [])],
    }));
    let rawInsights: unknown;
    try {
        rawInsights = await generateInsights({ scope, noteDigests });
    } catch {
        return fail("provider_error", true);
    }
    if (rawInsights == null) return fail("provider_unavailable", true);
    if (!Array.isArray(rawInsights)) return fail("malformed", true);
    if (rawInsights.length === 0) return fail("empty", true);
    if (!rawInsights.every(isStrictRecapLlmInsight)) return fail("malformed", true);

    const titleToNotes = new Map<string, ScopeRecapSourceNote[]>();
    for (const note of included) {
        const key = noteTitle(note).trim().toLowerCase();
        titleToNotes.set(key, [...(titleToNotes.get(key) ?? []), note]);
    }

    const themes: ScopeRecapItem[] = [];
    const tensions: ScopeRecapItem[] = [];
    const openQuestions: ScopeRecapItem[] = [];

    for (const insight of rawInsights) {
        const matchedNotes = insight.sourceNoteTitles
            .map((title) => titleToNotes.get(title.trim().toLowerCase()))
            .filter((matches): matches is ScopeRecapSourceNote[] => matches?.length === 1)
            .map((matches) => matches[0]);
        const uniqueMatchedNotes = [...new Map(matchedNotes.map((note) => [normalizeVaultPath(note.path), note])).values()];
        if (uniqueMatchedNotes.length < 1) continue;
        const matchedRefs = uniqueMatchedNotes
            .map((note) => sourceRefForNote(note, generatedAt, `LLM insight source: ${insight.title}`));

        const item = makeItem({
            section: insight.section,
            title: insight.title,
            summary: insight.summary,
            whyItMatters: insight.whyItMatters,
            sourceRefs: matchedRefs,
            generatedAt,
            idParts: [insight.section, "llm", insight.title],
        });

        switch (insight.section) {
            case "theme": themes.push(item); break;
            case "tension": tensions.push(item); break;
            case "open_question": openQuestions.push(item); break;
        }
    }

    if (themes.length + tensions.length + openQuestions.length === 0) {
        return fail("quality_rejected", true);
    }

    const recap: ScopeRecapRunResult = {
        id: `recap-${stableHash(`${scope.kind}:${(scope.paths ?? []).join("|")}:${generatedAt}`)}`,
        scope,
        sourceSnapshotId,
        generatedAt,
        ttlDays: options.ttlDays ?? DEFAULT_TTL_DAYS,
        staleStatus,
        sourceCoverage: coverage,
        skippedSources,
        summary,
        themes,
        tensions,
        openQuestions,
        nextReviewActions: [],
        sourceRefs,
        dataBoundarySnapshotId,
        providerInfo: { provider: "llm", model: "scope-recap-insights" },
    };
    if (!selectStrongestConcreteScopeRecapInsight(recap, 1)) {
        return fail("quality_rejected", true);
    }
    return {
        status: "ready",
        artifact: recap,
        attempt: { ...attemptBase, outcome: "success", providerCallMade: true },
        localOverview,
    };
}

/**
 * Compatibility adapter for existing callers. Failed attempts return a
 * non-deliverable shell; delivery gates must require a concrete insight.
 */
export async function buildScopeRecapWithLlm(
    sourceNotes: readonly ScopeRecapSourceNote[],
    generateInsights: GenerateRecapInsightsCallback,
    options: BuildScopeRecapOptions = {},
): Promise<ScopeRecapRunResult> {
    const preparation = await prepareScopeRecapWithLlm(sourceNotes, generateInsights, options);
    if (preparation.status === "ready") return preparation.artifact;
    const shell = buildScopeRecap(sourceNotes, {
        ...options,
        now: new Date(preparation.attempt.attemptedAt),
    });
    return {
        ...shell,
        themes: [],
        tensions: [],
        openQuestions: [],
        nextReviewActions: [],
        providerInfo: { provider: "llm", model: "scope-recap-insights" },
    };
}

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
    sourceRefs: PersistedSourceRef[];
    generatedAt: string;
    generatedHelper: true;
    status: "candidate" | "accepted" | "dismissed";
}

export interface ScopeRecapRunResult {
    id: string;
    scope: ReviewQueueScope;
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

export interface BuildScopeRecapOptions {
    now?: Date | (() => Date);
    scope?: ReviewQueueScope;
    ttlDays?: number;
    dataBoundarySnapshotId?: string;
    isPathAllowed?: (path: string) => boolean;
    includeGeneratedSources?: boolean;
    changedSourcePaths?: readonly string[];
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
        contentHash: stableHash(`${path}:${note.content?.length ?? 0}`),
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
        seen.add(path);
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
        : skippedSources.some((entry) => entry.reason === "data_boundary")
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
    sourceRefs: PersistedSourceRef[];
    generatedAt: string;
    idParts: readonly string[];
}): ScopeRecapItem {
    return {
        id: `recap-${input.section}-${stableHash(input.idParts.join("|"))}`,
        section: input.section,
        title: input.title,
        summary: input.summary,
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
    sourceNoteTitles: string[];
    section: "theme" | "tension" | "open_question";
}

export type GenerateRecapInsightsCallback = (input: {
    scope: ReviewQueueScope;
    noteDigests: Array<{ title: string; digest: string; tags: string[] }>;
}) => Promise<RecapLlmInsight[] | null>;

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

/**
 * Build a scope recap using LLM-generated insights instead of rule-based heuristics.
 *
 * Falls back to SILENCE (empty arrays) if the LLM returns null or throws.
 * The existing `buildScopeRecap()` is unchanged; this is a parallel async variant.
 */
export async function buildScopeRecapWithLlm(
    sourceNotes: readonly ScopeRecapSourceNote[],
    generateInsights: GenerateRecapInsightsCallback,
    options: BuildScopeRecapOptions = {},
): Promise<ScopeRecapRunResult> {
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
        : skippedSources.some((entry) => entry.reason === "data_boundary")
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

    // Call LLM for insights
    let insights: RecapLlmInsight[] = [];
    if (included.length >= 2) {
        try {
            const noteDigests = included.map((note) => ({
                title: noteTitle(note),
                digest: extractNoteDigest(note),
                tags: [...(note.tags ?? [])],
            }));
            const result = await generateInsights({ scope, noteDigests });
            if (Array.isArray(result)) {
                insights = result;
            }
        } catch {
            // Fallback to silence — do not surface errors to user
            insights = [];
        }
    }

    // Map LLM insights back to ScopeRecapItem[]
    const titleToNote = new Map<string, ScopeRecapSourceNote>();
    for (const note of included) {
        titleToNote.set(noteTitle(note).toLowerCase(), note);
    }

    const themes: ScopeRecapItem[] = [];
    const tensions: ScopeRecapItem[] = [];
    const openQuestions: ScopeRecapItem[] = [];

    for (const insight of insights) {
        const matchedRefs = insight.sourceNoteTitles
            .map((t) => titleToNote.get(t.toLowerCase()))
            .filter((n): n is ScopeRecapSourceNote => n != null)
            .map((note) => sourceRefForNote(note, generatedAt, `LLM insight source: ${insight.title}`));

        if (matchedRefs.length === 0) continue;

        const item = makeItem({
            section: insight.section,
            title: insight.title,
            summary: insight.summary,
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

    const recap: ScopeRecapRunResult = {
        id: `recap-${stableHash(`${scope.kind}:${(scope.paths ?? []).join("|")}:${generatedAt}`)}`,
        scope,
        generatedAt,
        ttlDays: options.ttlDays ?? DEFAULT_TTL_DAYS,
        staleStatus,
        sourceCoverage: coverage,
        skippedSources,
        summary,
        themes,
        tensions,
        openQuestions: openQuestions,
        nextReviewActions: buildActionItems(included, generatedAt),
        sourceRefs,
        dataBoundarySnapshotId: options.dataBoundarySnapshotId ?? "data_boundary:scope_recap",
        providerInfo: { provider: "llm", model: "scope-recap-insights" },
    };
    return recap;
}

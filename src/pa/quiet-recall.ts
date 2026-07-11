import {
    hasForbiddenPersistedTextFields,
    validateSourceRefPathShape,
    type PersistedSourceRef,
} from "./contracts";
import { normalizeVaultPath, cloneSourceRef, stableHash } from "./helpers";
import type { ReviewQueueCreateInput } from "./review-queue-store";
import type { SavedInsight, SavedInsightResult } from "./saved-insight-store";

export type QuietRecallRelation = "current" | "related" | "far";

export type QuietRecallContext =
    | { kind: "note_retrieval" }
    | { kind: "governed_claim"; claimId: string };

export interface QuietRecallCurrentNote {
    path: string;
    title?: string;
    content?: string;
}

export interface QuietRecallVaultNote {
    path: string;
    title?: string;
    content?: string;
    tags?: readonly string[];
    links?: readonly string[];
    backlinks?: readonly string[];
    modifiedAt?: string;
    createdAt?: string;
}

export interface QuietRecallRelatedNote {
    path: string;
    score?: number;
    headingPath?: string[];
}

export interface QuietRecallCandidate {
    id: string;
    title: string;
    summary: string;
    sourceInsightId?: string;
    sourceRefs: PersistedSourceRef[];
    whyNow: string[];
    nextAction: string;
    relation: QuietRecallRelation;
    score: number;
    generatedAt: string;
    /** Exact participation trace. Missing legacy values never imply a Memory target. */
    context?: QuietRecallContext;
}

export interface QuietRecallRunResult {
    generatedAt: string;
    currentPath?: string;
    totalCount: number;
    candidates: QuietRecallCandidate[];
}

export interface QuietRecallBubbleNudge {
    candidateId: string;
    sourceInsightId?: string;
    currentPath?: string;
    relation: QuietRecallRelation;
    generatedAt: string;
    onboardingExplanation?: boolean;
}

export interface QuietRecallBuildInput {
    now?: Date | (() => Date);
    currentNote?: QuietRecallCurrentNote | null;
    relatedNotes?: readonly QuietRecallRelatedNote[];
    vaultNotes?: readonly QuietRecallVaultNote[];
    savedInsights?: readonly SavedInsight[];
    maxCandidates?: number;
    staleAfterDays?: number;
    isPathAllowed?: (path: string) => boolean;
}

export interface RecallScoreSignals {
    semanticRelevance: number;
    timeFreshness: number;
    connectionDensity: number;
    noteRichness: number;
    userFeedback: number;
}

export type RecallScoreWeights = Partial<Record<keyof RecallScoreSignals, number>>;

export type QuietRecallSaveResult =
    | { ok: true; value: SavedInsight; message: string }
    | { ok: false; reason: string; message: string };

const DEFAULT_MAX_CANDIDATES = 5;
const DEFAULT_STALE_AFTER_DAYS = 180;
const CURRENT_RELEVANCE_BASE = 80;
const RELATED_RELEVANCE_BASE = 48;
const FAR_ASSOCIATION_CAP = 35;
const MAX_VAULT_NOTE_SCORE = 72;
const NEUTRAL_USER_FEEDBACK = 0.5;
const DEFAULT_RECALL_SCORE_WEIGHTS: Required<RecallScoreWeights> = Object.freeze({
    semanticRelevance: 0.72,
    timeFreshness: 0.08,
    connectionDensity: 0.08,
    noteRichness: 0.08,
    userFeedback: 0.04,
});

function nowDate(now: QuietRecallBuildInput["now"]): Date {
    const value = typeof now === "function" ? now() : now;
    return value ? new Date(value.getTime()) : new Date();
}

function fileStem(path: string): string {
    const name = normalizeVaultPath(path).split("/").pop() ?? path;
    return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

export function computeRecallScore(
    signals: RecallScoreSignals,
    weights: RecallScoreWeights = DEFAULT_RECALL_SCORE_WEIGHTS,
): number {
    const merged = {
        ...DEFAULT_RECALL_SCORE_WEIGHTS,
        ...weights,
    };
    const totalWeight = Object.values(merged).reduce((sum, value) =>
        sum + (Number.isFinite(value) && value > 0 ? value : 0), 0);
    if (totalWeight <= 0) return 0;
    const weighted = (Object.keys(DEFAULT_RECALL_SCORE_WEIGHTS) as Array<keyof RecallScoreSignals>)
        .reduce((sum, key) => {
            const weight = merged[key];
            if (!Number.isFinite(weight) || weight <= 0) return sum;
            return sum + clamp01(signals[key]) * weight;
        }, 0);
    return Math.round((weighted / totalWeight) * 100);
}

function sourceRefsAreValid(sourceRefs: readonly PersistedSourceRef[]): boolean {
    return sourceRefs.length > 0
        && sourceRefs.every((ref) => validateSourceRefPathShape(ref).ok)
        && !hasForbiddenPersistedTextFields(sourceRefs);
}

function insightIsStale(insight: SavedInsight, now: Date, staleAfterDays: number): boolean {
    const updatedAt = Date.parse(insight.updatedAt || insight.createdAt);
    if (!Number.isFinite(updatedAt)) return true;
    return now.getTime() - updatedAt > staleAfterDays * 24 * 60 * 60 * 1000;
}

function evidenceWeight(sourceRefs: readonly PersistedSourceRef[]): number {
    let weight = 0;
    for (const ref of sourceRefs) {
        if (ref.evidenceStrength === "strong") weight = Math.max(weight, 16);
        else if (ref.evidenceStrength === "medium") weight = Math.max(weight, 10);
        else if (ref.evidenceStrength === "conflicting") weight = Math.max(weight, 6);
        else weight = Math.max(weight, 2);
    }
    return weight;
}

function isWeakOnly(sourceRefs: readonly PersistedSourceRef[]): boolean {
    return sourceRefs.every((ref) => !ref.evidenceStrength || ref.evidenceStrength === "weak");
}

function relationForInsight(
    insight: SavedInsight,
    currentPath: string | null,
    relatedScores: Map<string, number>,
): { relation: QuietRecallRelation; score: number; whyNow: string[] } | null {
    const normalizedRefs = insight.sourceRefs.map((ref) => normalizeVaultPath(ref.path));
    const reasons: string[] = [];

    if (currentPath && normalizedRefs.includes(currentPath)) {
        reasons.push("Source matches the note you are looking at.");
        return {
            relation: "current",
            score: CURRENT_RELEVANCE_BASE + evidenceWeight(insight.sourceRefs),
            whyNow: reasons,
        };
    }

    let bestRelatedScore = 0;
    for (const path of normalizedRefs) {
        bestRelatedScore = Math.max(bestRelatedScore, relatedScores.get(path) ?? 0);
    }
    if (bestRelatedScore > 0) {
        reasons.push("Source appears near the current note in Memory search.");
        return {
            relation: "related",
            score: RELATED_RELEVANCE_BASE + Math.min(12, Math.round(bestRelatedScore * 12)) + evidenceWeight(insight.sourceRefs),
            whyNow: reasons,
        };
    }

    if (isWeakOnly(insight.sourceRefs)) return null;
    reasons.push("Older saved insight may be worth revisiting.");
    return {
        relation: "far",
        score: Math.min(FAR_ASSOCIATION_CAP, 20 + evidenceWeight(insight.sourceRefs)),
        whyNow: reasons,
    };
}

function titleForInsight(insight: SavedInsight): string {
    const source = insight.sourceRefs[0]?.path;
    const stem = source ? fileStem(source) : "saved insight";
    return `Recall: ${stem}`;
}

function nextActionForRelation(relation: QuietRecallRelation): string {
    if (relation === "current") return "Compare this saved insight with the current note.";
    if (relation === "related") return "Open the source note and decide whether the connection still matters.";
    return "Keep it in mind only if it still feels useful.";
}

function daysBetween(now: Date, isoDate: string | undefined): number | null {
    if (!isoDate) return null;
    const parsed = Date.parse(isoDate);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, (now.getTime() - parsed) / (24 * 60 * 60 * 1000));
}

function timeFreshnessSignal(note: QuietRecallVaultNote, now: Date): number {
    const ageDays = daysBetween(now, note.modifiedAt ?? note.createdAt);
    if (ageDays === null) return 0.35;
    if (ageDays <= 7) return 1;
    if (ageDays <= 30) return 0.82;
    if (ageDays <= 90) return 0.62;
    if (ageDays <= 365) return 0.38;
    return 0.18;
}

function connectionDensitySignal(note: QuietRecallVaultNote): number {
    const links = new Set((note.links ?? []).map(normalizeVaultPath).filter(Boolean));
    const backlinks = new Set((note.backlinks ?? []).map(normalizeVaultPath).filter(Boolean));
    return clamp01((links.size + backlinks.size) / 10);
}

function noteRichnessSignal(note: QuietRecallVaultNote): number {
    const content = note.content ?? "";
    const lengthScore = clamp01(content.trim().length / 1200);
    const headingCount = (content.match(/^#{1,6}\s+/gm) ?? []).length;
    const headingScore = clamp01(headingCount / 6);
    const tagScore = clamp01((note.tags?.length ?? 0) / 5);
    return clamp01(lengthScore * 0.7 + headingScore * 0.2 + tagScore * 0.1);
}

function semanticRelevanceSignal(path: string, relatedScores: Map<string, number>): number {
    const raw = relatedScores.get(normalizeVaultPath(path)) ?? 0;
    return clamp01(raw);
}

function scoreSignalsForVaultNote(
    note: QuietRecallVaultNote,
    now: Date,
    relatedScores: Map<string, number>,
): RecallScoreSignals {
    return {
        semanticRelevance: semanticRelevanceSignal(note.path, relatedScores),
        timeFreshness: timeFreshnessSignal(note, now),
        connectionDensity: connectionDensitySignal(note),
        noteRichness: noteRichnessSignal(note),
        userFeedback: NEUTRAL_USER_FEEDBACK,
    };
}

function relationForVaultNote(signals: RecallScoreSignals): QuietRecallRelation {
    if (signals.semanticRelevance >= 0.35 || signals.connectionDensity >= 0.4) return "related";
    return "far";
}

function titleForVaultNote(note: QuietRecallVaultNote): string {
    const title = note.title?.trim() || fileStem(note.path);
    return `Recall: ${title}`;
}

function summaryForVaultNote(note: QuietRecallVaultNote): string {
    const title = note.title?.trim() || fileStem(note.path);
    const tags = (note.tags ?? [])
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 3);
    if (tags.length > 0) {
        return `${title} may be useful again for the current context. Tags: ${tags.join(", ")}.`;
    }
    return `${title} may be useful again for the current context.`;
}

function whyNowForVaultNote(signals: RecallScoreSignals): string[] {
    const reasons: string[] = [];
    if (signals.semanticRelevance >= 0.75) {
        reasons.push("This note appears strongly related to the note you are viewing.");
    } else if (signals.semanticRelevance >= 0.35) {
        reasons.push("This note appears related to the note you are viewing.");
    }
    if (signals.timeFreshness >= 0.75) {
        reasons.push("It was updated recently.");
    }
    if (signals.connectionDensity >= 0.5) {
        reasons.push("It is connected to several other notes.");
    }
    if (signals.noteRichness >= 0.6) {
        reasons.push("It has enough detail to be worth revisiting.");
    }
    if (reasons.length === 0) {
        reasons.push("It has structural overlap with the current context.");
    }
    return reasons;
}

function sourceRefForVaultNote(
    note: QuietRecallVaultNote,
    generatedAt: string,
    score: number,
    whyShown: readonly string[],
): PersistedSourceRef {
    return {
        path: normalizeVaultPath(note.path),
        generatedAt,
        evidenceStrength: score >= 65 ? "medium" : "weak",
        whyShown: whyShown.slice(0, 3),
    };
}

function vaultNoteCandidate(
    note: QuietRecallVaultNote,
    options: {
        now: Date;
        generatedAt: string;
        currentPath: string | null;
        relatedScores: Map<string, number>;
        isPathAllowed: (path: string) => boolean;
    },
): QuietRecallCandidate | null {
    const path = normalizeVaultPath(note.path);
    if (!path) return null;
    if (options.currentPath && path === options.currentPath) return null;
    if (!options.isPathAllowed(path)) return null;

    const signals = scoreSignalsForVaultNote({ ...note, path }, options.now, options.relatedScores);
    if (signals.semanticRelevance <= 0) return null;
    const score = Math.min(MAX_VAULT_NOTE_SCORE, computeRecallScore(signals));
    if (score <= 0) return null;
    const whyNow = whyNowForVaultNote(signals);
    return {
        id: `qr-vault-${stableHash(path)}`,
        title: titleForVaultNote({ ...note, path }),
        summary: summaryForVaultNote({ ...note, path }),
        sourceRefs: [sourceRefForVaultNote({ ...note, path }, options.generatedAt, score, whyNow)],
        whyNow,
        nextAction: "Open this note and decide whether the connection still matters.",
        relation: relationForVaultNote(signals),
        score,
        generatedAt: options.generatedAt,
        context: { kind: "note_retrieval" },
    };
}

export function buildQuietRecallCandidates(input: QuietRecallBuildInput = {}): QuietRecallRunResult {
    const now = nowDate(input.now);
    const generatedAt = now.toISOString();
    const currentPath = input.currentNote?.path ? normalizeVaultPath(input.currentNote.path) : null;
    const maxCandidates = input.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
    const staleAfterDays = input.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS;
    const relatedScores = new Map<string, number>();
    for (const related of input.relatedNotes ?? []) {
        const path = normalizeVaultPath(related.path);
        if (!path) continue;
        relatedScores.set(path, Math.max(relatedScores.get(path) ?? 0, related.score ?? 0.5));
    }

    const isPathAllowed = input.isPathAllowed ?? (() => true);
    const candidates: QuietRecallCandidate[] = [];
    const seenVaultNotePaths = new Set<string>();
    for (const insight of input.savedInsights ?? []) {
        if (insight.status !== "active") continue;
        if (!sourceRefsAreValid(insight.sourceRefs)) continue;
        if (insightIsStale(insight, now, staleAfterDays)) continue;
        if (insight.sourceRefs.some((ref) => !isPathAllowed(ref.path))) continue;
        const relation = relationForInsight(insight, currentPath, relatedScores);
        if (!relation) continue;
        candidates.push({
            id: `qr-${insight.id}`,
            title: titleForInsight(insight),
            summary: insight.text,
            sourceInsightId: insight.id,
            sourceRefs: insight.sourceRefs.map(cloneSourceRef),
            whyNow: [...relation.whyNow, ...insight.whyShown.slice(0, 2)],
            nextAction: nextActionForRelation(relation.relation),
            relation: relation.relation,
            score: relation.score,
            generatedAt,
            context: { kind: "note_retrieval" },
        });
    }
    for (const note of input.vaultNotes ?? []) {
        const path = normalizeVaultPath(note.path);
        if (!path || seenVaultNotePaths.has(path)) continue;
        seenVaultNotePaths.add(path);
        const candidate = vaultNoteCandidate(note, {
            now,
            generatedAt,
            currentPath,
            relatedScores,
            isPathAllowed,
        });
        if (candidate) candidates.push(candidate);
    }

    candidates.sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.title.localeCompare(right.title);
    });

    return {
        generatedAt,
        currentPath: currentPath ?? undefined,
        totalCount: Math.min(maxCandidates, candidates.length),
        candidates: candidates.slice(0, maxCandidates),
    };
}

export function quietRecallGovernedClaimId(candidate: QuietRecallCandidate): string | null {
    if (candidate.context?.kind !== "governed_claim") return null;
    const claimId = candidate.context.claimId;
    return claimId && claimId === claimId.trim() ? claimId : null;
}

export function quietRecallCandidateToSavedInsightInput(candidate: QuietRecallCandidate): {
    type: "observation";
    text: string;
    origin: "pa-recommended";
    sourceRefs: PersistedSourceRef[];
    whyShown: string[];
    dataBoundarySnapshotId?: string;
    replayRef: string;
} {
    return {
        type: "observation",
        text: candidate.summary,
        origin: "pa-recommended",
        sourceRefs: candidate.sourceRefs.map(cloneSourceRef),
        whyShown: [
            ...candidate.whyNow,
            `Quiet Recall relation: ${candidate.relation}`,
        ],
        dataBoundarySnapshotId: candidate.sourceRefs[0]?.sourceId ?? "data_boundary:allowed_by_policy",
        replayRef: candidate.id,
    };
}

export function quietRecallCandidateToBubbleNudge(
    candidate: QuietRecallCandidate,
    options: { currentPath?: string } = {},
): QuietRecallBubbleNudge {
    const currentPath = options.currentPath ? normalizeVaultPath(options.currentPath) : "";
    return {
        candidateId: candidate.id,
        ...(candidate.sourceInsightId ? { sourceInsightId: candidate.sourceInsightId } : {}),
        ...(currentPath ? { currentPath } : {}),
        relation: candidate.relation,
        generatedAt: candidate.generatedAt,
    };
}

export function quietRecallCandidateToReviewQueueInput(
    candidate: QuietRecallCandidate,
    options: { admissionReason: ReviewQueueCreateInput["admissionReason"] },
): ReviewQueueCreateInput {
    return {
        type: "related_note",
        title: candidate.title,
        claim: candidate.summary,
        scope: {
            kind: "custom",
            label: "Quiet Recall",
            paths: candidate.sourceRefs.map((ref) => ref.path),
        },
        sourceRefs: candidate.sourceRefs.map(cloneSourceRef),
        originSurface: "pagelet",
        priority: candidate.relation === "current" ? "normal" : "low",
        whyShown: candidate.whyNow,
        dataBoundarySnapshotId: candidate.sourceRefs[0]?.sourceId ?? "data_boundary:allowed_by_policy",
        admissionReason: options.admissionReason,
        replayRef: candidate.id,
        metadata: {
            sourceInsightId: candidate.sourceInsightId ?? null,
            relation: candidate.relation,
            score: candidate.score,
        },
    };
}

export function coerceQuietRecallSaveResult(result: SavedInsightResult<SavedInsight>): QuietRecallSaveResult {
    if (result.ok) {
        return {
            ok: true,
            value: result.value,
            message: "Saved recall as insight.",
        };
    }
    return {
        ok: false,
        reason: result.reason,
        message: `Could not save recall insight: ${result.reason}`,
    };
}

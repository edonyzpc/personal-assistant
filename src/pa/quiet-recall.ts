import {
    hasForbiddenPersistedTextFields,
    validateSourceRefPathShape,
    type PersistedSourceRef,
} from "./contracts";
import type { ReviewQueueCreateInput } from "./review-queue-store";
import type { SavedInsight, SavedInsightResult } from "./saved-insight-store";

export type QuietRecallRelation = "current" | "related" | "far";

export interface QuietRecallCurrentNote {
    path: string;
    title?: string;
    content?: string;
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
    sourceInsightId: string;
    sourceRefs: PersistedSourceRef[];
    whyNow: string[];
    nextAction: string;
    relation: QuietRecallRelation;
    score: number;
    generatedAt: string;
}

export interface QuietRecallRunResult {
    generatedAt: string;
    currentPath?: string;
    totalCount: number;
    candidates: QuietRecallCandidate[];
}

export interface QuietRecallBubbleNudge {
    candidateId: string;
    sourceInsightId: string;
    relation: QuietRecallRelation;
    generatedAt: string;
}

export interface QuietRecallBuildInput {
    now?: Date | (() => Date);
    currentNote?: QuietRecallCurrentNote | null;
    relatedNotes?: readonly QuietRecallRelatedNote[];
    savedInsights?: readonly SavedInsight[];
    maxCandidates?: number;
    staleAfterDays?: number;
}

export type QuietRecallSaveResult =
    | { ok: true; value: SavedInsight; message: string }
    | { ok: false; reason: string; message: string };

const DEFAULT_MAX_CANDIDATES = 5;
const DEFAULT_STALE_AFTER_DAYS = 180;
const CURRENT_RELEVANCE_BASE = 80;
const RELATED_RELEVANCE_BASE = 48;
const FAR_ASSOCIATION_CAP = 35;

function normalizeVaultPath(path: string): string {
    return String(path ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/").replace(/\/$/g, "");
}

function nowDate(now: QuietRecallBuildInput["now"]): Date {
    const value = typeof now === "function" ? now() : now;
    return value ? new Date(value.getTime()) : new Date();
}

function fileStem(path: string): string {
    const name = normalizeVaultPath(path).split("/").pop() ?? path;
    return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

function cloneSourceRef(ref: PersistedSourceRef): PersistedSourceRef {
    return {
        ...ref,
        whyShown: ref.whyShown ? [...ref.whyShown] : undefined,
    };
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

    const candidates: QuietRecallCandidate[] = [];
    for (const insight of input.savedInsights ?? []) {
        if (insight.status !== "active") continue;
        if (!sourceRefsAreValid(insight.sourceRefs)) continue;
        if (insightIsStale(insight, now, staleAfterDays)) continue;
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
        });
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

export function quietRecallCandidateToBubbleNudge(candidate: QuietRecallCandidate): QuietRecallBubbleNudge {
    return {
        candidateId: candidate.id,
        sourceInsightId: candidate.sourceInsightId,
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
            sourceInsightId: candidate.sourceInsightId,
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

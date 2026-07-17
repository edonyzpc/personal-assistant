import {
    hasForbiddenPersistedTextFields,
    validateSourceRefPathShape,
    type PersistedSourceRef,
} from "./contracts";
import { pageletT, type PageletLocale } from "../locales/pagelet";
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
    locale?: PageletLocale;
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

export interface RecallNoteDigest {
    title: string;
    headings: string[];
    firstParagraph: string;
}

export interface RecallRelevanceResult {
    isConvincing: boolean;
    whyNow: string | null;
}

export type RecallRelevanceEvaluator = (input: {
    currentDigest: RecallNoteDigest;
    candidateDigest: RecallNoteDigest;
    candidateAge: string;
}) => Promise<RecallRelevanceResult>;

const DEFAULT_MAX_CANDIDATES = 5;
const DEFAULT_STALE_AFTER_DAYS = 180;
const CURRENT_RELEVANCE_BASE = 80;
const RELATED_RELEVANCE_BASE = 48;
const FAR_ASSOCIATION_CAP = 35;
const MAX_VAULT_NOTE_SCORE = 72;
const NEUTRAL_USER_FEEDBACK = 0.5;
export const QUIET_RECALL_BUBBLE_MIN_SCORE = 65;
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
    locale: PageletLocale,
): { relation: QuietRecallRelation; score: number; whyNow: string[]; matchedPath?: string } | null {
    const normalizedRefs = insight.sourceRefs.map((ref) => normalizeVaultPath(ref.path));
    const reasons: string[] = [];

    if (currentPath && normalizedRefs.includes(currentPath)) {
        reasons.push(pageletT("pagelet.recall.generated.why.current", locale));
        return {
            relation: "current",
            score: CURRENT_RELEVANCE_BASE + evidenceWeight(insight.sourceRefs),
            whyNow: reasons,
            matchedPath: currentPath,
        };
    }

    let bestRelatedScore = 0;
    let matchedPath: string | undefined;
    for (const path of normalizedRefs) {
        const relatedScore = relatedScores.get(path) ?? 0;
        if (relatedScore > bestRelatedScore) {
            bestRelatedScore = relatedScore;
            matchedPath = path;
        }
    }
    if (bestRelatedScore > 0) {
        reasons.push(pageletT("pagelet.recall.generated.why.related", locale));
        return {
            relation: "related",
            score: RELATED_RELEVANCE_BASE + Math.min(12, Math.round(bestRelatedScore * 12)) + evidenceWeight(insight.sourceRefs),
            whyNow: reasons,
            matchedPath,
        };
    }

    if (isWeakOnly(insight.sourceRefs)) return null;
    reasons.push(pageletT("pagelet.recall.generated.why.far", locale));
    return {
        relation: "far",
        score: Math.min(FAR_ASSOCIATION_CAP, 20 + evidenceWeight(insight.sourceRefs)),
        whyNow: reasons,
    };
}

function titleForInsight(sourceRefs: readonly PersistedSourceRef[], locale: PageletLocale): string {
    const source = sourceRefs[0]?.path;
    const stem = source ? fileStem(source) : "saved insight";
    return pageletT("pagelet.recall.generated.title", locale, { title: stem });
}

function nextActionForRelation(relation: QuietRecallRelation, locale: PageletLocale): string {
    return pageletT(`pagelet.recall.generated.next.${relation}`, locale);
}

function reorderSourceRefs(
    sourceRefs: readonly PersistedSourceRef[],
    matchedPath: string | undefined,
): PersistedSourceRef[] {
    const cloned = sourceRefs.map(cloneSourceRef);
    if (!matchedPath) return cloned;
    const matchedIndex = cloned.findIndex((ref) => normalizeVaultPath(ref.path) === matchedPath);
    if (matchedIndex <= 0) return cloned;
    const [matched] = cloned.splice(matchedIndex, 1);
    return matched ? [matched, ...cloned] : cloned;
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

function titleForVaultNote(note: QuietRecallVaultNote, locale: PageletLocale): string {
    const title = note.title?.trim() || fileStem(note.path);
    return pageletT("pagelet.recall.generated.title", locale, { title });
}

function summaryForVaultNote(note: QuietRecallVaultNote, locale: PageletLocale): string {
    const title = note.title?.trim() || fileStem(note.path);
    const tags = (note.tags ?? [])
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 3);
    if (tags.length > 0) {
        return pageletT("pagelet.recall.generated.summaryWithTags", locale, {
            title,
            tags: tags.join(locale === "zh" ? "、" : ", "),
        });
    }
    return pageletT("pagelet.recall.generated.summary", locale, { title });
}

function whyNowForVaultNote(signals: RecallScoreSignals, locale: PageletLocale): string[] {
    const reasons: string[] = [];
    if (signals.semanticRelevance >= 0.75) {
        reasons.push(pageletT("pagelet.recall.generated.why.strongRelation", locale));
    } else if (signals.semanticRelevance >= 0.35) {
        reasons.push(pageletT("pagelet.recall.generated.why.relatedRelation", locale));
    }
    if (signals.timeFreshness >= 0.75) {
        reasons.push(pageletT("pagelet.recall.generated.why.recent", locale));
    }
    if (signals.connectionDensity >= 0.5) {
        reasons.push(pageletT("pagelet.recall.generated.why.connected", locale));
    }
    if (signals.noteRichness >= 0.6) {
        reasons.push(pageletT("pagelet.recall.generated.why.rich", locale));
    }
    if (reasons.length === 0) {
        reasons.push(pageletT("pagelet.recall.generated.why.structural", locale));
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
        evidenceStrength: score >= QUIET_RECALL_BUBBLE_MIN_SCORE ? "medium" : "weak",
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
        locale: PageletLocale;
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
    const whyNow = whyNowForVaultNote(signals, options.locale);
    return {
        id: `qr-vault-${stableHash(path)}`,
        title: titleForVaultNote({ ...note, path }, options.locale),
        summary: summaryForVaultNote({ ...note, path }, options.locale),
        sourceRefs: [sourceRefForVaultNote({ ...note, path }, options.generatedAt, score, whyNow)],
        whyNow,
        nextAction: nextActionForRelation("related", options.locale),
        relation: relationForVaultNote(signals),
        score,
        generatedAt: options.generatedAt,
        context: { kind: "note_retrieval" },
    };
}

export function buildQuietRecallCandidates(input: QuietRecallBuildInput = {}): QuietRecallRunResult {
    const now = nowDate(input.now);
    const locale = input.locale ?? "en";
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
        const relation = relationForInsight(insight, currentPath, relatedScores, locale);
        if (!relation) continue;
        const sourceRefs = reorderSourceRefs(insight.sourceRefs, relation.matchedPath);
        candidates.push({
            id: `qr-${insight.id}`,
            title: titleForInsight(sourceRefs, locale),
            summary: insight.text,
            sourceInsightId: insight.id,
            sourceRefs,
            whyNow: [...relation.whyNow, ...insight.whyShown.slice(0, 2)],
            nextAction: nextActionForRelation(relation.relation, locale),
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
            locale,
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

export function quietRecallLinkTargetPath(
    candidate: { sourceRefs: readonly { path: string }[] } | null | undefined,
    currentPath: string | null | undefined,
): string | null {
    const normalizedCurrentPath = normalizeVaultPath(currentPath ?? "");
    if (!candidate || !normalizedCurrentPath) return null;
    for (const ref of candidate.sourceRefs) {
        const normalizedPath = normalizeVaultPath(ref.path);
        if (normalizedPath && normalizedPath !== normalizedCurrentPath) return normalizedPath;
    }
    return null;
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
        whyShown: [...candidate.whyNow],
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

export function extractRecallDigest(
    note: QuietRecallVaultNote | QuietRecallCurrentNote,
): RecallNoteDigest {
    const path = note.path ?? "";
    const title = note.title?.trim() || fileStem(path);
    const content = note.content ?? "";
    const lines = content.split("\n");

    const headings: string[] = [];
    for (const line of lines) {
        const match = line.match(/^##\s+(.+)/);
        if (match && match[1]) {
            headings.push(match[1].trim());
        }
    }

    let firstParagraph = "";
    let inParagraph = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            if (inParagraph) break;
            continue;
        }
        if (trimmed.startsWith("#")) {
            if (inParagraph) break;
            continue;
        }
        inParagraph = true;
        firstParagraph += (firstParagraph ? " " : "") + trimmed;
    }

    return { title, headings, firstParagraph };
}

function formatCandidateAge(note: QuietRecallVaultNote, now: Date): string {
    const dateStr = note.modifiedAt ?? note.createdAt;
    const ageDays = daysBetween(now, dateStr);
    if (ageDays === null) return "unknown";
    if (ageDays < 1) return "today";
    if (ageDays < 7) return `${Math.round(ageDays)} days`;
    if (ageDays < 30) return `${Math.round(ageDays / 7)} weeks`;
    if (ageDays < 365) return `${Math.round(ageDays / 30)} months`;
    return `${Math.round(ageDays / 365)} years`;
}

export async function evaluateRecallWithLlm(
    currentDigest: RecallNoteDigest,
    candidateDigest: RecallNoteDigest,
    candidateAge: string,
    evaluateRelevance: RecallRelevanceEvaluator,
): Promise<RecallRelevanceResult> {
    try {
        return await evaluateRelevance({
            currentDigest,
            candidateDigest,
            candidateAge,
        });
    } catch {
        return { isConvincing: false, whyNow: null };
    }
}

export interface QuietRecallWithLlmInput extends QuietRecallBuildInput {
    evaluateRelevance: RecallRelevanceEvaluator;
    scoreThreshold?: number;
}

export async function buildQuietRecallWithLlm(
    input: QuietRecallWithLlmInput,
): Promise<QuietRecallRunResult> {
    const baseResult = buildQuietRecallCandidates(input);
    const scoreThreshold = input.scoreThreshold ?? 0;
    const now = nowDate(input.now);

    const currentNote = input.currentNote;
    if (!currentNote) return baseResult;

    const currentDigest = extractRecallDigest(currentNote);

    const filteredCandidates: QuietRecallCandidate[] = [];

    for (const candidate of baseResult.candidates) {
        if (candidate.score < scoreThreshold) {
            filteredCandidates.push(candidate);
            continue;
        }

        const matchedVaultNote = findMatchingVaultNote(candidate, input.vaultNotes ?? []);
        const candidateDigest = matchedVaultNote
            ? extractRecallDigest(matchedVaultNote)
            : digestFromCandidate(candidate);
        const candidateAge = matchedVaultNote
            ? formatCandidateAge(matchedVaultNote, now)
            : "unknown";

        const result = await evaluateRecallWithLlm(
            currentDigest,
            candidateDigest,
            candidateAge,
            input.evaluateRelevance,
        );

        if (result.isConvincing && result.whyNow) {
            filteredCandidates.push({
                ...candidate,
                whyNow: [result.whyNow],
            });
        }
    }

    return {
        ...baseResult,
        totalCount: filteredCandidates.length,
        candidates: filteredCandidates,
    };
}

function findMatchingVaultNote(
    candidate: QuietRecallCandidate,
    vaultNotes: readonly QuietRecallVaultNote[],
): QuietRecallVaultNote | null {
    const candidatePaths = new Set(
        candidate.sourceRefs.map((ref) => normalizeVaultPath(ref.path)),
    );
    for (const note of vaultNotes) {
        if (candidatePaths.has(normalizeVaultPath(note.path))) return note;
    }
    return null;
}

function digestFromCandidate(candidate: QuietRecallCandidate): RecallNoteDigest {
    return {
        title: candidate.title.replace(/^(Recall:|回忆：)\s*/, ""),
        headings: [],
        firstParagraph: candidate.summary,
    };
}

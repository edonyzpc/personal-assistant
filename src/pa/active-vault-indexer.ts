import {
    toReplaySourceRef,
    type EvidenceStrength,
    type PersistedSourceRef,
    type RetrievalLane,
    type RetrievalOutcome,
    type RetrievalOutcomeStatus,
    type SkippedSourceRef,
    type UISourceRef,
} from "./contracts";
import { normalizeVaultPath } from "./helpers";
import {
    applyRetrievalHabitProfileToEvidence,
    type RetrievalHabitProfileSettings,
} from "./retrieval-habit-profile";

export interface ActiveVaultIndexerRawResult {
    score?: unknown;
    doc?: {
        pageContent?: unknown;
        metadata?: Record<string, unknown>;
    };
}

export interface ActiveVaultIndexerSearchOptions {
    ftsQueryOverride?: string | null;
    signal?: AbortSignal;
}

export interface ActiveVaultIndexerSearchPort {
    searchHybrid(query: string, options?: ActiveVaultIndexerSearchOptions): Promise<ActiveVaultIndexerRawResult[]>;
}

export interface ActiveVaultEvidence {
    path: string;
    content: string;
    score: number;
    evidenceStrength: EvidenceStrength;
    whyShown: string[];
    lanes: RetrievalLane[];
    conflictKey?: string;
    conflictValue?: string;
    headingPath?: string[];
    sourceRef: PersistedSourceRef;
}

export interface ActiveVaultActivitySignals {
    currentPath?: string | null;
    selectedPaths?: readonly string[];
    recentEditPaths?: readonly string[];
    changedPaths?: readonly string[];
    scopeLabels?: readonly string[];
}

export interface ActiveVaultStructureHints {
    folders?: readonly string[];
    tags?: readonly string[];
    links?: readonly string[];
    aliases?: readonly string[];
}

export interface ActiveVaultRetrievalOptions extends ActiveVaultIndexerSearchOptions {
    id?: string;
    taskKind?: string;
    scope?: string;
    excludedPaths?: readonly string[];
    isPathAllowed?: (path: string) => boolean;
    activity?: ActiveVaultActivitySignals;
    structureHints?: ActiveVaultStructureHints;
    retrievalHabitProfile?: RetrievalHabitProfileSettings;
    limit?: number;
}

export interface ActiveVaultRetrievalResult {
    outcome: RetrievalOutcome;
    evidence: ActiveVaultEvidence[];
}

export interface SourcesToCheckPlanSourceInput {
    path: string;
    groupLabel?: string;
    decision: "include" | "exclude" | "ask";
    reason?: string;
    providerDisclosureReason?: string;
    costNote?: string;
    policySnapshotId?: string;
}

export interface SourcesToCheckPlanGroup {
    id: string;
    label: string;
    decision: "included" | "excluded" | "ask";
    paths: string[];
    count: number;
    reasons: string[];
    providerDisclosureReasons: string[];
    costNotes: string[];
    policySnapshotIds: string[];
}

export interface SourcesToCheckPlan {
    id: string;
    taskKind?: string;
    scope?: string;
    includedGroups: SourcesToCheckPlanGroup[];
    excludedGroups: SourcesToCheckPlanGroup[];
    askGroups: SourcesToCheckPlanGroup[];
    providerDisclosureRequired: boolean;
    providerDisclosureReasons: string[];
    costNotes: string[];
}

export type SourcesToCheckPlanDecision = "confirm" | "cancel" | "adjust";

export interface SourcesToCheckPlanDecisionResult<T = unknown> {
    decision: SourcesToCheckPlanDecision;
    confirmed: boolean;
    result?: T;
}

export interface RetrievalReplayRecord {
    runId: string;
    retrievalOutcomeId: string;
    sourceRefs: PersistedSourceRef[];
    skippedSourceRefs: PersistedSourceRef[];
    reasons: string[];
    policySnapshotId?: string;
    dataBoundarySnapshotId?: string;
}

export type ReplaySourceReader = (path: string) => string | null | undefined | Promise<string | null | undefined>;

const DEFAULT_RESULT_LIMIT = 8;
const UNIT_SCORE_NEAR_TIE_WINDOW = 0.05;
const WIDE_SCORE_NEAR_TIE_WINDOW = 2;
const STRUCTURE_SCORE_EPSILON = 0.0001;
const ACTIVITY_SCORE_EPSILON = 0.0002;

export class ActiveVaultIndexer {
    constructor(private readonly port: ActiveVaultIndexerSearchPort) {}

    async retrieveSemantic(
        query: string,
        options: ActiveVaultRetrievalOptions = {},
    ): Promise<ActiveVaultRetrievalResult> {
        const id = options.id ?? `avi-${Date.now().toString(36)}`;
        const raw = await this.port.searchHybrid(query, {
            ftsQueryOverride: options.ftsQueryOverride,
            signal: options.signal,
        });
        return mapSearchResultsToRetrievalOutcome(raw, {
            id,
            taskKind: options.taskKind,
            scope: options.scope,
            excludedPaths: options.excludedPaths,
            isPathAllowed: options.isPathAllowed,
            activity: options.activity,
            structureHints: options.structureHints,
            retrievalHabitProfile: options.retrievalHabitProfile,
            limit: options.limit,
        });
    }
}

export function mapSearchResultsToRetrievalOutcome(
    rawResults: readonly ActiveVaultIndexerRawResult[],
    options: Omit<ActiveVaultRetrievalOptions, "ftsQueryOverride" | "signal"> = {},
): ActiveVaultRetrievalResult {
    const id = options.id ?? "avi-test";
    const excludedPaths = new Set((options.excludedPaths ?? []).map(normalizeVaultPath));
    const candidates: ActiveVaultEvidence[] = [];
    const skippedSources: SkippedSourceRef[] = [];
    const seenEvidence = new Set<string>();
    const seenSkipped = new Set<string>();
    const limit = Math.max(1, options.limit ?? DEFAULT_RESULT_LIMIT);

    for (const result of rawResults) {
        const metadata = result.doc?.metadata ?? {};
        const path = typeof metadata.path === "string" ? normalizeVaultPath(metadata.path) : "";
        if (!path || excludedPaths.has(path)) continue;

        const content = stringifyContent(result.doc?.pageContent);
        const score = normalizeScore(result.score);
        const headingPath = Array.isArray(metadata.headingPath)
            ? metadata.headingPath.filter((entry): entry is string => typeof entry === "string")
            : undefined;

        if (options.isPathAllowed && !options.isPathAllowed(path)) {
            if (!seenSkipped.has(path)) {
                skippedSources.push({
                    ...createPersistedSourceRef({
                        id,
                        path,
                        content,
                        metadata,
                        headingPath,
                        score,
                        whyShown: ["Excluded by Data Boundary"],
                    }),
                    skippedReason: "data_boundary",
                    boundaryReason: "denied_by_data_boundary",
                });
                seenSkipped.add(path);
            }
            continue;
        }

        if (seenEvidence.has(path)) continue;
        if (score <= 0) continue;
        const activityReasons = getActivityReasons(path, options.activity);
        const structureReasons = getStructureReasons(path, metadata, options.structureHints);
        const conflictSignal = getConflictSignal(metadata);
        const whyShown = ["Matched by content", ...activityReasons, ...structureReasons];
        const lanes = getCandidateLanes(activityReasons, structureReasons);
        const evidenceStrength = scoreToEvidenceStrength(score);
        const sourceRef = createPersistedSourceRef({
            id,
            path,
            content,
            metadata,
            headingPath,
            score,
            whyShown,
        });
        candidates.push({
            path,
            content,
            score,
            evidenceStrength,
            whyShown,
            lanes,
            conflictKey: conflictSignal?.key,
            conflictValue: conflictSignal?.value,
            headingPath,
            sourceRef,
        });
        seenEvidence.add(path);
    }

    const rankedCandidates = options.retrievalHabitProfile
        ? applyRetrievalHabitProfileToEvidence(candidates, options.retrievalHabitProfile)
        : candidates;
    const evidence = rankedCandidates
        .sort(compareEvidence)
        .slice(0, limit);
    const sources = evidence.map((entry) => entry.sourceRef);
    const conflict = detectConflict(evidence);
    const status = classifyRetrievalOutcome(evidence, skippedSources, conflict.conflictingSources);
    const outcome: RetrievalOutcome = {
        id,
        status,
        taskKind: options.taskKind,
        scope: options.scope,
        sources,
        skippedSources,
        lanes: getOutcomeLanes(evidence),
        whyShown: getOutcomeWhyShown(evidence),
        confidence: sources.length > 0 ? Math.max(...evidence.map((entry) => entry.score)) : 0,
    };
    if (conflict.conflictingSources.length > 0) {
        outcome.conflictingSources = conflict.conflictingSources;
        outcome.conflictSummary = conflict.summary;
    }
    return { outcome, evidence };
}

export function createSourcesToCheckPlan(input: {
    id: string;
    taskKind?: string;
    scope?: string;
    sources: readonly SourcesToCheckPlanSourceInput[];
}): SourcesToCheckPlan {
    const includedGroups = new Map<string, SourcesToCheckPlanGroup>();
    const excludedGroups = new Map<string, SourcesToCheckPlanGroup>();
    const askGroups = new Map<string, SourcesToCheckPlanGroup>();

    for (const source of input.sources) {
        const decision = source.decision === "include"
            ? "included"
            : source.decision === "exclude"
                ? "excluded"
                : "ask";
        const groupMap = decision === "included"
            ? includedGroups
            : decision === "excluded"
                ? excludedGroups
                : askGroups;
        const label = source.groupLabel?.trim() || decision;
        const group = getOrCreatePlanGroup(groupMap, label, decision);
        group.paths.push(normalizeVaultPath(source.path));
        group.count += 1;
        addUnique(group.reasons, source.reason);
        addUnique(group.providerDisclosureReasons, source.providerDisclosureReason);
        addUnique(group.costNotes, source.costNote);
        addUnique(group.policySnapshotIds, source.policySnapshotId);
    }

    const askGroupValues = [...askGroups.values()];
    const providerDisclosureReasons = uniqueStrings([
        ...[...includedGroups.values()].flatMap((group) => group.providerDisclosureReasons),
        ...askGroupValues.flatMap((group) => group.providerDisclosureReasons),
    ]);
    const costNotes = uniqueStrings([
        ...[...includedGroups.values()].flatMap((group) => group.costNotes),
        ...askGroupValues.flatMap((group) => group.costNotes),
    ]);

    return {
        id: input.id,
        taskKind: input.taskKind,
        scope: input.scope,
        includedGroups: [...includedGroups.values()],
        excludedGroups: [...excludedGroups.values()],
        askGroups: askGroupValues,
        providerDisclosureRequired: providerDisclosureReasons.length > 0 || askGroupValues.length > 0,
        providerDisclosureReasons,
        costNotes,
    };
}

export async function resolveSourcesToCheckPlanDecision<T>(
    _plan: SourcesToCheckPlan,
    decision: SourcesToCheckPlanDecision,
    onConfirm?: () => T | Promise<T>,
): Promise<SourcesToCheckPlanDecisionResult<T>> {
    if (decision !== "confirm") {
        return { decision, confirmed: false };
    }
    const result = onConfirm ? await onConfirm() : undefined;
    return { decision, confirmed: true, result };
}

export function createRetrievalReplayRecord(
    outcome: RetrievalOutcome,
    options: {
        runId: string;
        policySnapshotId?: string;
        reasons?: readonly string[];
    },
): RetrievalReplayRecord {
    return {
        runId: options.runId,
        retrievalOutcomeId: outcome.id,
        sourceRefs: outcome.sources.map(sanitizePersistedSourceRef),
        skippedSourceRefs: outcome.skippedSources.map(sanitizePersistedSourceRef),
        reasons: [...(options.reasons ?? outcome.whyShown ?? [])],
        policySnapshotId: options.policySnapshotId,
        dataBoundarySnapshotId: outcome.dataBoundarySnapshotId,
    };
}

export async function resolveReplaySourceExcerpt(
    record: RetrievalReplayRecord,
    path: string,
    readSource: ReplaySourceReader,
    isPathAllowed?: (path: string) => boolean,
): Promise<string | null> {
    const normalizedPath = normalizeVaultPath(path);
    const known = [...record.sourceRefs, ...record.skippedSourceRefs]
        .some((source) => normalizeVaultPath(source.path) === normalizedPath);
    if (!known) return null;
    if (isPathAllowed && !isPathAllowed(normalizedPath)) return null;
    const content = await readSource(normalizedPath);
    return typeof content === "string" ? content : null;
}

function createPersistedSourceRef(input: {
    id: string;
    path: string;
    content: string;
    metadata: Record<string, unknown>;
    headingPath?: string[];
    score: number;
    whyShown: string[];
}): PersistedSourceRef {
    const heading = input.headingPath?.length ? input.headingPath.join(" > ") : undefined;
    const uiRef: UISourceRef = {
        path: input.path,
        excerpt: input.content,
        whyShown: input.whyShown,
        evidenceStrength: scoreToEvidenceStrength(input.score),
    };
    if (heading) uiRef.heading = heading;
    if (typeof input.metadata.contentHash === "string") uiRef.contentHash = input.metadata.contentHash;
    return {
        ...toReplaySourceRef(uiRef),
        sourceId: stableSourceId(input.path),
        retrievalOutcomeId: input.id,
    };
}

function scoreToEvidenceStrength(score: number): EvidenceStrength {
    if (score >= 0.7) return "strong";
    if (score >= 0.25) return "medium";
    return "weak";
}

function compareEvidence(left: ActiveVaultEvidence, right: ActiveVaultEvidence): number {
    const strengthDelta = evidenceStrengthRank(right.evidenceStrength) - evidenceStrengthRank(left.evidenceStrength);
    if (strengthDelta !== 0) return strengthDelta;
    const scoreDelta = right.score - left.score;
    const nearTieWindow = scoresLookUnitScale(left.score, right.score)
        ? UNIT_SCORE_NEAR_TIE_WINDOW
        : WIDE_SCORE_NEAR_TIE_WINDOW;
    if (Math.abs(scoreDelta) > nearTieWindow) return scoreDelta;
    const rightSignals = getSignalWeight(right);
    const leftSignals = getSignalWeight(left);
    if (rightSignals !== leftSignals) return rightSignals - leftSignals;
    return scoreDelta;
}

function scoresLookUnitScale(leftScore: number, rightScore: number): boolean {
    return Math.max(Math.abs(leftScore), Math.abs(rightScore)) <= 1;
}

function getSignalWeight(evidence: ActiveVaultEvidence): number {
    let weight = 0;
    if (evidence.lanes.includes("activity")) weight += ACTIVITY_SCORE_EPSILON;
    if (evidence.lanes.includes("structure")) weight += STRUCTURE_SCORE_EPSILON;
    return weight;
}

function evidenceStrengthRank(strength: EvidenceStrength): number {
    if (strength === "strong") return 3;
    if (strength === "medium") return 2;
    if (strength === "weak") return 1;
    return 0;
}

function getCandidateLanes(activityReasons: readonly string[], structureReasons: readonly string[]): RetrievalLane[] {
    const lanes: RetrievalLane[] = ["source", "semantic"];
    if (structureReasons.length > 0) lanes.push("structure");
    if (activityReasons.length > 0) lanes.push("activity");
    return lanes;
}

function getOutcomeLanes(evidence: readonly ActiveVaultEvidence[]): RetrievalLane[] {
    const lanes = new Set<RetrievalLane>();
    for (const entry of evidence) {
        for (const lane of entry.lanes) lanes.add(lane);
    }
    return [...lanes];
}

function getOutcomeWhyShown(evidence: readonly ActiveVaultEvidence[]): string[] {
    return uniqueStrings(evidence.flatMap((entry) => entry.whyShown));
}

function getActivityReasons(path: string, activity?: ActiveVaultActivitySignals): string[] {
    if (!activity) return [];
    const normalizedPath = normalizeVaultPath(path);
    const reasons: string[] = [];
    if (activity.currentPath && normalizeVaultPath(activity.currentPath) === normalizedPath) {
        reasons.push("Current note context");
    }
    if (pathSet(activity.selectedPaths).has(normalizedPath)) reasons.push("Selected note context");
    if (pathSet(activity.recentEditPaths).has(normalizedPath)) reasons.push("Recently edited note");
    if (pathSet(activity.changedPaths).has(normalizedPath)) reasons.push("Recently changed note");
    for (const label of activity.scopeLabels ?? []) {
        const trimmed = label.trim();
        if (trimmed) reasons.push(`Scope: ${trimmed}`);
    }
    return uniqueStrings(reasons);
}

function getStructureReasons(
    path: string,
    metadata: Record<string, unknown>,
    hints?: ActiveVaultStructureHints,
): string[] {
    if (!hints) return [];
    const reasons: string[] = [];
    const folder = getFolder(path, metadata);
    const folders = new Set((hints.folders ?? []).map(normalizeVaultPath).filter(Boolean));
    if (folder && folders.has(folder)) reasons.push("Same folder");

    const sourceTags = new Set(readStringList(metadata.tags).map(normalizeTag));
    for (const tag of hints.tags ?? []) {
        const normalizedTag = normalizeTag(tag);
        if (normalizedTag && sourceTags.has(normalizedTag)) reasons.push(`Shared tag #${normalizedTag}`);
    }

    const sourceLinks = new Set([
        ...readStringList(metadata.links),
        ...readStringList(metadata.backlinks),
    ].map(normalizeVaultPath));
    for (const link of hints.links ?? []) {
        const normalizedLink = normalizeVaultPath(link);
        if (normalizedLink && sourceLinks.has(normalizedLink)) reasons.push("Linked note context");
    }

    const sourceAliases = new Set(readStringList(metadata.aliases).map(normalizeAlias));
    for (const alias of hints.aliases ?? []) {
        const normalizedAlias = normalizeAlias(alias);
        if (normalizedAlias && sourceAliases.has(normalizedAlias)) reasons.push("Shared alias");
    }

    return uniqueStrings(reasons);
}

function classifyRetrievalOutcome(
    evidence: readonly ActiveVaultEvidence[],
    skippedSources: readonly SkippedSourceRef[],
    conflictingSources: readonly PersistedSourceRef[],
): RetrievalOutcomeStatus {
    if (conflictingSources.length >= 2) return "conflict";
    if (evidence.length === 0) return skippedSources.length > 0 ? "blocked_by_privacy" : "no_evidence";
    if (skippedSources.length > 0) return "partial_evidence";
    const strongest = Math.max(...evidence.map((entry) => evidenceStrengthRank(entry.evidenceStrength)));
    return strongest >= evidenceStrengthRank("medium") ? "evidence_found" : "partial_evidence";
}

function detectConflict(evidence: readonly ActiveVaultEvidence[]): {
    conflictingSources: PersistedSourceRef[];
    summary?: string;
} {
    const groups = new Map<string, Map<string, PersistedSourceRef[]>>();
    for (const entry of evidence) {
        if (!entry.conflictKey || !entry.conflictValue) continue;
        const values = groups.get(entry.conflictKey) ?? new Map<string, PersistedSourceRef[]>();
        const refs = values.get(entry.conflictValue) ?? [];
        refs.push(entry.sourceRef);
        values.set(entry.conflictValue, refs);
        groups.set(entry.conflictKey, values);
    }
    for (const [key, values] of groups.entries()) {
        if (values.size < 2) continue;
        return {
            conflictingSources: [...values.values()].flat(),
            summary: `Conflicting source signals for ${key}`,
        };
    }
    return { conflictingSources: [] };
}

function normalizeScore(score: unknown): number {
    return typeof score === "number" && Number.isFinite(score)
        ? score
        : Number.isFinite(Number(score))
            ? Number(score)
            : 0;
}

function normalizeTag(tag: string): string {
    return tag.trim().replace(/^#+/, "").toLowerCase();
}

function normalizeAlias(alias: string): string {
    return alias.trim().toLowerCase();
}

function readStringList(value: unknown): string[] {
    if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
    if (typeof value === "string") return [value];
    return [];
}

function getFolder(path: string, metadata: Record<string, unknown>): string {
    if (typeof metadata.folder === "string") return normalizeVaultPath(metadata.folder).replace(/\/$/, "");
    const normalizedPath = normalizeVaultPath(path);
    const index = normalizedPath.lastIndexOf("/");
    return index > 0 ? normalizedPath.slice(0, index) : "";
}

function getConflictSignal(metadata: Record<string, unknown>): { key: string; value: string } | null {
    const key = typeof metadata.conflictKey === "string" ? metadata.conflictKey.trim() : "";
    const rawValue = metadata.conflictValue;
    const value = typeof rawValue === "string" || typeof rawValue === "number" || typeof rawValue === "boolean"
        ? String(rawValue).trim()
        : "";
    return key && value ? { key, value } : null;
}

function pathSet(paths?: readonly string[]): Set<string> {
    return new Set((paths ?? []).map(normalizeVaultPath).filter(Boolean));
}

function getOrCreatePlanGroup(
    groups: Map<string, SourcesToCheckPlanGroup>,
    label: string,
    decision: SourcesToCheckPlanGroup["decision"],
): SourcesToCheckPlanGroup {
    const id = stableSourceId(`${decision}:${label}`);
    const existing = groups.get(id);
    if (existing) return existing;
    const group: SourcesToCheckPlanGroup = {
        id,
        label,
        decision,
        paths: [],
        count: 0,
        reasons: [],
        providerDisclosureReasons: [],
        costNotes: [],
        policySnapshotIds: [],
    };
    groups.set(id, group);
    return group;
}

function addUnique(values: string[], value: string | undefined): void {
    const trimmed = value?.trim();
    if (trimmed && !values.includes(trimmed)) values.push(trimmed);
}

function uniqueStrings(values: readonly string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function sanitizePersistedSourceRef(ref: PersistedSourceRef): PersistedSourceRef {
    return {
        path: ref.path,
        ...(ref.heading !== undefined ? { heading: ref.heading } : {}),
        ...(ref.blockId !== undefined ? { blockId: ref.blockId } : {}),
        ...(ref.generatedAt !== undefined ? { generatedAt: ref.generatedAt } : {}),
        ...(ref.contentHash !== undefined ? { contentHash: ref.contentHash } : {}),
        ...(ref.excerptHash !== undefined ? { excerptHash: ref.excerptHash } : {}),
        ...(ref.whyShown !== undefined ? { whyShown: [...ref.whyShown] } : {}),
        ...(ref.evidenceStrength !== undefined ? { evidenceStrength: ref.evidenceStrength } : {}),
        ...(ref.sourceId !== undefined ? { sourceId: ref.sourceId } : {}),
        ...(ref.retrievalOutcomeId !== undefined ? { retrievalOutcomeId: ref.retrievalOutcomeId } : {}),
    };
}

function stringifyContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map(stringifyContent).join("");
    if (content == null) return "";
    return String(content);
}

function stableSourceId(path: string): string {
    let hash = 2166136261;
    for (let index = 0; index < path.length; index += 1) {
        hash ^= path.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `source-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

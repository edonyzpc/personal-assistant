import {
    hasForbiddenPersistedTextFields,
    validateSourceRefPathShape,
    type EvidenceStrength,
    type PersistedSourceRef,
    type RetrievalLane,
} from "./contracts";
import type { QuietRecallCandidate } from "./quiet-recall";

export const RETRIEVAL_HABIT_FEEDBACK_KINDS = [
    "view",
    "accept",
    "dismiss",
    "later",
    "not_relevant",
] as const;
export type RetrievalHabitFeedbackKind = typeof RETRIEVAL_HABIT_FEEDBACK_KINDS[number];

export const RETRIEVAL_HABIT_SIGNAL_KINDS = [
    "quiet_recall_relation",
    "quiet_recall_source",
    "quiet_recall_strength",
    "retrieval_lane",
    "retrieval_scope",
    "retrieval_source",
    "retrieval_strength",
    "entry_type",
    "query_type",
] as const;
export type RetrievalHabitSignalKind = typeof RETRIEVAL_HABIT_SIGNAL_KINDS[number];

export const RETRIEVAL_HABIT_RETENTION_DAYS = 90;
const RETRIEVAL_HABIT_NEAR_TIE_SCORE_WINDOW = 2;
const RETRIEVAL_HABIT_UNIT_SCORE_NEAR_TIE_WINDOW = 0.05;
const RETRIEVAL_HABIT_MAX_SCORE_BONUS = 0.75;
const RETRIEVAL_HABIT_UNIT_SCORE_MAX_BONUS = 0.025;
const RETRIEVAL_HABIT_WHY_SHOWN = "Shown slightly higher by local recall preferences.";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetrievalHabitProfileAggregate {
    key: string;
    signal: RetrievalHabitSignalKind;
    counts: Partial<Record<RetrievalHabitFeedbackKind, number>>;
    updatedAt: string;
    windowStart: string;
    windowDays: 1;
}

export interface RetrievalHabitProfileState {
    aggregates: RetrievalHabitProfileAggregate[];
    clearedAt?: string;
}

export interface RetrievalHabitProfileSettings {
    enabled: boolean;
    state: RetrievalHabitProfileState;
}

export const RETRIEVAL_HABIT_PROFILE_DEFAULTS: Readonly<RetrievalHabitProfileSettings> = Object.freeze({
    enabled: false,
    state: {
        aggregates: [],
    },
});

export type RetrievalHabitProfileRecordResult =
    | { ok: true; state: RetrievalHabitProfileState }
    | { ok: false; reason: "disabled" | "invalid_source" | "excluded_scope" | "unsafe_source" };

export interface RetrievalHabitSignalInput {
    key: string;
    signal: RetrievalHabitSignalKind;
    sourceId?: string;
}

export interface RetrievalHabitEvidenceInput {
    score: number;
    evidenceStrength: EvidenceStrength;
    lanes?: readonly RetrievalLane[];
    sourceRef: PersistedSourceRef;
    whyShown?: readonly string[];
}

export interface RetrievalHabitProfileStoreOptions {
    settings: RetrievalHabitProfileSettings;
    persist?: (settings: RetrievalHabitProfileSettings) => Promise<void> | void;
    isSourceAllowed?: (ref: PersistedSourceRef) => boolean;
    now?: Date | (() => Date);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function nowIso(now: RetrievalHabitProfileStoreOptions["now"]): string {
    return nowDate(now).toISOString();
}

function nowDate(now: RetrievalHabitProfileStoreOptions["now"]): Date {
    const value = typeof now === "function" ? now() : now;
    return value ? new Date(value.getTime()) : new Date();
}

function dateKey(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function dateFromKey(key: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
    const timestamp = Date.parse(`${key}T00:00:00.000Z`);
    return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function normalizeWindowStart(value: unknown, updatedAt: string): string {
    if (typeof value === "string" && dateFromKey(value.trim())) return value.trim();
    const updated = Date.parse(updatedAt);
    return dateKey(Number.isFinite(updated) ? new Date(updated) : new Date(0));
}

function daysOld(windowStart: string, now: Date): number {
    const start = dateFromKey(windowStart);
    if (!start) return Number.POSITIVE_INFINITY;
    const nowStart = dateFromKey(dateKey(now)) ?? now;
    return Math.floor((nowStart.getTime() - start.getTime()) / DAY_MS);
}

function stableHash(text: string): string {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeVaultPath(path: string): string {
    return String(path ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/").replace(/\/$/g, "");
}

function safeSourceId(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 128) return undefined;
    if (/[\\/]/.test(trimmed)) return undefined;
    return trimmed;
}

function normalizeCounts(value: unknown): Partial<Record<RetrievalHabitFeedbackKind, number>> {
    const counts: Partial<Record<RetrievalHabitFeedbackKind, number>> = {};
    if (!isRecord(value)) return counts;
    for (const kind of RETRIEVAL_HABIT_FEEDBACK_KINDS) {
        const raw = value[kind];
        if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) continue;
        counts[kind] = Math.min(9999, Math.floor(raw));
    }
    return counts;
}

function aggregateKeyIsSafe(signal: RetrievalHabitSignalKind, key: string): boolean {
    if (signal === "quiet_recall_relation") {
        return key === "relation:current" || key === "relation:related" || key === "relation:far";
    }
    if (signal === "quiet_recall_strength" || signal === "retrieval_strength") {
        return key === "strength:weak"
            || key === "strength:medium"
            || key === "strength:strong"
            || key === "strength:conflicting"
            || key === "strength:unknown";
    }
    if (signal === "quiet_recall_source" || signal === "retrieval_source") {
        return /^source:[0-9a-f]{8}$/.test(key);
    }
    if (signal === "retrieval_lane") {
        return key === "lane:source" || key === "lane:semantic" || key === "lane:structure" || key === "lane:activity";
    }
    if (signal === "retrieval_scope") {
        return key === "scope:current_note"
            || key === "scope:selected_notes"
            || key === "scope:folder"
            || key === "scope:tag"
            || key === "scope:time_range"
            || key === "scope:whole_vault"
            || key === "scope:custom";
    }
    if (signal === "entry_type") {
        return key === "entry:chat"
            || key === "entry:pagelet"
            || key === "entry:weekly_review"
            || key === "entry:quick_capture"
            || key === "entry:quiet_recall";
    }
    if (signal === "query_type") {
        return key === "query:path"
            || key === "query:tag"
            || key === "query:natural_language"
            || key === "query:exact_term"
            || key === "query:unknown";
    }
    return false;
}

export function normalizeRetrievalHabitProfileState(value: unknown): RetrievalHabitProfileState {
    const input = isRecord(value) ? value : {};
    const aggregates = Array.isArray(input.aggregates)
        ? input.aggregates.flatMap((entry): RetrievalHabitProfileAggregate[] => {
            if (!isRecord(entry)) return [];
            const key = typeof entry.key === "string" ? entry.key.trim() : "";
            const signal = RETRIEVAL_HABIT_SIGNAL_KINDS.includes(entry.signal as RetrievalHabitSignalKind)
                ? entry.signal as RetrievalHabitSignalKind
                : null;
            const updatedAt = typeof entry.updatedAt === "string" ? entry.updatedAt : "";
            if (!key || !signal || !updatedAt || !aggregateKeyIsSafe(signal, key)) return [];
            const counts = normalizeCounts(entry.counts);
            if (Object.keys(counts).length === 0) return [];
            const windowStart = normalizeWindowStart(entry.windowStart, updatedAt);
            const aggregate: RetrievalHabitProfileAggregate = {
                key,
                signal,
                counts,
                updatedAt,
                windowStart,
                windowDays: 1,
            };
            return [aggregate];
        })
        : [];
    const state: RetrievalHabitProfileState = { aggregates };
    if (typeof input.clearedAt === "string" && input.clearedAt.trim()) {
        state.clearedAt = input.clearedAt.trim();
    }
    return state;
}

export function normalizeRetrievalHabitProfileSettings(value: unknown): RetrievalHabitProfileSettings {
    const input = isRecord(value) ? value : {};
    return {
        enabled: typeof input.enabled === "boolean"
            ? input.enabled
            : RETRIEVAL_HABIT_PROFILE_DEFAULTS.enabled,
        state: normalizeRetrievalHabitProfileState(input.state),
    };
}

function strongestEvidenceStrength(sourceRefs: readonly PersistedSourceRef[]): EvidenceStrength | "unknown" {
    const ranks: Record<EvidenceStrength | "unknown", number> = {
        unknown: 0,
        weak: 1,
        conflicting: 2,
        medium: 3,
        strong: 4,
    };
    let best: EvidenceStrength | "unknown" = "unknown";
    for (const ref of sourceRefs) {
        const strength = ref.evidenceStrength ?? "unknown";
        if (ranks[strength] > ranks[best]) best = strength;
    }
    return best;
}

function sourceSignalKey(ref: PersistedSourceRef): { key: string; sourceId?: string } {
    const sourceId = safeSourceId(ref.sourceId);
    if (sourceId) {
        return {
            key: `source:${stableHash(sourceId)}`,
        };
    }
    return {
        key: `source:${stableHash(normalizeVaultPath(ref.path))}`,
    };
}

function signalKeysForCandidate(candidate: QuietRecallCandidate): Array<{
    key: string;
    signal: RetrievalHabitSignalKind;
    sourceId?: string;
}> {
    const signals: Array<{ key: string; signal: RetrievalHabitSignalKind; sourceId?: string }> = [
        { key: `relation:${candidate.relation}`, signal: "quiet_recall_relation" },
        { key: `strength:${strongestEvidenceStrength(candidate.sourceRefs)}`, signal: "quiet_recall_strength" },
    ];
    for (const ref of candidate.sourceRefs) {
        const source = sourceSignalKey(ref);
        signals.push({
            ...source,
            signal: "quiet_recall_source",
        });
    }
    return signals;
}

function candidateSourceRefsAreSafe(candidate: QuietRecallCandidate): boolean {
    if (candidate.sourceRefs.length === 0) return false;
    if (hasForbiddenPersistedTextFields(candidate.sourceRefs)) return false;
    return candidate.sourceRefs.every((ref) => validateSourceRefPathShape(ref).ok);
}

function feedbackWeight(counts: Partial<Record<RetrievalHabitFeedbackKind, number>>): number {
    return (counts.accept ?? 0) * 3
        + (counts.view ?? 0)
        - (counts.dismiss ?? 0)
        - (counts.later ?? 0) * 0.5
        - (counts.not_relevant ?? 0) * 2;
}

function decayMultiplier(aggregate: RetrievalHabitProfileAggregate, now: Date): number {
    const age = daysOld(aggregate.windowStart, now);
    if (age < 0 || age >= RETRIEVAL_HABIT_RETENTION_DAYS) return 0;
    if (age < 30) return 1;
    if (age < 60) return 0.5;
    return 0.25;
}

function pruneExpiredAggregates(
    state: RetrievalHabitProfileState,
    now: Date,
): RetrievalHabitProfileState {
    const normalized = normalizeRetrievalHabitProfileState(state);
    return {
        aggregates: normalized.aggregates.filter((aggregate) => daysOld(aggregate.windowStart, now) < RETRIEVAL_HABIT_RETENTION_DAYS),
        ...(normalized.clearedAt ? { clearedAt: normalized.clearedAt } : {}),
    };
}

function aggregateMapKey(signal: RetrievalHabitSignalInput, windowStart: string): string {
    return `${signal.signal}\0${signal.key}\0${windowStart}`;
}

function signalInputIsSafe(signal: RetrievalHabitSignalInput): boolean {
    const key = signal.key.trim();
    if (!key || !RETRIEVAL_HABIT_SIGNAL_KINDS.includes(signal.signal)) return false;
    if (!aggregateKeyIsSafe(signal.signal, key)) return false;
    return signal.sourceId === undefined || Boolean(safeSourceId(signal.sourceId));
}

function scoreBonusForSignals(
    signals: readonly RetrievalHabitSignalInput[],
    settings: RetrievalHabitProfileSettings,
    now: Date,
): number {
    const normalized = normalizeRetrievalHabitProfileSettings(settings);
    if (!normalized.enabled || normalized.state.aggregates.length === 0) return 0;
    const weights = new Map<string, number>();
    for (const aggregate of normalized.state.aggregates) {
        const multiplier = decayMultiplier(aggregate, now);
        if (multiplier <= 0) continue;
        const key = `${aggregate.signal}\0${aggregate.key}`;
        weights.set(key, (weights.get(key) ?? 0) + feedbackWeight(aggregate.counts) * multiplier);
    }
    const rawBonus = signals.reduce((sum, signal) => {
        return sum + (weights.get(`${signal.signal}\0${signal.key}`) ?? 0);
    }, 0);
    return Math.max(-RETRIEVAL_HABIT_MAX_SCORE_BONUS, Math.min(RETRIEVAL_HABIT_MAX_SCORE_BONUS, rawBonus * 0.1));
}

function evidenceStrengthRank(strength: EvidenceStrength | "unknown"): number {
    if (strength === "strong") return 3;
    if (strength === "medium") return 2;
    if (strength === "weak") return 1;
    if (strength === "conflicting") return 0;
    return 0;
}

function compareWithWeakHabitBonus<T extends { score: number; evidenceStrength: EvidenceStrength | "unknown"; title: string }>(
    left: T & { habitBonus: number },
    right: T & { habitBonus: number },
): number {
    const strengthDelta = evidenceStrengthRank(right.evidenceStrength) - evidenceStrengthRank(left.evidenceStrength);
    if (strengthDelta !== 0) return strengthDelta;
    const baseDelta = right.score - left.score;
    const nearTieWindow = scoreLooksUnitScale(left.score, right.score)
        ? RETRIEVAL_HABIT_UNIT_SCORE_NEAR_TIE_WINDOW
        : RETRIEVAL_HABIT_NEAR_TIE_SCORE_WINDOW;
    if (Math.abs(baseDelta) > nearTieWindow) return baseDelta;
    const adjustedDelta = (right.score + right.habitBonus) - (left.score + left.habitBonus);
    if (Math.abs(adjustedDelta) > 0.000001) return adjustedDelta;
    if (baseDelta !== 0) return baseDelta;
    return left.title.localeCompare(right.title);
}

function scoreLooksUnitScale(leftScore: number, rightScore: number): boolean {
    return Math.max(Math.abs(leftScore), Math.abs(rightScore)) <= 1;
}

function scaleHabitBonusForScore(score: number, habitBonus: number): number {
    const cap = Math.abs(score) <= 1
        ? RETRIEVAL_HABIT_UNIT_SCORE_MAX_BONUS
        : RETRIEVAL_HABIT_MAX_SCORE_BONUS;
    return Math.max(-cap, Math.min(cap, habitBonus));
}

function uniqueStrings(values: readonly string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export class RetrievalHabitProfileStore {
    constructor(private readonly options: RetrievalHabitProfileStoreOptions) {
        this.options.settings.state = pruneExpiredAggregates(
            this.options.settings.state,
            nowDate(this.options.now),
        );
    }

    snapshot(): RetrievalHabitProfileState {
        return {
            aggregates: this.options.settings.state.aggregates.map((aggregate) => ({
                ...aggregate,
                counts: { ...aggregate.counts },
            })),
            ...(this.options.settings.state.clearedAt
                ? { clearedAt: this.options.settings.state.clearedAt }
                : {}),
        };
    }

    async recordRecallFeedback(
        candidate: QuietRecallCandidate,
        feedback: RetrievalHabitFeedbackKind,
    ): Promise<RetrievalHabitProfileRecordResult> {
        return this.recordSignals(signalKeysForCandidate(candidate), feedback, candidate.sourceRefs);
    }

    async recordSignals(
        signals: readonly RetrievalHabitSignalInput[],
        feedback: RetrievalHabitFeedbackKind,
        sourceRefs: readonly PersistedSourceRef[] = [],
    ): Promise<RetrievalHabitProfileRecordResult> {
        if (!this.options.settings.enabled) return { ok: false, reason: "disabled" };
        if (!RETRIEVAL_HABIT_FEEDBACK_KINDS.includes(feedback)) return { ok: false, reason: "invalid_source" };
        if (sourceRefs.length > 0 && !sourceRefsAreSafe(sourceRefs)) return { ok: false, reason: "unsafe_source" };
        if (this.options.isSourceAllowed && sourceRefs.some((ref) => !this.options.isSourceAllowed?.(ref))) {
            return { ok: false, reason: "excluded_scope" };
        }
        const safeSignals = signals
            .map((signal) => ({
                ...signal,
                key: signal.key.trim(),
                ...(safeSourceId(signal.sourceId) ? { sourceId: safeSourceId(signal.sourceId) } : {}),
            }))
            .filter(signalInputIsSafe);
        if (safeSignals.length === 0) return { ok: false, reason: "invalid_source" };

        const generatedAtDate = nowDate(this.options.now);
        const generatedAt = generatedAtDate.toISOString();
        const windowStart = dateKey(generatedAtDate);
        const byKey = new Map<string, RetrievalHabitProfileAggregate>();
        for (const aggregate of pruneExpiredAggregates(this.options.settings.state, generatedAtDate).aggregates) {
            byKey.set(aggregateMapKey(aggregate, aggregate.windowStart), {
                ...aggregate,
                counts: { ...aggregate.counts },
            });
        }

        for (const signal of safeSignals) {
            const key = aggregateMapKey(signal, windowStart);
            const existing = byKey.get(key);
            if (existing) {
                existing.counts[feedback] = (existing.counts[feedback] ?? 0) + 1;
                existing.updatedAt = generatedAt;
            } else {
                byKey.set(key, {
                    key: signal.key,
                    signal: signal.signal,
                    counts: { [feedback]: 1 },
                    updatedAt: generatedAt,
                    windowStart,
                    windowDays: 1,
                });
            }
        }

        this.options.settings.state = {
            aggregates: Array.from(byKey.values()).sort((left, right) => {
                if (left.signal !== right.signal) return left.signal.localeCompare(right.signal);
                return left.key.localeCompare(right.key);
            }),
        };
        await this.options.persist?.(this.options.settings);
        return { ok: true, state: this.snapshot() };
    }

    async setEnabled(enabled: boolean): Promise<RetrievalHabitProfileSettings> {
        this.options.settings.enabled = enabled;
        this.options.settings.state = pruneExpiredAggregates(this.options.settings.state, nowDate(this.options.now));
        await this.options.persist?.(this.options.settings);
        return {
            enabled: this.options.settings.enabled,
            state: this.snapshot(),
        };
    }

    async clear(): Promise<RetrievalHabitProfileState> {
        this.options.settings.state = {
            aggregates: [],
            clearedAt: nowIso(this.options.now),
        };
        await this.options.persist?.(this.options.settings);
        return this.snapshot();
    }
}

export function applyRetrievalHabitProfileToRecallCandidates(
    candidates: readonly QuietRecallCandidate[],
    settings: RetrievalHabitProfileSettings,
    options: { now?: Date | (() => Date) } = {},
): QuietRecallCandidate[] {
    const normalized = normalizeRetrievalHabitProfileSettings(settings);
    if (!normalized.enabled || normalized.state.aggregates.length === 0) {
        return candidates.map((candidate) => ({
            ...candidate,
            sourceRefs: candidate.sourceRefs.map((ref) => ({ ...ref })),
            whyNow: [...candidate.whyNow],
        }));
    }

    const now = nowDate(options.now);

    return candidates
        .map((candidate) => {
            const habitBonus = candidateSourceRefsAreSafe(candidate)
                ? scoreBonusForSignals(signalKeysForCandidate(candidate), normalized, now)
                : 0;
            const scaledHabitBonus = scaleHabitBonusForScore(candidate.score, habitBonus);
            const whyNow = habitBonus > 0
                ? uniqueStrings([...candidate.whyNow, RETRIEVAL_HABIT_WHY_SHOWN])
                : [...candidate.whyNow];
            return {
                value: {
                    ...candidate,
                    sourceRefs: candidate.sourceRefs.map((ref) => ({ ...ref })),
                    whyNow,
                    score: candidate.score + scaledHabitBonus,
                },
                title: candidate.title,
                score: candidate.score,
                habitBonus: scaledHabitBonus,
                evidenceStrength: strongestEvidenceStrength(candidate.sourceRefs),
            };
        })
        .sort((left, right) => {
            return compareWithWeakHabitBonus(left, right);
        })
        .map((entry) => entry.value);
}

export function applyRetrievalHabitProfileToEvidence<T extends RetrievalHabitEvidenceInput>(
    evidence: readonly T[],
    settings: RetrievalHabitProfileSettings,
    options: { now?: Date | (() => Date) } = {},
): T[] {
    const normalized = normalizeRetrievalHabitProfileSettings(settings);
    if (!normalized.enabled || normalized.state.aggregates.length === 0) {
        return evidence.map(cloneEvidenceInput);
    }
    const now = nowDate(options.now);
    return evidence
        .map((entry) => {
            const habitBonus = sourceRefsAreSafe([entry.sourceRef])
                ? scoreBonusForSignals(signalKeysForEvidence(entry), normalized, now)
                : 0;
            const scaledHabitBonus = scaleHabitBonusForScore(entry.score, habitBonus);
            const whyShown = habitBonus > 0
                ? uniqueStrings([...(entry.whyShown ?? []), RETRIEVAL_HABIT_WHY_SHOWN])
                : [...(entry.whyShown ?? [])];
            return {
                value: cloneEvidenceInput({
                    ...entry,
                    score: entry.score + scaledHabitBonus,
                    whyShown,
                    sourceRef: {
                        ...entry.sourceRef,
                        whyShown: habitBonus > 0
                            ? uniqueStrings([...(entry.sourceRef.whyShown ?? []), RETRIEVAL_HABIT_WHY_SHOWN])
                            : entry.sourceRef.whyShown ? [...entry.sourceRef.whyShown] : undefined,
                    },
                }),
                title: entry.sourceRef.path,
                score: entry.score,
                evidenceStrength: entry.evidenceStrength,
                habitBonus: scaledHabitBonus,
            };
        })
        .sort((left, right) => compareWithWeakHabitBonus(left, right))
        .map((entry) => entry.value);
}

function sourceRefsAreSafe(sourceRefs: readonly PersistedSourceRef[]): boolean {
    if (sourceRefs.length === 0) return false;
    if (hasForbiddenPersistedTextFields(sourceRefs)) return false;
    return sourceRefs.every((ref) => validateSourceRefPathShape(ref).ok);
}

function signalKeysForEvidence(evidence: RetrievalHabitEvidenceInput): RetrievalHabitSignalInput[] {
    const source = sourceSignalKey(evidence.sourceRef);
    const signals: RetrievalHabitSignalInput[] = [
        { key: `strength:${evidence.evidenceStrength}`, signal: "retrieval_strength" },
        {
            ...source,
            signal: "retrieval_source",
        },
    ];
    for (const lane of evidence.lanes ?? []) {
        signals.push({ key: `lane:${lane}`, signal: "retrieval_lane" });
    }
    return signals;
}

function cloneEvidenceInput<T extends RetrievalHabitEvidenceInput>(entry: T): T {
    return {
        ...entry,
        lanes: entry.lanes ? [...entry.lanes] : undefined,
        whyShown: entry.whyShown ? [...entry.whyShown] : undefined,
        sourceRef: {
            ...entry.sourceRef,
            whyShown: entry.sourceRef.whyShown ? [...entry.sourceRef.whyShown] : undefined,
        },
    };
}

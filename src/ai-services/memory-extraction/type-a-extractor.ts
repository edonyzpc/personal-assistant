import type { PersistedConversation, PersistedTurn } from "../../chat/chat-history-store";

export type UserProfileEvidenceKind =
    | "user_explicit"
    | "user_correction"
    | "inferred_behavior"
    | "discussed";

export type UserProfileConfidence = "high" | "medium" | "low";

export interface UserProfileCandidate {
    key: string;
    text: string;
    kind: UserProfileEvidenceKind;
    confidence: UserProfileConfidence;
    conversationId: string;
    observedAt: string;
}

export interface UserProfileRecord extends UserProfileCandidate {
    occurrences: number;
    conversationIds: string[];
    confirmed: boolean;
}

export interface UserProfileSnapshot {
    updatedAt: string;
    records: UserProfileRecord[];
    markdown: string;
}

export interface TypeAExtractionInput {
    conversation: PersistedConversation;
    turns: PersistedTurn[];
    now?: () => Date;
}

const PROFILE_MAX_CHARS = 1400;
const RECURRENCE_THRESHOLD = 3;

export class TypeAUserProfileExtractor {
    extractCandidates(input: TypeAExtractionInput): UserProfileCandidate[] {
        const observedAt = (input.now ?? (() => new Date()))().toISOString();
        const candidates: UserProfileCandidate[] = [];
        for (const turn of input.turns) {
            candidates.push(...extractCandidatesFromText(
                turn.user.content,
                input.conversation.id,
                observedAt,
            ));
        }
        return dedupeCandidates(candidates);
    }

    mergeCandidates(
        existing: UserProfileSnapshot | null,
        candidates: readonly UserProfileCandidate[],
        now = new Date(),
    ): UserProfileSnapshot {
        const byKey = new Map<string, UserProfileRecord>();
        for (const record of existing?.records ?? []) {
            byKey.set(record.key, {
                ...record,
                conversationIds: [...record.conversationIds],
            });
        }

        for (const candidate of candidates) {
            if (candidate.kind === "discussed" || candidate.confidence === "low") continue;
            const existingRecord = byKey.get(candidate.key);
            if (!existingRecord) {
                const confirmed = candidate.kind === "user_explicit"
                    || candidate.kind === "user_correction"
                    || candidate.confidence === "high";
                byKey.set(candidate.key, {
                    ...candidate,
                    occurrences: 1,
                    conversationIds: [candidate.conversationId],
                    confirmed,
                });
                continue;
            }
            const conversationIds = new Set(existingRecord.conversationIds);
            conversationIds.add(candidate.conversationId);
            const occurrences = existingRecord.occurrences
                + (existingRecord.conversationIds.includes(candidate.conversationId) ? 0 : 1);
            byKey.set(candidate.key, {
                ...existingRecord,
                text: chooseBetterProfileText(existingRecord.text, candidate.text),
                confidence: higherConfidence(existingRecord.confidence, candidate.confidence),
                kind: strongerKind(existingRecord.kind, candidate.kind),
                observedAt: candidate.observedAt,
                occurrences,
                conversationIds: [...conversationIds],
                confirmed: existingRecord.confirmed
                    || candidate.kind === "user_explicit"
                    || candidate.kind === "user_correction"
                    || occurrences >= RECURRENCE_THRESHOLD,
            });
        }

        const records = [...byKey.values()]
            .sort((left, right) => Number(right.confirmed) - Number(left.confirmed)
                || confidenceRank(right.confidence) - confidenceRank(left.confidence)
                || right.occurrences - left.occurrences
                || right.observedAt.localeCompare(left.observedAt));
        return {
            updatedAt: now.toISOString(),
            records,
            markdown: renderUserProfileMarkdown(records, now),
        };
    }
}

export function extractCandidatesFromText(
    text: string,
    conversationId: string,
    observedAt: string,
): UserProfileCandidate[] {
    const candidates: UserProfileCandidate[] = [];
    const sentences = text.split(/(?<=[.!?。！？])\s+|\n+/).map((entry) => entry.trim()).filter(Boolean);
    for (const sentence of sentences) {
        const explicit = sentence.match(/\b(?:remember|please remember|note that|i prefer|i usually|i always|my preference is)\b/i)
            || sentence.match(/(?:记住|请记住|我偏好|我更喜欢|我通常|我的偏好是)/);
        const correction = sentence.match(/\b(?:don't|do not|not like that|instead|actually)\b/i)
            || sentence.match(/(?:不是这样|不要|请改成|应该|其实)/);
        if (!explicit && !correction) continue;
        const key = normalizeProfileKey(sentence);
        if (!key) continue;
        candidates.push({
            key,
            text: sentence,
            kind: correction ? "user_correction" : "user_explicit",
            confidence: "high",
            conversationId,
            observedAt,
        });
    }
    return candidates;
}

export function renderUserProfileMarkdown(records: readonly UserProfileRecord[], now = new Date()): string {
    const confirmed = records.filter((record) => record.confirmed);
    const tentative = records.filter((record) => !record.confirmed);
    const lines = [
        "# User Profile",
        "",
        `Updated: ${now.toISOString()}`,
        "",
        "## Confirmed",
        ...(confirmed.length > 0
            ? confirmed.map((record) => `- ${record.text}`)
            : ["- No confirmed profile memories yet."]),
    ];
    if (tentative.length > 0) {
        lines.push("", "## Tentative", ...tentative.slice(0, 8).map((record) => {
            return `- ${record.text} (${record.occurrences}/${RECURRENCE_THRESHOLD})`;
        }));
    }
    const markdown = lines.join("\n").trim();
    return markdown.length <= PROFILE_MAX_CHARS
        ? markdown
        : `${markdown.slice(0, PROFILE_MAX_CHARS - 14).trim()}\n...`;
}

function normalizeProfileKey(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .split(/\s+/)
        .slice(0, 10)
        .join("-");
}

function dedupeCandidates(candidates: readonly UserProfileCandidate[]): UserProfileCandidate[] {
    const byKey = new Map<string, UserProfileCandidate>();
    for (const candidate of candidates) {
        byKey.set(candidate.key, candidate);
    }
    return [...byKey.values()];
}

function chooseBetterProfileText(left: string, right: string): string {
    if (right.length > left.length && right.length <= 220) return right;
    return left;
}

function higherConfidence(left: UserProfileConfidence, right: UserProfileConfidence): UserProfileConfidence {
    return confidenceRank(right) > confidenceRank(left) ? right : left;
}

function confidenceRank(value: UserProfileConfidence): number {
    if (value === "high") return 3;
    if (value === "medium") return 2;
    return 1;
}

function strongerKind(left: UserProfileEvidenceKind, right: UserProfileEvidenceKind): UserProfileEvidenceKind {
    return kindRank(right) > kindRank(left) ? right : left;
}

function kindRank(value: UserProfileEvidenceKind): number {
    switch (value) {
        case "user_correction":
            return 4;
        case "user_explicit":
            return 3;
        case "inferred_behavior":
            return 2;
        case "discussed":
            return 1;
    }
}

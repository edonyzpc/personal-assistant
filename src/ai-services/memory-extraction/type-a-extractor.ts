import type { PersistedConversation, PersistedTurn } from "../../chat/chat-history-store";
import { pluginT, getPluginUiLanguage } from "../../locales/plugin";

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

export type LLMInvoker = (prompt: string) => Promise<string>;

const LLM_EXTRACTION_SYSTEM_PROMPT = [
    "Analyze the following conversation turns and extract user preferences, corrections, and behavioral patterns.",
    'Return ONLY valid JSON: {"extractions":[{"text":"<preference>","kind":"user_explicit|user_correction|inferred_behavior","confidence":"high|medium|low"}]}',
    "Rules:",
    "- user_explicit: user directly states a preference (\"I prefer\", \"remember\", \"I like\")",
    "- user_correction: user corrects the AI (\"no not that\", \"don't\", \"instead\")",
    "- inferred_behavior: observed pattern the user hasn't explicitly stated",
    "- Only extract clear, actionable preferences, not general discussion topics",
    "- Produce at most 5 extractions per batch",
    "- confidence: high for direct statements, medium for strong patterns, low for weak signals",
    "- Return {\"extractions\":[]} if no preferences are found",
].join("\n");

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

    async extractCandidatesWithLLM(
        input: TypeAExtractionInput,
        invoke: LLMInvoker,
    ): Promise<UserProfileCandidate[]> {
        const observedAt = (input.now ?? (() => new Date()))().toISOString();
        const turnTexts = input.turns.map((turn) => {
            const userText = typeof turn.user.content === "string"
                ? turn.user.content.slice(0, 500) : "";
            const assistantText = typeof turn.assistant?.content === "string"
                ? turn.assistant.content.slice(0, 300) : "";
            return `User: ${userText}\nAssistant: ${assistantText}`;
        }).join("\n---\n").slice(0, 2000);

        const prompt = `${LLM_EXTRACTION_SYSTEM_PROMPT}\n\nConversation:\n${turnTexts}\n\nProduce the JSON output now.`;

        try {
            const response = await invoke(prompt);
            return parseLLMExtractionResponse(response, input.conversation.id, observedAt);
        } catch {
            return this.extractCandidates(input);
        }
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
    const lang = getPluginUiLanguage();
    const confirmed = records.filter((record) => record.confirmed);
    const tentative = records.filter((record) => !record.confirmed);
    const lines = [
        `# ${pluginT("plugin.memoryExtraction.userProfile.title", lang)}`,
        "",
        pluginT("plugin.memoryExtraction.userProfile.updated", lang, { timestamp: now.toISOString() }),
        "",
        `## ${pluginT("plugin.memoryExtraction.userProfile.confirmed", lang)}`,
        ...(confirmed.length > 0
            ? confirmed.map((record) => `- ${record.text}`)
            : [`- ${pluginT("plugin.memoryExtraction.userProfile.noConfirmed", lang)}`]),
    ];
    if (tentative.length > 0) {
        lines.push("", `## ${pluginT("plugin.memoryExtraction.userProfile.tentative", lang)}`, ...tentative.slice(0, 8).map((record) => {
            return `- ${pluginT("plugin.memoryExtraction.userProfile.tentativeProgress", lang, { text: record.text, occurrences: record.occurrences, threshold: RECURRENCE_THRESHOLD })}`;
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

function parseLLMExtractionResponse(
    response: string,
    conversationId: string,
    observedAt: string,
): UserProfileCandidate[] {
    try {
        const trimmed = response.trim();
        const jsonStart = trimmed.indexOf("{");
        const jsonEnd = trimmed.lastIndexOf("}");
        if (jsonStart === -1 || jsonEnd <= jsonStart) return [];
        const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
        const extractions = Array.isArray(parsed?.extractions) ? parsed.extractions : [];
        return extractions
            .filter((e: unknown): e is { text: string; kind: string; confidence: string } =>
                e !== null && typeof e === "object"
                && typeof (e as Record<string, unknown>).text === "string"
                && typeof (e as Record<string, unknown>).kind === "string")
            .map((e: { text: string; kind: string; confidence: string }) => {
                const kind: UserProfileEvidenceKind =
                    e.kind === "user_explicit" || e.kind === "user_correction"
                    || e.kind === "inferred_behavior" || e.kind === "discussed"
                        ? e.kind : "inferred_behavior";
                const confidence: UserProfileConfidence =
                    e.confidence === "high" || e.confidence === "medium" || e.confidence === "low"
                        ? e.confidence : "medium";
                const key = normalizeProfileKey(e.text);
                if (!key) return null;
                return { key, text: e.text, kind, confidence, conversationId, observedAt };
            })
            .filter((c: UserProfileCandidate | null): c is UserProfileCandidate => c !== null)
            .slice(0, 5);
    } catch {
        return [];
    }
}

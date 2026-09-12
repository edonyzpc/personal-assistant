import { locateChatMemoryQuote, type ChatMemoryQuotedSource, type ChatMemorySemanticSource } from "./chat-memory-admission";
import { stableHash } from "./helpers";

export const CHAT_MEMORY_SEMANTIC_RULE = "b135-chat-semantic-v1" as const;

/** Model interpretation is evidence for governance review, never permission or confirmation. */
export interface ChatMemorySemanticCandidate {
    text: string;
    meaning: "independent_personal_statement";
    kind: "user_explicit" | "user_correction" | "inferred_behavior";
    confidence: "high" | "medium";
    quotes: Array<{ messageId: string; quote: string }>;
}

/** Retained only by the host that built the actual extraction prompt. */
export interface ChatMemorySemanticProjection {
    source: ChatMemorySemanticSource;
    presentedText: string;
}

export interface ChatMemorySemanticReceipt {
    version: 1;
    rule: typeof CHAT_MEMORY_SEMANTIC_RULE;
    candidateTextHash: string;
    meaning: ChatMemorySemanticCandidate["meaning"];
    kind: ChatMemorySemanticCandidate["kind"];
    confidence: ChatMemorySemanticCandidate["confidence"];
    sources: ChatMemoryQuotedSource[];
}

/** Stable suppression identity follows host evidence, not model wording or extraction time. */
export function chatMemorySemanticSourceFingerprint(receipt: ChatMemorySemanticReceipt): string {
    const sources = receipt.sources.map((source) => [source.conversationId, source.messageId,
        source.hostKind, source.contentHash, source.start, source.end, source.quoteHash])
        .map((source) => JSON.stringify(source)).sort();
    return `chat-semantic:${stableHash(JSON.stringify([receipt.rule, sources]))}`;
}

/** A single extraction belongs to one conversation; unrelated lineage needs its own evidence. */
export function isChatSemanticConversationProvenance(receipt: ChatMemorySemanticReceipt, provenance: unknown): boolean {
    if (!Array.isArray(provenance) || provenance.length !== 1 || !isRecord(provenance[0])) return false;
    const entry = provenance[0];
    return entry.kind === "conversation" && Array.isArray(entry.conversationIds)
        && entry.conversationIds.length === 1 && entry.conversationIds[0] === receipt.sources[0]?.conversationId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function hasCandidateSemantics(value: Record<string, unknown>): boolean {
    return value.meaning === "independent_personal_statement"
        && (value.kind === "user_explicit" || value.kind === "user_correction" || value.kind === "inferred_behavior")
        && (value.confidence === "high" || value.confidence === "medium");
}

function isReviewableKind(kind: unknown): kind is ChatMemorySemanticSource["hostKind"] {
    return kind === "ordinary_user_statement" || kind === "writing_request"
        || kind === "user_local_edit" || kind === "unclassified";
}

/** Persisted parsing validates structure only. Live source verification is a separate required gate. */
export function parseChatMemorySemanticReceipt(value: unknown): ChatMemorySemanticReceipt | undefined {
    if (!isRecord(value) || value.version !== 1 || value.rule !== CHAT_MEMORY_SEMANTIC_RULE
        || !isNonemptyString(value.candidateTextHash) || !hasCandidateSemantics(value)
        || !Array.isArray(value.sources) || value.sources.length === 0) return undefined;
    const sources: ChatMemoryQuotedSource[] = [];
    const identities = new Set<string>();
    let conversationId: string | undefined;
    for (const source of value.sources) {
        if (!isRecord(source) || !isNonemptyString(source.conversationId) || !isNonemptyString(source.messageId)
            || !isReviewableKind(source.hostKind) || !isNonemptyString(source.contentHash)
            || !isNonemptyString(source.projectionHash) || !isNonemptyString(source.quoteHash)
            || !Number.isSafeInteger(source.projectionChars) || !Number.isSafeInteger(source.start)
            || !Number.isSafeInteger(source.end)) return undefined;
        const projectionChars = source.projectionChars as number;
        const start = source.start as number;
        const end = source.end as number;
        if (start < 0 || end <= start || end > projectionChars || identities.has(source.messageId)
            || (conversationId !== undefined && conversationId !== source.conversationId)) return undefined;
        conversationId = source.conversationId;
        identities.add(source.messageId);
        sources.push({ conversationId, messageId: source.messageId, hostKind: source.hostKind,
            contentHash: source.contentHash, projectionHash: source.projectionHash,
            projectionChars, start, end, quoteHash: source.quoteHash });
    }
    return { version: 1, rule: CHAT_MEMORY_SEMANTIC_RULE, candidateTextHash: value.candidateTextHash,
        meaning: "independent_personal_statement", kind: value.kind as ChatMemorySemanticCandidate["kind"],
        confidence: value.confidence as ChatMemorySemanticCandidate["confidence"], sources };
}

/** The caller owns projections; none of their identities, hashes or offsets come from model output. */
export function createChatMemorySemanticReceipt(
    candidate: unknown,
    conversationId: string,
    projections: readonly ChatMemorySemanticProjection[],
): ChatMemorySemanticReceipt | undefined {
    if (!isRecord(candidate) || !isNonemptyString(candidate.text) || !hasCandidateSemantics(candidate)
        || !Array.isArray(candidate.quotes) || candidate.quotes.length === 0) return undefined;
    const byId = new Map<string, ChatMemorySemanticProjection>();
    for (const projection of projections) {
        if (projection.source.conversationId !== conversationId || !isReviewableKind(projection.source.hostKind)
            || byId.has(projection.source.messageId)) return undefined;
        byId.set(projection.source.messageId, projection);
    }
    const sources: ChatMemoryQuotedSource[] = [];
    for (const reference of candidate.quotes) {
        if (!isRecord(reference) || !isNonemptyString(reference.messageId) || !isNonemptyString(reference.quote)) return undefined;
        const projection = byId.get(reference.messageId);
        if (!projection) return undefined;
        const located = locateChatMemoryQuote(projection.source, projection.presentedText, reference.quote);
        if (!located) return undefined;
        sources.push(located);
    }
    return parseChatMemorySemanticReceipt({ version: 1, rule: CHAT_MEMORY_SEMANTIC_RULE,
        candidateTextHash: stableHash(candidate.text.trim()), meaning: candidate.meaning,
        kind: candidate.kind, confidence: candidate.confidence, sources });
}

/** Must run against host-owned, still-current input at admission; a parsed receipt alone is insufficient. */
export function verifyChatMemorySemanticReceipt(
    value: unknown,
    candidate: { text: string; meaning?: string; kind: string; confidence: string },
    conversationId: string,
    projections: readonly ChatMemorySemanticProjection[],
): boolean {
    const receipt = parseChatMemorySemanticReceipt(value);
    if (!receipt || receipt.meaning !== candidate.meaning || receipt.candidateTextHash !== stableHash(candidate.text.trim())
        || receipt.kind !== candidate.kind || receipt.confidence !== candidate.confidence) return false;
    const quotes: ChatMemorySemanticCandidate["quotes"] = [];
    for (const source of receipt.sources) {
        const projection = projections.find((entry) => entry.source.messageId === source.messageId);
        if (!projection) return false;
        quotes.push({ messageId: source.messageId, quote: projection.presentedText.slice(source.start, source.end) });
    }
    const rebuilt = createChatMemorySemanticReceipt({ ...candidate, quotes }, conversationId, projections);
    return rebuilt !== undefined && JSON.stringify(rebuilt) === JSON.stringify(receipt);
}

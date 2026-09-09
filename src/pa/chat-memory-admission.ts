import { cloneChatHostProvenance, type ChatHostProvenance } from "../ai-services/chat-provenance";
import type { PersistedTurn } from "../chat/chat-history-store";
import { stableHash } from "./helpers";

export interface ChatMemoryMessageEvidence {
    messageId: string;
    conversationId: string;
    kind: ChatHostProvenance["kind"];
    contentHash: string;
}

/** Ephemeral extraction input. Only its hash/identity is copied to admission evidence. */
export interface ChatMemorySource extends ChatMemoryMessageEvidence {
    text: string;
}

export interface ChatMemoryCandidateEvidence {
    version: 1;
    textHash: string;
    sources: ChatMemoryMessageEvidence[];
}

export interface ChatMemoryAdmissionEvidence {
    conversationId: string;
    throughTurnIndex: number;
    chatMessages?: ChatMemoryMessageEvidence[];
}

/** Reviewable input is not an ordinary statement or a persistence permission. */
export interface ChatMemorySemanticSource {
    conversationId: string;
    messageId: string;
    hostKind: ChatHostProvenance["kind"] | "unclassified";
    contentHash: string;
    text: string;
}

export interface ChatMemoryQuotedSource {
    conversationId: string;
    messageId: string;
    hostKind: ChatMemorySemanticSource["hostKind"];
    contentHash: string;
    projectionHash: string;
    projectionChars: number;
    start: number;
    end: number;
    quoteHash: string;
}

/** Separate Type-A review lane. Old semantic labels remain facts to review, never upgraded. */
export function collectChatMemorySemanticSources(conversationId: string, turns: readonly PersistedTurn[]): ChatMemorySemanticSource[] {
    const sources: ChatMemorySemanticSource[] = [];
    const counts = new Map<string, number>();
    for (const turn of turns) {
        if (turn.conversationId !== conversationId || turn.user.role !== "user" || typeof turn.user.content !== "string") continue;
        let messageId: string;
        let hostKind: ChatMemorySemanticSource["hostKind"] = "unclassified";
        if (Object.prototype.hasOwnProperty.call(turn.user, "hostProvenance")) {
            try {
                const provenance = cloneChatHostProvenance(turn.user.hostProvenance);
                messageId = provenance.messageId;
                hostKind = provenance.kind;
            } catch { continue; }
        } else {
            if (!Number.isSafeInteger(turn.turnIndex) || turn.turnIndex < 0) continue;
            messageId = `legacy-${stableHash(`${conversationId}\u0000${turn.turnIndex}\u0000user`)}`;
        }
        counts.set(messageId, (counts.get(messageId) ?? 0) + 1);
        // A generated draft or explicit style action is not automatic Type-A input.
        if (hostKind === "ai_draft" || hostKind === "explicit_style_action") continue;
        sources.push({ conversationId, messageId, hostKind, text: turn.user.content, contentHash: stableHash(turn.user.content) });
    }
    return sources.filter((source) => counts.get(source.messageId) === 1);
}

/** The budgeted prefix is exact and never ends halfway through a surrogate pair. */
export function projectChatMemorySemanticText(source: ChatMemorySemanticSource, maxChars: number): string {
    if (!Number.isSafeInteger(maxChars) || maxChars <= 0 || stableHash(source.text) !== source.contentHash) return "";
    let end = Math.min(source.text.length, maxChars);
    if (end > 0 && end < source.text.length && isHighSurrogate(source.text.charCodeAt(end - 1))
        && isLowSurrogate(source.text.charCodeAt(end))) end--;
    return source.text.slice(0, end);
}

/** Model supplies a quote; the host alone computes its unique span in the text actually sent. */
export function locateChatMemoryQuote(source: ChatMemorySemanticSource, presentedText: string, quote: string): ChatMemoryQuotedSource | undefined {
    if (typeof quote !== "string" || !quote.trim() || stableHash(source.text) !== source.contentHash
        || !source.text.startsWith(presentedText) || !presentedText) return undefined;
    const start = presentedText.indexOf(quote);
    const end = start + quote.length;
    if (start < 0 || presentedText.indexOf(quote, start + 1) !== -1) return undefined;
    for (const boundary of [start, end, presentedText.length]) {
        if (boundary > 0 && boundary < source.text.length && isHighSurrogate(source.text.charCodeAt(boundary - 1))
            && isLowSurrogate(source.text.charCodeAt(boundary))) return undefined;
    }
    return { conversationId: source.conversationId, messageId: source.messageId, hostKind: source.hostKind,
        contentHash: source.contentHash, projectionHash: stableHash(presentedText), projectionChars: presentedText.length,
        start, end, quoteHash: stableHash(quote) };
}

function isHighSurrogate(code: number): boolean { return code >= 0xd800 && code <= 0xdbff; }
function isLowSurrogate(code: number): boolean { return code >= 0xdc00 && code <= 0xdfff; }

/** Compatibility for old text turns, without treating missing new metadata as authorization. */
function isLegacyWritingInteraction(text: string): boolean {
    return /(?:文案|配文|润色|改写|重写|这次.{0,12}(?:写|短|长|简洁)|(?:把|将).{0,30}(?:改成|改为))/.test(text)
        || /\b(?:caption|copywriting|rewrite|redraft|this draft|this (?:time|version|paragraph)|polish (?:this|the))\b/i.test(text)
        || /^(?:请|再|能不能)?\s*(?:短一点|长一点|简洁一点|再短些|换个说法)[。！!?.\s]*$/.test(text.trim())
        || /^\s*(?:please\s+)?(?:make (?:it|this) (?:shorter|longer|more concise)|shorter|longer|more concise)[.!?\s]*$/i.test(text);
}

/** UI-owned classification; it never reads model labels or promotes a style-button action. */
export function classifyChatUserProvenanceKind(
    text: string,
    context: { hasImages: boolean; writingContext: boolean },
): ChatHostProvenance["kind"] {
    const writingReferent = /(?:这(?:张|幅|段|篇|次)|图片|照片|文案|配文|改稿|风格)|\b(?:this|draft|caption|photo|image|rewrite|style)\b/i.test(text);
    const personalPreference = /(?:我偏好|我更喜欢)|\b(?:i prefer|i like|my preference)\b/i.test(text);
    const durableCommunicationPreference = /(?:以后|今后|总是|默认|长期)|\b(?:always|by default|from now on|going forward)\b/i.test(text)
        && /(?:回答|回复|沟通|交流|语言|中文|英文|英语|日语|文档|提交)|\b(?:answers?|responses?|replies|communicat\w*|language|english|chinese|japanese|commits?|documentation)\b/i.test(text);
    const independentPreference = !writingReferent && (personalPreference || durableCommunicationPreference);
    if (independentPreference) return "ordinary_user_statement";
    const changedTopic = /(?:换个话题|另一个问题|顺便问)|\b(?:new topic|different question|unrelated question|by the way)\b/i.test(text);
    const independentStatement = /^(?:我(?:是|住在|工作在|平时)|我的(?:工作|职业|家乡))|^\s*(?:i (?:am|work|live)|my (?:job|profession|hometown))\b/i.test(text.trim());
    if (!context.hasImages && !writingReferent && !isLegacyWritingInteraction(text)
        && (changedTopic || independentStatement)) return "ordinary_user_statement";
    const localEdit = /(?:短一点|长一点|简洁一点|换个说法|改成|改为|重写|改写|润色)|\b(?:shorter|longer|rewrite|rephrase|redraft|more concise|less formal)\b/i.test(text);
    if (localEdit && (context.writingContext || context.hasImages || isLegacyWritingInteraction(text))) {
        return "user_local_edit";
    }
    return context.hasImages || context.writingContext || isLegacyWritingInteraction(text)
        ? "writing_request" : "ordinary_user_statement";
}

export function collectChatMemorySources(conversationId: string, turns: readonly PersistedTurn[]): ChatMemorySource[] {
    const sources: ChatMemorySource[] = [];
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const turn of turns) {
        if (turn.conversationId !== conversationId || turn.user.role !== "user"
            || typeof turn.user.content !== "string") continue;
        const message = turn.user as typeof turn.user & { hostProvenance?: unknown };
        let provenance: ChatHostProvenance;
        if (Object.prototype.hasOwnProperty.call(message, "hostProvenance")) {
            try { provenance = cloneChatHostProvenance(message.hostProvenance); } catch { continue; }
        } else {
            if (isLegacyWritingInteraction(message.content)) continue;
            provenance = { version: 1, messageId: `legacy-${stableHash(`${conversationId}\u0000${turn.turnIndex}\u0000user`)}`,
                kind: "ordinary_user_statement" };
        }
        if (seen.has(provenance.messageId)) duplicates.add(provenance.messageId);
        seen.add(provenance.messageId);
        if (provenance.kind !== "ordinary_user_statement") continue;
        sources.push({ messageId: provenance.messageId, conversationId, kind: provenance.kind,
            contentHash: stableHash(message.content), text: message.content });
    }
    return sources.filter((source) => !duplicates.has(source.messageId));
}

/** Constructed only after matching model-selected IDs to host-loaded, eligible user messages. */
export function createChatMemoryCandidateEvidence(text: string, sources: readonly ChatMemorySource[]): ChatMemoryCandidateEvidence {
    return { version: 1, textHash: stableHash(text), sources: sources.map(({ text: _text, ...source }) => ({ ...source })) };
}

export function cloneChatMemoryCandidateEvidence(evidence: ChatMemoryCandidateEvidence): ChatMemoryCandidateEvidence {
    return { version: 1, textHash: evidence.textHash, sources: evidence.sources.map((source) => ({ ...source })) };
}

/** Same check at the governed boundary and the direct legacy merge; model labels grant no authority. */
export function isChatMemoryRecordAdmissible(
    record: { text: string; conversationId: string; chatEvidence?: ChatMemoryCandidateEvidence },
    evidence: ChatMemoryAdmissionEvidence,
): boolean {
    const receipt = record.chatEvidence;
    if (!receipt || receipt.version !== 1 || receipt.textHash !== stableHash(record.text)
        || record.conversationId !== evidence.conversationId || !Array.isArray(receipt.sources)
        || receipt.sources.length === 0 || !Array.isArray(evidence.chatMessages)) return false;
    if (evidence.chatMessages.some((source) => !source || typeof source.messageId !== "string"
        || typeof source.contentHash !== "string" || source.conversationId !== evidence.conversationId)) return false;
    const messages = new Map(evidence.chatMessages.map((source) => [source.messageId, source]));
    if (messages.size !== evidence.chatMessages.length) return false;
    const sourceIds = new Set<string>();
    return receipt.sources.every((source) => {
        if (!source || sourceIds.has(source.messageId)) return false;
        sourceIds.add(source.messageId);
        const actual = messages.get(source.messageId);
        return actual?.kind === "ordinary_user_statement" && source.kind === actual.kind
            && source.conversationId === evidence.conversationId
            && actual.conversationId === evidence.conversationId && source.contentHash === actual.contentHash;
    });
}

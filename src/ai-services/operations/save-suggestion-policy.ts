import type { ChatContextUsedItem } from "../chat-types";

export type OperationsSaveSuggestionState = "offered" | "accepted" | "declined";

export interface OperationsSaveSuggestionInput {
    operationsEnabled: boolean;
    suggestionsEnabled: boolean;
    state?: OperationsSaveSuggestionState;
    turnCount: number;
    prompt: string;
    response: string;
    contextUsed: readonly ChatContextUsedItem[];
}

const VAULT_CONTEXT_CATEGORIES = new Set<ChatContextUsedItem["category"]>([
    "memory",
    "current-note",
    "vault-metadata",
    "recent-notes",
    "note-outline",
    "read-only-tool",
]);

const CONVERGENT_PROMPT_RE = /(?:总结|梳理|结论|决定|决策|方案|计划|设计|落地|归纳|收敛)|\b(?:summari[sz]e|conclusion|decision|plan|proposal|design|actionable|wrap\s+up)\b/iu;
const EXPLICIT_WRITE_RE = /(?:保存|写入|新建|创建|追加|更新|修改|落到|存到).{0,12}(?:笔记|知识库|vault)|(?:把|将).{0,80}(?:保存|写入|存到)|\b(?:save|write|create|append|update|edit)\b.{0,40}\b(?:note|vault|file)\b/iu;
const EXPLORATORY_RE = /(?:还没决定|继续探索|先看看|再想想|不确定|有哪些可能)|\b(?:still exploring|not decided|brainstorm|what if|possibilities)\b/iu;

export function shouldOfferOperationsSaveSuggestion(input: OperationsSaveSuggestionInput): boolean {
    if (!input.operationsEnabled || !input.suggestionsEnabled || input.state) return false;
    const prompt = input.prompt.trim();
    const response = input.response.trim();
    if (!prompt || response.length < 240) return false;
    if (EXPLICIT_WRITE_RE.test(prompt) || EXPLORATORY_RE.test(prompt)) return false;
    if (!input.contextUsed.some((item) => VAULT_CONTEXT_CATEGORIES.has(item.category))) return false;

    const convergent = CONVERGENT_PROMPT_RE.test(prompt);
    const structured = input.turnCount >= 2
        && response.length >= 520
        && /(?:^|\n)(?:#{1,4}\s+|[-*]\s+|\d+[.)]\s+|\|.+\|)/u.test(response);
    return convergent || structured;
}

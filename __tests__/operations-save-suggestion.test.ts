import { shouldOfferOperationsSaveSuggestion } from "../src/ai-services/operations/save-suggestion-policy";

const vaultContext = [{ category: "current-note" as const, label: "Current note" }];

describe("Operations save suggestion policy", () => {
    it("offers once for a convergent vault-backed answer", () => {
        expect(shouldOfferOperationsSaveSuggestion({
            operationsEnabled: true,
            suggestionsEnabled: true,
            turnCount: 1,
            prompt: "请总结这几篇笔记的结论",
            response: "结论如下。" + "这是一段来自知识库证据的完整分析。".repeat(20),
            contextUsed: vaultContext,
        })).toBe(true);
    });

    it.each(["offered", "accepted", "declined"] as const)("suppresses after %s", (state) => {
        expect(shouldOfferOperationsSaveSuggestion({
            operationsEnabled: true,
            suggestionsEnabled: true,
            state,
            turnCount: 3,
            prompt: "总结一下",
            response: "# 结论\n" + "完整内容。".repeat(100),
            contextUsed: vaultContext,
        })).toBe(false);
    });

    it("stays quiet for non-vault, exploratory, explicit-write, disabled, and short answers", () => {
        const base = {
            operationsEnabled: true,
            suggestionsEnabled: true,
            turnCount: 3,
            prompt: "请总结一下",
            response: "# 结论\n" + "完整内容。".repeat(100),
            contextUsed: vaultContext,
        };
        expect(shouldOfferOperationsSaveSuggestion({ ...base, contextUsed: [] })).toBe(false);
        expect(shouldOfferOperationsSaveSuggestion({ ...base, prompt: "我们还没决定，继续探索" })).toBe(false);
        expect(shouldOfferOperationsSaveSuggestion({ ...base, prompt: "把结论保存到知识库" })).toBe(false);
        expect(shouldOfferOperationsSaveSuggestion({ ...base, suggestionsEnabled: false })).toBe(false);
        expect(shouldOfferOperationsSaveSuggestion({ ...base, response: "简短回答" })).toBe(false);
    });

    it("allows a structured multi-turn answer without an explicit convergence phrase", () => {
        expect(shouldOfferOperationsSaveSuggestion({
            operationsEnabled: true,
            suggestionsEnabled: true,
            turnCount: 2,
            prompt: "你怎么看这个方向？",
            response: "## 观察\n- " + "有来源支持的结构化内容。".repeat(50),
            contextUsed: vaultContext,
        })).toBe(true);
    });
});

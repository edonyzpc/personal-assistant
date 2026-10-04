import { describe, expect, it } from "@jest/globals";
import type { ChatMessage } from "../src/ai-services/chat-types";
import { PaAgentContextProjector } from "../src/ai-services/context/PaAgentContextProjector";

// These fixtures measure what the deterministic projection actually carries.
// They do not score whether a model understands or follows the retained text.
describe("B-128 deterministic conversation continuity", () => {
    const projector = new PaAgentContextProjector();
    const fixture: ChatMessage[] = Array.from({ length: 24 }, (_, index) => [
        { role: "user" as const, content: `继续讨论第 ${index + 1} 个细节。` },
        { role: "assistant" as const, content: `已讨论第 ${index + 1} 个细节。` },
    ]).flat();
    fixture[0].content = "先只分析，不修改文件。技术方案必须保留 SQLite。";
    fixture[1].content = "确认使用 SQLite，暂不修改文件。";
    fixture[24].content = "调整一下：可以修改代码，但不要提交，也不要改变 Memory 的存储规则。";
    fixture[25].content = "确认本次允许修改代码，保留 Memory 存储规则，不提交。";
    fixture[40].content = "之前已确定先缩短旧工具结果，不要再问一遍。";
    fixture[41].content = "已确认先处理旧工具结果，当前待解决的是最终请求预算。";

    it("retains early constraints, later corrections and prior decisions beyond ten turns when they fit", () => {
        const original = JSON.stringify(fixture);
        const currentPrompt = "现在暂停修改，只复核最终请求预算。";
        const runtimeInstruction = "Current mode: read-only. Write actions are unavailable.";
        const projected = projector.projectUserInput({
            prompt: currentPrompt,
            runtimeInstruction,
            chatHistory: fixture,
            maxHistoryChars: 60000,
        });

        for (const message of fixture) expect(projected.history.text).toContain(message.content);
        expect(projected.history.historyCompressed).toBe(false);
        expect(projected.history.omittedCount).toBe(0);
        expect(projected.input).toContain(`User input:\n${currentPrompt}`);
        expect(projected.input).toContain(`<runtime_instruction>\n${runtimeInstruction}\n</runtime_instruction>`);
        expect(projected.input).toContain('<chat_history context_only="true" format="json">');
        expect(projected.input).not.toContain("<user_profile");
        expect(projected.input).not.toContain("<vault_insights");
        expect(JSON.stringify(fixture)).toBe(original);
    });

    it("repeated projection is stable and a larger target does not change retained original history", () => {
        const original = JSON.stringify(fixture);
        const options = { prompt: "继续复核", chatHistory: fixture, maxHistoryChars: 650 };
        const first = projector.projectUserInput(options);
        const again = projector.projectUserInput(options);
        const expanded = projector.projectUserInput({ ...options, maxHistoryChars: 60000 });

        expect(again).toEqual(first);
        expect(first.history.historyCompressed).toBe(false);
        expect(first.history.historyBudgetLimited).toBe(true);
        expect(first.history.omittedCount).toBe(0);
        expect(first.history.text.length).toBeGreaterThan(650);
        expect(first.history.text).toContain(fixture[fixture.length - 1].content);
        expect(expanded.history.historyCompressed).toBe(false);
        expect(expanded.history.text).toContain(fixture[0].content);
        expect(expanded.history.text).toContain(fixture[24].content);
        expect(first.history.text).toBe(expanded.history.text);
        expect(first.history.sourceMessages).toEqual(fixture);
        expect(JSON.stringify(fixture)).toBe(original);
    });

    it("keeps early requirements and corrections under severe local pressure", () => {
        const newestPair = fixture.slice(-2);
        const budget = projector.projectUserInput({
            prompt: "", chatHistory: newestPair, maxHistoryChars: 60000,
        }).history.text.length;
        const projected = projector.projectUserInput({
            prompt: "仅复核，不写入。",
            chatHistory: fixture,
            maxHistoryChars: budget,
        });

        expect(projected.history.text).toContain(newestPair[0].content);
        expect(projected.history.text).toContain(newestPair[1].content);
        expect(projected.history.text).toContain("SQLite");
        expect(projected.history.text).toContain("可以修改代码");
        expect(projected.history.text).toContain("但不要提交，也不要改变 Memory 的存储规则");
        expect(projected.history.omittedCount).toBe(0);
        expect(projected.history.compactedCount).toBe(0);
        expect(projected.history.historyCompressed).toBe(false);
        expect(projected.history.historyBudgetLimited).toBe(true);
        expect(projected.history.sourceMessages).toEqual(fixture);
        expect(projected.input).toContain("User input:\n仅复核，不写入。");
    });
});

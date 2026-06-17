import { describe, expect, it, jest } from "@jest/globals";

import {
    rewriteQuery,
    rewriteQueryForSearch,
    parseKeywordQuery,
    parseRewrittenQuery,
    isShortQuery,
    type RewriteInvoker,
} from "../src/ai-services/query-rewriter";

function makeInvoker(content: string): RewriteInvoker {
    return jest.fn(async () => content);
}

function makeFailingInvoker(): RewriteInvoker {
    return jest.fn(async () => { throw new Error("network timeout"); });
}

describe("rewriteQuery", () => {
    it("extracts keywords from valid JSON response", async () => {
        const invoke = makeInvoker('{"keywords":"React useMemo 性能优化"}');
        const result = await rewriteQuery("React 组件 渲染性能 怎么优化 useMemo有用吗", invoke);
        expect(result).toBe("React useMemo 性能优化");
        expect(invoke).toHaveBeenCalledWith("React 组件 渲染性能 怎么优化 useMemo有用吗", undefined);
    });

    it("returns null for short English queries (2-3 tokens)", async () => {
        const invoke = makeInvoker('{"keywords":"React hooks"}');
        const result = await rewriteQuery("React hooks", invoke);
        expect(result).toBeNull();
        expect(invoke).not.toHaveBeenCalled();
    });

    it("returns null for 3-token query", async () => {
        const invoke = makeInvoker('{"keywords":"a b c"}');
        const result = await rewriteQuery("one two three", invoke);
        expect(result).toBeNull();
        expect(invoke).not.toHaveBeenCalled();
    });

    it("invokes for 4+ token query", async () => {
        const invoke = makeInvoker('{"keywords":"React hooks performance memo"}');
        const result = await rewriteQuery("React hooks performance with memo", invoke);
        expect(result).toBe("React hooks performance memo");
        expect(invoke).toHaveBeenCalled();
    });

    it("invokes for long CJK single-token query", async () => {
        const invoke = makeInvoker('{"keywords":"猫类行为 观察方法"}');
        const result = await rewriteQuery("猫类行为研究有哪些常见的观察方法", invoke);
        expect(result).toBe("猫类行为 观察方法");
        expect(invoke).toHaveBeenCalled();
    });

    it("returns null for very short CJK query", async () => {
        const invoke = makeInvoker('{"keywords":"你好"}');
        const result = await rewriteQuery("你好呀", invoke);
        expect(result).toBeNull();
        expect(invoke).not.toHaveBeenCalled();
    });

    it("returns null when LLM returns empty content", async () => {
        const invoke = makeInvoker("");
        const result = await rewriteQuery("how to optimize React component rendering performance", invoke);
        expect(result).toBeNull();
    });

    it("returns null when LLM returns invalid JSON", async () => {
        const invoke = makeInvoker("here are some keywords: React, useMemo");
        const result = await rewriteQuery("how to optimize React component rendering performance", invoke);
        expect(result).toBeNull();
    });

    it("propagates invoker exceptions", async () => {
        const invoke = makeFailingInvoker();
        await expect(
            rewriteQuery("how to optimize React component rendering performance", invoke),
        ).rejects.toThrow("network timeout");
    });

    it("handles JSON with extra whitespace", async () => {
        const invoke = makeInvoker('  { "keywords" : "ERR_OPFS_LOCKED sqlite" }  ');
        const result = await rewriteQuery("what causes ERR_OPFS_LOCKED in sqlite wasm workers", invoke);
        expect(result).toBe("ERR_OPFS_LOCKED sqlite");
    });

    it("returns null when keywords value is empty string", async () => {
        const invoke = makeInvoker('{"keywords":""}');
        const result = await rewriteQuery("please help me find something in my notes today", invoke);
        expect(result).toBeNull();
    });

    it("passes signal to invoker", async () => {
        const invoke = makeInvoker('{"keywords":"test"}');
        const controller = new AbortController();
        await rewriteQuery("how to optimize React component rendering performance", invoke, controller.signal);
        expect(invoke).toHaveBeenCalledWith(expect.any(String), controller.signal);
    });
});

describe("rewriteQueryForSearch", () => {
    it("returns temporal intent for concise recent queries without invoking the model", async () => {
        const invoke = makeInvoker('{"keywords":"ignored","temporal":"none"}');
        const result = await rewriteQueryForSearch("latest notes", invoke);
        expect(result).toEqual({ keywords: null, temporal: "recent_30d" });
        expect(invoke).not.toHaveBeenCalled();
    });

    it("keeps rewritten keywords and temporal intent from the model", async () => {
        const invoke = makeInvoker('{"keywords":"Memory refresh","temporal":"recent_7d"}');
        const result = await rewriteQueryForSearch("what changed in Memory refresh last week", invoke);
        expect(result).toEqual({ keywords: "Memory refresh", temporal: "recent_7d" });
    });
});

describe("isShortQuery", () => {
    it("short English: 2 tokens", () => expect(isShortQuery("React hooks")).toBe(true));
    it("short English: 3 tokens", () => expect(isShortQuery("one two three")).toBe(true));
    it("long English: 4+ tokens", () => expect(isShortQuery("React hooks with memo")).toBe(false));
    it("long CJK: 1 token, >15 chars", () => expect(isShortQuery("猫类行为研究有哪些常见的观察方法和记录")).toBe(false));
    it("short CJK: 1 token, few chars", () => expect(isShortQuery("你好")).toBe(true));
    it("medium CJK: borderline ≤15", () => expect(isShortQuery("猫类行为研究")).toBe(true));
});

describe("parseKeywordQuery", () => {
    it("parses standard JSON", () => {
        expect(parseKeywordQuery('{"keywords":"React hooks"}')).toBe("React hooks");
    });

    it("parses JSON with extra fields", () => {
        expect(parseKeywordQuery('{"keywords":"test","confidence":0.9}')).toBe("test");
    });

    it("extracts from markdown code fences", () => {
        expect(parseKeywordQuery('```json\n{"keywords":"渲染 优化"}\n```')).toBe("渲染 优化");
    });

    it("returns null for empty string", () => {
        expect(parseKeywordQuery("")).toBeNull();
    });

    it("returns null for non-JSON text", () => {
        expect(parseKeywordQuery("these are keywords")).toBeNull();
    });

    it("returns null when keywords field is missing", () => {
        expect(parseKeywordQuery('{"query":"test"}')).toBeNull();
    });

    it("returns null for empty keywords value", () => {
        expect(parseKeywordQuery('{"keywords":""}')).toBeNull();
    });

    it("trims whitespace from keywords", () => {
        expect(parseKeywordQuery('{"keywords":"  React hooks  "}')).toBe("React hooks");
    });
});

describe("parseRewrittenQuery", () => {
    it("preserves temporal intent even when the model returns empty keywords", () => {
        expect(parseRewrittenQuery('{"keywords":"","temporal":"recent_30d"}')).toEqual({
            keywords: null,
            temporal: "recent_30d",
        });
    });

    it("parses temporal intent from markdown fenced JSON", () => {
        expect(parseRewrittenQuery('```json\n{"keywords":"Pagelet review","temporal":"recent_7d"}\n```'))
            .toEqual({ keywords: "Pagelet review", temporal: "recent_7d" });
    });

    it("parses range: temporal intent with valid date range", () => {
        expect(parseRewrittenQuery('{"keywords":"project notes","temporal":"range:2025-01-01..2025-03-31"}')).toEqual({
            keywords: "project notes",
            temporal: "range:2025-01-01..2025-03-31",
        });
    });

    it("rejects range: temporal with invalid dates", () => {
        expect(parseRewrittenQuery('{"keywords":"notes","temporal":"range:invalid..dates"}')).toEqual({
            keywords: "notes",
            temporal: "none",
        });
    });

    it("rejects range: temporal with missing separator", () => {
        expect(parseRewrittenQuery('{"keywords":"notes","temporal":"range:2025-01-01"}')).toEqual({
            keywords: "notes",
            temporal: "none",
        });
    });
});

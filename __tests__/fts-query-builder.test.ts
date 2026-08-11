import { describe, expect, it } from "@jest/globals";

import { buildFtsQuery } from "../src/vss/fts-query-builder";

describe("buildFtsQuery (CHAR-PHRASE)", () => {
    it("converts a continuous CJK run to one atomic-token phrase", () => {
        expect(buildFtsQuery("渲染优化")).toBe('"c6e32 c67d3 c4f18 c5316"');
    });

    it("keeps Latin words as bare terms", () => {
        expect(buildFtsQuery("React performance")).toBe("React performance");
    });

    it("produces CJK phrases and Latin bare terms for mixed input", () => {
        expect(buildFtsQuery("React 渲染性能")).toBe('React "c6e32 c67d3 c6027 c80fd"');
    });

    it("keeps code identifiers as bare terms", () => {
        expect(buildFtsQuery("useMemo useCallback")).toBe("useMemo useCallback");
    });

    it("keeps underscore identifiers intact", () => {
        expect(buildFtsQuery("ERR_OPFS_LOCKED")).toBe("ERR_OPFS_LOCKED");
    });

    it("returns null for empty string", () => {
        expect(buildFtsQuery("")).toBeNull();
    });

    it("returns null for null or undefined input", () => {
        expect(buildFtsQuery(null as unknown as string)).toBeNull();
        expect(buildFtsQuery(undefined as unknown as string)).toBeNull();
    });

    it("returns null for whitespace-only input", () => {
        expect(buildFtsQuery("   ")).toBeNull();
    });

    it("returns null for emoji-only input", () => {
        expect(buildFtsQuery("🎉🚀")).toBeNull();
    });

    it("quotes FTS5 reserved words case-insensitively", () => {
        expect(buildFtsQuery("React AND hooks")).toBe('React "AND" hooks');
        expect(buildFtsQuery("React or hooks")).toBe('React "or" hooks');
    });

    it("treats common punctuation as a token boundary", () => {
        expect(buildFtsQuery("key:value")).toBe("key value");
    });

    it("uses production clause delimiters for the provisional clause_OR candidate", () => {
        expect(buildFtsQuery("差旅报销，电子发票", "clause_OR")).toBe(
            '("c5dee c65c5 c62a5 c9500") OR ("c7535 c5b50 c53d1 c7968")',
        );
        expect(buildFtsQuery("差旅报销;电子发票", "clause_OR")).toBe(
            '("c5dee c65c5 c62a5 c9500") OR ("c7535 c5b50 c53d1 c7968")',
        );
    });

    it("does not reinterpret space-separated rewrite keywords as OR clauses", () => {
        const query = buildFtsQuery("差旅报销 电子发票", "clause_OR");
        expect(query).not.toContain(" OR ");
        expect(query).toBe('"c5dee c65c5 c62a5 c9500" "c7535 c5b50 c53d1 c7968"');
    });

    it("quotes version and date tokens that are unsafe FTS5 barewords", () => {
        expect(buildFtsQuery("iOS 2.8.4")).toBe('iOS "2.8.4"');
        expect(buildFtsQuery("2026.07.09")).toBe('"2026.07.09"');
    });

    it("quotes dotted domain and file-name tokens", () => {
        expect(buildFtsQuery("example.com")).toBe('"example.com"');
        expect(buildFtsQuery("docs guide.md")).toBe('docs "guide.md"');
    });

    it("strips punctuation delimiters between tokens", () => {
        expect(buildFtsQuery("hello, world! yes")).toBe("hello world yes");
    });

    it("treats single CJK character as bare token (no phrase)", () => {
        const result = buildFtsQuery("的")!;
        expect(result).toBe("c7684");
        expect(result).not.toContain('"');
    });

    it("handles long CJK phrase with multiple words", () => {
        const result = buildFtsQuery("自然语言处理技术")!;
        expect(result).not.toBeNull();
        expect(result).toContain('"');
    });
});

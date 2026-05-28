import { describe, expect, it } from "@jest/globals";

import { buildFtsQuery } from "../src/vss/fts-query-builder";

describe("buildFtsQuery (Intl.Segmenter path)", () => {
    it("converts CJK words to phrase queries", () => {
        const result = buildFtsQuery("渲染优化")!;
        expect(result).toContain('"渲 染"');
    });

    it("keeps Latin words as bare terms", () => {
        expect(buildFtsQuery("React performance")).toBe("React performance");
    });

    it("produces CJK phrases and Latin bare terms for mixed input", () => {
        const result = buildFtsQuery("React 渲染性能")!;
        expect(result).toMatch(/^React /);
        expect(result).toContain('"渲 染"');
        expect(result).toContain('"性 能"');
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

    it("quotes tokens containing colons", () => {
        const result = buildFtsQuery("key:value")!;
        expect(result).toContain('"key:value"');
    });

    it("strips punctuation delimiters between tokens", () => {
        expect(buildFtsQuery("hello, world! yes")).toBe("hello world yes");
    });

    it("treats single CJK character as bare token (no phrase)", () => {
        const result = buildFtsQuery("的")!;
        expect(result).toBe("的");
        expect(result).not.toContain('"');
    });

    it("handles long CJK phrase with multiple words", () => {
        const result = buildFtsQuery("自然语言处理技术")!;
        expect(result).not.toBeNull();
        expect(result).toContain('"');
    });
});

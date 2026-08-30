import { describe, expect, it } from "@jest/globals";

import {
    CHAR_PHRASE_PROFILE_ID,
    buildCharPhraseFields,
    buildCharPhraseFtsQuery,
    charPhraseTokens,
    getCharPhraseRuntimeCanaryFingerprint,
    normalizeBoundedPathSurface,
    segmentGraphemes,
    transformCharPhraseDocument,
} from "../src/vss/lexical-normalizer";

describe("char-phrase-v1 lexical normalization", () => {
    it("uses one unicode61-safe atom per CJK grapheme", () => {
        expect(charPhraseTokens("召回")).toEqual(["c53ec", "c56de"]);
        expect(transformCharPhraseDocument("召回。结果")).toBe("c53ec c56de 。 c7ed3 c679c");
        expect(buildCharPhraseFtsQuery("召回。结果")).toBe('"c53ec c56de" "c7ed3 c679c"');
    });

    it("keeps multi-scalar graphemes atomic", () => {
        const value = "葛\u{E0100}";
        expect(segmentGraphemes(value)).toEqual([value]);
        expect(charPhraseTokens(value)).toEqual(["c845bxe0100"]);
    });

    it("excludes CJK punctuation while retaining lexical marks", () => {
        expect(charPhraseTokens("。、、・・·")).toEqual([]);
        expect(charPhraseTokens("々ー")).toEqual(["c3005", "c30fc"]);
        expect(buildCharPhraseFtsQuery("日本語・検索")).toBe('"c65e5 c672c c8a9e" "c691c c7d22"');
    });

    it("builds independent bounded title, heading, body and path surfaces", () => {
        expect(buildCharPhraseFields({
            path: "Projects/检索优化/方案.md",
            headingPath: ["架构", "召回策略"],
            content: "机器学习",
        })).toEqual({
            title: "c65b9 c6848",
            heading: "c67b6 c6784 c53ec c56de c7b56 c7565",
            body: "c673a c5668 c5b66 c4e60",
            path: "c68c0 c7d22 c4f18 c5316 c65b9 c6848",
        });
        expect(normalizeBoundedPathSurface("a/b/c/file-name.md")).toBe("c file name");
    });

    it("produces a stable profile-scoped runtime fingerprint", () => {
        const fingerprint = getCharPhraseRuntimeCanaryFingerprint();
        expect(fingerprint).toMatch(new RegExp(`^${CHAR_PHRASE_PROFILE_ID}:[0-9a-f]{16}$`));
        expect(getCharPhraseRuntimeCanaryFingerprint()).toBe(fingerprint);
    });
});

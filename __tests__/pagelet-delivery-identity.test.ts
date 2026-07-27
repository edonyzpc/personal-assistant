/* Copyright 2023 edonyzpc */

import { describe, expect, it } from "@jest/globals";

import {
    buildRecallDeliveryReceipt,
    buildRecapDeliveryReceipt,
} from "../src/pagelet/attention/fingerprint";

describe("Pagelet delivery identity", () => {
    it("normalizes Recall text, newlines, whitespace, locale, paths, and source order", () => {
        const first = buildRecallDeliveryReceipt({
            locale: " EN-US ",
            title: "Ａ  useful\r\n title",
            body: "A\tbody\rwith   spaces",
            whyNow: [" because\r\n now "],
            excerpt: [" excerpt\tone "],
            currentSourceIdentity: "./Projects\\Current.md/",
            recalledSourceIdentities: [
                "./Sources//Zeta.md",
                "Sources\\Alpha.md",
            ],
        });
        const second = buildRecallDeliveryReceipt({
            locale: "en-us",
            title: "A useful title",
            body: "A body with spaces",
            whyNow: "because now",
            excerpt: "excerpt one",
            currentSourceIdentity: "Projects/Current.md",
            recalledSourceIdentities: [
                "Sources/Alpha.md",
                "Sources/Zeta.md",
            ],
        });

        expect(first).toEqual(second);
        expect(first).toEqual({
            version: 1,
            kind: "recall",
            fingerprint: expect.stringMatching(/^v1:recall:[0-9a-f]{16}$/),
        });
        expect(buildRecallDeliveryReceipt({
            locale: "en-us",
            title: "A useful title",
            body: "A body with spaces",
            whyNow: "because now",
            excerpt: "excerpt one",
            currentSourceIdentity: "Projects/Current.md",
            recalledSourceIdentities: [
                "Sources/Alpha.md",
                "Sources/Alpha.md",
                "Sources/Zeta.md",
            ],
        })).toEqual(second);
    });

    it("normalizes structured Recap scope identity and sorted sources deterministically", () => {
        const first = buildRecapDeliveryReceipt({
            locale: "ZH-CN",
            title: "本周  总结",
            body: "第一行\r\n第二行",
            whyItMatters: [" 重新连接\t旧想法 "],
            scopeIdentity: {
                kind: "FOLDER",
                label: " 项目　甲 ",
                paths: ["./Work//B", "Work\\A"],
                tags: ["#PA", "  #Ideas "],
            },
            sourceIdentities: ["Work/B.md", "./Work//A.md"],
        });
        const second = buildRecapDeliveryReceipt({
            locale: "zh-cn",
            title: "本周 总结",
            body: "第一行 第二行",
            whyItMatters: "重新连接 旧想法",
            scopeIdentity: {
                kind: "folder",
                label: "项目 甲",
                paths: ["Work/A", "Work/B"],
                tags: ["ideas", "pa"],
            },
            sourceIdentities: ["Work/A.md", "Work/B.md"],
        });

        expect(first).toEqual(second);
        expect(first.fingerprint).toMatch(/^v1:recap:[0-9a-f]{16}$/);
        expect(buildRecapDeliveryReceipt({
            locale: "zh-cn",
            title: "本周 总结",
            body: "第一行 第二行",
            whyItMatters: "重新连接 旧想法",
            scopeIdentity: {
                kind: "folder",
                label: "项目 甲",
                paths: ["Work/A", "Work/A", "Work/B"],
                tags: ["ideas", "ideas", "pa"],
            },
            sourceIdentities: ["Work/A.md", "Work/A.md", "Work/B.md"],
        })).toEqual(second);
    });

    it("uses explicit empty values rather than unstable fallback identities", () => {
        const missing = buildRecallDeliveryReceipt({
            recalledSourceIdentities: [],
        });
        const explicit = buildRecallDeliveryReceipt({
            locale: "",
            title: "",
            body: null,
            whyNow: [],
            excerpt: "",
            currentSourceIdentity: "",
            recalledSourceIdentities: [],
        });

        expect(missing).toEqual(explicit);

        expect(buildRecapDeliveryReceipt({}))
            .toEqual(buildRecapDeliveryReceipt({
                locale: "",
                title: null,
                body: "",
                whyItMatters: [],
                scopeIdentity: "",
                sourceIdentities: [],
            }));
    });

    it("keeps transient delivery metadata out of the fingerprint", () => {
        const base = {
            locale: "en",
            title: "A returned note",
            body: "Visible summary",
            whyNow: ["Relevant now"],
            currentSourceIdentity: "Current.md",
            recalledSourceIdentities: ["Old.md"],
        };
        const withTransientFields = {
            ...base,
            generatedAt: "2099-01-01T00:00:00.000Z",
            runId: "run-2",
            candidateId: "candidate-2",
            score: 0.01,
            provider: "different-provider",
            model: "different-model",
            route: "/different",
            actionLabel: "Different chrome",
            diagnostics: { hidden: "value" },
        };

        expect(buildRecallDeliveryReceipt(withTransientFields))
            .toEqual(buildRecallDeliveryReceipt(base));
    });

    it.each([
        ["locale", { locale: "zh" }],
        ["title", { title: "Changed title" }],
        ["body", { body: "Changed body" }],
        ["why now", { whyNow: ["Changed reason"] }],
        ["excerpt", { excerpt: "Changed excerpt" }],
        ["current source", { currentSourceIdentity: "Other-current.md" }],
        ["recalled source", { recalledSourceIdentities: ["Other-old.md"] }],
    ])("changes Recall identity when visible %s changes", (_label, changed) => {
        const base = {
            locale: "en",
            title: "Title",
            body: "Body",
            whyNow: ["Reason"],
            excerpt: "Excerpt",
            currentSourceIdentity: "Current.md",
            recalledSourceIdentities: ["Old.md"],
        };

        expect(buildRecallDeliveryReceipt({ ...base, ...changed }).fingerprint)
            .not.toBe(buildRecallDeliveryReceipt(base).fingerprint);
    });

    it.each([
        ["locale", { locale: "zh" }],
        ["title", { title: "Changed title" }],
        ["body", { body: "Changed body" }],
        ["why it matters", { whyItMatters: "Changed reason" }],
        ["scope", { scopeIdentity: { kind: "tag", tags: ["other"] } }],
        ["source", { sourceIdentities: ["Other.md"] }],
    ])("changes Recap identity when canonical %s changes", (_label, changed) => {
        const base = {
            locale: "en",
            title: "Title",
            body: "Body",
            whyItMatters: "Reason",
            scopeIdentity: { kind: "folder", paths: ["Work"] },
            sourceIdentities: ["Work/One.md"],
        };

        expect(buildRecapDeliveryReceipt({ ...base, ...changed }).fingerprint)
            .not.toBe(buildRecapDeliveryReceipt(base).fingerprint);
    });

    it("keeps Recall and Recap separate even when visible fields match", () => {
        const recall = buildRecallDeliveryReceipt({
            locale: "en",
            title: "Same",
            body: "Same",
            whyNow: "Same",
            currentSourceIdentity: "",
            recalledSourceIdentities: ["Same.md"],
        });
        const recap = buildRecapDeliveryReceipt({
            locale: "en",
            title: "Same",
            body: "Same",
            whyItMatters: "Same",
            scopeIdentity: "",
            sourceIdentities: ["Same.md"],
        });

        expect(recall.kind).toBe("recall");
        expect(recap.kind).toBe("recap");
        expect(recall.fingerprint).not.toBe(recap.fingerprint);
    });

    it("returns only an opaque receipt without source or visible text", () => {
        const receipt = buildRecallDeliveryReceipt({
            locale: "en",
            title: "Private visible title",
            body: "Private visible body",
            currentSourceIdentity: "Private/Current.md",
            recalledSourceIdentities: ["Private/Recalled.md"],
        });
        const serialized = JSON.stringify(receipt);

        expect(serialized).not.toContain("Private");
        expect(serialized).not.toContain(".md");
    });
});

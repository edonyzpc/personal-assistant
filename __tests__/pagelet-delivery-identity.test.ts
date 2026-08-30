/* Copyright 2023 edonyzpc */

import { describe, expect, it } from "@jest/globals";

import {
    buildRecallDeliveryReceipt,
    buildRecapDeliveryReceipt,
    buildReviewDeliveryReceipt,
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

    it("normalizes Deep Discover review identity and keeps it distinct", () => {
        const first = buildReviewDeliveryReceipt({
            locale: " ZH-CN ",
            title: "一个  新洞察",
            body: "证据 A\r\n证据 B",
            whyNow: [" 离开笔记 "],
            anchorSourceIdentity: "./Projects\\Anchor.md",
            sourceIdentities: ["Sources/B.md", "./Sources//A.md"],
        });
        const second = buildReviewDeliveryReceipt({
            locale: "zh-cn",
            title: "一个 新洞察",
            body: "证据 A 证据 B",
            whyNow: "离开笔记",
            anchorSourceIdentity: "Projects/Anchor.md",
            sourceIdentities: ["Sources/A.md", "Sources/B.md"],
        });

        expect(first).toEqual(second);
        expect(first).toEqual({
            version: 1,
            kind: "review",
            fingerprint: expect.stringMatching(/^v1:review:[0-9a-f]{16}$/),
        });
        expect(first.fingerprint).not.toBe(buildRecallDeliveryReceipt({
            locale: "zh-cn",
            title: "一个 新洞察",
            body: "证据 A 证据 B",
            whyNow: "离开笔记",
            currentSourceIdentity: "Projects/Anchor.md",
            recalledSourceIdentities: ["Sources/A.md", "Sources/B.md"],
        }).fingerprint);
    });

    it("keeps Deep Discover trigger metadata out of review identity", () => {
        const stableFields = {
            locale: "zh",
            title: "发布策略存在风险缺口",
            body: "两篇笔记的发布假设发生冲突。",
            anchorSourceIdentity: "notes/anchor.md",
            sourceIdentities: ["notes/anchor.md", "notes/related.md"],
        };
        const afterLeave = {
            ...stableFields,
            triggerReason: "leave-note",
        };
        const afterEdit = {
            ...stableFields,
            triggerReason: "edit-idle",
        };

        expect(buildReviewDeliveryReceipt(afterLeave))
            .toEqual(buildReviewDeliveryReceipt(afterEdit));
    });

    it("uses the stable insight ID as the normative review identity without a schema bump", () => {
        const visible = {
            locale: "zh",
            title: "同一可见标题",
            body: "同一可见正文",
            whyNow: "同一出现原因",
            anchorSourceIdentity: "notes/anchor.md",
            sourceIdentities: ["notes/anchor.md", "notes/related.md"],
        };
        const first = buildReviewDeliveryReceipt({
            ...visible,
            insightId: "pagelet-insight:first",
        });
        const second = buildReviewDeliveryReceipt({
            ...visible,
            insightId: "pagelet-insight:second",
        });
        const localizedRetrigger = buildReviewDeliveryReceipt({
            ...visible,
            insightId: "pagelet-insight:first",
            locale: "en",
            title: "Localized title",
            body: "Localized visible body",
            whyNow: "A different trigger explanation",
        });

        expect(first.version).toBe(1);
        expect(second.version).toBe(1);
        expect(localizedRetrigger).toEqual(first);
        expect(first.fingerprint).not.toBe(second.fingerprint);
        expect(buildReviewDeliveryReceipt(visible)).toEqual(
            buildReviewDeliveryReceipt({ ...visible, insightId: "   " }),
        );
    });

    it.each([
        ["locale", { locale: "zh" }],
        ["title", { title: "Changed title" }],
        ["body", { body: "Changed body" }],
        ["anchor", { anchorSourceIdentity: "Other/Anchor.md" }],
        ["source", { sourceIdentities: ["Other/Source.md"] }],
    ])("changes review identity when canonical %s changes", (_label, changed) => {
        const base = {
            locale: "en",
            title: "Source-backed insight",
            body: "Two decisions now conflict.",
            whyNow: "The anchor changed.",
            anchorSourceIdentity: "Projects/Anchor.md",
            sourceIdentities: ["Projects/Decision.md"],
        };

        expect(buildReviewDeliveryReceipt({ ...base, ...changed }).fingerprint)
            .not.toBe(buildReviewDeliveryReceipt(base).fingerprint);
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

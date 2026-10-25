/* Copyright 2023 edonyzpc */

import { describe, expect, it } from "@jest/globals";

import {
    buildReviewDeliveryReceipt,
} from "../src/pagelet/attention/fingerprint";

describe("Pagelet delivery identity", () => {

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
        const receipt = buildReviewDeliveryReceipt({
            locale: "en",
            title: "Private visible title",
            body: "Private visible body",
            anchorSourceIdentity: "Private/Current.md",
            sourceIdentities: ["Private/Recalled.md"],
        });
        const serialized = JSON.stringify(receipt);

        expect(serialized).not.toContain("Private");
        expect(serialized).not.toContain(".md");
    });
});

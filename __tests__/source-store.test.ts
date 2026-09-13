import { describe, expect, it } from "@jest/globals";

import {
    cloneSourceRecord,
    createSourceDedupKey,
    normalizeSourceRecord,
    sanitizeWebSourceUrl,
} from "../src/ai-services/source-store";

describe("source record normalization", () => {
    it("sanitizes web URLs and rejects non-web schemes", () => {
        expect(sanitizeWebSourceUrl("javascript:alert(1)")).toBeNull();
        expect(sanitizeWebSourceUrl("file:///private/vault.md")).toBeNull();
        expect(sanitizeWebSourceUrl("https://user:pass@example.com/path?token=SECRET&q=ok#frag")).toBe(
            "https://example.com/path?token=REDACTED&q=ok",
        );
    });

    it("rejects web sources without a usable URL", () => {
        expect(normalizeSourceRecord({
            kind: "web-source",
            url: "javascript:alert(1)",
            title: "Unsafe",
        })).toBeNull();
    });

    it("strips HTML, truncates source text, and marks redacted URLs", () => {
        const record = normalizeSourceRecord({
            kind: "web-source",
            url: "https://user:pass@example.com/path?token=SECRET&q=ok#frag",
            title: "<b>Title</b>",
            snippet: `<p>${"x".repeat(700)}</p>`,
        });

        expect(record).toMatchObject({
            title: "Title",
            url: "https://example.com/path?token=REDACTED&q=ok",
            redacted: true,
            citationEligible: true,
        });
        expect(record?.snippet?.length).toBeLessThanOrEqual(500);
        expect(record?.snippet?.endsWith("...")).toBe(true);
        expect(record?.dedupKey).toBe(createSourceDedupKey("https://example.com/path?token=REDACTED&q=ok"));
    });

    it("preserves caller-provided eligibility, status, dedup key, and metadata", () => {
        const metadata = { sourceDependency: true };
        const record = normalizeSourceRecord({
            kind: "context-used",
            path: "notes/project.md",
            title: "Project",
            dedupKey: "source:fixed",
            citationEligible: false,
            statusOnly: true,
            metadata,
        });

        expect(record).toMatchObject({
            dedupKey: "source:fixed",
            citationEligible: false,
            statusOnly: true,
            metadata,
            redacted: false,
        });
    });

    it("clones source metadata without sharing the nested object", () => {
        const metadata = { sourceDependency: true };
        const record = cloneSourceRecord({
            kind: "context-used",
            dedupKey: "source:fixed",
            path: "notes/project.md",
            metadata,
        });

        expect(record.metadata).toEqual(metadata);
        expect(record.metadata).not.toBe(metadata);
    });
});

/* Copyright 2023 edonyzpc */

import { describe, expect, it, beforeEach } from "@jest/globals";

import { ChangeDetector } from "../src/pagelet/scope/ChangeDetector";

/** Create a minimal TFile-like mock with the fields ChangeDetector reads. */
const mockFile = (path: string, mtime: number) =>
    ({
        path,
        stat: { mtime },
    }) as any;

describe("ChangeDetector", () => {
    let detector: ChangeDetector;

    beforeEach(() => {
        detector = new ChangeDetector();
    });

    describe("getChangedFiles", () => {
        it("returns all files on first call (nothing analyzed yet)", () => {
            const files = [
                mockFile("a.md", 100),
                mockFile("b.md", 200),
            ];
            const changed = detector.getChangedFiles(files);
            expect(changed).toEqual(files);
        });

        it("returns only modified files after markAnalyzed", () => {
            const files = [
                mockFile("a.md", 100),
                mockFile("b.md", 200),
            ];
            // Analyze both at their current mtime
            detector.markAnalyzed("a.md", 100);
            detector.markAnalyzed("b.md", 200);

            // No changes -> empty
            expect(detector.getChangedFiles(files)).toEqual([]);

            // Modify b.md (bump mtime)
            const updated = [
                mockFile("a.md", 100),
                mockFile("b.md", 300),
            ];
            const changed = detector.getChangedFiles(updated);
            expect(changed).toHaveLength(1);
            expect(changed[0].path).toBe("b.md");
        });

        it("returns empty when no files changed", () => {
            const files = [mockFile("a.md", 100)];
            detector.markAnalyzed("a.md", 100);
            expect(detector.getChangedFiles(files)).toEqual([]);
        });

        it("prunes stale entries for deleted files", () => {
            const files = [
                mockFile("a.md", 100),
                mockFile("b.md", 200),
            ];
            detector.markAnalyzed("a.md", 100);
            detector.markAnalyzed("b.md", 200);

            // b.md is deleted -- only a.md remains
            const remaining = [mockFile("a.md", 100)];
            detector.getChangedFiles(remaining);

            // After pruning, getLastAnalysisTime should still work correctly
            // and b.md should no longer be tracked. If we re-add b.md it
            // should appear as changed (new file).
            const withNewB = [
                mockFile("a.md", 100),
                mockFile("b.md", 500),
            ];
            const changed = detector.getChangedFiles(withNewB);
            expect(changed).toHaveLength(1);
            expect(changed[0].path).toBe("b.md");
        });
    });

    describe("markAnalyzed", () => {
        it("records timestamp for analyzed files", () => {
            const files = [mockFile("a.md", 100)];
            detector.markAnalyzed("a.md", 100);
            expect(detector.getChangedFiles(files)).toEqual([]);
        });

        it("subsequent getChangedFiles excludes them", () => {
            const files = [
                mockFile("a.md", 100),
                mockFile("b.md", 200),
                mockFile("c.md", 300),
            ];
            detector.markAnalyzed("a.md", 100);
            detector.markAnalyzed("c.md", 300);

            const changed = detector.getChangedFiles(files);
            expect(changed).toHaveLength(1);
            expect(changed[0].path).toBe("b.md");
        });
    });

    describe("clear", () => {
        it("resets all tracked timestamps", () => {
            detector.markAnalyzed("a.md", 100);
            detector.markAnalyzed("b.md", 200);
            detector.clear();
            expect(detector.getLastAnalysisTime()).toBeNull();
        });

        it("next getChangedFiles returns all files", () => {
            const files = [
                mockFile("a.md", 100),
                mockFile("b.md", 200),
            ];
            detector.markAnalyzed("a.md", 100);
            detector.markAnalyzed("b.md", 200);
            expect(detector.getChangedFiles(files)).toEqual([]);

            detector.clear();
            expect(detector.getChangedFiles(files)).toEqual(files);
        });
    });
});

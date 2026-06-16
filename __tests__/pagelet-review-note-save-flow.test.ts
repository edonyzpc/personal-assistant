/* Copyright 2023 edonyzpc */

import { describe, expect, it, jest } from "@jest/globals";

jest.mock("obsidian", () => ({
    Notice: jest.fn(),
    normalizePath: (path: string) => path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/g, ""),
}));

import {
    ReviewNoteSaveFlow,
    type ReviewNoteSaveHost,
    type ReviewNoteSaveCallbacks,
} from "../src/pagelet/ReviewNoteSaveFlow";
import type { PanelFinding } from "../src/pagelet/panel/types";
import type { GeneratedReviewNote, WriteResult } from "../src/pagelet/output/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHost(overrides: Partial<ReviewNoteSaveHost> = {}): ReviewNoteSaveHost {
    const activeFile = {
        path: "notes/current.md",
        basename: "current",
        extension: "md",
    };
    return {
        app: {
            workspace: {
                getActiveFile: jest.fn(() => activeFile),
            },
        } as unknown as ReviewNoteSaveHost["app"],
        settings: {
            pagelet: {
                reviewsFolder: ".pagelet",
            },
        },
        log: jest.fn(),
        writeReviewNote: jest.fn(async () => ({
            success: true,
            filePath: ".pagelet/test-review.md",
        })),
        ...overrides,
    };
}

function makeCallbacks(overrides: Partial<ReviewNoteSaveCallbacks> = {}): ReviewNoteSaveCallbacks {
    return {
        petTransition: jest.fn(),
        petFlashError: jest.fn(),
        closePanel: jest.fn(),
        getAnalysisSourcePath: jest.fn(() => "notes/current.md"),
        ...overrides,
    };
}

function makeFinding(overrides: Partial<PanelFinding> = {}): PanelFinding {
    return {
        title: "Test Finding Title",
        description: "This is a test finding with sufficient length for validation.",
        sourceFile: "notes/current.md",
        sourceTitle: "current",
        ...overrides,
    };
}

function makePendingNote(overrides: Partial<GeneratedReviewNote> = {}): GeneratedReviewNote {
    return {
        markdown: "---\npagelet: true\n---\n# Review\nSummary content.",
        fileName: "pagelet-weekly-review-2026-06-16.md",
        targetFolder: ".pagelet",
        targetPath: ".pagelet/pagelet-weekly-review-2026-06-16.md",
        sources: ["[[note-1]]", "[[note-2]]"],
        tokenCost: { input: 500, output: 200 },
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReviewNoteSaveFlow", () => {
    describe("saveFindingsAsReviewNote — normal save (review layout)", () => {
        it("writes a review note and closes the panel on success", async () => {
            const writeReviewNote = jest.fn<(note: GeneratedReviewNote) => Promise<WriteResult>>(
                async () => ({ success: true, filePath: ".pagelet/review.md" }),
            );
            const host = makeHost({ writeReviewNote });
            const callbacks = makeCallbacks();
            const flow = new ReviewNoteSaveFlow(host, callbacks);
            const findings = [makeFinding()];

            await flow.saveFindingsAsReviewNote(findings, "review");

            expect(writeReviewNote).toHaveBeenCalledTimes(1);
            const writtenNote = writeReviewNote.mock.calls[0][0];
            expect(writtenNote.markdown).toContain("pagelet");
            expect(writtenNote.targetFolder).toBe(".pagelet");
            expect(callbacks.petTransition).toHaveBeenCalledWith("analysis-start");
            expect(callbacks.petTransition).toHaveBeenCalledWith("analysis-done");
            expect(callbacks.closePanel).toHaveBeenCalledTimes(1);
            expect(flow.isSaveInProgress).toBe(false);
        });

        it("flashes error on write failure", async () => {
            const writeReviewNote = jest.fn<(note: GeneratedReviewNote) => Promise<WriteResult>>(
                async () => ({ success: false, error: "disk full" }),
            );
            const host = makeHost({ writeReviewNote });
            const callbacks = makeCallbacks();
            const flow = new ReviewNoteSaveFlow(host, callbacks);

            await flow.saveFindingsAsReviewNote([makeFinding()], "review");

            expect(callbacks.petFlashError).toHaveBeenCalledTimes(1);
            expect(callbacks.closePanel).not.toHaveBeenCalled();
            expect(flow.isSaveInProgress).toBe(false);
        });

        it("handles thrown exception during write", async () => {
            const writeReviewNote = jest.fn<(note: GeneratedReviewNote) => Promise<WriteResult>>(
                async () => { throw new Error("unexpected IO error"); },
            );
            const host = makeHost({ writeReviewNote });
            const callbacks = makeCallbacks();
            const flow = new ReviewNoteSaveFlow(host, callbacks);

            await flow.saveFindingsAsReviewNote([makeFinding()], "review");

            expect(callbacks.petTransition).toHaveBeenCalledWith("analysis-done");
            expect(callbacks.petFlashError).toHaveBeenCalledTimes(1);
            expect(host.log).toHaveBeenCalled();
            expect(flow.isSaveInProgress).toBe(false);
        });
    });

    describe("saveFindingsAsReviewNote — summary layout with pending note", () => {
        it("writes the pre-generated pending note directly", async () => {
            const writeReviewNote = jest.fn<(note: GeneratedReviewNote) => Promise<WriteResult>>(
                async () => ({ success: true, filePath: ".pagelet/weekly.md" }),
            );
            const host = makeHost({ writeReviewNote });
            const callbacks = makeCallbacks();
            const flow = new ReviewNoteSaveFlow(host, callbacks);
            const pending = makePendingNote();
            flow.setPending(pending);

            await flow.saveFindingsAsReviewNote([], "summary");

            expect(writeReviewNote).toHaveBeenCalledTimes(1);
            expect(writeReviewNote).toHaveBeenCalledWith(pending);
            expect(callbacks.closePanel).toHaveBeenCalledTimes(1);
            // Pending note should be cleared after successful write
            expect(flow.pending).toBeNull();
        });

        it("does not clear pending note on write failure", async () => {
            const writeReviewNote = jest.fn<(note: GeneratedReviewNote) => Promise<WriteResult>>(
                async () => ({ success: false, error: "permission denied" }),
            );
            const host = makeHost({ writeReviewNote });
            const callbacks = makeCallbacks();
            const flow = new ReviewNoteSaveFlow(host, callbacks);
            const pending = makePendingNote();
            flow.setPending(pending);

            await flow.saveFindingsAsReviewNote([], "summary");

            expect(flow.pending).not.toBeNull();
            expect(callbacks.petFlashError).toHaveBeenCalledTimes(1);
        });
    });

    describe("saveFindingsAsReviewNote — empty findings", () => {
        it("shows notice and does not write when findings are empty (non-summary layout)", async () => {
            const writeReviewNote = jest.fn<(note: GeneratedReviewNote) => Promise<WriteResult>>();
            const host = makeHost({ writeReviewNote });
            const callbacks = makeCallbacks();
            const flow = new ReviewNoteSaveFlow(host, callbacks);

            await flow.saveFindingsAsReviewNote([], "review");

            expect(writeReviewNote).not.toHaveBeenCalled();
            expect(callbacks.petTransition).not.toHaveBeenCalled();
            expect(flow.isSaveInProgress).toBe(false);
        });
    });

    describe("double-save guard", () => {
        it("rejects a second save while the first is in progress", async () => {
            let resolveFirst!: () => void;
            const firstGate = new Promise<void>((r) => { resolveFirst = r; });
            const writeReviewNote = jest.fn<(note: GeneratedReviewNote) => Promise<WriteResult>>(
                async () => {
                    await firstGate;
                    return { success: true, filePath: ".pagelet/review.md" };
                },
            );
            const host = makeHost({ writeReviewNote });
            const callbacks = makeCallbacks();
            const flow = new ReviewNoteSaveFlow(host, callbacks);

            const findings = [makeFinding()];
            const first = flow.saveFindingsAsReviewNote(findings, "review");

            // Second call while first is in flight
            await flow.saveFindingsAsReviewNote(findings, "review");

            // Only one write should have been initiated
            expect(writeReviewNote).toHaveBeenCalledTimes(1);

            resolveFirst();
            await first;

            // Guard should be released after completion
            expect(flow.isSaveInProgress).toBe(false);
        });
    });

    describe("normalizeReviewField edge cases", () => {
        // Access the private method via prototype for testing normalization behavior
        // We test this indirectly through buildReviewResultFromFindings which is called
        // during saveFindingsAsReviewNote.

        it("uses fallback for empty string values", async () => {
            const writeReviewNote = jest.fn<(note: GeneratedReviewNote) => Promise<WriteResult>>(
                async () => ({ success: true, filePath: ".pagelet/review.md" }),
            );
            const host = makeHost({ writeReviewNote });
            const callbacks = makeCallbacks();
            const flow = new ReviewNoteSaveFlow(host, callbacks);

            // Finding with empty title and description triggers fallback
            const finding = makeFinding({
                title: "",
                description: "",
                sourceTitle: "",
                sourceFile: "",
                insightText: "",
                suggestion: undefined,
            });

            await flow.saveFindingsAsReviewNote([finding], "review");

            expect(writeReviewNote).toHaveBeenCalledTimes(1);
            const writtenNote = writeReviewNote.mock.calls[0][0];
            // The markdown should contain fallback text (not empty)
            expect(writtenNote.markdown.length).toBeGreaterThan(0);
        });

        it("uses fallback for short string values (< 8 chars)", async () => {
            const writeReviewNote = jest.fn<(note: GeneratedReviewNote) => Promise<WriteResult>>(
                async () => ({ success: true, filePath: ".pagelet/review.md" }),
            );
            const host = makeHost({ writeReviewNote });
            const callbacks = makeCallbacks();
            const flow = new ReviewNoteSaveFlow(host, callbacks);

            // Finding with very short strings that are below minLength
            const finding = makeFinding({
                title: "short",
                description: "tiny",
                suggestion: undefined,
            });

            await flow.saveFindingsAsReviewNote([finding], "review");

            expect(writeReviewNote).toHaveBeenCalledTimes(1);
            const writtenNote = writeReviewNote.mock.calls[0][0];
            expect(writtenNote.markdown.length).toBeGreaterThan(0);
        });

        it("preserves normal-length strings", async () => {
            const writeReviewNote = jest.fn<(note: GeneratedReviewNote) => Promise<WriteResult>>(
                async () => ({ success: true, filePath: ".pagelet/review.md" }),
            );
            const host = makeHost({ writeReviewNote });
            const callbacks = makeCallbacks();
            const flow = new ReviewNoteSaveFlow(host, callbacks);

            const finding = makeFinding({
                title: "A sufficiently long title for the finding",
                description: "A sufficiently long description that exceeds the minimum threshold.",
                suggestion: undefined,
            });

            await flow.saveFindingsAsReviewNote([finding], "review");

            expect(writeReviewNote).toHaveBeenCalledTimes(1);
            const writtenNote = writeReviewNote.mock.calls[0][0];
            // Normal strings should appear in the output
            expect(writtenNote.markdown).toContain("A sufficiently long title for the finding");
        });

        it("handles string with newlines by trimming", async () => {
            const writeReviewNote = jest.fn<(note: GeneratedReviewNote) => Promise<WriteResult>>(
                async () => ({ success: true, filePath: ".pagelet/review.md" }),
            );
            const host = makeHost({ writeReviewNote });
            const callbacks = makeCallbacks();
            const flow = new ReviewNoteSaveFlow(host, callbacks);

            const finding = makeFinding({
                title: "\n  A title with leading newlines and spaces  \n",
                description: "Description with\nnewlines\ninside the text body.",
                suggestion: undefined,
            });

            await flow.saveFindingsAsReviewNote([finding], "review");

            expect(writeReviewNote).toHaveBeenCalledTimes(1);
        });
    });

    describe("pending note management", () => {
        it("setPending and clearPending work correctly", () => {
            const host = makeHost();
            const callbacks = makeCallbacks();
            const flow = new ReviewNoteSaveFlow(host, callbacks);

            expect(flow.pending).toBeNull();

            const note = makePendingNote();
            flow.setPending(note);
            expect(flow.pending).toBe(note);

            flow.clearPending();
            expect(flow.pending).toBeNull();
        });

        it("setPending(null) clears the pending note", () => {
            const host = makeHost();
            const callbacks = makeCallbacks();
            const flow = new ReviewNoteSaveFlow(host, callbacks);

            flow.setPending(makePendingNote());
            expect(flow.pending).not.toBeNull();

            flow.setPending(null);
            expect(flow.pending).toBeNull();
        });
    });

    describe("layout-specific file naming", () => {
        it("generates discover layout filename", async () => {
            const writeReviewNote = jest.fn<(note: GeneratedReviewNote) => Promise<WriteResult>>(
                async () => ({ success: true, filePath: ".pagelet/disc.md" }),
            );
            const host = makeHost({ writeReviewNote });
            const callbacks = makeCallbacks();
            const flow = new ReviewNoteSaveFlow(host, callbacks);

            await flow.saveFindingsAsReviewNote([makeFinding()], "discover");

            const writtenNote = writeReviewNote.mock.calls[0][0];
            expect(writtenNote.fileName).toMatch(/^pagelet-discovery-/);
        });

        it("generates current layout filename", async () => {
            const writeReviewNote = jest.fn<(note: GeneratedReviewNote) => Promise<WriteResult>>(
                async () => ({ success: true, filePath: ".pagelet/curr.md" }),
            );
            const host = makeHost({ writeReviewNote });
            const callbacks = makeCallbacks();
            const flow = new ReviewNoteSaveFlow(host, callbacks);

            await flow.saveFindingsAsReviewNote([makeFinding()], "current");

            const writtenNote = writeReviewNote.mock.calls[0][0];
            expect(writtenNote.fileName).toMatch(/^pagelet-analysis-/);
        });

        it("generates review layout filename", async () => {
            const writeReviewNote = jest.fn<(note: GeneratedReviewNote) => Promise<WriteResult>>(
                async () => ({ success: true, filePath: ".pagelet/rev.md" }),
            );
            const host = makeHost({ writeReviewNote });
            const callbacks = makeCallbacks();
            const flow = new ReviewNoteSaveFlow(host, callbacks);

            await flow.saveFindingsAsReviewNote([makeFinding()], "review");

            const writtenNote = writeReviewNote.mock.calls[0][0];
            expect(writtenNote.fileName).toMatch(/^pagelet-review-/);
        });
    });
});

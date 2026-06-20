import { describe, expect, it, jest } from "@jest/globals";

import { TFile, type App, type Vault } from "obsidian";

import {
    APPEND_CONTENT_MAX_CHARS,
    buildAppendPreview,
    buildBoundaryMarker,
    executeAppendWrite,
    rollbackAppend,
    type AppendActionInput,
    type AppendActionResult,
} from "./append-action";

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeActiveFile(path: string): TFile {
    const FileCtor = TFile as unknown as { new(path: string): TFile };
    return new FileCtor(path);
}

type AppendTestApp = App & {
    _modifyCalls: Array<{ file: TFile; content: string }>;
};

function makeApp(options: {
    existingContent?: string;
    fileExists?: boolean;
} = {}): AppendTestApp {
    const {
        existingContent = "# Existing Note\n\nSome content here.",
        fileExists = true,
    } = options;

    const modifyCalls: Array<{ file: TFile; content: string }> = [];

    const vault = {
        read: jest.fn(async () => existingContent) as Vault["read"],
        modify: jest.fn(async (file: TFile, content: string) => {
            modifyCalls.push({ file, content });
        }) as Vault["modify"],
        getAbstractFileByPath: jest.fn((path: string) => {
            if (!fileExists) return null;
            return makeActiveFile(path);
        }) as Vault["getAbstractFileByPath"],
    };

    return {
        vault,
        _modifyCalls: modifyCalls,
    } as unknown as AppendTestApp;
}

function makeInput(overrides: Partial<AppendActionInput> = {}): AppendActionInput {
    return {
        content: "## Appended Section\n\nNew content from PA.",
        activeFile: makeActiveFile("notes/daily/2026-06-17.md"),
        ...overrides,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// buildBoundaryMarker
// ─────────────────────────────────────────────────────────────────────────────

describe("buildBoundaryMarker", () => {
    it("produces an HTML comment with ISO timestamp", () => {
        const date = new Date("2026-06-17T10:30:00.000Z");
        const marker = buildBoundaryMarker(date);
        expect(marker).toBe("<!-- pa-appended 2026-06-17T10:30:00.000Z -->");
    });

    it("uses current time when no argument supplied", () => {
        const marker = buildBoundaryMarker();
        expect(marker).toMatch(/^<!-- pa-appended \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z -->$/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildAppendPreview
// ─────────────────────────────────────────────────────────────────────────────

describe("buildAppendPreview", () => {
    it("produces correct PreviewSpec with target, content, and appendContext", () => {
        const input = makeInput();
        const existingContent = "# My Note\n\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7";
        const spec = buildAppendPreview(input, existingContent);

        expect(spec.operationType).toBe("append-to-current-note");
        expect(spec.actionFamily).toBe("append-to-current-note");
        expect(spec.capabilityId).toBe("append_to_current_note");
        expect(spec.target).toEqual({
            kind: "vault-path",
            displayPath: "notes/daily/2026-06-17.md",
            folder: "notes/daily",
            filename: "2026-06-17.md",
        });
        expect(spec.contentPreview.format).toBe("markdown");
        expect(spec.contentPreview.body).toBe(input.content);
        expect(spec.contentPreview.byteSize).toBe(
            new TextEncoder().encode(input.content).byteLength,
        );
        expect(spec.impact).toEqual({
            usesAiProvider: false,
            usesAiCredits: false,
            affectsExternalState: false,
        });
        expect(spec.riskNotes).toEqual([]);
        expect(spec.confirmCopy).toEqual({
            confirmLabel: "Append",
            cancelLabel: "Cancel",
        });
    });

    it("includes last 5 lines of existing content in appendContext", () => {
        const existingContent = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7";
        const spec = buildAppendPreview(makeInput(), existingContent);

        expect(spec.appendContext).toBeDefined();
        expect(spec.appendContext?.insertionPoint).toBe("end-of-file");
        expect(spec.appendContext?.existingTailLines).toEqual([
            "Line 3", "Line 4", "Line 5", "Line 6", "Line 7",
        ]);
    });

    it("includes all lines when fewer than 5 exist", () => {
        const existingContent = "Line 1\nLine 2";
        const spec = buildAppendPreview(makeInput(), existingContent);

        expect(spec.appendContext?.existingTailLines).toEqual(["Line 1", "Line 2"]);
    });

    it("adds risk note when content exceeds 50,000 character limit", () => {
        const longContent = "x".repeat(APPEND_CONTENT_MAX_CHARS + 1);
        const input = makeInput({ content: longContent });
        const spec = buildAppendPreview(input, "existing");

        expect(spec.riskNotes).toHaveLength(1);
        expect(spec.riskNotes[0]).toContain("50,000");
        expect(spec.riskNotes[0]).toContain("character limit");
    });

    it("handles file at vault root (no folder)", () => {
        const input = makeInput({ activeFile: makeActiveFile("root-note.md") });
        const spec = buildAppendPreview(input, "content");

        expect(spec.target.folder).toBe("");
        expect(spec.target.filename).toBe("root-note.md");
        expect(spec.target.displayPath).toBe("root-note.md");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// executeAppendWrite
// ─────────────────────────────────────────────────────────────────────────────

describe("executeAppendWrite", () => {
    it("appends content with boundary marker and \\n\\n separator", async () => {
        const app = makeApp({ existingContent: "# Note\n\nExisting." });
        const input = makeInput();
        const fixedDate = new Date("2026-06-17T12:00:00.000Z");
        const result = await executeAppendWrite(input, app, () => fixedDate);

        expect(result.targetPath).toBe("notes/daily/2026-06-17.md");
        expect(result.appendedContent).toBe(input.content);
        expect(result.originalContent).toBe("# Note\n\nExisting.");
        expect(result.boundaryMarker).toBe("<!-- pa-appended 2026-06-17T12:00:00.000Z -->");

        // Verify the actual vault.modify call
        const modifyCalls = (app as unknown as { _modifyCalls: Array<{ file: TFile; content: string }> })._modifyCalls;
        expect(modifyCalls).toHaveLength(1);
        const written = modifyCalls[0].content;
        expect(written).toBe(
            "# Note\n\nExisting.\n\n<!-- pa-appended 2026-06-17T12:00:00.000Z -->\n" + input.content,
        );
    });

    it("rejects when file no longer exists in vault", async () => {
        const app = makeApp({ fileExists: false });
        const input = makeInput();

        await expect(executeAppendWrite(input, app)).rejects.toThrow(
            "Target file no longer exists",
        );

        // Verify skipWriteRollback is set
        try {
            await executeAppendWrite(input, app);
        } catch (err) {
            expect((err as Error & { skipWriteRollback?: boolean }).skipWriteRollback).toBe(true);
        }
    });

    it("rejects when content exceeds 50,000 character limit", async () => {
        const app = makeApp();
        const longContent = "x".repeat(APPEND_CONTENT_MAX_CHARS + 1);
        const input = makeInput({ content: longContent });

        await expect(executeAppendWrite(input, app)).rejects.toThrow(
            "character limit",
        );

        // Verify vault.modify was NOT called
        expect(app._modifyCalls).toHaveLength(0);

        // Verify skipWriteRollback is set
        try {
            await executeAppendWrite(input, app);
        } catch (err) {
            expect((err as Error & { skipWriteRollback?: boolean }).skipWriteRollback).toBe(true);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// rollbackAppend
// ─────────────────────────────────────────────────────────────────────────────

describe("rollbackAppend", () => {
    it("restores original content via vault.modify", async () => {
        const app = makeApp();
        const result: AppendActionResult = {
            targetPath: "notes/daily/2026-06-17.md",
            appendedContent: "appended text",
            originalContent: "# Original\n\nOriginal content.",
            boundaryMarker: "<!-- pa-appended 2026-06-17T12:00:00.000Z -->",
        };

        await rollbackAppend(result, app);

        expect(app._modifyCalls).toHaveLength(1);
        const call = app._modifyCalls[0];
        expect(call.file.path).toBe("notes/daily/2026-06-17.md");
        expect(call.content).toBe("# Original\n\nOriginal content.");
    });

    it("silently succeeds when file no longer exists", async () => {
        const app = makeApp({ fileExists: false });
        const result: AppendActionResult = {
            targetPath: "notes/daily/2026-06-17.md",
            appendedContent: "appended text",
            originalContent: "original",
            boundaryMarker: "<!-- pa-appended 2026-06-17T12:00:00.000Z -->",
        };

        // Should not throw
        await rollbackAppend(result, app);

        // vault.modify should NOT be called
        expect(app._modifyCalls).toHaveLength(0);
    });
});

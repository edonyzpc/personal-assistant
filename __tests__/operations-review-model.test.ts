import { describe, expect, it } from "@jest/globals";

import {
    createOperationsReviewModel,
    normalizeOperationsReviewPath,
} from "../src/ai-services/operations/operations-review-model";
import type { OperationsIntent, PreparedOperation } from "../src/ai-services/operations/types";

function operation(
    id: string,
    path: string,
    expectedBefore: string | null,
    expectedAfter: string,
): PreparedOperation {
    return {
        id,
        toolCallId: `call-${id}`,
        name: "vault_process",
        input: {
            path,
            operation: "replace",
            params: { search: expectedBefore ?? "", replace: expectedAfter },
        },
        path,
        expectedBefore,
        expectedAfter,
    };
}

function intent(operations: readonly PreparedOperation[]): OperationsIntent {
    return {
        id: "intent-1",
        runId: "run-1",
        turnId: "turn-1",
        createdAt: 1,
        expiresAt: 2,
        operations,
        state: "pending",
    };
}

describe("OperationsReviewModel", () => {
    it("exposes an independent attachment impact for a compound note-image operation", () => {
        const model = createOperationsReviewModel(intent([{
            kind: "note_image_removal",
            id: "image-operation",
            toolCallId: "call-image",
            name: "remove_note_image",
            input: {
                notePath: "notes/a.md",
                imageReference: "![[assets/a.png]]",
                attachmentAction: "delete",
            },
            path: "notes/a.md",
            expectedBefore: "![[assets/a.png]]",
            expectedAfter: "",
            effects: {
                note: { path: "notes/a.md", status: "not_started" },
                attachment: {
                    path: "assets/a.png",
                    action: "delete",
                    plannedAction: "remove",
                    status: "not_started",
                },
            },
            coverage: { kind: "scoped_vault_search", complete: true },
            undoLimitation: "temporary-attachment-and-note",
        }]));

        expect(model.groups[0]).toMatchObject({
            before: "![[assets/a.png]]",
            after: "",
        });
        expect(model.attachments).toEqual([{
            id: "image-operation:attachment",
            path: "assets/a.png",
            action: "delete",
            plannedAction: "remove",
            undoLimitation: "temporary-attachment-and-note",
        }]);

        const original = model.groups[0]!.operations[0]!;
        if (original.kind !== "note_image_removal") throw new Error("Expected image removal fixture");
        const conflicts = Object.freeze(Array.from({ length: 50 }, (_value, index) => Object.freeze({
            sourcePath: `notes/shared-${index}.md`,
            syntax: "wiki-embed" as const,
            remainsInSelectedNote: index === 0,
        })));
        const blockedModel = createOperationsReviewModel(intent([{
            ...original,
            block: { reason: "shared_reference" as const, conflicts },
        }]));
        expect(blockedModel.blockers).toEqual([{
            operationId: "image-operation",
            attachmentPath: "assets/a.png",
            reason: "shared_reference",
            conflicts,
        }]);
        expect(blockedModel.blockers?.[0]?.conflicts).toHaveLength(50);
        expect(Object.isFrozen(blockedModel.blockers)).toBe(true);
        expect(blockedModel.attachments).toEqual([{
            ...model.attachments![0],
            blocked: true,
        }]);
    });

    it("groups by normalized path in first-seen order and preserves operation order", () => {
        const model = createOperationsReviewModel(intent([
            operation("a1", "notes/A.md", "A0", "A1"),
            operation("b1", "notes/B.md", "B0", "B1"),
            operation("a2", "./notes//A.md/", "A1", "A2"),
            operation("a3", "notes\\A.md", "A2", "A3"),
        ]));

        expect(model.groups.map(group => group.normalizedPath)).toEqual(["notes/A.md", "notes/B.md"]);
        expect(model.groups.map(group => group.operationIds)).toEqual([["a1", "a2", "a3"], ["b1"]]);
        expect(model.groups[0]).toMatchObject({
            before: "A0",
            after: "A3",
            beforeExists: true,
            created: false,
            operationIds: ["a1", "a2", "a3"],
        });
        expect(normalizeOperationsReviewPath("./notes//A.md/")).toBe("notes/A.md");
    });

    it("distinguishes a new empty note, an existing empty note, and net-zero changes", () => {
        const model = createOperationsReviewModel(intent([
            operation("create-empty", "notes/new.md", null, ""),
            operation("existing-empty", "notes/empty.md", "", ""),
            operation("net-zero", "notes/same.md", "same", "same"),
        ]));

        expect(model.groups.map(group => [
            group.path,
            group.beforeExists,
            group.created,
            group.netZeroTextChange,
        ])).toEqual([
            ["notes/new.md", false, true, false],
            ["notes/empty.md", true, false, true],
            ["notes/same.md", true, false, true],
        ]);
    });

    it("preserves Markdown, whitespace, line endings, multi-block changes, and line numbers", () => {
        const before = [
            "# Title",
            "",
            "first unchanged",
            "old first",
            ...Array.from({ length: 12 }, (_value, index) => `gap ${index}`),
            "middle unchanged",
            "old tail",
            "tail unchanged",
            "",
        ].join("\n");
        const after = [
            "# Title",
            "",
            "first unchanged",
            "new first",
            ...Array.from({ length: 12 }, (_value, index) => `gap ${index}`),
            "middle unchanged",
            "new tail",
            "tail unchanged",
        ].join("\n");
        const model = createOperationsReviewModel(intent([operation("edit", "notes/a.md", before, after)]));
        const group = model.groups[0]!;

        expect(group.before).toBe(before);
        expect(group.after).toBe(after);
        expect(group.diffDegraded).toBe(false);
        expect(group.blocks).toHaveLength(2);
        expect(group.lines.filter(row => row.kind === "delete").map(row => row.oldNumber)).toEqual([4, 18, 19]);
        expect(group.lines.filter(row => row.kind === "insert").map(row => row.newNumber)).toEqual([4, 18, 19]);
        expect(group.lines.map(row => row.text)).toEqual(expect.arrayContaining([
            "# Title",
            "old first",
            "new first",
            "old tail",
            "new tail",
        ]));
        expect(group.lines[group.lines.length - 1]?.newline).toBeNull();
    });

    it("uses the unchanged middle line for the minimal insertion-only Myers path", () => {
        const before = "a\n";
        const after = "x\na\ny\n";
        const model = createOperationsReviewModel(intent([operation("minimal", "notes/minimal.md", before, after)]));
        const group = model.groups[0]!;

        expect(group.diffDegraded).toBe(false);
        expect(group.lines.map(row => [row.kind, row.text])).toEqual([
            ["insert", "x"],
            ["context", "a"],
            ["insert", "y"],
        ]);
        expect(group.lines
            .filter(row => row.kind !== "insert")
            .map(row => row.text + (row.newline ?? ""))
            .join("")).toBe(before);
        expect(group.lines
            .filter(row => row.kind !== "delete")
            .map(row => row.text + (row.newline ?? ""))
            .join("")).toBe(after);
    });

    it("keeps Markdown links and pure whitespace changes inspectable", () => {
        const before = "[PA](notes/decision.md)\n \n";
        const after = "[PA](notes/decision.md)\n  \n";
        const model = createOperationsReviewModel(intent([operation("raw", "notes/raw.md", before, after)]));
        const group = model.groups[0]!;
        const context = group.lines.find(row => row.text.includes("[PA]("));
        const whitespaceRows = group.lines.filter(row => row.kind !== "context");

        expect(context?.kind).toBe("context");
        expect(context?.text).toBe("[PA](notes/decision.md)");
        expect(group.before).toBe(before);
        expect(group.after).toBe(after);
        expect(whitespaceRows.map(row => [row.kind, JSON.stringify(row.text)])).toEqual([
            ["delete", JSON.stringify(" ")],
            ["insert", JSON.stringify("  ")],
        ]);
    });

    it("highlights Chinese words and keeps surrogate pairs intact", () => {
        const before = "维护安静可信的笔记";
        const after = "维护安静可靠的记忆 😀";
        const model = createOperationsReviewModel(intent([operation("unicode", "notes/zh.md", before, after)]));
        const deleted = model.groups[0]!.lines.find(row => row.kind === "delete")!;
        const inserted = model.groups[0]!.lines.find(row => row.kind === "insert")!;

        expect(deleted.oldSegments?.flatMap(segment => Array.from(segment.text)).join("")).toBe(before);
        expect(inserted.newSegments?.flatMap(segment => Array.from(segment.text)).join("")).toBe(after);
        expect(deleted.oldSegments?.some(segment => segment.changed && segment.text.includes("信"))).toBe(true);
        expect(inserted.newSegments?.some(segment => segment.changed && segment.text.includes("😀"))).toBe(true);
        for (const segment of inserted.newSegments ?? []) {
            expect(Array.from(segment.text).some(part => part.length === 1 && part.charCodeAt(0) >= 0xD800)).toBe(false);
        }
    });

    it("keeps complete old and new snapshots for a replacement beyond the legacy preview limit", () => {
        const before = `prefix\n${"B".repeat(1_800)}\nsuffix`;
        const after = "prefix\nNEW-START reachable NEW-END\nsuffix";
        const model = createOperationsReviewModel(intent([operation("long", "notes/long.md", before, after)]));
        const group = model.groups[0]!;

        expect(group.before).toBe(before);
        expect(group.after).toBe(after);
        expect(group.lines.map(row => row.text)).toEqual(expect.arrayContaining([
            "B".repeat(1_800),
            "NEW-START reachable NEW-END",
        ]));
    });

    it("degrades a pathological diff to complete deletion and insertion without losing text", () => {
        const before = Array.from({ length: 1_500 }, (_value, index) => `before-${index}`).join("\n");
        const after = Array.from({ length: 1_500 }, (_value, index) => `after-${index}`).join("\n");
        const model = createOperationsReviewModel(intent([operation("large", "notes/large.md", before, after)]));
        const group = model.groups[0]!;

        expect(group.diffDegraded).toBe(true);
        expect(group.changeCount).toBe(3_000);
        expect(group.lines.filter(row => row.kind === "delete")).toHaveLength(1_500);
        expect(group.lines.filter(row => row.kind === "insert")).toHaveLength(1_500);
        expect(group.lines.filter(row => row.kind === "delete").map(row => row.text).join("\n")).toBe(before);
        expect(group.lines.filter(row => row.kind === "insert").map(row => row.text).join("\n")).toBe(after);
    });
});

import { describe, expect, it } from "@jest/globals";

import {
    createOperationsReviewModel,
    createOperationsRequestReviewModel,
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
    it("projects the last applied same-file state instead of the skipped final plan", () => {
        const staged = intent([
            operation("first", "notes/a.md", "before", "before\nfirst"),
            operation("second", "notes/a.md", "before\nfirst", "before\nfirst\nnot reached"),
        ]);
        const model = createOperationsReviewModel(staged, [
            { operationId: "first", toolCallId: "call-first", name: "vault_process", path: "notes/a.md", status: "succeeded" },
            { operationId: "second", toolCallId: "call-second", name: "vault_process", path: "notes/a.md", status: "skipped" },
        ]);
        expect(model.groups[0]).toMatchObject({ before: "before", after: "before\nfirst" });
        expect(model.groups[0]!.lines.some(line => line.text === "not reached")).toBe(false);
    });

    it("represents native move as a path change without a planned body rewrite", () => {
        const model = createOperationsReviewModel(intent([{
            kind: "move", id: "move", toolCallId: "call-move", name: "vault_move",
            input: { sourcePath: "notes/a.md", targetPath: "archive/a.md" },
            path: "notes/a.md", sourcePath: "notes/a.md", targetPath: "archive/a.md",
            expectedBefore: "PRIVATE BODY", expectedAfter: "PRIVATE BODY", fileIdentity: { path: "notes/a.md" },
        }]));
        expect(model.groups[0]).toMatchObject({ path: "notes/a.md", targetPath: "archive/a.md", changeCount: 0 });
    });
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

describe("OperationsRequestReviewModel", () => {
    const requestIntent = (id: string, turnId: string, operations: readonly PreparedOperation[]): OperationsIntent => ({
        id, runId: "request-run", turnId, createdAt: 1, expiresAt: 2, operations, state: "pending",
    });

    it("folds continuous cross-intent edits into one initial-to-final difference", () => {
        const model = createOperationsRequestReviewModel({
            runId: "request-run",
            intents: [
                {
                    intent: requestIntent("intent-1", "turn-1", [
                        operation("a1", "notes/a.md", "A", "B"),
                    ]),
                    results: [
                        { operationId: "a1", toolCallId: "call-a1", name: "vault_process", path: "notes/a.md", status: "succeeded", receiptId: "r1" },
                    ],
                },
                {
                    intent: requestIntent("intent-2", "turn-2", [
                        operation("a2", "notes/a.md", "B", "C"),
                    ]),
                    results: [
                        { operationId: "a2", toolCallId: "call-a2", name: "vault_process", path: "notes/a.md", status: "succeeded", receiptId: "r2" },
                    ],
                },
            ],
        });
        expect(model.groups).toHaveLength(1);
        expect(model.groups[0]).toMatchObject({ before: "A", after: "C" });
        expect(model.groups[0]!.lines.some(line => line.text === "B")).toBe(false);
    });

    it("keeps a breakpoint segment instead of attributing an external edit to the Agent", () => {
        const model = createOperationsRequestReviewModel({
            runId: "request-run",
            intents: [
                {
                    intent: requestIntent("intent-1", "turn-1", [
                        operation("a1", "notes/a.md", "A", "B"),
                    ]),
                    results: [
                        { operationId: "a1", toolCallId: "call-a1", name: "vault_process", path: "notes/a.md", status: "succeeded", receiptId: "r1" },
                    ],
                },
                {
                    intent: requestIntent("intent-2", "turn-2", [
                        operation("a2", "notes/a.md", "B'", "C"),
                    ]),
                    results: [
                        { operationId: "a2", toolCallId: "call-a2", name: "vault_process", path: "notes/a.md", status: "succeeded", receiptId: "r2" },
                    ],
                },
            ],
        });
        expect(model.groups.map(group => [group.before, group.after])).toEqual([
            ["A", "B"],
            ["B'", "C"],
        ]);
        expect(model.groups[1]).toMatchObject({ hasSnapshotBreakpoint: true });
    });

    it.each(["saved", "editor"] as const)(
        "anchors %s request segment identities to their starting operation",
        representation => {
            const binding = { snapshotId: "snapshot", viewId: "view", file: { path: "notes/a.md" }, editor: {} };
            const makeOperation = (id: string, before: string, after: string): PreparedOperation => {
                if (representation === "saved") return operation(id, "notes/a.md", before, after);
                return {
                    kind: "resource",
                    id,
                    toolCallId: `call-${id}`,
                    name: "obsidian.workspace.applyEdits",
                    input: { snapshotId: binding.snapshotId, edits: [{ from: 0, to: before.length, text: after }] },
                    path: "notes/a.md",
                    expectedBefore: before,
                    expectedAfter: after,
                    resource: { action: "editor", binding },
                } as unknown as PreparedOperation;
            };
            const project = (operations: readonly PreparedOperation[], undoneReceiptIds?: string[]) => createOperationsRequestReviewModel({
                runId: "request-run",
                intents: [{
                    intent: requestIntent("intent-identity", "turn-identity", operations),
                    results: operations.map(current => ({
                        operationId: current.id,
                        toolCallId: current.toolCallId,
                        name: current.name,
                        path: current.path,
                        status: "succeeded" as const,
                        receiptId: `receipt-${current.id}`,
                    })),
                }],
                ...(undoneReceiptIds ? { undoneReceiptIds } : {}),
            });
            const initial = project([makeOperation("operation-first", "A", "B")]).groups[0]!;
            const continuous = project([
                makeOperation("operation-first", "A", "B"),
                makeOperation("operation-second", "B", "C"),
            ]);
            expect(continuous.groups).toHaveLength(1);
            expect(continuous.groups[0]!.id).toBe(initial.id);
            expect(continuous.groups[0]!.lines.map(line => line.id)).toEqual(initial.lines.map(line => line.id));

            const segmented = project([
                makeOperation("operation-first", "A", "B"),
                makeOperation("operation-second", "X", "C"),
            ]);
            expect(segmented.groups).toHaveLength(2);
            expect(segmented.groups[0]!.id).toBe(initial.id);
            expect(segmented.groups[1]!.id).not.toBe(initial.id);
            const initialLineIds = new Set(initial.lines.map(line => line.id));
            expect(segmented.groups[1]!.lines.every(line => !initialLineIds.has(line.id))).toBe(true);

            const surviving = project([
                makeOperation("operation-first", "A", "B"),
                makeOperation("operation-second", "X", "C"),
            ], ["receipt-operation-first"]);
            expect(surviving.groups.map(group => group.id)).toEqual([segmented.groups[1]!.id]);
            expect(surviving.groups[0]!.lines.map(line => line.id))
                .toEqual(segmented.groups[1]!.lines.map(line => line.id));
        },
    );

    it("does not count an already undone receipt as the request's current change", () => {
        const model = createOperationsRequestReviewModel({
            runId: "request-run",
            intents: [
                {
                    intent: requestIntent("intent-1", "turn-1", [
                        operation("a1", "notes/a.md", "A", "B"),
                        operation("b1", "notes/b.md", "B0", "B1"),
                    ]),
                    results: [
                        { operationId: "a1", toolCallId: "call-a1", name: "vault_process", path: "notes/a.md", status: "succeeded", receiptId: "r1" },
                        { operationId: "b1", toolCallId: "call-b1", name: "vault_process", path: "notes/b.md", status: "succeeded", receiptId: "r2" },
                    ],
                },
            ],
            undoneReceiptIds: ["r1"],
        });
        expect(model.groups).toHaveLength(1);
        expect(model.groups[0]).toMatchObject({ path: "notes/b.md", before: "B0", after: "B1" });
    });

    it("keeps resource and move effects as their own factual groups", () => {
        const model = createOperationsRequestReviewModel({
            runId: "request-run",
            intents: [
                {
                    intent: requestIntent("intent-1", "turn-1", [{
                        kind: "move", id: "move", toolCallId: "call-move", name: "vault_move",
                        input: { sourcePath: "notes/a.md", targetPath: "archive/a.md" },
                        path: "notes/a.md", sourcePath: "notes/a.md", targetPath: "archive/a.md",
                        expectedBefore: "PRIVATE BODY", expectedAfter: "PRIVATE BODY", fileIdentity: { path: "notes/a.md" },
                    }]),
                    results: [
                        { operationId: "move", toolCallId: "call-move", name: "vault_move", path: "notes/a.md", status: "succeeded", receiptId: "r-move", targetPath: "archive/a.md" },
                    ],
                },
            ],
        });
        expect(model.groups).toHaveLength(1);
        expect(model.groups[0]).toMatchObject({ path: "notes/a.md", targetPath: "archive/a.md", changeCount: 0 });
    });

    it("separates editor representation, folds saved text, and keeps partial resource paths", () => {
        const savedReplace = (id: string, before: string, after: string): PreparedOperation =>
            operation(id, "notes/a.md", before, after);
        const editorOperation: PreparedOperation = {
            kind: "resource",
            id: "editor-op",
            toolCallId: "call-editor",
            name: "obsidian.workspace.applyEdits",
            input: { action: "editor", context: { kind: "current_note" }, target: { path: "notes/a.md" } },
            path: "notes/a.md",
            expectedBefore: "B",
            expectedAfter: "B editor",
            resource: { action: "editor", binding: {} },
        } as unknown as PreparedOperation;
        const model = createOperationsRequestReviewModel({
            runId: "request-run",
            intents: [
                {
                    intent: requestIntent("intent-1", "turn-1", [savedReplace("s1", "A", "B")]),
                    results: [{
                        operationId: "s1", toolCallId: "call-s1", name: "vault_process",
                        path: "notes/a.md", status: "succeeded", receiptId: "r-s1",
                    }],
                },
                {
                    intent: requestIntent("intent-2", "turn-2", [editorOperation]),
                    results: [{
                        operationId: "editor-op", toolCallId: "call-editor",
                        name: "obsidian.workspace.applyEdits", path: "notes/a.md", status: "succeeded",
                        resourceEffect: { kind: "editor", scope: "editor-buffer", saved: "unknown" },
                    }],
                },
                {
                    intent: requestIntent("intent-3", "turn-3", [
                        savedReplace("s2", "B", "C"),
                        {
                            kind: "resource",
                            id: "mkdir-op",
                            toolCallId: "call-mkdir",
            name: "obsidian.vault.mkdir",
                            input: { action: "mkdir", paths: ["assets/x", "assets/y"] },
                            path: "assets/x",
                            expectedBefore: null,
                            expectedAfter: "",
                            resource: { action: "mkdir", folders: [], removed: new Set() },
                        } as unknown as PreparedOperation,
                    ]),
                    results: [
                        {
                            operationId: "s2", toolCallId: "call-s2", name: "vault_process",
                            path: "notes/a.md", status: "succeeded", receiptId: "r-s2",
                        },
                        {
                            operationId: "mkdir-op", toolCallId: "call-mkdir",
                            name: "obsidian.vault.mkdir", path: "assets/x", status: "partial",
                            resourceEffect: { kind: "mkdir", paths: ["assets/x"] },
                        },
                    ],
                },
            ],
        });
        const saved = model.groups.find(group => group.path === "notes/a.md" && !group.resourceKind);
        expect(saved).toMatchObject({ before: "A", after: "C" });
        const editor = model.groups.find(group => group.resourceKind === "editor");
        expect(editor).toMatchObject({
            path: "notes/a.md",
            before: "B",
            after: "B editor",
            resourceKind: "editor",
        });
        expect(editor!.id).not.toBe(saved!.id);
        expect(model.groups.find(group => group.resourceKind === "mkdir"))
            .toMatchObject({ resourcePaths: ["assets/x"] });
    });

    it("connects an explicit move chain to the final path without inventing text edits", () => {
        const identity = { path: "notes/a.md" };
        const move = (id: string, from: string, to: string): PreparedOperation => ({
            kind: "move", id, toolCallId: `call-${id}`, name: "vault_move",
            input: { sourcePath: from, targetPath: to },
            path: from, sourcePath: from, targetPath: to,
            expectedBefore: "BODY", expectedAfter: "BODY", fileIdentity: identity,
        });
        const model = createOperationsRequestReviewModel({
            runId: "request-run",
            intents: [
                {
                    intent: requestIntent("intent-1", "turn-1", [move("m1", "notes/a.md", "notes/b.md")]),
                    results: [{
                        operationId: "m1", toolCallId: "call-m1", name: "vault_move",
                        path: "notes/a.md", targetPath: "notes/b.md", status: "succeeded", receiptId: "r-m1",
                    }],
                },
                {
                    intent: requestIntent("intent-2", "turn-2", [move("m2", "notes/b.md", "archive/b.md")]),
                    results: [{
                        operationId: "m2", toolCallId: "call-m2", name: "vault_move",
                        path: "notes/b.md", targetPath: "archive/b.md", status: "succeeded", receiptId: "r-m2",
                    }],
                },
            ],
        });
        const moveGroups = model.groups.filter(group => group.targetPath);
        expect(moveGroups).toHaveLength(1);
        expect(moveGroups[0]).toMatchObject({ path: "notes/a.md", targetPath: "archive/b.md", changeCount: 0 });
    });

    it("breaks a move chain when the same path now names a rebuilt object", () => {
        const firstIdentity = { path: "notes/a.md" };
        const rebuiltIdentity = { path: "notes/b.md" };
        const move = (id: string, from: string, to: string, identity: { path: string }): PreparedOperation => ({
            kind: "move", id, toolCallId: `call-${id}`, name: "vault_move",
            input: { sourcePath: from, targetPath: to },
            path: from, sourcePath: from, targetPath: to,
            expectedBefore: "BODY", expectedAfter: "BODY", fileIdentity: identity,
        });
        const model = createOperationsRequestReviewModel({
            runId: "request-run",
            intents: [
                {
                    intent: requestIntent("intent-1", "turn-1", [move("m1", "notes/a.md", "notes/b.md", firstIdentity)]),
                    results: [{
                        operationId: "m1", toolCallId: "call-m1", name: "vault_move",
                        path: "notes/a.md", targetPath: "notes/b.md", status: "succeeded", receiptId: "r-m1",
                    }],
                },
                {
                    intent: requestIntent("intent-2", "turn-2", [move("m2", "notes/b.md", "archive/b.md", rebuiltIdentity)]),
                    results: [{
                        operationId: "m2", toolCallId: "call-m2", name: "vault_move",
                        path: "notes/b.md", targetPath: "archive/b.md", status: "succeeded", receiptId: "r-m2",
                    }],
                },
            ],
        });
        const moveGroups = model.groups.filter(group => group.targetPath);
        expect(moveGroups).toHaveLength(2);
        expect(moveGroups.map(group => [group.path, group.targetPath])).toEqual([
            ["notes/a.md", "notes/b.md"],
            ["notes/b.md", "archive/b.md"],
        ]);
    });

    it("shows attachment actions from actual effects and keeps preview in its own partition", () => {
        const imageOperation = (id: string): PreparedOperation => ({
            kind: "note_image_removal",
            id,
            toolCallId: `call-${id}`,
            name: "remove_note_image",
            input: { notePath: "notes/a.md", imageReference: "![[assets/a.png]]", attachmentAction: "delete" },
            path: "notes/a.md",
            expectedBefore: "![[assets/a.png]]",
            expectedAfter: "",
            effects: {
                note: { path: "notes/a.md", status: "not_started" },
                attachment: { path: "assets/a.png", action: "delete", plannedAction: "remove", status: "not_started" },
            },
            undoLimitation: "temporary-attachment-and-note",
            coverage: { complete: true },
        } as unknown as PreparedOperation);
        const previewIntent: OperationsIntent = {
            ...requestIntent("preview-intent", "turn-p", [operation("p1", "notes/a.md", "A", "Z")]),
            mode: "preview",
        };
        const model = createOperationsRequestReviewModel({
            runId: "request-run",
            intents: [
                {
                    intent: requestIntent("intent-1", "turn-1", [
                        imageOperation("image-failed"),
                        operation("a1", "notes/a.md", "A", "B"),
                    ]),
                    results: [
                        {
                            operationId: "image-failed", toolCallId: "call-image-failed",
                            name: "remove_note_image", path: "notes/a.md", status: "failed",
                            effects: [
                                { key: "note", status: "not_started" },
                                { key: "attachment", status: "not_started" },
                            ],
                        },
                        {
                            operationId: "a1", toolCallId: "call-a1", name: "vault_process",
                            path: "notes/a.md", status: "succeeded", receiptId: "r-a1",
                        },
                    ],
                },
                { intent: previewIntent },
                { intent: requestIntent("intent-3", "turn-3", [operation("a2", "notes/a.md", "B", "C")]) },
            ],
        });
        expect(model.attachments).toHaveLength(1);
        expect(model.attachments![0]).toMatchObject({ action: "keep", plannedAction: "remove" });
        const actual = model.groups.find(group => group.path === "notes/a.md" && !group.resourceKind);
        // The third apply intent has no owner result yet: zero actual diff.
        expect(actual).toMatchObject({ before: "A", after: "B" });
        expect(model.previewGroups).toHaveLength(1);
        expect(model.previewGroups![0]).toMatchObject({ before: "A", after: "Z" });
        expect(model.groups.filter(group => group.normalizedPath === "notes/a.md")).toHaveLength(1);
    });

    it("folds continuous edits from one editor binding and separates snapshot breaks", () => {
        // Real captures create a fresh binding per snapshot; the stable facts
        // are the same live file/editor/view identity, not snapshotId.
        const file = { path: "notes/a.md" };
        const editor = { id: "editor" };
        const firstBinding = { snapshotId: "snapshot-1", viewId: "view", file, editor };
        const secondBinding = { snapshotId: "snapshot-2", viewId: "view", file, editor };
        const otherEditor = { id: "other-editor" };
        const otherBinding = { snapshotId: "snapshot-3", viewId: "view", file, editor: otherEditor };
        const editorOperation = (id: string, before: string, after: string, editorBinding: unknown): PreparedOperation => ({
            kind: "resource",
            id,
            toolCallId: `call-${id}`,
            name: "obsidian.workspace.applyEdits",
            input: { snapshotId: "snapshot", edits: [{ from: 0, to: before.length, text: after }] },
            path: "notes/a.md",
            expectedBefore: before,
            expectedAfter: after,
            resource: { action: "editor", binding: editorBinding },
        } as unknown as PreparedOperation);
        const model = createOperationsRequestReviewModel({
            runId: "request-run",
            intents: [
                {
                    intent: requestIntent("intent-1", "turn-1", [
                        editorOperation("e1", "A", "B", firstBinding),
                        editorOperation("e2", "B", "C", secondBinding),
                        editorOperation("e3", "B'", "D", otherBinding),
                    ]),
                    results: ["e1", "e2", "e3"].map(id => ({
                        operationId: id, toolCallId: `call-${id}`, name: "obsidian.workspace.applyEdits",
                        path: "notes/a.md", status: "succeeded",
                        resourceEffect: { kind: "editor", scope: "editor-buffer", saved: "unknown" },
                    })),
                },
            ],
        });
        const editorGroups = model.groups.filter(group => group.resourceKind === "editor");
        expect(editorGroups.map(group => [group.before, group.after])).toEqual([
            ["A", "C"],
            ["B'", "D"],
        ]);
        expect(editorGroups[1]).toMatchObject({ hasSnapshotBreakpoint: true });
    });

    it("keeps an unknown attachment outcome unknown and hides resultless apply plans", () => {
        const imageOperation = (id: string): PreparedOperation => ({
            kind: "note_image_removal",
            id,
            toolCallId: `call-${id}`,
            name: "remove_note_image",
            input: { notePath: "notes/a.md", imageReference: "![[assets/a.png]]", attachmentAction: "delete" },
            path: "notes/a.md",
            expectedBefore: "![[assets/a.png]]",
            expectedAfter: "",
            effects: {
                note: { path: "notes/a.md", status: "not_started" },
                attachment: { path: "assets/a.png", action: "delete", plannedAction: "remove", status: "not_started" },
            },
            coverage: { kind: "scoped_vault_search", complete: true },
            undoLimitation: "temporary-attachment-and-note",
        } as unknown as PreparedOperation);
        const model = createOperationsRequestReviewModel({
            runId: "request-run",
            intents: [
                {
                    intent: requestIntent("intent-1", "turn-1", [imageOperation("image-unknown")]),
                    results: [{
                        operationId: "image-unknown", toolCallId: "call-image-unknown",
                        name: "remove_note_image", path: "notes/a.md", status: "unknown",
                        effects: [
                            { key: "note", status: "applied" },
                            { key: "attachment", status: "unknown" },
                        ],
                    }],
                },
                { intent: requestIntent("intent-2", "turn-2", [imageOperation("image-pending")]) },
            ],
        });
        expect(model.attachments).toHaveLength(1);
        expect(model.attachments![0]).toMatchObject({ path: "assets/a.png", outcome: "unknown", action: "keep" });
        const preview = createOperationsRequestReviewModel({
            runId: "request-run",
            intents: [{ intent: { ...requestIntent("preview-intent", "turn-p", [imageOperation("image-preview")]), mode: "preview" } }],
        });
        expect(preview.attachments).toHaveLength(0);
        expect(preview.previewAttachments).toHaveLength(1);
        expect(preview.previewAttachments![0]).toMatchObject({ plannedAction: "remove" });
        expect(preview.previewAttachments![0].outcome).toBeUndefined();
    });
});

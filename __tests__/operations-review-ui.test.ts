import { describe, expect, it } from "@jest/globals";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
    getOperationsCompactVisibility,
    getOperationsEolChangeLabel,
    OperationsDiff,
} from "../src/chat/operations-review/OperationsDiff";
import {
    OperationsReviewPanel,
    projectOperationsReviewResultRows,
} from "../src/chat/operations-review/OperationsReviewPanel";
import type { OperationsReviewSnapshot } from "../src/ai-services/operations/operations-review-session";
import type { OperationExecutionResult, OperationsIntent, UndoResult } from "../src/ai-services/operations/types";
import {
    createOperationsReviewModel,
    type OperationsReviewDiffLine,
    type OperationsReviewFileGroup,
    type OperationsReviewModel,
} from "../src/ai-services/operations/operations-review-model";

function row(id: string, kind: OperationsReviewDiffLine["kind"], text: string): OperationsReviewDiffLine {
    const lineNumber = Number(id.split("-")[1]);
    return {
        id,
        kind,
        text,
        newline: "\n",
        oldNumber: kind === "insert" || !Number.isFinite(lineNumber) ? undefined : lineNumber,
        newNumber: kind === "delete" || !Number.isFinite(lineNumber) ? undefined : lineNumber,
    };
}

function group(id: string, changeCount: number, firstBlockChanges = changeCount): OperationsReviewFileGroup {
    const changedLines = Array.from({ length: changeCount }, (_value, index) => row(
        `${id}-${index + 1}`,
        index % 2 === 0 ? "delete" : "insert",
        `${id}-${index + 1}`,
    ));
    const hasLaterBlock = firstBlockChanges > 0 && firstBlockChanges < changeCount;
    const lines = hasLaterBlock
        ? [
            ...changedLines.slice(0, firstBlockChanges),
            ...Array.from({ length: 8 }, (_value, index) => row(`${id}-gap-${index}`, "context", `unchanged ${index}`)),
            ...changedLines.slice(firstBlockChanges),
        ]
        : changedLines;
    const before = lines.filter(line => line.kind !== "insert").map(line => `${line.text}\n`).join("");
    const after = lines.filter(line => line.kind !== "delete").map(line => `${line.text}\n`).join("");
    const path = `notes/${id}.md`;
    return createOperationsReviewModel({
        id: `intent-${id}`,
        runId: "run",
        turnId: "turn",
        createdAt: 1,
        expiresAt: 2,
        state: "pending",
        operations: [{
            id,
            toolCallId: `call-${id}`,
            name: "vault_process",
            input: { path, operation: "replace", params: { search: before, replace: after } },
            path,
            expectedBefore: before,
            expectedAfter: after,
        }],
    }).groups[0]!;
}

describe("OperationsDiff presentation calculations", () => {
    it("renders every changed block of a request diff without per-block navigation", () => {
        const model: OperationsReviewModel = { intentId: "request", groups: [group("request", 8, 2)] };
        const html = renderToStaticMarkup(createElement(OperationsDiff, { model, mode: "request" }));
        expect(html.match(/request-</g)).toHaveLength(8);
        expect(html.match(/<mark class="pa-operations-diff__highlight">[1-8]<\/mark>/g)).toHaveLength(8);
        expect(html).toContain("position gap");
        expect(html).toContain("pa-operations-diff__block-gap");
        // Every input row ends with a newline; the synthetic presentation gap
        // must not claim a real missing final newline.
        expect(html).not.toContain("No newline at end");
        expect(html).not.toContain("\\n?");
        expect(html).not.toContain("Show block");
    });

    it("keeps the missing-final-newline marker for a genuine note line", () => {
        const model = createOperationsReviewModel({
            id: "no-newline-intent", runId: "run", turnId: "turn", createdAt: 1, expiresAt: 2,
            state: "pending",
            operations: [{
                id: "op", toolCallId: "call", name: "vault_process",
                input: { path: "notes/no-newline.md", operation: "replace",
                    params: { search: "before", replace: "after" } },
                path: "notes/no-newline.md", expectedBefore: "before", expectedAfter: "after",
            }],
        });
        const html = renderToStaticMarkup(createElement(OperationsDiff, { model, mode: "request" }));
        expect(html).toContain("No newline at end");
        expect(html).toContain("\\n?");
    });

    it.each(["preview", "unavailable", "available"] as const)("uses the actual mkdir result for the %s Undo explanation", state => {
        const intent: OperationsIntent = { id: "mkdir-intent", runId: "run", turnId: "turn", createdAt: 1, expiresAt: 2,
            state: "pending", mode: state === "preview" ? "preview" : "apply", operations: [{ kind: "resource", id: "mkdir-op",
                toolCallId: "mkdir-call", name: "obsidian.vault.mkdir", input: { path: "assets/new", mode: state === "preview" ? "preview" : "apply" }, path: "assets/new",
                expectedBefore: null, expectedAfter: "", resource: { action: "mkdir", paths: ["assets/new"], parents: [] } }] };
        const results: OperationExecutionResult[] = state === "preview" ? [] : [{ operationId: "mkdir-op", toolCallId: "mkdir-call",
            name: "obsidian.vault.mkdir", path: "assets/new", status: "succeeded", undoAvailable: state === "available",
            ...(state === "available" ? { receiptId: "mkdir-receipt" }
                : { message: "Folders were created. Safe Undo for these folders is unavailable." }),
            resourceEffect: { kind: "mkdir", paths: ["assets/new"] } }];
        const model = createOperationsReviewModel(intent, state === "preview" ? undefined : results);
        const snapshot: OperationsReviewSnapshot = { reviewId: "mkdir-review", intentId: intent.id,
            status: state === "preview" ? "preview" : "completed", actionInFlight: null, model, execution: null,
            operationResults: results, undoResults: [], error: null };
        const session = { getSnapshot: () => snapshot, subscribe: () => () => {}, canUndo: () => state === "available" };
        const html = renderToStaticMarkup(createElement(OperationsReviewPanel, { session: session as never }));
        expect(html).toContain("assets/new");
        if (state === "available") {
            expect(html).toContain("Undo removes only folders created by this call");
            expect(html).toContain(">Undo</button>");
        } else {
            expect(html).not.toContain("Undo removes only folders created by this call");
            expect(html).not.toContain(">Undo</button>");
        }
        if (state === "unavailable") expect(html).toContain("Safe Undo for these folders is unavailable.");
    });
    it("renders a native path move without displaying the note as a content edit", () => {
        const model: OperationsReviewModel = { intentId: "move", groups: [{ ...group("move", 2), targetPath: "archive/move.md" }] };
        const html = renderToStaticMarkup(createElement(OperationsDiff, { model, mode: "full" }));
        expect(html).toContain("notes/move.md");
        expect(html).toContain("archive/move.md");
        expect(html).toContain("Move note");
        expect(html).not.toContain("pa-operations-diff__rows");
        expect(html).not.toContain("Show complete before");
        const snapshot: OperationsReviewSnapshot = {
            reviewId: "same-path", intentId: "move", status: "completed", actionInFlight: null, model,
            execution: null, operationResults: [{ operationId: "move", toolCallId: "move-call", name: "vault_move",
                path: "notes/move.md", targetPath: "notes/move.md", status: "unchanged", undoAvailable: false }],
            undoResults: [], error: null,
        };
        const session = { getSnapshot: () => snapshot, subscribe: () => () => {}, canUndo: () => false };
        const unchanged = renderToStaticMarkup(createElement(OperationsReviewPanel, { session: session as never }));
        expect(unchanged).toContain("No changes were needed.");
        expect(unchanged).not.toContain("Changes applied.");
        expect(unchanged).not.toContain(">Undo</button>");
    });
    it.each(["compact", "full"] as const)("keeps all shared-reference conflicts visible in %s review regardless of diff budgets or file pagination", (mode) => {
        const conflicts = Array.from({ length: 35 }, (_value, index) => ({
            sourcePath: `notes/shared-${index}.md`,
            syntax: "wiki-embed" as const,
            remainsInSelectedNote: index === 34,
        }));
        const model: OperationsReviewModel = {
            intentId: "blocked-intent",
            groups: [group("first", 30), group("second", 30), group("third", 30)],
            blockers: [{ operationId: "blocked-image", attachmentPath: "assets/a.png", reason: "shared_reference", conflicts }],
        };
        const html = renderToStaticMarkup(createElement(OperationsDiff, { model, mode, activeGroupIndex: 2 }));

        expect(html).toContain('data-blocked="shared_reference"');
        expect(html).toContain("The note and attachment have not been changed.");
        expect(html).toContain("explicitly choose to keep the attachment and propose a new operation.");
        for (const conflict of conflicts) expect(html).toContain(`<code>${conflict.sourcePath}</code>`);
        expect(html).toContain("Another reference remains in the selected note");
        if (mode === "compact") {
            expect(html.indexOf('data-blocked="shared_reference"')).toBeLessThan(html.indexOf("pa-operations-diff__omitted"));
        } else {
            expect(html).not.toContain('aria-label="notes/first.md"');
            expect(html).toContain('aria-label="notes/third.md"');
        }
    });

    it("keeps blocked preview reviewable without Confirm or pending Cancel", () => {
        const snapshot: OperationsReviewSnapshot = {
            reviewId: "blocked-review",
            intentId: "blocked-intent",
            status: "preview",
            actionInFlight: null,
            model: {
                intentId: "blocked-intent",
                groups: [group("first", 2)],
                blockers: [{
                    operationId: "blocked-image",
                    attachmentPath: "assets/a.png",
                    reason: "shared_reference",
                    conflicts: [{ sourcePath: "notes/shared.md", syntax: "wiki-embed", remainsInSelectedNote: false }],
                }],
                attachments: [{ id: "blocked-image:attachment", path: "assets/a.png", action: "delete", plannedAction: "remove", undoLimitation: "temporary-attachment-and-note", blocked: true }],
            },
            execution: null,
            operationResults: [],
            undoResults: [],
            error: null,
        };
        const session = {
            getSnapshot: () => snapshot,
            subscribe: () => () => undefined,
            canUndo: () => false,
        };
        const html = renderToStaticMarkup(createElement(OperationsReviewPanel, { session: session as never }));

        expect(html).not.toContain("Confirm changes");
        expect(html).not.toContain(">Cancel</button>");
        expect(html).toContain("Preview only. Changes have not been applied.");
        expect(html).toContain("notes/shared.md");
        expect(html).toContain("Attachment deletion is blocked.");
        expect(html).not.toContain("The local image file will be deleted");
    });

    it("projects compound effects and an attachment-restored checkpoint without treating a receipt as Undo", () => {
        const operationResult: OperationExecutionResult = {
            operationId: "operation",
            toolCallId: "call",
            name: "remove_note_image",
            path: "notes/a.md",
            status: "partial",
            receiptId: "receipt",
            effects: [
                { key: "note", status: "applied" },
                { key: "attachment", status: "restored" },
            ],
            undoAvailable: true,
            checkpoint: "attachment-restored",
        };
        const undoResult: UndoResult = {
            receiptId: "receipt",
            operationId: "operation",
            path: "notes/a.md",
            status: "stale",
            checkpoint: "attachment-restored",
            effects: [
                { key: "note", status: "applied" },
                { key: "attachment", status: "restored" },
            ],
            undoAvailable: true,
        };
        const snapshot: OperationsReviewSnapshot = {
            reviewId: "opr-review",
            intentId: "intent",
            status: "partial",
            actionInFlight: null,
            model: null,
            execution: null,
            operationResults: [operationResult],
            undoResults: [undoResult],
            error: null,
        };

        expect(projectOperationsReviewResultRows(snapshot)).toEqual([expect.objectContaining({
            status: "stale",
            operationResult,
            undoResult,
        })]);
        expect(projectOperationsReviewResultRows(snapshot)[0]?.message).toContain("restored");
        expect(projectOperationsReviewResultRows(snapshot)[0]?.message).toContain("Note: Applied");
        expect(projectOperationsReviewResultRows(snapshot)[0]?.message).toContain("Image file: Undone");
        const fullyUndoneSnapshot = {
            ...snapshot,
            undoResults: [{ ...undoResult, status: "undone" as const }],
        };
        const fullyUndoneMessage = projectOperationsReviewResultRows(fullyUndoneSnapshot)[0]?.message ?? "";
        expect(fullyUndoneMessage).toContain("Image file: Undone");
        expect(fullyUndoneMessage).not.toContain("Could not undo safely");
    });

    it("preserves known note effects alongside an unknown attachment outcome and its error in full review", () => {
        const snapshot: OperationsReviewSnapshot = {
            reviewId: "unknown-review",
            intentId: "unknown-intent",
            status: "partial",
            actionInFlight: null,
            model: {
                intentId: "unknown-intent",
                groups: [group("unknown", 2)],
                attachments: [{
                    id: "unknown-image:attachment",
                    path: "assets/image-inline.png",
                    action: "keep",
                    plannedAction: "remove",
                    undoLimitation: "temporary-attachment-and-note",
                    outcome: "unknown",
                }],
            },
            execution: null,
            operationResults: [{
                operationId: "unknown-image",
                toolCallId: "unknown-call",
                name: "remove_note_image",
                path: "notes/a.md",
                status: "unknown",
                message: "Attachment deletion outcome could not be verified.",
                effects: [{ key: "note", status: "applied" }, { key: "attachment", status: "unknown" }],
                undoAvailable: true,
            }],
            undoResults: [],
            error: null,
        };

        expect(projectOperationsReviewResultRows(snapshot)[0]?.message).toBe(
            "Note: Applied; Image file: Outcome unknown; Attachment deletion outcome could not be verified.",
        );
        const session = { getSnapshot: () => snapshot, subscribe: () => () => undefined, canUndo: () => false };
        const html = renderToStaticMarkup(createElement(OperationsReviewPanel, { session: session as never }));
        expect(html).toContain("Note: Applied; Image file: Outcome unknown; Attachment deletion outcome could not be verified.");
        expect(html).toContain("assets/image-inline.png");
        expect(html).toContain("Outcome unknown");
        expect(html).not.toContain("The local image file will stay in your vault");
        snapshot.operationResults = [{ ...snapshot.operationResults[0]!, effects: [{ key: "note", status: "not_started" }, { key: "attachment", status: "not_started" }] }];
        expect(projectOperationsReviewResultRows(snapshot)[0]?.message).toContain("Note: Not started; Image file: Not started");
    });

    it.each(["expired", "failed"] as const)("keeps current compound effects visible after a receipt-only %s Undo result", status => {
        const snapshot: OperationsReviewSnapshot = {
            reviewId: "receipt-only-review",
            intentId: "receipt-only-intent",
            status: "partial",
            actionInFlight: null,
            model: { intentId: "receipt-only-intent", groups: [group("receipt-only", 2)] },
            execution: null,
            operationResults: [{
                operationId: "receipt-only-image",
                toolCallId: "receipt-only-call",
                name: "remove_note_image",
                path: "notes/a.md",
                status: "unknown",
                receiptId: "receipt-only",
                effects: [{ key: "note", status: "applied" }, { key: "attachment", status: "unknown" }],
                undoAvailable: false,
            }],
            undoResults: [{
                receiptId: "receipt-only",
                operationId: "receipt-only-image",
                path: "notes/a.md",
                status,
                message: "Recovery is no longer available.",
                undoAvailable: false,
            }],
            error: null,
        };
        expect(projectOperationsReviewResultRows(snapshot)[0]?.message).toBe(
            "Note: Applied; Image file: Outcome unknown; Could not undo safely",
        );
        const session = { getSnapshot: () => snapshot, subscribe: () => () => undefined, canUndo: () => false };
        const html = renderToStaticMarkup(createElement(OperationsReviewPanel, { session: session as never }));
        expect(html).toContain("Note: Applied; Image file: Outcome unknown; Could not undo safely");
    });

    it("hides an already undone row while leaving another valid row Undo-able", () => {
        const model: OperationsReviewModel = { intentId: "intent", groups: [group("undo-rows", 2)] };
        const snapshot: OperationsReviewSnapshot = {
            reviewId: "opr-undo-rows",
            intentId: "intent",
            status: "partial",
            actionInFlight: null,
            model,
            execution: null,
            operationResults: [
                {
                    operationId: "undone-operation",
                    toolCallId: "call-undone",
                    name: "vault_append",
                    path: "notes/undo-rows.md",
                    status: "succeeded",
                    receiptId: "receipt-undone",
                    undoAvailable: false,
                },
                {
                    operationId: "active-operation",
                    toolCallId: "call-active",
                    name: "vault_append",
                    path: "notes/undo-rows.md",
                    status: "succeeded",
                    receiptId: "receipt-active",
                    undoAvailable: true,
                },
            ],
            undoResults: [{
                receiptId: "receipt-undone",
                operationId: "undone-operation",
                path: "notes/undo-rows.md",
                status: "undone",
            }],
            error: null,
        };
        const session = {
            getSnapshot: () => snapshot,
            subscribe: () => () => undefined,
            canUndo: () => true,
        };
        const html = renderToStaticMarkup(createElement(OperationsReviewPanel, { session: session as never }));
        expect(html).toContain('data-status="undone"');
        expect(html.match(/<button[^>]*>Undo<\/button>/g)).toHaveLength(1);
    });

    it("counts only the first compact block as visible and reports later changes as omitted", () => {
        const model: OperationsReviewModel = {
            intentId: "intent",
            groups: [group("first", 4, 2)],
        };

        expect(getOperationsCompactVisibility(model)).toEqual({
            limits: [2],
            omittedChanges: 2,
        });
    });

    it("counts hidden compact groups and caps the global changed-row budget", () => {
        const model: OperationsReviewModel = {
            intentId: "intent",
            groups: [
                group("first", 20, 20),
                group("second", 10, 8),
                group("third", 5, 5),
            ],
        };

        expect(getOperationsCompactVisibility(model)).toEqual({
            limits: [20, 4],
            omittedChanges: 11,
        });
    });

    it("renders the compact omission status before any visible group", () => {
        const model: OperationsReviewModel = {
            intentId: "intent-omission-order",
            groups: [
                group("first", 20, 20),
                group("second", 10, 8),
                group("third", 5, 5),
            ],
        };

        const html = renderToStaticMarkup(createElement(OperationsDiff, {
            model,
            mode: "compact",
        }));
        const omittedIndex = html.indexOf("pa-operations-diff__omitted");
        const firstGroupIndex = html.indexOf("pa-operations-diff__group");

        expect(omittedIndex).toBeGreaterThanOrEqual(0);
        expect(firstGroupIndex).toBeGreaterThan(omittedIndex);
        expect(html.slice(omittedIndex, firstGroupIndex)).toContain("11 changes are not shown");
    });

    it("labels only a paired line whose text is unchanged but line ending changed", () => {
        const oldRow: OperationsReviewDiffLine = {
            ...row("old-1", "delete", "same"),
            newline: "\r\n",
        };
        const newRow: OperationsReviewDiffLine = {
            ...row("new-1", "insert", "same"),
            newline: "\n",
        };
        const sameEnding: OperationsReviewDiffLine = {
            ...newRow,
            id: "new-2",
            newline: "\r\n",
        };

        expect(getOperationsEolChangeLabel(oldRow, newRow)).toBe("CRLF");
        expect(getOperationsEolChangeLabel(newRow, oldRow)).toBe("LF");
        expect(getOperationsEolChangeLabel(oldRow, sameEnding)).toBeNull();
        expect(getOperationsEolChangeLabel(row("context-1", "context", "same"), newRow)).toBeNull();
    });

    it("renders both sides of an LF-to-CRLF replacement with their actual line endings", () => {
        const oldRow: OperationsReviewDiffLine = {
            ...row("old-eol", "delete", "same"),
            newline: "\n",
        };
        const newRow: OperationsReviewDiffLine = {
            ...row("new-eol", "insert", "same"),
            newline: "\r\n",
        };
        const model: OperationsReviewModel = {
            intentId: "intent-eol",
            groups: [{
                ...group("eol", 2, 2),
                before: "same\n",
                after: "same\r\n",
                lines: [oldRow, newRow],
                blocks: [{
                    id: "eol-block",
                    startIndex: 0,
                    endIndex: 1,
                    contextBefore: 0,
                    contextAfter: 0,
                }],
            }],
        };

        const html = renderToStaticMarkup(createElement(OperationsDiff, {
            model,
            mode: "full",
        }));
        const deleteStart = html.indexOf("pa-operations-diff__row--delete");
        const insertStart = html.indexOf("pa-operations-diff__row--insert");
        expect(deleteStart).toBeGreaterThanOrEqual(0);
        expect(insertStart).toBeGreaterThan(deleteStart);
        expect(html.slice(deleteStart, insertStart)).toContain(">LF</span>");
        expect(html.slice(insertStart)).toContain(">CRLF</span>");
    });
});

describe("Operations full-review result projection", () => {
    it("attaches undo feedback to operation-owned results with path and operation identity", () => {
        const succeeded: OperationExecutionResult = {
            operationId: "operation-create",
            toolCallId: "call-create",
            name: "vault_create",
            path: "notes/same.md",
            status: "succeeded",
            receiptId: "receipt-create",
        };
        const stale: OperationExecutionResult = {
            operationId: "operation-stale",
            toolCallId: "call-stale",
            name: "vault_append",
            path: "notes/same.md",
            status: "stale",
            failureCategory: "stale_target",
            message: "note changed",
        };
        const fsError: OperationExecutionResult = {
            operationId: "operation-fs",
            toolCallId: "call-fs",
            name: "vault_append",
            path: "notes/other.md",
            status: "failed",
            failureCategory: "fs_error",
            message: "owner diagnostic english text",
        };
        const undo: UndoResult = {
            receiptId: "receipt-create",
            operationId: "operation-create",
            path: "notes/same.md",
            status: "stale",
            failureCategory: "stale_target",
            message: "cannot undo safely",
        };
        const snapshot: OperationsReviewSnapshot = {
            reviewId: "opr-review",
            intentId: "intent-review",
            status: "partial",
            actionInFlight: null,
            model: null,
            execution: null,
            operationResults: [succeeded, stale, fsError],
            undoResults: [undo],
            error: null,
        };

        const rows = projectOperationsReviewResultRows(snapshot);
        expect(rows.map(row => [
            row.operationResult.operationId,
            row.status,
            row.pathOperationNumber,
        ])).toEqual([
            ["operation-create", "stale", 1],
            ["operation-stale", "stale", 2],
            ["operation-fs", "failed", 1],
        ]);
        expect(rows[0]?.message).toContain("Target changed; recovery stopped");
        expect(rows[1]?.message).toBe("Stopped: note changed after preview");
        expect(rows[2]?.message).toBe("No further changes were applied.");
        expect(rows[2]?.message).not.toContain("owner diagnostic english text");
    });

    it("maps an expired SDK Undo result to recovery expiry, not preview expiry", () => {
        const sdkUndoExpired: OperationExecutionResult = {
            operationId: "sdk-undo-expired",
            toolCallId: "call-sdk-undo-expired",
            name: "obsidian.operations.undo",
            path: "notes/a.md",
            status: "failed",
            failureCategory: "expired",
            message: "Undo receipt is expired.",
            undoAvailable: false,
            resourceEffect: { kind: "undo", undoStatus: "expired" },
        };
        const snapshot: OperationsReviewSnapshot = {
            reviewId: "opr-sdk-undo-expired",
            intentId: "intent-sdk-undo-expired",
            status: "partial",
            actionInFlight: null,
            model: null,
            execution: null,
            operationResults: [sdkUndoExpired],
            undoResults: [],
            error: null,
        };
        expect(projectOperationsReviewResultRows(snapshot)[0]?.message)
            .toBe("The recovery window for this change has expired.");
    });

    it("maps a controller receipt-only expired Undo result by receipt before operation identity", () => {
        const succeeded: OperationExecutionResult = {
            operationId: "operation-owned",
            toolCallId: "call-owned",
            name: "vault_append",
            path: "notes/a.md",
            status: "succeeded",
            receiptId: "receipt-owned",
        };
        const expired: UndoResult = {
            receiptId: "receipt-owned",
            status: "expired",
            failureCategory: "expired",
            message: "Undo receipt is expired.",
        };
        const snapshot: OperationsReviewSnapshot = {
            reviewId: "opr-receipt-only",
            intentId: "intent-receipt-only",
            status: "completed",
            actionInFlight: null,
            model: null,
            execution: null,
            operationResults: [succeeded],
            undoResults: [expired],
            error: null,
        };

        expect(projectOperationsReviewResultRows(snapshot)).toEqual([
            expect.objectContaining({
                operationResult: succeeded,
                undoResult: expired,
                status: "expired",
                message: "The recovery window for this change has expired.",
                pathOperationNumber: 1,
            }),
        ]);
    });
});

describe("OperationsReviewPanel request scope", () => {
    it("offers one whole-request Undo entry and keeps blocked recovery facts visible", () => {
        const model = createOperationsReviewModel({
            id: "request-intent", runId: "request-run", turnId: "turn", createdAt: 1, expiresAt: 2,
            state: "pending",
            operations: [{
                id: "op", toolCallId: "call", name: "vault_append",
                input: { path: "notes/a.md", content: "\nB" },
                path: "notes/a.md", expectedBefore: "A", expectedAfter: "A\nB",
            }],
        });
        const snapshot: OperationsReviewSnapshot = {
            reviewId: "opr-request", intentId: "request-run", scope: "request", runId: "request-run",
            status: "partial", actionInFlight: null, model, execution: null,
            operationResults: [{
                operationId: "op", toolCallId: "call", name: "vault_append",
                path: "notes/a.md", status: "succeeded", receiptId: "receipt",
            }],
            undoResults: [{ receiptId: "receipt", operationId: "op", status: "stale",
                failureCategory: "stale_target" }],
            error: null,
        };
        const historicalSnapshot = {
            ...snapshot,
            status: "partial" as const,
            undoResults: [
                ...snapshot.undoResults,
                { receiptId: "receipt-2", operationId: "op-2", status: "undone" as const },
            ],
            historicalModel: model,
        };
        const historicalHtml = renderToStaticMarkup(createElement(OperationsReviewPanel, {
            session: {
                getSnapshot: () => historicalSnapshot,
                subscribe: () => () => {},
                canUndo: () => true,
                activeReceiptIds: () => ["receipt"],
                undoRequest: () => Promise.resolve([]),
            } as never,
        }));
        expect(historicalHtml).toContain("Historical changes");
        expect(historicalHtml).toContain("pa-operations-diff--request");
        let undone = false;
        const session = {
            getSnapshot: () => snapshot,
            subscribe: () => () => {},
            canUndo: () => undone === false,
            activeReceiptIds: () => undone ? [] : ["receipt"],
            undoRequest: () => { undone = true; return Promise.resolve([]); },
        };
        const html = renderToStaticMarkup(createElement(OperationsReviewPanel, { session: session as never }));
        expect(html).toContain(">Undo<");
        expect(html).not.toContain("Undo all");
        expect(html.match(/<button[^>]*>Undo<\/button>/g)).toHaveLength(1);
        expect(html).toContain("Target changed; recovery stopped");
        expect(html).toContain("1 changes remain");
    });

    it("shows the request preview partition without granting Undo", () => {
        const plannedGroup = group("request-preview", 2);
        const model: OperationsReviewModel = {
            intentId: "request-run",
            groups: [],
            previewGroups: [plannedGroup],
            previewAttachments: [{
                id: "preview-image:attachment",
                path: "assets/preview-image.png",
                action: "delete",
                plannedAction: "remove",
                undoLimitation: "temporary-attachment-and-note",
            }],
        };
        const snapshot: OperationsReviewSnapshot = {
            reviewId: "opr-request-preview", intentId: "request-run", scope: "request", runId: "request-run",
            status: "preview", actionInFlight: null, model, execution: null,
            operationResults: [], undoResults: [], error: null,
        };
        const undoRequest = jest.fn(() => Promise.resolve([]));
        const session = {
            getSnapshot: () => snapshot,
            subscribe: () => () => {},
            canUndo: () => false,
            activeReceiptIds: () => [],
            undoRequest,
        };
        const html = renderToStaticMarkup(createElement(OperationsReviewPanel, { session: session as never }));
        expect(html).toContain("Preview only. Nothing has been changed yet.");
        expect(html.match(/request-preview-</g)).toHaveLength(2);
        expect(html).toContain("assets/preview-image.png");
        expect(html).toContain("The local image file will be deleted according to your Obsidian delete setting");
        expect(html).not.toContain(">Undo<");
        expect(undoRequest).not.toHaveBeenCalled();
    });
});

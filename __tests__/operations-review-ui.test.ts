import { describe, expect, it } from "@jest/globals";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
    getOperationsCompactVisibility,
    getOperationsEolChangeLabel,
    OperationsDiff,
} from "../src/chat/operations-review/OperationsDiff";
import { projectOperationsReviewResultRows } from "../src/chat/operations-review/OperationsReviewPanel";
import type { OperationsReviewSnapshot } from "../src/ai-services/operations/operations-review-session";
import type { OperationExecutionResult, UndoResult } from "../src/ai-services/operations/types";
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
            activated: false,
            actionInFlight: null,
            model: null,
            execution: null,
            operationResults: [succeeded, stale],
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
        ]);
        expect(rows[0]?.message).toContain("cannot undo safely");
        expect(rows[1]?.message).toContain("note changed");
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
            activated: false,
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
                message: "Undo receipt is expired.",
                pathOperationNumber: 1,
            }),
        ]);
    });
});

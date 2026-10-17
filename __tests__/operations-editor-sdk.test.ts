import { OperationsService } from "../src/ai-services/operations/operations-service";
import { createOperationsReviewModel } from "../src/ai-services/operations/operations-review-model";
import type { WorkspaceSnapshotBinding } from "../src/ai-services/independent-computation/obsidian-resource-sdk";
import type { OperationsResourceContext, OperationsVault, ResourceOperationToolName } from "../src/ai-services/operations/types";

function fixture(before = "  A😀\r\nB  ") {
    const file = { path: "assets/note.md" }; let buffer = before; let live = true; let enabled = true;
    const disk = "different saved contents";
    const transaction = jest.fn((edits: readonly { from: number; to: number; text: string }[]) => {
        for (const edit of [...edits].sort((a, b) => b.from - a.from)) buffer = buffer.slice(0, edit.from) + edit.text + buffer.slice(edit.to);
    });
    const binding = { snapshotId: "snapshot", viewId: "original-view", file, get path() { return file.path; }, before,
        leaf: {}, view: {}, editor: {}, selection: { from: 0, to: before.length },
        isLive: () => live, readBuffer: () => buffer, transact: transaction } as unknown as WorkspaceSnapshotBinding;
    const isPathAllowed = (path: string) => !path.startsWith("excluded/");
    const guard = { isCurrent: () => enabled, isPathAllowed: (path: string) => enabled && isPathAllowed(path),
        isNoteDomainAllowed: () => enabled, captureSourceAuthority: () => () => enabled };
    const open = jest.fn<ReturnType<OperationsResourceContext["openResource"]>, Parameters<OperationsResourceContext["openResource"]>>(
        async () => ({ ok: true, value: { opened: true, viewId: "opened-view", viewType: "markdown" } }));
    const context: OperationsResourceContext = {
        resolveTarget: (target, passed) => {
            expect(passed).toBe(guard);
            return "path" in target && target.path === file.path ? { file, path: file.path, resourceRef: "resource", kind: "file" } : undefined;
        },
        getReadSnapshot: () => undefined,
        resolveWorkspaceSnapshot: (id, passed) => { expect(passed).toBe(guard); return id === binding.snapshotId ? binding : undefined; },
        openResource: open,
    };
    const vault: OperationsVault = { getAbstractFileByPath: path => path === file.path ? file : null,
        adapter: { exists: async () => true }, create: jest.fn(), process: jest.fn(), read: async () => disk };
    const service = new OperationsService({ vault, trashFile: jest.fn(), isOperationsAgentEnabled: () => enabled, isPathAllowed });
    const session = service.createSession({ surface: "editor" }); let sequence = 0;
    const stage = (name: ResourceOperationToolName, input: unknown, mode: "apply" | "preview" = "apply") => session.stageIntent({
        runId: "run", turnId: `turn-${++sequence}`, mode, taskSourceReadGuard: guard, resourceContext: context,
        operations: [{ toolCallId: `call-${sequence}`, name, input }],
    });
    const execute = (intentId: string) => session.executeCurrentIntent({ intentId, runId: "run", taskSourceReadGuard: guard });
    return { stage, execute, open, session, service, transaction, vault, guard, read: () => buffer,
        write: (text: string) => { buffer = text; }, move: (path: string) => { file.path = path; },
        close: () => { live = false; }, disable: () => { enabled = false; } };
}
describe("Operations editor SDK", () => {
    it("applies multiple original-snapshot edits with one transaction and Undo restores exact whitespace", async () => {
        const h = fixture("  A\nB  ");
        try {
            const intent = await h.stage("obsidian.workspace.applyEdits", { snapshotId: "snapshot", edits: [{ from: 2, to: 3, text: "X" }, { from: 4, to: 5, text: "Y" }] });
            expect(createOperationsReviewModel(intent).groups[0].resourceKind).toBe("editor");
            const result = await h.execute(intent.id); expect(h.read()).toBe("  X\nY  "); expect(h.transaction).toHaveBeenCalledTimes(1);
            expect(result.operations[0]).toMatchObject({ status: "succeeded", resourceEffect: { kind: "editor", scope: "editor-buffer", saved: "unknown" } });
            expect(h.vault.process).not.toHaveBeenCalled();
            expect((await h.session.undoMany([result.operations[0].receiptId!]))[0].status).toBe("undone");
            expect(h.read()).toBe("  A\nB  "); expect(h.transaction).toHaveBeenCalledTimes(2);
        } finally { h.service.dispose(); }
    });
    it.each([
        [{ from: 4, to: 4, text: "inside surrogate" }],
        [{ from: 6, to: 6, text: "inside CRLF" }],
        [{ from: 0, to: 3, text: "a" }, { from: 2, to: 5, text: "b" }],
        [{ from: 0, to: 0, text: "a" }, { from: 0, to: 0, text: "b" }],
    ].map(edits => ({ edits })))("rejects invalid original UTF-16 ranges before any transaction: %j", async ({ edits }) => {
        const h = fixture();
        try {
            await expect(h.stage("obsidian.workspace.applyEdits", { snapshotId: "snapshot", edits })).rejects.toMatchObject({ category: "schema_invalid" });
            expect(h.transaction).not.toHaveBeenCalled();
        } finally { h.service.dispose(); }
    });
    it("does not edit a closed original view or drifted buffer and never redirects to another editor", async () => {
        const h = fixture("A");
        try {
            const intent = await h.stage("obsidian.workspace.applyEdits", { snapshotId: "snapshot", edits: [{ from: 0, to: 1, text: "B" }] });
            h.close(); const result = await h.execute(intent.id);
            expect(result.operations[0].status).toBe("stale"); expect(h.read()).toBe("A"); expect(h.transaction).not.toHaveBeenCalled();
        } finally { h.service.dispose(); }
    });
    it("preserves all later user edits instead of calling an unrelated native Undo", async () => {
        const h = fixture(" A ");
        try {
            const intent = await h.stage("obsidian.workspace.applyEdits", { snapshotId: "snapshot", edits: [{ from: 1, to: 2, text: "B" }] });
            const result = await h.execute(intent.id); h.write(" user edit \n");
            expect((await h.session.undoMany([result.operations[0].receiptId!]))[0].status).toBe("stale");
            expect(h.read()).toBe(" user edit \n"); expect(h.transaction).toHaveBeenCalledTimes(1);
        } finally { h.service.dispose(); }
    });
    it.each([
        { path: "assets/moved.md", allowed: true },
        { path: "excluded/moved.md", allowed: false },
    ])("checks the moved editor's current path before apply and Undo: $path", async ({ path, allowed }) => {
        const apply = fixture("A"), undo = fixture("A");
        const edits = { snapshotId: "snapshot", edits: [{ from: 0, to: 1, text: "B" }] };
        try {
            const applyIntent = await apply.stage("obsidian.workspace.applyEdits", edits);
            apply.move(path);
            const applied = await apply.execute(applyIntent.id);
            expect(applied.operations[0]).toMatchObject({ path, status: allowed ? "succeeded" : "failed",
                ...(!allowed ? { failureCategory: "boundary_denied" } : {}) });
            expect(apply.read()).toBe(allowed ? "B" : "A");
            expect(apply.transaction).toHaveBeenCalledTimes(allowed ? 1 : 0);

            const editIntent = await undo.stage("obsidian.workspace.applyEdits", edits);
            const edited = await undo.execute(editIntent.id);
            const receiptId = edited.operations[0].receiptId!;
            undo.move(path);
            expect(undo.session.getUndoTargetPaths(receiptId)).toEqual([path]);
            if (allowed) {
                const undoIntent = await undo.stage("obsidian.operations.undo", { receiptId });
                expect(undoIntent.operations[0].path).toBe(path);
                expect((await undo.execute(undoIntent.id)).operations[0]).toMatchObject({ path, status: "succeeded",
                    resourceEffect: { kind: "undo", undoStatus: "undone" } });
            } else {
                expect((await undo.session.undoMany([receiptId]))[0]).toMatchObject({ path, status: "failed", failureCategory: "boundary_denied" });
            }
            expect(undo.read()).toBe(allowed ? "A" : "B");
            expect(undo.transaction).toHaveBeenCalledTimes(allowed ? 2 : 1);
        } finally { apply.service.dispose(); undo.service.dispose(); }
    });
    it("keeps open and edits preview free of native effects", async () => {
        const h = fixture("A");
        try {
            const open = await h.stage("obsidian.workspace.open", { target: { path: "assets/note.md" } }, "preview");
            const edit = await h.stage("obsidian.workspace.applyEdits", { snapshotId: "snapshot", edits: [{ from: 0, to: 1, text: "B" }] }, "preview");
            await expect(h.execute(open.id)).rejects.toMatchObject({ category: "boundary_denied" });
            await expect(h.execute(edit.id)).rejects.toMatchObject({ category: "boundary_denied" });
            expect(h.open).not.toHaveBeenCalled(); expect(h.transaction).not.toHaveBeenCalled();
        } finally { h.service.dispose(); }
    });
    it("preserves an already-opened partial result and does not fabricate an Undo receipt", async () => {
        const h = fixture();
        try {
            h.open.mockResolvedValueOnce({ ok: false, value: { opened: true, viewId: "opened-view", viewType: "markdown",
                position: { requested: { line: 1, ch: 0 }, applied: false, reason: "unsupported_view" } },
                error: { code: "position_unsupported", message: "The file opened, but this view has no requested text position.", executionState: "partially_succeeded" } });
            const intent = await h.stage("obsidian.workspace.open", { target: { path: "assets/note.md" }, position: { line: 1, ch: 0 } });
            const result = await h.execute(intent.id);
            expect(result).toMatchObject({ state: "partial", operations: [expect.objectContaining({ status: "partial", undoAvailable: false,
                resourceEffect: { kind: "open", opened: true, viewId: "opened-view", viewType: "markdown",
                    position: { requested: { line: 1, ch: 0 }, applied: false, reason: "unsupported_view" } } })] });
            expect(result.operations[0].receiptId).toBeUndefined();
            expect(h.session.getOwnedContextResult(intent.id, "run").execution?.operations[0].resourceEffect)
                .toEqual(result.operations[0].resourceEffect);
        } finally { h.service.dispose(); }
    });
    it("keeps an ambiguous native open as unknown instead of claiming no UI effect", async () => {
        const h = fixture();
        try {
            h.open.mockResolvedValueOnce({ ok: false, error: { code: "view_unavailable", message: "Native open completion is unavailable.",
                executionState: "acceptance_unknown" } });
            const intent = await h.stage("obsidian.workspace.open", { target: { path: "assets/note.md" } });
            const result = await h.execute(intent.id);
            expect(result).toMatchObject({ state: "unknown", operations: [{ status: "unknown", failureCategory: "unknown",
                undoAvailable: false, resourceEffect: { kind: "open" } }] });
            expect(result.operations[0].resourceEffect).not.toHaveProperty("opened");
            expect(result.operations[0].receiptId).toBeUndefined();
            expect(h.session.getOwnedContextResult(intent.id, "run").execution?.operations[0].status).toBe("unknown");
            expect(h.open).toHaveBeenCalledTimes(1);
        } finally { h.service.dispose(); }
    });

    it("keeps navigation and explicit SDK Undo facts out of whole-request recovery barriers", async () => {
        const write = fixture("A");
        const undoCase = fixture("A");
        try {
            const edited = await write.stage("obsidian.workspace.applyEdits", { snapshotId: "snapshot", edits: [{ from: 0, to: 1, text: "B" }] });
            await write.execute(edited.id);
            const opened = await write.stage("obsidian.workspace.open", { target: { path: "assets/note.md" } });
            const openResult = await write.execute(opened.id);
            expect(openResult.operations[0]).toMatchObject({ status: "succeeded", undoAvailable: false,
                resourceEffect: { kind: "open", opened: true } });
            expect(write.read()).toBe("B");

            const recovered = await write.session.undoRequest({ runId: "run", intentIds: [edited.id, opened.id],
                isSourceCurrent: () => true });
            expect(recovered.map(result => result.status)).toEqual(["undone"]);
            expect(write.read()).toBe("A");
            expect(write.transaction).toHaveBeenCalledTimes(2);

            const editIntent = await undoCase.stage("obsidian.workspace.applyEdits", { snapshotId: "snapshot", edits: [{ from: 0, to: 1, text: "B" }] });
            const editResult = await undoCase.execute(editIntent.id);
            const receiptId = editResult.operations[0].receiptId!;
            const explicitUndo = await undoCase.stage("obsidian.operations.undo", { receiptId });
            const undoResult = await undoCase.execute(explicitUndo.id);
            expect(undoResult.operations[0]).toMatchObject({ resourceEffect: { kind: "undo", undoStatus: "undone" } });
            expect(undoCase.read()).toBe("A");

            const replay = await undoCase.session.undoRequest({ runId: "run", intentIds: [editIntent.id, explicitUndo.id],
                isSourceCurrent: () => true });
            expect(replay).toEqual([]);
            expect(undoCase.read()).toBe("A");
            expect(undoCase.transaction).toHaveBeenCalledTimes(2);
        } finally {
            write.service.dispose();
            undoCase.service.dispose();
        }
    });

    it("treats an unknown explicit SDK Undo outcome as a request recovery barrier", async () => {
        const h = fixture("A");
        try {
            const first = await h.stage("obsidian.workspace.applyEdits", { snapshotId: "snapshot", edits: [{ from: 0, to: 1, text: "B" }] });
            await h.execute(first.id);
            const firstResult = await h.execute(first.id);
            // The native restore's own verification cannot confirm its result.
            h.transaction.mockImplementationOnce(() => { h.write("X"); });
            const explicitUndo = await h.stage("obsidian.operations.undo", { receiptId: firstResult.operations[0].receiptId! });
            const undoResult = await h.execute(explicitUndo.id);
            expect(undoResult.operations[0]).toMatchObject({ status: "unknown",
                resourceEffect: { kind: "undo", undoStatus: "unknown" } });

            const recovered = await h.session.undoRequest({ runId: "run",
                intentIds: [first.id, explicitUndo.id], isSourceCurrent: () => true });
            expect(recovered).toHaveLength(1);
            expect(recovered[0]).toMatchObject({ status: "unknown", failureCategory: "unknown" });
            expect(h.read()).toBe("X");
            expect(h.transaction).toHaveBeenCalledTimes(2);
        } finally { h.service.dispose(); }
    });
});

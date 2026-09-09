import type { Workspace } from "obsidian";
import type { MarkdownFileLike, MarkdownViewLike } from "../src/ai-services/chat-tool-execution-helpers";
import { TaskSourceNoteIdentities } from "../src/ai-services/task-source-note-identities";
import { TaskSourceConstraintState, type TaskSourceConstraint } from "../src/ai-services/task-source-constraint";

jest.mock("obsidian");

function harness() {
    const a: MarkdownFileLike = { path: "notes/a.md" };
    const b: MarkdownFileLike = { path: "notes/b.md" };
    const files = new Map([[a.path, a], [b.path, b]]);
    let active: MarkdownViewLike | null = { file: a };
    let recent: MarkdownViewLike | null = null;
    let leaves: MarkdownViewLike[] = [];
    const workspace = {
        getActiveViewOfType: jest.fn((_type: unknown) => active),
        getMostRecentLeaf: jest.fn(() => recent ? { view: recent } : null),
        getLeavesOfType: jest.fn((_type: string) => leaves.map(view => ({ view }))),
    } as unknown as Workspace;
    const getFileByPath = jest.fn((path: string) => files.get(path) ?? null);
    const host = { runId: "run-1", workspace, getFileByPath };
    return { a, b, files, host,
        get active() { return active; },
        setActive(view: MarkdownViewLike | null) { active = view; },
        setRecent(view: MarkdownViewLike | null) { recent = view; },
        setLeaves(views: MarkdownViewLike[]) { leaves = views; },
    };
}

function stateFor(identities: TaskSourceNoteIdentities): TaskSourceConstraintState {
    return new TaskSourceConstraintState({ runId: "run-1", userMessageId: "user-1",
        userText: "只用当前笔记", noteHandles: identities.noteHandles(), currentNoteHandle: identities.currentNote?.handle });
}

function currentCandidate(state: TaskSourceConstraintState): TaskSourceConstraint {
    const prepared = state.prepareDeclaration({ instructionQuote: "只用当前笔记", notes: "current_note", webAllowed: false });
    if (!prepared.ok) throw new Error(prepared.reason);
    return prepared.constraint;
}

describe("Task source note identities", () => {
    it("captures only the real file object and path without reading editor, title or stat", () => {
        const h = harness();
        const forbiddenRead = jest.fn(() => { throw new Error("content or metadata must not be read"); });
        for (const property of ["basename", "name", "extension", "stat"]) {
            Object.defineProperty(h.a, property, { get: forbiddenRead });
        }
        Object.defineProperty(h.active, "editor", { get: forbiddenRead });
        const identities = new TaskSourceNoteIdentities(h.host);
        const current = identities.currentNote!;
        expect(current.path).toBe("notes/a.md");
        expect(current.handle).not.toContain(current.path);
        expect(current.noteId).not.toContain(current.path);
        expect(Object.isFrozen(current)).toBe(true);
        expect(Object.isFrozen(h.a)).toBe(false);
        expect(identities.resolveNoteId(current.path)).toBe(current.noteId);
        expect(identities.pathForNoteId(current.noteId)).toBe(current.path);
        expect(identities.isCurrentNoteView()).toBe(true);
        expect(forbiddenRead).not.toHaveBeenCalled();
    });

    it.each(["recent", "markdown_leaf"] as const)("uses the existing %s fallback without a separate current-note rule", (fallback) => {
        const h = harness();
        h.setActive(null);
        if (fallback === "recent") h.setRecent({ file: h.b });
        else h.setLeaves([{ file: h.b }]);
        const identities = new TaskSourceNoteIdentities(h.host);
        expect(identities.currentNote?.path).toBe(h.b.path);
        expect(identities.isCurrentNoteView()).toBe(true);
    });

    it("accepts another pane of the same note and rejects switching to a different real file", () => {
        const h = harness();
        const identities = new TaskSourceNoteIdentities(h.host);
        h.setActive({ file: h.a });
        expect(identities.isCurrentNoteView()).toBe(true);
        h.setActive({ file: h.b });
        expect(identities.isCurrentNoteView()).toBe(false);
        expect(identities.currentNote?.path).toBe("notes/a.md");
        expect(identities.resolveNoteId(h.b.path)).toBeUndefined();
        h.setActive({ file: h.a });
        expect(identities.isCurrentNoteView()).toBe(true);
    });

    it.each(["delete", "replace", "rename"] as const)("rejects a captured identity after %s and retains its original exclusion path", (change) => {
        const h = harness();
        const identities = new TaskSourceNoteIdentities(h.host);
        const original = identities.currentNote!;
        h.files.delete(original.path);
        if (change === "replace") {
            const replacement = { path: original.path };
            h.files.set(original.path, replacement);
            h.setActive({ file: replacement });
            expect(identities.registerFile(replacement)).toBeUndefined();
        }
        if (change === "rename") {
            h.a.path = "notes/renamed.md";
            h.files.set(h.a.path, h.a);
            expect(identities.registerFile(h.a)).toBeUndefined();
            expect(identities.resolveNoteId(h.a.path)).toBeUndefined();
        }
        expect(identities.resolveNoteId(original.path)).toBeUndefined();
        expect(identities.pathForNoteId(original.noteId)).toBeUndefined();
        expect(identities.isCurrentNoteView()).toBe(false);
        expect(identities.capturedPathForNoteId(original.noteId)).toBe(original.path);
        expect(identities.noteHandles().get(original.handle)).toBe(original.noteId);
    });

    it("does not revive an observed invalid identity even when an old file object is restored", () => {
        const h = harness();
        const identities = new TaskSourceNoteIdentities(h.host);
        const original = identities.currentNote!;
        h.files.delete(original.path);
        expect(identities.resolveNoteId(original.path)).toBeUndefined();
        h.files.set(original.path, h.a);
        expect(identities.registerFile(h.a)).toBeUndefined();
        expect(identities.resolveNoteId(original.path)).toBeUndefined();
        const next = new TaskSourceNoteIdentities({ ...h.host, runId: "run-2" });
        expect(next.currentNote?.path).toBe(original.path);
        expect(next.currentNote?.noteId).not.toBe(original.noteId);
    });

    it("rejects a live lookup that returns an object for the wrong path", () => {
        const h = harness();
        h.host.getFileByPath.mockReturnValue(h.b);
        const identities = new TaskSourceNoteIdentities(h.host);
        expect(identities.currentNote).toBeUndefined();
        expect(identities.registerFile(h.a)).toBeUndefined();
        expect(identities.resolveNoteId(h.a.path)).toBeUndefined();
        expect(identities.noteHandles().size).toBe(0);
    });

    it("rejects same-path lookalikes and lookup failures after registration", () => {
        const h = harness();
        const identities = new TaskSourceNoteIdentities(h.host);
        expect(identities.registerFile({ path: h.a.path })).toBeUndefined();
        const id = identities.currentNote!.noteId;
        h.host.getFileByPath.mockImplementation(() => { throw new Error("unavailable"); });
        expect(identities.pathForNoteId(id)).toBeUndefined();
        expect(identities.resolveNoteId(h.a.path)).toBeUndefined();
        expect(identities.isCurrentNoteView()).toBe(false);
        expect(identities.capturedPathForNoteId(id)).toBe("notes/a.md");
    });

    it("requires a supported real vault file and does not adopt a later view as the initial current note", () => {
        const h = harness();
        h.setActive(null);
        const identities = new TaskSourceNoteIdentities(h.host);
        h.setActive({ file: h.a });
        expect(identities.registerFile(h.a)).toBeDefined();
        expect(identities.currentNote).toBeUndefined();
        expect(identities.isCurrentNoteView()).toBe(false);
        const folder = { path: "notes/folder.md", children: [] };
        const image = { path: "notes/image.png" };
        h.files.set(folder.path, folder);
        h.files.set(image.path, image);
        expect(identities.registerFile(folder)).toBeUndefined();
        expect(identities.registerFile(image)).toBeUndefined();
    });

    it.each(["delete", "replace", "rename"] as const)("supports the existing Canvas reader and rejects its identity after %s", (change) => {
        const h = harness();
        const canvas = { path: "notes/board.canvas" };
        h.files.set(canvas.path, canvas);
        const identities = new TaskSourceNoteIdentities(h.host);
        const identity = identities.registerFile(canvas)!;
        expect(identity.path).toBe("notes/board.canvas");
        expect(identities.resolveNoteId(canvas.path)).toBe(identity.noteId);
        expect(identities.pathForNoteId(identity.noteId)).toBe(canvas.path);
        expect(identities.noteHandles().get(identity.handle)).toBe(identity.noteId);
        expect(identities.currentNote?.path).toBe("notes/a.md");
        h.files.delete(identity.path);
        if (change === "replace") {
            const replacement = { path: identity.path };
            h.files.set(replacement.path, replacement);
            expect(identities.registerFile(replacement)).toBeUndefined();
        }
        if (change === "rename") {
            canvas.path = "notes/renamed.canvas";
            h.files.set(canvas.path, canvas);
            expect(identities.registerFile(canvas)).toBeUndefined();
            expect(identities.resolveNoteId(canvas.path)).toBeUndefined();
        }
        expect(identities.resolveNoteId(identity.path)).toBeUndefined();
        expect(identities.pathForNoteId(identity.noteId)).toBeUndefined();
        expect(identities.capturedPathForNoteId(identity.noteId)).toBe(identity.path);
    });

    it("does not treat a Canvas view as the current Markdown view", () => {
        const h = harness();
        const canvas = { path: "notes/board.canvas" };
        h.files.set(canvas.path, canvas);
        const view = { file: canvas, getViewType: () => "canvas" };
        h.setActive(view);
        h.setRecent(view);
        const identities = new TaskSourceNoteIdentities(h.host);
        expect(identities.currentNote).toBeUndefined();
        expect(identities.isCurrentNoteView()).toBe(false);
        expect(identities.registerFile(canvas)).toBeDefined();
    });

    it("registers discovered notes idempotently without changing a prepared or committed scope", () => {
        const h = harness();
        const identities = new TaskSourceNoteIdentities(h.host);
        const state = stateFor(identities);
        const candidate = currentCandidate(state);
        const other = identities.registerFile(h.b)!;
        expect(identities.registerFile(h.b)).toBe(other);
        expect(state.registerNoteHandle(other.handle, other.noteId)).toBe(true);
        expect(state.registerNoteHandle(other.handle, other.noteId)).toBe(true);
        expect(state.registerNoteHandle(identities.currentNote!.handle, other.noteId)).toBe(false);
        expect(state.commit(candidate)).toBe(true);
        expect(state.snapshot()).toBe(candidate);
        expect(state.allows({ kind: "note", noteId: other.noteId })).toBe(false);
        expect(state.prepareDeclaration({ instructionQuote: "只用当前笔记", notes: "selected",
            noteHandles: [other.handle], webAllowed: false })).toEqual({ ok: false, reason: "scope_widening" });
        const copy = identities.noteHandles() as Map<string, string>;
        copy.set(identities.currentNote!.handle, other.noteId);
        expect(identities.noteHandles().get(identities.currentNote!.handle)).toBe(candidate.allowedNoteIds![0]);
        expect(state.registerNoteHandle("", "new-id")).toBe(false);
        expect(state.registerNoteHandle("new-handle", " ")).toBe(false);
        expect(identities.pathForNoteId("foreign-id")).toBeUndefined();
        expect(identities.capturedPathForNoteId("foreign-id")).toBeUndefined();
    });

    it("keeps an excluded path bound when the file is deleted and recreated in the same run", () => {
        const h = harness();
        const identities = new TaskSourceNoteIdentities(h.host);
        const excluded = identities.registerFile(h.b)!;
        const state = stateFor(identities);
        const prepared = state.prepareDeclaration({ instructionQuote: "只用当前笔记", notes: "vault",
            excludedNoteHandles: [excluded.handle], webAllowed: false });
        if (!prepared.ok || !state.commit(prepared.constraint)) throw new Error("Scope fixture did not commit");
        const replacement = { path: h.b.path };
        h.files.set(replacement.path, replacement);
        expect(identities.registerFile(replacement)).toBeUndefined();
        expect(identities.resolveNoteId(replacement.path)).toBeUndefined();
        expect(state.snapshot()).toBe(prepared.constraint);
        expect(prepared.constraint.excludedNoteIds.map(id => identities.capturedPathForNoteId(id))).toEqual([replacement.path]);
    });
});

describe("Scoped Memory reads from task source constraints", () => {
    it("resolves a committed current-note search scope from real identities and rejects same-path recreation", () => {
        const h = harness();
        const identities = new TaskSourceNoteIdentities(h.host);
        const state = stateFor(identities);
        const candidate = currentCandidate(state);
        expect(state.commit(candidate)).toBe(true);
        const getScope = jest.fn(() => ({
            allowedPaths: candidate.allowedNoteIds === null ? null : candidate.allowedNoteIds.map(noteId => {
                const path = identities.pathForNoteId(noteId);
                if (!path) throw new Error("An allowed note identity is no longer live.");
                return path;
            }),
            excludedPaths: candidate.excludedNoteIds.map(noteId => {
                const path = identities.capturedPathForNoteId(noteId);
                if (!path) throw new Error("An excluded note identity is unknown.");
                return path;
            }),
        }));
        const guard = state.createReadGuard(candidate, path => identities.resolveNoteId(path),
            () => identities.isCurrentNoteView(), undefined, getScope);
        expect(guard.getNoteSearchScope!()).toEqual({ allowedPaths: ["notes/a.md"], excludedPaths: [] });
        expect(guard.isPathAllowed("notes/a.md")).toBe(true);
        expect(guard.isPathAllowed("notes/b.md")).toBe(false);

        h.files.delete("notes/a.md");
        expect(() => guard.getNoteSearchScope!()).toThrow("no longer current");
        expect(guard.isPathAllowed("notes/a.md")).toBe(false);
        const replacement = { path: "notes/a.md" };
        h.files.set(replacement.path, replacement);
        h.setActive({ file: replacement });
        expect(identities.registerFile(replacement)).toBeUndefined();
        expect(() => guard.getNoteSearchScope!()).toThrow("no longer current");
        expect(guard.isPathAllowed(replacement.path)).toBe(false);
        expect(getScope).toHaveBeenCalledTimes(1);
        expect(state.snapshot()).toBe(candidate);
    });

    it("admits only owned current or prepared scope snapshots and never upgrades a broad search", () => {
        const h = harness();
        const state = stateFor(new TaskSourceNoteIdentities(h.host));
        expect(state.allows({ kind: "scoped_vault_search" })).toBe(false);
        const candidate = currentCandidate(state);
        expect(state.allows({ kind: "scoped_vault_search" }, candidate)).toBe(true);
        expect(state.allows({ kind: "scoped_vault_search" }, { ...candidate })).toBe(false);
        expect(state.allows({ kind: "vault_search" }, candidate)).toBe(false);
        expect(state.commit(candidate)).toBe(true);
        expect(state.allows({ kind: "scoped_vault_search" })).toBe(true);
        expect(state.allows({ kind: "vault_search" })).toBe(false);
    });

    it("checks a committed current scope before and after resolving each search plan", () => {
        const h = harness();
        const identities = new TaskSourceNoteIdentities(h.host);
        const state = stateFor(identities);
        const candidate = currentCandidate(state);
        const scope = { allowedPaths: [h.a.path], excludedPaths: [] };
        const getScope = jest.fn(() => scope);
        let hostCurrent = true;
        const guard = state.createReadGuard(candidate, path => identities.resolveNoteId(path), () => hostCurrent, undefined, getScope);
        expect(() => guard.getNoteSearchScope!()).toThrow("no longer current");
        expect(getScope).not.toHaveBeenCalled();
        expect(state.commit(candidate)).toBe(true);
        expect(guard.getNoteSearchScope!()).toBe(scope);
        getScope.mockImplementationOnce(() => { hostCurrent = false; return scope; });
        expect(() => guard.getNoteSearchScope!()).toThrow("no longer current");
        expect(getScope).toHaveBeenCalledTimes(2);
        expect(() => guard.getNoteSearchScope!()).toThrow("no longer current");
        expect(getScope).toHaveBeenCalledTimes(2);
    });

    it("does not provide an unrestricted fallback or reuse a getter after scope tightening", () => {
        const h = harness();
        const identities = new TaskSourceNoteIdentities(h.host);
        const state = stateFor(identities);
        const candidate = currentCandidate(state);
        state.commit(candidate);
        const unplanned = state.createReadGuard(candidate, path => identities.resolveNoteId(path), () => true);
        expect(unplanned.getNoteSearchScope).toBeUndefined();
        const getScope = jest.fn(() => ({ allowedPaths: [h.a.path], excludedPaths: [] }));
        const guard = state.createReadGuard(candidate, path => identities.resolveNoteId(path), () => true, undefined, getScope);
        const narrowed = state.prepareDeclaration({ instructionQuote: "只用当前笔记", notes: "none", webAllowed: false });
        if (!narrowed.ok || !state.commit(narrowed.constraint)) throw new Error("Scope fixture did not narrow");
        expect(state.allows({ kind: "scoped_vault_search" }, candidate)).toBe(false);
        expect(() => guard.getNoteSearchScope!()).toThrow("no longer current");
        expect(getScope).not.toHaveBeenCalled();
    });
});

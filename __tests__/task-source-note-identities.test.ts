import type { Workspace } from "obsidian";
import type { MarkdownFileLike, MarkdownViewLike } from "../src/ai-services/chat-tool-execution-helpers";
import { TaskSourceNoteIdentities } from "../src/ai-services/task-source-note-identities";
import { TaskSourceConstraintState } from "../src/ai-services/task-source-constraint";

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

function stateFor(identities: TaskSourceNoteIdentities, userText = "只用当前笔记"): TaskSourceConstraintState {
    return new TaskSourceConstraintState({ runId: "run-1", userMessageId: "user-1",
        userText, noteHandles: identities.noteHandles() });
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

    it("registers discovered identities without changing fixed Host admission", () => {
        const h = harness();
        const identities = new TaskSourceNoteIdentities(h.host);
        const state = stateFor(identities);
        const admission = state.snapshot();
        const other = identities.registerFile(h.b)!;
        expect(identities.registerFile(h.b)).toBe(other);
        expect(state.registerNoteHandle(other.handle, other.noteId)).toBe(true);
        expect(state.registerNoteHandle(other.handle, other.noteId)).toBe(true);
        expect(state.registerNoteHandle(identities.currentNote!.handle, other.noteId)).toBe(false);
        expect(state.snapshot()).toBe(admission);
        const copy = identities.noteHandles() as Map<string, string>;
        copy.set(identities.currentNote!.handle, other.noteId);
        expect(identities.noteHandles().get(identities.currentNote!.handle))
            .toBe(identities.currentNote!.noteId);
        expect(state.registerNoteHandle("", "new-id")).toBe(false);
        expect(state.registerNoteHandle("new-handle", " ")).toBe(false);
    });

    it("does not revive a deleted and recreated path in the same run", () => {
        const h = harness();
        const identities = new TaskSourceNoteIdentities(h.host);
        const original = identities.registerFile(h.b)!;
        const replacement = { path: h.b.path };
        h.files.set(replacement.path, replacement);
        expect(identities.registerFile(replacement)).toBeUndefined();
        expect(identities.resolveNoteId(replacement.path)).toBeUndefined();
        expect(identities.capturedPathForNoteId(original.noteId)).toBe(replacement.path);
    });
});

describe("Memory search guard from fixed Host admission", () => {
    it("rechecks current identity before and after resolving a search scope", () => {
        const h = harness();
        const identities = new TaskSourceNoteIdentities(h.host);
        const state = stateFor(identities);
        const admission = state.snapshot();
        let hostCurrent = true;
        const getScope = jest.fn(() => ({ allowedPaths: null, excludedPaths: [] as string[] }));
        const guard = state.createReadGuard(admission, path => identities.resolveNoteId(path),
            () => hostCurrent && identities.isCurrentNoteView(), undefined, getScope);
        expect(guard.getNoteSearchScope!()).toEqual({ allowedPaths: null, excludedPaths: [] });
        expect(guard.isPathAllowed(h.a.path)).toBe(true);
        getScope.mockImplementationOnce(() => { hostCurrent = false; return { allowedPaths: null, excludedPaths: [] }; });
        expect(() => guard.getNoteSearchScope!()).toThrow("no longer current");
        expect(getScope).toHaveBeenCalledTimes(2);
        expect(() => guard.getNoteSearchScope!()).toThrow("no longer current");
        expect(getScope).toHaveBeenCalledTimes(2);
    });

    it("has no unscoped fallback and rejects a forged admission snapshot", () => {
        const h = harness();
        const identities = new TaskSourceNoteIdentities(h.host);
        const state = stateFor(identities);
        const admission = state.snapshot();
        const unplanned = state.createReadGuard(admission, path => identities.resolveNoteId(path), () => true);
        expect(unplanned.getNoteSearchScope).toBeUndefined();
        const forged = state.createReadGuard({ ...admission }, path => identities.resolveNoteId(path), () => true,
            undefined, () => ({ allowedPaths: null, excludedPaths: [] }));
        expect(forged.isCurrent()).toBe(false);
        expect(() => forged.getNoteSearchScope!()).toThrow("no longer current");
    });
});

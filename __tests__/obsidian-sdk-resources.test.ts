import type { Editor, Workspace } from "obsidian";
import type { AiServiceHost } from "../src/ai-services/AiServiceHost";
import type { TaskSourceReadGuard } from "../src/ai-services/task-source-read-guard";
import type { ChatMessage, PaAgentMessage, SourceRecord } from "../src/ai-services/chat-types";
import { OperationsIntentController } from "../src/ai-services/operations/operations-intent-controller";
import type { OperationsResourceContext, OperationsVault, ResourceOperationToolName } from "../src/ai-services/operations/types";
import { TaskSourceRun } from "../src/ai-services/task-source-run";
import { TaskSourceResourceIdentities } from "../src/ai-services/task-source-resource-identities";
import { completeInputLineage } from "../src/ai-services/input-lineage";
import { createTaskSourceConstrainedExecutor } from "../src/ai-services/task-source-executor";
import { captureWorkspaceSnapshot, executeObsidianSdkMethod, getReadSnapshot, nativeOpenObsidianResource, resolveObsidianResource, resolveObsidianSdkReadPlan, resolveWorkspaceSnapshot, SDK_BINARY_PAGE_BYTES, SDK_TEXT_PAGE_CHARS, validateObsidianSdkInput, type ObsidianSdkHost, type SdkResource, type SdkResult, } from "../src/ai-services/independent-computation/obsidian-resource-sdk";
jest.mock("obsidian", () => ({
    ...jest.requireActual("../__mocks__/obsidian"),
    View: class {
    },
    parseLinktext: (text: string) => {
        const hash = text.indexOf("#");
        return { path: hash < 0 ? text : text.slice(0, hash), subpath: hash < 0 ? "" : text.slice(hash) };
    },
}));
interface EditorFixture {
    editor: Editor;
    transaction: jest.Mock;
    setCursor: jest.Mock;
    setBuffer(value: string): void;
    value(): string;
}
function editorFixture(initial: string, from = 0, to = from): EditorFixture {
    let buffer = initial;
    let cursor = from;
    const offsetToPos = (offset: number) => {
        const lines = buffer.slice(0, offset).split("\n");
        return { line: lines.length - 1, ch: lines[lines.length - 1].length };
    };
    const posToOffset = (pos: {
        line: number;
        ch: number;
    }) => buffer.split("\n").slice(0, pos.line).reduce((sum, line) => sum + line.length + 1, 0) + pos.ch;
    const setCursor = jest.fn((pos: {
        line: number;
        ch: number;
    }) => { cursor = posToOffset(pos); });
    const transaction = jest.fn(({ changes }: {
        changes: Array<{
            from: {
                line: number;
                ch: number;
            };
            to: {
                line: number;
                ch: number;
            };
            text: string;
        }>;
    }) => {
        const captured = changes.map(change => ({ from: posToOffset(change.from), to: posToOffset(change.to), text: change.text }));
        for (const change of captured.sort((a, b) => b.from - a.from))
            buffer = buffer.slice(0, change.from) + change.text + buffer.slice(change.to);
    });
    const editor = {
        getValue: jest.fn(() => buffer),
        getCursor: jest.fn((which?: string) => offsetToPos(which === "to" ? to : which === "from" ? from : cursor)),
        posToOffset, offsetToPos, setCursor, transaction,
    } as unknown as Editor;
    return { editor, transaction, setCursor, setBuffer: value => { buffer = value; }, value: () => buffer };
}
interface TestView {
    file?: SdkResource;
    editor?: Editor;
    getViewType(): string;
}
interface TestLeaf {
    view: TestView;
    openFile: jest.Mock;
}
function fixture(scope: "notes" | "web" | "legacy" = "notes") {
    const files = new Map<string, SdkResource>();
    const bodies = new WeakMap<SdkResource, Uint8Array>();
    const denied = new Set<string>();
    const root: SdkResource = { path: "", name: "", children: [] };
    files.set("", root);
    const add = (path: string, value?: string | Uint8Array): SdkResource => {
        const folder = value === undefined;
        const slash = path.lastIndexOf("/");
        const parentPath = slash < 0 ? "" : path.slice(0, slash);
        const parent = files.get(parentPath) ?? add(parentPath);
        const bytes = folder ? undefined : typeof value === "string" ? new TextEncoder().encode(value) : value;
        const file: SdkResource = {
            path, name: path.split("/").pop(),
            ...(folder ? { children: [] } : { extension: path.split(".").pop(), stat: { size: bytes!.length, mtime: 1, ctime: 1 } }),
        };
        files.set(path, file);
        parent.children!.push(file);
        if (bytes)
            bodies.set(file, bytes);
        return file;
    };
    const replaceBody = (file: SdkResource, value: string | Uint8Array) => {
        const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
        bodies.set(file, bytes);
        file.stat!.size = bytes.length;
        file.stat!.mtime = (file.stat!.mtime ?? 0) + 1;
    };
    const move = (file: SdkResource, path: string) => {
        const previous = file.path;
        const parent = files.get(previous.includes("/") ? previous.slice(0, previous.lastIndexOf("/")) : "");
        parent!.children = parent!.children!.filter(child => child !== file);
        for (const [oldPath, object] of [...files]) {
            if (object === file || oldPath.startsWith(previous + "/")) {
                files.delete(oldPath);
                object.path = path + oldPath.slice(previous.length);
                files.set(object.path, object);
            }
        }
        const nextParentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        const nextParent = files.get(nextParentPath) ?? add(nextParentPath);
        nextParent.children!.push(file);
    };
    const leaves: TestLeaf[] = [];
    let active: TestView | null = null;
    let current = true;
    let sourcesCurrent = true;
    let graphEpoch = "E0";
    let configurationEpoch = "C0";
    const pane = (file?: SdkResource, editor?: Editor, type = "markdown") => {
        const leaf: TestLeaf = { view: { file, editor, getViewType: () => type }, openFile: jest.fn() };
        leaf.openFile.mockImplementation(async (target: SdkResource) => { leaf.view.file = target; });
        leaves.push(leaf);
        active = leaf.view;
        return leaf;
    };
    const workspace = {
        getActiveViewOfType: jest.fn((constructor: unknown) => { expect(constructor).toBeDefined(); return active; }),
        getMostRecentLeaf: jest.fn(() => leaves.find(leaf => leaf.view === active)),
        getLeavesOfType: jest.fn(() => leaves),
        iterateAllLeaves: jest.fn((visit: (leaf: TestLeaf) => unknown) => {
            // Native traversal stops a branch when the callback returns truthy.
            for (const leaf of leaves) {
                if (visit(leaf)) break;
            }
        }),
        getLeaf: jest.fn(() => leaves.find(leaf => leaf.view === active) ?? pane()),
    };
    const vault = {
        getAbstractFileByPath: jest.fn((path: string) => files.get(path) ?? null),
        readBinary: jest.fn(async (file: SdkResource): Promise<ArrayBuffer> => bodies.get(file)!.slice().buffer as ArrayBuffer),
    };
    const cached = new Map<SdkResource, Record<string, unknown> | null>();
    const metadataCache = {
        getFileCache: jest.fn((file: SdkResource) => cached.get(file) ?? null),
        getFirstLinkpathDest: jest.fn((link: string) => files.get(link) ?? null),
        resolvedLinks: {} as Record<string, Record<string, number>>,
    };
    const identities = new TaskSourceResourceIdentities({ runId: "run", getAbstractFileByPath: path => files.get(path) });
    const sourceRun = new TaskSourceRun({
        runId: "run", userMessageId: "user", userText: "request", workspace: workspace as unknown as Workspace,
        getFileByPath: path => denied.has(path) ? undefined : files.get(path),
        isPathAllowed: path => !denied.has(path), isCurrent: () => current, areSourcesCurrent: () => sourcesCurrent,
        resourceIdentities: identities, getMemoryEvidenceEpoch: () => graphEpoch,
        getTaskSourceConfigurationEpoch: () => configurationEpoch, getTaskSourceAuthorityEpoch: () => "authority",
        ...(scope !== "legacy" ? { runSourceSelection: { schemaVersion: 1 as const, scope, selectionId: "selection", userMessageId: "user" } } : {}),
    });
    const onReadAdmitted = jest.fn();
    const host: ObsidianSdkHost = { host: { app: { vault, workspace, metadataCache } } as unknown as AiServiceHost, sourceRun, onReadAdmitted };
    const guard: TaskSourceReadGuard = { isCurrent: () => current, isPathAllowed: path => !denied.has(path), checkpoint: jest.fn(async () => { }) };
    return { host, sourceRun, identities, files, bodies, root, add, move, replaceBody, denied, vault, cached, metadataCache,
        leaves, workspace, pane, guard, onReadAdmitted,
        activate: (leaf: TestLeaf) => { active = leaf.view; }, close: (leaf: TestLeaf) => { leaves.splice(leaves.indexOf(leaf), 1); },
        setCurrent: (value: boolean) => { current = value; }, setSourcesCurrent: (value: boolean) => { sourcesCurrent = value; },
        setGraphEpoch: (value: string) => { graphEpoch = value; }, setConfigurationEpoch: (value: string) => { configurationEpoch = value; },
    };
}
function value(result: SdkResult<unknown>): Record<string, any> {
    expect(result.ok).toBe(true);
    if (!result.ok)
        throw new Error(result.error.message);
    return result.value as Record<string, any>;
}
describe("B174 host-owned resource observations", () => {
    it("validates exact public schemas, including the three direct facades", () => {
        expect(validateObsidianSdkInput("list_vault_entries", { target: { path: "" }, recursive: true })).toEqual({ target: { path: "" }, recursive: true });
        expect(validateObsidianSdkInput("vault_create_folder", { mode: "apply", path: "a/b", parents: true }).path).toBe("a/b");
        expect(validateObsidianSdkInput("vault_trash", { mode: "preview", target: { resourceRef: "opaque" } }).mode).toBe("preview");
        for (const raw of [{ target: { path: "a", resourceRef: "r" } }, { target: { path: "../a" } }, { target: { path: ".obsidian/a" } }, { target: { path: "a" }, host: {} }]) {
            expect(() => validateObsidianSdkInput("obsidian.vault.readText", raw)).toThrow();
        }
        expect(validateObsidianSdkInput("vault_create_folder", { path: "a" })).toEqual({ mode: "apply", path: "a", parents: false });
        expect(validateObsidianSdkInput("vault_trash", { target: { path: "a" } })).toEqual({ mode: "apply", target: { path: "a" }, recursive: false });
        expect(() => validateObsidianSdkInput("vault_create_folder", { mode: null, path: "a" })).toThrow();
        expect(() => validateObsidianSdkInput("obsidian.workspace.open", { target: { path: "a" }, position: { line: 0, ch: -1 } })).toThrow();
        expect(() => validateObsidianSdkInput("obsidian.workspace.applyEdits", { snapshotId: "snapshot", edits: [{ from: 2, to: 1, text: "" }] })).toThrow();
        expect(() => validateObsidianSdkInput("obsidian.metadata.inspect", { target: { path: "a" }, fields: ["privateCache"] })).toThrow();
    });
    it("keeps a moved object ref and permanently rejects its old ref after replacement", async () => {
        const h = fixture(), file = h.add("a.txt", "original");
        const first = value(await executeObsidianSdkMethod(h.host, "obsidian.vault.readText", { target: { path: file.path } }));
        h.move(file, "renamed.txt");
        expect(resolveObsidianResource(h.host, { resourceRef: first.resourceRef })).toMatchObject({ path: "renamed.txt", kind: "file", file });
        expect(getReadSnapshot(h.host, first.sourceVersion, { resourceRef: first.resourceRef })?.before).toBe("original");
        h.files.delete(file.path);
        const rebuilt = h.add(file.path, "new");
        expect(resolveObsidianResource(h.host, { resourceRef: first.resourceRef })).toBeUndefined();
        expect(getReadSnapshot(h.host, first.sourceVersion, { path: rebuilt.path })).toBeUndefined();
        const second = value(await executeObsidianSdkMethod(h.host, "obsidian.vault.readText", { target: { path: rebuilt.path } }));
        expect(second.resourceRef).not.toBe(first.resourceRef);
    });
    it("reads existing long resource paths with joined emoji by path and by ref", async () => {
        const h = fixture();
        const path = `${"nested/".repeat(30)}👩‍💻.txt`;
        h.add(path, "a\r\n😀");
        const first = value(await executeObsidianSdkMethod(h.host, "obsidian.vault.readText", { target: { path } }));
        const second = value(await executeObsidianSdkMethod(h.host, "obsidian.vault.readText", { target: { resourceRef: first.resourceRef } }));
        expect(first).toMatchObject({ path, text: "a\r\n😀", range: { start: 0, end: 5, total: 5 }, coverage: "complete" });
        expect(second).toMatchObject({ path, text: "a\r\n😀", resourceRef: first.resourceRef });
    });
    it("returns correctable schema errors through source preflight and admits the corrected call", () => {
        const h = fixture();
        h.add("a.txt", "data");
        const executor = createTaskSourceConstrainedExecutor({
            baseExecutor: { execute: jest.fn() }, state: h.sourceRun.state,
            resolveHostNoteId: h.sourceRun.resolveNoteId, isHostCurrent: h.sourceRun.isCurrent,
            resolveReadPlans: calls => {
                const result = h.sourceRun.resolveReadPlansWithReason(calls, h.host);
                if (result.ok) return result.plans;
                if (result.reason === "invalid_call" && result.message) {
                    return { rejectionReason: "schema_invalid" as const, message: result.message };
                }
                return undefined;
            },
        });
        const preflight = (target: Record<string, string>) => executor.preflightBatch!({
            runId: "run", turnId: "turn", turnIndex: 0, userInput: "request",
            toolCalls: [{ type: "toolCall", id: "read", index: 0, name: "obsidian.vault.readText", input: { target } }],
        });
        expect(preflight({ path: "a.txt", resourceRef: "old" })).toMatchObject({
            outcome: "schema_invalid", executionState: "not_started",
            promptText: expect.stringMatching(/path.*resourceRef|resourceRef.*path/),
            metadata: { reason: "schema_invalid" },
        });
        expect(h.vault.readBinary).not.toHaveBeenCalled();
        expect(preflight({ path: "a.txt" })).toMatchObject({ kind: "admitted" });
    });
    it("registered refs and sync private ports still enforce current guard, scope and cancellation", async () => {
        const h = fixture(), file = h.add("a.txt", "a");
        const first = value(await executeObsidianSdkMethod(h.host, "obsidian.vault.readText", { target: { path: file.path } }));
        h.denied.add(file.path);
        h.vault.readBinary.mockClear();
        expect(resolveObsidianResource(h.host, { resourceRef: first.resourceRef })).toBeUndefined();
        expect(getReadSnapshot(h.host, first.sourceVersion, { resourceRef: first.resourceRef })).toBeUndefined();
        expect((await executeObsidianSdkMethod(h.host, "obsidian.vault.readText", { target: { resourceRef: first.resourceRef } })).ok).toBe(false);
        expect(h.vault.readBinary).not.toHaveBeenCalled();
        h.denied.clear();
        const controller = new AbortController();
        controller.abort();
        expect(() => resolveObsidianResource({ ...h.host, signal: controller.signal }, { path: file.path })).toThrow();
        expect(() => getReadSnapshot({ ...h.host, signal: controller.signal }, first.sourceVersion, { path: file.path })).toThrow();
        expect(resolveObsidianResource({ ...h.host, guard: { isCurrent: () => true, isPathAllowed: () => false } }, { path: file.path })).toBeUndefined();
        const web = fixture("web");
        web.add("a.txt", "a");
        expect((await executeObsidianSdkMethod(web.host, "obsidian.vault.readText", { target: { path: "a.txt" } })).ok).toBe(false);
        expect(web.vault.readBinary).not.toHaveBeenCalled();
        const ownOutput = web.add("answer.md", "PUBLIC_OUTPUT");
        web.sourceRun.registerCreatedResource(ownOutput, "PUBLIC_OUTPUT", "own-receipt");
        expect(value(await executeObsidianSdkMethod(web.host, "obsidian.vault.readText", { target: { path: ownOutput.path } })).text).toBe("PUBLIC_OUTPUT");
        expect(web.sourceRun.isCreatedResourceUndoAllowed("foreign-receipt", [ownOutput.path])).toBe(false);
        // Cached metadata is not proof of content created by this request.
        web.cached.set(ownOutput, { frontmatter: { private: "PRIVATE_CACHE" } });
        expect(await executeObsidianSdkMethod(web.host, "obsidian.metadata.inspect", { target: { path: ownOutput.path } }))
            .toMatchObject({ ok: false, error: { code: "source_excluded" } });
    });
    it.each(["replaced", "edited", "excluded"] as const)("does not disclose a Web output after it is %s", async scenario => {
        const h = fixture("web"), file = h.add("answer.md", "PUBLIC_OUTPUT");
        h.sourceRun.registerCreatedResource(file, "PUBLIC_OUTPUT", "own-receipt");
        if (scenario === "replaced") h.files.set(file.path, { ...file });
        else if (scenario === "excluded") h.denied.add(file.path);
        else h.bodies.set(file, new TextEncoder().encode("PRIVATE_OUTPUT")); // even before native stat updates
        for (const method of ["obsidian.vault.readText", "obsidian.vault.readBinary"] as const) {
            const result = await executeObsidianSdkMethod(h.host, method, { target: { path: file.path } });
            expect(result.ok).toBe(false);
            expect(JSON.stringify(result)).not.toContain("PRIVATE_OUTPUT");
        }
        expect((await nativeOpenObsidianResource(h.host, { path: file.path })).ok).toBe(false);
        expect(h.host.host.app.workspace.getLeaf).not.toHaveBeenCalled();
    });
    it("enumerates native folders, files and empty directories without revealing excluded entries", async () => {
        const h = fixture();
        h.add("dir");
        h.add("dir/a.txt", "a");
        h.add("dir/nested");
        h.add("dir/nested/image.png", new Uint8Array([1]));
        h.add("empty");
        expect(value(await executeObsidianSdkMethod(h.host, "obsidian.vault.list", { target: { path: "empty" } })).entries).toEqual([]);
        expect(value(await executeObsidianSdkMethod(h.host, "obsidian.vault.list", { target: { path: "dir/a.txt" } })).entries).toHaveLength(1);
        expect(value(await executeObsidianSdkMethod(h.host, "obsidian.vault.list", { target: { path: "dir" } }))).toMatchObject({
            path: "dir",
            entries: [{ path: "dir/a.txt", kind: "file" }, { path: "dir/nested", kind: "folder" }],
            coverage: "complete",
            range: { start: 0, end: 2, total: 2 },
            resourceRef: expect.any(String),
            source: { kind: "vault-tree", sourceVersion: expect.any(String) },
        });
        h.denied.add("dir/nested/image.png");
        const recursive = value(await executeObsidianSdkMethod(h.host, "obsidian.vault.list", { target: { path: "" }, recursive: true }));
        expect(recursive.coverage).toBe("restricted");
        expect(JSON.stringify(recursive)).not.toContain("image.png");
        expect(h.onReadAdmitted.mock.calls.some(([path]) => path === "dir/nested/image.png")).toBe(false);
    });
    it("binds list continuations to the same query and unchanged real tree", async () => {
        const h = fixture();
        h.add("dir");
        for (let index = 0; index < 201; index++)
            h.add(`dir/${index}.txt`, "");
        const first = value(await executeObsidianSdkMethod(h.host, "obsidian.vault.list", { target: { path: "dir" } }));
        expect(first.entries).toHaveLength(200);
        expect(first.coverage).toBe("partial");
        const tail = value(await executeObsidianSdkMethod(h.host, "obsidian.vault.list", { target: { resourceRef: first.resourceRef }, cursor: first.nextCursor }));
        expect(tail.entries).toHaveLength(1);
        expect(tail.coverage).toBe("partial");
        expect(tail.nextCursor).toBeUndefined();
        expect((await executeObsidianSdkMethod(h.host, "obsidian.vault.list", { target: { path: "dir" }, recursive: true, cursor: first.nextCursor })).ok).toBe(false);
        h.add("dir/new.txt", "");
        expect((await executeObsidianSdkMethod(h.host, "obsidian.vault.list", { target: { path: "dir" }, cursor: first.nextCursor })).ok).toBe(false);
    });
    it.each(["\r\n", "😀"])("preserves BOM, whitespace and %s across safe UTF-16 pages", async (boundary) => {
        const h = fixture();
        const text = "\ufeff" + " ".repeat(SDK_TEXT_PAGE_CHARS - 2) + boundary + "tail\r\n";
        h.add("data.base", text);
        const first = value(await executeObsidianSdkMethod(h.host, "obsidian.vault.readText", { target: { path: "data.base" } }));
        expect(first.range.end).toBe(SDK_TEXT_PAGE_CHARS - 1);
        expect(first.coverage).toBe("partial");
        const tail = value(await executeObsidianSdkMethod(h.host, "obsidian.vault.readText", { target: { resourceRef: first.resourceRef }, cursor: first.nextCursor }));
        expect(first.text + tail.text).toBe(text);
        expect(tail.range.start).toBe(first.range.end);
        expect(tail.coverage).toBe("partial");
        expect(getReadSnapshot(h.host, first.sourceVersion, { path: "data.base" })?.before).toBe(text);
        expect(first.readRef).toBe(tail.readRef);
        expect(first.sourceVersion).toBe(tail.sourceVersion);
    });
    it("rejects cross-file cursors, changed bytes, and unknown non-UTF8 or NUL binary text", async () => {
        const h = fixture(), a = h.add("a.canvas", "a".repeat(SDK_TEXT_PAGE_CHARS + 1));
        h.add("b.txt", "b");
        const first = value(await executeObsidianSdkMethod(h.host, "obsidian.vault.readText", { target: { path: a.path } }));
        expect((await executeObsidianSdkMethod(h.host, "obsidian.vault.readText", { target: { path: "b.txt" }, cursor: first.nextCursor })).ok).toBe(false);
        h.replaceBody(a, "changed");
        expect((await executeObsidianSdkMethod(h.host, "obsidian.vault.readText", { target: { path: a.path }, cursor: first.nextCursor })).ok).toBe(false);
        for (const [path, bytes] of [["unknown.dat", new Uint8Array([0xff])], ["nul.txt", new Uint8Array([0])]] as const) {
            h.add(path, bytes);
            expect(await executeObsidianSdkMethod(h.host, "obsidian.vault.readText", { target: { path } })).toMatchObject({ ok: false, error: { code: "unsupported_encoding" } });
        }
        h.add("photo.png", new Uint8Array([97]));
        h.vault.readBinary.mockClear();
        expect((await executeObsidianSdkMethod(h.host, "obsidian.vault.readText", { target: { path: "photo.png" } })).ok).toBe(false);
        expect(h.vault.readBinary).not.toHaveBeenCalled();
    });
    it.each(["replace", "exclude", "change"])("rechecks actual object and permission after awaited native IO: %s", async (scenario) => {
        const h = fixture(), file = h.add("a.txt", "before");
        h.vault.readBinary.mockImplementationOnce(async () => {
            const previous = h.bodies.get(file)!.slice().buffer as ArrayBuffer;
            if (scenario === "replace") {
                h.files.delete(file.path);
                h.add(file.path, "replacement");
            }
            if (scenario === "exclude")
                h.denied.add(file.path);
            if (scenario === "change")
                h.replaceBody(file, "after");
            return previous;
        });
        const result = await executeObsidianSdkMethod({ ...h.host, guard: h.guard }, "obsidian.vault.readText", { target: { path: file.path } });
        expect(result.ok).toBe(false);
        expect(h.onReadAdmitted).toHaveBeenCalledWith(file.path);
    });
    it("returns explicit byte pages including empty bytes and refuses a changed binary continuation", async () => {
        const h = fixture();
        h.add("empty.bin", new Uint8Array());
        expect(value(await executeObsidianSdkMethod(h.host, "obsidian.vault.readBinary", { target: { path: "empty.bin" } }))).toMatchObject({ bytes: { __bytesBase64: "" }, length: 0, total: 0, coverage: "complete" });
        const bytes = new Uint8Array(SDK_BINARY_PAGE_BYTES + 3);
        bytes.set([0, 255, 128]);
        bytes.set([7, 8, 9], SDK_BINARY_PAGE_BYTES);
        const file = h.add("data.bin", bytes);
        const first = value(await executeObsidianSdkMethod(h.host, "obsidian.vault.readBinary", { target: { path: file.path } }));
        expect(Buffer.from(first.bytes.__bytesBase64, "base64").equals(Buffer.from(bytes.subarray(0, SDK_BINARY_PAGE_BYTES)))).toBe(true);
        const tail = value(await executeObsidianSdkMethod(h.host, "obsidian.vault.readBinary", { target: { resourceRef: first.resourceRef }, cursor: first.nextCursor }));
        expect([...Buffer.from(tail.bytes.__bytesBase64, "base64")]).toEqual([7, 8, 9]);
        expect(tail.coverage).toBe("partial");
        h.replaceBody(file, new Uint8Array([4]));
        expect((await executeObsidianSdkMethod(h.host, "obsidian.vault.readBinary", { target: { path: file.path }, cursor: first.nextCursor })).ok).toBe(false);
    });
    it("admits native read size before IO and never presents a clipped success", async () => {
        const h = fixture(), file = h.add("huge.txt", "small");
        file.stat!.size = 17 * 1024 * 1024;
        expect(await executeObsidianSdkMethod(h.host, "obsidian.vault.readText", { target: { path: file.path } })).toMatchObject({ ok: false, error: { code: "resource_limit" } });
        expect(h.vault.readBinary).not.toHaveBeenCalled();
    });
    it("distinguishes missing cache from non-Markdown and freezes cache DTOs", async () => {
        const h = fixture(), file = h.add("note.md", "# saved"), text = h.add("data.txt", "text");
        expect(value(await executeObsidianSdkMethod(h.host, "obsidian.metadata.inspect", { target: { path: file.path } })).source.cacheState).toBe("unknown");
        expect(value(await executeObsidianSdkMethod(h.host, "obsidian.metadata.inspect", { target: { path: text.path } })).source.cacheState).toBe("not_applicable");
        const heading = { heading: "cached", level: 1 };
        h.cached.set(file, { headings: [heading], frontmatter: { title: "property" } });
        const result = value(await executeObsidianSdkMethod(h.host, "obsidian.metadata.inspect", { target: { path: file.path }, fields: ["headings"] }));
        heading.heading = "mutated";
        expect(result.entries).toEqual([{ field: "headings", value: { heading: "cached", level: 1 } }]);
        expect(result.source).toMatchObject({ kind: "metadata-cache", sourceVersion: "unknown" });
        expect(h.vault.readBinary).not.toHaveBeenCalled();
    });
    it("consumes native resolved-link counter maps, filters before counter access, and registers every disclosed endpoint", async () => {
        const h = fixture(), source = h.add("source.md", "source"), target = h.add("target.md", "target");
        h.add("excluded.md", "private");
        h.cached.set(source, { links: [{ link: "[[target.md#Heading|Alias]]" }] });
        h.metadataCache.resolvedLinks = { "source.md": { "target.md": 2 } };
        Object.defineProperty(h.metadataCache.resolvedLinks, "excluded.md", { enumerable: true, get() { throw new Error("Excluded counters must not be inspected"); } });
        h.denied.add("excluded.md");
        const incoming = value(await executeObsidianSdkMethod(h.host, "obsidian.metadata.links", { target: { path: target.path }, direction: "incoming" }));
        expect(incoming.entries).toEqual([{ source: source.path, target: target.path, count: 2, state: "resolved" }]);
        h.onReadAdmitted.mockClear();
        const outgoing = value(await executeObsidianSdkMethod(h.host, "obsidian.metadata.links", { target: { path: source.path }, direction: "outgoing" }));
        expect(outgoing.entries[0]).toMatchObject({ target: target.path, subpath: "#Heading" });
        expect(h.onReadAdmitted).toHaveBeenCalledWith(target.path);
        h.onReadAdmitted.mockClear();
        const resolved = value(await executeObsidianSdkMethod(h.host, "obsidian.metadata.resolveLink", { source: { path: source.path }, link: "[[target.md#Heading|Alias]]" }));
        expect(resolved).toMatchObject({ alias: "Alias", subpath: "#Heading", target: { path: target.path } });
        expect(h.onReadAdmitted).toHaveBeenCalledWith(target.path);
        const lineage = completeInputLineage(h.onReadAdmitted.mock.calls.map(([path]) => ({ kind: "vault" as const, via: "note" as const, path, resourceRef: resolveObsidianResource(h.host, { path })!.resourceRef })));
        expect(h.sourceRun.admitsLineage(lineage, true)).toBe(true);
        h.denied.add(target.path);
        expect(h.sourceRun.admitsLineage(lineage, true)).toBe(false);
        h.onReadAdmitted.mockClear();
        const restricted = await executeObsidianSdkMethod(h.host, "obsidian.metadata.resolveLink", { source: { path: source.path }, link: "target.md" });
        expect(restricted).toMatchObject({ ok: false, value: { state: "restricted" } });
        expect(JSON.stringify(restricted)).not.toContain('"target":');
        expect(h.onReadAdmitted).not.toHaveBeenCalledWith(target.path);
    });
    it("returns incoming links to attachments without claiming they have Markdown cache", async () => {
        const h = fixture(), source = h.add("source.md", "![[image.png]]"), target = h.add("image.png", new Uint8Array([1]));
        h.metadataCache.resolvedLinks = { [source.path]: { [target.path]: 1 } };
        const incoming = value(await executeObsidianSdkMethod(h.host, "obsidian.metadata.links", { target: { path: target.path }, direction: "incoming" }));
        expect(incoming.entries).toEqual([{ source: source.path, target: target.path, count: 1, state: "resolved" }]);
        expect(incoming.source).toMatchObject({ cacheState: "available", direction: "incoming" });
        expect(h.onReadAdmitted).toHaveBeenCalledWith(source.path);
        expect(h.onReadAdmitted).toHaveBeenCalledWith(target.path);
        const outgoing = value(await executeObsidianSdkMethod(h.host, "obsidian.metadata.links", { target: { path: target.path }, direction: "outgoing" }));
        expect(outgoing.source.cacheState).toBe("not_applicable");
        expect(h.metadataCache.getFileCache).not.toHaveBeenCalled();
    });
    it("enumerates an active second leaf and keeps exact editor context bound to its original pane", async () => {
        const h = fixture(), file = h.add("note.md", "SAVED\r\n");
        h.pane(undefined, undefined, "pa-agent-debug-view");
        const first = editorFixture("  \n😀 buffer \n", 3, 5), a = h.pane(file, first.editor);
        const context = value(await executeObsidianSdkMethod(h.host, "obsidian.workspace.getContext", {}));
        expect(context.text).toBe(first.value());
        expect(context.selection).toEqual({ from: 3, to: 5 });
        expect(context.source).toBe("editor-buffer");
        const second = editorFixture("different pane"), b = h.pane(file, second.editor);
        const other = value(await executeObsidianSdkMethod(h.host, "obsidian.workspace.getContext", {}));
        expect(other.text).toBe(second.value());
        expect(other.viewId).not.toBe(context.viewId);
        expect(resolveWorkspaceSnapshot(h.host, other.snapshotId)?.editor).toBe(second.editor);
        expect(resolveWorkspaceSnapshot(h.host, context.snapshotId)?.editor).toBe(first.editor);
        const original = value(await executeObsidianSdkMethod(h.host, "obsidian.workspace.getContext", { viewId: context.viewId, includeText: false }));
        expect(original.text).toBeUndefined();
        expect(original.snapshotId).toBeDefined();
        expect(original.selection).toEqual(context.selection);
        expect(h.vault.readBinary).not.toHaveBeenCalled();
        h.close(a);
        expect(resolveWorkspaceSnapshot(h.host, context.snapshotId)).toBeUndefined();
        expect(await executeObsidianSdkMethod(h.host, "obsidian.workspace.getContext", { viewId: context.viewId }))
            .toMatchObject({ ok: false, error: { code: "view_unavailable" } });
        h.activate(b);
        second.setBuffer("user edited");
        expect(resolveWorkspaceSnapshot(h.host, other.snapshotId)).toBeUndefined();
        expect(first.transaction).not.toHaveBeenCalled();
        expect(second.transaction).not.toHaveBeenCalled();
    });
    it.each(["view", "editor", "file", "replacement", "permission"])("rejects original workspace binding drift: %s", scenario => {
        const h = fixture(), file = h.add("a.md", "disk"), original = editorFixture("exact\n");
        const leaf = h.pane(file, original.editor), binding = captureWorkspaceSnapshot(h.host)!;
        if (scenario === "view")
            leaf.view = { ...leaf.view };
        if (scenario === "editor")
            leaf.view.editor = editorFixture("exact\n").editor;
        if (scenario === "file")
            leaf.view.file = h.add("b.md", "disk");
        if (scenario === "replacement") {
            h.files.delete(file.path);
            h.add(file.path, "disk");
        }
        if (scenario === "permission")
            h.denied.add(file.path);
        expect(resolveWorkspaceSnapshot(h.host, binding.snapshotId)).toBeUndefined();
        expect(original.transaction).not.toHaveBeenCalled();
    });
    it("continues a fixed editor snapshot, marks noneditor views, and rejects later buffer changes", async () => {
        const h = fixture(), file = h.add("a.md", "disk"), editor = editorFixture("a".repeat(SDK_TEXT_PAGE_CHARS + 2));
        h.pane(file, editor.editor);
        const first = value(await executeObsidianSdkMethod(h.host, "obsidian.workspace.getContext", {}));
        h.pane(h.add("b.md", "b"), editorFixture("other").editor);
        const tail = value(await executeObsidianSdkMethod(h.host, "obsidian.workspace.getContext", { cursor: first.nextCursor }));
        expect(tail.text).toBe("aa");
        expect(tail.viewId).toBe(first.viewId);
        expect(tail.coverage).toBe("partial");
        editor.setBuffer("later user input");
        expect((await executeObsidianSdkMethod(h.host, "obsidian.workspace.getContext", { cursor: first.nextCursor })).ok).toBe(false);
        h.pane(undefined, undefined, "canvas");
        expect(value(await executeObsidianSdkMethod(h.host, "obsidian.workspace.getContext", {})).editor).toEqual({ applicable: false });
    });
    it("returns the live resource of a noneditor file view and retains its source and object checks", async () => {
        const h = fixture(), file = h.add("document.pdf", new Uint8Array([1]));
        h.pane(file, undefined, "pdf");
        const context = value(await executeObsidianSdkMethod(h.host, "obsidian.workspace.getContext", {}));
        expect(context).toMatchObject({ viewType: "pdf", editor: { applicable: false },
            file: { path: file.path, resourceRef: context.resourceRef } });
        expect(resolveObsidianResource(h.host, { resourceRef: context.resourceRef })?.file).toBe(file);
        expect(h.onReadAdmitted).toHaveBeenCalledWith(file.path);
        expect(context.text).toBeUndefined();
        expect(context.snapshotId).toBeUndefined();
        expect(h.vault.readBinary).not.toHaveBeenCalled();
        h.onReadAdmitted.mockClear();
        h.denied.add(file.path);
        expect(await executeObsidianSdkMethod(h.host, "obsidian.workspace.getContext", { viewId: context.viewId }))
            .toMatchObject({ ok: false, error: { code: "source_excluded" } });
        expect(h.onReadAdmitted).not.toHaveBeenCalled();
        h.denied.clear();
        h.files.delete(file.path);
        h.add(file.path, new Uint8Array([1]));
        expect(await executeObsidianSdkMethod(h.host, "obsidian.workspace.getContext", { viewId: context.viewId }))
            .toMatchObject({ ok: false, error: { code: "stale_target" } });
    });
    it("uses one native UTF-16 transaction, refuses overlap/surrogate/CRLF splits, and permits checked inverse transactions", () => {
        const h = fixture(), file = h.add("a.md", "disk"), editor = editorFixture("A😀\r\nZ");
        h.pane(file, editor.editor);
        const binding = captureWorkspaceSnapshot(h.host)!;
        for (const edits of [[{ from: 2, to: 2, text: "bad" }], [{ from: 4, to: 4, text: "bad" }], [{ from: 0, to: 3, text: "x" }, { from: 1, to: 3, text: "y" }]])
            expect(() => binding.transact(edits)).toThrow();
        expect(editor.transaction).not.toHaveBeenCalled();
        binding.transact([{ from: 1, to: 3, text: "B" }, { from: 5, to: 6, text: "C" }]);
        expect(editor.transaction).toHaveBeenCalledTimes(1);
        expect(editor.value()).toBe("AB\r\nC");
        expect(resolveWorkspaceSnapshot(h.host, binding.snapshotId)).toBeUndefined();
        // The original Operations receipt checks expectedAfter before Undo; this
        // port performs only its original native editor transaction.
        binding.transact([{ from: 0, to: editor.value().length, text: binding.before }]);
        expect(editor.value()).toBe(binding.before);
        expect(editor.transaction).toHaveBeenCalledTimes(2);
    });
    it("reports observed open and position facts, including partial effects and ambiguous native errors", async () => {
        const h = fixture(), file = h.add("a.md", "disk"), editor = editorFixture("😀 line\nnext");
        const leaf = h.pane(undefined, editor.editor);
        const opened = value(await nativeOpenObsidianResource(h.host, { path: file.path }, { line: 1, ch: 2 }));
        expect(opened).toMatchObject({ opened: true, viewType: "markdown", position: { applied: true, actual: { line: 1, ch: 2 } } });
        expect(await nativeOpenObsidianResource(h.host, { path: file.path }, { line: 0, ch: 1 })).toMatchObject({ ok: false, value: { opened: true }, error: { executionState: "partially_succeeded" } });
        leaf.openFile.mockImplementationOnce(async (target: SdkResource) => { leaf.view.file = target; throw new Error("after native open"); });
        expect(await nativeOpenObsidianResource(h.host, { path: file.path })).toMatchObject({ ok: false, value: { opened: true }, error: { executionState: "partially_succeeded" } });
        leaf.view.file = undefined;
        leaf.openFile.mockRejectedValueOnce(new Error("native outcome unavailable"));
        expect(await nativeOpenObsidianResource(h.host, { path: file.path })).toMatchObject({ ok: false, error: { executionState: "acceptance_unknown" } });
        leaf.openFile.mockClear();
        expect((await executeObsidianSdkMethod(h.host, "obsidian.workspace.open", { target: { path: file.path } })).ok).toBe(false);
        expect(leaf.openFile).not.toHaveBeenCalled();
    });
    it.each(["late-error", "revoked"])("retains unapplied requested position after proven native open: %s", async scenario => {
        const h = fixture(), file = h.add("a.md", "disk"), editor = editorFixture("text");
        const leaf = h.pane(undefined, editor.editor);
        leaf.openFile.mockImplementationOnce(async (target: SdkResource) => {
            leaf.view.file = target;
            if (scenario === "late-error") throw new Error("native open rejected after the view opened");
            h.denied.add(target.path);
        });
        const position = { line: 0, ch: 2 };
        expect(await nativeOpenObsidianResource(h.host, { path: file.path }, position)).toMatchObject({
            ok: false, value: { opened: true, position: { requested: position, applied: false } },
            error: { executionState: "partially_succeeded" },
        });
        expect(editor.setCursor).not.toHaveBeenCalled();
    });
    it("builds precise original source guards for nested mkdir and whole-tree moves including future attachment paths", () => {
        const h = fixture();
        h.add("folder");
        h.add("folder/nested");
        h.add("folder/nested/image.png", new Uint8Array([1]));
        const mkdirInput = { path: "future/child/grandchild", parents: true };
        const moveInput = { mode: "apply", source: { path: "folder" }, to: "destination" };
        const calls = [
            { id: "mkdir", type: "toolCall" as const, index: 0, name: "vault_create_folder", input: mkdirInput },
            { id: "move", type: "toolCall" as const, index: 1, name: "obsidian.vault.move", input: moveInput },
            { id: "trash", type: "toolCall" as const, index: 2, name: "vault_trash", input: { target: { path: "folder/nested/image.png" } } },
        ];
        const plan = h.sourceRun.resolveReadPlansWithReason(calls, h.host);
        expect(plan.ok).toBe(true);
        if (!plan.ok)
            throw new Error(plan.reason);
        expect(plan.plans.get("mkdir")!.outputTargetPaths).toEqual(["future", "future/child", "future/child/grandchild"]);
        expect(plan.plans.get("move")!.outputTargetPaths).toEqual(["destination", "destination/nested", "destination/nested/image.png"]);
        expect(plan.plans.get("trash")!.reads).toEqual([{ kind: "note", noteId: h.sourceRun.resolveNoteId("folder/nested/image.png") }]);
        const executor = createTaskSourceConstrainedExecutor({
            baseExecutor: { execute: jest.fn() }, state: h.sourceRun.state, resolveHostNoteId: h.sourceRun.resolveNoteId,
            isHostCurrent: h.sourceRun.isCurrent,
            resolveReadPlans: batch => { const result = h.sourceRun.resolveReadPlansWithReason(batch, h.host); return result.ok ? result.plans : undefined; },
        });
        const admission = executor.preflightBatch!({ runId: "run", turnId: "turn", turnIndex: 0, userInput: "request", toolCalls: calls });
        expect(admission).toMatchObject({ kind: "admitted" });
        if (!admission || !("kind" in admission))
            throw new Error("Expected real original admission");
        for (const path of [...plan.plans.get("mkdir")!.outputTargetPaths!, ...plan.plans.get("move")!.outputTargetPaths!])
            expect(admission.taskSourceReadGuard!.isPathAllowed(path, "output_target_exists")).toBe(true);
        expect(admission.taskSourceReadGuard!.isPathAllowed("unrelated/new", "output_target_exists")).toBe(false);
        h.denied.add("destination/nested/image.png");
        expect(resolveObsidianSdkReadPlan(h.host, "obsidian.vault.move", moveInput)).toBeUndefined();
        h.denied.clear();
        h.denied.add("folder/nested/image.png");
        expect(resolveObsidianSdkReadPlan(h.host, "obsidian.vault.move", moveInput)).toBeUndefined();
        h.denied.clear();
        h.denied.add("future/child");
        expect(resolveObsidianSdkReadPlan(h.host, "vault_create_folder", mkdirInput)).toBeUndefined();
        expect(resolveObsidianSdkReadPlan(h.host, "obsidian.operations.undo", { receiptId: "unknown" })).toBeUndefined();
        expect(resolveObsidianSdkReadPlan({ ...h.host, operationsSession: { getUndoTargetPaths: () => ["restored/path.txt"] } }, "obsidian.operations.undo", { receiptId: "real" })?.outputTargetPaths).toEqual(["restored/path.txt"]);
    });
    it("retains accepted aggregate configuration and exact original resource ancestry across graph edits and moves", async () => {
        const h = fixture(), file = h.add("asset.txt", "data");
        const aggregate = h.sourceRun.captureRunNotesObservationLineage("vault", "E0");
        h.sourceRun.acceptExecutionLineage(aggregate);
        h.setGraphEpoch("E1");
        expect(h.sourceRun.admitsLineage(aggregate, true)).toBe(true);
        h.setConfigurationEpoch("C1");
        h.sourceRun.acceptExecutionLineage(aggregate);
        expect(h.sourceRun.admitsLineage(aggregate, true)).toBe(false);
        const resourceRef = resolveObsidianResource(h.host, { path: file.path })!.resourceRef;
        const lineage = completeInputLineage([{ kind: "vault", path: file.path, via: "note", resourceRef }]);
        const proof = await h.sourceRun.prepareLineageAdmission(lineage);
        h.move(file, "moved.txt");
        expect(h.sourceRun.admitsLineage(lineage, true)).toBe(true);
        expect(proof.sourceValidity()).toBe(true);
        h.setCurrent(false);
        expect(proof.sourceValidity()).toBe(true);
        h.denied.add(file.path);
        expect(proof.sourceValidity()).toBe(false);
        h.denied.clear();
        h.files.delete(file.path);
        h.add(file.path, "new object");
        expect(proof.sourceValidity()).toBe(false);
    });
    it("revokes an original action authority guard on configuration changes while preserving admitted graph self-writes", async () => {
        const h = fixture();
        const aggregate = h.sourceRun.captureRunNotesObservationLineage("vault", "E0");
        const call = { type: "toolCall" as const, id: "status", index: 0, name: "obsidian.operations.getStatus", input: { intentId: "intent" } };
        const executor = createTaskSourceConstrainedExecutor({ baseExecutor: { execute: jest.fn() }, state: h.sourceRun.state,
            resolveHostNoteId: h.sourceRun.resolveNoteId, isHostCurrent: h.sourceRun.isCurrent,
            prepareInputSourceAdmission: async (_calls, signal, lineage) => h.sourceRun.prepareLineageAdmission(lineage, signal),
            resolveReadPlans: calls => { const result = h.sourceRun.resolveReadPlansWithReason(calls, h.host); return result.ok ? result.plans : undefined; },
        });
        const admitted = executor.preflightBatch!({ runId: "run", turnId: "turn", turnIndex: 0, userInput: "request", toolCalls: [call], inputLineage: aggregate });
        if (!admitted || !("kind" in admitted) || !admitted.taskSourceReadGuard) throw new Error("Expected original source guard");
        await admitted.taskSourceReadGuard.checkpoint!();
        h.sourceRun.acceptExecutionLineage(aggregate);
        const authority = admitted.taskSourceReadGuard.captureAuthorityGuard!();
        h.setGraphEpoch("E1");
        expect(authority.isCurrent()).toBe(true);
        h.setConfigurationEpoch("C1");
        expect(authority.isCurrent()).toBe(false);
    });
    it("checks sealed configuration before raw graph equality without changing unsealed observer semantics", async () => {
        const h = fixture();
        const aggregate = h.sourceRun.captureRunNotesObservationLineage("vault", "E0");
        h.sourceRun.acceptExecutionLineage(aggregate);
        const proof = await h.sourceRun.prepareLineageAdmission(aggregate);
        const sourceValidity = h.sourceRun.captureLineageSourceValidity(aggregate);
        h.setConfigurationEpoch("C1");
        expect(h.sourceRun.admitsLineage(aggregate, true)).toBe(false);
        expect(proof.sourceValidity()).toBe(false);
        expect(sourceValidity()).toBe(false);
        await expect(h.sourceRun.prepareLineageAdmission(aggregate)).rejects.toThrow("ancestry");
        const observer = fixture();
        const current = observer.sourceRun.captureRunNotesObservationLineage("vault", "E0");
        observer.setConfigurationEpoch("C1");
        expect(observer.sourceRun.admitsLineage(current, true)).toBe(true);
    });
    it.each(["notes", "legacy"] as const)("projects original SDK sources after native moves without rebinding historical paths: %s", async scope => {
        const h = fixture(scope), file = h.add("original.txt", "original read");
        const read = value(await executeObsidianSdkMethod(h.host, "obsidian.vault.readText", { target: { path: file.path } }));
        const record: SourceRecord = { kind: "context-used", sourceBoundary: "vault", path: file.path, resourceRef: read.resourceRef, dedupKey: "original-source" };
        const lineage = completeInputLineage([{ kind: "vault", path: file.path, resourceRef: read.resourceRef, via: "note" }]);
        const tool: Extract<PaAgentMessage, { role: "toolResult" }> = { role: "toolResult", id: "result", timestamp: 1, isError: false, toolName: "obsidian.vault.readText", toolCallId: "read",
            inputLineage: lineage, content: { promptText: "original read", includeInNextPrompt: true, sourceRecords: [record] } };
        const history: ChatMessage = { role: "assistant", content: "original read", inputLineage: lineage,
            memoryMetadata: { hasMemoryContent: false, allowedMemorySourcePaths: [], sourceRecords: [record], inputLineage: lineage } };
        const persistence = h.sourceRun.capturePersistenceSourceValidity([tool], [history]);
        h.move(file, "moved.txt");
        h.add("original.txt", "unrelated replacement");
        h.denied.add("original.txt");
        expect(h.sourceRun.projectTranscript([tool])).toEqual([tool]);
        expect(await h.sourceRun.projectTranscriptAsync([tool])).toEqual([tool]);
        expect(h.sourceRun.projectHistory([history])).toEqual([history]);
        expect(await h.sourceRun.projectHistoryAsync([history])).toEqual([history]);
        expect(() => persistence()).not.toThrow();
        const snapshot = await h.sourceRun.prepareGenerationSnapshot([tool], [history], async (messages) => [...messages]);
        expect(snapshot.transcript).toEqual([tool]);
        expect(await snapshot.allowsLineage(lineage)).toBe(true);
        expect(tool.content.sourceRecords![0].path).toBe("original.txt");
        expect(h.sourceRun.captureGenerationInputTaskSources([tool], [history]).sources[0].path).toBe("original.txt");
        h.denied.add("moved.txt");
        expect(JSON.stringify(h.sourceRun.projectTranscript([tool]))).not.toContain("original read");
        expect(h.sourceRun.projectHistory([history])).toEqual([]);
        expect(() => persistence()).toThrow();
        h.denied.clear();
        h.files.delete("moved.txt");
        h.add("moved.txt", "rebuild at new path");
        expect(h.sourceRun.admitsLineage(lineage, true)).toBe(false);
        expect(JSON.stringify(h.sourceRun.projectTranscript([tool]))).not.toContain("original read");
        expect(() => persistence()).toThrow();
    });
    it("runs mkdir → native directory move → SDK ref read → replace through original controller and real source guards", async () => {
        const h = fixture();
        h.add("source");
        const file = h.add("source/data.txt", "before");
        h.add("source/image.png", new Uint8Array([0, 255]));
        let sequence = 0;
        const vault = {
            ...h.vault,
            read: async (target: SdkResource) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(h.bodies.get(target)),
            cachedRead: async (target: SdkResource) => new TextDecoder().decode(h.bodies.get(target)),
            createFolder: async (path: string) => h.add(path),
            create: async (path: string, text: string) => h.add(path, text),
            process: async (target: SdkResource, change: (before: string) => string) => {
                const after = change(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(h.bodies.get(target)));
                h.replaceBody(target, after);
                return after;
            },
            adapter: { exists: async (path: string) => h.files.has(path) },
        };
        const controller = new OperationsIntentController({ vault: vault as unknown as OperationsVault, trashFile: async () => { },
            renameFile: async (target, path) => h.move(target as SdkResource, path),
            isPathAllowed: path => !h.denied.has(path), markSelfWrite: () => h.setGraphEpoch(`E${++sequence}`), createId: () => `op-${++sequence}` });
        const context: OperationsResourceContext = {
            resolveTarget: (target, guard, signal) => resolveObsidianResource({ ...h.host, guard, signal }, target),
            getReadSnapshot: (version, target, guard, signal) => getReadSnapshot({ ...h.host, guard, signal }, version, target),
            resolveWorkspaceSnapshot: (id, guard, signal) => resolveWorkspaceSnapshot({ ...h.host, guard, signal }, id),
            openResource: (target, position, guard, signal) => nativeOpenObsidianResource({ ...h.host, guard, signal }, target, position),
        };
        const host = { ...h.host, operationsSession: controller };
        const originalRef = resolveObsidianResource(host, { path: file.path })!.resourceRef;
        const historicalSource = completeInputLineage([{ kind: "vault", path: file.path, resourceRef: originalRef, via: "note" }]);
        const originalAggregate = h.sourceRun.captureRunNotesObservationLineage("vault", "E0");
        h.sourceRun.acceptExecutionLineage(originalAggregate);
        const executor = createTaskSourceConstrainedExecutor({ baseExecutor: { execute: jest.fn() }, state: h.sourceRun.state,
            resolveHostNoteId: h.sourceRun.resolveNoteId, isHostCurrent: h.sourceRun.isCurrent,
            isInputCurrent: () => h.sourceRun.admitsLineage(historicalSource, true) && h.sourceRun.admitsLineage(originalAggregate, true),
            prepareInputSourceAdmission: async (_calls, signal, lineage) => h.sourceRun.prepareLineageAdmission(lineage, signal),
            resolveReadPlans: calls => { const plans = h.sourceRun.resolveReadPlansWithReason(calls, host); return plans.ok ? plans.plans : undefined; },
        });
        const admission = async (name: string, input: Record<string, unknown>) => {
            const call = { type: "toolCall" as const, id: `call-${++sequence}`, index: 0, name, input };
            const signal = new AbortController().signal;
            const admitted = executor.preflightBatch!({ runId: "run", turnId: "turn", turnIndex: 0, userInput: "request", inputLineage: historicalSource, toolCalls: [call] });
            expect(admitted).toMatchObject({ kind: "admitted" });
            if (!admitted || !("kind" in admitted) || !admitted.taskSourceReadGuard)
                throw new Error("Expected original source guard");
            const guard = admitted.taskSourceReadGuard;
            await guard.checkpoint!(signal);
            return { call, signal, guard };
        };
        const apply = async (name: ResourceOperationToolName, input: Record<string, unknown>) => {
            const { call, signal, guard } = await admission(name, input);
            const intent = await controller.stageIntent({ runId: "run", turnId: call.id, mode: "apply", taskSourceReadGuard: guard, resourceContext: context,
                operations: [{ name, input, toolCallId: call.id }] }, signal);
            const authority = guard.captureAuthorityGuard!();
            const result = await controller.executeIntent(intent.id, undefined, { guard: authority, signal });
            expect(result.operations[0].status).toBe("succeeded");
        };
        try {
            await apply("vault_create_folder", { mode: "apply", path: "future/child", parents: true });
            expect(h.files.has("future/child")).toBe(true);
            await apply("obsidian.vault.move", { mode: "apply", source: { path: "source" }, to: "future/child/moved" });
            expect(h.files.get("future/child/moved/image.png")!.path).toBe("future/child/moved/image.png");
            expect(h.sourceRun.admitsLineage(historicalSource, true)).toBe(true);
            const readInput = { target: { resourceRef: originalRef } };
            const { signal, guard } = await admission("obsidian.vault.readText", readInput);
            const read = value(await executeObsidianSdkMethod({ ...host, guard, signal }, "obsidian.vault.readText", readInput));
            expect(read.path).toBe("future/child/moved/data.txt");
            expect(read.text).toBe("before");
            await apply("obsidian.vault.replaceText", { mode: "apply", target: { resourceRef: originalRef }, expectedVersion: read.sourceVersion, text: "after" });
            expect(new TextDecoder().decode(h.bodies.get(file))).toBe("after");
            expect(h.sourceRun.admitsLineage(originalAggregate, true)).toBe(true);
            h.denied.add(file.path);
            expect(resolveObsidianSdkReadPlan(host, "obsidian.vault.replaceText", { target: { resourceRef: originalRef }, expectedVersion: read.sourceVersion, text: "forbidden" })).toBeUndefined();
        }
        finally {
            controller.dispose();
        }
    });
});

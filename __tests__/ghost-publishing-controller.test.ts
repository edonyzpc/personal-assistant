import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { App } from "obsidian";
import { GhostPublishingController, type GhostActionAuthority, type GhostControllerRequest, type GhostPublishingSession, type GhostCardState } from "../src/ghost-publishing/controller";
import { renderGhostPublishingCard } from "../src/ghost-publishing/card";
import type { GhostActionContextOptions } from "../src/ghost-publishing/action-context";
import type { GhostActionContext } from "../src/ghost-publishing/service";
import type { GhostLocalOperation } from "../src/ghost-publishing/state-schema";
import type { GhostPublishingConfiguration } from "../src/ghost-publishing/configuration";
import { DomStubNode } from "./helpers/dom-stub";
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, unlinkSync, symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let mockOperations: GhostLocalOperation[] = [];
const mockList = jest.fn(async () => mockOperations);
const mockClose = jest.fn();
const mockRecordRead = jest.fn<NonNullable<GhostActionContextOptions["readCompletedRecord"]>>(async () => null);
const mockService = {
    prepare: jest.fn<(...args: any[]) => Promise<GhostLocalOperation>>(),
    reprepare: jest.fn<(...args: any[]) => Promise<GhostLocalOperation>>(),
    refresh: jest.fn<(...args: any[]) => Promise<GhostLocalOperation>>(),
    checkPreview: jest.fn<(...args: any[]) => Promise<unknown>>(),
    confirm: jest.fn<(...args: any[]) => Promise<GhostLocalOperation>>(),
    invalidate: jest.fn(),
};
const mockCreateContext = jest.fn<(options: GhostActionContextOptions) => Promise<any>>();
const mockReadPost = jest.fn(async (_id: string) => ({ uuid: "11111111-1111-1111-1111-111111111111" }));
const mockServiceConstructor = jest.fn();
let mockPreviewStatus: "passed" | "failed" | "unavailable" = "passed";
jest.mock("../src/ghost-publishing/action-context", () => ({ createGhostActionContext: (options: GhostActionContextOptions) => mockCreateContext(options) }));
jest.mock("../src/ghost-publishing/service", () => ({ GhostPublishingService: function () { mockServiceConstructor(); return mockService; } }));
jest.mock("../src/ghost-publishing/client", () => ({ GhostClient: function () { return { readPost: mockReadPost }; } }));
jest.mock("../src/ghost-publishing/state-store", () => ({
    GhostOperationStore: function () { return { list: mockList, close: mockClose }; },
    GhostCompletedRecordStore: function () { return { read: mockRecordRead }; }, ghostDatabaseName: () => "synthetic-database",
}));
jest.mock("../src/ghost-publishing/preview", () => {
    const actual = jest.requireActual("../src/ghost-publishing/preview") as Record<string, unknown>;
    return { ...actual, GhostNativePreviewAdapter: function () {
        let status = "unavailable";
        return {
            getDiagnostics: () => ({ status, reason: status === "unavailable" ? "enable-web-viewer" : undefined, issues: [], unsupportedCodeCount: 0 }),
            invalidate: () => { status = "invalidated"; }, dispose: () => { status = "invalidated"; },
            check: async (target: { candidateHash: string }, gate: { beforeSend(): Promise<void>; assertCurrent(): void }) => {
                await gate.beforeSend(); gate.assertCurrent();
                status = mockPreviewStatus;
                return { passed: status === "passed", candidateHash: target.candidateHash, isCurrent: () => status === "passed" };
            },
            systemBrowserUrl: (url: string) => url,
        };
    } };
});

const controllers: GhostPublishingController[] = [];
const POST = "a".repeat(24);
function op(kind: "create" | "update" | "restore" = "update", state = "prepared"): GhostLocalOperation {
    return { operationId: "op-one", noteUid: "note-one", siteId: "site-a", site: "https://ghost.example/", kind, state, revision: 1,
        target: { postId: POST, postStatus: kind === "create" ? "draft" : "published", previewId: "b".repeat(24) },
        candidate: { content: { lexical: JSON.stringify({ root: { children: [] } }), feature_image: null },
            recipe: { version: "b153-v1", contentHash: "12345678", prismLanguages: [], needsKatex: false }, resources: [] },
    } as unknown as GhostLocalOperation;
}
function authority() {
    const state = { allowed: true };
    const value: GhostActionAuthority = {
        guard: { isCurrent: () => state.allowed, isPathAllowed: () => state.allowed, isNoteDomainAllowed: () => true, isWebAllowed: () => true },
        sourceValidity: () => state.allowed,
    };
    return { state, value };
}
function fixture(vaultPath = "/synthetic/vault") {
    const state = { identity: "config-one", contentAllowed: true, desktop: true };
    const initial = authority();
    const fresh: ReturnType<typeof authority>[] = [];
    const contexts: GhostActionContext[] = [];
    const contextOptions: GhostActionContextOptions[] = [];
    mockCreateContext.mockImplementation(async (options) => {
        contextOptions.push(options);
        const identity = options.getConnectionIdentity();
        const assertCurrent = () => {
            if (!options.guard.isCurrent() || !options.sourceValidity() || !options.guard.isPathAllowed("Note.md")) throw Object.assign(new Error("revoked"), { code: "source-revoked" });
            if (identity !== options.getConnectionIdentity()) throw Object.assign(new Error("changed"), { code: "connection-changed" });
        };
        assertCurrent();
        const context = { gate: { assertCurrent, beforeSend: async () => assertCurrent() }, validate: jest.fn(async () => assertCurrent()) } as unknown as GhostActionContext;
        contexts.push(context);
        return { context, noteUid: "note-one", postId: POST, selection: { path: "Note.md", noteUid: "note-one" } };
    });
    const configuration = { getIdentity: () => state.identity, connection: async () => ({ siteId: "site-a", siteUrl: "https://ghost.example/",
        identity: state.identity, profile: { siteId: "site-a" }, defaultVisibility: "public" }) } as unknown as GhostPublishingConfiguration;
    const openExternal = jest.fn<(url: string) => void>();
    const app = { vault: { getName: () => "test", read: async () => "PRIVATE_SOURCE secret-token https://private.example/" },
        metadataCache: {}, fileManager: {}, workspace: {} } as unknown as App;
    const controller = new GhostPublishingController({ app, configuration, vaultPath, pluginId: "pa",
        isDesktop: () => state.desktop, isCurrent: () => true, isWebViewerEnabled: () => true,
        getSourceRevision: () => 1, isPathAllowed: () => true, isContentAllowed: () => state.contentAllowed, openExternal });
    controllers.push(controller);
    let session!: GhostPublishingSession;
    const request: GhostControllerRequest = { path: "Note.md", intent: "prepare", authority: initial.value,
        createActionAuthority: jest.fn(() => { const next = authority(); fresh.push(next); return next.value; }),
        onSession: (value: GhostPublishingSession) => { session = value; } };
    return { controller, state, request, initial, fresh, contexts, contextOptions, openExternal, session: () => session };
}
beforeEach(() => {
    mockOperations = [];
    mockPreviewStatus = "passed";
    mockList.mockImplementation(async () => mockOperations);
    mockCreateContext.mockReset();
    for (const value of [mockService.prepare, mockService.reprepare, mockService.refresh, mockService.checkPreview, mockService.confirm]) value.mockReset();
    mockService.prepare.mockImplementation(async () => { const value = op(); mockOperations = [value]; return value; });
    mockService.reprepare.mockImplementation(async () => mockOperations[0]);
    mockService.refresh.mockImplementation(async () => mockOperations[0]);
    mockService.checkPreview.mockImplementation(async (_uid, _id, _context, probe) => {
        const receipt = await probe(mockOperations[0], "hash-one");
        if (!receipt.passed) throw Object.assign(new Error("failed"), { code: "preview-required" });
        mockOperations[0] = { ...mockOperations[0], state: "ready" };
        return { operationId: "op-one", nonce: "nonce-one", candidateHash: "hash-one" };
    });
    mockService.confirm.mockImplementation(async (_uid, _ticket, context) => { context.gate.assertCurrent(); return { ...mockOperations[0], state: "terminal", verified: { status: "published" } } as GhostLocalOperation; });
});
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose(); });

describe("Ghost controller and human action card", () => {
    it("shows an existing operation without POST replay, then captures fresh button authority and reuses the site service", async () => {
        mockOperations = [op()];
        const f = fixture();
        const result = await f.controller.prepare(f.request);
        expect(result).toEqual({ status: "prepared", operationId: "op-one" });
        expect(f.session().getState().actions).toEqual(["continue", "reprepare"]);
        expect(mockService.prepare).not.toHaveBeenCalled();
        await f.session().run("continue");
        expect(f.request.createActionAuthority).toHaveBeenCalledTimes(1);
        expect(mockService.refresh.mock.calls[0][2]).toBe(f.contexts[1]);
        await f.controller.prepare(f.request);
        expect(mockServiceConstructor).toHaveBeenCalledTimes(1);
    });

    it("keeps a verified restore terminal without reviving a consumed undo or deleted preview action", async () => {
        mockOperations = [];
        mockRecordRead.mockResolvedValueOnce({ lastUndo: {} } as never);
        mockService.prepare.mockImplementation(async () => {
            mockOperations = [{ ...op("restore", "terminal"), verified: { status: "published" } } as GhostLocalOperation];
            return mockOperations[0];
        });
        mockService.checkPreview.mockResolvedValue({ operationId: "op-one", nonce: "nonce-one", candidateHash: "hash-one" });
        const f = fixture();
        await f.controller.prepare(f.request);
        expect(f.session().getState()).toMatchObject({ status: "completed-restore", busy: false });
        expect(f.session().getState().actions).toEqual(["open-editor"]);
        for (const action of ["reprepare", "check-preview", "confirm", "restore"] as const) {
            expect(f.session().getState().actions).not.toContain(action);
        }
    });

    it("never confirms first-draft publication and keeps successful cleanup-pending results successful", async () => {
        mockService.prepare.mockImplementation(async () => { const value = op("create"); mockOperations = [value]; return value; });
        const f = fixture();
        await f.controller.prepare(f.request);
        expect(mockService.checkPreview).toHaveBeenCalledTimes(1);
        expect(f.session().getState().status).toBe("awaiting-publish");
        expect(f.session().getState().actions).not.toContain("confirm");
        expect(f.session().getState().actions).toContain("check-published");
        await f.session().run("open-editor");
        expect(f.openExternal).toHaveBeenCalledWith(`https://ghost.example/ghost/#/editor/post/${"b".repeat(24)}`);
        expect(f.session().getState().status).toBe("awaiting-publish");
        expect(f.session().getState().actions).toContain("check-published");
        await f.session().run("confirm");
        expect(mockService.confirm).not.toHaveBeenCalled();
        mockService.refresh.mockResolvedValue({ ...op("create", "cleanup_pending"), verified: { status: "published" } } as GhostLocalOperation);
        await f.session().run("check-published");
        expect(f.session().getState()).toMatchObject({ status: "cleanup-pending", errorKey: undefined });
    });

    it("opens a checked preview in the system browser without weakening admission", async () => {
        const f = fixture();
        mockOperations = [];
        await f.controller.prepare(f.request);
        await f.session().run("open-browser");
        expect(f.openExternal).toHaveBeenCalledWith("https://ghost.example/p/11111111-1111-1111-1111-111111111111/");
        expect(mockReadPost.mock.calls.at(-1)?.[0]).toBe("b".repeat(24));

        const mobile = fixture();
        mockOperations = [];
        await mobile.controller.prepare(mobile.request);
        mobile.state.desktop = false;
        await mobile.session().run("open-browser");
        expect(mobile.openExternal).not.toHaveBeenCalled();

        const denied = fixture();
        mockOperations = [];
        await denied.controller.prepare(denied.request);
        denied.request.createActionAuthority = jest.fn(() => {
            const next = authority();
            next.state.allowed = false;
            return next.value;
        });
        await denied.session().run("open-browser");
        expect(denied.openExternal).not.toHaveBeenCalled();
    });

    it("confirms using the exact checked context and cannot widen a revoked ticket with fresh authority", async () => {
        const f = fixture();
        await f.controller.prepare(f.request);
        const checkedContext = mockService.checkPreview.mock.calls[0][2];
        f.initial.state.allowed = false;
        await f.session().run("confirm", { visibilityConfirmed: true });
        expect(mockService.confirm.mock.calls[0][2]).toBe(checkedContext);
        expect(f.request.createActionAuthority).toHaveBeenCalledTimes(2);
        expect(f.session().getState().status).toBe("completed");

        mockOperations = [];
        mockService.confirm.mockClear();
        const revoked = fixture();
        await revoked.controller.prepare(revoked.request);
        revoked.fresh[0].state.allowed = false;
        await revoked.session().run("confirm");
        expect(mockService.confirm).not.toHaveBeenCalled();
        expect(revoked.session().getState().errorKey).toBe("plugin.ghost.card.error.source");
    });

    it("labels restore confirmation as restoring the checked previous version", async () => {
        mockService.prepare.mockImplementation(async () => { const value = op("restore"); mockOperations = [value]; return value; });
        const controllerFixture = fixture();
        controllerFixture.request.intent = "restore";
        await controllerFixture.controller.prepare(controllerFixture.request);
        const state = controllerFixture.session().getState();
        expect(state.status).toBe("checked-restore");
        expect((state as { operationKind?: string }).operationKind).toBe("restore");

        class CardNode extends DomStubNode {
            ownerDocument = document;
            replaceChildren(...children: CardNode[]) { this.textContent = ""; children.forEach((child) => this.appendChild(child)); }
        }
        const document = { createElement: (tag: string) => new CardNode(tag), createTextNode: (text: string) => new CardNode("#text") };
        const container = new CardNode("div");
        const restoreState = { title: "Note", site: "https://ghost.example/", operationId: "op-two", status: "checked-restore",
            busy: false, actions: ["confirm"], operationKind: "restore" } as unknown as GhostCardState;
        const session: GhostPublishingSession = {
            getState: () => restoreState,
            subscribe: () => () => {},
            run: jest.fn<GhostPublishingSession["run"]>().mockResolvedValue(),
            dispose: jest.fn(),
        };
        const dispose = renderGhostPublishingCard(container as unknown as HTMLElement, session, (key) => key);
        const all = (node: DomStubNode): DomStubNode[] => [node, ...node.children.flatMap(all)];
        expect(all(container).some((node) => node.textContent === "plugin.ghost.card.status.checked-restore")).toBe(true);
        expect(all(container).some((node) => node.textContent === "plugin.ghost.card.action.confirmRestore")).toBe(true);
        dispose();
    });

    it("automatically checks each prepared draft and keeps unavailable or failed checks unready", async () => {
        mockService.prepare.mockImplementation(async () => { const value = op("create"); mockOperations = [value]; return value; });
        mockPreviewStatus = "unavailable";
        const f = fixture();
        expect(await f.controller.prepare(f.request)).toEqual({ status: "needs_attention", operationId: "op-one" });
        expect(f.session().getState()).toMatchObject({ status: "needs-attention", previewStatus: "unavailable",
            previewReasonKey: "plugin.ghost.card.preview.enable-web-viewer" });
        expect(f.session().getState().actions).not.toContain("confirm");
        expect(f.session().getState().actions).not.toContain("check-published");
        expect(mockOperations[0].target.previewId).toBe("b".repeat(24));
        mockPreviewStatus = "failed";
        await f.session().run("reprepare");
        expect(f.session().getState()).toMatchObject({ status: "needs-attention", previewStatus: "failed" });
        mockPreviewStatus = "passed";
        await f.session().run("check-preview");
        expect(f.session().getState().status).toBe("awaiting-publish");
        expect(mockService.checkPreview).toHaveBeenCalledTimes(3);
    });

    it("intersects initial and current Host authority during the automatic check", async () => {
        const f = fixture();
        mockReadPost.mockImplementationOnce(async () => {
            f.initial.state.allowed = false;
            return { uuid: "11111111-1111-1111-1111-111111111111" };
        });
        expect(await f.controller.prepare(f.request)).toMatchObject({ status: "needs_attention" });
        expect(f.session().getState().actions).not.toContain("confirm");
        expect(f.session().getState().errorKey).toBe("plugin.ghost.card.error.source");
    });

    it("fences only requested record files against replacement, deletion and symlinks; desktop denial reads nothing", async () => {
        const directory = mkdtempSync(join(tmpdir(), "pa-b153-controller-record-"));
        try {
            const parent = join(directory, "PA System", "Ghost Publishing", "site-a");
            mkdirSync(parent, { recursive: true });
            const file = join(parent, "note-linked.md");
            writeFileSync(file, "verified by record store");
            const f = fixture(directory);
            await f.controller.prepare(f.request);
            const options = f.contextOptions[1];
            const before = options.getCompletedRecordRevision!("site-a", "note-linked");
            await options.readCompletedRecord!("site-a", "note-linked");
            expect(mockRecordRead).toHaveBeenLastCalledWith("site-a", "note-linked");
            writeFileSync(join(parent, "replacement.md"), "verified by record store");
            renameSync(join(parent, "replacement.md"), file);
            expect(options.getCompletedRecordRevision!("site-a", "note-linked")).not.toBe(before);
            unlinkSync(file);
            expect(options.getCompletedRecordRevision!("site-a", "note-linked")).toBe("missing");
            symlinkSync(join(parent, "another.md"), file);
            expect(() => options.getCompletedRecordRevision!("site-a", "note-linked")).toThrow();
            const mobile = fixture(directory);
            mobile.state.desktop = false;
            const calls = mockCreateContext.mock.calls.length;
            await mobile.controller.prepare(mobile.request);
            expect(mockCreateContext).toHaveBeenCalledTimes(calls);
        } finally { rmSync(directory, { recursive: true, force: true }); }
    });

    it("checks freshly read Markdown before returning it and exposes only safe tool facts after unknown writes", async () => {
        const f = fixture();
        await f.controller.prepare(f.request);
        await expect(f.contextOptions[1].host.vault.read({ path: "Note.md", extension: "md" })).resolves.toContain("PRIVATE_SOURCE");
        f.state.contentAllowed = false;
        await expect(f.contextOptions[1].host.vault.read({ path: "Note.md", extension: "md" })).rejects.toMatchObject({ code: "source-revoked" });
        mockOperations = [];
        mockService.prepare.mockImplementation(async () => {
            mockOperations = [op("update", "outcome_unknown")];
            throw new Error("secret-token https://private.example/ PRIVATE_SOURCE");
        });
        const failure = fixture();
        const result = await failure.controller.prepare(failure.request);
        expect(result).toEqual({ status: "outcome_unknown", operationId: "op-one" });
        expect(JSON.stringify(result)).not.toMatch(/PRIVATE_SOURCE|secret-token|private\.example/);
        expect(failure.session().getState().status).toBe("outcome-unknown");
    });

    it("requires a second replacement confirmation and an independent visibility checkbox, and cleans up subscriptions", async () => {
        class CardNode extends DomStubNode {
            ownerDocument = document;
            replaceChildren(...children: CardNode[]) { this.textContent = ""; children.forEach((child) => this.appendChild(child)); }
        }
        const document = { createElement: (tag: string) => new CardNode(tag), createTextNode: (text: string) => { const node = new CardNode("#text"); node.textContent = text; return node; } };
        const container = new CardNode("div");
        const state: GhostCardState = { title: "Note", site: "https://ghost.example/", operationId: "op-one", status: "checked", busy: false,
            actions: ["replace-all", "confirm"], visibilityChange: { from: "members", to: "public" },
            warningKeys: ["plugin.ghost.card.warning.unpublished-wiki-link"] };
        const unsubscribe = jest.fn();
        let rerender = () => {};
        const run = jest.fn<GhostPublishingSession["run"]>().mockResolvedValue();
        const session: GhostPublishingSession = { getState: () => state, subscribe: (listener) => { rerender = listener; return unsubscribe; }, run, dispose: jest.fn() };
        const dispose = renderGhostPublishingCard(container as unknown as HTMLElement, session, (key) => key);
        const all = (node: DomStubNode): DomStubNode[] => [node, ...node.children.flatMap(all)];
        const byLabel = (suffix: string) => all(container).find((node) => node.tag === "button" && node.textContent === `plugin.ghost.card.${suffix}`)!;
        expect(all(container).some((node) => node.textContent.includes("op-one"))).toBe(false);
        expect(all(container).some((node) => node.textContent === "plugin.ghost.card.warning.unpublished-wiki-link")).toBe(true);
        expect(byLabel("action.confirm").disabled).toBe(true);
        const checkbox = all(container).find((node) => node.tag === "input")!;
        checkbox.checked = true;
        checkbox.dispatch("change");
        expect(byLabel("action.confirm").disabled).toBe(false);
        state.busy = true; rerender();
        state.busy = false; rerender();
        expect(byLabel("action.confirm").disabled).toBe(true);
        const renewedCheckbox = all(container).find((node) => node.tag === "input")!;
        renewedCheckbox.checked = true; renewedCheckbox.dispatch("change");
        byLabel("action.replace-all").dispatch("click");
        expect(run).not.toHaveBeenCalled();
        byLabel("replaceConfirm").dispatch("click");
        expect(run).toHaveBeenCalledWith("replace-all", { visibilityConfirmed: true, replacementConfirmed: true });
        dispose();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(session.dispose).toHaveBeenCalledTimes(1);
        expect(container.children).toHaveLength(0);
    });
});

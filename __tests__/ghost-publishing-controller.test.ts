import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { type App } from "obsidian";
import { GhostPublishingController, type GhostActionAuthority, type GhostControllerRequest, type GhostPublishingSession,
    type GhostCardState, type GhostCardAction } from "../src/ghost-publishing/controller";
import { renderGhostPublishingCard } from "../src/ghost-publishing/card";
import type { GhostActionContextOptions } from "../src/ghost-publishing/action-context";
import type { GhostActionContext } from "../src/ghost-publishing/service";
import type { GhostLocalOperation } from "../src/ghost-publishing/state-schema";
import type { GhostPublishingConfiguration } from "../src/ghost-publishing/configuration";
import type { GhostNativeLeaf } from "../src/ghost-publishing/preview";
import { DomStubNode, findAllByTag } from "./helpers/dom-stub";

const POST = "6ac4f4e0910d6f00010bb89b";
const PREVIEW = "6ac4f4e0910d6f00010bb89c";
const UUID = "f36fb365-bd7c-40b5-a77a-de5cd5cebb95";
const SITE = "https://ghost.example/";
let mockOperation: GhostLocalOperation | undefined;
let mockServiceOptions: { onUpdate?(operation: GhostLocalOperation): void };
const mockService = {
    prepare: jest.fn<(...args: any[]) => Promise<GhostLocalOperation>>(),
    confirm: jest.fn<(...args: any[]) => Promise<GhostLocalOperation>>(),
    get: jest.fn((id: string) => mockOperation?.operationId === id ? mockOperation : undefined),
    invalidate: jest.fn(),
    close: jest.fn(),
};
const mockStoreClose = jest.fn();
const mockCreateContext = jest.fn<(options: GhostActionContextOptions) => Promise<{
    noteKey: string; postId?: string; selection: { path: string }; context: GhostActionContext;
}>>();
jest.mock("../src/ghost-publishing/action-context", () => ({
    createGhostActionContext: (options: GhostActionContextOptions) => mockCreateContext(options),
}));
jest.mock("../src/ghost-publishing/service", () => ({
    GhostPublishingService: class {
        constructor(options: typeof mockServiceOptions) { mockServiceOptions = options; }
        prepare = mockService.prepare;
        confirm = mockService.confirm;
        get = mockService.get;
        invalidate = mockService.invalidate;
        close = mockService.close;
    },
}));
jest.mock("../src/ghost-publishing/state-store", () => ({
    ghostDatabaseName: () => "preview-resource-only",
    GhostPreviewStore: class { close = mockStoreClose; },
}));
jest.mock("../src/ghost-publishing/client", () => ({ GhostClient: class {} }));

function operation(state: GhostLocalOperation["state"] = "prepared"): GhostLocalOperation {
    return {
        operationId: "current-op", revision: 1, siteId: "site-a", site: SITE, noteKey: "Note.md",
        kind: "update", state, executionState: "succeeded", candidate: {} as GhostLocalOperation["candidate"],
        target: { postId: POST, postUrl: `${SITE}article/`, postStatus: state === "draft_saved" ? "draft" : "published",
            previewId: state === "draft_saved" ? POST : PREVIEW, previewUuid: UUID },
        verified: { postId: state === "prepared" ? PREVIEW : POST, postUrl: `${SITE}article/`,
            updatedAt: "2026-10-06T13:00:00.000Z", status: state === "updated" ? "published" : "draft" },
        updatedAt: "2026-10-06T13:00:00.000Z",
    };
}

const controllers: GhostPublishingController[] = [];
function fixture() {
    const state = { identity: "connection-a", desktop: true, allowed: true, initialCurrent: true, body: "Original body", failOpen: false };
    const assert = (valid: boolean, code: string) => { if (!valid) throw Object.assign(new Error(code), { code }); };
    const initial: GhostActionAuthority = {
        guard: { isCurrent: () => state.initialCurrent, isPathAllowed: () => state.allowed, isNoteDomainAllowed: () => state.allowed },
        sourceValidity: () => state.initialCurrent,
    };
    const contexts: GhostActionContext[] = [];
    mockCreateContext.mockImplementation(async options => {
        const assertCurrent = () => {
            assert(!options.signal?.aborted && options.guard.isCurrent() && options.sourceValidity(), "source-revoked");
            assert(options.getConnectionIdentity() === state.identity, "connection-changed");
        };
        const context = {
            gate: { assertCurrent, beforeSend: async () => assertCurrent() },
            validate: jest.fn(async () => assertCurrent()),
        } as unknown as GhostActionContext;
        contexts.push(context);
        return { noteKey: "Note.md", postId: POST, selection: { path: "Note.md" }, context };
    });
    const configuration = {
        getIdentity: () => state.identity,
        connection: async () => ({ siteId: "site-a", siteUrl: SITE, identity: state.identity,
            profile: { siteId: "site-a" }, defaultVisibility: "public" }),
    } as unknown as GhostPublishingConfiguration;
    const leaves: GhostNativeLeaf[] = [];
    const setViewState = jest.fn<GhostNativeLeaf["setViewState"]>(async () => { if (state.failOpen) throw new Error("navigation unavailable"); });
    const leaf: GhostNativeLeaf = { setViewState };
    const getLeaf = jest.fn(() => { if (!leaves.includes(leaf)) leaves.push(leaf); return leaf; });
    const revealLeaf = jest.fn(async () => {});
    const app = {
        vault: { getName: () => "test", read: async () => state.body },
        metadataCache: {}, fileManager: {},
        workspace: { getLeaf, getLeavesOfType: () => leaves, revealLeaf },
    } as unknown as App;
    const controller = new GhostPublishingController({
        app, configuration, vaultPath: "/synthetic/vault", pluginId: "pa",
        isDesktop: () => state.desktop, isCurrent: () => true, isWebViewerEnabled: () => true,
        getSourceRevision: () => 1, isPathAllowed: () => state.allowed, isContentAllowed: () => state.allowed,
    });
    controllers.push(controller);
    let session!: GhostPublishingSession;
    const freshAuthority = jest.fn((): GhostActionAuthority => ({
        guard: { isCurrent: () => true, isPathAllowed: () => state.allowed, isNoteDomainAllowed: () => state.allowed },
        sourceValidity: () => state.allowed,
    }));
    const request: GhostControllerRequest = { path: "Note.md", intent: "prepare", authority: initial,
        createActionAuthority: freshAuthority, onSession: value => { session = value; } };
    return { controller, request, state, initial, contexts, freshAuthority, setViewState, getLeaf, revealLeaf, session: () => session };
}

beforeEach(() => {
    mockOperation = undefined;
    mockCreateContext.mockReset();
    for (const method of [mockService.prepare, mockService.confirm, mockService.get, mockService.invalidate, mockService.close, mockStoreClose]) method.mockClear();
    mockService.prepare.mockImplementation(async () => { mockOperation = operation(); return mockOperation; });
    mockService.confirm.mockImplementation(async (_key, _id, context: GhostActionContext) => {
        context.gate.assertCurrent();
        mockOperation = { ...operation("updated"), revision: 2 };
        mockServiceOptions.onUpdate?.(mockOperation);
        return mockOperation;
    });
});
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose(); });

describe("Lean Ghost controller and human actions", () => {
    it("prepares a published update without opening or checking a page and exposes one confirmation", async () => {
        const f = fixture();
        const result = await f.controller.prepare(f.request);
        expect(result).toEqual({ status: "prepared", operationId: "current-op", executionState: "succeeded" });
        expect(f.session().getState()).toMatchObject({ status: "prepared", busy: false, actions: ["open-preview", "confirm"] });
        expect(f.getLeaf).not.toHaveBeenCalled();
        expect(mockService.confirm).not.toHaveBeenCalled();
    });

    it("saves drafts without PA publication confirmation and opens preview/editor directly in tabs", async () => {
        mockService.prepare.mockImplementation(async () => { mockOperation = operation("draft_saved"); return mockOperation; });
        const f = fixture();
        await f.controller.prepare(f.request);
        expect(f.session().getState().actions).toEqual(["open-preview", "open-editor"]);
        await f.session().run("open-preview");
        expect(f.setViewState).toHaveBeenLastCalledWith({ type: "webviewer", state: { url: `${SITE}p/${UUID}/` }, active: true });
        await f.session().run("open-editor");
        expect(f.setViewState).toHaveBeenLastCalledWith({ type: "webviewer", state: { url: `${SITE}ghost/#/editor/post/${POST}` }, active: true });
        expect(f.revealLeaf).toHaveBeenCalledTimes(2);
        expect(f.getLeaf).toHaveBeenCalledTimes(1);
        expect(mockService.confirm).not.toHaveBeenCalled();
    });

    it("confirms the fixed candidate with fresh current authority after note edits and expiry of the Agent turn", async () => {
        const f = fixture();
        await f.controller.prepare(f.request);
        const prepared = mockOperation;
        f.state.initialCurrent = false;
        f.state.body = "New note content that was not prepared";
        await f.session().run("confirm");
        expect(mockService.prepare).toHaveBeenCalledTimes(1);
        expect(mockService.confirm).toHaveBeenCalledWith("Note.md", prepared!.operationId, f.contexts[1]);
        expect(f.freshAuthority).toHaveBeenCalledTimes(1);
        expect(f.session().getState()).toMatchObject({ status: "updated", actions: ["open-post", "open-editor"] });
        expect(f.session().getContextReceipt()).toEqual({ operationId: "current-op", revision: 2, state: "updated", verified: true });
    });

    it("retains confirmed save facts after local binding failure or a later original guard revocation", async () => {
        const f = fixture();
        mockService.prepare.mockImplementation(async () => {
            mockOperation = { ...operation("draft_saved"), warnings: ["binding-failed"] };
            f.state.initialCurrent = false;
            return mockOperation;
        });
        expect(await f.controller.prepare(f.request)).toEqual({ status: "needs_attention", operationId: "current-op", executionState: "succeeded" });
        expect(f.session().getState()).toMatchObject({ status: "draft_saved", warningKeys: ["plugin.ghost.card.warning.binding-failed"],
            actions: ["open-preview", "open-editor"] });
        expect(mockService.prepare).toHaveBeenCalledTimes(1);
    });

    it("does not confirm a candidate prepared for an older connection configuration", async () => {
        const f = fixture();
        await f.controller.prepare(f.request);
        f.state.identity = "connection-b";
        await f.session().run("confirm");
        expect(mockService.confirm).not.toHaveBeenCalled();
        expect(f.session().getState()).toMatchObject({ status: "prepared", errorKey: "plugin.ghost.card.error.connection" });
    });

    it("keeps save success when navigation fails and preserves update success when cleanup fails", async () => {
        const f = fixture();
        await f.controller.prepare(f.request);
        f.state.failOpen = true;
        await f.session().run("open-preview");
        expect(f.session().getState()).toMatchObject({ status: "prepared", errorKey: "plugin.ghost.card.error.open" });
        expect(f.session().getContextReceipt()?.state).toBe("prepared");
        mockService.confirm.mockImplementation(async () => {
            mockOperation = { ...operation("updated"), warnings: ["cleanup-failed"] };
            return mockOperation;
        });
        await f.session().run("confirm");
        expect(f.session().getState()).toMatchObject({ status: "updated", warningKeys: ["plugin.ghost.card.warning.cleanup-failed"],
            actions: ["open-post", "open-preview", "open-editor"] });
    });

    it("distinguishes not-started, failed and truly unknown domain results without guessing from operation IDs", async () => {
        for (const [state, executionState, status] of [
            ["failed", "not_started", "needs_attention"],
            ["failed", "failed", "needs_attention"],
            ["outcome_unknown", "acceptance_unknown", "outcome_unknown"],
        ] as const) {
            mockService.prepare.mockImplementation(async () => {
                mockOperation = { ...operation(state), executionState, verified: undefined, error: "network" };
                return mockOperation;
            });
            const f = fixture();
            expect(await f.controller.prepare(f.request)).toMatchObject({ status, executionState, operationId: "current-op" });
        }
    });

    it("blocks revoked permissions before a confirm or navigation and prevents concurrent confirm clicks", async () => {
        const f = fixture();
        await f.controller.prepare(f.request);
        f.state.allowed = false;
        await f.session().run("confirm");
        await f.session().run("open-preview");
        expect(mockService.confirm).not.toHaveBeenCalled();
        expect(f.getLeaf).not.toHaveBeenCalled();
        expect(f.session().getState().errorKey).toBe("plugin.ghost.card.error.source");
        f.state.allowed = true;
        let finish!: (value: GhostLocalOperation) => void;
        mockService.confirm.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        const first = f.session().run("confirm");
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        const second = f.session().run("confirm");
        expect(mockService.confirm).toHaveBeenCalledTimes(1);
        finish(operation("updated"));
        await Promise.all([first, second]);
    });

    it("updates only live session history callbacks and never restores an old operation from a store", async () => {
        const f = fixture();
        await f.controller.prepare(f.request);
        const persist = jest.fn<(value: ReturnType<GhostPublishingSession["getContextReceipt"]>) => Promise<boolean>>(async () => true);
        f.session().registerContextPersistence!(persist, "original-chat");
        await f.session().run("confirm");
        expect(persist).toHaveBeenCalledWith({ operationId: "current-op", revision: 2, state: "updated", verified: true });
        persist.mockClear();
        f.session().dispose();
        mockServiceOptions.onUpdate?.({ ...operation("updated"), revision: 3 });
        expect(persist).not.toHaveBeenCalled();
        expect(mockService.invalidate).toHaveBeenCalledWith("current-op");
        expect(await f.controller.readContextReceipt("current-op")).toMatchObject({ state: "updated" });
    });
});

function domFixture() {
    const document = {
        createElement: (tag: string) => {
            const node = new DomStubNode(tag) as DomStubNode & { ownerDocument: unknown; replaceChildren(): void };
            node.ownerDocument = document;
            node.replaceChildren = () => { for (const child of [...node.children]) node.removeChild(child); };
            return node;
        },
    };
    return document.createElement("div");
}

describe("Lean Ghost card rendering", () => {
    it("keeps accessible ordinary buttons, busy feedback and subscription cleanup without replacement or preview-check prompts", async () => {
        const container = domFixture();
        let state: GhostCardState = { title: "Note", site: SITE, status: "prepared", busy: false,
            actions: ["open-preview", "confirm"] };
        let listener: () => void = () => {};
        const unsubscribe = jest.fn();
        const run = jest.fn<(action: GhostCardAction) => Promise<void>>(async () => {});
        const dispose = jest.fn();
        const session: GhostPublishingSession = { getState: () => state, getContextReceipt: () => undefined,
            subscribe: value => { listener = value; return unsubscribe; }, run, dispose };
        const cleanup = renderGhostPublishingCard(container as unknown as HTMLElement, session, key => key);
        let buttons = findAllByTag(container, "button");
        expect(buttons.map(button => button.getAttribute("aria-label"))).toEqual([
            "plugin.ghost.card.action.open-preview", "plugin.ghost.card.action.confirm",
        ]);
        expect(findAllByTag(container, "input")).toHaveLength(0);
        buttons[1].dispatch("click");
        await Promise.resolve();
        expect(run).toHaveBeenCalledWith("confirm");
        state = { ...state, busy: true, status: "updating" };
        listener();
        buttons = findAllByTag(container, "button");
        expect(buttons.every(button => button.disabled)).toBe(true);
        expect(findAllByTag(container, "p").some(node => node.getAttribute("aria-live") === "polite")).toBe(true);
        cleanup();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(container.children).toHaveLength(0);
    });
});

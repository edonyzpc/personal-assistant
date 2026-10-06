import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Platform, TFile, type App } from "obsidian";
import { GhostPublishingIntegration, type GhostChatBindingRequest } from "../src/ghost-publishing/host-integration";
import { createPrepareGhostPostTool } from "../src/ai-services/chat-tool-factories";
import type { ChatToolContext } from "../src/ai-services/chat-tools";
import type { GhostActionAuthority, GhostPublishingController } from "../src/ghost-publishing/controller";

type ControllerOptions = ConstructorParameters<typeof GhostPublishingController>[0];
type PrepareOptions = Parameters<GhostPublishingController["prepare"]>[0];
const mockPrepared = jest.fn<(options: PrepareOptions) => Promise<{ status: "prepared"; operationId: string; executionState: "succeeded" }>>(async () => ({ status: "prepared", operationId: "synthetic-op", executionState: "succeeded" }));
const mockDisposed = jest.fn<() => void>();
let mockControllerOptions: ControllerOptions;
jest.mock("../src/ghost-publishing/controller", () => ({ GhostPublishingController: class {
    constructor(options: ControllerOptions) { mockControllerOptions = options; }
    prepare(options: PrepareOptions) { return mockPrepared(options); }
    dispose() { mockDisposed(); }
} }));

afterEach(() => { Platform.isMobile = false; Platform.isDesktop = true; jest.clearAllMocks(); });

function setup() {
    const files = ["A.md", "B.md", "cover.png"].map(path => Object.assign(new TFile(), {
        path, name: path, extension: path.split(".").pop(), basename: path.split(".")[0],
    }));
    const events = new Map<string, (file: TFile, oldPath?: string) => void>();
    const app = {
        vault: {
            configDir: ".obsidian", getMarkdownFiles: () => files.filter(file => file.extension === "md"),
            getAbstractFileByPath: (path: string) => files.find(file => file.path === path) ?? null,
            on: (name: string, callback: (file: TFile, oldPath?: string) => void) => { events.set(name, callback); return { name }; },
            offref: jest.fn(),
        },
        metadataCache: { getFirstLinkpathDest: (name: string) => files.find(file => file.basename === name) ?? null },
        secretStorage: { getSecret: jest.fn(() => null), setSecret: jest.fn() },
    };
    let current = true;
    let allowed = true;
    let selection: ReturnType<GhostChatBindingRequest["getSourceSelection"]> = { scope: "notes", selectionId: "selection-0" };
    const integration = new GhostPublishingIntegration({ app: app as unknown as App, pluginId: "personal-assistant", vaultPath: "/synthetic/vault",
        getSettings: () => ({ siteUrl: "https://synthetic.example/", defaultVisibility: "public", profile: {} }), saveSettings: async () => undefined,
        isCurrent: () => current, isPathAllowed: () => allowed, isContentAllowed: () => allowed, isWebAllowed: () => true,
    });
    const request: GhostChatBindingRequest = { conversationId: "conversation", stableMessageId: "message", userText: "@blog2ghost 当前笔记发不到ghost平台", capturedPath: "A.md",
        isCurrent: () => current, getSourceSelection: () => selection, onSession: () => undefined };
    let initialCurrent = true;
    const initial: GhostActionAuthority = { guard: { isCurrent: () => initialCurrent, isPathAllowed: () => initialCurrent, isNoteDomainAllowed: () => true },
        sourceValidity: () => initialCurrent };
    return { integration, request, initial, app, files, events,
        revokeInitial: () => { initialCurrent = false; }, revoke: () => { allowed = false; }, close: () => { current = false; },
        combined: () => { selection = { scope: "combined", selectionId: "selection-1" }; },
        notesAgain: () => { selection = { scope: "notes", selectionId: "selection-2" }; },
    };
}

describe("Ghost Obsidian Host bridge", () => {
    it("requires the explicit request and fixes the current target before asynchronous tool execution", async () => {
        const fixture = setup();
        expect(fixture.integration.createBinding({ ...fixture.request, userText: "Discuss Ghost" })).toBeUndefined();
        const binding = fixture.integration.createBinding(fixture.request)!;
        const stale = await binding.submit({ intent: "prepare", path: "missing.md" }, fixture.initial.guard, fixture.initial.sourceValidity)
            .catch((error: unknown) => error);
        expect(stale).toMatchObject({ name: "GhostHostAdmissionError", reason: "target",
            facts: { executionState: "not_started", recovery: { allowedActions: ["correct_input"] } } });
        expect(mockPrepared).not.toHaveBeenCalled();
        const tool = createPrepareGhostPostTool(binding);
        const context = { host: { log: () => undefined }, taskSourceReadGuard: fixture.initial.guard,
            signal: new AbortController().signal } as unknown as ChatToolContext;
        const rejected = await tool.execute({ intent: "prepare", path: "missing.md" }, context);
        const corrected = await tool.execute({ intent: "prepare", path: "A.md" }, context);
        expect(rejected).toMatchObject({ ok: false, executionState: "not_started",
            recovery: { allowedActions: ["correct_input"] } });
        expect(corrected.ok).toBe(true);
        expect(mockPrepared.mock.calls[0][0].path).toBe("A.md");
        expect(mockPrepared).toHaveBeenCalledTimes(1);
        fixture.integration.dispose();
    });

    it("reports pre-controller permission and staleness as not-started owner facts without parameter bypass", async () => {
        const sourceFixture = setup();
        sourceFixture.revoke();
        const sourceTool = createPrepareGhostPostTool(sourceFixture.integration.createBinding(sourceFixture.request)!);
        const sourceContext = { host: { log: () => undefined }, taskSourceReadGuard: sourceFixture.initial.guard,
            signal: new AbortController().signal } as unknown as ChatToolContext;
        const sourceRejected = await sourceTool.execute({ intent: "prepare", path: "A.md" }, sourceContext);
        const sourceChanged = await sourceTool.execute({ intent: "prepare", path: "B.md" }, sourceContext);
        expect(sourceRejected).toMatchObject({ ok: false, executionState: "not_started",
            recovery: { code: "ghost_source_unavailable", allowedActions: ["needs_user"] } });
        expect(sourceChanged).toMatchObject({ ok: false, executionState: "not_started",
            recovery: { code: "ghost_source_unavailable", allowedActions: ["needs_user"] } });

        const staleFixture = setup();
        staleFixture.revokeInitial();
        const staleTool = createPrepareGhostPostTool(staleFixture.integration.createBinding(staleFixture.request)!);
        const staleContext = { host: { log: () => undefined }, taskSourceReadGuard: staleFixture.initial.guard,
            signal: new AbortController().signal } as unknown as ChatToolContext;
        const staleRejected = await staleTool.execute({ intent: "prepare", path: "A.md" }, staleContext);
        const staleChanged = await staleTool.execute({ intent: "prepare", path: "B.md" }, staleContext);
        expect(staleRejected).toMatchObject({ ok: false, executionState: "not_started",
            recovery: { code: "ghost_request_stale", allowedActions: ["none"] } });
        expect(staleChanged).toMatchObject({ ok: false, executionState: "not_started",
            recovery: { code: "ghost_request_stale", allowedActions: ["none"] } });
        expect(mockPrepared).not.toHaveBeenCalled();
        sourceFixture.integration.dispose();
        staleFixture.integration.dispose();
    });

    it("reauthorizes explicit card actions independently of the expired Agent turn and invalidates scope changes", async () => {
        const fixture = setup();
        await fixture.integration.createBinding(fixture.request)!.submit({ intent: "prepare" }, fixture.initial.guard, fixture.initial.sourceValidity);
        fixture.revokeInitial();
        const prepare = mockPrepared.mock.calls[0][0];
        const notes = prepare.createActionAuthority();
        expect(notes.guard.isPathAllowed("A.md")).toBe(true);
        expect(notes.guard.isPathAllowed("cover.png")).toBe(true);
        expect(notes.guard.isWebAllowed?.()).toBe(false);
        fixture.combined();
        expect(notes.sourceValidity()).toBe(false);
        const combined = prepare.createActionAuthority();
        expect(combined.guard.isWebAllowed?.()).toBe(true);
        fixture.notesAgain();
        expect(notes.sourceValidity()).toBe(false);
        expect(combined.sourceValidity()).toBe(false);
        fixture.revoke();
        expect(combined.guard.isPathAllowed("A.md")).toBe(false);
        fixture.close();
        expect(combined.guard.isCurrent()).toBe(false);
        fixture.integration.dispose();
    });

    it("observes source events without relying on timestamps and blocks mobile before any secret read", () => {
        const fixture = setup();
        const before = mockControllerOptions.getSourceRevision("A.md");
        fixture.events.get("modify")!(fixture.files[0]);
        expect(mockControllerOptions.getSourceRevision("A.md")).not.toBe(before);
        fixture.events.get("rename")!(fixture.files[0], "old.md");
        expect(mockControllerOptions.getSourceRevision("old.md")).toBe(mockControllerOptions.getSourceRevision("A.md"));
        Platform.isMobile = true;
        expect(fixture.integration.createBinding(fixture.request)).toBeUndefined();
        expect(fixture.app.secretStorage.getSecret).not.toHaveBeenCalled();
        fixture.integration.dispose();
        expect(fixture.app.vault.offref).toHaveBeenCalledTimes(4);
        expect(mockDisposed).toHaveBeenCalledTimes(1);
    });

});

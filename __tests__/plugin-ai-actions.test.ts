import { describe, expect, it, jest } from "@jest/globals";
import { MarkdownView, TFile, type Editor, type Modal } from "obsidian";

import { AIActions } from "../src/plugin/ai-actions";
import type {
    FeaturedImageDefaults,
    FeaturedImageRunAdmission,
    FeaturedImageRunOptions,
} from "../src/ai-services/featured-image-options";
import type { ImageGenerationConnection } from "../src/ai-services/image-generation-connection";
import type { FeaturedImageOptionsModalHost } from "../src/settings/featured-image-options-modal";

interface CapturedModal {
    host: FeaturedImageOptionsModalHost;
    modal: Modal;
}

const MarkdownViewCtor = MarkdownView as unknown as new (editor?: unknown) => MarkdownView;
const TestTFile = TFile as unknown as new (path: string) => TFile;

function createImageConnection(overrides: Partial<ImageGenerationConnection> = {}): ImageGenerationConnection {
    return {
        mode: "dedicated-wan",
        baseURL: "https://image.example",
        synchronousEndpoint: "https://image.example/sync",
        asynchronousEndpoint: "https://image.example/async",
        tasksEndpoint: "https://image.example/tasks",
        credentialSlot: "image-token",
        revision: 7,
        ...overrides,
    };
}

function createHarness() {
    const editor = {
        getSelection: jest.fn(() => "selection"),
        getValue: jest.fn(() => "document"),
    } as unknown as Editor;
    const file = new TestTFile("notes/current.md");
    const view = new MarkdownViewCtor(editor);
    Object.assign(view, {
        file,
        containerEl: { isConnected: true },
    });
    const state = {
        imageConnection: createImageConnection() as ImageGenerationConnection | null,
        providerConnection: {
            aiProvider: "qwen",
            baseURL: "https://chat.example",
            chatModelName: "chat-model",
            embeddingModelName: "embedding-model",
        },
        defaults: {
            featuredImageModel: "wan2.7-image" as const,
            numFeaturedImages: 2,
            featuredImagePath: "images",
        },
        unloading: false,
        credentialTransition: false,
        providerRevision: 3,
        tokenRevision: 5,
        file,
    };
    const ensureAIConfigured = jest.fn(() => true);
    const getAPIToken = jest.fn(async () => "chat-token");
    const getConfiguredImageAPITokenSecret = jest.fn(() => "image-token");
    const saveFeaturedImageDefaults = jest.fn(async (_options: FeaturedImageDefaults) => undefined);
    const summaryGenerate = jest.fn<() => Promise<void>>(async () => undefined);
    const featuredGenerate = jest.fn(async (_options: FeaturedImageRunOptions) => undefined);
    const openedModals: CapturedModal[] = [];
    const log = jest.fn((...args: unknown[]) => undefined);
    const owner = new AIActions({
        ensureAIConfigured: () => ensureAIConfigured(),
        getImageGenerationConnection: () => state.imageConnection,
        getProviderConnection: () => state.providerConnection,
        getFeaturedImageDefaults: () => state.defaults,
        isUnloading: () => state.unloading,
        hasActiveAIProviderCredentialTransition: () => state.credentialTransition,
        getProviderConfigurationRevision: () => state.providerRevision,
        getTokenRevision: () => state.tokenRevision,
        getFileByPath: (path: string) => (path === file.path ? state.file : undefined),
        getConfiguredImageAPITokenSecret: () => getConfiguredImageAPITokenSecret(),
        getAPIToken: () => getAPIToken(),
        saveFeaturedImageDefaults: (options) => saveFeaturedImageDefaults(options),
        createSummaryHelper: () => ({ generate: summaryGenerate }),
        createFeaturedImageHelper: () => ({ generate: featuredGenerate }),
        openSharedFeatureModal: (host) => {
            const modal = {
                open: jest.fn(),
                close: jest.fn(),
            } as unknown as Modal;
            openedModals.push({ host, modal });
            return modal;
        },
        log: (message, ...args) => log(message, ...args),
    });

    function refreshTarget() {
        Object.assign(view, {
            file: state.file,
            containerEl: { isConnected: true },
        });
    }

    return {
        owner,
        state,
        editor,
        view,
        file,
        ensureAIConfigured,
        getAPIToken,
        getConfiguredImageAPITokenSecret,
        saveFeaturedImageDefaults,
        summaryGenerate,
        featuredGenerate,
        openedModals,
        log,
        refreshTarget,
    };
}

describe("AIActions summary", () => {
    it("does not read the editor or construct a helper when AI is not configured", async () => {
        const harness = createHarness();
        harness.ensureAIConfigured.mockReturnValueOnce(false);

        await harness.owner.summarize(harness.editor, harness.view);

        expect(harness.editor.getSelection).not.toHaveBeenCalled();
        expect(harness.editor.getValue).not.toHaveBeenCalled();
        expect(harness.summaryGenerate).not.toHaveBeenCalled();
        expect(harness.log).not.toHaveBeenCalled();
    });

    it("logs lengths, constructs only for MarkdownView, and awaits helper generation", async () => {
        const harness = createHarness();
        let resolveGenerate!: () => void;
        harness.summaryGenerate.mockImplementationOnce(() => new Promise<void>((resolve) => {
            resolveGenerate = resolve;
        }));
        const settled = jest.fn();
        const generating = harness.owner.summarize(harness.editor, harness.view);
        void generating.then(settled);
        await Promise.resolve();
        await Promise.resolve();

        expect(harness.log).toHaveBeenCalledWith("AI Summary invoked", {
            selectionLength: "selection".length,
            documentLength: "document".length,
        });
        expect(harness.log).toHaveBeenCalledWith("invoking LLM");
        expect(harness.summaryGenerate).toHaveBeenCalledTimes(1);
        expect(settled).not.toHaveBeenCalled();
        resolveGenerate();
        await expect(generating).resolves.toBeUndefined();
        expect(settled).toHaveBeenCalledTimes(1);
    });

    it("logs a non-Markdown target without helper work and propagates helper rejection", async () => {
        const harness = createHarness();
        const failure = new Error("summary failed");
        await harness.owner.summarize(harness.editor, {} as Parameters<typeof harness.owner.summarize>[1]);
        expect(harness.summaryGenerate).not.toHaveBeenCalled();
        expect(harness.log).toHaveBeenCalledWith("AI Summary invoked", {
            selectionLength: 9,
            documentLength: 8,
        });

        harness.summaryGenerate.mockRejectedValueOnce(failure);
        await expect(harness.owner.summarize(harness.editor, harness.view)).rejects.toBe(failure);
    });
});

describe("AIActions featured image command and modal", () => {
    it("checks image connection without opening work and executes only for MarkdownView", () => {
        const harness = createHarness();
        harness.state.imageConnection = null;
        expect(harness.owner.checkFeaturedImage(true, harness.editor, harness.view)).toBe(false);
        expect(harness.openedModals).toHaveLength(0);

        harness.state.imageConnection = createImageConnection();
        expect(harness.owner.checkFeaturedImage(true, harness.editor, harness.view)).toBe(true);
        expect(harness.ensureAIConfigured).not.toHaveBeenCalled();
        expect(harness.getConfiguredImageAPITokenSecret).not.toHaveBeenCalled();
        expect(harness.getAPIToken).not.toHaveBeenCalled();
        expect(harness.openedModals).toHaveLength(0);

        expect(harness.owner.checkFeaturedImage(false, harness.editor, {} as never)).toBeUndefined();
        expect(harness.openedModals).toHaveLength(0);
    });

    it("opens edit defaults only with a live image connection and complete target", () => {
        const harness = createHarness();
        const modal = harness.owner.openFeaturedImageOptions();
        expect(modal).toBe(harness.openedModals[0]?.modal);
        expect(harness.openedModals[0]?.host).toMatchObject({
            mode: "edit",
            defaults: harness.state.defaults,
        });

        harness.state.imageConnection = null;
        expect(harness.owner.openFeaturedImageOptions(harness.editor, harness.view)).toBeNull();
        expect(harness.owner.openFeaturedImageOptions(harness.editor)).toBeNull();
        expect(harness.owner.openFeaturedImageOptions(undefined, harness.view)).toBeNull();
        expect(harness.openedModals).toHaveLength(1);
    });

    it("opens generate mode with the target source and saves through the root facade", async () => {
        const harness = createHarness();
        const modal = harness.owner.openFeaturedImageOptions(harness.editor, harness.view)!;
        expect(modal).toBe(harness.openedModals[0]?.modal);
        const host = harness.openedModals[0]!.host;
        expect(host).toMatchObject({
            mode: "generate",
            sourceName: "current",
            defaults: harness.state.defaults,
        });
        await expect(host.saveDefaults({
            ...harness.state.defaults,
            numFeaturedImages: 4,
        })).resolves.toBeUndefined();
        expect(harness.saveFeaturedImageDefaults).toHaveBeenCalledWith({
            ...harness.state.defaults,
            numFeaturedImages: 4,
        });
    });
});

describe("AIActions featured image admission", () => {
    it("captures current connection identity and routes tokens by image mode", async () => {
        const harness = createHarness();
        harness.owner.openFeaturedImageOptions(harness.editor, harness.view);
        const captured = harness.openedModals[0]!.host;
        expect(captured.mode).toBe("generate");
        const admission = (captured as Extract<FeaturedImageOptionsModalHost, { mode: "generate" }>).prepareRun()!;
        expect(admission.connection).toEqual(harness.state.providerConnection);
        expect(admission.imageEndpoint).toBe(harness.state.imageConnection?.synchronousEndpoint);
        expect(admission.imageBaseURL).toBe(harness.state.imageConnection?.baseURL);
        expect(admission.isCurrent()).toBe(true);
        await expect(admission.getImageAPIToken?.()).resolves.toBe("image-token");
        expect(harness.getConfiguredImageAPITokenSecret).toHaveBeenCalledTimes(1);
        expect(harness.getAPIToken).not.toHaveBeenCalled();
    });

    it("uses the general token route for inherited chat image mode", async () => {
        const harness = createHarness();
        harness.state.imageConnection = createImageConnection({ mode: "inherit-chat" });
        harness.owner.openFeaturedImageOptions(harness.editor, harness.view);
        const host = harness.openedModals[0]!.host as Extract<FeaturedImageOptionsModalHost, { mode: "generate" }>;
        const admission = host.prepareRun()!;
        await expect(admission.getImageAPIToken?.()).resolves.toBe("chat-token");
        expect(harness.getAPIToken).toHaveBeenCalledTimes(1);
        expect(harness.getConfiguredImageAPITokenSecret).not.toHaveBeenCalled();
    });

    it("returns an empty token after image connection mode, base URL, or revision drift", async () => {
        const harness = createHarness();
        harness.owner.openFeaturedImageOptions(harness.editor, harness.view);
        const host = harness.openedModals[0]!.host as Extract<FeaturedImageOptionsModalHost, { mode: "generate" }>;
        const admission = host.prepareRun()!;
        const original = harness.state.imageConnection!;
        const changedConnections = [
            createImageConnection({ mode: "inherit-chat" }),
            createImageConnection({ baseURL: "https://changed-image.example" }),
            createImageConnection({ revision: original.revision + 1 }),
        ];
        for (const changed of changedConnections) {
            harness.state.imageConnection = changed;
            await expect(admission.getImageAPIToken?.()).resolves.toBe("");
            expect(admission.isCurrent()).toBe(false);
            harness.state.imageConnection = original;
        }
        expect(harness.getConfiguredImageAPITokenSecret).not.toHaveBeenCalled();
        expect(harness.getAPIToken).not.toHaveBeenCalled();
    });

    it.each([
        ["provider revision", (harness: ReturnType<typeof createHarness>) => {
            harness.state.providerRevision += 1;
        }],
        ["token revision", (harness: ReturnType<typeof createHarness>) => {
            harness.state.tokenRevision += 1;
        }],
        ["credential transition", (harness: ReturnType<typeof createHarness>) => {
            harness.state.credentialTransition = true;
        }],
        ["unloading", (harness: ReturnType<typeof createHarness>) => {
            harness.state.unloading = true;
        }],
        ["file object", (harness: ReturnType<typeof createHarness>) => {
            harness.state.file = new TestTFile(harness.file.path);
            harness.refreshTarget();
        }],
        ["editor", (harness: ReturnType<typeof createHarness>) => {
            Object.assign(harness.view, { editor: {} });
        }],
        ["view file", (harness: ReturnType<typeof createHarness>) => {
            Object.assign(harness.view, { file: new TestTFile(harness.file.path) });
        }],
        ["detached container", (harness: ReturnType<typeof createHarness>) => {
            Object.assign(harness.view, { containerEl: { isConnected: false } });
        }],
        ["file path", (harness: ReturnType<typeof createHarness>) => {
            Object.assign(harness.file, { path: "notes/changed.md" });
        }],
        ["provider tuple provider", (harness: ReturnType<typeof createHarness>) => {
            harness.state.providerConnection = { ...harness.state.providerConnection, aiProvider: "changed" };
        }],
        ["provider tuple base URL", (harness: ReturnType<typeof createHarness>) => {
            harness.state.providerConnection = { ...harness.state.providerConnection, baseURL: "https://changed" };
        }],
        ["provider tuple chat model", (harness: ReturnType<typeof createHarness>) => {
            harness.state.providerConnection = { ...harness.state.providerConnection, chatModelName: "changed" };
        }],
        ["image connection", (harness: ReturnType<typeof createHarness>) => {
            harness.state.imageConnection = createImageConnection({ revision: 8 });
        }],
    ])("rejects a later mixed run after %s drift", (_name, change) => {
        const harness = createHarness();
        harness.owner.openFeaturedImageOptions(harness.editor, harness.view);
        const host = harness.openedModals[0]!.host as Extract<FeaturedImageOptionsModalHost, { mode: "generate" }>;
        const admission: FeaturedImageRunAdmission = host.prepareRun()!;
        expect(admission.isCurrent()).toBe(true);
        change(harness);
        expect(admission.isCurrent()).toBe(false);
    });

    it("generates through the helper factory with the supplied immutable run options", async () => {
        const harness = createHarness();
        harness.owner.openFeaturedImageOptions(harness.editor, harness.view);
        const host = harness.openedModals[0]!.host as Extract<FeaturedImageOptionsModalHost, { mode: "generate" }>;
        const admission = host.prepareRun()!;
        const options = Object.freeze({
            ...harness.state.defaults,
            ...admission,
        }) as unknown as FeaturedImageRunOptions;
        await expect(host.generate(options)).resolves.toBeUndefined();
        expect(harness.featuredGenerate).toHaveBeenCalledTimes(1);
        expect(harness.featuredGenerate).toHaveBeenCalledWith(options);
    });
});

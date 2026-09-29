import { describe, expect, it, jest } from "@jest/globals";
import { MarkdownView, TFile, type Editor, type Modal } from "obsidian";

import { AIActions } from "../src/plugin/ai-actions";
import type { FeaturedImageDefaults } from "../src/ai-services/featured-image-options";
import type { ImageGenerationConnection } from "../src/ai-services/image-generation-connection";
import type { ComposerImageTextSource } from "../src/chat/composer-draft";
import type { FeaturedImageOptionsModalHost } from "../src/settings/featured-image-options-modal";

const MarkdownViewCtor = MarkdownView as unknown as new (editor?: unknown) => MarkdownView;
const TestTFile = TFile as unknown as new (path: string) => TFile;

function createImageConnection(): ImageGenerationConnection {
    return {
        mode: "dedicated-wan",
        baseURL: "https://image.example",
        synchronousEndpoint: "https://image.example/sync",
        asynchronousEndpoint: "https://image.example/async",
        tasksEndpoint: "https://image.example/tasks",
        credentialSlot: "image-token",
        revision: 7,
    };
}

function createHarness(options: { selection?: string | null } = {}) {
    const documentText = `---\ntitle: hidden\n---\noutside ${options.selection ?? ""} outside`;
    const selectionStart = options.selection ? documentText.indexOf(options.selection) : -1;
    const selectionEnd = selectionStart + (options.selection?.length ?? 0);
    const editor = {
        getValue: jest.fn(() => documentText),
        getSelection: jest.fn(() => options.selection ?? ""),
        getCursor: jest.fn((side: 'from' | 'to') => (
            side === 'from' ? { line: 0, ch: selectionStart } : { line: 0, ch: selectionEnd }
        )),
        posToOffset: jest.fn((position: { line: number; ch: number }) => position.ch),
    } as unknown as Editor;
    const file = new TestTFile("notes/current.md");
    const view = new MarkdownViewCtor(editor);
    Object.assign(view, { file });
    const defaults: FeaturedImageDefaults = {
        featuredImageModel: "wan2.7-image-pro",
        numFeaturedImages: 3,
        featuredImagePath: "attachments/ai",
    };
    const openedDrafts: ComposerImageTextSource[] = [];
    const openedModals: Array<{ host: FeaturedImageOptionsModalHost; modal: Modal }> = [];
    const openChatImageDraft = jest.fn(async (source: ComposerImageTextSource) => {
        openedDrafts.push(source);
        return true;
    });
    const owner = new AIActions({
        ensureAIConfigured: jest.fn(() => true),
        getImageGenerationConnection: jest.fn(() => createImageConnection()),
        getFeaturedImageDefaults: () => defaults,
        saveFeaturedImageDefaults: jest.fn(async () => undefined),
        createSummaryHelper: () => ({ generate: jest.fn(async () => undefined) }),
        openChatImageDraft,
        openSharedFeatureModal: host => {
            const modal = { open: jest.fn(), close: jest.fn() } as unknown as Modal;
            openedModals.push({ host, modal });
            return modal;
        },
        log: jest.fn(),
    });
    return { owner, editor, view, file, defaults, openedDrafts, openedModals, openChatImageDraft };
}

describe("AIActions", () => {
    it("keeps the Featured image command available only with an image connection", () => {
        const harness = createHarness();
        expect(harness.owner.checkFeaturedImage(true, harness.editor, harness.view)).toBe(true);
        expect(harness.openedDrafts).toEqual([]);
    });

    it("captures the exact selection before opening a structured Chat draft", async () => {
        const harness = createHarness({ selection: "SELECTED-TEXT" });

        expect(harness.owner.checkFeaturedImage(false, harness.editor, harness.view)).toBeUndefined();
        await Promise.resolve();

        expect(harness.openedDrafts).toHaveLength(1);
        expect(harness.openedDrafts[0]).toMatchObject({
            kind: "selection",
            path: "notes/current.md",
            text: "SELECTED-TEXT",
            selection: {
                from: "---\ntitle: hidden\n---\noutside ".length,
                to: "---\ntitle: hidden\n---\noutside ".length + "SELECTED-TEXT".length,
            },
        });
        expect(harness.openedModals).toEqual([]);
    });

    it("falls back to the exact command note body when no selection exists", async () => {
        const harness = createHarness();
        expect(harness.owner.checkFeaturedImage(false, harness.editor, harness.view)).toBeUndefined();
        await Promise.resolve();

        expect(harness.openedDrafts).toHaveLength(1);
        expect(harness.openedDrafts[0]).toMatchObject({
            kind: "note",
            path: "notes/current.md",
            text: "outside  outside",
        });
    });

    it("does not fall back to the full note when a nonempty selection cannot be captured exactly", async () => {
        const harness = createHarness({ selection: "SELECTED-TEXT" });
        (harness.editor.getValue as jest.Mock<() => string>).mockReturnValue("outside SELECTED-TEXT outside");
        (harness.editor.getCursor as jest.Mock<(side?: 'from' | 'to') => { line: number; ch: number }>)
            .mockImplementation(side => (
            side === 'from' ? { line: 0, ch: 0 } : { line: 0, ch: 1 }
        ));
        (harness.editor.posToOffset as jest.Mock<(position: { ch?: number }) => number>)
            .mockImplementation(position => position.ch ?? 0);

        expect(harness.owner.checkFeaturedImage(false, harness.editor, harness.view)).toBeUndefined();
        await Promise.resolve();

        expect(harness.openChatImageDraft).not.toHaveBeenCalled();
        expect(harness.openedDrafts.every(source => source.kind !== 'note')).toBe(true);
    });

    it("does not overwrite a busy Chat draft", async () => {
        const harness = createHarness({ selection: "SELECTED" });
        harness.openChatImageDraft.mockResolvedValueOnce(false);
        expect(harness.owner.checkFeaturedImage(false, harness.editor, harness.view)).toBeUndefined();
        await Promise.resolve();
        await Promise.resolve();
        expect(harness.openChatImageDraft).toHaveBeenCalledTimes(1);
    });

    it("keeps the shared modal for editing defaults only", () => {
        const harness = createHarness();
        const modal = harness.owner.openFeaturedImageOptions();
        expect(modal).toBe(harness.openedModals[0]?.modal);
        expect(harness.openedModals[0]?.host.mode).toBe("edit");
        expect(harness.openedDrafts).toEqual([]);
    });
});

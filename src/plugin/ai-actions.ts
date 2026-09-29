import { MarkdownView, Modal, Notice, type Editor, type MarkdownFileInfo } from "obsidian";

import type { FeaturedImageDefaults } from "../ai-services/featured-image-options";
import type { ImageGenerationConnection } from "../ai-services/image-generation-connection";
import { captureComposerImageTextSource, type ComposerImageTextSource } from "../chat/composer-draft";
import { getPluginUiLanguage, pluginT } from "../locales/plugin";
import type { FeaturedImageOptionsModalHost } from "../settings/featured-image-options-modal";

export interface SummaryHelper {
    generate(): Promise<void>;
}

export interface AIActionsDependencies {
    ensureAIConfigured(): boolean;
    getImageGenerationConnection(): ImageGenerationConnection | null;
    getFeaturedImageDefaults(): FeaturedImageDefaults;
    saveFeaturedImageDefaults(options: FeaturedImageDefaults): Promise<void>;
    createSummaryHelper(editor: Editor, view: MarkdownView): SummaryHelper;
    openChatImageDraft(source: ComposerImageTextSource): Promise<boolean>;
    openSharedFeatureModal(host: FeaturedImageOptionsModalHost): Modal;
    log(message: string, ...args: unknown[]): void;
}

export class AIActions {
    constructor(private readonly dependencies: AIActionsDependencies) {}

    async summarize(editor: Editor, view: MarkdownView | MarkdownFileInfo): Promise<void> {
        if (!this.dependencies.ensureAIConfigured()) return;
        const selection = editor.getSelection();
        const documentText = editor.getValue();

        this.dependencies.log("AI Summary invoked", {
            selectionLength: selection.length,
            documentLength: documentText.length,
        });
        if (!(view instanceof MarkdownView)) return;

        this.dependencies.log("invoking LLM");
        const helper = this.dependencies.createSummaryHelper(editor, view);
        await helper.generate();
    }

    checkFeaturedImage(
        checking: boolean,
        editor: Editor,
        view: MarkdownView | MarkdownFileInfo,
    ): boolean | undefined {
        if (!this.dependencies.getImageGenerationConnection()) return false;
        if (checking) return true;
        void this.openFeaturedImageChat(editor, view);
        return undefined;
    }

    private async openFeaturedImageChat(editor: Editor, view: MarkdownView | MarkdownFileInfo): Promise<void> {
        if (!(view instanceof MarkdownView)) return;
        const hasSelection = (() => {
            try { return editor.getSelection().trim().length > 0; } catch { return false; }
        })();
        const selected = hasSelection ? captureComposerImageTextSource(editor, view, "selection") : null;
        if (hasSelection && !selected) {
            new Notice(pluginT("plugin.chat.createImage.source.selectionInvalid", getPluginUiLanguage()), 5000);
            return;
        }
        const source = selected ?? captureComposerImageTextSource(editor, view, "note");
        if (!hasSelection && !source) {
            new Notice(pluginT("plugin.chat.createImage.source.noteInvalid", getPluginUiLanguage()), 5000);
            return;
        }
        if (!source || !await this.dependencies.openChatImageDraft(source)) {
            new Notice(pluginT("plugin.chat.createImage.commandDraftConflict", getPluginUiLanguage()), 5000);
        }
    }

    openFeaturedImageOptions(): Modal | null {
        if (!this.dependencies.getImageGenerationConnection()) return null;
        return this.dependencies.openSharedFeatureModal({
            defaults: this.dependencies.getFeaturedImageDefaults(),
            saveDefaults: options => this.dependencies.saveFeaturedImageDefaults(options),
            mode: "edit",
        });
    }
}

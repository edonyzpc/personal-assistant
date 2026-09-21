import { MarkdownView, Modal, type Editor, type MarkdownFileInfo } from "obsidian";

import type {
    FeaturedImageDefaults,
    FeaturedImageRunAdmission,
    FeaturedImageRunOptions,
} from "../ai-services/featured-image-options";
import type { ImageGenerationConnection } from "../ai-services/image-generation-connection";
import type { FeaturedImageOptionsModalHost } from "../settings/featured-image-options-modal";

type ProviderConnection = FeaturedImageRunAdmission["connection"];

export interface SummaryHelper {
    generate(): Promise<void>;
}

export interface FeaturedImageHelper {
    generate(options: FeaturedImageRunOptions): Promise<void>;
}

export interface AIActionsDependencies {
    ensureAIConfigured(): boolean;
    getImageGenerationConnection(): ImageGenerationConnection | null;
    getProviderConnection(): ProviderConnection;
    getFeaturedImageDefaults(): FeaturedImageDefaults;
    isUnloading(): boolean;
    hasActiveAIProviderCredentialTransition(): boolean;
    getProviderConfigurationRevision(): number;
    getTokenRevision(): number;
    getFileByPath(path: string): unknown;
    getConfiguredImageAPITokenSecret(): string | null;
    getAPIToken(): Promise<string>;
    saveFeaturedImageDefaults(options: FeaturedImageDefaults): Promise<void>;
    createSummaryHelper(editor: Editor, view: MarkdownView): SummaryHelper;
    createFeaturedImageHelper(editor: Editor, view: MarkdownView): FeaturedImageHelper;
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
        if (view instanceof MarkdownView) {
            this.openFeaturedImageOptions(editor, view);
        }
        return undefined;
    }

    openFeaturedImageOptions(editor?: Editor, view?: MarkdownView): Modal | null {
        if (!this.dependencies.getImageGenerationConnection()) return null;
        if ((editor || view) && (!editor || !view?.file)) return null;

        const defaults = this.dependencies.getFeaturedImageDefaults();
        const saveDefaults = (options: FeaturedImageDefaults) =>
            this.dependencies.saveFeaturedImageDefaults(options);
        const file = view?.file;
        if (!(editor && view && file)) {
            return this.dependencies.openSharedFeatureModal({
                defaults,
                saveDefaults,
                mode: "edit",
            });
        }

        const path = file.path;
        const targetIsCurrent = () => Boolean(editor && view && file && path
            && view.editor === editor && view.file === file && file.path === path
            && view.containerEl.isConnected !== false
            && this.dependencies.getFileByPath(path) === file);
        const prepareRun = (): FeaturedImageRunAdmission | null => {
            if (!targetIsCurrent() || !this.dependencies.ensureAIConfigured()) return null;
            const imageConnection = this.dependencies.getImageGenerationConnection();
            if (!imageConnection) return null;
            const connection = Object.freeze(this.dependencies.getProviderConnection());
            const imageEndpoint = imageConnection.synchronousEndpoint;
            const imageBaseURL = imageConnection.baseURL;
            const getImageAPIToken = async () => {
                const current = this.dependencies.getImageGenerationConnection();
                if (!current || current.mode !== imageConnection.mode
                    || current.baseURL !== imageConnection.baseURL
                    || current.revision !== imageConnection.revision) return '';
                return current.mode === 'dedicated-wan'
                    ? this.dependencies.getConfiguredImageAPITokenSecret() ?? ''
                    : await this.dependencies.getAPIToken();
            };
            const providerRevision = this.dependencies.getProviderConfigurationRevision();
            const tokenRevision = this.dependencies.getTokenRevision();
            return {
                connection,
                imageEndpoint,
                imageBaseURL,
                getImageAPIToken,
                isCurrent: () => !this.dependencies.isUnloading()
                    && !this.dependencies.hasActiveAIProviderCredentialTransition()
                    && this.dependencies.getProviderConfigurationRevision() === providerRevision
                    && this.dependencies.getTokenRevision() === tokenRevision
                    && targetIsCurrent()
                    && this.dependencies.getProviderConnection().aiProvider === connection.aiProvider
                    && this.dependencies.getProviderConnection().baseURL === connection.baseURL
                    && this.dependencies.getProviderConnection().chatModelName === connection.chatModelName
                    && this.currentImageConnectionMatches(imageConnection),
            };
        };

        return this.dependencies.openSharedFeatureModal({
            defaults,
            saveDefaults,
            mode: "generate",
            sourceName: file.basename,
            prepareRun,
            generate: (options) => this.dependencies
                .createFeaturedImageHelper(editor, view)
                .generate(options),
        });
    }

    private currentImageConnectionMatches(imageConnection: ImageGenerationConnection): boolean {
        const current = this.dependencies.getImageGenerationConnection();
        return current?.mode === imageConnection.mode
            && current?.baseURL === imageConnection.baseURL
            && current?.revision === imageConnection.revision;
    }
}

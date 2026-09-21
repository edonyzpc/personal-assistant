/* Copyright 2023 edonyzpc */
import { Editor, MarkdownView, getFrontMatterInfo, type App, type FrontMatterInfo } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { AIService, type AIServiceHost } from './ai-services/service';
import type { FeaturedImageRunOptions } from './ai-services/featured-image-options';

export class AssistantHelper {
    private editor: Editor
    private view: EditorView
    private query: string = ''
    private plugin: AIServiceHost
    private fontmatterInfo: FrontMatterInfo
    private readonly markdownView: MarkdownView;
    private aiService: AIService;

    constructor(
        plugin: AIServiceHost,
        editor: Editor,
        view: MarkdownView,
    ) {
        this.plugin = plugin
        this.editor = editor
        const markdown = this.editor.getValue()
        this.fontmatterInfo = getFrontMatterInfo(markdown);
        this.query = markdown.slice(this.fontmatterInfo.contentStart);
        // @ts-expect-error, not typed
        this.view = view.editor.cm;
        this.markdownView = view;
        this.aiService = new AIService(plugin);
    }

    async generate() {
        await this.aiService.generateSummary(this.editor, this.markdownView);
    }
}

export class AssistantFeaturedImageHelper {
    private app: App;
    private editor: Editor
    private view: MarkdownView
    private plugin: AIServiceHost
    private log: (message: string, ...args: unknown[]) => void;
    private aiService: AIService;

    constructor(
        app: App,
        plugin: AIServiceHost,
        editor: Editor,
        view: MarkdownView,
    ) {
        this.app = app;
        this.plugin = plugin
        this.editor = editor
        this.view = view;
        this.log = (message: string, ...args: unknown[]) => plugin.log(message, ...args);
        this.aiService = new AIService(plugin);
    }

    async generate(options: FeaturedImageRunOptions) {
        await this.aiService.generateFeaturedImage(this.editor, this.view, options);
    }
}

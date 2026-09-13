/* Copyright 2023 edonyzpc */
import { Editor, MarkdownView, getFrontMatterInfo, type App, type FrontMatterInfo } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { AIService } from './ai-services/service';
import type { FeaturedImageRunOptions } from './ai-services/featured-image-options';
import { PluginManager } from './plugin'

export class AssistantHelper {
    private editor: Editor
    private view: EditorView
    private query: string = ''
    private plugin: PluginManager
    private fontmatterInfo: FrontMatterInfo
    private readonly markdownView: MarkdownView;
    private aiService: AIService;

    constructor(
        plugin: PluginManager,
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
    private plugin: PluginManager
    private log: (...msg: unknown[]) => void;
    private aiService: AIService;

    constructor(
        app: App,
        plugin: PluginManager,
        editor: Editor,
        view: MarkdownView,
    ) {
        this.app = app;
        this.plugin = plugin
        this.editor = editor
        this.view = view;
        this.log = (...msg: unknown[]) => plugin.log(...msg);
        this.aiService = new AIService(plugin);
    }

    async generate(options: FeaturedImageRunOptions) {
        await this.aiService.generateFeaturedImage(this.editor, this.view, options);
    }
}

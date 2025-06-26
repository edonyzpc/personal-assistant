/* Copyright 2023 edonyzpc */
import { App, Editor, MarkdownView, getFrontMatterInfo, type FrontMatterInfo } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { AIService } from './ai-services/service';
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

export class AssistantRobot {
    private editor: Editor;
    private view: MarkdownView;
    private query: string = ''
    private selected: string = ''
    private plugin: PluginManager
    private fontmatterInfo: FrontMatterInfo
    private tags: string[]
    private aiService: AIService;

    constructor(
        plugin: PluginManager,
        editor: Editor,
        view: MarkdownView,
        app: App,
        selected: string
    ) {
        this.plugin = plugin
        this.editor = editor
        const markdown = this.editor.getValue()
        this.fontmatterInfo = getFrontMatterInfo(markdown);
        this.query = markdown.slice(this.fontmatterInfo.contentStart);
        this.view = view;
        this.selected = selected
        this.tags = Object.keys((app.metadataCache as any).getTags()); // eslint-disable-line @typescript-eslint/no-explicit-any
        this.aiService = new AIService(plugin);
    }

    async assitantTags() {
        const tags = await this.aiService.generateTags(this.editor, this.view, this.plugin.app);

        if (this.view.file) {
            this.plugin.app.fileManager.processFrontMatter(this.view.file, (frontmatter) => {
                const oldTags = frontmatter["tags"] || [];
                frontmatter["tags"] = oldTags.concat(tags);
            });
        }
    }
}

export class AssistantFeaturedImageHelper {
    private app: App;
    private editor: Editor
    private view: MarkdownView
    private query: string = ''
    private plugin: PluginManager
    private fontmatterInfo: FrontMatterInfo
    private log: any; // eslint-disable-line @typescript-eslint/no-explicit-any
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
        const markdown = this.editor.getValue()
        this.fontmatterInfo = getFrontMatterInfo(markdown);
        this.query = markdown.slice(this.fontmatterInfo.contentStart);
        this.view = view;
        this.log = plugin.log;
        this.aiService = new AIService(plugin);
    }

    async generate() {
        await this.aiService.generateFeaturedImage(this.editor, this.view, this.fontmatterInfo);
    }
}
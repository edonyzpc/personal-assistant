/* Copyright 2023 edonyzpc */
import { App, Editor, MarkdownView, getFrontMatterInfo, type FrontMatterInfo } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { AIService } from './ai-services/service';
import { PluginManager } from './plugin'

/**
 * A helper class for the AI assistant.
 */
export class AssistantHelper {
    private editor: Editor
    private view: EditorView
    private query: string = ''
    private plugin: PluginManager
    private fontmatterInfo: FrontMatterInfo
    private readonly markdownView: MarkdownView;
    private aiService: AIService;

    /**
     * Creates an instance of AssistantHelper.
     * @param plugin - The PluginManager instance.
     * @param editor - The editor instance.
     * @param view - The markdown view instance.
     */
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

    /**
     * Generates a summary for the current document.
     */
    async generate() {
        await this.aiService.generateSummary(this.editor, this.markdownView);
    }
}

/**
 * A class representing the AI assistant robot.
 */
export class AssistantRobot {
    private editor: Editor;
    private view: MarkdownView;
    private query: string = ''
    private selected: string = ''
    private plugin: PluginManager
    private fontmatterInfo: FrontMatterInfo
    private tags: string[]
    private aiService: AIService;

    /**
     * Creates an instance of AssistantRobot.
     * @param plugin - The PluginManager instance.
     * @param editor - The editor instance.
     * @param view - The markdown view instance.
     * @param app - The app instance.
     * @param selected - The selected text.
     */
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

    /**
     * Generates tag suggestions for the current document.
     * @returns The suggested tags as a string.
     */
    async assitantTags() {
        const tags = await this.aiService.generateTags(this.editor, this.view, this.plugin.app);

        if (this.view.file) {
            this.plugin.app.fileManager.processFrontMatter(this.view.file, (frontmatter) => {
                const oldTags = frontmatter["tags"] || [];
                frontmatter["tags"] = oldTags.concat(tags);
            });
        }

        return tags.join(" ");
    }
}

/**
 * A helper class for generating featured images.
 */
export class AssistantFeaturedImageHelper {
    private app: App;
    private editor: Editor
    private view: MarkdownView
    private query: string = ''
    private plugin: PluginManager
    private fontmatterInfo: FrontMatterInfo
    private log: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    private aiService: AIService;

    /**
     * Creates an instance of AssistantFeaturedImageHelper.
     * @param app - The app instance.
     * @param plugin - The PluginManager instance.
     * @param editor - The editor instance.
     * @param view - The markdown view instance.
     */
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

    /**
     * Generates a featured image for the current document.
     */
    async generate() {
        await this.aiService.generateFeaturedImage(this.editor, this.view, this.fontmatterInfo);
    }
}
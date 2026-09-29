/* Copyright 2023 edonyzpc */
import { Editor, MarkdownView, getFrontMatterInfo, type FrontMatterInfo } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { AIService, type AIServiceHost } from './ai-services/service';

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

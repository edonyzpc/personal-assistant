/* Copyright 2023 edonyzpc */
import { Editor, MarkdownView } from 'obsidian';
import { AIService, type AIServiceHost } from './ai-services/service';

export class AssistantHelper {
    private editor: Editor
    private readonly markdownView: MarkdownView;
    private aiService: AIService;

    constructor(
        plugin: AIServiceHost,
        editor: Editor,
        view: MarkdownView,
    ) {
        this.editor = editor
        this.markdownView = view;
        this.aiService = new AIService(plugin);
    }

    async generate() {
        await this.aiService.generateSummary(this.editor, this.markdownView);
    }
}

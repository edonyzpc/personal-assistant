import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, MarkdownView, Notice, ItemView, addIcon, MarkdownRenderer, setIcon } from 'obsidian';

import { ChatOpenAI } from '@langchain/openai';

import type PluginManager from "./main";
import { CryptoHelper, personalAssitant } from './utils';


export const VIEW_TYPE_OLLAMA = "sidellama-view";

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export class OllamaView extends ItemView {
    plugin: PluginManager;;
    result: string = '';
    responseDiv!: HTMLDivElement;
    abortController: AbortController | null = null;
    chatHistory: ChatMessage[] = [];

    constructor(leaf: WorkspaceLeaf, plugin: PluginManager) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_OLLAMA;
    }

    getDisplayText(): string {
        return "Ollama Chat";
    }

    getIcon(): string {
        return "cloud";
    }

    async onOpen() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.classList.add('ollama-view');

        const chatContainer = containerEl.createDiv({ cls: 'ollama-chat-container' });

        const inputDiv = containerEl.createDiv({ cls: 'ollama-input' });
        const textArea = inputDiv.createEl('textarea', {
            attr: { rows: '4', placeholder: 'Type your message here...' }
        });

        textArea.addEventListener('keydown', (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                sendButton.click();
            }
            else if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendButton.click();
            }
        });

        const buttonDiv = inputDiv.createDiv({ cls: 'ollama-buttons' });
        const sendButton = buttonDiv.createEl('button', { text: 'Ask' });
        const clearButton = buttonDiv.createEl('button', { text: 'Clear Chat' });
        const addToEditorButton = buttonDiv.createEl('button', { text: 'Add to Editor' });
        const cancelButton = buttonDiv.createEl('button', { text: '✕', cls: 'cancel-button cancel-button-hidden' });

        addToEditorButton.disabled = true;

        this.responseDiv = chatContainer;

        cancelButton.onclick = () => {
            if (this.abortController) {
                this.abortController.abort();
                this.abortController = null;
                cancelButton.classList.replace('cancel-button-visible', 'cancel-button-hidden');
                sendButton.classList.replace('send-button-hidden', 'send-button-visible');
                new Notice('Generation cancelled');
            }
        };

        const renderMessage = (message: ChatMessage, index?: number) => {
            const messageDiv = this.responseDiv.createDiv({ cls: `ollama-message ${message.role}` });
            const roleLabel = messageDiv.createDiv({ cls: 'message-role', text: message.role === 'user' ? 'You' : 'Assistant' });
            const contentDiv = messageDiv.createDiv({ cls: 'message-content' }) as HTMLElement;
            const actionDiv = messageDiv.createDiv({ cls: 'message-actions' });
            const copyButton = actionDiv.createEl('button', {
                cls: 'message-action-button',
                attr: { 'aria-label': 'Copy message' }
            });
            setIcon(copyButton, 'copy');
            copyButton.onclick = () => {
                navigator.clipboard.writeText(message.content).then(() => {
                    new Notice('Copied to clipboard');
                }).catch(err => {
                    console.error('Could not copy text: ', err);
                });
            };

            if (index !== undefined) {
                const deleteButton = actionDiv.createEl('button', {
                    cls: 'message-action-button',
                    attr: { 'aria-label': 'Delete message' }
                });
                setIcon(deleteButton, 'trash');
                deleteButton.onclick = () => {
                    this.chatHistory.splice(index, 1);
                    this.responseDiv.empty();
                    this.chatHistory.forEach((msg, i) => {
                        renderMessage(msg, i);
                    });

                    new Notice('Message deleted');
                };
            }

            MarkdownRenderer.renderMarkdown(message.content, contentDiv, '', this.plugin);
            this.responseDiv.scrollTo({
                top: this.responseDiv.scrollHeight,
                behavior: 'smooth'
            });
        };

        sendButton.onclick = async () => {
            const prompt = textArea.value;
            if (!prompt) return;

            this.chatHistory.push({ role: 'user', content: prompt });
            renderMessage(this.chatHistory[this.chatHistory.length - 1], this.chatHistory.length - 1);

            textArea.value = '';
            addToEditorButton.disabled = true;

            cancelButton.classList.replace('cancel-button-hidden', 'cancel-button-visible');
            sendButton.classList.replace('send-button-visible', 'send-button-hidden');

            try {
                this.abortController = new AbortController();
                let responseContent = '';
                let streamingMessageEl: HTMLDivElement | null = null;
                let contentDiv: HTMLElement | null = null;

                await this.streamOllama(
                    prompt,
                    (chunk) => {
                        responseContent = chunk;
                        if (!streamingMessageEl) {
                            streamingMessageEl = this.responseDiv.createDiv({ cls: 'ollama-message assistant' });
                            const roleLabel = streamingMessageEl.createDiv({ cls: 'message-role', text: 'Assistant' });
                            contentDiv = streamingMessageEl.createDiv({ cls: 'message-content' });

                            const actionDiv = streamingMessageEl.createDiv({ cls: 'message-actions' });
                            const copyButton = actionDiv.createEl('button', {
                                cls: 'message-action-button',
                                attr: { 'aria-label': 'Copy message' }
                            });
                            setIcon(copyButton, 'copy');
                            copyButton.onclick = () => {
                                navigator.clipboard.writeText(responseContent)
                                    .then(() => new Notice('Copied to clipboard'))
                                    .catch(err => console.error('Could not copy text:', err));
                            };
                        }

                        if (contentDiv) {
                            contentDiv.empty();
                            MarkdownRenderer.renderMarkdown(responseContent, contentDiv, '', this.plugin);
                            this.responseDiv.scrollTo({
                                top: this.responseDiv.scrollHeight,
                                behavior: 'smooth'
                            });
                        }

                        this.result = chunk;
                        addToEditorButton.disabled = false;
                    },
                    this.abortController.signal,
                    this.chatHistory
                );

                this.chatHistory.push({ role: 'assistant', content: responseContent });

                if (streamingMessageEl) {
                    this.responseDiv.removeChild(streamingMessageEl);
                }

                renderMessage(
                    { role: 'assistant', content: responseContent },
                    this.chatHistory.length - 1
                );

            } catch (error) {
                if (error instanceof DOMException && error.name === 'AbortError') {
                    renderMessage({ role: 'assistant', content: '*Generation cancelled*' });
                } else {
                    new Notice('Error: ' + error);
                }
            } finally {
                cancelButton.classList.replace('cancel-button-visible', 'cancel-button-hidden');
                sendButton.classList.replace('send-button-hidden', 'send-button-visible');
                this.abortController = null;
            }
        };

        clearButton.onclick = () => {
            this.chatHistory = [];
            this.responseDiv.empty();
            new Notice('Chat history cleared');
        };

        addToEditorButton.onclick = async () => {
            let targetLeaf = this.app.workspace.getMostRecentLeaf();
            if (!targetLeaf || !(targetLeaf.view instanceof MarkdownView)) {
                const markdownLeaves = this.app.workspace.getLeavesOfType('markdown');
                if (markdownLeaves.length > 0) {
                    targetLeaf = markdownLeaves[0];
                } else {
                    new Notice('Please open a markdown file first');
                    return;
                }
            }

            if (targetLeaf && targetLeaf.view instanceof MarkdownView && this.result) {
                await this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
                const editor = targetLeaf.view.editor;
                const cursor = editor.getCursor();
                editor.replaceRange(this.result, cursor);
                new Notice('Added response to editor');
            }
        };
    }

    async streamOllama(prompt: string, onChunk: (chunk: string) => void, signal?: AbortSignal, chatHistory?: ChatMessage[]): Promise<void> {
        const formattedHistory = (chatHistory || [])
            .map(msg => `${msg.role === 'user' ? 'Human' : 'Assistant'}: ${msg.content}`)
            .join('\n');

        const contextualPrompt = formattedHistory ?
            `${formattedHistory}\nHuman: ${prompt}\nAssistant:` :
            `Human: ${prompt}\nAssistant:`;

        const encryptedToken = this.plugin.settings.apiToken;
        const crypto = new CryptoHelper();
        const token = await crypto.decryptFromBase64(encryptedToken, personalAssitant);
        if (!token) {
            new Notice("Prepare LLM failed!", 3000);
            throw new Error(`LLM error!`);
        }
        const llm = new ChatOpenAI({
            model: "qwen-max",
            apiKey: token,
            configuration: {
                baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            },
            temperature: 0.8,
        });
        const response = await llm.stream(contextualPrompt, { signal: signal });

        let fullResponse = '';
        try {
            for await (const chunk of response) {
                try {
                    const data = chunk.content.toString();
                    fullResponse += data;
                    onChunk(fullResponse);
                } catch (e) {
                    console.error('Error parsing chunk:', e);
                }
            }

            if (signal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }
        } catch (err) {
            throw err;
        }
    }
}
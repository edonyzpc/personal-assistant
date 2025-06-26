import { WorkspaceLeaf, MarkdownView, Notice, ItemView, MarkdownRenderer, TAbstractFile, TFile, Vault, setIcon, debounce } from 'obsidian';
import { ChatService } from './ai-services/chat-service';
import type PluginManager from "./main";
import { VSS } from './vss'

export const VIEW_TYPE_LLM = "sidellm-view";

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export class LLMView extends ItemView {
    plugin: PluginManager;
    result: string = '';
    responseDiv!: HTMLDivElement;
    abortController: AbortController | null = null;
    chatHistory: ChatMessage[] = [];
    vss: VSS;
    private chatService: ChatService;

    constructor(leaf: WorkspaceLeaf, plugin: PluginManager, vss: VSS) {
        super(leaf);
        this.plugin = plugin;
        this.vss = vss;
        this.chatService = new ChatService(plugin);
    }

    getViewType(): string {
        return VIEW_TYPE_LLM;
    }

    getDisplayText(): string {
        return "Personal Assistant Chat";
    }

    getIcon(): string {
        return "bot-message-square";
    }

    async onOpen() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.classList.add('llm-view');

        const chatContainer = containerEl.createDiv({ cls: 'llm-chat-container' });

        const inputDiv = containerEl.createDiv({ cls: 'llm-input' });
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

        const buttonDiv = inputDiv.createDiv({ cls: 'llm-buttons' });
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
            const messageDiv = this.responseDiv.createDiv({ cls: `llm-message ${message.role}` });
            const roleLabel = messageDiv.createDiv({ cls: 'message-role', text: message.role === 'user' ? 'You' : 'Assistant' }); // eslint-disable-line @typescript-eslint/no-unused-vars
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

            MarkdownRenderer.render(this.plugin.app, message.content, contentDiv, '', this.plugin);
            this.responseDiv.scrollTo({
                top: this.responseDiv.scrollHeight,
                behavior: 'smooth'
            });
            this.updateClickableLink(contentDiv);
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

                await this.chatService.streamLLM(
                    prompt,
                    (chunk) => {
                        responseContent = chunk;
                        if (!streamingMessageEl) {
                            streamingMessageEl = this.responseDiv.createDiv({ cls: 'llm-message assistant' });
                            const roleLabel = streamingMessageEl.createDiv({ cls: 'message-role', text: 'Assistant' }); // eslint-disable-line @typescript-eslint/no-unused-vars
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
                            MarkdownRenderer.render(this.plugin.app, responseContent, contentDiv, '', this.plugin);
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
            addToEditorButton.disabled = true;
            new Notice('Chat cleared');
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

        // update vss cache when file is modified(create, modified, delete)
        const vssFiles = this.plugin.getVSSFiles();
        const debounceChange = debounce(
            async (file: TAbstractFile) => {
                // debounce calling
                if (file instanceof TFile) {
                    for (const vssFile of vssFiles) {
                        if (vssFile.path === file.path) {
                            await this.vss.cacheFileVectorStore(file);
                            await this.vss.loadVectorStore([file]);
                        }
                    }
                }
            },
            1200,
            true
        );
        this.app.vault.on("modify", async (file) => {
            debounceChange(file);
        });
        this.app.vault.on("delete", async (file) => {
            const vssFile = this.plugin.join(this.plugin.vssCacheDir, file.path + ".json");
            await this.plugin.app.vault.adapter.remove(vssFile);
            this.plugin.log("delete", vssFile);
            if (file instanceof TFile) {
                await this.vss.loadVectorStore([file], true);
            }
        })
    }

    private updateClickableLink(containerEl: HTMLElement) {
        const isPluginEnabled = (pluginID: string) => {
            return (
                (this.plugin.app as any).plugins.manifests.hasOwnProperty(pluginID) && (this.plugin.app as any).plugins.enabledPlugins.has(pluginID) // eslint-disable-line @typescript-eslint/no-explicit-any
            );
        };
        const getNoteUri = (vault: Vault, noteHref: string) => {
            if (isPluginEnabled("obsidian-advanced-uri")) {
                // Use Advanced URI plugin if it is enabled.
                // obsidian://advanced-uri?vault=<your-vault>&filepath=my-file
                return [
                    "obsidian://advanced-uri?vault=",
                    encodeURIComponent(vault.getName()),
                    "&filepath=",
                    encodeURIComponent(noteHref),
                    "&openmode=true",
                ].join("");
            } else {
                // Use Obsidian default URI
                return [
                    "obsidian://open?vault=",
                    encodeURIComponent(vault.getName()),
                    "&file=",
                    encodeURIComponent(noteHref)
                ].join("");
            }
        };

        const links = containerEl.querySelectorAll("a.internal-link");
        links.forEach((node) => {
            if (!node.getAttribute("href")) {
                return;
            }
            const link = node as HTMLLinkElement;
            // prevents click event from parent element other than the current link element
            link.addEventListener("click", (evt) => {
                evt.stopPropagation();
            });
            // do not change the hyperlink if it is changed
            if (link.href.startsWith("obsidian://")) return;
            link.href = getNoteUri(
                this.plugin.app.vault,
                link.getAttribute("href") as string,
            );
        });
    }
}
import { WorkspaceLeaf, MarkdownView, Notice, ItemView, MarkdownRenderer, Vault, setIcon } from 'obsidian';
import { ChatService } from './ai-services/chat-service';
import type PluginManager from "./main";
import { VSS } from './vss'
import { isPluginEnabled } from './utils';
import { applyPaNoticeShell, buildChatShell, buildPaNoticeContent, createChatMessage } from './ui/pa-dom';

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
        const chatShell = buildChatShell(containerEl);
        const chatContainer = chatShell.scroll;
        const textArea = chatShell.textarea;

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

        const sendButton = chatShell.sendButton;
        const clearButton = chatShell.clearButton;
        const addToEditorButton = chatShell.addButton;
        const cancelButton = chatShell.cancelButton;

        addToEditorButton.disabled = true;

        this.responseDiv = chatContainer;

        cancelButton.onclick = () => {
            if (this.abortController) {
                this.abortController.abort();
                this.abortController = null;
                cancelButton.classList.add('pa-is-hidden');
                sendButton.classList.remove('pa-is-hidden');
                const notice = new Notice(
                    buildPaNoticeContent('Generation cancelled', {
                        showSpinner: true,
                        spinnerVariant: "bar",
                        spinnerTone: "red",
                    }),
                    2200
                );
                applyPaNoticeShell(notice.noticeEl);
            }
        };

        const renderMessage = (message: ChatMessage, index?: number) => {
            const messageEl = createChatMessage(this.responseDiv, message.role, { showDelete: index !== undefined });
            const contentDiv = messageEl.content as HTMLElement;
            const copyButton = messageEl.copyButton;
            setIcon(copyButton, 'copy');
            copyButton.onclick = () => {
                navigator.clipboard.writeText(message.content).then(() => {
                    new Notice('Copied to clipboard');
                }).catch(err => {
                    console.error('Could not copy text: ', err);
                });
            };

            if (index !== undefined && messageEl.deleteButton) {
                const deleteButton = messageEl.deleteButton;
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

            cancelButton.classList.remove('pa-is-hidden');
            sendButton.classList.add('pa-is-hidden');

            try {
                this.abortController = new AbortController();
                let responseContent = '';
                let streamingMessageEl: HTMLDivElement | null = null;
                let contentDiv: HTMLElement | null = null;
                let copyButton: HTMLButtonElement | null = null;

                await this.chatService.streamLLM(
                    prompt,
                    (chunk) => {
                        responseContent = chunk;
                        if (!streamingMessageEl) {
                            const messageEl = createChatMessage(this.responseDiv, 'assistant', { showDelete: false });
                            streamingMessageEl = messageEl.root;
                            contentDiv = messageEl.content;
                            copyButton = messageEl.copyButton;
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
                cancelButton.classList.add('pa-is-hidden');
                sendButton.classList.remove('pa-is-hidden');
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

        void this.vss.loadCachedVectorStore().catch((e) => {
            this.plugin.log("Error loading VSS cache on chat open:", e);
        });
    }

    private updateClickableLink(containerEl: HTMLElement) {
        const getNoteUri = (vault: Vault, noteHref: string) => {
            if (isPluginEnabled(this.plugin.app, "obsidian-advanced-uri")) {
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

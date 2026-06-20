/* Copyright 2023 edonyzpc */

import { App, Component, SuggestModal, MarkdownView, Notice, getIcon } from 'obsidian'
import type {  Callout, CalloutID } from 'obsidian-callout-manager';

import type { PluginManager } from './plugin';
import { type RGB, parseColorRGB } from './color';
import { getPluginUiLanguage, pluginT } from './locales/plugin';
import { getPlatformDocument } from './platform-dom';

export const DEFAULT_CALLOUTS: Callout[] = [
    { id: "note", icon: "pencil", color: "8, 109, 221", sources: [{ type: "builtin" }] },
    { id: "abstract", icon: "clipboard-list", color: "0, 191, 188", sources: [{ type: "builtin" }] },
    { id: "summary", icon: "clipboard-list", color: "0, 191, 188", sources: [{ type: "builtin" }] },
    { id: "tldr", icon: "clipboard-list", color: "0, 191, 188", sources: [{ type: "builtin" }] },
    { id: "info", icon: "info", color: "8, 109, 221", sources: [{ type: "builtin" }] },
    { id: "todo", icon: "check-circle", color: "8, 109, 221", sources: [{ type: "builtin" }] },
    { id: "tip", icon: "flame", color: "0, 191, 188", sources: [{ type: "builtin" }] },
    { id: "hint", icon: "flame", color: "0, 191, 188", sources: [{ type: "builtin" }] },
    { id: "important", icon: "flame", color: "0, 191, 188", sources: [{ type: "builtin" }] },
    { id: "success", icon: "check", color: "8, 185, 78", sources: [{ type: "builtin" }] },
    { id: "check", icon: "check", color: "8, 185, 78", sources: [{ type: "builtin" }] },
    { id: "done", icon: "check", color: "8, 185, 78", sources: [{ type: "builtin" }] },
    { id: "question", icon: "circle-help", color: "236, 117, 0", sources: [{ type: "builtin" }] },
    { id: "help", icon: "circle-help", color: "236, 117, 0", sources: [{ type: "builtin" }] },
    { id: "faq", icon: "circle-help", color: "236, 117, 0", sources: [{ type: "builtin" }] },
    { id: "warning", icon: "triangle-alert", color: "236, 117, 0", sources: [{ type: "builtin" }] },
    { id: "caution", icon: "triangle-alert", color: "236, 117, 0", sources: [{ type: "builtin" }] },
    { id: "attention", icon: "triangle-alert", color: "236, 117, 0", sources: [{ type: "builtin" }] },
    { id: "failure", icon: "x", color: "233, 49, 71", sources: [{ type: "builtin" }] },
    { id: "fail", icon: "x", color: "233, 49, 71", sources: [{ type: "builtin" }] },
    { id: "missing", icon: "x", color: "233, 49, 71", sources: [{ type: "builtin" }] },
    { id: "danger", icon: "zap", color: "233, 49, 71", sources: [{ type: "builtin" }] },
    { id: "error", icon: "zap", color: "233, 49, 71", sources: [{ type: "builtin" }] },
    { id: "bug", icon: "bug", color: "233, 49, 71", sources: [{ type: "builtin" }] },
    { id: "example", icon: "list", color: "120, 82, 238", sources: [{ type: "builtin" }] },
    { id: "quote", icon: "quote-glyph", color: "158, 158, 158", sources: [{ type: "builtin" }] },
    { id: "cite", icon: "quote-glyph", color: "158, 158, 158", sources: [{ type: "builtin" }] },
];


export class CalloutModal extends SuggestModal<Callout> {
    private plugin: PluginManager;
    private fallbackNoticeShown = false;

    constructor(app: App, plugin: PluginManager) {
        super(app);
        this.plugin = plugin;
    }

    private t(key: string): string {
        return pluginT(key, getPluginUiLanguage());
    }

    // Returns all available suggestions.
    getSuggestions(query: string): Callout[] {
        let callouts: ReadonlyArray<Callout> | undefined;
        try {
            callouts = this.plugin.calloutManager?.getCallouts();
        } catch (error) {
            this.plugin.log('Failed to read callouts from Callout Manager', error);
        }

        if (!callouts?.length) {
            this.showFallbackNotice();
            return this.filterCallouts(DEFAULT_CALLOUTS, query);
        }

        return this.filterCallouts(callouts, query);
    }

    // Renders each suggestion item.
    renderSuggestion(callout: Callout, el: HTMLElement) {
        const calloutContainerEl = el.createEl('div');
        calloutContainerEl.classList.add('calloutmanager-preview-container');
        calloutContainerEl.setAttribute('data-callout-manager-callout', callout.id);
        const { icon, id } = callout;
        const color = getColorFromCallout(callout);
        new CalloutPreviewComponent(calloutContainerEl, {
            id,
            icon,
            title: getTitleFromCallout(callout),
            color: color ?? undefined,
        });
    }

    // Perform action on the selected suggestion.
    onChooseSuggestion(callout: Callout, _evt: MouseEvent | KeyboardEvent): void {
        void this.chooseCallout(callout).catch((error) => {
            console.error("Failed to choose callout", error);
        });
    }

    private async chooseCallout(callout: Callout): Promise<void> {
        const title = getTitleFromCallout(callout);
        const calloutMarkdownContent = `
> [!${callout.id}] ${title}
> Contents

`;
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        let inserted = false;
        let activeViewMissing = false;
        if (view) {
            const mode = view.getMode();
            if (mode === "preview") {
                new Notice(this.t("plugin.callout.previewSwitch"), 5000);
            } else {
                const cursor = view.editor.getCursor();
                view.editor.replaceRange(calloutMarkdownContent, cursor);
                // move the cursor down with 4 lines to preview the callout display
                view.editor.setCursor({
                    ...cursor,
                    line: cursor.line + 4,
                });
                inserted = true;
            }
        } else {
            activeViewMissing = true;
        }

        await this.copyCalloutToClipboard(calloutMarkdownContent, inserted, activeViewMissing);
    }

    private filterCallouts(callouts: ReadonlyArray<Callout>, query: string): Callout[] {
        const normalizedQuery = query.toLowerCase();
        return callouts.concat().filter((callout) => callout.id.toLowerCase().includes(normalizedQuery));
    }

    private showFallbackNotice() {
        if (this.fallbackNoticeShown) return;
        this.fallbackNoticeShown = true;
        new Notice(this.t("plugin.callout.fallback"), 5000);
    }

    private async copyCalloutToClipboard(content: string, inserted: boolean, activeViewMissing: boolean) {
        try {
            if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
                throw new Error("Clipboard API is unavailable");
            }
            await navigator.clipboard.writeText(content);
            if (activeViewMissing) {
                new Notice(this.t("plugin.callout.copiedNoEditable"), 5000);
            }
        } catch (error) {
            this.plugin.log("Failed to copy callout markdown to clipboard", error);
            if (!inserted) {
                if (activeViewMissing) {
                    new Notice(this.t("plugin.callout.noEditableNoClipboard"), 5000);
                } else {
                    new Notice(this.t("plugin.callout.copyFailed"), 5000);
                }
            }
        }
    }
}

const NO_ATTACH = Symbol();

export interface PreviewOptions {
    /**
     * The callout ID.
     */
    id: CalloutID;

    /**
     * The icon to display in the callout.
     * This should be known in advance.
     */
    icon: string;

    /**
     * The color of the callout.
     */
    color?: RGB;

    /**
     * The title to show.
     * The callout ID will be used if this is omitted.
     */
    title?: HTMLElement | DocumentFragment | string | ((titleEl: HTMLElement) => unknown);

    /**
     * The content to show.
     */
    content?: HTMLElement | DocumentFragment | string | ((contentEl: HTMLElement) => unknown);
}

/**
 * A component that displays a preview of a callout.
 */
export class CalloutPreviewComponent extends Component {
    public readonly calloutEl: HTMLElement;
    public readonly contentEl: HTMLElement | undefined;
    public readonly titleEl: HTMLElement;
    public readonly iconEl: HTMLElement;

    public constructor(containerEl: HTMLElement | typeof NO_ATTACH, options: PreviewOptions) {
        super();
        const { color, icon, id, title, content } = options;

        const frag = getPlatformDocument().createDocumentFragment();

        // Build the callout.
        const calloutEl = (this.calloutEl = frag.createDiv({ cls: ['callout', 'calloutmanager-preview'] }));
        const titleElContainer = calloutEl.createDiv({ cls: 'callout-title' });
        this.iconEl = titleElContainer.createDiv({ cls: 'callout-icon' });
        const titleEl = (this.titleEl = titleElContainer.createDiv({ cls: 'callout-title-inner' }));
        const contentEl = (this.contentEl =
            content === undefined ? undefined : calloutEl.createDiv({ cls: 'callout-content' }));

        this.setIcon(icon);
        this.setColor(color);
        this.setCalloutID(id);

        // Set the callout title.
        if (title == null) titleEl.textContent = id;
        else if (typeof title === 'function') title(titleEl);
        else if (typeof title === 'string') titleEl.textContent = title;
        else titleEl.appendChild(title);

        // Set the callout contents.
        if (contentEl != null) {
            if (typeof content === 'function') content(contentEl);
            else if (typeof content === 'string') contentEl.textContent = content;
            else contentEl.appendChild(content as HTMLElement | DocumentFragment);
        }

        // Attach to the container.
        if (containerEl != NO_ATTACH) {
            CalloutPreviewComponent.prototype.attachTo.call(this, containerEl);
        }
    }

    /**
     * Changes the callout ID.
     * This will *not* change the appearance of the preview.
     *
     * @param id The new ID to use.
     */
    public setCalloutID(id: string): typeof this {
        const { calloutEl } = this;
        calloutEl.setAttribute('data-callout', id);
        return this;
    }

    /**
     * Changes the callout icon.
     *
     * @param icon The ID of the new icon to use.
     */
    public setIcon(icon: string): typeof this {
        const { iconEl, calloutEl } = this;

        // Change the icon style variable.
        calloutEl.setCssProps({ '--callout-icon': icon });

        // Clear the icon element and append the SVG.
        iconEl.empty();
        const iconSvg = getIcon(icon);
        if (iconSvg != null) {
            this.iconEl.appendChild(iconSvg);
        }

        return this;
    }

    /**
     * Changes the callout color.
     *
     * @param color The color to use.
     */
    public setColor(color: RGB | undefined): typeof this {
        const { calloutEl } = this;

        if (color == null) {
            calloutEl.setCssProps({ '--callout-color': '' });
            return this;
        }

        calloutEl.setCssProps({ '--callout-color': `${color.r}, ${color.g}, ${color.b}` });
        return this;
    }

    /**
     * Attaches the callout preview to a DOM element.
     * This places it at the end of the element.
     *
     * @param containerEl The container to attach to.
     */
    public attachTo(containerEl: HTMLElement): typeof this {
        containerEl.appendChild(this.calloutEl);
        return this;
    }

    /**
     * Resets the `--callout-color` and `--callout-icon` CSS properties added to the callout element.
     */
    public resetStylePropertyOverrides() {
        const { calloutEl } = this;
        calloutEl.setCssProps({
            '--callout-color': '',
            '--callout-icon': '',
        });
    }
}

/**
 * Gets the title of a callout.
 *
 * This should be the same as what Obsidian displays when a callout block does not have a user-specified title.
 *
 * @param callout The callout.
 * @returns The callout's title.
 */
export function getTitleFromCallout(callout: Callout): string {
    const matches = /^(.)(.*)/u.exec(callout.id);
    if (matches == null) return callout.id;

    const firstChar = matches[1].toLocaleUpperCase();
    const remainingChars = matches[2].toLocaleLowerCase().replace(/-+/g, " ");

    return `${firstChar}${remainingChars}`;
}

/**
 * Gets the color (as a {@link RGB}) from a {@link Callout}.
 * This will try to do basic parsing on the color field.
 *
 * @param callout The callout.
 * @returns The callout's color, or null if not valid.
 */
export function getColorFromCallout(callout: Callout): RGB | null {
    return parseColorRGB(`rgb(${callout.color})`);
}

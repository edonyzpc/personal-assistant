import { App, Component, SuggestModal, getIcon } from 'obsidian'
import type {  Callout, CalloutID } from 'obsidian-callout-manager';

import type { PluginManager } from './plugin';
import { type RGB, parseColorRGB } from './color';


export class CalloutModal extends SuggestModal<Callout> {
	private plugin: PluginManager;

    constructor(app: App, plugin: PluginManager) {
        super(app);
		this.plugin = plugin;
    }

    // Returns all available suggestions.
    getSuggestions(query: string): Callout[] {
        const callouts = this.plugin.calloutManager?.getCallouts();
        if (callouts) {
            return callouts.concat().filter((callout) => callout.id.toLowerCase().includes(query.toLowerCase()));
        }
        // default callout
        return [{
                "id": "quote",
                "icon": "quote-glyph",
                "color": "158, 158, 158",
                "sources": [
                    {
                    "type": "builtin"
                    },
                    {
                    "type": "snippet",
                    "snippet": "callout"
                    }
                ]
            }]
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
    async onChooseSuggestion(callout: Callout, evt: MouseEvent | KeyboardEvent) {
        const title = getTitleFromCallout(callout);
        const calloutMarkdownContent = `> [!${callout.id}] ${title}
> Contents

`
        await navigator.clipboard.writeText(calloutMarkdownContent);
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

		const frag = document.createDocumentFragment();

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
		calloutEl.style.setProperty('--callout-icon', icon);

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
			calloutEl.style.removeProperty('--callout-color');
			return this;
		}

		calloutEl.style.setProperty('--callout-color', `${color.r}, ${color.g}, ${color.b}`);
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
		calloutEl.style.removeProperty('--callout-color');
		calloutEl.style.removeProperty('--callout-icon');
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

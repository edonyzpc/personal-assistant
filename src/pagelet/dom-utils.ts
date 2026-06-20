import {
    eventPathContainsSelector,
    getOptionalPlatformDocument,
    getPlatformDocument,
} from "../platform-dom";

export function clearChildren(node: Element): void {
    while (node.firstChild) {
        node.removeChild(node.firstChild);
    }
}

export function createHtmlElement<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
    return getPlatformDocument().createElement(tag);
}

export function appendIconButtonLabel(button: HTMLButtonElement, iconText: string, labelText: string): HTMLSpanElement {
    const icon = createHtmlElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = iconText;
    button.appendChild(icon);

    const label = createHtmlElement("span");
    label.className = "pa-sr-only";
    label.textContent = labelText;
    button.appendChild(label);
    return label;
}

export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
): HTMLElementTagNameMap[K] {
    const node = getPlatformDocument().createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

const OBSIDIAN_MODAL_SELECTOR = ".modal-container, .modal";

export function isObsidianModalOpen(event?: Event): boolean {
    if (event?.defaultPrevented) return true;
    if (event && eventPathContainsSelector(event, OBSIDIAN_MODAL_SELECTOR)) return true;
    const doc = getOptionalPlatformDocument();
    return Boolean(doc?.body?.querySelector(OBSIDIAN_MODAL_SELECTOR));
}

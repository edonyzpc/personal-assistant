import { setIcon, setTooltip } from "obsidian";
import type { GhostCardAction, GhostPublishingSession } from "./controller";

const KEY = "plugin.ghost.card.";
const ACTION_ICONS: Record<GhostCardAction, string> = {
    confirm: "check",
    "open-editor": "edit",
    "open-preview": "eye",
    "open-post": "external-link",
};

/** Human action surface; article content, credentials and preview tokens stay out. */
export function renderGhostPublishingCard(
    container: HTMLElement, session: GhostPublishingSession, t: (key: string) => string,
): () => void {
    const document = container.ownerDocument;
    const card = document.createElement("section");
    card.className = "pa-ghost-publishing-card setting-item-info";
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", t(`${KEY}title`));
    container.appendChild(card);
    const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const render = () => {
        const state = session.getState();
        card.replaceChildren();
        const heading = element("div", state.title);
        heading.className = "setting-item-name";
        card.appendChild(heading);
        card.appendChild(element("div", state.site));
        const status = element("p", t(`${KEY}status.${state.status}`));
        status.className = "setting-item-description";
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        card.appendChild(status);
        if (state.errorKey) card.appendChild(element("p", t(state.errorKey)));
        for (const key of state.warningKeys ?? []) card.appendChild(element("p", t(key)));
        const controls = element("div");
        controls.className = "setting-item-control pa-ghost-card-actions";
        for (const action of state.actions) {
            const label = t(`${KEY}action.${action}`);
            const button = element("button");
            button.type = "button";
            button.disabled = state.busy;
            button.setAttribute("aria-label", label);
            setTooltip(button, label);
            const icon = element("span");
            icon.className = "pa-ghost-card-action__icon";
            icon.setAttribute("aria-hidden", "true");
            setIcon(icon, ACTION_ICONS[action]);
            button.appendChild(icon);
            const labelNode = element("span", label);
            labelNode.className = "pa-ghost-card-action__label";
            button.appendChild(labelNode);
            button.addEventListener("click", () => { void session.run(action); });
            controls.appendChild(button);
        }
        card.appendChild(controls);
    };
    const unsubscribe = session.subscribe(render);
    render();
    return () => { unsubscribe(); session.dispose(); card.remove(); };
}

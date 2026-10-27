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
    container: HTMLElement, session: GhostPublishingSession,
    t: (key: string, params?: Readonly<Record<string, string | number>>) => string,
): () => void {
    const document = container.ownerDocument;
    const card = document.win.createEl("section");
    card.className = "pa-ghost-publishing-card setting-item-info";
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", t(`${KEY}title`));
    container.appendChild(card);
    const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
        const node = document.win.createEl(tag);
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
        if (state.errorKey) card.appendChild(element("p", t(state.errorKey,
            state.sourceLocation ? { path: state.sourceLocation.path, line: state.sourceLocation.line } : undefined)));
        if (state.facts?.httpStatus === 413) {
            card.appendChild(element("p", t(state.facts.stage === "post-save"
                ? "plugin.ghost.card.error.postTooLarge" : "plugin.ghost.card.error.uploadTooLarge")));
        }
        for (const key of state.warningKeys ?? []) card.appendChild(element("p", t(key)));
        if (state.facts) {
            const facts = element("p");
            facts.className = "setting-item-description";
            const parts = [
                t(`plugin.ghost.card.fact.stage.${state.facts.stage}`),
                t(`plugin.ghost.card.fact.effect.${state.facts.postEffect}`),
                t("plugin.ghost.card.fact.uploaded", { count: state.facts.uploadedCount }),
            ];
            if (state.facts.resource) parts.push(t(`plugin.ghost.card.fact.role.${state.facts.resource.role}`, {
                actualBytes: state.facts.resource.actualBytes, limitBytes: state.facts.resource.limitBytes,
            }));
            facts.textContent = parts.join(" ");
            card.appendChild(facts);
        }
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

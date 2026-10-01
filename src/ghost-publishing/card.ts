import { setIcon, setTooltip } from "obsidian";

import type { GhostCardAction, GhostPublishingSession } from "./controller";

const KEY = "plugin.ghost.card.";
const ACTION_ICONS: Record<GhostCardAction, string> = {
    continue: "refresh-cw",
    reprepare: "refresh-ccw",
    "regenerate-metadata": "sparkles",
    "change-draft-url": "link",
    "replace-all": "replace",
    "check-preview": "eye",
    confirm: "check",
    "check-published": "badge-check",
    restore: "undo-2",
    "open-editor": "edit",
    "open-browser": "external-link",
};

/** Human-only action surface. Never renders article bodies, credentials or preview tokens. */
export function renderGhostPublishingCard(
    container: HTMLElement, session: GhostPublishingSession, t: (key: string) => string,
): () => void {
    const document = container.ownerDocument;
    const card = document.createElement("section");
    card.className = "pa-ghost-publishing-card setting-item-info";
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", t(`${KEY}title`));
    container.appendChild(card);
    let replacementPrompt = false;
    let draftUrlPrompt = false;
    let visibilityConfirmed = false;
    let previousOperation: string | undefined;
    const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const run = (action: GhostCardAction, replacementConfirmed = false) => {
        replacementPrompt = false;
        draftUrlPrompt = false;
        void session.run(action, { visibilityConfirmed, replacementConfirmed });
    };
    const render = () => {
        const state = session.getState();
        if (state.busy || state.operationId !== previousOperation || !state.actions.includes("confirm")) {
            visibilityConfirmed = false;
            previousOperation = state.operationId;
        }
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
        if (state.previewReasonKey) card.appendChild(element("p", t(state.previewReasonKey)));
        for (const key of state.warningKeys ?? []) card.appendChild(element("p", t(key)));
        if (state.visibilityChange && state.actions.includes("confirm")) {
            const label = element("label");
            const input = element("input");
            input.type = "checkbox";
            input.checked = visibilityConfirmed;
            input.disabled = state.busy;
            const from = t(`${KEY}visibility.${state.visibilityChange.from}`);
            const to = t(`${KEY}visibility.${state.visibilityChange.to}`);
            label.appendChild(input);
            label.appendChild(document.createTextNode(` ${t(`${KEY}visibilityConfirm`)} (${from} → ${to})`));
            input.addEventListener("change", () => { visibilityConfirmed = input.checked; render(); });
            card.appendChild(label);
        }
        const controls = element("div");
        controls.className = "setting-item-control pa-ghost-card-actions";
        const button = (label: string, action: () => void, disabled = false, iconId?: string) => {
            const node = element("button");
            node.type = "button";
            node.setAttribute("aria-label", label);
            setTooltip(node, label);
            if (iconId) {
                const iconNode = element("span");
                iconNode.className = "pa-ghost-card-action__icon";
                iconNode.setAttribute("aria-hidden", "true");
                setIcon(iconNode, iconId);
                node.appendChild(iconNode);
            }
            const labelNode = element("span", label);
            labelNode.className = "pa-ghost-card-action__label";
            node.appendChild(labelNode);
            node.disabled = state.busy || disabled;
            node.addEventListener("click", action);
            controls.appendChild(node);
        };
        if (replacementPrompt && state.actions.includes("replace-all")) {
            card.appendChild(element("p", t(`${KEY}replacePrompt`)));
            button(t(`${KEY}replaceConfirm`), () => run("replace-all", true), false, "check");
            button(t(`${KEY}cancel`), () => { replacementPrompt = false; render(); }, false, "x");
        } else if (draftUrlPrompt && state.actions.includes("change-draft-url")) {
            card.appendChild(element("p", t(`${KEY}draftUrlPrompt`)));
            button(t(`${KEY}draftUrlConfirm`), () => run("change-draft-url"), false, "check");
            button(t(`${KEY}cancel`), () => { draftUrlPrompt = false; render(); }, false, "x");
        } else {
            for (const action of state.actions) {
                const labelKey = action === "confirm" && state.operationKind === "restore"
                    ? `${KEY}action.confirmRestore`
                    : `${KEY}action.${action}`;
                button(t(labelKey), () => {
                    if (action === "replace-all") { replacementPrompt = true; render(); }
                    else if (action === "change-draft-url") { draftUrlPrompt = true; render(); }
                    else run(action);
                }, action === "confirm" && !!state.visibilityChange && !visibilityConfirmed, ACTION_ICONS[action]);
            }
        }
        card.appendChild(controls);
    };
    const unsubscribe = session.subscribe(render);
    render();
    return () => { unsubscribe(); session.dispose(); card.remove(); };
}

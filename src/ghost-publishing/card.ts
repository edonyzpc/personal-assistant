import type { GhostCardAction, GhostPublishingSession } from "./controller";

const KEY = "plugin.ghost.card.";

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
    let visibilityConfirmed = false;
    let previousOperation: string | undefined;
    const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const run = (action: GhostCardAction, replacementConfirmed = false) => {
        replacementPrompt = false;
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
        controls.className = "setting-item-control";
        const button = (label: string, action: () => void, disabled = false) => {
            const node = element("button", label);
            node.type = "button";
            node.disabled = state.busy || disabled;
            node.addEventListener("click", action);
            controls.appendChild(node);
        };
        if (replacementPrompt && state.actions.includes("replace-all")) {
            card.appendChild(element("p", t(`${KEY}replacePrompt`)));
            button(t(`${KEY}replaceConfirm`), () => run("replace-all", true));
            button(t(`${KEY}cancel`), () => { replacementPrompt = false; render(); });
        } else {
            for (const action of state.actions) {
                const labelKey = action === "confirm" && state.operationKind === "restore"
                    ? `${KEY}action.confirmRestore`
                    : `${KEY}action.${action}`;
                button(t(labelKey), () => {
                    if (action === "replace-all") { replacementPrompt = true; render(); }
                    else run(action);
                }, action === "confirm" && !!state.visibilityChange && !visibilityConfirmed);
            }
        }
        card.appendChild(controls);
    };
    const unsubscribe = session.subscribe(render);
    render();
    return () => { unsubscribe(); session.dispose(); card.remove(); };
}

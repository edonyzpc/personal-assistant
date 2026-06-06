/* Copyright 2023 edonyzpc */

/**
 * Pagelet (Review Assistant) v1 — SuggestionCard DOM renderer.
 *
 * Same architecture as `mascot/dom-renderer.ts`:
 *  - Pure markup builder upstream (`markup.ts`).
 *  - This file mounts the descriptor into real DOM and wires the
 *    click callbacks. State changes go through `update(nextProps)`,
 *    which rebuilds the tree end-to-end. Cards are small (≤ 50
 *    nodes) so a full rebuild is cheaper than diff bookkeeping.
 *  - Test seam: `createSuggestionCardRendererWithHost(host, ...)`
 *    accepts a recording DOM host so unit specs can assert
 *    structure / callback wiring without depending on jsdom.
 */

import {
    pageletT,
    type PageletLocale,
} from "../../../locales/pagelet";
import {
    buildSuggestionCardMarkup,
    type SuggestionCardMarkup,
} from "./markup";
import type {
    PageletSuggestion,
    SuggestionCardProps,
    SuggestionCardRenderer,
    SuggestionCardRendererOptions,
    SuggestionCardTranslator,
} from "./types";

// ---------------------------------------------------------------------------
// DOM host abstraction (mirrors mascot)
// ---------------------------------------------------------------------------

export interface SuggestionCardDomNode {
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
    appendChild<T extends SuggestionCardDomNode>(child: T): T;
    setText(text: string): void;
    setClassList(classes: readonly string[]): void;
    setStyleProperty(name: string, value: string): void;
    addEventListener(event: string, handler: (e: unknown) => void): void;
    removeEventListener(event: string, handler: (e: unknown) => void): void;
    remove(): void;
}

export interface SuggestionCardDomHost {
    createHtmlElement(tag: string): SuggestionCardDomNode;
}

class RealDomNode implements SuggestionCardDomNode {
    private readonly _listeners: { event: string; handler: EventListener }[] = [];

    constructor(private readonly el: Element) { }

    setAttribute(name: string, value: string): void {
        this.el.setAttribute(name, value);
    }
    removeAttribute(name: string): void {
        this.el.removeAttribute(name);
    }
    appendChild<T extends SuggestionCardDomNode>(child: T): T {
        const target = (child as unknown as RealDomNode).el;
        this.el.appendChild(target);
        return child;
    }
    setText(text: string): void {
        this.el.textContent = text;
    }
    setClassList(classes: readonly string[]): void {
        this.el.setAttribute("class", classes.join(" "));
    }
    setStyleProperty(name: string, value: string): void {
        const styled = this.el as Element & { style?: { setProperty?: (n: string, v: string) => void } };
        styled.style?.setProperty?.(name, value);
    }
    addEventListener(event: string, handler: (e: unknown) => void): void {
        const wrapped = handler as EventListener;
        this._listeners.push({ event, handler: wrapped });
        this.el.addEventListener(event, wrapped);
    }
    removeEventListener(event: string, handler: (e: unknown) => void): void {
        const wrapped = handler as EventListener;
        this.el.removeEventListener(event, wrapped);
        const idx = this._listeners.findIndex(
            (entry) => entry.event === event && entry.handler === wrapped,
        );
        if (idx >= 0) this._listeners.splice(idx, 1);
    }
    remove(): void {
        // Tear down all listeners we ourselves registered to avoid
        // leaks when the card is destroyed by an unrelated tree edit.
        for (const { event, handler } of this._listeners.splice(0)) {
            this.el.removeEventListener(event, handler);
        }
        if (this.el.parentElement) {
            this.el.parentElement.removeChild(this.el);
        }
    }
    raw(): Element {
        return this.el;
    }
}

class RealDomHost implements SuggestionCardDomHost {
    createHtmlElement(tag: string): SuggestionCardDomNode {
        return new RealDomNode(document.createElement(tag));
    }
}

function wrapRealElement(el: Element): SuggestionCardDomNode {
    return new RealDomNode(el);
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

interface InternalRendererOptions extends SuggestionCardRendererOptions {
    host: SuggestionCardDomHost;
}

/**
 * Production entry point. Mounts a SuggestionCard under `parentEl`
 * and returns a handle for in-place updates / teardown.
 */
export function createSuggestionCardRenderer(
    parentEl: HTMLElement,
    props: SuggestionCardProps,
    options: SuggestionCardRendererOptions = {},
): SuggestionCardRenderer {
    return createSuggestionCardRendererWithHost(
        wrapRealElement(parentEl),
        props,
        { ...options, host: new RealDomHost() },
    );
}

/**
 * Lower-level entry used by tests. Production callers should use
 * `createSuggestionCardRenderer`.
 */
export function createSuggestionCardRendererWithHost(
    parentNode: SuggestionCardDomNode,
    initialProps: SuggestionCardProps,
    options: InternalRendererOptions,
): SuggestionCardRenderer {
    const locale = options.locale ?? "en";
    const translator = options.translator ?? defaultTranslator(locale);
    const host = options.host;

    let currentProps: SuggestionCardProps = initialProps;
    let root: SuggestionCardDomNode | null = null;

    function mount(props: SuggestionCardProps): void {
        if (root) root.remove();
        const markup = buildSuggestionCardMarkup(props, { translator });
        root = renderCard(host, markup, props);
        parentNode.appendChild(root);
    }

    mount(initialProps);

    return {
        get props(): SuggestionCardProps {
            return currentProps;
        },
        update(nextProps: SuggestionCardProps): void {
            currentProps = nextProps;
            mount(nextProps);
        },
        destroy(): void {
            if (root) {
                root.remove();
                root = null;
            }
        },
    };
}

// ---------------------------------------------------------------------------
// Internals — DOM construction from markup descriptor
// ---------------------------------------------------------------------------

function renderCard(
    host: SuggestionCardDomHost,
    markup: SuggestionCardMarkup,
    props: SuggestionCardProps,
): SuggestionCardDomNode {
    const root = host.createHtmlElement("div");
    root.setClassList(markup.rootClassList);
    root.setAttribute("data-suggestion-kind", markup.header.kind);
    root.setAttribute("role", "article");

    root.appendChild(renderHeader(host, markup));
    root.appendChild(renderSource(host, markup, props));
    root.appendChild(renderRationale(host, markup));
    root.appendChild(renderAction(host, markup));
    if (markup.related) root.appendChild(renderRelated(host, markup.related, props));
    root.appendChild(renderFooter(host, markup, props));

    return root;
}

function renderHeader(host: SuggestionCardDomHost, markup: SuggestionCardMarkup): SuggestionCardDomNode {
    const header = host.createHtmlElement("header");
    header.setClassList(["pa-pagelet-suggestion-card__header"]);

    const kindBadge = host.createHtmlElement("span");
    kindBadge.setClassList(markup.header.kindBadgeClassList);
    kindBadge.setAttribute("data-kind", markup.header.kind);
    kindBadge.setText(markup.header.kindLabel);
    header.appendChild(kindBadge);

    if (markup.header.badges.length > 0) {
        const badgeRow = host.createHtmlElement("span");
        badgeRow.setClassList(["pa-pagelet-suggestion-card__badges"]);
        for (const badge of markup.header.badges) {
            const badgeEl = host.createHtmlElement("span");
            badgeEl.setClassList(badge.className.split(" "));
            badgeEl.setAttribute("data-badge", badge.kind);
            badgeEl.setText(badge.label);
            badgeRow.appendChild(badgeEl);
        }
        header.appendChild(badgeRow);
    }

    return header;
}

function renderSource(
    host: SuggestionCardDomHost,
    markup: SuggestionCardMarkup,
    props: SuggestionCardProps,
): SuggestionCardDomNode {
    const section = host.createHtmlElement("section");
    section.setClassList(["pa-pagelet-suggestion-card__source"]);

    const label = host.createHtmlElement("span");
    label.setClassList(["pa-pagelet-suggestion-card__section-label"]);
    label.setText(markup.source.label);
    section.appendChild(label);

    const chipTag = markup.source.interactive ? "button" : "span";
    const chip = host.createHtmlElement(chipTag);
    chip.setClassList(markup.source.chipClassList);
    chip.setAttribute("data-source-id", markup.source.sourceId);
    if (markup.source.interactive) {
        chip.setAttribute("type", "button");
        chip.addEventListener("click", () => {
            props.onSourceClick?.(markup.source.sourceId);
        });
    }
    chip.setText(markup.source.sourceId);
    section.appendChild(chip);

    return section;
}

function renderRationale(host: SuggestionCardDomHost, markup: SuggestionCardMarkup): SuggestionCardDomNode {
    const section = host.createHtmlElement("section");
    section.setClassList(["pa-pagelet-suggestion-card__rationale"]);

    const label = host.createHtmlElement("span");
    label.setClassList(["pa-pagelet-suggestion-card__section-label"]);
    label.setText(markup.rationale.label);
    section.appendChild(label);

    const body = host.createHtmlElement("p");
    body.setClassList(["pa-pagelet-suggestion-card__rationale-text"]);
    body.setText(markup.rationale.text);
    section.appendChild(body);

    return section;
}

function renderAction(host: SuggestionCardDomHost, markup: SuggestionCardMarkup): SuggestionCardDomNode {
    const section = host.createHtmlElement("section");
    section.setClassList(["pa-pagelet-suggestion-card__action"]);

    const label = host.createHtmlElement("span");
    label.setClassList(["pa-pagelet-suggestion-card__section-label"]);
    label.setText(markup.action.label);
    section.appendChild(label);

    const body = host.createHtmlElement("p");
    body.setClassList(["pa-pagelet-suggestion-card__action-text"]);
    body.setText(markup.action.text);
    section.appendChild(body);

    return section;
}

function renderRelated(
    host: SuggestionCardDomHost,
    related: NonNullable<SuggestionCardMarkup["related"]>,
    props: SuggestionCardProps,
): SuggestionCardDomNode {
    const section = host.createHtmlElement("section");
    section.setClassList(["pa-pagelet-suggestion-card__related"]);

    const label = host.createHtmlElement("span");
    label.setClassList(["pa-pagelet-suggestion-card__section-label"]);
    label.setText(related.label);
    section.appendChild(label);

    const list = host.createHtmlElement("ul");
    list.setClassList(["pa-pagelet-suggestion-card__related-list"]);
    for (const item of related.items) {
        const li = host.createHtmlElement("li");
        li.setClassList(["pa-pagelet-suggestion-card__related-item"]);
        if (item.interactive) {
            const button = host.createHtmlElement("button");
            button.setClassList(["pa-pagelet-suggestion-card__related-button"]);
            button.setAttribute("type", "button");
            button.setText(item.name);
            button.addEventListener("click", () => {
                props.onRelatedNoteClick?.(item.name, props.suggestion);
            });
            li.appendChild(button);
        } else {
            li.setText(item.name);
        }
        list.appendChild(li);
    }
    section.appendChild(list);

    return section;
}

function renderFooter(
    host: SuggestionCardDomHost,
    markup: SuggestionCardMarkup,
    props: SuggestionCardProps,
): SuggestionCardDomNode {
    const footer = host.createHtmlElement("footer");
    footer.setClassList(["pa-pagelet-suggestion-card__footer"]);

    if (markup.footer.showResearch) {
        const researchBtn = makeFooterButton(
            host,
            "pa-pagelet-suggestion-card__btn--research",
            markup.footer.researchLabel,
            markup.footer.researchAriaLabel,
        );
        researchBtn.addEventListener("click", () => {
            invokeWithSuggestion(props.onResearch, props.suggestion);
        });
        footer.appendChild(researchBtn);
    }

    if (markup.footer.showAccept) {
        const acceptBtn = makeFooterButton(
            host,
            "pa-pagelet-suggestion-card__btn--accept",
            markup.footer.acceptLabel,
            markup.footer.acceptAriaLabel,
        );
        acceptBtn.addEventListener("click", () => {
            invokeWithSuggestion(props.onAccept, props.suggestion);
        });
        footer.appendChild(acceptBtn);
    }

    if (markup.footer.showDismiss) {
        const dismissBtn = makeFooterButton(
            host,
            "pa-pagelet-suggestion-card__btn--dismiss",
            markup.footer.dismissLabel,
            markup.footer.dismissAriaLabel,
        );
        dismissBtn.addEventListener("click", () => {
            invokeWithSuggestion(props.onDismiss, props.suggestion);
        });
        footer.appendChild(dismissBtn);
    }

    if (markup.footer.cost) {
        const costEl = host.createHtmlElement("span");
        costEl.setClassList(["pa-pagelet-suggestion-card__cost"]);
        costEl.setAttribute("data-pricing-known", String(markup.footer.cost.pricingKnown));
        costEl.setText(`${markup.footer.cost.label}: ${markup.footer.cost.usd}`);
        footer.appendChild(costEl);
    }

    return footer;
}

function makeFooterButton(
    host: SuggestionCardDomHost,
    extraClass: string,
    label: string,
    ariaLabel: string,
): SuggestionCardDomNode {
    const btn = host.createHtmlElement("button");
    btn.setClassList(["pa-pagelet-suggestion-card__btn", extraClass]);
    btn.setAttribute("type", "button");
    btn.setAttribute("aria-label", ariaLabel);
    btn.setText(label);
    return btn;
}

function invokeWithSuggestion(
    handler: ((s: PageletSuggestion) => void) | undefined,
    suggestion: PageletSuggestion,
): void {
    if (typeof handler === "function") handler(suggestion);
}

function defaultTranslator(locale: PageletLocale): SuggestionCardTranslator {
    return (key, fallback) => pageletT(key, locale, undefined, fallback);
}

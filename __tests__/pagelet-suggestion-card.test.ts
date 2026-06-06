/* Copyright 2023 edonyzpc */

/**
 * Track B · B2 unit tests for the Pagelet SuggestionCard UI.
 *
 * Coverage matrix (mapped to SDD §10.2 + visual spec §③):
 *  - 5 區塊 rendering: header / source / rationale / action / related.
 *  - Diagnostics → 3 badges: truncated / partial / dropped.
 *  - Kind enum coverage: every PAGELET_SUGGESTION_KIND maps to a
 *    translated badge label.
 *  - Callback wiring: onSourceClick, onAccept, onDismiss propagation.
 *  - Cost footer: known pricing → formatted USD, unknown → "~$?".
 *  - i18n parity: real `pageletT` resolves all labels in EN/ZH.
 */

import { describe, expect, it, jest } from "@jest/globals";

import {
    PAGELET_SUGGESTION_KINDS,
    type PageletSuggestion,
} from "../src/pagelet/pa-review-schemas";
import {
    SUGGESTION_BADGE_KINDS,
    SUGGESTION_KIND_I18N_KEY,
    buildSuggestionCardMarkup,
    type SuggestionCardProps,
    type SuggestionCardTranslator,
} from "../src/ui/pagelet/suggestion-card";
import {
    createSuggestionCardRendererWithHost,
    type SuggestionCardDomHost,
    type SuggestionCardDomNode,
} from "../src/ui/pagelet/suggestion-card/dom-renderer";
import { pageletT } from "../src/locales/pagelet";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSuggestion(overrides: Partial<PageletSuggestion> = {}): PageletSuggestion {
    return {
        source_id: "seg-3",
        kind: "clarify",
        rationale: "needs a clearer scope sentence so the reader understands applicability",
        proposed_action: "add a one-sentence scope note immediately after the opening line",
        related_notes: ["[[Concept X]]", "[[2026-week-22]]"],
        ...overrides,
    };
}

function keyTranslator(): SuggestionCardTranslator {
    return (key, fallback) => fallback ?? key;
}

function recordingTranslator(): {
    translator: SuggestionCardTranslator;
    calls: { key: string; fallback?: string }[];
} {
    const calls: { key: string; fallback?: string }[] = [];
    const translator: SuggestionCardTranslator = (key, fallback) => {
        calls.push({ key, fallback });
        return fallback ?? key;
    };
    return { translator, calls };
}

// ---------------------------------------------------------------------------
// Stub DOM host
// ---------------------------------------------------------------------------

interface StubNode extends SuggestionCardDomNode {
    tag: string;
    attrs: Record<string, string>;
    classList: string[];
    style: Record<string, string>;
    text: string;
    children: StubNode[];
    parent: StubNode | null;
    listeners: { event: string; handler: (e: unknown) => void }[];
    dispatch(event: string, payload?: unknown): void;
}

function makeStubNode(tag: string): StubNode {
    const node = {
        tag,
        attrs: {} as Record<string, string>,
        classList: [] as string[],
        style: {} as Record<string, string>,
        text: "",
        children: [] as StubNode[],
        parent: null as StubNode | null,
        listeners: [] as { event: string; handler: (e: unknown) => void }[],
    } as StubNode;
    node.setAttribute = (name, value) => {
        node.attrs[name] = value;
        // Keep classList in sync with the "class" attribute.
        if (name === "class") {
            node.classList = value.length > 0 ? value.split(/\s+/) : [];
        }
    };
    node.removeAttribute = (name) => { delete node.attrs[name]; };
    node.appendChild = ((child) => {
        const stub = child as unknown as StubNode;
        stub.parent = node;
        node.children.push(stub);
        return child;
    }) as StubNode["appendChild"];
    node.setText = (text) => { node.text = text; };
    node.setClassList = (classes) => {
        node.classList = [...classes];
        node.attrs["class"] = classes.join(" ");
    };
    node.setStyleProperty = (name, value) => { node.style[name] = value; };
    node.addEventListener = (event, handler) => {
        node.listeners.push({ event, handler });
    };
    node.removeEventListener = (event, handler) => {
        const idx = node.listeners.findIndex(
            (entry) => entry.event === event && entry.handler === handler,
        );
        if (idx >= 0) node.listeners.splice(idx, 1);
    };
    node.remove = () => {
        if (node.parent) {
            const idx = node.parent.children.indexOf(node);
            if (idx >= 0) node.parent.children.splice(idx, 1);
            node.parent = null;
        }
    };
    node.dispatch = (event, payload) => {
        for (const entry of node.listeners) {
            if (entry.event === event) entry.handler(payload);
        }
    };
    return node;
}

function makeStubHost(): { host: SuggestionCardDomHost; root: StubNode } {
    const root = makeStubNode("__root__");
    const host: SuggestionCardDomHost = {
        createHtmlElement(tag) {
            return makeStubNode(tag);
        },
    };
    return { host, root };
}

function findByClass(node: StubNode, cls: string): StubNode {
    const results: StubNode[] = [];
    const walk = (n: StubNode) => {
        if (n.classList.includes(cls)) results.push(n);
        for (const c of n.children) walk(c);
    };
    walk(node);
    if (results.length === 0) throw new Error(`no node with class ${cls}`);
    if (results.length > 1) throw new Error(`multiple (${results.length}) with class ${cls}`);
    return results[0];
}

function findAllByClass(node: StubNode, cls: string): StubNode[] {
    const results: StubNode[] = [];
    const walk = (n: StubNode) => {
        if (n.classList.includes(cls)) results.push(n);
        for (const c of n.children) walk(c);
    };
    walk(node);
    return results;
}

// ---------------------------------------------------------------------------
// buildSuggestionCardMarkup — 5 sections coverage
// ---------------------------------------------------------------------------

describe("buildSuggestionCardMarkup — 5 sections", () => {
    const baseProps = (): SuggestionCardProps => ({
        suggestion: makeSuggestion(),
    });

    it("renders the canonical root class list with kind modifier", () => {
        const markup = buildSuggestionCardMarkup(baseProps(), { translator: keyTranslator() });
        expect(markup.rootClassList).toEqual([
            "pa-pagelet-suggestion-card",
            "pa-pagelet-suggestion-card--kind-clarify",
        ]);
    });

    it("renders section 1 (header) with kind badge", () => {
        const markup = buildSuggestionCardMarkup(baseProps(), { translator: keyTranslator() });
        expect(markup.header.kind).toBe("clarify");
        expect(markup.header.kindLabel).toBe("Clarify");
        expect(markup.header.kindBadgeClassList).toEqual([
            "pa-pagelet-suggestion-card__kind",
            "pa-pagelet-suggestion-card__kind--clarify",
        ]);
    });

    it("renders section 2 (source) with the source id and label", () => {
        const markup = buildSuggestionCardMarkup(baseProps(), { translator: keyTranslator() });
        expect(markup.source.sourceId).toBe("seg-3");
        expect(markup.source.label).toBe("Source");
        // No callback → non-interactive chip.
        expect(markup.source.interactive).toBe(false);
        expect(markup.source.chipClassList).toContain(
            "pa-pagelet-suggestion-card__source-chip--static",
        );
    });

    it("marks the source chip interactive when onSourceClick is supplied", () => {
        const markup = buildSuggestionCardMarkup(
            { ...baseProps(), onSourceClick: () => undefined },
            { translator: keyTranslator() },
        );
        expect(markup.source.interactive).toBe(true);
        expect(markup.source.chipClassList).toContain(
            "pa-pagelet-suggestion-card__source-chip--interactive",
        );
    });

    it("renders section 3 (rationale) with the suggestion text", () => {
        const markup = buildSuggestionCardMarkup(baseProps(), { translator: keyTranslator() });
        expect(markup.rationale.label).toBe("Why");
        expect(markup.rationale.text).toBe(
            "needs a clearer scope sentence so the reader understands applicability",
        );
    });

    it("renders section 4 (proposed action) with the action text", () => {
        const markup = buildSuggestionCardMarkup(baseProps(), { translator: keyTranslator() });
        expect(markup.action.label).toBe("Suggested action");
        expect(markup.action.text).toBe(
            "add a one-sentence scope note immediately after the opening line",
        );
    });

    it("renders section 5 (related notes) when related_notes is non-empty", () => {
        const markup = buildSuggestionCardMarkup(baseProps(), { translator: keyTranslator() });
        expect(markup.related).not.toBeNull();
        expect(markup.related!.items).toHaveLength(2);
        expect(markup.related!.items.map((i) => i.name)).toEqual([
            "[[Concept X]]",
            "[[2026-week-22]]",
        ]);
        expect(markup.related!.items.every((i) => i.interactive === false)).toBe(true);
    });

    it("marks related notes interactive when the callback is supplied", () => {
        const markup = buildSuggestionCardMarkup(
            { ...baseProps(), onRelatedNoteClick: () => undefined },
            { translator: keyTranslator() },
        );
        expect(markup.related!.items.every((i) => i.interactive === true)).toBe(true);
    });

    it("omits section 5 when related_notes is empty / undefined", () => {
        const emptyArrayMarkup = buildSuggestionCardMarkup(
            { suggestion: makeSuggestion({ related_notes: [] }) },
            { translator: keyTranslator() },
        );
        expect(emptyArrayMarkup.related).toBeNull();

        const undefinedMarkup = buildSuggestionCardMarkup(
            { suggestion: makeSuggestion({ related_notes: undefined }) },
            { translator: keyTranslator() },
        );
        expect(undefinedMarkup.related).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Diagnostics badges — 3 badge coverage
// ---------------------------------------------------------------------------

describe("buildSuggestionCardMarkup — diagnostic badges", () => {
    it("renders no badges when diagnostics is omitted", () => {
        const markup = buildSuggestionCardMarkup(
            { suggestion: makeSuggestion() },
            { translator: keyTranslator() },
        );
        expect(markup.header.badges).toHaveLength(0);
    });

    it("renders the truncated badge when diagnostics.truncated", () => {
        const markup = buildSuggestionCardMarkup(
            {
                suggestion: makeSuggestion(),
                diagnostics: {
                    truncated: true,
                    partial: false,
                    droppedSuggestionsCount: 0,
                },
            },
            { translator: keyTranslator() },
        );
        expect(markup.header.badges).toHaveLength(1);
        expect(markup.header.badges[0].kind).toBe("truncated");
        expect(markup.header.badges[0].label).toBe("Shortened by Pagelet");
        expect(markup.header.badges[0].className).toContain("--truncated");
    });

    it("renders the partial badge when diagnostics.partial", () => {
        const markup = buildSuggestionCardMarkup(
            {
                suggestion: makeSuggestion(),
                diagnostics: {
                    truncated: false,
                    partial: true,
                    droppedSuggestionsCount: 0,
                },
            },
            { translator: keyTranslator() },
        );
        expect(markup.header.badges).toHaveLength(1);
        expect(markup.header.badges[0].kind).toBe("partial");
        expect(markup.header.badges[0].label).toBe("Partial");
        expect(markup.header.badges[0].className).toContain("--partial");
    });

    it("renders the dropped badge when droppedSuggestionsCount > 0", () => {
        const markup = buildSuggestionCardMarkup(
            {
                suggestion: makeSuggestion(),
                diagnostics: {
                    truncated: false,
                    partial: false,
                    droppedSuggestionsCount: 2,
                },
            },
            { translator: keyTranslator() },
        );
        expect(markup.header.badges).toHaveLength(1);
        expect(markup.header.badges[0].kind).toBe("dropped");
        expect(markup.header.badges[0].label).toBe("Dropped 2");
        expect(markup.header.badges[0].className).toContain("--dropped");
    });

    it("renders all 3 badges when all 3 diagnostic conditions trigger", () => {
        const markup = buildSuggestionCardMarkup(
            {
                suggestion: makeSuggestion(),
                diagnostics: {
                    truncated: true,
                    partial: true,
                    droppedSuggestionsCount: 5,
                },
            },
            { translator: keyTranslator() },
        );
        expect(markup.header.badges).toHaveLength(3);
        const kinds = markup.header.badges.map((b) => b.kind);
        expect(kinds).toEqual([...SUGGESTION_BADGE_KINDS]);
    });

    it("does NOT trigger the dropped badge when count is 0", () => {
        const markup = buildSuggestionCardMarkup(
            {
                suggestion: makeSuggestion(),
                diagnostics: {
                    truncated: false,
                    partial: false,
                    droppedSuggestionsCount: 0,
                },
            },
            { translator: keyTranslator() },
        );
        expect(markup.header.badges).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Kind enum coverage
// ---------------------------------------------------------------------------

describe("buildSuggestionCardMarkup — kind enum", () => {
    it.each(PAGELET_SUGGESTION_KINDS)(
        "maps kind=%s to a translated badge label and class modifier",
        (kind) => {
            const { translator, calls } = recordingTranslator();
            const markup = buildSuggestionCardMarkup(
                { suggestion: makeSuggestion({ kind }) },
                { translator },
            );
            expect(markup.header.kind).toBe(kind);
            expect(markup.header.kindBadgeClassList).toContain(
                `pa-pagelet-suggestion-card__kind--${kind}`,
            );
            // The translator was asked for the canonical kind key.
            const expectedKey = SUGGESTION_KIND_I18N_KEY[kind];
            expect(calls.some((c) => c.key === expectedKey)).toBe(true);
        },
    );
});

// ---------------------------------------------------------------------------
// Cost footer
// ---------------------------------------------------------------------------

describe("buildSuggestionCardMarkup — cost footer", () => {
    it("omits the cost line when no costEntry is supplied", () => {
        const markup = buildSuggestionCardMarkup(
            { suggestion: makeSuggestion() },
            { translator: keyTranslator() },
        );
        expect(markup.footer.cost).toBeNull();
    });

    it("renders the formatted USD when pricing is known", () => {
        const markup = buildSuggestionCardMarkup(
            {
                suggestion: makeSuggestion(),
                diagnostics: {
                    truncated: false,
                    partial: false,
                    droppedSuggestionsCount: 0,
                    costEntry: {
                        inputTokens: 1200,
                        outputTokens: 300,
                        totalTokens: 1500,
                        estimatedCost: 0.003,
                        currency: "USD",
                        pricingKnown: true,
                        at: 1_700_000_000_000,
                    },
                },
            },
            { translator: keyTranslator() },
        );
        expect(markup.footer.cost).not.toBeNull();
        expect(markup.footer.cost!.usd).toBe("$0.003");
        expect(markup.footer.cost!.pricingKnown).toBe(true);
    });

    it("renders ~$? when pricing is unknown", () => {
        const markup = buildSuggestionCardMarkup(
            {
                suggestion: makeSuggestion(),
                diagnostics: {
                    truncated: false,
                    partial: false,
                    droppedSuggestionsCount: 0,
                    costEntry: {
                        inputTokens: 1200,
                        outputTokens: 300,
                        totalTokens: 1500,
                        estimatedCost: 0,
                        currency: "USD",
                        pricingKnown: false,
                        at: 1_700_000_000_000,
                    },
                },
            },
            { translator: keyTranslator() },
        );
        expect(markup.footer.cost!.usd).toBe("~$?");
        expect(markup.footer.cost!.pricingKnown).toBe(false);
    });

    it("only shows footer actions when the matching prop callbacks are supplied", () => {
        const baseline = buildSuggestionCardMarkup(
            { suggestion: makeSuggestion() },
            { translator: keyTranslator() },
        );
        expect(baseline.footer.showResearch).toBe(false);
        expect(baseline.footer.showAccept).toBe(false);
        expect(baseline.footer.showDismiss).toBe(false);

        const interactive = buildSuggestionCardMarkup(
            {
                suggestion: makeSuggestion({ kind: "evidence" }),
                onResearch: () => undefined,
                onAccept: () => undefined,
                onDismiss: () => undefined,
            },
            { translator: keyTranslator() },
        );
        expect(interactive.footer.showResearch).toBe(true);
        expect(interactive.footer.showAccept).toBe(true);
        expect(interactive.footer.showDismiss).toBe(true);
    });

    it("labels accept as add-to-draft and scopes footer aria labels to the card", () => {
        const markup = buildSuggestionCardMarkup(
            {
                suggestion: makeSuggestion({ kind: "evidence", source_id: "note-2-seg-1" }),
                onResearch: () => undefined,
                onAccept: () => undefined,
                onDismiss: () => undefined,
            },
            { translator: keyTranslator() },
        );

        expect(markup.footer.acceptLabel).toBe("Add to draft");
        expect(markup.footer.acceptAriaLabel).toBe("Add this suggestion to draft: Evidence, note-2-seg-1");
        expect(markup.footer.dismissAriaLabel).toBe("Dismiss this suggestion: Evidence, note-2-seg-1");
        expect(markup.footer.researchAriaLabel).toBe("Research this suggestion: Evidence, note-2-seg-1");
    });

    it("does not show the research action for non-research suggestion kinds", () => {
        const markup = buildSuggestionCardMarkup(
            {
                suggestion: makeSuggestion({ kind: "trim" }),
                onResearch: () => undefined,
            },
            { translator: keyTranslator() },
        );
        expect(markup.footer.showResearch).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Real i18n parity
// ---------------------------------------------------------------------------

describe("buildSuggestionCardMarkup × real pageletT", () => {
    const realTranslator: SuggestionCardTranslator = (key, fallback) =>
        pageletT(key, "en", undefined, fallback);

    it.each(PAGELET_SUGGESTION_KINDS)(
        "resolves a non-empty EN kind label for %s",
        (kind) => {
            const markup = buildSuggestionCardMarkup(
                { suggestion: makeSuggestion({ kind }) },
                { translator: realTranslator },
            );
            expect(markup.header.kindLabel.length).toBeGreaterThan(0);
            expect(markup.header.kindLabel).not.toBe(SUGGESTION_KIND_I18N_KEY[kind]);
        },
    );

    it.each(PAGELET_SUGGESTION_KINDS)(
        "resolves a non-empty ZH kind label for %s and differs from EN",
        (kind) => {
            const zhTranslator: SuggestionCardTranslator = (key, fallback) =>
                pageletT(key, "zh", undefined, fallback);
            const en = buildSuggestionCardMarkup(
                { suggestion: makeSuggestion({ kind }) },
                { translator: realTranslator },
            );
            const zh = buildSuggestionCardMarkup(
                { suggestion: makeSuggestion({ kind }) },
                { translator: zhTranslator },
            );
            expect(zh.header.kindLabel.length).toBeGreaterThan(0);
            expect(zh.header.kindLabel).not.toBe(en.header.kindLabel);
        },
    );

    it("renders core labels (source / rationale / action) in EN via the real dictionary", () => {
        const markup = buildSuggestionCardMarkup(
            { suggestion: makeSuggestion() },
            { translator: realTranslator },
        );
        // These keys ARE in B3's en.json so the translator must not fall
        // back to the EN default.
        expect(markup.source.label).toBe("Source");
        expect(markup.rationale.label).toBe("Why");
        expect(markup.action.label).toBe("Suggested action");
    });
});

// ---------------------------------------------------------------------------
// createSuggestionCardRendererWithHost — DOM + callback wiring
// ---------------------------------------------------------------------------

describe("createSuggestionCardRendererWithHost", () => {
    it("mounts the card under the parent and stamps role=article", () => {
        const { host, root } = makeStubHost();
        const renderer = createSuggestionCardRendererWithHost(
            root,
            { suggestion: makeSuggestion() },
            { host, translator: keyTranslator() },
        );
        expect(root.children).toHaveLength(1);
        const card = root.children[0];
        expect(card.attrs["role"]).toBe("article");
        expect(card.classList).toContain("pa-pagelet-suggestion-card");
        expect(card.attrs["data-suggestion-kind"]).toBe("clarify");
        // Renderer holds onto initial props.
        expect(renderer.props.suggestion.source_id).toBe("seg-3");
    });

    it("propagates onSourceClick when the source chip is clicked", () => {
        const onSourceClick = jest.fn();
        const { host, root } = makeStubHost();
        createSuggestionCardRendererWithHost(
            root,
            { suggestion: makeSuggestion({ source_id: "seg-42" }), onSourceClick },
            { host, translator: keyTranslator() },
        );
        const chip = findByClass(
            root.children[0],
            "pa-pagelet-suggestion-card__source-chip--interactive",
        );
        expect(chip.tag).toBe("button");
        chip.dispatch("click");
        expect(onSourceClick).toHaveBeenCalledTimes(1);
        expect(onSourceClick).toHaveBeenCalledWith("seg-42");
    });

    it("does NOT wire a click listener when onSourceClick is omitted", () => {
        const { host, root } = makeStubHost();
        createSuggestionCardRendererWithHost(
            root,
            { suggestion: makeSuggestion() },
            { host, translator: keyTranslator() },
        );
        const chip = findByClass(
            root.children[0],
            "pa-pagelet-suggestion-card__source-chip--static",
        );
        expect(chip.tag).toBe("span");
        expect(chip.listeners).toHaveLength(0);
    });

    it("propagates onAccept / onDismiss with the suggestion payload", () => {
        const onAccept = jest.fn();
        const onDismiss = jest.fn();
        const suggestion = makeSuggestion();
        const { host, root } = makeStubHost();
        createSuggestionCardRendererWithHost(
            root,
            { suggestion, onAccept, onDismiss },
            { host, translator: keyTranslator() },
        );
        const acceptBtn = findByClass(
            root.children[0],
            "pa-pagelet-suggestion-card__btn--accept",
        );
        const dismissBtn = findByClass(
            root.children[0],
            "pa-pagelet-suggestion-card__btn--dismiss",
        );
        acceptBtn.dispatch("click");
        dismissBtn.dispatch("click");
        expect(onAccept).toHaveBeenCalledWith(suggestion);
        expect(onDismiss).toHaveBeenCalledWith(suggestion);
    });

    it("propagates related note clicks with the raw related note name", () => {
        const onRelatedNoteClick = jest.fn();
        const suggestion = makeSuggestion();
        const { host, root } = makeStubHost();
        createSuggestionCardRendererWithHost(
            root,
            { suggestion, onRelatedNoteClick },
            { host, translator: keyTranslator() },
        );
        const button = findAllByClass(
            root.children[0],
            "pa-pagelet-suggestion-card__related-button",
        )[0];
        button.dispatch("click");
        expect(onRelatedNoteClick).toHaveBeenCalledWith("[[Concept X]]", suggestion);
    });

    it("propagates onResearch for evidence/link suggestions", () => {
        const onResearch = jest.fn();
        const suggestion = makeSuggestion({ kind: "evidence" });
        const { host, root } = makeStubHost();
        createSuggestionCardRendererWithHost(
            root,
            { suggestion, onResearch },
            { host, translator: keyTranslator() },
        );
        const researchBtn = findByClass(
            root.children[0],
            "pa-pagelet-suggestion-card__btn--research",
        );
        researchBtn.dispatch("click");
        expect(onResearch).toHaveBeenCalledWith(suggestion);
    });

    it("omits accept/dismiss buttons when no callback is supplied", () => {
        const { host, root } = makeStubHost();
        createSuggestionCardRendererWithHost(
            root,
            { suggestion: makeSuggestion() },
            { host, translator: keyTranslator() },
        );
        expect(
            findAllByClass(root.children[0], "pa-pagelet-suggestion-card__btn--accept"),
        ).toHaveLength(0);
        expect(
            findAllByClass(root.children[0], "pa-pagelet-suggestion-card__btn--dismiss"),
        ).toHaveLength(0);
    });

    it("re-renders on update(nextProps) and tears down the previous root", () => {
        const { host, root } = makeStubHost();
        const renderer = createSuggestionCardRendererWithHost(
            root,
            { suggestion: makeSuggestion({ source_id: "seg-1" }) },
            { host, translator: keyTranslator() },
        );
        expect(root.children[0].attrs["data-suggestion-kind"]).toBe("clarify");

        renderer.update({ suggestion: makeSuggestion({ source_id: "seg-9", kind: "trim" }) });
        // Only one card under the parent (the new one).
        expect(root.children).toHaveLength(1);
        expect(root.children[0].attrs["data-suggestion-kind"]).toBe("trim");
        expect(renderer.props.suggestion.source_id).toBe("seg-9");
    });

    it("renders all 3 diagnostic badges as DOM nodes when triggered", () => {
        const { host, root } = makeStubHost();
        createSuggestionCardRendererWithHost(
            root,
            {
                suggestion: makeSuggestion(),
                diagnostics: {
                    truncated: true,
                    partial: true,
                    droppedSuggestionsCount: 3,
                },
            },
            { host, translator: keyTranslator() },
        );
        const badges = findAllByClass(
            root.children[0],
            "pa-pagelet-suggestion-card__badge",
        );
        expect(badges).toHaveLength(3);
        const dataAttrs = badges.map((b) => b.attrs["data-badge"]);
        expect(dataAttrs).toEqual(["truncated", "partial", "dropped"]);
    });

    it("destroy removes the card from the parent", () => {
        const { host, root } = makeStubHost();
        const renderer = createSuggestionCardRendererWithHost(
            root,
            { suggestion: makeSuggestion() },
            { host, translator: keyTranslator() },
        );
        expect(root.children).toHaveLength(1);
        renderer.destroy();
        expect(root.children).toHaveLength(0);
    });
});

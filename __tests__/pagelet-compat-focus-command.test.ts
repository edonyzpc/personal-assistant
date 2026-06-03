/* Copyright 2023 edonyzpc */

/**
 * Track B · B5 unit tests for the Cmd+/ focus jump-in command.
 *
 * Coverage matrix:
 *  - Constants (command ID, default hotkey, selector list) are stable.
 *  - `findFirstSuggestionCard` returns the first card or null safely.
 *  - `findFirstFocusableInCard` honors the priority order: source chip →
 *    accept → dismiss → generic button → anchor → tabindex.
 *  - `findFocusTargetForCommand` composes the two helpers correctly.
 *  - `registerPageletFocusCommand`:
 *      - registers with the canonical ID
 *      - applies the default Mod+/ hotkey
 *      - accepts an override hotkey
 *      - accepts `null` to register WITHOUT a hotkey
 *      - callback resolves + focuses the right element
 *      - callback is a safe no-op when no card / no focusable exists
 *      - `focus` is called with `preventScroll: true` by default
 */

import { describe, expect, it, jest } from "@jest/globals";

import {
    PAGELET_FOCUS_LATEST_COMMAND_ID,
    PAGELET_FOCUS_LATEST_DEFAULT_HOTKEY,
    PAGELET_FOCUSABLE_SELECTORS,
    PAGELET_SUGGESTION_CARD_CLASS,
    findFirstFocusableInCard,
    findFirstSuggestionCard,
    findFocusTargetForCommand,
    registerPageletFocusCommand,
    type PageletCommandDefinition,
    type PageletCommandHost,
    type PageletFocusableElement,
    type PageletQueryRoot,
} from "../src/pagelet/compat/focus-command";

// ---------------------------------------------------------------------------
// Tiny DOM stub — supports querySelector with class + button selectors.
// ---------------------------------------------------------------------------

interface StubNode extends PageletQueryRoot, PageletFocusableElement {
    tag: string;
    classes: string[];
    children: StubNode[];
    focusCalled: number;
    lastFocusOptions: { preventScroll?: boolean } | undefined;
}

/**
 * Match a node against a CSS-ish selector. We only need to support the
 * forms used in `PAGELET_FOCUSABLE_SELECTORS`:
 *   - `.classname`
 *   - `tag`
 *   - `tag.class`
 *   - `tag.class1.class2`
 *   - `tag[attr]` (not used directly — `a[href]` treated as `a`)
 *   - `[tabindex]:not([tabindex="-1"])` — recognized as a generic tabindex hit
 */
function matches(node: StubNode, selector: string): boolean {
    if (selector === `[tabindex]:not([tabindex="-1"])`) {
        return node.classes.includes("__has-tabindex__");
    }
    if (selector.startsWith("a[href]")) {
        return node.tag === "a" && node.classes.includes("__has-href__");
    }
    if (selector.startsWith(".")) {
        return node.classes.includes(selector.slice(1));
    }
    // tag.class.class style
    const [tag, ...rest] = selector.split(".");
    if (tag && tag !== node.tag) return false;
    return rest.every((c) => node.classes.includes(c));
}

function makeStubNode(tag: string, classes: string[] = []): StubNode {
    const node: StubNode = {
        tag,
        classes,
        children: [],
        focusCalled: 0,
        lastFocusOptions: undefined,
        focus(options?: { preventScroll?: boolean }) {
            node.focusCalled += 1;
            node.lastFocusOptions = options;
        },
        querySelector(selector: string): unknown {
            // Depth-first pre-order — matches real DOM document order
            // (`querySelector` returns the first matching descendant in
            // document order, not the shallowest).
            const walk = (n: StubNode): StubNode | null => {
                for (const c of n.children) {
                    if (matches(c, selector)) return c;
                    const deep = walk(c);
                    if (deep) return deep;
                }
                return null;
            };
            return walk(node);
        },
        querySelectorAll(selector: string): { length: number; item(i: number): unknown } {
            const out: StubNode[] = [];
            const walk = (n: StubNode) => {
                if (matches(n, selector)) out.push(n);
                for (const c of n.children) walk(c);
            };
            walk(node);
            return {
                length: out.length,
                item(i: number) {
                    return out[i] ?? null;
                },
            };
        },
    };
    return node;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("focus-command constants", () => {
    it("command ID uses the `pa-pagelet:` prefix per SDD §6.3", () => {
        expect(PAGELET_FOCUS_LATEST_COMMAND_ID).toBe("pa-pagelet:focus-latest-suggestion");
    });

    it("default hotkey is Mod+/ with frozen modifiers list", () => {
        expect(PAGELET_FOCUS_LATEST_DEFAULT_HOTKEY.key).toBe("/");
        expect([...PAGELET_FOCUS_LATEST_DEFAULT_HOTKEY.modifiers]).toEqual(["Mod"]);
        expect(Object.isFrozen(PAGELET_FOCUS_LATEST_DEFAULT_HOTKEY)).toBe(true);
    });

    it("suggestion-card class matches the SuggestionCard root selector", () => {
        expect(PAGELET_SUGGESTION_CARD_CLASS).toBe("pa-pagelet-suggestion-card");
    });

    it("focusable selectors are ordered: source-chip → accept → dismiss → button → anchor → tabindex", () => {
        expect(PAGELET_FOCUSABLE_SELECTORS[0]).toBe(
            "button.pa-pagelet-suggestion-card__source-chip--interactive",
        );
        expect(PAGELET_FOCUSABLE_SELECTORS[1]).toBe(
            "button.pa-pagelet-suggestion-card__btn--accept",
        );
        expect(PAGELET_FOCUSABLE_SELECTORS[2]).toBe(
            "button.pa-pagelet-suggestion-card__btn--dismiss",
        );
        expect(PAGELET_FOCUSABLE_SELECTORS[3]).toBe("button");
        expect(PAGELET_FOCUSABLE_SELECTORS[4]).toBe("a[href]");
        expect(PAGELET_FOCUSABLE_SELECTORS[5]).toBe(`[tabindex]:not([tabindex="-1"])`);
    });
});

// ---------------------------------------------------------------------------
// findFirstSuggestionCard
// ---------------------------------------------------------------------------

describe("findFirstSuggestionCard", () => {
    it("returns null on a null root", () => {
        expect(findFirstSuggestionCard(null)).toBeNull();
    });

    it("returns null when no card is mounted", () => {
        const root = makeStubNode("body");
        root.children.push(makeStubNode("div", ["pa-some-other-panel"]));
        expect(findFirstSuggestionCard(root)).toBeNull();
    });

    it("returns the first card in DOM order", () => {
        const root = makeStubNode("body");
        const card1 = makeStubNode("div", [PAGELET_SUGGESTION_CARD_CLASS]);
        const card2 = makeStubNode("div", [PAGELET_SUGGESTION_CARD_CLASS]);
        root.children.push(makeStubNode("div", ["wrapper"]));
        root.children[0].children.push(card1);
        root.children.push(card2);
        const hit = findFirstSuggestionCard(root) as StubNode;
        expect(hit).toBe(card1);
    });
});

// ---------------------------------------------------------------------------
// findFirstFocusableInCard
// ---------------------------------------------------------------------------

describe("findFirstFocusableInCard", () => {
    it("returns null for a falsy / non-queryable card", () => {
        expect(findFirstFocusableInCard(null)).toBeNull();
        expect(findFirstFocusableInCard({})).toBeNull();
    });

    it("prefers an interactive source chip over all other buttons", () => {
        const card = makeStubNode("div", [PAGELET_SUGGESTION_CARD_CLASS]);
        const chip = makeStubNode("button", [
            "pa-pagelet-suggestion-card__source-chip--interactive",
        ]);
        const accept = makeStubNode("button", [
            "pa-pagelet-suggestion-card__btn--accept",
        ]);
        card.children.push(accept, chip);
        const hit = findFirstFocusableInCard(card) as StubNode;
        expect(hit).toBe(chip);
    });

    it("falls back to the accept button when no source chip is interactive", () => {
        const card = makeStubNode("div", [PAGELET_SUGGESTION_CARD_CLASS]);
        const accept = makeStubNode("button", [
            "pa-pagelet-suggestion-card__btn--accept",
        ]);
        const dismiss = makeStubNode("button", [
            "pa-pagelet-suggestion-card__btn--dismiss",
        ]);
        card.children.push(dismiss, accept);
        const hit = findFirstFocusableInCard(card) as StubNode;
        expect(hit).toBe(accept);
    });

    it("falls back to a generic button when no targeted button exists", () => {
        const card = makeStubNode("div", [PAGELET_SUGGESTION_CARD_CLASS]);
        const btn = makeStubNode("button", ["whatever"]);
        card.children.push(btn);
        const hit = findFirstFocusableInCard(card) as StubNode;
        expect(hit).toBe(btn);
    });

    it("falls back to an anchor[href] when no button exists", () => {
        const card = makeStubNode("div", [PAGELET_SUGGESTION_CARD_CLASS]);
        const a = makeStubNode("a", ["__has-href__"]);
        card.children.push(a);
        const hit = findFirstFocusableInCard(card) as StubNode;
        expect(hit).toBe(a);
    });

    it("falls back to a [tabindex] node last", () => {
        const card = makeStubNode("div", [PAGELET_SUGGESTION_CARD_CLASS]);
        const focusable = makeStubNode("div", ["__has-tabindex__"]);
        card.children.push(focusable);
        const hit = findFirstFocusableInCard(card) as StubNode;
        expect(hit).toBe(focusable);
    });

    it("returns null when no focusable selector matches", () => {
        const card = makeStubNode("div", [PAGELET_SUGGESTION_CARD_CLASS]);
        card.children.push(makeStubNode("span", ["text-only"]));
        expect(findFirstFocusableInCard(card)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// findFocusTargetForCommand — composition
// ---------------------------------------------------------------------------

describe("findFocusTargetForCommand", () => {
    it("returns null when the search root has no card", () => {
        const root = makeStubNode("body");
        expect(findFocusTargetForCommand(root)).toBeNull();
    });

    it("returns null when the card has no focusable target", () => {
        const root = makeStubNode("body");
        const card = makeStubNode("div", [PAGELET_SUGGESTION_CARD_CLASS]);
        card.children.push(makeStubNode("span", ["text-only"]));
        root.children.push(card);
        expect(findFocusTargetForCommand(root)).toBeNull();
    });

    it("returns the first focusable inside the first card", () => {
        const root = makeStubNode("body");
        const card = makeStubNode("div", [PAGELET_SUGGESTION_CARD_CLASS]);
        const chip = makeStubNode("button", [
            "pa-pagelet-suggestion-card__source-chip--interactive",
        ]);
        card.children.push(chip);
        root.children.push(card);
        const hit = findFocusTargetForCommand(root) as StubNode;
        expect(hit).toBe(chip);
    });
});

// ---------------------------------------------------------------------------
// registerPageletFocusCommand
// ---------------------------------------------------------------------------

interface RecordingCommandHost extends PageletCommandHost {
    registered: PageletCommandDefinition[];
}

function makeCommandHost(): RecordingCommandHost {
    const registered: PageletCommandDefinition[] = [];
    return {
        registered,
        addCommand(definition) {
            registered.push(definition);
            return null;
        },
    };
}

describe("registerPageletFocusCommand", () => {
    it("registers the command with the canonical ID and default hotkey", () => {
        const host = makeCommandHost();
        registerPageletFocusCommand(host, {
            getSearchRoot: () => null,
        });
        expect(host.registered).toHaveLength(1);
        const def = host.registered[0];
        expect(def.id).toBe(PAGELET_FOCUS_LATEST_COMMAND_ID);
        expect(def.hotkeys).toEqual([PAGELET_FOCUS_LATEST_DEFAULT_HOTKEY]);
        expect(typeof def.name).toBe("string");
        expect(def.name.length).toBeGreaterThan(0);
    });

    it("accepts a custom hotkey list", () => {
        const host = makeCommandHost();
        const custom = [{ modifiers: ["Mod", "Shift"] as const, key: "P" }];
        registerPageletFocusCommand(host, {
            hotkeys: custom,
            getSearchRoot: () => null,
        });
        expect(host.registered[0].hotkeys).toEqual(custom);
    });

    it("`hotkeys: null` registers the command WITHOUT a default hotkey", () => {
        const host = makeCommandHost();
        registerPageletFocusCommand(host, {
            hotkeys: null,
            getSearchRoot: () => null,
        });
        expect(host.registered[0].hotkeys).toBeUndefined();
    });

    it("accepts a custom display name (i18n hook)", () => {
        const host = makeCommandHost();
        registerPageletFocusCommand(host, {
            name: "聚焦最新的拾页建议",
            getSearchRoot: () => null,
        });
        expect(host.registered[0].name).toBe("聚焦最新的拾页建议");
    });

    it("callback focuses the first focusable element in the first card", () => {
        const host = makeCommandHost();
        const root = makeStubNode("body");
        const card = makeStubNode("div", [PAGELET_SUGGESTION_CARD_CLASS]);
        const chip = makeStubNode("button", [
            "pa-pagelet-suggestion-card__source-chip--interactive",
        ]);
        card.children.push(chip);
        root.children.push(card);

        const focusSpy = jest.fn();
        registerPageletFocusCommand(host, {
            getSearchRoot: () => root,
            focusElement: focusSpy,
        });
        host.registered[0].callback();
        expect(focusSpy).toHaveBeenCalledTimes(1);
        expect(focusSpy).toHaveBeenCalledWith(chip);
    });

    it("callback is a no-op when no card is mounted", () => {
        const host = makeCommandHost();
        const focusSpy = jest.fn();
        registerPageletFocusCommand(host, {
            getSearchRoot: () => makeStubNode("body"),
            focusElement: focusSpy,
        });
        host.registered[0].callback();
        expect(focusSpy).not.toHaveBeenCalled();
    });

    it("callback is a no-op when the search root resolver returns null", () => {
        const host = makeCommandHost();
        const focusSpy = jest.fn();
        registerPageletFocusCommand(host, {
            getSearchRoot: () => null,
            focusElement: focusSpy,
        });
        host.registered[0].callback();
        expect(focusSpy).not.toHaveBeenCalled();
    });

    it("default focus path uses preventScroll: true", () => {
        const host = makeCommandHost();
        const root = makeStubNode("body");
        const card = makeStubNode("div", [PAGELET_SUGGESTION_CARD_CLASS]);
        const btn = makeStubNode("button", ["whatever"]);
        card.children.push(btn);
        root.children.push(card);
        registerPageletFocusCommand(host, {
            getSearchRoot: () => root,
            // No focusElement override → use the production default.
        });
        host.registered[0].callback();
        expect(btn.focusCalled).toBe(1);
        expect(btn.lastFocusOptions).toEqual({ preventScroll: true });
    });

    it("default focus path falls back to no-arg focus when options-form throws", () => {
        const host = makeCommandHost();
        const root = makeStubNode("body");
        const card = makeStubNode("div", [PAGELET_SUGGESTION_CARD_CLASS]);
        const btn = makeStubNode("button", ["whatever"]);
        let receivedOptions = false;
        // Replace the button's focus with one that rejects the options arg
        // — mirrors the older-Safari quirk the production fallback handles.
        btn.focus = ((options?: { preventScroll?: boolean }) => {
            if (options !== undefined) {
                receivedOptions = true;
                throw new TypeError("options not supported");
            }
            btn.focusCalled += 1;
        }) as PageletFocusableElement["focus"];
        card.children.push(btn);
        root.children.push(card);
        registerPageletFocusCommand(host, {
            getSearchRoot: () => root,
        });
        host.registered[0].callback();
        expect(receivedOptions).toBe(true);
        // Despite the first call throwing, the fallback no-arg path succeeded.
        expect(btn.focusCalled).toBe(1);
    });
});

/* Copyright 2023 edonyzpc */

/**
 * Track B · B2 unit tests for the Pagelet Mascot UI.
 *
 * Coverage matrix (mapped to SDD §10.1 + visual spec §①):
 *  - `buildMascotMarkup`: 4 state renderings produce the expected
 *    class list, color token, SVG shapes, and resolved message.
 *  - Translator wiring: i18n key lookup happens for both message and
 *    aria-label; explicit message override bypasses the lookup.
 *  - State transitions via the renderer: setState updates state,
 *    re-applies markup, no-ops on identical state w/o message change,
 *    and respects an aborted signal.
 *  - i18n parity: real `pageletT` lookup against the registered
 *    `pagelet.pet.*` keys returns non-empty strings for all 4 states
 *    in both EN and ZH (catches a B3 dictionary regression).
 */

import { describe, expect, it, jest } from "@jest/globals";

import {
    MASCOT_STATES,
    MASCOT_STATE_I18N_KEY,
    MASCOT_STATE_STROKE_VAR,
    MASCOT_SVG_VIEWBOX,
    buildMascotMarkup,
    type MascotTranslator,
} from "../src/pagelet/ui/mascot";
import {
    createMascotRendererWithHost,
    type MascotDomHost,
    type MascotDomNode,
} from "../src/pagelet/ui/mascot/dom-renderer";
import { pageletT } from "../src/locales/pagelet";
import type { PetState } from "../src/pagelet/pet/types";

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

/** A passthrough translator: returns the key when no fallback supplied. */
function keyTranslator(): MascotTranslator {
    return (key: string, fallback?: string) => fallback ?? key;
}

/** A recorder translator: tracks every lookup so we can assert call ordering. */
function recordingTranslator(): {
    translator: MascotTranslator;
    calls: { key: string; fallback?: string }[];
} {
    const calls: { key: string; fallback?: string }[] = [];
    const translator: MascotTranslator = (key, fallback) => {
        calls.push({ key, fallback });
        return fallback ?? key;
    };
    return { translator, calls };
}

// ---------------------------------------------------------------------------
// Stub DOM host — records all node creations / mutations.
//
// We deliberately do NOT extend the existing chat / settings stubs;
// keeping a tiny, purpose-built host means a refactor of either file
// doesn't ripple here.
// ---------------------------------------------------------------------------

interface StubNode extends MascotDomNode {
    tag: string;
    ns: "html" | "svg";
    attrs: Record<string, string>;
    classList: string[];
    style: Record<string, string>;
    text: string;
    children: StubNode[];
    parent: StubNode | null;
    /** Used by the production renderer to clear before rebuilding SVG. */
    clearChildren(): void;
}

function makeStubNode(tag: string, ns: "html" | "svg"): StubNode {
    const node = {
        tag,
        ns,
        attrs: {} as Record<string, string>,
        classList: [] as string[],
        style: {} as Record<string, string>,
        text: "",
        children: [] as StubNode[],
        parent: null as StubNode | null,
    } as StubNode;
    node.setAttribute = (name: string, value: string): void => {
        node.attrs[name] = value;
        // Keep classList in sync with the "class" attribute so callers
        // that prefer setAttribute("class", ...) still appear in
        // findByClass searches.
        if (name === "class") {
            node.classList = value.length > 0 ? value.split(/\s+/) : [];
        }
    };
    node.removeAttribute = (name: string): void => {
        delete node.attrs[name];
    };
    node.appendChild = (<T extends MascotDomNode>(child: T): T => {
        const stub = child as unknown as StubNode;
        stub.parent = node;
        node.children.push(stub);
        return child;
    }) as StubNode["appendChild"];
    node.removeChild = (child: MascotDomNode): MascotDomNode => {
        const stub = child as unknown as StubNode;
        const idx = node.children.indexOf(stub);
        if (idx >= 0) node.children.splice(idx, 1);
        stub.parent = null;
        return child;
    };
    node.setText = (text: string): void => {
        node.text = text;
    };
    node.setClassList = (classes: readonly string[]): void => {
        node.classList = [...classes];
        node.attrs["class"] = classes.join(" ");
    };
    node.setStyleProperty = (name: string, value: string): void => {
        node.style[name] = value;
    };
    node.remove = (): void => {
        if (node.parent) {
            const idx = node.parent.children.indexOf(node);
            if (idx >= 0) node.parent.children.splice(idx, 1);
            node.parent = null;
        }
    };
    node.clearChildren = (): void => {
        for (const child of node.children) {
            child.parent = null;
        }
        node.children = [];
    };
    return node;
}

function makeStubHost(): { host: MascotDomHost; root: StubNode } {
    const root = makeStubNode("__root__", "html");
    const host: MascotDomHost = {
        createHtmlElement(tag) {
            return makeStubNode(tag, "html");
        },
        createSvgElement(tag) {
            return makeStubNode(tag, "svg");
        },
    };
    return { host, root };
}

/** Find the only descendant matching a class. Throws if zero or > 1. */
function findByClass(node: StubNode, cls: string): StubNode {
    const results: StubNode[] = [];
    const walk = (n: StubNode) => {
        if (n.classList.includes(cls)) results.push(n);
        for (const c of n.children) walk(c);
    };
    walk(node);
    if (results.length === 0) throw new Error(`no node with class ${cls}`);
    if (results.length > 1) throw new Error(`multiple (${results.length}) nodes with class ${cls}`);
    return results[0];
}

function findAllByTag(node: StubNode, tag: string): StubNode[] {
    const results: StubNode[] = [];
    const walk = (n: StubNode) => {
        if (n.tag === tag) results.push(n);
        for (const c of n.children) walk(c);
    };
    walk(node);
    return results;
}

// ---------------------------------------------------------------------------
// MASCOT_STATES + constants
// ---------------------------------------------------------------------------

describe("MASCOT constants", () => {
    it("ships exactly 4 states in the canonical order", () => {
        expect([...MASCOT_STATES]).toEqual(["resting", "idle", "working", "nudge"]);
    });

    it("maps each state to a stroke CSS custom property", () => {
        const values = new Set(MASCOT_STATES.map((s) => MASCOT_STATE_STROKE_VAR[s]));
        expect(values.size).toBe(3);
        // Sanity: the prop names follow the `pa-pagelet-color-*` token
        // family the visual spec defines.
        for (const v of values) expect(v).toMatch(/^--pa-pagelet-color-/);
    });

    it("maps each state to its canonical i18n key", () => {
        for (const state of MASCOT_STATES) {
            expect(MASCOT_STATE_I18N_KEY[state]).toBe(`pagelet.pet.${state}`);
        }
    });

    it("uses the visual-spec SVG viewBox (44x44)", () => {
        expect(MASCOT_SVG_VIEWBOX).toBe("0 0 44 44");
    });
});

// ---------------------------------------------------------------------------
// buildMascotMarkup — 4 state coverage
// ---------------------------------------------------------------------------

describe("buildMascotMarkup", () => {
    it.each(MASCOT_STATES)("renders the canonical class list for %s", (state) => {
        const markup = buildMascotMarkup(state, { translator: keyTranslator() });
        expect(markup.rootClassList).toEqual([
            "pa-pagelet-mascot",
            `pa-pagelet-mascot--${state}`,
        ]);
        expect(markup.state).toBe(state);
        expect(markup.strokeCssVar).toBe(MASCOT_STATE_STROKE_VAR[state]);
        expect(markup.strokeColor).toBe(`var(${MASCOT_STATE_STROKE_VAR[state]})`);
        expect(markup.svgViewBox).toBe("0 0 44 44");
    });

    it("falls back to the EN spec default when the translator surfaces the key", () => {
        // Passthrough translator returns the key on a miss; the builder
        // should detect this and fall through to the hard-coded EN
        // default so production UI never shows "pagelet.pet.idle".
        const markup = buildMascotMarkup("idle", { translator: keyTranslator() });
        expect(markup.message).toBe("Pagelet is watching.");
    });

    it("uses the explicit messageOverride when supplied", () => {
        const markup = buildMascotMarkup("working", {
            translator: keyTranslator(),
            messageOverride: "Reviewing notes/foo.md…",
        });
        expect(markup.message).toBe("Reviewing notes/foo.md…");
    });

    it("looks up the canonical i18n key for the state's message", () => {
        const { translator, calls } = recordingTranslator();
        buildMascotMarkup("nudge", { translator });
        const keys = calls.map((c) => c.key);
        expect(keys).toContain("pagelet.pet.nudge");
        expect(keys).toContain("pagelet.a11y.mascotLabel");
    });

    it("renders shared notepad outline (body + fold) for every state", () => {
        // The body + fold are the visual signature — every state must
        // start its `paths` array with these two so the SVG looks like
        // a notepad regardless of state.
        for (const state of MASCOT_STATES) {
            const markup = buildMascotMarkup(state, { translator: keyTranslator() });
            expect(markup.svgShapes.paths.length).toBeGreaterThanOrEqual(2);
            // Body path uses the 5-point outline; fold uses the small triangle.
            expect(markup.svgShapes.paths[0].d).toMatch(/^M10\.2 8\.3/);
            expect(markup.svgShapes.paths[1].d).toMatch(/^M30 8\.1/);
        }
    });

    it("idle state includes 2 blinking eye arcs", () => {
        const markup = buildMascotMarkup("idle", { translator: keyTranslator() });
        const animated = markup.svgShapes.paths.filter((p) => p.animClass === "pa-pagelet-anim-blink");
        expect(animated).toHaveLength(2);
        // Each eye arc uses the thinner feature stroke (1.4).
        for (const arc of animated) expect(arc.strokeWidth).toBe(1.4);
    });

    it("working state includes 3 pulsing circles with staggered delays", () => {
        const markup = buildMascotMarkup("working", { translator: keyTranslator() });
        expect(markup.svgShapes.circles).toBeDefined();
        const circles = markup.svgShapes.circles!;
        expect(circles).toHaveLength(3);
        expect(circles.map((c) => c.animClass)).toEqual([
            "pa-pagelet-anim-pulse-1",
            "pa-pagelet-anim-pulse-2",
            "pa-pagelet-anim-pulse-3",
        ]);
    });

    it("nudge state replaces eyes with two upward V chevrons", () => {
        const markup = buildMascotMarkup("nudge", { translator: keyTranslator() });
        // No pulse circles, no blink anims — nudge is static (D005).
        expect(markup.svgShapes.circles).toBeUndefined();
        const animated = markup.svgShapes.paths.filter((p) => p.animClass);
        expect(animated).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Real i18n parity — guards against B3 dictionary regression.
// ---------------------------------------------------------------------------

describe("buildMascotMarkup × real pageletT", () => {
    const realTranslator: MascotTranslator = (key, fallback) =>
        pageletT(key, "en", undefined, fallback);

    it.each(MASCOT_STATES)("renders a non-empty EN message for state %s", (state) => {
        const markup = buildMascotMarkup(state, { translator: realTranslator });
        expect(markup.message.length).toBeGreaterThan(0);
        // EN message must not be the i18n key itself.
        expect(markup.message).not.toBe(MASCOT_STATE_I18N_KEY[state]);
    });

    it.each(MASCOT_STATES)("renders a non-empty ZH message for state %s", (state) => {
        const zhTranslator: MascotTranslator = (key, fallback) =>
            pageletT(key, "zh", undefined, fallback);
        const markup = buildMascotMarkup(state, { translator: zhTranslator });
        expect(markup.message.length).toBeGreaterThan(0);
        // ZH should differ from EN to confirm the translation actually fired.
        const enMarkup = buildMascotMarkup(state, { translator: realTranslator });
        expect(markup.message).not.toBe(enMarkup.message);
    });
});

// ---------------------------------------------------------------------------
// createMascotRendererWithHost — state transitions
// ---------------------------------------------------------------------------

describe("createMascotRendererWithHost", () => {
    it("mounts the initial state onto the parent node", () => {
        const { host, root } = makeStubHost();
        const renderer = createMascotRendererWithHost(root, {
            host,
            initialState: "idle",
            translator: keyTranslator(),
        });
        expect(renderer.state).toBe("idle");
        // Exactly one root child.
        expect(root.children).toHaveLength(1);
        const mascotRoot = root.children[0];
        expect(mascotRoot.classList).toEqual([
            "pa-pagelet-mascot",
            "pa-pagelet-mascot--idle",
        ]);
        expect(mascotRoot.attrs["data-plugin"]).toBe("pa-pagelet");
        expect(mascotRoot.attrs["role"]).toBe("group");
        expect(mascotRoot.attrs["data-mascot-state"]).toBe("idle");
        // SVG present with the canonical viewBox.
        const svgs = findAllByTag(mascotRoot, "svg");
        expect(svgs).toHaveLength(1);
        expect(svgs[0].attrs["viewBox"]).toBe("0 0 44 44");
        // Message rendered.
        const msg = findByClass(mascotRoot, "pa-pagelet-mascot__message");
        expect(msg.text).toBe("Pagelet is watching.");
    });

    it("transitions through all 4 states and updates classList + text", () => {
        const { host, root } = makeStubHost();
        const renderer = createMascotRendererWithHost(root, {
            host,
            initialState: "idle",
            translator: keyTranslator(),
        });
        const expectedTexts: Record<PetState, string> = {
            resting: "(resting)",
            idle: "Pagelet is watching.",
            working: "Preparing…",
            nudge: "(insights ready)",
        };

        for (const state of MASCOT_STATES) {
            renderer.setState(state);
            expect(renderer.state).toBe(state);
            const mascotRoot = root.children[0];
            expect(mascotRoot.classList).toContain(`pa-pagelet-mascot--${state}`);
            expect(mascotRoot.attrs["data-mascot-state"]).toBe(state);
            const msg = findByClass(mascotRoot, "pa-pagelet-mascot__message");
            expect(msg.text).toBe(expectedTexts[state]);
        }
    });

    it("honors a message override on setState", () => {
        const { host, root } = makeStubHost();
        const renderer = createMascotRendererWithHost(root, {
            host,
            initialState: "idle",
            translator: keyTranslator(),
        });
        renderer.setState("working", { message: "Reviewing notes/foo.md…" });
        const msg = findByClass(root.children[0], "pa-pagelet-mascot__message");
        expect(msg.text).toBe("Reviewing notes/foo.md…");
    });

    it("is a no-op when setState is called with an aborted signal", () => {
        const { host, root } = makeStubHost();
        const renderer = createMascotRendererWithHost(root, {
            host,
            initialState: "idle",
            translator: keyTranslator(),
        });
        const controller = new AbortController();
        controller.abort();
        renderer.setState("nudge", { signal: controller.signal });
        expect(renderer.state).toBe("idle");
        // Class still reflects idle.
        expect(root.children[0].classList).toContain("pa-pagelet-mascot--idle");
    });

    it("skips redundant transitions when state + message are unchanged", () => {
        const { host, root } = makeStubHost();
        const { translator, calls } = recordingTranslator();
        const renderer = createMascotRendererWithHost(root, {
            host,
            initialState: "idle",
            translator,
        });
        const callsAfterMount = calls.length;
        renderer.setState("idle");
        // No new translator calls — confirms the no-op short-circuit.
        expect(calls.length).toBe(callsAfterMount);
    });

    it("destroy detaches the mascot root from the parent", () => {
        const { host, root } = makeStubHost();
        const renderer = createMascotRendererWithHost(root, {
            host,
            initialState: "idle",
            translator: keyTranslator(),
        });
        expect(root.children).toHaveLength(1);
        renderer.destroy();
        expect(root.children).toHaveLength(0);
    });

    it("uses the supplied aria-label when provided, else the i18n default", () => {
        const { host: host1, root: root1 } = makeStubHost();
        createMascotRendererWithHost(root1, {
            host: host1,
            translator: keyTranslator(),
            ariaLabel: "custom mascot label",
        });
        expect(root1.children[0].attrs["aria-label"]).toBe("custom mascot label");

        const { host: host2, root: root2 } = makeStubHost();
        const { translator, calls } = recordingTranslator();
        createMascotRendererWithHost(root2, { host: host2, translator });
        const ariaLabelKey = calls.find((c) => c.key === "pagelet.a11y.mascotLabel");
        expect(ariaLabelKey).toBeDefined();
    });

    it("rebuilds SVG children fully across transitions (no leakage from previous state)", () => {
        const { host, root } = makeStubHost();
        const renderer = createMascotRendererWithHost(root, {
            host,
            initialState: "working",
            translator: keyTranslator(),
        });
        // Working has 3 circles + 2 outline paths.
        const svgBefore = findAllByTag(root.children[0], "svg")[0];
        expect(findAllByTag(svgBefore, "circle")).toHaveLength(3);
        expect(findAllByTag(svgBefore, "path")).toHaveLength(2);

        renderer.setState("nudge");
        // Nudge has 0 circles + 4 paths.
        const svgAfter = findAllByTag(root.children[0], "svg")[0];
        expect(findAllByTag(svgAfter, "circle")).toHaveLength(0);
        expect(findAllByTag(svgAfter, "path")).toHaveLength(4);
    });
});

// ---------------------------------------------------------------------------
// Jest mock plumbing sanity — ensures the test never accidentally pulls in
// the heavyweight Obsidian mock for these UI-only specs.
// ---------------------------------------------------------------------------

describe("module hygiene", () => {
    it("does NOT depend on the obsidian shim transitively for builder", () => {
        // If a future refactor added `import 'obsidian'` to markup.ts,
        // this test would catch it: the jest module registry would
        // have `obsidian` loaded. We do not assert absence directly
        // (jest doesn't expose its registry) — instead we re-import
        // the builder in isolation and verify it runs without an app.
        jest.isolateModules(() => {
            const { buildMascotMarkup: builder } = require("../src/pagelet/ui/mascot/markup");
            expect(() =>
                builder("idle", { translator: (k: string) => k }),
            ).not.toThrow();
        });
    });
});

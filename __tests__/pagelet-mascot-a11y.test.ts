/* Copyright 2023 edonyzpc */

/**
 * Track B · B5 unit tests for mascot a11y extensions:
 *  - `prefers-reduced-motion`: strips SVG animation classes AND tags the
 *    root with the `--reduce-motion` modifier (markup layer + renderer).
 *  - `aria-live`: announces `done` (polite) / `error` (assertive) on real
 *    state transitions; does NOT re-announce when only the message
 *    changes; clears the region on `idle` / `thinking`.
 *  - Live region DOM is mounted with the right ARIA attributes.
 *  - State-level + i18n-key mappings are stable.
 *  - i18n parity: real `pageletT` returns non-empty EN + ZH announcements.
 */

import { describe, expect, it, jest } from "@jest/globals";

import {
    MASCOT_STATES,
    MASCOT_STATE_ANNOUNCE_I18N_KEY,
    MASCOT_STATE_LIVE_LEVEL,
    buildMascotMarkup,
    type MascotLiveAnnouncement,
    type MascotState,
    type MascotTranslator,
} from "../src/pagelet/ui/mascot";
import {
    createMascotRendererWithHost,
    type MascotDomHost,
    type MascotDomNode,
} from "../src/pagelet/ui/mascot/dom-renderer";
import { pageletT } from "../src/locales/pagelet";

// ---------------------------------------------------------------------------
// Tiny stub host — same shape as pagelet-mascot.test.ts but local to this
// file so refactors in either spec don't ripple.
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

function keyTranslator(): MascotTranslator {
    return (key: string, fallback?: string) => fallback ?? key;
}

// ---------------------------------------------------------------------------
// State → live-level + announce-key tables
// ---------------------------------------------------------------------------

describe("MASCOT_STATE_LIVE_LEVEL", () => {
    it("idle / thinking are silent", () => {
        expect(MASCOT_STATE_LIVE_LEVEL.idle).toBe("off");
        expect(MASCOT_STATE_LIVE_LEVEL.thinking).toBe("off");
    });

    it("done is polite (non-interrupting)", () => {
        expect(MASCOT_STATE_LIVE_LEVEL.done).toBe("polite");
    });

    it("error is assertive (interrupts pending speech)", () => {
        expect(MASCOT_STATE_LIVE_LEVEL.error).toBe("assertive");
    });

    it("is frozen so callers can rely on referential stability", () => {
        expect(Object.isFrozen(MASCOT_STATE_LIVE_LEVEL)).toBe(true);
    });
});

describe("MASCOT_STATE_ANNOUNCE_I18N_KEY", () => {
    it("idle / thinking have no announce key", () => {
        expect(MASCOT_STATE_ANNOUNCE_I18N_KEY.idle).toBeNull();
        expect(MASCOT_STATE_ANNOUNCE_I18N_KEY.thinking).toBeNull();
    });

    it("done + error map to the canonical pagelet.a11y.announce.* keys", () => {
        expect(MASCOT_STATE_ANNOUNCE_I18N_KEY.done).toBe("pagelet.a11y.announce.done");
        expect(MASCOT_STATE_ANNOUNCE_I18N_KEY.error).toBe("pagelet.a11y.announce.error");
    });

    it("is frozen", () => {
        expect(Object.isFrozen(MASCOT_STATE_ANNOUNCE_I18N_KEY)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// i18n parity for the new announcement keys
// ---------------------------------------------------------------------------

describe("pageletT × announce keys", () => {
    it("returns a non-empty EN string for both announce keys", () => {
        expect(pageletT("pagelet.a11y.announce.done", "en").length).toBeGreaterThan(0);
        expect(pageletT("pagelet.a11y.announce.done", "en")).not.toBe("pagelet.a11y.announce.done");
        expect(pageletT("pagelet.a11y.announce.error", "en").length).toBeGreaterThan(0);
        expect(pageletT("pagelet.a11y.announce.error", "en")).not.toBe("pagelet.a11y.announce.error");
    });

    it("returns a non-empty ZH string that differs from EN", () => {
        const enDone = pageletT("pagelet.a11y.announce.done", "en");
        const zhDone = pageletT("pagelet.a11y.announce.done", "zh");
        expect(zhDone.length).toBeGreaterThan(0);
        expect(zhDone).not.toBe(enDone);

        const enErr = pageletT("pagelet.a11y.announce.error", "en");
        const zhErr = pageletT("pagelet.a11y.announce.error", "zh");
        expect(zhErr.length).toBeGreaterThan(0);
        expect(zhErr).not.toBe(enErr);
    });
});

// ---------------------------------------------------------------------------
// buildMascotMarkup × reducedMotion option
// ---------------------------------------------------------------------------

describe("buildMascotMarkup — reducedMotion", () => {
    it.each(MASCOT_STATES)("appends the reduce-motion modifier class for state %s", (state) => {
        const markup = buildMascotMarkup(state, {
            translator: keyTranslator(),
            reducedMotion: true,
        });
        expect(markup.rootClassList).toEqual([
            "pa-pagelet-mascot",
            `pa-pagelet-mascot--${state}`,
            "pa-pagelet-mascot--reduce-motion",
        ]);
    });

    it("does NOT add the reduce-motion modifier when reducedMotion is false / omitted", () => {
        const markup = buildMascotMarkup("idle", { translator: keyTranslator() });
        expect(markup.rootClassList).not.toContain("pa-pagelet-mascot--reduce-motion");
    });

    it("strips animClass from idle's blink eyes when reducedMotion is true", () => {
        const markup = buildMascotMarkup("idle", {
            translator: keyTranslator(),
            reducedMotion: true,
        });
        // All eye arcs (and outline paths) should now have NO animClass.
        for (const path of markup.svgShapes.paths) {
            expect(path.animClass).toBeUndefined();
        }
    });

    it("strips animClass from thinking's pulse circles when reducedMotion is true", () => {
        const markup = buildMascotMarkup("thinking", {
            translator: keyTranslator(),
            reducedMotion: true,
        });
        const circles = markup.svgShapes.circles!;
        for (const c of circles) {
            expect(c.animClass).toBeUndefined();
        }
    });

    it("does NOT mutate the frozen base shapes table", () => {
        // Two consecutive calls — the second WITHOUT reducedMotion — must
        // still return the canonical anim classes. If the builder mutated
        // the shared table, the second call would return stripped shapes.
        buildMascotMarkup("idle", { translator: keyTranslator(), reducedMotion: true });
        const fresh = buildMascotMarkup("idle", { translator: keyTranslator() });
        const blink = fresh.svgShapes.paths.find((p) => p.animClass === "pa-pagelet-anim-blink");
        expect(blink).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Renderer × reducedMotion probe — invoked on construction + every setState
// ---------------------------------------------------------------------------

describe("createMascotRendererWithHost — prefersReducedMotion", () => {
    it("invokes the probe at mount and applies the modifier class", () => {
        const { host, root } = makeStubHost();
        const probe = jest.fn<() => boolean>(() => true);
        createMascotRendererWithHost(root, {
            host,
            initialState: "idle",
            translator: keyTranslator(),
            prefersReducedMotion: probe,
        });
        expect(probe).toHaveBeenCalled();
        expect(root.children[0].classList).toContain("pa-pagelet-mascot--reduce-motion");
    });

    it("re-invokes the probe on every setState so the live setting takes effect", () => {
        const { host, root } = makeStubHost();
        let reduced = false;
        const probe = jest.fn<() => boolean>(() => reduced);
        const renderer = createMascotRendererWithHost(root, {
            host,
            initialState: "idle",
            translator: keyTranslator(),
            prefersReducedMotion: probe,
        });
        expect(root.children[0].classList).not.toContain("pa-pagelet-mascot--reduce-motion");

        // User toggles OS reduce-motion mid-session.
        reduced = true;
        renderer.setState("thinking");
        expect(root.children[0].classList).toContain("pa-pagelet-mascot--reduce-motion");
        // Probe invoked again — at least 2 calls (mount + setState).
        expect(probe.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("treats a throwing probe as 'no reduce-motion preference'", () => {
        const { host, root } = makeStubHost();
        const probe = jest.fn<() => boolean>(() => {
            throw new Error("matchMedia not available");
        });
        createMascotRendererWithHost(root, {
            host,
            initialState: "idle",
            translator: keyTranslator(),
            prefersReducedMotion: probe,
        });
        expect(root.children[0].classList).not.toContain("pa-pagelet-mascot--reduce-motion");
    });
});

// ---------------------------------------------------------------------------
// Renderer × aria-live announcement
// ---------------------------------------------------------------------------

describe("createMascotRendererWithHost — aria-live announcements", () => {
    function liveEl(root: StubNode): StubNode {
        return findByClass(root, "pa-pagelet-mascot__live");
    }

    it("mounts an aria-live region with role + atomic attributes", () => {
        const { host, root } = makeStubHost();
        createMascotRendererWithHost(root, {
            host,
            initialState: "idle",
            translator: keyTranslator(),
        });
        const live = liveEl(root);
        // Initially silent (idle → "off").
        expect(live.attrs["aria-live"]).toBe("off");
        expect(live.attrs["aria-atomic"]).toBe("true");
        expect(live.attrs["role"]).toBe("status");
        // No announcement message yet.
        expect(live.text).toBe("");
    });

    it("announces done at polite level on state transition", () => {
        const { host, root } = makeStubHost();
        const seam = jest.fn<(a: MascotLiveAnnouncement) => void>();
        const renderer = createMascotRendererWithHost(root, {
            host,
            initialState: "idle",
            translator: keyTranslator(),
            announceLiveRegion: seam,
        });
        // Initial idle mount → seam fires (idle is "off" but seam still
        // receives the event so external recorders see the full sequence).
        seam.mockClear();

        renderer.setState("done");
        expect(seam).toHaveBeenCalledTimes(1);
        const arg = seam.mock.calls[0][0];
        expect(arg.state).toBe("done");
        expect(arg.level).toBe("polite");
        expect(arg.message.length).toBeGreaterThan(0);

        const live = liveEl(root);
        expect(live.attrs["aria-live"]).toBe("polite");
        expect(live.text).toBe(arg.message);
    });

    it("announces error at assertive level on state transition", () => {
        const { host, root } = makeStubHost();
        const seam = jest.fn<(a: MascotLiveAnnouncement) => void>();
        const renderer = createMascotRendererWithHost(root, {
            host,
            initialState: "idle",
            translator: keyTranslator(),
            announceLiveRegion: seam,
        });
        seam.mockClear();
        renderer.setState("error");
        const arg = seam.mock.calls[0][0];
        expect(arg.state).toBe("error");
        expect(arg.level).toBe("assertive");
        expect(arg.message.length).toBeGreaterThan(0);
        expect(liveEl(root).attrs["aria-live"]).toBe("assertive");
    });

    it("does NOT re-announce when only the message changes (same state)", () => {
        const { host, root } = makeStubHost();
        const seam = jest.fn<(a: MascotLiveAnnouncement) => void>();
        const renderer = createMascotRendererWithHost(root, {
            host,
            initialState: "thinking",
            translator: keyTranslator(),
            announceLiveRegion: seam,
        });
        seam.mockClear();
        renderer.setState("thinking", { message: "Reviewing notes/foo.md…" });
        renderer.setState("thinking", { message: "Reviewing notes/bar.md…" });
        // No announce — thinking → thinking with new message must stay silent.
        expect(seam).not.toHaveBeenCalled();
    });

    it("clears the region (level=off, empty text) when transitioning to idle / thinking", () => {
        const { host, root } = makeStubHost();
        const renderer = createMascotRendererWithHost(root, {
            host,
            initialState: "done",
            translator: keyTranslator(),
        });
        // Initial done announces something.
        const live = liveEl(root);
        expect(live.attrs["aria-live"]).toBe("polite");
        expect(live.text.length).toBeGreaterThan(0);

        renderer.setState("idle");
        expect(live.attrs["aria-live"]).toBe("off");
        expect(live.text).toBe("");
    });

    it("re-announces when the state cycles done → idle → done", () => {
        const { host, root } = makeStubHost();
        const seam = jest.fn<(a: MascotLiveAnnouncement) => void>();
        const renderer = createMascotRendererWithHost(root, {
            host,
            initialState: "idle",
            translator: keyTranslator(),
            announceLiveRegion: seam,
        });
        seam.mockClear();
        renderer.setState("done");
        renderer.setState("idle");
        renderer.setState("done");
        const doneCalls = seam.mock.calls.filter((c) => c[0].state === "done");
        expect(doneCalls.length).toBe(2);
    });

    it("seam receives the resolved (translated) message", () => {
        const { host, root } = makeStubHost();
        const translator: MascotTranslator = (key, fallback) => {
            if (key === "pagelet.a11y.announce.done") return "TRANSLATED-DONE";
            return fallback ?? key;
        };
        const seam = jest.fn<(a: MascotLiveAnnouncement) => void>();
        const renderer = createMascotRendererWithHost(root, {
            host,
            initialState: "idle",
            translator,
            announceLiveRegion: seam,
        });
        seam.mockClear();
        renderer.setState("done");
        const arg = seam.mock.calls[0][0];
        expect(arg.message).toBe("TRANSLATED-DONE");
        expect(liveEl(root).text).toBe("TRANSLATED-DONE");
    });

    it("falls back to the EN spec default when the translator surfaces the raw key", () => {
        const { host, root } = makeStubHost();
        // keyTranslator returns the key when no fallback is supplied.
        const seam = jest.fn<(a: MascotLiveAnnouncement) => void>();
        const renderer = createMascotRendererWithHost(root, {
            host,
            initialState: "idle",
            translator: (key: string, fallback?: string) => fallback ?? key,
            announceLiveRegion: seam,
        });
        seam.mockClear();
        renderer.setState("error");
        const arg = seam.mock.calls[0][0];
        // Should NOT be the raw key.
        expect(arg.message).not.toBe("pagelet.a11y.announce.error");
        // Should be the hard-coded EN fallback.
        expect(arg.message).toBe("Pagelet review failed. Open the panel for details.");
    });
});

// ---------------------------------------------------------------------------
// Mount-time announcement: a renderer that starts in done / error must
// announce on mount (catches "host restoring mascot from a saved state").
// ---------------------------------------------------------------------------

describe("createMascotRendererWithHost — mount-time announcement", () => {
    it.each<MascotState>(["done", "error"])(
        "announces on initial mount when state is %s",
        (state) => {
            const { host, root } = makeStubHost();
            const seam = jest.fn<(a: MascotLiveAnnouncement) => void>();
            createMascotRendererWithHost(root, {
                host,
                initialState: state,
                translator: (key: string, fallback?: string) => fallback ?? key,
                announceLiveRegion: seam,
            });
            expect(seam).toHaveBeenCalledTimes(1);
            expect(seam.mock.calls[0][0].state).toBe(state);
            expect(seam.mock.calls[0][0].level).toBe(MASCOT_STATE_LIVE_LEVEL[state]);
        },
    );

    it("announces idle / thinking on mount but with level='off' + empty message", () => {
        const { host, root } = makeStubHost();
        const seam = jest.fn<(a: MascotLiveAnnouncement) => void>();
        createMascotRendererWithHost(root, {
            host,
            initialState: "idle",
            translator: (key: string, fallback?: string) => fallback ?? key,
            announceLiveRegion: seam,
        });
        // Mount fires the seam once (full sequence visibility for tests).
        expect(seam).toHaveBeenCalledTimes(1);
        expect(seam.mock.calls[0][0].level).toBe("off");
        expect(seam.mock.calls[0][0].message).toBe("");
    });
});

/* Copyright 2023 edonyzpc */

/**
 * Track B · B5 unit tests for the ribbon registration helper (R4).
 *
 * Coverage matrix:
 *  - Constants (icon ID, CSS class, data-plugin, tooltip) match SDD §6.1 R4.
 *  - "default" position: just append + tag.
 *  - "top" position: append + tag + `--top` modifier class.
 *  - "hidden" position: append + tag + `style.display = "none"`.
 *  - Click callback is forwarded through Obsidian's `addRibbonIcon`.
 *  - The icon ID + tooltip can be overridden by the caller (i18n hook).
 *  - The CSS class + data-plugin attribute are applied for EVERY position
 *    so external tooling can locate the icon regardless of visibility.
 */

import { describe, expect, it, jest } from "@jest/globals";

import {
    PAGELET_DATA_PLUGIN_VALUE,
    PAGELET_RIBBON_CSS_CLASS,
    PAGELET_RIBBON_DEFAULT_TOOLTIP,
    PAGELET_RIBBON_ICON_ID,
    registerPageletRibbonIcon,
    type PageletRibbonElement,
    type PageletRibbonHost,
} from "../src/pagelet/compat/ribbon";

// ---------------------------------------------------------------------------
// Stub element + host — mirror the real Obsidian shape, no DOM dependency.
// ---------------------------------------------------------------------------

interface StubElement extends PageletRibbonElement {
    classes: string[];
    attrs: Record<string, string>;
    style: { display?: string };
}

function makeStubElement(): StubElement {
    const classes: string[] = [];
    const attrs: Record<string, string> = {};
    const style: { display?: string } = {};
    return {
        classes,
        attrs,
        style,
        addClass: (cls: string): void => {
            if (!classes.includes(cls)) classes.push(cls);
        },
        setAttribute: (name: string, value: string): void => {
            attrs[name] = value;
        },
    };
}

interface RecordingHost extends PageletRibbonHost {
    calls: { icon: string; tooltip: string; callback: (evt: MouseEvent) => unknown }[];
    elements: StubElement[];
}

function makeRecordingHost(): RecordingHost {
    const calls: RecordingHost["calls"] = [];
    const elements: StubElement[] = [];
    return {
        calls,
        elements,
        addRibbonIcon: (icon, tooltip, callback) => {
            const el = makeStubElement();
            elements.push(el);
            calls.push({ icon, tooltip, callback });
            return el;
        },
    };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("PAGELET_RIBBON_* constants", () => {
    it("icon ID matches SDD §6.1 R4 (`scroll-text`)", () => {
        expect(PAGELET_RIBBON_ICON_ID).toBe("scroll-text");
    });

    it("CSS class follows the `pa-pagelet-` convention", () => {
        expect(PAGELET_RIBBON_CSS_CLASS).toBe("pa-pagelet-ribbon-icon");
    });

    it("data-plugin value mirrors the mascot's tag", () => {
        expect(PAGELET_DATA_PLUGIN_VALUE).toBe("pa-pagelet");
    });

    it("tooltip default includes the Beta marker for support reports", () => {
        expect(PAGELET_RIBBON_DEFAULT_TOOLTIP).toBe("Pagelet (Beta)");
    });
});

// ---------------------------------------------------------------------------
// registerPageletRibbonIcon
// ---------------------------------------------------------------------------

describe("registerPageletRibbonIcon", () => {
    it("calls addRibbonIcon with the default icon + tooltip + click handler", () => {
        const host = makeRecordingHost();
        const onClick = jest.fn();
        const result = registerPageletRibbonIcon(host, {
            position: "default",
            onClick,
        });
        expect(host.calls).toHaveLength(1);
        expect(host.calls[0].icon).toBe(PAGELET_RIBBON_ICON_ID);
        expect(host.calls[0].tooltip).toBe(PAGELET_RIBBON_DEFAULT_TOOLTIP);
        expect(host.calls[0].callback).toBe(onClick);
        expect(result.position).toBe("default");
        expect(result.hidden).toBe(false);
        expect(result.element).toBe(host.elements[0]);
    });

    it("accepts a tooltip override (for i18n) and an icon override", () => {
        const host = makeRecordingHost();
        registerPageletRibbonIcon(host, {
            position: "default",
            onClick: () => undefined,
            tooltip: "拾页 (Beta)",
            iconId: "feather",
        });
        expect(host.calls[0].icon).toBe("feather");
        expect(host.calls[0].tooltip).toBe("拾页 (Beta)");
    });

    it("tags the element with the stable class + data-plugin attribute", () => {
        const host = makeRecordingHost();
        registerPageletRibbonIcon(host, {
            position: "default",
            onClick: () => undefined,
        });
        const el = host.elements[0];
        expect(el.classes).toContain(PAGELET_RIBBON_CSS_CLASS);
        expect(el.attrs["data-plugin"]).toBe(PAGELET_DATA_PLUGIN_VALUE);
    });

    it("`top` position adds the `--top` modifier class", () => {
        const host = makeRecordingHost();
        const result = registerPageletRibbonIcon(host, {
            position: "top",
            onClick: () => undefined,
        });
        const el = host.elements[0];
        expect(el.classes).toContain(PAGELET_RIBBON_CSS_CLASS);
        expect(el.classes).toContain(`${PAGELET_RIBBON_CSS_CLASS}--top`);
        expect(result.position).toBe("top");
        expect(result.hidden).toBe(false);
    });

    it("`hidden` position sets style.display = 'none' and reports hidden=true", () => {
        const host = makeRecordingHost();
        const result = registerPageletRibbonIcon(host, {
            position: "hidden",
            onClick: () => undefined,
        });
        const el = host.elements[0];
        // Stable identification stays so re-enabling later does not need re-mount.
        expect(el.classes).toContain(PAGELET_RIBBON_CSS_CLASS);
        expect(el.attrs["data-plugin"]).toBe(PAGELET_DATA_PLUGIN_VALUE);
        expect(el.style.display).toBe("none");
        expect(result.hidden).toBe(true);
        expect(result.position).toBe("hidden");
    });

    it("`default` position never sets style.display nor the --top modifier", () => {
        const host = makeRecordingHost();
        registerPageletRibbonIcon(host, {
            position: "default",
            onClick: () => undefined,
        });
        const el = host.elements[0];
        expect(el.classes).not.toContain(`${PAGELET_RIBBON_CSS_CLASS}--top`);
        expect(el.style.display).toBeUndefined();
    });

    it("invokes the user callback when the host fires the ribbon click", () => {
        const host = makeRecordingHost();
        const onClick = jest.fn();
        registerPageletRibbonIcon(host, {
            position: "default",
            onClick,
        });
        // Simulate Obsidian's invocation of the click handler.
        host.calls[0].callback({} as MouseEvent);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("returns the element handle the host produced, not a fresh one", () => {
        const host = makeRecordingHost();
        const result = registerPageletRibbonIcon(host, {
            position: "default",
            onClick: () => undefined,
        });
        expect(result.element).toBe(host.elements[0]);
    });
});

import type { App, MarkdownPostProcessor, Plugin } from "obsidian";
import { MarkdownPreviewRenderer } from "obsidian";
import { TagAppearanceIntegration } from "../src/tag-appearance/integration";

jest.mock("obsidian", () => ({
    MarkdownPreviewRenderer: {
        registerPostProcessor: jest.fn(),
        unregisterPostProcessor: jest.fn(),
    },
    MarkdownRenderChild: class {
        constructor(readonly containerEl: HTMLElement) {}
        register(_callback: () => void): void {}
    },
}));
jest.mock("../src/tag-appearance/editor", () => ({ tagAppearanceEditorExtension: {} }));

// This repo has no browser-DOM test dependency. Keep the fixture confined to
// selectors and observer boundaries used by this native adapter.
class FixtureDocument {
    readonly observers: FixtureObserver[] = [];
    defaultView: { MutationObserver: typeof FixtureObserver } | null;

    constructor() {
        const observers = this.observers;
        this.defaultView = { MutationObserver: class extends FixtureObserver {
            constructor(callback: MutationCallback) {
                super(callback);
                observers.push(this);
            }
        } };
    }

    element(tag: string, classes = "", text = ""): FixtureElement {
        return new FixtureElement(this, tag, classes, text);
    }
}

class FixtureObserver {
    target?: FixtureElement;
    options?: MutationObserverInit;
    disconnected = false;
    constructor(private readonly callback: MutationCallback) {}
    observe(target: Node, options: MutationObserverInit): void {
        this.target = target as unknown as FixtureElement;
        this.options = options;
    }
    disconnect(): void { this.disconnected = true; }
    emit(target: FixtureElement, added: FixtureElement[] = [], removed: FixtureElement[] = []): void {
        if (!this.disconnected) this.callback([
            { type: "childList", target, addedNodes: added, removedNodes: removed } as unknown as MutationRecord,
        ], this as unknown as MutationObserver);
    }
}

class FixtureElement {
    readonly nodeType = 1;
    readonly children: FixtureElement[] = [];
    readonly attrs = new Map<string, string>();
    readonly classes: Set<string>;
    parentElement: FixtureElement | null = null;
    onclick?: () => void;

    constructor(readonly ownerDocument: FixtureDocument, readonly tag: string, classes: string, public textContent: string) {
        this.classes = new Set(classes.split(" ").filter(Boolean));
    }

    get classList() {
        return {
            add: (name: string) => this.classes.add(name),
            remove: (name: string) => this.classes.delete(name),
            contains: (name: string) => this.classes.has(name),
        };
    }
    append(...elements: FixtureElement[]): void {
        for (const element of elements) {
            element.parentElement = this;
            this.children.push(element);
        }
    }
    remove(element: FixtureElement): void {
        this.children.splice(this.children.indexOf(element), 1);
        element.parentElement = null;
    }
    setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
    removeAttribute(name: string): void { this.attrs.delete(name); }
    contains(node: FixtureElement): boolean {
        return node === this || this.children.some((child) => child.contains(node));
    }
    matches(selector: string): boolean {
        return selector.split(", ").some((candidate) => {
            const classes = Array.from(candidate.matchAll(/\.([\w-]+)/g), (match) => match[1]);
            const type = candidate.match(/^([a-z]+)/)?.[1];
            const attribute = candidate.match(/\[([^=]+)="([^"]+)"\]/);
            return (!type || type === this.tag) && classes.every((name) => this.classes.has(name)) &&
                (!attribute || this.attrs.get(attribute[1]) === attribute[2]);
        });
    }
    closest(selector: string): FixtureElement | null {
        return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null;
    }
    querySelectorAll(selector: string): FixtureElement[] {
        return this.children.flatMap((child) => [
            ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
        ]);
    }
    querySelector(selector: string): FixtureElement | null { return this.querySelectorAll(selector)[0] ?? null; }
    asElement(): HTMLElement { return this as unknown as HTMLElement; }
}

function fixture() {
    const doc = new FixtureDocument();
    const content = doc.element("div");
    const preview = doc.element("div", "markdown-preview-view");
    const source = doc.element("div", "markdown-source-view");
    const sizer = doc.element("div", "cm-sizer");
    content.append(preview, source);
    source.append(sizer);
    const leaves = [{ view: {
        getViewType: () => "markdown",
        contentEl: content.asElement(),
        previewMode: { containerEl: preview.asElement() },
        file: { path: "fixture.md" },
    } }];
    const listeners = new Map<object, () => void>();
    const workspace = {
        on: jest.fn((_name: string, callback: () => void) => {
            const ref = {};
            listeners.set(ref, callback);
            return ref;
        }),
        offref: jest.fn((ref: object) => listeners.delete(ref)),
        iterateAllLeaves: (callback: (leaf: unknown) => void) => leaves.forEach(callback),
        updateOptions: jest.fn(),
    };
    const registerEditorExtension = jest.fn();
    const integration = new TagAppearanceIntegration(
        { workspace } as unknown as App,
        { registerEditorExtension } as unknown as Pick<Plugin, "registerEditorExtension">,
    );
    const property = (name: string, type = "tags") => {
        const metadata = doc.element("div", "metadata-container");
        const value = doc.element("div", "metadata-property-value");
        value.setAttribute("data-property-type", type);
        const pill = doc.element("div", "multi-select-pill");
        const label = doc.element("span", "multi-select-pill-content", name);
        const remove = doc.element("button", "multi-select-pill-remove-button", "×");
        pill.append(label, remove);
        value.append(pill);
        metadata.append(value);
        return { metadata, pill, label, remove };
    };
    return { doc, content, preview, source, sizer, leaves, listeners, workspace, registerEditorExtension, integration, property };
}

function processor(): MarkdownPostProcessor {
    const calls = (MarkdownPreviewRenderer.registerPostProcessor as jest.Mock).mock.calls;
    return calls[calls.length - 1][0];
}

describe("opt-in tag appearance lifecycle", () => {
    test("off owns no active resources; repeated settings are idempotent and disable restores markers", () => {
        const f = fixture();
        const tag = f.doc.element("a", "tag", "#Topic");
        const tags = f.property("项目/工作");
        const aliases = f.property("Topic", "multitext");
        f.preview.append(tag);
        f.sizer.append(tags.metadata, aliases.metadata);
        f.integration.setEnabled(false);
        expect(f.registerEditorExtension).not.toHaveBeenCalled();
        expect(f.listeners.size).toBe(0);
        expect(f.doc.observers).toHaveLength(0);
        expect(MarkdownPreviewRenderer.registerPostProcessor).not.toHaveBeenCalled();

        f.integration.setEnabled(true);
        const extensions = f.registerEditorExtension.mock.calls[0][0];
        const oldProcessor = processor();
        expect(tag.attrs.get("data-pa-tag-color")).toBe("blue");
        expect(tags.pill.attrs.get("data-pa-tag-color")).toBe("brown");
        expect(aliases.pill.attrs.has("data-pa-tag-color")).toBe(false);
        expect(extensions).toHaveLength(1);
        f.integration.setEnabled(true);
        expect(f.workspace.updateOptions).toHaveBeenCalledTimes(1);
        expect(f.registerEditorExtension).toHaveBeenCalledTimes(1);

        f.integration.setEnabled(false);
        expect(extensions).toHaveLength(0);
        expect(f.listeners.size).toBe(0);
        expect(f.doc.observers.every((observer) => observer.disconnected)).toBe(true);
        expect(tag.classList.contains("pa-tag-appearance")).toBe(false);
        expect(tags.pill.attrs.has("data-pa-tag-color")).toBe(false);
        expect(MarkdownPreviewRenderer.unregisterPostProcessor).toHaveBeenCalledWith(oldProcessor);
        oldProcessor(tag.asElement(), { sourcePath: "fixture.md", addChild: jest.fn() } as never);
        expect(tag.attrs.has("data-pa-tag-color")).toBe(false);
        f.integration.setEnabled(true);
        expect(f.registerEditorExtension).toHaveBeenCalledTimes(1);
        f.integration.dispose();
        f.integration.setEnabled(true);
        expect(f.workspace.updateOptions).toHaveBeenCalledTimes(4);
    });

    test("new Properties widgets and pill edits use local observers and preserve native buttons", async () => {
        const f = fixture();
        f.integration.setEnabled(true);
        const tags = f.property("Topic");
        const handler = jest.fn();
        tags.remove.onclick = handler;
        f.sizer.append(tags.metadata);
        const sizerObserver = f.doc.observers.find((observer) => observer.target === f.sizer)!;
        expect(sizerObserver.options).toEqual({ childList: true });
        sizerObserver.emit(f.sizer, [tags.metadata]);
        await Promise.resolve();
        expect(tags.pill.attrs.get("data-pa-tag-color")).toBe("blue");
        const propertyObserver = f.doc.observers.find((observer) => observer.target === tags.metadata)!;
        tags.label.textContent = "项目/工作";
        propertyObserver.emit(tags.label);
        expect(tags.pill.attrs.get("data-pa-tag-color")).toBe("brown");
        expect(tags.remove.onclick).toBe(handler);
        expect(tags.remove.textContent).toBe("×");
        f.sizer.remove(tags.metadata);
        sizerObserver.emit(f.sizer, [], [tags.metadata]);
        await Promise.resolve();
        expect(propertyObserver.disconnected).toBe(true);
        expect(tags.pill.attrs.has("data-pa-tag-color")).toBe(false);
        f.integration.dispose();
    });

    test("only genuine RecordList roots and native reading provenance qualify", () => {
        const f = fixture();
        const recordsContent = f.doc.element("div");
        const recordsPreview = f.doc.element("div", "pa-recordlist-preview-view");
        const record = f.doc.element("div", "record-wrapper");
        const tag = f.doc.element("a", "tag", "#Topic");
        const chip = f.doc.element("span", "pa-pagelet-tab-tag-chip", "Topic");
        const outsideTag = f.doc.element("a", "tag", "#Topic");
        record.append(tag, chip);
        recordsPreview.append(record);
        recordsContent.append(recordsPreview, outsideTag);
        f.leaves.push({ view: { getViewType: () => "record-preview", contentEl: recordsContent.asElement() } } as never);
        f.integration.setEnabled(true);
        expect(tag.attrs.get("data-pa-tag-color")).toBe("blue");
        expect(chip.attrs.has("data-pa-tag-color")).toBe(false);
        expect(outsideTag.attrs.has("data-pa-tag-color")).toBe(false);
        const detached = f.doc.element("a", "tag", "#Topic");
        const addChild = jest.fn();
        processor()(detached.asElement(), { sourcePath: "fixture.md", addChild } as never);
        expect(detached.attrs.has("data-pa-tag-color")).toBe(false);
        expect(addChild).not.toHaveBeenCalled();
        f.integration.dispose();
    });

    test("reading Properties appearing after a delayed header mount get connected", async () => {
        const f = fixture();
        const previewSizer = f.doc.element("div", "markdown-preview-sizer");
        f.preview.append(previewSizer);
        f.integration.setEnabled(true);
        const header = f.doc.element("div", "mod-header mod-ui");
        previewSizer.append(header);
        f.doc.observers.find((observer) => observer.target === previewSizer)!.emit(previewSizer, [header]);
        await Promise.resolve();
        const tags = f.property("Topic");
        header.append(tags.metadata);
        f.doc.observers.find((observer) => observer.target === header)!.emit(header, [tags.metadata]);
        await Promise.resolve();
        expect(tags.pill.attrs.get("data-pa-tag-color")).toBe("blue");
        f.integration.dispose();
        expect(tags.pill.attrs.has("data-pa-tag-color")).toBe(false);
    });

    test("file Properties and new windows use their own document and unload cancels queued refresh", async () => {
        const f = fixture();
        const popout = new FixtureDocument();
        const content = popout.element("div");
        const metadata = popout.element("div", "metadata-container");
        const value = popout.element("div", "metadata-property-value");
        value.setAttribute("data-property-type", "tags");
        const pill = popout.element("div", "multi-select-pill");
        pill.append(popout.element("span", "multi-select-pill-content", "Topic"));
        value.append(pill);
        metadata.append(value);
        content.append(metadata);
        f.leaves.push({ view: {
            getViewType: () => "file-properties", contentEl: content.asElement(), file: { path: "other.md" },
        } } as never);
        f.integration.setEnabled(true);
        expect(pill.attrs.get("data-pa-tag-color")).toBe("blue");
        expect(popout.observers).toHaveLength(1);
        f.listeners.values().next().value!();
        const count = f.doc.observers.length;
        f.integration.dispose();
        await Promise.resolve();
        expect(popout.observers[0].disconnected).toBe(true);
        expect(pill.attrs.has("data-pa-tag-color")).toBe(false);
        expect(f.doc.observers).toHaveLength(count);
    });

    test("a closed popout leaf remaining in inventory is detached and does not prevent reopening", async () => {
        const f = fixture();
        const popout = new FixtureDocument();
        const content = popout.element("div");
        const source = popout.element("div", "markdown-source-view");
        const sizer = popout.element("div", "cm-sizer");
        const preview = popout.element("div", "markdown-preview-view");
        const tag = popout.element("a", "tag", "#Topic");
        preview.append(tag);
        source.append(sizer);
        content.append(preview, source);
        f.leaves.push({ view: {
            getViewType: () => "markdown", contentEl: content.asElement(),
            previewMode: { containerEl: preview.asElement() }, file: { path: "popout.md" },
        } });
        f.integration.setEnabled(true);
        expect(tag.attrs.get("data-pa-tag-color")).toBe("blue");
        expect(popout.observers.length).toBeGreaterThan(1);

        // Live Obsidian evidence: the closed leaf can still be enumerated,
        // but its document.defaultView is null at this lifecycle boundary.
        popout.defaultView = null;
        f.listeners.values().next().value!();
        await Promise.resolve();
        expect(popout.observers.every((observer) => observer.disconnected)).toBe(true);
        expect(tag.attrs.has("data-pa-tag-color")).toBe(false);

        f.integration.setEnabled(false);
        const observersBefore = popout.observers.length;
        expect(() => f.integration.setEnabled(true)).not.toThrow();
        expect(popout.observers).toHaveLength(observersBefore);
        expect(tag.attrs.has("data-pa-tag-color")).toBe(false);
        f.integration.dispose();
    });
});

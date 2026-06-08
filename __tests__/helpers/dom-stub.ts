/* Copyright 2023 edonyzpc */

/**
 * Shared DOM stub for unit tests that need a lightweight fake DOM tree.
 *
 * Unifies the FakeElement class (pagelet-view.test.ts) and StubNode
 * interface (pagelet-suggestion-card.test.ts) into a single superset
 * class that satisfies both HTMLElement-like assertions and the
 * SuggestionCardDomNode contract.
 */

export type DomStubListener = (event: unknown) => void;

export class DomStubClassList {
    constructor(private readonly owner: DomStubNode) { }

    add(...classes: string[]): void {
        const tokens = new Set(this.tokens());
        for (const cls of classes) {
            if (cls.length > 0) tokens.add(cls);
        }
        this.owner.className = [...tokens].join(" ");
    }

    contains(cls: string): boolean {
        return this.tokens().includes(cls);
    }

    toggle(cls: string, force?: boolean): boolean {
        const tokens = new Set(this.tokens());
        const shouldAdd = force ?? !tokens.has(cls);
        if (shouldAdd) {
            tokens.add(cls);
        } else {
            tokens.delete(cls);
        }
        this.owner.className = [...tokens].join(" ");
        return shouldAdd;
    }

    private tokens(): string[] {
        return splitClasses(this.owner.className);
    }
}

export class DomStubStyle {
    readonly props = new Map<string, string>();

    setProperty(name: string, value: string): void {
        this.props.set(name, value);
    }
}

export class DomStubNode {
    className = "";
    readonly attributes = new Map<string, string>();
    readonly children: DomStubNode[] = [];
    parentElement: DomStubNode | null = null;
    readonly classList = new DomStubClassList(this);
    readonly style = new DomStubStyle();
    checked = false;
    disabled = false;
    hidden = false;
    value = "";
    private readonly _listeners = new Map<string, DomStubListener[]>();
    private _textValue = "";

    constructor(
        readonly tagName: string,
        readonly namespace: "html" | "svg" = "html",
    ) { }

    // --- StubNode-compatible aliases ---

    /** Alias for {@link tagName} (StubNode compat). */
    get tag(): string { return this.tagName; }

    /** Alias for internal text value (StubNode compat). */
    get text(): string { return this._textValue; }
    set text(value: string) { this._textValue = value; }

    /** Alias for {@link parentElement} (StubNode compat). */
    get parent(): DomStubNode | null { return this.parentElement; }
    set parent(value: DomStubNode | null) { this.parentElement = value; }

    /** Returns a snapshot of attributes as a plain object (StubNode compat). */
    get attrs(): Record<string, string> {
        return Object.fromEntries(this.attributes);
    }

    /** Returns class names as a string array (StubNode compat). */
    get classNames(): string[] {
        return splitClasses(this.className);
    }

    /** Flattened listener entries for assertion access (StubNode compat). */
    get listeners(): Array<{ event: string; handler: DomStubListener }> {
        const entries: Array<{ event: string; handler: DomStubListener }> = [];
        for (const [event, handlers] of this._listeners) {
            for (const handler of handlers) {
                entries.push({ event, handler });
            }
        }
        return entries;
    }

    // --- HTMLElement-like interface ---

    get textContent(): string {
        return this._textValue;
    }

    set textContent(value: string | null) {
        this._textValue = value ?? "";
        for (const child of this.children) child.parentElement = null;
        this.children.splice(0);
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
        if (name === "class") this.className = value;
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    removeAttribute(name: string): void {
        this.attributes.delete(name);
        if (name === "class") this.className = "";
    }

    appendChild<T>(child: T): T {
        const stub = child as unknown as DomStubNode;
        if (stub.parentElement) stub.parentElement.removeChild(stub);
        stub.parentElement = this;
        this.children.push(stub);
        return child;
    }

    removeChild<T>(child: T): T {
        const stub = child as unknown as DomStubNode;
        const index = this.children.indexOf(stub);
        if (index >= 0) this.children.splice(index, 1);
        stub.parentElement = null;
        return child;
    }

    remove(): void {
        this.parentElement?.removeChild(this);
    }

    contains(other: unknown): boolean {
        if (other === this) return true;
        const node = other as DomStubNode | null;
        if (!node) return false;
        return this.children.some((child) => child.contains(node));
    }

    addEventListener(event: string, listener: unknown): void {
        const listeners = this._listeners.get(event) ?? [];
        listeners.push(listener as DomStubListener);
        this._listeners.set(event, listeners);
    }

    removeEventListener(event: string, listener: unknown): void {
        const listeners = this._listeners.get(event);
        if (!listeners) return;
        const index = listeners.indexOf(listener as DomStubListener);
        if (index >= 0) listeners.splice(index, 1);
    }

    dispatch(event: string, payload: unknown = { type: event }): void {
        for (const listener of [...(this._listeners.get(event) ?? [])]) {
            listener(payload);
        }
    }

    // --- SuggestionCardDomNode-compatible methods ---

    setText(text: string): void {
        this._textValue = text;
    }

    setClassList(classes: readonly string[]): void {
        const value = [...classes].join(" ");
        this.className = value;
        this.attributes.set("class", value);
    }

    setStyleProperty(name: string, value: string): void {
        this.style.setProperty(name, value);
    }
}

// ---------------------------------------------------------------------------
// Tree-query helpers (shared across test files)
// ---------------------------------------------------------------------------

export function splitClasses(className: string): string[] {
    return className.split(/\s+/).filter(Boolean);
}

export function hasClass(node: DomStubNode, className: string): boolean {
    return splitClasses(node.className).includes(className);
}

export function findAllByClass(root: DomStubNode, className: string): DomStubNode[] {
    const results: DomStubNode[] = [];
    const walk = (node: DomStubNode): void => {
        if (hasClass(node, className)) results.push(node);
        for (const child of node.children) walk(child);
    };
    walk(root);
    return results;
}

export function findByClass(root: DomStubNode, className: string): DomStubNode {
    const results = findAllByClass(root, className);
    if (results.length !== 1) {
        throw new Error(`expected exactly one .${className}, got ${results.length}`);
    }
    return results[0];
}

export function findAllByTag(root: DomStubNode, tagName: string): DomStubNode[] {
    const expected = tagName.toLowerCase();
    const results: DomStubNode[] = [];
    const walk = (node: DomStubNode): void => {
        if (node.tagName.toLowerCase() === expected) results.push(node);
        for (const child of node.children) walk(child);
    };
    walk(root);
    return results;
}

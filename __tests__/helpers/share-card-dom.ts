export class ShareCardTestClassList {
    private readonly values = new Set<string>();

    add(...classes: string[]): void {
        for (const value of classes) this.values.add(value);
    }

    remove(...classes: string[]): void {
        for (const value of classes) this.values.delete(value);
    }

    contains(value: string): boolean {
        return this.values.has(value);
    }
}

export class ShareCardTestElement {
    readonly classList = new ShareCardTestClassList();
    readonly children: ShareCardTestElement[] = [];
    readonly attributes = new Map<string, string>();
    readonly dataset: Record<string, string> = {};
    readonly listeners = new Map<string, Array<() => void>>();
    readonly style = {
        width: "",
        height: "",
        values: new Map<string, string>(),
        setProperty: (key: string, value: string): void => {
            this.style.values.set(key, value);
        },
        removeProperty: (key: string): string => {
            const previous = this.style.values.get(key) ?? "";
            this.style.values.delete(key);
            const inlineStyle = this.attributes.get("style");
            if (inlineStyle !== undefined) {
                const declarations = inlineStyle.split(";").map((part) => part.trim()).filter(Boolean);
                const retained = declarations.filter((declaration) => (
                    declaration.slice(0, declaration.indexOf(":"))
                        .trim().toLowerCase() !== key.toLowerCase()
                ));
                if (retained.length > 0) {
                    this.attributes.set("style", retained.join("; "));
                } else {
                    this.attributes.delete("style");
                }
            }
            return previous;
        },
    };
    parentElement: ShareCardTestElement | null = null;
    textContent = "";
    id = "";
    title = "";
    type = "";
    disabled = false;
    hidden = false;
    clientWidth = 540;
    clientHeight = 500;
    scrollHeight = 500;
    isConnected = false;

    constructor(
        readonly tagName: string,
        readonly ownerDocument: ShareCardTestDocument,
    ) {}

    get firstChild(): ShareCardTestElement | null {
        return this.children[0] ?? null;
    }

    get childNodes(): ShareCardTestElement[] {
        return this.children;
    }

    appendChild(child: ShareCardTestElement): ShareCardTestElement {
        child.parentElement?.removeChild(child);
        child.parentElement = this;
        child.setConnected(this.isConnected);
        this.children.push(child);
        return child;
    }

    removeChild(child: ShareCardTestElement): ShareCardTestElement {
        const index = this.children.indexOf(child);
        if (index >= 0) this.children.splice(index, 1);
        child.parentElement = null;
        child.setConnected(false);
        return child;
    }

    remove(): void {
        this.parentElement?.removeChild(this);
    }

    replaceWith(...nodes: ShareCardTestElement[]): void {
        const parent = this.parentElement;
        if (!parent) return;
        const index = parent.children.indexOf(this);
        if (index < 0) return;
        parent.children.splice(index, 1);
        this.parentElement = null;
        this.setConnected(false);
        let insertAt = index;
        for (const node of nodes) {
            node.parentElement?.removeChild(node);
            node.parentElement = parent;
            node.setConnected(parent.isConnected);
            parent.children.splice(insertAt, 0, node);
            insertAt += 1;
        }
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
        if (name === "id") this.id = value;
    }

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    getAttributeNames(): string[] {
        return [...this.attributes.keys()];
    }

    removeAttribute(name: string): void {
        this.attributes.delete(name);
    }

    addEventListener(type: string, listener: () => void): void {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: () => void): void {
        const listeners = this.listeners.get(type);
        if (!listeners) return;
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
    }

    click(): void {
        if (this.disabled) return;
        for (const listener of this.listeners.get("click") ?? []) listener();
    }

    querySelector(selector: string): ShareCardTestElement | null {
        return this.querySelectorAll(selector)[0] ?? null;
    }

    querySelectorAll(selector: string): ShareCardTestElement[] {
        const selectors = selector.split(",").map((part) => part.trim()).filter(Boolean);
        const results: ShareCardTestElement[] = [];
        const visit = (element: ShareCardTestElement): void => {
            for (const child of element.children) {
                if (selectors.some((candidate) => matches(child, candidate))) results.push(child);
                visit(child);
            }
        };
        visit(this);
        return results;
    }

    private setConnected(value: boolean): void {
        this.isConnected = value;
        for (const child of this.children) child.setConnected(value);
    }
}

export class ShareCardTestDocument {
    readonly documentElement: ShareCardTestElement;
    readonly body: ShareCardTestElement;
    readonly defaultView: {
        innerWidth: number;
        navigator: { clipboard?: { write(items: unknown[]): Promise<void> } };
        ClipboardItem?: new (items: Record<string, Blob | PromiseLike<Blob>>) => ClipboardItem;
        requestAnimationFrame(callback: FrameRequestCallback): number;
        addEventListener(type: string, listener: () => void): void;
        removeEventListener(type: string, listener: () => void): void;
    };
    private readonly windowListeners = new Map<string, Array<() => void>>();

    constructor() {
        this.documentElement = new ShareCardTestElement("html", this);
        this.documentElement.isConnected = true;
        this.body = new ShareCardTestElement("body", this);
        this.documentElement.appendChild(this.body);
        this.defaultView = {
            innerWidth: 700,
            navigator: {},
            requestAnimationFrame: (callback) => {
                callback(0);
                return 1;
            },
            addEventListener: (type, listener) => {
                const listeners = this.windowListeners.get(type) ?? [];
                listeners.push(listener);
                this.windowListeners.set(type, listeners);
            },
            removeEventListener: (type, listener) => {
                const listeners = this.windowListeners.get(type);
                if (!listeners) return;
                const index = listeners.indexOf(listener);
                if (index >= 0) listeners.splice(index, 1);
            },
        };
    }

    createElement(tagName: string): ShareCardTestElement {
        return new ShareCardTestElement(tagName.toLowerCase(), this);
    }

    listenerCount(type: string): number {
        return this.windowListeners.get(type)?.length ?? 0;
    }
}

function matches(element: ShareCardTestElement, selector: string): boolean {
    if (selector === "*") return true;
    if (selector.startsWith(".")) return element.classList.contains(selector.slice(1));
    return element.tagName === selector.toLowerCase();
}

export function asDocument(document: ShareCardTestDocument): Document {
    return document as unknown as Document;
}

export function asElement(element: ShareCardTestElement): HTMLElement {
    return element as unknown as HTMLElement;
}

export async function flushShareCardTasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

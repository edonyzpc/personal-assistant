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

    toArray(): string[] {
        return [...this.values];
    }

    toggle(value: string, force?: boolean): boolean {
        const enabled = force ?? !this.values.has(value);
        if (enabled) this.values.add(value);
        else this.values.delete(value);
        return enabled;
    }
}

export class ShareCardTestTextNode {
    readonly nodeType = 3;
    readonly tagName = "#text";
    parentNode: unknown = null;
    parentElement: ShareCardTestElement | null = null;

    constructor(public data: string) {}

    get textContent(): string {
        return this.data;
    }

    cloneNode(): ShareCardTestTextNode {
        return new ShareCardTestTextNode(this.data);
    }

    remove(): void {
        this.parentElement?.removeTextNode(this);
        this.parentNode = null;
        this.parentElement = null;
    }
}

export class ShareCardTestCommentNode {
    readonly nodeType = 8;
    readonly tagName = "#comment";
    parentNode: unknown = null;
    parentElement: ShareCardTestElement | null = null;

    constructor(public data: string) {}

    get textContent(): string {
        return this.data;
    }

    cloneNode(): ShareCardTestCommentNode {
        return new ShareCardTestCommentNode(this.data);
    }

    remove(): void {
        this.parentElement?.removeTextNode(this);
        this.parentNode = null;
        this.parentElement = null;
    }
}

export type ShareCardTestChildNode =
    | ShareCardTestElement
    | ShareCardTestTextNode
    | ShareCardTestCommentNode;

export class ShareCardTestElement {
    readonly nodeType: number;
    readonly classList = new ShareCardTestClassList();
    readonly children: ShareCardTestElement[] = [];
    readonly allChildNodes: ShareCardTestChildNode[] = [];
    readonly attributes = new Map<string, string>();
    readonly dataset: Record<string, string> = {};
    readonly listeners = new Map<string, Array<(event?: unknown) => void>>();
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
    parentNode: unknown = null;
    private directText = "";
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
    ) {
        this.nodeType = tagName === "#document-fragment" ? 11 : 1;
    }

    get firstChild(): ShareCardTestChildNode | null {
        return this.childNodes[0] ?? null;
    }

    get childNodes(): ShareCardTestChildNode[] & {
        item(index: number): ShareCardTestChildNode | null;
    } {
        const nodes = this.ownerDocument.enableRealDomClones ? this.allChildNodes : this.children;
        return Object.assign(nodes, {
            item: (index: number): ShareCardTestChildNode | null => (
                nodes[index] ?? null
            ),
        });
    }

    get textContent(): string {
        return this.ownerDocument.enableRealDomClones
            ? this.allChildNodes.map((node) => node.textContent).join("")
            : this.directText || this.allChildNodes.map((node) => node.textContent).join("");
    }

    set textContent(value: string) {
        if (!this.ownerDocument.enableRealDomClones) {
            this.directText = value;
            return;
        }
        for (const node of [...this.allChildNodes]) node.remove();
        this.children.length = 0;
        this.directText = "";
        if (value !== "") this.appendTextNode(new ShareCardTestTextNode(value));
    }

    appendChild(child: ShareCardTestElement): ShareCardTestElement {
        if (child instanceof ShareCardTestTextNode || child instanceof ShareCardTestCommentNode) {
            this.appendTextNode(child);
            return child;
        }
        if (child.tagName === "#document-fragment") {
            for (const node of [...child.allChildNodes]) {
                if (node instanceof ShareCardTestElement) this.appendChild(node);
                else this.appendTextNode(node);
            }
            return child;
        }
        child.parentElement?.removeChild(child);
        child.parentElement = this;
        child.parentNode = this;
        child.setConnected(this.isConnected);
        this.children.push(child);
        this.allChildNodes.push(child);
        return child;
    }

    appendTextNode(child: ShareCardTestTextNode | ShareCardTestCommentNode): void {
        child.parentElement?.removeTextNode(child);
        child.parentNode = this;
        child.parentElement = this;
        this.allChildNodes.push(child);
    }

    removeChild(child: ShareCardTestElement): ShareCardTestElement {
        const index = this.children.indexOf(child);
        if (index >= 0) this.children.splice(index, 1);
        const nodeIndex = this.allChildNodes.indexOf(child);
        if (nodeIndex >= 0) this.allChildNodes.splice(nodeIndex, 1);
        child.parentElement = null;
        child.parentNode = null;
        child.setConnected(false);
        return child;
    }

    removeTextNode(child: ShareCardTestTextNode | ShareCardTestCommentNode): void {
        const index = this.allChildNodes.indexOf(child);
        if (index >= 0) this.allChildNodes.splice(index, 1);
        child.parentNode = null;
        child.parentElement = null;
    }

    remove(): void {
        this.parentElement?.removeChild(this);
    }

    replaceWith(...nodes: ShareCardTestElement[]): void {
        const parent = this.parentElement;
        if (!parent) return;
        const index = parent.allChildNodes.indexOf(this);
        if (index < 0) return;
        parent.allChildNodes.splice(index, 1);
        const elementIndex = parent.children.indexOf(this);
        if (elementIndex >= 0) parent.children.splice(elementIndex, 1);
        this.parentElement = null;
        this.parentNode = null;
        this.setConnected(false);
        let insertAt = index;
        for (const node of nodes) {
            node.parentElement?.removeChild(node);
            node.parentElement = parent;
            node.parentNode = parent;
            node.setConnected(parent.isConnected);
            parent.allChildNodes.splice(insertAt, 0, node);
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

    addEventListener(type: string, listener: (event?: unknown) => void): void {
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
        const event = { preventDefault: () => undefined };
        for (const listener of this.listeners.get("click") ?? []) listener(event);
    }

    keydown(key: string): boolean {
        let prevented = false;
        const event = { key, preventDefault: () => { prevented = true; } };
        for (const listener of this.listeners.get("keydown") ?? []) listener(event);
        return prevented;
    }

    focus(): void {
        this.ownerDocument.activeElement = this;
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

    cloneForRanges(deep = false): ShareCardTestElement {
        const clone = this.ownerDocument.createElement(this.tagName);
        for (const [name, value] of this.attributes) clone.attributes.set(name, value);
        clone.classList.add(...this.classList.toArray());
        Object.assign(clone.dataset, this.dataset);
        clone.directText = this.directText;
        for (const key of ["clientHeight", "clientWidth", "scrollHeight"] as const) {
            if (!Object.getOwnPropertyDescriptor(clone, key)?.get) clone[key] = this[key];
        }
        if (!deep) return clone;
        for (const node of this.allChildNodes) {
            if (node instanceof ShareCardTestElement) {
                clone.appendChild(node.cloneForRanges(true));
            } else if (node instanceof ShareCardTestTextNode) {
                clone.appendTextNode(new ShareCardTestTextNode(node.data));
            } else if (node instanceof ShareCardTestCommentNode) {
                clone.appendTextNode(new ShareCardTestCommentNode(node.data));
            }
        }
        return clone;
    }

    private setConnected(value: boolean): void {
        this.isConnected = value;
        for (const child of this.children) child.setConnected(value);
    }
}

interface ShareCardTestRangePoint {
    node: ShareCardTestChildNode | ShareCardTestElement;
    offset: number;
}

export class ShareCardTestTreeWalker {
    private readonly textNodes: ShareCardTestTextNode[] = [];
    private cursor = -1;

    constructor(root: ShareCardTestElement, show: number) {
        if (show !== 4) return;
        const visit = (element: ShareCardTestElement): void => {
            for (const node of element.allChildNodes) {
                if (node instanceof ShareCardTestElement) visit(node);
                else if (node instanceof ShareCardTestTextNode) this.textNodes.push(node);
            }
        };
        visit(root);
    }

    nextNode(): ShareCardTestTextNode | null {
        this.cursor += 1;
        return this.textNodes[this.cursor] ?? null;
    }
}

export class ShareCardTestRange {
    private start: ShareCardTestRangePoint | null = null;
    private end: ShareCardTestRangePoint | null = null;

    get commonAncestorContainer(): ShareCardTestChildNode {
        if (!this.start || !this.end) throw new Error("Share Card test range is incomplete.");
        if (this.start.node === this.end.node) return this.start.node;
        const endAncestors = new Set<ShareCardTestChildNode>();
        let end: ShareCardTestChildNode | null = this.end.node;
        while (end) { endAncestors.add(end); end = end.parentElement; }
        let start: ShareCardTestChildNode | null = this.start.node;
        while (start && !endAncestors.has(start)) start = start.parentElement;
        if (!start) throw new Error("Share Card test range has no common ancestor.");
        return start;
    }

    setStart(node: ShareCardTestChildNode, offset: number): void {
        this.start = { node, offset };
    }

    setEnd(node: ShareCardTestChildNode, offset: number): void {
        this.end = { node, offset };
    }

    collapse(toStart: boolean): void {
        if (!this.start || !this.end) throw new Error("Share Card test range is incomplete.");
        this.end = toStart ? this.start : this.end;
        this.start = toStart ? this.start : this.end;
    }

    deleteContents(): void {
        const common = this.commonAncestorContainer;
        if (
            common instanceof ShareCardTestTextNode
            && this.start?.node === common
            && this.end?.node === common
        ) {
            common.data = common.data.slice(0, this.start.offset)
                + common.data.slice(this.end.offset);
            return;
        }
        if (!(common instanceof ShareCardTestElement) || !this.start || !this.end) return;
        const from = this.boundaryIndex(this.start);
        const to = this.boundaryIndex(this.end);
        for (const node of common.allChildNodes.slice(from, to)) node.remove();
    }

    insertNode(node: ShareCardTestChildNode): void {
        const common = this.commonAncestorContainer;
        if (
            common instanceof ShareCardTestTextNode
            && this.start?.node === common
        ) {
            const parent = common.parentElement;
            if (!parent) return;
            const index = parent.allChildNodes.indexOf(common);
            if (index < 0) return;
            const before = new ShareCardTestTextNode(
                common.data.slice(0, this.start.offset),
            );
            const after = new ShareCardTestTextNode(common.data.slice(this.start.offset));
            common.data = before.data;
            parent.allChildNodes.splice(index + 1, 0, node, after);
            node.parentNode = parent;
            node.parentElement = parent;
            after.parentNode = parent;
            after.parentElement = parent;
            return;
        }
        if (!(common instanceof ShareCardTestElement)) return;
        if (node instanceof ShareCardTestElement) common.appendChild(node);
        else common.appendTextNode(node);
    }

    cloneContents(): ShareCardTestElement {
        const common = this.commonAncestorContainer;
        const ownerDocument = common instanceof ShareCardTestElement
            ? common.ownerDocument
            : common.parentElement?.ownerDocument;
        if (!ownerDocument) throw new Error("Share Card test range has no owner document.");
        const fragment = new ShareCardTestElement("#document-fragment", ownerDocument);
        if (
            common instanceof ShareCardTestTextNode
            && this.start?.node === common
            && this.end?.node === common
        ) {
            fragment.appendTextNode(new ShareCardTestTextNode(
                common.data.slice(this.start.offset, this.end.offset),
            ));
            return fragment;
        }
        if (!(common instanceof ShareCardTestElement) || !this.start || !this.end) {
            return fragment;
        }
        const length = (node: ShareCardTestChildNode): number => node instanceof ShareCardTestElement
            ? node.allChildNodes.reduce((sum, child) => sum + length(child), 0)
            : node instanceof ShareCardTestTextNode ? node.data.length : 0;
        const position = (root: ShareCardTestChildNode, point: ShareCardTestRangePoint): number => {
            if (root === point.node) return root instanceof ShareCardTestElement
                ? root.allChildNodes.slice(0, point.offset).reduce((sum, child) => sum + length(child), 0)
                : point.offset;
            if (!(root instanceof ShareCardTestElement)) return -1;
            let offset = 0;
            for (const child of root.allChildNodes) {
                const nested = position(child, point);
                if (nested >= 0) return offset + nested;
                offset += length(child);
            }
            return -1;
        };
        const from = position(common, this.start);
        const to = position(common, this.end);
        let cursor = 0;
        const cloneSelected = (node: ShareCardTestChildNode): ShareCardTestChildNode | null => {
            if (node instanceof ShareCardTestElement) {
                const clone = node.cloneForRanges(false);
                for (const child of node.allChildNodes) {
                    const selected = cloneSelected(child);
                    if (selected instanceof ShareCardTestElement) clone.appendChild(selected);
                    else if (selected) clone.appendTextNode(selected);
                }
                return clone.allChildNodes.length > 0 ? clone : null;
            }
            const start = cursor;
            cursor += length(node);
            if (!(node instanceof ShareCardTestTextNode) || cursor <= from || start >= to) return null;
            return new ShareCardTestTextNode(node.data.slice(Math.max(0, from - start), to - start));
        };
        for (const node of common.allChildNodes) {
            const selected = cloneSelected(node);
            if (selected instanceof ShareCardTestElement) fragment.appendChild(selected);
            else if (selected) fragment.appendTextNode(selected);
        }
        return fragment;
    }

    detach(): void {
        this.start = null;
        this.end = null;
    }

    private boundaryIndex(point: ShareCardTestRangePoint): number {
        const common = this.commonAncestorContainer;
        return point.node === common ? point.offset : point.node.parentElement?.allChildNodes.indexOf(
            point.node as ShareCardTestChildNode,
        ) ?? 0;
    }

}

export class ShareCardTestDocument {
    enableRealDomClones = false;
    readonly documentElement: ShareCardTestElement;
    readonly body: ShareCardTestElement;
    activeElement: ShareCardTestElement | null = null;
    readonly defaultView: {
        innerWidth: number;
        innerHeight: number;
        navigator: { clipboard?: { write(items: unknown[]): Promise<void> } };
        ClipboardItem?: new (items: Record<string, Blob | PromiseLike<Blob>>) => ClipboardItem;
        requestAnimationFrame(callback: FrameRequestCallback): number;
        addEventListener(type: string, listener: () => void): void;
        removeEventListener(type: string, listener: () => void): void;
    };
    private readonly windowListeners = new Map<string, Array<(event?: unknown) => void>>();

    constructor() {
        this.documentElement = new ShareCardTestElement("html", this);
        this.documentElement.isConnected = true;
        this.body = new ShareCardTestElement("body", this);
        this.documentElement.appendChild(this.body);
        this.defaultView = {
            innerWidth: 700,
            innerHeight: 850,
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

    dispatchWindowKeydown(key: string): { prevented: boolean; stopped: boolean } {
        const result = { prevented: false, stopped: false };
        const event = {
            key,
            preventDefault: () => { result.prevented = true; },
            stopImmediatePropagation: () => { result.stopped = true; },
        };
        for (const listener of this.windowListeners.get("keydown") ?? []) listener(event);
        return result;
    }

    dispatchWindowResize(): void {
        for (const listener of this.windowListeners.get("resize") ?? []) listener();
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

import { getTagColor } from "./palette";

const MARKER_CLASS = "pa-tag-appearance";
const COLOR_ATTRIBUTE = "data-pa-tag-color";
const TAGS_VALUE = '.metadata-property-value[data-property-type="tags"]';

export type TagAppearanceRootKind = "reading" | "properties" | "records";

/** Owns only PA's markers inside one supported rendering root. */
export class TagAppearanceDomRoot {
    private readonly marked = new Set<HTMLElement>();
    private readonly observer: MutationObserver;
    private disposed = false;

    constructor(readonly root: HTMLElement, readonly kind: TagAppearanceRootKind) {
        const Observer = root.ownerDocument.defaultView!.MutationObserver;
        this.observer = new Observer((mutations) => {
            for (const mutation of mutations) {
                for (const removed of Array.from(mutation.removedNodes)) this.clearSubtree(removed);
                if (mutation.type === "characterData") {
                    this.scan(mutation.target.parentElement ?? mutation.target);
                } else {
                    for (const added of Array.from(mutation.addedNodes)) this.scan(added);
                    // A property editor may replace just the content of an existing pill.
                    this.scanCandidate(mutation.target);
                }
            }
        });
        this.observer.observe(root, { childList: true, characterData: true, subtree: true });
        this.scan(root);
    }

    scan(node: Node = this.root): void {
        if (this.disposed || !this.root.contains(node)) return;
        this.scanCandidate(node);
        if (node.nodeType !== 1) return;
        const selector = this.kind === "properties" ? ".multi-select-pill" : "a.tag";
        for (const candidate of Array.from((node as Element).querySelectorAll<HTMLElement>(selector))) {
            this.scanCandidate(candidate);
        }
    }

    clearSubtree(node: Node): void {
        for (const element of this.marked) {
            if (element === node || node.contains(element)) {
                this.clearMarker(element);
                this.marked.delete(element);
            }
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.observer.disconnect();
        for (const element of this.marked) this.clearMarker(element);
        this.marked.clear();
    }

    private scanCandidate(node: Node): void {
        if (this.disposed || node.nodeType !== 1) return;
        const element = node as HTMLElement;
        let name: string | undefined;
        if (this.kind === "properties") {
            const pill = element.closest<HTMLElement>(".multi-select-pill");
            if (!pill || !this.root.contains(pill)) return;
            const value = pill.closest(TAGS_VALUE);
            if (!value || !this.root.contains(value)) return;
            name = pill.querySelector(".multi-select-pill-content")?.textContent ?? undefined;
            if (name) this.mark(pill, name);
            return;
        }
        const tag = element.closest<HTMLElement>("a.tag");
        if (!tag || !this.root.contains(tag)) return;
        if (this.kind === "records") {
            const record = tag.closest(".record-wrapper, .record-wrapper-mobile");
            const preview = tag.closest(".pa-recordlist-preview-view");
            if (!record || !preview || !this.root.contains(record) || !this.root.contains(preview)) return;
        }
        name = tag.textContent ?? undefined;
        if (name) this.mark(tag, name);
    }

    private mark(element: HTMLElement, name: string): void {
        element.classList.add(MARKER_CLASS);
        element.setAttribute(COLOR_ATTRIBUTE, getTagColor(name));
        this.marked.add(element);
    }

    private clearMarker(element: HTMLElement): void {
        element.classList.remove(MARKER_CLASS);
        element.removeAttribute(COLOR_ATTRIBUTE);
    }
}

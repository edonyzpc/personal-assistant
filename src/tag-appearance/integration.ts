import {
    MarkdownPreviewRenderer,
    MarkdownRenderChild,
    type App,
    type EventRef,
    type MarkdownPostProcessor,
    type Plugin,
} from "obsidian";
import type { Extension } from "@codemirror/state";
import { TagAppearanceDomRoot, type TagAppearanceRootKind } from "./dom";
import { tagAppearanceEditorExtension } from "./editor";

type SupportedView = {
    getViewType(): string;
    contentEl?: HTMLElement;
    file?: { path: string } | null;
    previewMode?: { containerEl: HTMLElement };
};

/** One owner for the opt-in feature, with no active work while disabled. */
export class TagAppearanceIntegration {
    private readonly extensions: Extension[] = [];
    private readonly roots = new Map<HTMLElement, TagAppearanceDomRoot>();
    private readonly discoveryObservers = new Map<HTMLElement, MutationObserver>();
    private eventRefs: EventRef[] = [];
    private processor: MarkdownPostProcessor | undefined;
    private enabled = false;
    private disposed = false;
    private editorRegistered = false;
    private session = 0;
    private refreshQueued = false;

    constructor(
        private readonly app: App,
        private readonly plugin: Pick<Plugin, "registerEditorExtension">
    ) {}

    setEnabled(enabled: boolean): void {
        if (this.disposed || this.enabled === enabled) return;
        this.enabled = enabled;
        this.session++;
        if (enabled) {
            if (!this.editorRegistered) {
                // Register only on first use; later toggles reconfigure the same array.
                this.plugin.registerEditorExtension(this.extensions);
                this.editorRegistered = true;
            }
            this.processor = (element, context) => {
                const root = this.findReadingRoot(element);
                if (!root) return;
                root.scan(element);
                const child = new MarkdownRenderChild(element);
                child.register(() => root.clearSubtree(element));
                context.addChild(child);
            };
            MarkdownPreviewRenderer.registerPostProcessor(this.processor);
            const refresh = () => this.queueRefresh();
            this.eventRefs = [
                this.app.workspace.on("layout-change", refresh),
                this.app.workspace.on("active-leaf-change", refresh),
                this.app.workspace.on("file-open", refresh),
                this.app.workspace.on("window-open", refresh),
                this.app.workspace.on("window-close", refresh),
            ];
            this.refreshRoots();
            this.extensions.push(tagAppearanceEditorExtension);
        } else {
            this.clearEnabledResources();
        }
        this.app.workspace.updateOptions();
    }

    dispose(): void {
        if (this.disposed) return;
        const wasEnabled = this.enabled;
        this.enabled = false;
        this.disposed = true;
        this.session++;
        this.clearEnabledResources();
        if (wasEnabled) this.app.workspace.updateOptions();
    }

    private clearEnabledResources(): void {
        if (this.processor) MarkdownPreviewRenderer.unregisterPostProcessor(this.processor);
        this.processor = undefined;
        for (const ref of this.eventRefs) this.app.workspace.offref(ref);
        this.eventRefs = [];
        for (const root of this.roots.values()) root.dispose();
        this.roots.clear();
        for (const observer of this.discoveryObservers.values()) observer.disconnect();
        this.discoveryObservers.clear();
        this.extensions.length = 0;
        this.refreshQueued = false;
    }

    private queueRefresh(): void {
        if (!this.enabled || this.refreshQueued) return;
        const session = this.session;
        this.refreshQueued = true;
        queueMicrotask(() => {
            if (!this.enabled || this.session !== session) return;
            this.refreshQueued = false;
            this.refreshRoots();
        });
    }

    private findReadingRoot(element: HTMLElement): TagAppearanceDomRoot | undefined {
        if (!this.enabled) return undefined;
        for (const root of this.roots.values()) {
            if (root.kind !== "properties" && root.root.contains(element)) return root;
        }
        return undefined;
    }

    private refreshRoots(): void {
        const desired = new Map<HTMLElement, TagAppearanceRootKind>();
        const discoveryHosts = new Set<HTMLElement>();
        this.app.workspace.iterateAllLeaves((leaf) => {
            const view = leaf.view as SupportedView;
            const content = view.contentEl;
            // Closing a popout can leave its leaf in the workspace inventory
            // briefly after the owning document has lost its Window.
            if (!content || !content.ownerDocument.defaultView) return;
            const type = view.getViewType();
            if (type === "record-preview") {
                desired.set(content, "records");
                return;
            }
            if (type === "file-properties") {
                if (view.file) desired.set(content, "properties");
                return;
            }
            if (type !== "markdown" || !view.file) return;
            if (view.previewMode?.containerEl.ownerDocument.defaultView) {
                const preview = view.previewMode.containerEl;
                desired.set(preview, "reading");
                const previewSizer = preview.querySelector<HTMLElement>(".markdown-preview-sizer");
                if (previewSizer) discoveryHosts.add(previewSizer);
                const header = preview.querySelector<HTMLElement>(".mod-header");
                if (header) discoveryHosts.add(header);
            }
            // Metadata is a bounded native widget. Watching its parent only for
            // direct child changes catches widget replacement without observing
            // the editor's text subtree.
            for (const metadata of Array.from(content.querySelectorAll<HTMLElement>(".metadata-container"))) {
                desired.set(metadata, "properties");
                if (metadata.parentElement) discoveryHosts.add(metadata.parentElement);
            }
            discoveryHosts.add(content);
            const source = content.querySelector<HTMLElement>(".markdown-source-view");
            if (source) discoveryHosts.add(source);
            const editorSizer = content.querySelector<HTMLElement>(".cm-sizer");
            if (editorSizer) discoveryHosts.add(editorSizer);
        });
        for (const [element, root] of this.roots) {
            if (desired.get(element) !== root.kind) {
                root.dispose();
                this.roots.delete(element);
            }
        }
        for (const [element, kind] of desired) {
            if (!this.roots.has(element)) this.roots.set(element, new TagAppearanceDomRoot(element, kind));
        }
        for (const [element, observer] of this.discoveryObservers) {
            if (!discoveryHosts.has(element)) {
                observer.disconnect();
                this.discoveryObservers.delete(element);
            }
        }
        for (const host of discoveryHosts) {
            if (this.discoveryObservers.has(host)) continue;
            const Observer = host.ownerDocument.defaultView!.MutationObserver;
            const observer = new Observer(() => this.queueRefresh());
            observer.observe(host, { childList: true });
            this.discoveryObservers.set(host, observer);
        }
    }
}

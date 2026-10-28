import type { PluginManagerSettings } from "./settings";

export enum ViewType {
    LocalGraphView,
}

export interface ViewResizeHost {
    readonly settings: Pick<PluginManagerSettings, "localGraph">;
    log(message: string, ...args: unknown[]): void;
}

const LOCAL_GRAPH_MAX_WIDTH = 550;
const LOCAL_GRAPH_MAX_HEIGHT = 500;
const LOCAL_GRAPH_DESKTOP_MARGIN = 16;

/** Fit one newly created hover graph to the window that owns it. */
export class ViewResize<THost extends ViewResizeHost = ViewResizeHost> {
    resized = false;
    log: (message: string, ...args: unknown[]) => void;
    plugin: THost;
    private viewType: ViewType;

    constructor(plugin: THost, type: ViewType) {
        this.resized = false;
        this.log = (message, ...args) => plugin.log(message, ...args);
        this.plugin = plugin;
        this.viewType = type;
    }

    async resize(candidate: HTMLElement): Promise<void> {
        if (this.viewType !== ViewType.LocalGraphView) return;
        if (candidate.querySelector('[data-type="localgraph"]') === null) return;

        const doc = candidate.ownerDocument;
        const win = doc?.defaultView;
        const viewportWidth = win?.innerWidth ?? 0;
        const viewportHeight = win?.innerHeight ?? 0;
        if (!win || viewportWidth <= 0 || viewportHeight <= 0) return;

        // At very small window sizes, a 16px margin would consume too much of
        // the viewport. Five percent keeps a positive available area without
        // inventing a separate minimum-window layout mode.
        const marginX = Math.min(LOCAL_GRAPH_DESKTOP_MARGIN, viewportWidth * 0.05);
        const marginY = Math.min(LOCAL_GRAPH_DESKTOP_MARGIN, viewportHeight * 0.05);
        const width = Math.min(LOCAL_GRAPH_MAX_WIDTH, viewportWidth - marginX * 2);
        const height = Math.min(LOCAL_GRAPH_MAX_HEIGHT, viewportHeight - marginY * 2);
        if (width <= 0 || height <= 0) return;
        const left = (viewportWidth - width) / 2;
        const top = (viewportHeight - height) / 2;

        this.log("fitting new hover local graph", { width, height });
        candidate.setCssStyles({
            width: `${width}px`,
            height: `${height}px`,
            left: `${left}px`,
            top: `${top}px`,
            cursor: "move",
        });
        candidate.setCssProps({ "--resize-popover-width": `${width}px` });
        candidate.addClass("resize-popover-width");
        this.resized = true;
    }
}

function safeUrl(value: string): string {
    try {
        const url = new URL(value);
        if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error();
        return url.href;
    } catch { throw new Error("Invalid Ghost URL"); }
}

export function ghostPreviewUrl(site: string, uuid: string): string {
    if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(uuid)) throw new Error("Invalid preview identity");
    const base = new URL(safeUrl(site));
    if (base.search || base.hash) throw new Error("Invalid preview site");
    base.pathname = `${base.pathname.replace(/\/+$/, "")}/`;
    return new URL(`p/${uuid}/`, base).href;
}

export interface GhostNativeLeaf {
    setViewState(state: { type: "webviewer"; state: { url: string }; active: true }): Promise<void>;
}

export interface GhostPreviewHost {
    workspace: {
        getLeaf(mode: "tab"): GhostNativeLeaf;
        getLeavesOfType(type: "webviewer"): GhostNativeLeaf[];
        revealLeaf(leaf: GhostNativeLeaf): Promise<void>;
    };
}

export interface GhostPreviewOptions {
    isDesktop(): boolean;
    isWebViewerEnabled(): boolean;
}

/** Opens ordinary URLs in a visible native tab; it never certifies publication. */
export class GhostTabPreview {
    private leaf?: GhostNativeLeaf;
    private disposed = false;

    constructor(private readonly host: GhostPreviewHost, private readonly options: GhostPreviewOptions) {}

    async open(value: string): Promise<void> {
        const url = safeUrl(value);
        if (this.disposed) throw Object.assign(new Error("Ghost tab is no longer available."), { code: "cancelled" });
        if (!this.options.isDesktop()) throw Object.assign(new Error("Ghost tabs require desktop."), { code: "desktop-required" });
        if (!this.options.isWebViewerEnabled()) throw Object.assign(new Error("Enable the Web viewer to open this tab."), { code: "enable-web-viewer" });
        const leaf = this.leaf && this.host.workspace.getLeavesOfType("webviewer").includes(this.leaf)
            ? this.leaf : this.host.workspace.getLeaf("tab");
        await leaf.setViewState({ type: "webviewer", state: { url }, active: true });
        this.leaf = leaf;
        await this.host.workspace.revealLeaf(leaf);
    }

    dispose(): void {
        this.disposed = true;
        // The user's tab remains open after the card/session closes.
        this.leaf = undefined;
    }
}

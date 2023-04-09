import { PluginManager } from "./plugin"

export enum ViewType {
    MemosView = 0,
    LocalGraphView,
}

export class ViewResize {
    resized: boolean;
    log: any;
    plugin: PluginManager;
    private viewType: ViewType;
    private viewDataType = {
        memos: "memos_view",
        localGraph: "localgraph",
    }

    constructor(plugin: PluginManager, type: ViewType) {
        this.resized = false;
        this.log = (...msg: any) => plugin.log(...msg);
        this.plugin = plugin;
        this.viewType = type;
    }

    async resize(): Promise<void> {
        if (this.resized) return;
        const {localGraph, memos} = this.plugin.settings;
        let width:number, height:number, left:number, top:number, dataType:string;
        switch(this.viewType) {
            case ViewType.MemosView:
                width = memos.resizeStyle.width;
                height = memos.resizeStyle.height;
                top = memos.resizeStyle.top + (10 + Math.random() * 100);
                left = memos.resizeStyle.left + (10 + Math.random() * 100);
                dataType = this.viewDataType.memos;
                break;
            case ViewType.LocalGraphView:
                width = localGraph.resizeStyle.width;
                height = localGraph.resizeStyle.height;
                top = localGraph.resizeStyle.top + (10 + Math.random() * 100);
                left = localGraph.resizeStyle.left + (10 + Math.random() * 100);
                dataType = this.viewDataType.localGraph;
                break;
        }
        // resize the popover
        const hovers = document.querySelectorAll("body .popover.hover-editor");
        hovers.forEach((hover) => {
            this.log("iterating hovers...");
            if (hover.querySelector(`[data-type="${dataType}"]`)) {
                this.log("setting hover editor attribute...");
                // add some offset to show multiple views
                hover.setAttribute("style", `height: ${height}px; width: ${width}px; top: ${top}px; left: ${left}px; cursor: move;`);
                this.resized = true;
            }
        });
    }
}
/* Copyright 2023 edonyzpc */

import { PluginManager } from "./plugin"

export enum ViewType {
    LocalGraphView,
}

export class ViewResize {
    resized: boolean;
    log: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    plugin: PluginManager;
    private viewType: ViewType;
    private viewDataType = {
        localGraph: "localgraph",
    }

    constructor(plugin: PluginManager, type: ViewType) {
        this.resized = false;
        this.log = (...msg: any) => plugin.log(...msg); // eslint-disable-line @typescript-eslint/no-explicit-any
        this.plugin = plugin;
        this.viewType = type;
    }

    async resize(): Promise<void> {
        if (this.resized) return;
        const { localGraph } = this.plugin.settings;
        let width: number, height: number, left: number, top: number, dataType: string;
        const maxWidth = window.innerWidth;
        const maxHeight = window.innerHeight;

        switch (this.viewType) {
            case ViewType.LocalGraphView:
                width = localGraph.resizeStyle.width;
                height = localGraph.resizeStyle.height;
                top = maxHeight / 2 - height / 2;
                left = maxWidth / 2 - width / 2;
                top = top + (10 + Math.random() * 100);
                left = left + (10 + Math.random() * 100);
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
                // override `--popover-width` which is apply in style of `.popover-content`
                // and keep it is the same with hover width attribute
                document.body.style.setProperty('--resize-popover-width', `${width} !important`);
                hover.addClass("resize-popover-width");
                this.resized = true;
            }
        });
    }
}
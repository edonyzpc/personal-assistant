/* Copyright 2023 edonyzpc */

import { ItemView, WorkspaceLeaf, addIcon, type ViewStateResult } from "obsidian";

import { getPageletUiLanguage, pageletT, type PageletLocale } from "../../locales/pagelet";
import { buildMascotMarkup } from "../../ui/pagelet/mascot";
import { TabView } from "./TabView";
import type { PageletDetailContent, PageletDetailPayload } from "./types";

export const PAGELET_DETAIL_VIEW_TYPE = "pa-pagelet-detail-view";
export const PAGELET_DETAIL_ICON = "pa-pagelet";
const PAGELET_DETAIL_STATE_VERSION = 1;

function buildPageletDetailIconSvg(): string {
    const markup = buildMascotMarkup("idle", {
        translator: (_key, fallback = "") => fallback,
        reducedMotion: true,
    });
    const paths = markup.svgShapes.paths
        .map((path) => [
            `<path d="${path.d}"`,
            `fill="none"`,
            `stroke="currentColor"`,
            `stroke-width="${path.strokeWidth}"`,
            `stroke-linejoin="round"`,
            `stroke-linecap="round"/>`,
        ].join(" "))
        .join("");

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${markup.svgViewBox}"`,
        `fill="none" stroke="currentColor">`,
        paths,
        `</svg>`,
    ].join("");
}

export function registerPageletDetailIcon(): void {
    addIcon(PAGELET_DETAIL_ICON, buildPageletDetailIconSvg());
}

export class PageletDetailView extends ItemView {
    private readonly getLocale: () => PageletLocale;
    private renderer: TabView | null = null;
    private title: string;
    private content: PageletDetailContent = [];
    private locale: PageletLocale;

    constructor(
        leaf: WorkspaceLeaf,
        getLocale: () => PageletLocale = getPageletUiLanguage,
    ) {
        super(leaf);
        this.getLocale = getLocale;
        this.locale = getLocale();
        this.title = pageletT("pagelet.tab.title", this.locale);
        registerPageletDetailIcon();
    }

    getViewType(): string {
        return PAGELET_DETAIL_VIEW_TYPE;
    }

    getDisplayText(): string {
        return pageletT("pagelet.tab.title", this.locale);
    }

    getIcon(): string {
        return PAGELET_DETAIL_ICON;
    }

    async onOpen(): Promise<void> {
        this.locale = this.getLocale();
        this.title = pageletT("pagelet.tab.title", this.locale);
        this.renderer = new TabView(this.locale);
        this.renderer.mount(this.contentEl);
        this.renderer.open(this.title, this.content);
    }

    async onClose(): Promise<void> {
        this.renderer?.destroy();
        this.renderer = null;
    }

    setPayload(payload: PageletDetailPayload): void {
        this.title = payload.title;
        this.content = payload.content;
        this.locale = payload.locale;
        this.renderer?.setLocale(payload.locale);
        this.renderer?.open(payload.title, payload.content);
    }

    getState(): Record<string, unknown> {
        return {
            version: PAGELET_DETAIL_STATE_VERSION,
        };
    }

    async setState(_state: unknown, _result: ViewStateResult): Promise<void> {
        this.locale = this.getLocale();
        this.title = pageletT("pagelet.tab.title", this.locale);
        this.content = [];
        this.renderer?.setLocale(this.locale);
        this.renderer?.open(this.title, this.content);
    }
}

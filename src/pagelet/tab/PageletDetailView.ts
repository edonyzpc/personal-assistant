/* Copyright 2023 edonyzpc */

import {
    ItemView,
    Notice,
    addIcon,
    type ViewStateResult,
    type WorkspaceLeaf,
} from "obsidian";

import { getPageletUiLanguage, pageletT, type PageletLocale } from "../../locales/pagelet";
import { getPlatformCrypto } from "../../platform-dom";
import { buildMascotMarkup } from "../ui/mascot";
import type { GeneratedReviewNote, WriteResult } from "../output/types";
import { resolveRelatedMarkdownNote } from "../related-note";
import { TabView } from "./TabView";
import type {
    PageletDetailContent,
    PageletDetailLayoutType,
    PageletDetailPayload,
} from "./types";

export const PAGELET_DETAIL_VIEW_TYPE = "pa-pagelet-detail-view";
export const PAGELET_DETAIL_ICON = "pa-pagelet";
const PAGELET_DETAIL_STATE_VERSION = 4;
const PAGELET_DETAIL_SESSION_CACHE_LIMIT = 12;

const pageletDetailSessionCache = new Map<string, PageletDetailPayload>();
let pageletDetailSessionCounter = 0;

function createPageletDetailSessionId(): string {
    const cryptoProvider = getPlatformCrypto();
    if (typeof cryptoProvider?.randomUUID === "function") {
        return cryptoProvider.randomUUID();
    }
    pageletDetailSessionCounter += 1;
    return `pagelet-detail-${Date.now().toString(36)}-${pageletDetailSessionCounter.toString(36)}`;
}

function clonePageletDetailPayload(payload: PageletDetailPayload): PageletDetailPayload {
    const copy: PageletDetailPayload = {
        title: payload.title,
        content: [...payload.content] as PageletDetailContent,
        locale: payload.locale,
    };
    if (payload.layoutType) copy.layoutType = payload.layoutType;
    if (payload.extra) {
        copy.extra = {};
        if (payload.extra.connections) copy.extra.connections = [...payload.extra.connections];
        if (typeof payload.extra.markdown === "string") copy.extra.markdown = payload.extra.markdown;
    }
    if (payload.sourcePath) copy.sourcePath = payload.sourcePath;
    if (payload.summarySaveNote) copy.summarySaveNote = payload.summarySaveNote;
    return copy;
}

function rememberPageletDetailPayload(sessionId: string, payload: PageletDetailPayload): void {
    pageletDetailSessionCache.delete(sessionId);
    pageletDetailSessionCache.set(sessionId, clonePageletDetailPayload(payload));
    while (pageletDetailSessionCache.size > PAGELET_DETAIL_SESSION_CACHE_LIMIT) {
        const oldest = pageletDetailSessionCache.keys().next().value;
        if (!oldest) break;
        pageletDetailSessionCache.delete(oldest);
    }
}

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
    private readonly onSaveSummaryNote?: (note: GeneratedReviewNote) => Promise<WriteResult>;
    private renderer: TabView | null = null;
    private title: string;
    private content: PageletDetailContent = [];
    private locale: PageletLocale;
    private sessionId: string;
    private payloadOptions: Pick<PageletDetailPayload, "layoutType" | "extra" | "sourcePath" | "summarySaveNote" | "restoredFromState"> = {};

    constructor(
        leaf: WorkspaceLeaf,
        getLocale: () => PageletLocale = getPageletUiLanguage,
        onSaveSummaryNote?: (note: GeneratedReviewNote) => Promise<WriteResult>,
    ) {
        super(leaf);
        this.getLocale = getLocale;
        this.onSaveSummaryNote = onSaveSummaryNote;
        this.locale = getLocale();
        this.title = pageletT("pagelet.tab.title", this.locale);
        this.sessionId = createPageletDetailSessionId();
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
        if (!this.hasPayload()) {
            this.locale = this.getLocale();
            this.title = pageletT("pagelet.tab.title", this.locale);
        }
        this.renderer = new TabView(this.locale, {
            app: this.app,
            onConnectionNodeClick: (noteName, sourcePath) => this.openRelatedNote(noteName, sourcePath),
            onSaveSummaryNote: this.onSaveSummaryNote
                ? (note) => this.saveSummaryNote(note)
                : undefined,
        });
        this.renderer.mount(this.contentEl);
        this.renderer.open(this.title, this.content, this.payloadOptions);
    }

    async onClose(): Promise<void> {
        this.renderer?.destroy();
        this.renderer = null;
    }

    setPayload(payload: PageletDetailPayload): void {
        this.applyPayload(payload);
        this.renderPayload();
    }

    getState(): Record<string, unknown> {
        const payload: Record<string, unknown> = {
            title: this.title,
            locale: this.locale,
            sessionId: this.sessionId,
            restoredFromState: true,
        };
        if (this.payloadOptions.layoutType) {
            payload.layoutType = this.payloadOptions.layoutType;
        }
        if (this.payloadOptions.sourcePath) {
            payload.sourcePath = this.payloadOptions.sourcePath;
        }
        return {
            version: PAGELET_DETAIL_STATE_VERSION,
            payload,
        };
    }

    async setState(state: unknown, _result: ViewStateResult): Promise<void> {
        const restored = readPageletDetailState(state, this.getLocale());
        if (restored) {
            this.sessionId = restored.sessionId;
            this.applyPayload(restored.payload);
        } else {
            this.resetPayload();
        }
        this.renderPayload();
    }

    private applyPayload(payload: PageletDetailPayload): void {
        this.title = payload.title;
        this.content = payload.content;
        this.locale = payload.locale;
        this.payloadOptions = {
            layoutType: payload.layoutType,
            extra: payload.extra,
            sourcePath: payload.sourcePath,
            summarySaveNote: payload.summarySaveNote,
            restoredFromState: payload.restoredFromState,
        };
        if (!payload.restoredFromState) {
            this.cacheCurrentPayload();
        }
    }

    private resetPayload(): void {
        this.locale = this.getLocale();
        this.title = pageletT("pagelet.tab.title", this.locale);
        this.content = [];
        this.payloadOptions = {};
        this.sessionId = createPageletDetailSessionId();
    }

    private renderPayload(): void {
        this.renderer?.setLocale(this.locale);
        this.renderer?.open(this.title, this.content, this.payloadOptions);
    }

    private hasPayload(): boolean {
        return this.content.length > 0
            || Boolean(this.payloadOptions.layoutType)
            || Boolean(this.payloadOptions.extra)
            || Boolean(this.payloadOptions.sourcePath)
            || Boolean(this.payloadOptions.summarySaveNote)
            || Boolean(this.payloadOptions.restoredFromState);
    }

    private cacheCurrentPayload(): void {
        if (!this.hasPayload()) return;
        rememberPageletDetailPayload(this.sessionId, {
            title: this.title,
            content: this.content,
            locale: this.locale,
            layoutType: this.payloadOptions.layoutType,
            extra: this.payloadOptions.extra,
            sourcePath: this.payloadOptions.sourcePath,
            summarySaveNote: this.payloadOptions.summarySaveNote,
        });
    }

    private async saveSummaryNote(note: GeneratedReviewNote): Promise<WriteResult> {
        if (!this.onSaveSummaryNote) {
            return { success: false, error: pageletT("pagelet.panel.status.error", this.locale) };
        }

        try {
            const result = await this.onSaveSummaryNote(note);
            if (result.success) {
                this.payloadOptions.summarySaveNote = undefined;
                this.cacheCurrentPayload();
                new Notice(pageletT("pagelet.reviewNote.created", this.locale, { path: result.filePath ?? "" }), 5000);
            } else {
                new Notice(pageletT("pagelet.reviewNote.createFailed", this.locale, { error: result.error ?? "" }), 5000);
            }
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(pageletT("pagelet.reviewNote.createFailed", this.locale, { error: message }), 5000);
            return { success: false, error: message };
        }
    }

    private openRelatedNote(noteName: string, sourcePath?: string): void {
        const file = resolveRelatedMarkdownNote(
            this.app,
            noteName,
            sourcePath ?? this.payloadOptions.sourcePath,
        );
        if (!file) {
            new Notice(pageletT("pagelet.panel.status.relatedMissing", this.locale), 3000);
            return;
        }
        const leaf = this.app.workspace.getMostRecentLeaf();
        if (!leaf) return;
        void leaf.openFile(file).then(() => {
            new Notice(pageletT("pagelet.panel.status.relatedOpened", this.locale), 2500);
        });
    }
}

function readPageletDetailState(
    state: unknown,
    fallbackLocale: PageletLocale,
): { sessionId: string; payload: PageletDetailPayload } | null {
    if (!isRecord(state)) return null;
    const payload = state.payload;
    if (!isRecord(payload)) return null;
    const sessionId = typeof payload.sessionId === "string" && payload.sessionId.trim().length > 0
        ? payload.sessionId
        : createPageletDetailSessionId();

    const cachedPayload = pageletDetailSessionCache.get(sessionId);
    if (cachedPayload) {
        return {
            sessionId,
            payload: clonePageletDetailPayload(cachedPayload),
        };
    }

    const locale = normalizePageletLocale(payload.locale) ?? fallbackLocale;
    const title = typeof payload.title === "string" && payload.title.trim().length > 0
        ? payload.title
        : pageletT("pagelet.tab.title", locale);

    const result: PageletDetailPayload = {
        title,
        content: [],
        locale,
        restoredFromState: true,
    };
    const layoutType = normalizePageletDetailLayoutType(payload.layoutType);
    if (layoutType) result.layoutType = layoutType;
    if (typeof payload.sourcePath === "string") result.sourcePath = payload.sourcePath;
    return { sessionId, payload: result };
}

function normalizePageletLocale(value: unknown): PageletLocale | null {
    return value === "en" || value === "zh" ? value : null;
}

function normalizePageletDetailLayoutType(value: unknown): PageletDetailLayoutType | undefined {
    return value === "review" || value === "current" || value === "discover" || value === "summary"
        ? value
        : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

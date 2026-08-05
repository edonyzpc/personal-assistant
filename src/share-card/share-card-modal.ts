/* Copyright 2023 edonyzpc */

import { Modal, Notice, setIcon, type App } from "obsidian";
import { getPluginUiLanguage, pluginT } from "../locales/plugin";
import { prepareShareCardMarkdown } from "./share-card-markdown";
import {
    ShareCardResourceAbortedError,
    createShareCardResourceCache,
    localizeShareCardResources,
    type ShareCardCompletenessReport,
    type ShareCardResourceCache,
} from "./share-card-resources";
import {
    paginateShareCardMarkdown,
    ShareCardTooLargeError,
} from "./share-card-paginator";
import {
    CARD_HEIGHT,
    CARD_WIDTH,
    MAX_SHARE_CARD_CHARACTERS,
    type CardPage,
    type ShareCardData,
    type ShareCardTheme,
} from "./share-card-types";
import {
    SHARE_CARD_FOLDER,
    ShareCardClipboardUnavailableError,
    ShareCardExporter,
} from "./share-card-export";
import {
    ShareCardRenderCancelledError,
    ShareCardRenderer,
    type ShareCardPreparedCompletenessSummary,
    type ShareCardRenderHandle,
} from "./share-card-renderer";

let shareCardModalId = 0;
const openShareCardModals = new Set<ShareCardModal>();

function t(key: string, params?: Readonly<Record<string, string | number>>): string {
    return pluginT(key, getPluginUiLanguage(), params);
}

export interface ShareCardModalDependencies {
    localizeResources?: typeof localizeShareCardResources;
    createResourceCache?: typeof createShareCardResourceCache;
    prepareMarkdown?: typeof prepareShareCardMarkdown;
    paginate?: typeof paginateShareCardMarkdown;
    createRenderer?: (app: App, ownerDocument: Document) => ShareCardRenderer;
    createExporter?: (
        app: App,
        ownerDocument: Document,
        renderer: ShareCardRenderer,
        appearance: {
            theme: ShareCardTheme;
            sourceLabel?: string;
            sourcePath?: string;
        },
    ) => ShareCardExporter;
}

export class ShareCardModal extends Modal {
    private pages: CardPage[] = [];
    private currentPageIndex = 0;
    private theme: ShareCardTheme = "light";
    private renderer: ShareCardRenderer | null = null;
    private exporter: ShareCardExporter | null = null;
    private previewRender: ShareCardRenderHandle | null = null;
    private statusEl: HTMLElement | null = null;
    private viewportEl: HTMLElement | null = null;
    private previewScaleEl: HTMLElement | null = null;
    private navEl: HTMLElement | null = null;
    private previousButton: HTMLButtonElement | null = null;
    private nextButton: HTMLButtonElement | null = null;
    private pageIndicatorEl: HTMLElement | null = null;
    private copyButton: HTMLButtonElement | null = null;
    private saveButton: HTMLButtonElement | null = null;
    private ownerWindow: Window | null = null;
    private resourceController: AbortController | null = null;
    private resourceCache: ShareCardResourceCache | null = null;
    private completenessReport: ShareCardCompletenessReport | null = null;
    private preparedCompleteness: ShareCardPreparedCompletenessSummary = {
        sanitizationIssueCount: 0,
        usedPlainTextFallback: false,
    };
    private readonly pageCompleteness = new Map<number, ShareCardPreparedCompletenessSummary>();
    private openState = false;
    private busy = false;
    private operationToken = 0;
    private readonly handleResize = (): void => this.updatePreviewScale();

    constructor(
        app: App,
        private readonly data: ShareCardData,
        private readonly dependencies: ShareCardModalDependencies = {},
    ) {
        super(app);
    }

    onOpen(): void {
        openShareCardModals.add(this);
        this.openState = true;
        this.busy = false;
        this.pages = [];
        this.currentPageIndex = 0;
        this.completenessReport = null;
        this.preparedCompleteness = {
            sanitizationIssueCount: 0,
            usedPlainTextFallback: false,
        };
        this.pageCompleteness.clear();
        this.resourceController = new AbortController();
        this.resourceCache = (
            this.dependencies.createResourceCache ?? createShareCardResourceCache
        )();

        const ownerDocument = this.contentEl.ownerDocument;
        this.ownerWindow = ownerDocument.defaultView;
        this.theme = detectShareCardTheme(ownerDocument);
        this.renderer = this.dependencies.createRenderer?.(this.app, ownerDocument)
            ?? new ShareCardRenderer(this.app, ownerDocument);

        this.modalEl.classList.add("pa-share-card-modal-shell");
        clearElement(this.contentEl);
        this.contentEl.classList.add("pa-share-card-modal");
        this.contentEl.setAttribute("aria-busy", "true");

        const titleId = `pa-share-card-title-${++shareCardModalId}`;
        const titleEl = ownerDocument.createElement("h2");
        titleEl.id = titleId;
        titleEl.textContent = t("plugin.shareCard.title");
        this.contentEl.appendChild(titleEl);
        this.modalEl.setAttribute("aria-labelledby", titleId);

        this.statusEl = ownerDocument.createElement("div");
        this.statusEl.classList.add("pa-share-card-status");
        this.statusEl.setAttribute("role", "status");
        this.statusEl.setAttribute("aria-live", "polite");
        this.statusEl.textContent = t("plugin.shareCard.preparing");
        this.contentEl.appendChild(this.statusEl);

        this.viewportEl = ownerDocument.createElement("div");
        this.viewportEl.classList.add("pa-share-card-preview-viewport");
        this.viewportEl.hidden = true;
        this.previewScaleEl = ownerDocument.createElement("div");
        this.previewScaleEl.classList.add("pa-share-card-preview-scale");
        this.viewportEl.appendChild(this.previewScaleEl);
        this.contentEl.appendChild(this.viewportEl);

        this.createNavigation(ownerDocument);
        this.createActions(ownerDocument);
        this.ownerWindow?.addEventListener("resize", this.handleResize);

        const token = this.nextToken();
        void this.prepare(token).catch((error) => {
            if (error instanceof ShareCardResourceAbortedError || !this.isCurrent(token)) return;
            console.error("Share Card preparation failed.", error);
            this.contentEl.setAttribute("aria-busy", "false");
            this.setStatus(t(error instanceof ShareCardTooLargeError
                ? "plugin.shareCard.tooLarge"
                : "plugin.shareCard.prepareFailed"), "error");
            this.updateControls();
        });
    }

    onClose(): void {
        openShareCardModals.delete(this);
        this.openState = false;
        this.busy = false;
        this.nextToken();
        this.resourceController?.abort();
        this.resourceController = null;
        this.resourceCache = null;
        this.completenessReport = null;
        this.preparedCompleteness = {
            sanitizationIssueCount: 0,
            usedPlainTextFallback: false,
        };
        this.pageCompleteness.clear();
        this.ownerWindow?.removeEventListener("resize", this.handleResize);
        this.ownerWindow = null;
        this.previewRender?.cleanup();
        this.previewRender = null;
        this.renderer?.cleanup();
        this.renderer = null;
        this.exporter = null;
        this.pages = [];
        this.resetElementReferences();
        clearElement(this.contentEl);
    }

    private async prepare(token: number): Promise<void> {
        const renderer = this.renderer;
        if (!renderer) return;
        if (this.data.content.length > MAX_SHARE_CARD_CHARACTERS) {
            throw new ShareCardTooLargeError(
                "character-limit",
                MAX_SHARE_CARD_CHARACTERS,
                this.data.content.length,
            );
        }
        const controller = this.resourceController;
        const cache = this.resourceCache;
        if (!controller || !cache) throw new ShareCardResourceAbortedError();
        const localized = await (
            this.dependencies.localizeResources ?? localizeShareCardResources
        )(this.app, this.data.content, {
            resourceBasePath: this.data.resourceContext?.basePath,
            signal: controller.signal,
            cache,
        }, {
            placeholderText: ({ label }) => t("plugin.shareCard.resourcePlaceholder", { label }),
        });
        if (!this.isCurrent(token)) return;
        this.completenessReport = localized.report;
        const prepared = (this.dependencies.prepareMarkdown ?? prepareShareCardMarkdown)(
            localized.markdown,
        );
        const renderOptions = {
            theme: this.theme,
            sourceLabel: this.data.sourceLabel,
            sourcePath: this.data.resourceContext?.basePath,
        };
        const fit = typeof renderer.createPreparedFitPredicate === "function"
            ? renderer.createPreparedFitPredicate(prepared.blocks, renderOptions)
            : (content: string, pageIndex: number) => (
                renderer.fits(content, pageIndex, renderOptions)
            );
        const pages = await (this.dependencies.paginate ?? paginateShareCardMarkdown)(
            prepared.blocks,
            fit,
            { originalCharacterCount: this.data.content.length },
        );
        if (!this.isCurrent(token)) return;

        if (typeof renderer.recordPreparedFinalPages === "function") {
            renderer.recordPreparedFinalPages(pages, renderOptions);
        }
        this.refreshPreparedCompleteness(renderer);
        this.pages = pages;
        this.exporter = this.dependencies.createExporter?.(
            this.app,
            this.contentEl.ownerDocument,
            renderer,
            renderOptions,
        ) ?? new ShareCardExporter(
            this.app,
            this.contentEl.ownerDocument,
            renderer,
            renderOptions,
            { signal: controller.signal },
        );
        this.contentEl.setAttribute("aria-busy", "false");
        await this.renderPreview();
    }

    private createNavigation(ownerDocument: Document): void {
        const navEl = ownerDocument.createElement("div");
        navEl.classList.add("pa-share-card-nav");
        navEl.hidden = true;

        const previousButton = ownerDocument.createElement("button");
        previousButton.type = "button";
        previousButton.setAttribute("aria-label", t("plugin.shareCard.previousPage"));
        previousButton.title = t("plugin.shareCard.previousPage");
        setIcon(previousButton, "chevron-left");
        previousButton.addEventListener("click", () => {
            void this.navigate(-1);
        });
        navEl.appendChild(previousButton);

        const pageIndicatorEl = ownerDocument.createElement("span");
        pageIndicatorEl.setAttribute("aria-live", "polite");
        navEl.appendChild(pageIndicatorEl);

        const nextButton = ownerDocument.createElement("button");
        nextButton.type = "button";
        nextButton.setAttribute("aria-label", t("plugin.shareCard.nextPage"));
        nextButton.title = t("plugin.shareCard.nextPage");
        setIcon(nextButton, "chevron-right");
        nextButton.addEventListener("click", () => {
            void this.navigate(1);
        });
        navEl.appendChild(nextButton);

        this.navEl = navEl;
        this.previousButton = previousButton;
        this.nextButton = nextButton;
        this.pageIndicatorEl = pageIndicatorEl;
        this.contentEl.appendChild(navEl);
    }

    private createActions(ownerDocument: Document): void {
        const actionsEl = ownerDocument.createElement("div");
        actionsEl.classList.add("pa-share-card-actions");

        const copyButton = ownerDocument.createElement("button");
        copyButton.type = "button";
        copyButton.textContent = t("plugin.shareCard.copyCurrentPage");
        copyButton.disabled = true;
        copyButton.addEventListener("click", () => {
            void this.copyCurrentPage();
        });
        actionsEl.appendChild(copyButton);

        const saveButton = ownerDocument.createElement("button");
        saveButton.type = "button";
        saveButton.classList.add("mod-cta");
        saveButton.textContent = t("plugin.shareCard.saveImage");
        saveButton.disabled = true;
        saveButton.addEventListener("click", () => {
            void this.savePages();
        });
        actionsEl.appendChild(saveButton);

        this.copyButton = copyButton;
        this.saveButton = saveButton;
        this.contentEl.appendChild(actionsEl);
    }

    private async navigate(delta: -1 | 1): Promise<void> {
        if (this.busy || this.pages.length < 2) return;
        const targetIndex = this.currentPageIndex + delta;
        if (targetIndex < 0 || targetIndex >= this.pages.length) return;
        const previousIndex = this.currentPageIndex;
        this.currentPageIndex = targetIndex;
        if (!await this.renderPreview() && this.openState) {
            this.currentPageIndex = previousIndex;
            this.updateControls(this.previewRender === null);
        }
    }

    private async renderPreview(): Promise<boolean> {
        const renderer = this.renderer;
        const host = this.previewScaleEl;
        const page = this.pages[this.currentPageIndex];
        if (!renderer || !host || !page) return false;

        const token = this.nextToken();
        const previousRender = this.previewRender;
        this.updateControls(true);
        let render: ShareCardRenderHandle;
        try {
            render = await renderer.renderPage(page, {
                theme: this.theme,
                sourceLabel: this.data.sourceLabel,
                sourcePath: this.data.resourceContext?.basePath,
                host,
            });
        } catch (error) {
            if (!(error instanceof ShareCardRenderCancelledError)) {
                console.error("Share Card preview render failed.", error);
            }
            if (this.isCurrent(token)) {
                this.setStatus(t("plugin.shareCard.prepareFailed"), "error");
                this.updateControls(previousRender === null);
            }
            return false;
        }
        if (!this.isCurrent(token) || !host.isConnected) {
            render.cleanup();
            return false;
        }

        previousRender?.cleanup();
        this.previewRender = render;
        this.pageCompleteness.set(page.pageIndex, {
            sanitizationIssueCount: render.sanitizationIssues?.length ?? 0,
            usedPlainTextFallback: render.usedPlainTextFallback,
        });
        if (this.viewportEl) this.viewportEl.hidden = false;
        this.updatePreviewScale();
        this.setReadyStatus();
        this.updateControls();
        return true;
    }

    private async copyCurrentPage(): Promise<void> {
        const exporter = this.exporter;
        const page = this.pages[this.currentPageIndex];
        if (!exporter || !page || this.busy) return;
        const token = this.beginBusy(this.copyButton, t("plugin.shareCard.copying"));
        try {
            await exporter.copyCurrentPage(page);
            if (!this.isCurrent(token)) return;
            new Notice(t("plugin.shareCard.copySuccess"));
            this.refreshPreparedCompleteness();
            this.setReadyStatus();
        } catch (error) {
            if (!this.isCurrent(token)) return;
            const message = error instanceof ShareCardClipboardUnavailableError
                ? t("plugin.shareCard.clipboardUnavailable")
                : t("plugin.shareCard.copyFailed");
            new Notice(message);
            this.setStatus(message, "error");
        } finally {
            if (this.isCurrent(token)) this.endBusy();
        }
    }

    private async savePages(): Promise<void> {
        const exporter = this.exporter;
        if (!exporter || this.pages.length === 0 || this.busy) return;
        const pages = this.pages.length === 1 ? [this.pages[0]!] : [...this.pages];
        const token = this.beginBusy(this.saveButton, t("plugin.shareCard.saving"));
        try {
            const result = await exporter.savePages(pages);
            if (!this.isCurrent(token)) return;
            let message: string;
            if (result.savedPaths.length === result.attempted) {
                message = t("plugin.shareCard.saveSuccess", {
                    count: result.savedPaths.length,
                    path: SHARE_CARD_FOLDER,
                });
            } else if (result.savedPaths.length > 0) {
                message = t("plugin.shareCard.savePartial", {
                    saved: result.savedPaths.length,
                    attempted: result.attempted,
                    path: SHARE_CARD_FOLDER,
                });
            } else {
                message = t("plugin.shareCard.saveFailed");
            }
            new Notice(message);
            if (result.savedPaths.length === result.attempted) {
                this.refreshPreparedCompleteness();
                this.setReadyStatus();
            } else {
                this.setStatus(message, "error");
            }
        } catch (error) {
            console.error("Share Card save operation failed.", error);
            if (!this.isCurrent(token)) return;
            const message = t("plugin.shareCard.saveFailed");
            new Notice(message);
            this.setStatus(message, "error");
        } finally {
            if (this.isCurrent(token)) this.endBusy();
        }
    }

    private beginBusy(activeButton: HTMLButtonElement | null, status: string): number {
        this.busy = true;
        const token = this.nextToken();
        this.contentEl.dataset.busy = "true";
        this.contentEl.setAttribute("aria-busy", "true");
        activeButton?.setAttribute("aria-busy", "true");
        this.setStatus(status);
        this.updateControls();
        return token;
    }

    private endBusy(): void {
        this.busy = false;
        delete this.contentEl.dataset.busy;
        this.contentEl.setAttribute("aria-busy", "false");
        this.copyButton?.removeAttribute("aria-busy");
        this.saveButton?.removeAttribute("aria-busy");
        this.updateControls();
    }

    private updateControls(rendering = false): void {
        const unavailable = rendering || this.pages.length === 0;
        if (this.copyButton) this.copyButton.disabled = unavailable || this.busy;
        if (this.saveButton) {
            this.saveButton.disabled = unavailable || this.busy;
            this.saveButton.textContent = this.pages.length > 1
                ? t("plugin.shareCard.saveAllPages")
                : t("plugin.shareCard.saveImage");
        }
        if (this.navEl) this.navEl.hidden = this.pages.length < 2;
        if (this.previousButton) {
            this.previousButton.disabled = unavailable || this.busy || this.currentPageIndex === 0;
        }
        if (this.nextButton) {
            this.nextButton.disabled = unavailable
                || this.busy
                || this.currentPageIndex >= this.pages.length - 1;
        }
        if (this.pageIndicatorEl && this.pages.length > 0) {
            this.pageIndicatorEl.textContent = t("plugin.shareCard.pageIndicator", {
                current: this.currentPageIndex + 1,
                total: this.pages.length,
            });
        }
    }

    private updatePreviewScale(): void {
        const viewport = this.viewportEl;
        const scaleEl = this.previewScaleEl;
        if (!viewport || !scaleEl) return;
        const fallbackWidth = Math.max(1, Math.min(
            CARD_WIDTH,
            (this.ownerWindow?.innerWidth ?? CARD_WIDTH) - 48,
        ));
        const availableWidth = viewport.clientWidth || fallbackWidth;
        const scale = Math.min(1, availableWidth / CARD_WIDTH);
        scaleEl.style.setProperty("--pa-share-card-preview-scale", String(scale));
        scaleEl.style.width = `${CARD_WIDTH * scale}px`;
        scaleEl.style.height = `${CARD_HEIGHT * scale}px`;
    }

    private setReadyStatus(): void {
        const incomplete = this.incompleteResourceCount()
            + this.incompleteRenderCount();
        const usedPlainTextFallback = this.preparedCompleteness.usedPlainTextFallback
            || [...this.pageCompleteness.values()].some((summary) => (
                summary.usedPlainTextFallback
            ));
        if (incomplete > 0) {
            const message = t("plugin.shareCard.resourceIncomplete", { count: incomplete });
            this.setStatus(usedPlainTextFallback
                ? `${message} ${t("plugin.shareCard.renderFallback")}`
                : message, "warning");
        } else if (usedPlainTextFallback) {
            this.setStatus(t("plugin.shareCard.renderFallback"), "warning");
        } else {
            this.setStatus("");
        }
    }

    private refreshPreparedCompleteness(renderer = this.renderer): void {
        if (!renderer || typeof renderer.getPreparedCompletenessSummary !== "function") return;
        this.preparedCompleteness = renderer.getPreparedCompletenessSummary();
    }

    private incompleteRenderCount(): number {
        const finalPageIssueCount = [...this.pageCompleteness.values()].reduce(
            (total, summary) => total + summary.sanitizationIssueCount,
            0,
        );
        return Math.max(
            this.preparedCompleteness.sanitizationIssueCount,
            finalPageIssueCount,
        );
    }

    private incompleteResourceCount(): number {
        const report = this.completenessReport;
        if (!report) return 0;
        return report.placeholderCount + report.failedCount;
    }

    private setStatus(message: string, tone?: "error" | "warning"): void {
        if (!this.statusEl) return;
        this.statusEl.textContent = message;
        if (tone) this.statusEl.dataset.tone = tone;
        else delete this.statusEl.dataset.tone;
    }

    private nextToken(): number {
        this.operationToken += 1;
        return this.operationToken;
    }

    private isCurrent(token: number): boolean {
        return this.openState && token === this.operationToken;
    }

    private resetElementReferences(): void {
        this.statusEl = null;
        this.viewportEl = null;
        this.previewScaleEl = null;
        this.navEl = null;
        this.previousButton = null;
        this.nextButton = null;
        this.pageIndicatorEl = null;
        this.copyButton = null;
        this.saveButton = null;
    }
}

/** Close every open Share Card Modal during plugin teardown. */
export function closeAllShareCardModals(): void {
    for (const modal of [...openShareCardModals]) {
        openShareCardModals.delete(modal);
        try {
            modal.close();
        } catch (error) {
            console.error("Failed to close a Share Card modal.", error);
        }
    }
}

export function detectShareCardTheme(ownerDocument: Document): ShareCardTheme {
    const root = ownerDocument.documentElement;
    const body = ownerDocument.body;
    return root?.classList.contains("theme-dark") || body?.classList.contains("theme-dark")
        ? "dark"
        : "light";
}

function clearElement(element: HTMLElement): void {
    while (element.firstChild) element.removeChild(element.firstChild);
}

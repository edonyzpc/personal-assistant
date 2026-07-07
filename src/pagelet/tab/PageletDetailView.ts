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
import type { GeneratedReviewNote, WriteResult } from "../output/types";
import { resolveRelatedMarkdownNote } from "../related-note";
import { TabView } from "./TabView";
import type {
    MaintenanceMoveApplyResult,
    MaintenanceMoveUndoResult,
    MaintenanceProposal,
    QuietRecallCandidate,
    QuietRecallSaveResult,
    ReviewQueueItem,
} from "../../pa";
import type {
    PageletDetailContent,
    PageletDetailLayoutType,
    PageletDetailPayload,
    TabEntryReason,
} from "./types";

export const PAGELET_DETAIL_VIEW_TYPE = "pa-pagelet-detail-view";
export const PAGELET_DETAIL_ICON = "pa-pagelet";
const PAGELET_DETAIL_STATE_VERSION = 4;
const PAGELET_DETAIL_SESSION_CACHE_LIMIT = 12;

const pageletDetailSessionCache = new Map<string, PageletDetailPayload>();
let pageletDetailSessionCounter = 0;

export function clearPageletDetailSessionCache(): void {
    pageletDetailSessionCache.clear();
    pageletDetailSessionCounter = 0;
}

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
    if (payload.entryReason) copy.entryReason = payload.entryReason;
    if (payload.extra) {
        copy.extra = {};
        if (payload.extra.connections) copy.extra.connections = [...payload.extra.connections];
        if (typeof payload.extra.markdown === "string") copy.extra.markdown = payload.extra.markdown;
        if (payload.extra.reviewQueue) {
            copy.extra.reviewQueue = {
                totalCount: payload.extra.reviewQueue.totalCount,
                items: payload.extra.reviewQueue.items.map((item) => ({
                    ...item,
                    scope: {
                        ...item.scope,
                        paths: item.scope.paths ? [...item.scope.paths] : undefined,
                        tags: item.scope.tags ? [...item.scope.tags] : undefined,
                    },
                    sourceRefs: item.sourceRefs.map((ref) => ({
                        ...ref,
                        whyShown: ref.whyShown ? [...ref.whyShown] : undefined,
                    })),
                    whyShown: [...item.whyShown],
                    metadata: item.metadata ? { ...item.metadata } : undefined,
                })),
            };
        }
        if (payload.extra.contextPager) {
            copy.extra.contextPager = {
                ...payload.extra.contextPager,
                summary: { ...payload.extra.contextPager.summary },
                usedSources: payload.extra.contextPager.usedSources.map((item) => ({ ...item })),
                skippedSources: payload.extra.contextPager.skippedSources.map((item) => ({ ...item })),
                usedMemories: payload.extra.contextPager.usedMemories.map((item) => ({ ...item })),
                droppedMemories: payload.extra.contextPager.droppedMemories.map((item) => ({ ...item })),
                persistedTrace: {
                    ...payload.extra.contextPager.persistedTrace,
                    usedSourceRefs: payload.extra.contextPager.persistedTrace.usedSourceRefs.map((item) => ({
                        ...item,
                        whyShown: item.whyShown ? [...item.whyShown] : undefined,
                    })),
                    skippedSourceRefs: payload.extra.contextPager.persistedTrace.skippedSourceRefs.map((item) => ({
                        ...item,
                        whyShown: item.whyShown ? [...item.whyShown] : undefined,
                    })),
                    usedMemoryRefs: payload.extra.contextPager.persistedTrace.usedMemoryRefs.map((item) => ({ ...item })),
                    droppedMemoryRefs: payload.extra.contextPager.persistedTrace.droppedMemoryRefs.map((item) => ({ ...item })),
                },
            };
        }
        if (payload.extra.savedInsights) {
            copy.extra.savedInsights = {
                totalCount: payload.extra.savedInsights.totalCount,
                items: payload.extra.savedInsights.items.map((item) => ({
                    ...item,
                    sourceRefs: item.sourceRefs.map((ref) => ({
                        ...ref,
                        whyShown: ref.whyShown ? [...ref.whyShown] : undefined,
                    })),
                    whyShown: [...item.whyShown],
                    scope: {
                        ...item.scope,
                        paths: item.scope.paths ? [...item.scope.paths] : undefined,
                        tags: item.scope.tags ? [...item.scope.tags] : undefined,
                    },
                })),
            };
        }
        if (payload.extra.memoryGovernance) {
            copy.extra.memoryGovernance = {
                totalCount: payload.extra.memoryGovernance.totalCount,
                records: payload.extra.memoryGovernance.records.map((record) => ({
                    ...record,
                    scope: {
                        ...record.scope,
                        paths: record.scope.paths ? [...record.scope.paths] : undefined,
                        tags: record.scope.tags ? [...record.scope.tags] : undefined,
                    },
                    sourceRefs: record.sourceRefs.map((ref) => ({
                        ...ref,
                        whyShown: ref.whyShown ? [...ref.whyShown] : undefined,
                    })),
                })),
                candidates: payload.extra.memoryGovernance.candidates?.map((item) => ({
                    ...item,
                    scope: {
                        ...item.scope,
                        paths: item.scope.paths ? [...item.scope.paths] : undefined,
                        tags: item.scope.tags ? [...item.scope.tags] : undefined,
                    },
                    sourceRefs: item.sourceRefs.map((ref) => ({
                        ...ref,
                        whyShown: ref.whyShown ? [...ref.whyShown] : undefined,
                    })),
                    whyShown: [...(item.whyShown ?? [])],
                    metadata: item.metadata ? { ...item.metadata } : undefined,
                })),
            };
        }
        if (payload.extra.maintenanceReview) {
            copy.extra.maintenanceReview = {
                generatedAt: payload.extra.maintenanceReview.generatedAt,
                previewOnly: true,
                weeklyScanEnabled: false,
                totalCount: payload.extra.maintenanceReview.totalCount,
                categories: payload.extra.maintenanceReview.categories.map((category) => ({ ...category })),
                proposals: payload.extra.maintenanceReview.proposals.map((proposal) => ({
                    ...proposal,
                    scope: {
                        ...proposal.scope,
                        paths: proposal.scope.paths ? [...proposal.scope.paths] : undefined,
                        tags: proposal.scope.tags ? [...proposal.scope.tags] : undefined,
                    },
                    sourceRefs: proposal.sourceRefs.map((ref) => ({
                        ...ref,
                        whyShown: ref.whyShown ? [...ref.whyShown] : undefined,
                    })),
                    preview: {
                        ...proposal.preview,
                        affectedPaths: [...proposal.preview.affectedPaths],
                    },
                    undoMetadata: {
                        ...proposal.undoMetadata,
                        affectedPaths: [...proposal.undoMetadata.affectedPaths],
                    },
                    actionPlan: { ...proposal.actionPlan },
                    whyShown: [...proposal.whyShown],
                })),
            };
        }
        if (payload.extra.graphDiscovery) {
            copy.extra.graphDiscovery = {
                generatedAt: payload.extra.graphDiscovery.generatedAt,
                totalCount: payload.extra.graphDiscovery.totalCount,
                skippedSourceCount: payload.extra.graphDiscovery.skippedSourceCount,
                items: payload.extra.graphDiscovery.items.map((item) => ({
                    ...item,
                    scope: {
                        ...item.scope,
                        paths: item.scope.paths ? [...item.scope.paths] : undefined,
                        tags: item.scope.tags ? [...item.scope.tags] : undefined,
                    },
                    sourceRefs: item.sourceRefs.map((ref) => ({
                        ...ref,
                        whyShown: ref.whyShown ? [...ref.whyShown] : undefined,
                    })),
                    whyShown: [...item.whyShown],
                    metadata: { ...item.metadata },
                })),
            };
        }
        if (payload.extra.patternDetection) {
            copy.extra.patternDetection = {
                generatedAt: payload.extra.patternDetection.generatedAt,
                totalCount: payload.extra.patternDetection.totalCount,
                patterns: payload.extra.patternDetection.patterns.map((pattern) => ({
                    ...pattern,
                    sourceRefs: pattern.sourceRefs.map((ref) => ({
                        ...ref,
                        whyShown: ref.whyShown ? [...ref.whyShown] : undefined,
                    })),
                    whyShown: [...pattern.whyShown],
                })),
            };
        }
        if (payload.extra.scopeRecap) {
            const cloneRecapItem = (item: typeof payload.extra.scopeRecap.summary) => ({
                ...item,
                sourceRefs: item.sourceRefs.map((ref) => ({
                    ...ref,
                    whyShown: ref.whyShown ? [...ref.whyShown] : undefined,
                })),
            });
            copy.extra.scopeRecap = {
                ...payload.extra.scopeRecap,
                scope: {
                    ...payload.extra.scopeRecap.scope,
                    paths: payload.extra.scopeRecap.scope.paths ? [...payload.extra.scopeRecap.scope.paths] : undefined,
                    tags: payload.extra.scopeRecap.scope.tags ? [...payload.extra.scopeRecap.scope.tags] : undefined,
                },
                sourceCoverage: { ...payload.extra.scopeRecap.sourceCoverage },
                skippedSources: payload.extra.scopeRecap.skippedSources.map((s) => ({ ...s })),
                summary: cloneRecapItem(payload.extra.scopeRecap.summary),
                themes: payload.extra.scopeRecap.themes.map(cloneRecapItem),
                tensions: payload.extra.scopeRecap.tensions.map(cloneRecapItem),
                openQuestions: payload.extra.scopeRecap.openQuestions.map(cloneRecapItem),
                nextReviewActions: payload.extra.scopeRecap.nextReviewActions.map(cloneRecapItem),
                sourceRefs: payload.extra.scopeRecap.sourceRefs.map((ref) => ({
                    ...ref,
                    whyShown: ref.whyShown ? [...ref.whyShown] : undefined,
                })),
            };
        }
        if (payload.extra.quietRecall) {
            copy.extra.quietRecall = {
                generatedAt: payload.extra.quietRecall.generatedAt,
                currentPath: payload.extra.quietRecall.currentPath,
                totalCount: payload.extra.quietRecall.totalCount,
                candidates: payload.extra.quietRecall.candidates.map((candidate) => ({
                    ...candidate,
                    sourceRefs: candidate.sourceRefs.map((ref) => ({
                        ...ref,
                        whyShown: ref.whyShown ? [...ref.whyShown] : undefined,
                    })),
                    whyNow: [...candidate.whyNow],
                })),
            };
        }
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
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"`,
        `fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">`,
        `<path d="M3.8 19.25c3.3-7.45 8.5-12.95 16.3-14.8"/>`,
        `<path d="M7.05 18.75c5.15 1.55 10.1-1.05 13.55-7"/>`,
        `<path d="M9.45 12.65c3.05.7 6.1-.85 8.4-3.9"/>`,
        `<circle cx="4" cy="19.3" r="2.65" fill="#2f9e44" stroke="none"/>`,
        `<circle cx="11.25" cy="12.7" r="2.35" fill="#1971c2" stroke="none"/>`,
        `<circle cx="19.8" cy="4.55" r="2.55" fill="#f08c00" stroke="none"/>`,
        `</svg>`,
    ].join("");
}

export function registerPageletDetailIcon(): void {
    addIcon(PAGELET_DETAIL_ICON, buildPageletDetailIconSvg());
}

export class PageletDetailView extends ItemView {
    private readonly getLocale: () => PageletLocale;
    private readonly onSaveSummaryNote?: (note: GeneratedReviewNote) => Promise<WriteResult>;
    private readonly onApplyMaintenanceProposal?: (proposal: MaintenanceProposal) => Promise<MaintenanceMoveApplyResult>;
    private readonly onUndoMaintenanceAction?: (actionId: string) => Promise<MaintenanceMoveUndoResult>;
    private readonly onConfirmMemoryCandidate?: (item: ReviewQueueItem) => Promise<{ ok: boolean; message: string }>;
    private readonly onDismissMemoryCandidate?: (item: ReviewQueueItem) => Promise<{ ok: boolean; message: string }>;
    private readonly onSaveQuietRecallAsInsight?: (candidate: QuietRecallCandidate) => Promise<QuietRecallSaveResult>;
    private readonly onLinkQuietRecallCandidate?: (candidate: QuietRecallCandidate, currentPath?: string) => Promise<{ ok: boolean; message: string }>;
    private readonly onOpenSettings?: () => void;
    private renderer: TabView | null = null;
    private title: string;
    private content: PageletDetailContent = [];
    private locale: PageletLocale;
    private sessionId: string;
    private payloadOptions: Pick<PageletDetailPayload, "layoutType" | "extra" | "sourcePath" | "summarySaveNote" | "restoredFromState" | "entryReason"> = {};

    constructor(
        leaf: WorkspaceLeaf,
        getLocale: () => PageletLocale = getPageletUiLanguage,
        onSaveSummaryNote?: (note: GeneratedReviewNote) => Promise<WriteResult>,
        onApplyMaintenanceProposal?: (proposal: MaintenanceProposal) => Promise<MaintenanceMoveApplyResult>,
        onUndoMaintenanceAction?: (actionId: string) => Promise<MaintenanceMoveUndoResult>,
        onConfirmMemoryCandidate?: (item: ReviewQueueItem) => Promise<{ ok: boolean; message: string }>,
        onDismissMemoryCandidate?: (item: ReviewQueueItem) => Promise<{ ok: boolean; message: string }>,
        onSaveQuietRecallAsInsight?: (candidate: QuietRecallCandidate) => Promise<QuietRecallSaveResult>,
        onLinkQuietRecallCandidate?: (candidate: QuietRecallCandidate, currentPath?: string) => Promise<{ ok: boolean; message: string }>,
        onOpenSettings?: () => void,
    ) {
        super(leaf);
        this.getLocale = getLocale;
        this.onSaveSummaryNote = onSaveSummaryNote;
        this.onApplyMaintenanceProposal = onApplyMaintenanceProposal;
        this.onUndoMaintenanceAction = onUndoMaintenanceAction;
        this.onConfirmMemoryCandidate = onConfirmMemoryCandidate;
        this.onDismissMemoryCandidate = onDismissMemoryCandidate;
        this.onSaveQuietRecallAsInsight = onSaveQuietRecallAsInsight;
        this.onLinkQuietRecallCandidate = onLinkQuietRecallCandidate;
        this.onOpenSettings = onOpenSettings;
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
            onSourcePathClick: (path) => this.openRelatedNote(path),
            onSaveSummaryNote: this.onSaveSummaryNote
                ? (note) => this.saveSummaryNote(note)
                : undefined,
            onApplyMaintenanceProposal: this.onApplyMaintenanceProposal,
            onUndoMaintenanceAction: this.onUndoMaintenanceAction,
            onConfirmMemoryCandidate: this.onConfirmMemoryCandidate,
            onDismissMemoryCandidate: this.onDismissMemoryCandidate,
            onSaveQuietRecallAsInsight: this.onSaveQuietRecallAsInsight,
            onLinkRecallCandidate: this.onLinkQuietRecallCandidate,
            onOpenSettings: this.onOpenSettings,
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
        if (this.payloadOptions.entryReason) {
            payload.entryReason = this.payloadOptions.entryReason;
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
            entryReason: payload.entryReason,
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
            entryReason: this.payloadOptions.entryReason,
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
    const entryReason = normalizeTabEntryReason(payload.entryReason);
    if (entryReason) result.entryReason = entryReason;
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

function normalizeTabEntryReason(value: unknown): TabEntryReason | undefined {
    return value === "panel-expand"
        || value === "maintenance"
        || value === "quiet-recall"
        || value === "graph-discovery"
        || value === "pattern-detection"
        || value === "scope-recap"
        || value === "default"
        ? value
        : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

import type { App } from "obsidian";
import {
    ShareCardExporter,
    captureShareCardElement,
    type ShareCardExportAppearance,
} from "../../src/share-card/share-card-export";
import { ShareCardModal } from "../../src/share-card/share-card-modal";
import {
    ShareCardRenderer,
    type ShareCardRenderHandle,
} from "../../src/share-card/share-card-renderer";
import type {
    CardPage,
    ShareCardData,
    ShareCardTheme,
} from "../../src/share-card/share-card-types";
import {
    SHARE_CARD_LIGHT_PRINT_FIXTURES,
    type ShareCardLightPrintFixture,
} from "./share-card-light-print-fixtures";
import {
    type ShareCardLightPrintModalLike,
    ShareCardLightPrintRenderer,
    inspectShareCardLightPrint,
    ShareCardLightPrintModalRegistry,
} from "./share-card-light-print";
import {
    compareShareCardPixelSamples,
    evaluateShareCardPixelComparison,
    type ShareCardPixelData,
    type ShareCardPixelRect,
} from "./share-card-light-print-pixels";

const EXPECTED_VAULT_NAME = "test";
const OUTPUT_ROOT = "pa-light-print-probe-20260913";
const CAPTURE_SCALE = 2;
const EXPECTED_PNG_WIDTH = 1080;
const EXPECTED_PNG_HEIGHT = 1440;
const SELECTED_RECT_PADDING_PIXELS = 8;
const PROTECTED_SELECTORS = [
    "canvas",
    "code",
    "img",
    "kbd",
    "picture",
    "pre",
    "samp",
    "svg",
];

type ProbeSaveResult = Awaited<ReturnType<ShareCardExporter["savePages"]>>;

export type ShareCardLightPrintFixtureId =
    | "short-zh"
    | "short-en"
    | "long-edge"
    | "no-heading";
export type ShareCardLightPrintEffect = "baseline" | "light";

export interface ShareCardLightPrintOpenOptions {
    effect?: ShareCardLightPrintEffect;
    fixture?: ShareCardLightPrintFixtureId;
    theme?: ShareCardTheme;
}

export interface ShareCardLightPrintOpenResult {
    modal: ShareCardModalDiagnostics;
    fixture: ShareCardLightPrintFixtureId;
    effect: ShareCardLightPrintEffect;
    theme: ShareCardTheme;
    saveFolder: string;
}

export interface ShareCardLightPrintStatus {
    vault: string;
    runDirectory: string | null;
    openModalCount: number;
    lightDefinitionCount: number;
    guardedFolderCount: number;
    chromeSnapshotActive: boolean;
}

interface ShareCardModalDiagnostics {
    contentEl: HTMLElement;
    open(): void;
    close(): void;
    theme?: ShareCardTheme;
    pages?: CardPage[];
    appearance?: ShareCardExportAppearance;
    renderer?: ShareCardRenderer;
    exporter?: unknown;
    updateControls?: (rendering?: boolean) => void;
    disposeProbeOverrides(): void;
};

interface PreparedScenario {
    modal: ShareCardModalDiagnostics;
    fixture: ShareCardLightPrintFixture;
    pages: readonly CardPage[];
    appearance: ShareCardExportAppearance;
    renderer: ShareCardRenderer;
    lightPrint: boolean;
}

interface CapturedShareCard {
    path: string;
    byteSize: number;
    width: number;
    height: number;
    sha256: string;
    pixels: ShareCardPixelData;
    selectedRects: ShareCardPixelRect[];
    protectedRects: ShareCardPixelRect[];
    selectedRectCount: number;
    protectedRectCount: number;
    externalUrls: string[];
    fits: boolean;
    usedPlainTextFallback: boolean;
    sanitizationIssueCount: number;
    lightDefinitionCount: number;
    lightUnresolvedReferences: string[];
}

interface PixelComparisonRecord {
    changedPixelCount: number;
    selectedRegionChangedPixelCount: number;
    protectedRegionChangedPixelCount: number;
    outsideSelectedChangedPixelCount: number;
    pass: boolean;
}

interface ShortMatrixCaseRecord {
    fixture: ShareCardLightPrintFixtureId;
    theme: ShareCardTheme;
    batchFontSize: number;
    pageCount: number;
    baseline: Omit<CapturedShareCard, "pixels">;
    light: Omit<CapturedShareCard, "pixels">;
    repeat: Omit<CapturedShareCard, "pixels">;
    baselineToLight: PixelComparisonRecord;
    repeatStability: PixelComparisonRecord;
    pass: boolean;
    error?: string;
}

interface LongPageRecord {
    pageIndex: number;
    totalPages: number;
    sourceCharacters: number;
    nonEmpty: boolean;
    fits: boolean;
    usedPlainTextFallback: boolean;
    sanitizationIssueCount: number;
    selectedCount: number;
    expectedDefinitionCount: number;
    definitionCount: number;
    unresolvedReferences: string[];
    selectionContractPass: boolean;
}

interface LongMatrixRecord {
    batchFontSize: number;
    pageCount: number;
    pages: LongPageRecord[];
    baselineLightPagesMatch: boolean;
    sequenceCorrect: boolean;
    totalPagesCorrect: boolean;
    sourceEndsWithFinalSentence: boolean;
    criticalPageIndex: number;
    savedPageIndexes: number[];
    baselineToLightByPage: Array<PixelComparisonRecord & {
        pageIndex: number;
        selectedCount: number;
        expectedDefinitionCount: number;
        definitionCount: number;
        exactUnchanged: boolean;
    }>;
    pass: boolean;
    error?: string;
}

interface ExplicitFontRecord {
    fontSize: 14;
    fitsBaseline: boolean;
    fitsLight: boolean;
    baselinePath: string;
    lightPath: string;
    comparison: PixelComparisonRecord;
    pass: boolean;
    error?: string;
}

interface ConcurrencyRecord {
    firstFilterId: string | null;
    secondFilterId: string | null;
    idsDiffer: boolean;
    firstDefinitionCount: number;
    secondDefinitionCount: number;
    unresolvedReferences: string[];
    pass: boolean;
    error?: string;
}

export interface ShareCardLightPrintMatrixReport {
    runDirectory: string;
    startedAt: string;
    finishedAt?: string;
    shortCases: ShortMatrixCaseRecord[];
    noHeading?: ShortMatrixCaseRecord;
    longEdge?: LongMatrixRecord;
    explicit14px?: ExplicitFontRecord;
    concurrency?: ConcurrencyRecord;
    externalUrlObservations: string[];
    networkObservationNote: string;
    overallPass: boolean;
    error?: string;
}

class GuardedProbeExporter extends ShareCardExporter {
    readonly probeAppearance: ShareCardExportAppearance;

    constructor(
        app: App,
        document: Document,
        renderer: ShareCardRenderer,
        appearance: ShareCardExportAppearance,
        private readonly getFolder: () => Promise<string>,
    ) {
        super(app, document, renderer, appearance);
        this.probeAppearance = appearance;
    }

    override async savePages(
        pages: readonly CardPage[],
        _folder?: string,
    ): Promise<ProbeSaveResult> {
        return await super.savePages(pages, await this.getFolder());
    }
}

export class ProbeShareCardModal extends ShareCardModal {
    private restoreUpdateControls: (() => void) | null = null;

    constructor(
        app: App,
        data: ShareCardData,
        lightPrint: boolean,
        private readonly requestedTheme: ShareCardTheme,
        private readonly controller: ShareCardLightPrintProbeController,
    ) {
        super(app, data, {
            createExporter: (exporterApp, document, renderer, appearance) => new GuardedProbeExporter(
                exporterApp,
                document,
                renderer,
                appearance,
                async () => controller.getOutputFolder(),
            ),
            createRenderer: (rendererApp, rendererDocument) => {
                // This callback runs after ShareCardModal detects the host theme
                // and before prepare() builds pagination, preview, and exporter
                // options. Override only this Modal's theme at that seam.
                (this as unknown as ShareCardModalDiagnostics).theme = this.requestedTheme;
                return lightPrint
                    ? new ShareCardLightPrintRenderer(rendererApp, rendererDocument)
                    : new ShareCardRenderer(rendererApp, rendererDocument);
            },
        });
    }

    override onOpen(): void {
        const diagnostic = this as unknown as ShareCardModalDiagnostics;
        const implementation = diagnostic.updateControls;
        if (typeof implementation === "function") {
            diagnostic.updateControls = (rendering = false) => {
                implementation.call(this, rendering);
                this.lockSaveFolder();
            };
            this.restoreUpdateControls = () => {
                delete (diagnostic as { updateControls?: (rendering?: boolean) => void }).updateControls;
            };
        }
        super.onOpen();
        this.lockSaveFolder();
    }

    override onClose(): void {
        super.onClose();
        this.disposeProbeOverrides();
        this.controller.modalClosed(this);
    }

    disposeProbeOverrides(): void {
        this.restoreUpdateControls?.();
        this.restoreUpdateControls = null;
    }

    private lockSaveFolder(): void {
        const folderInput = this.contentEl.querySelector(".pa-share-card-folder-input");
        if (folderInput instanceof HTMLInputElement) {
            folderInput.value = this.controller.currentOutputFolder ?? OUTPUT_ROOT;
            folderInput.disabled = true;
            folderInput.readOnly = true;
            folderInput.setAttribute("data-pa-light-print-probe", "guarded");
        }
    }
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, milliseconds);
    });
}

async function waitForOwnerFrame(ownerDocument: Document): Promise<void> {
    await new Promise<void>((resolve) => {
        ownerDocument.defaultView?.requestAnimationFrame(() => resolve()) ?? resolve();
    });
    await new Promise<void>((resolve) => {
        ownerDocument.defaultView?.requestAnimationFrame(() => resolve()) ?? resolve();
    });
}

async function waitFor(condition: () => boolean, timeoutMs = 30000): Promise<void> {
    const startedAt = Date.now();
    while (!condition()) {
        if (Date.now() - startedAt > timeoutMs) {
            throw new Error(`Timed out after ${timeoutMs}ms waiting for the Share Card probe.`);
        }
        await delay(50);
    }
}

function fixtureById(id: ShareCardLightPrintFixtureId): ShareCardLightPrintFixture {
    const fixture = SHARE_CARD_LIGHT_PRINT_FIXTURES.find((candidate) => candidate.id === id);
    if (!fixture) throw new Error(`Unknown light-print fixture: ${id}`);
    return fixture;
}

function getExternalHttpUrls(value: string): string[] {
    return [...value.matchAll(/https?:\/\/[^\s"'<>)]+/giu)].map((match) => match[0]);
}

function auditElementExternalUrls(element: Element): string[] {
    const urls = new Set<string>();
    const visit = (current: Element): void => {
        for (const name of current.getAttributeNames()) {
            for (const url of getExternalHttpUrls(current.getAttribute(name) ?? "")) urls.add(url);
        }
        const style = current.getAttribute("style");
        if (style) for (const url of getExternalHttpUrls(style)) urls.add(url);
        for (const child of Array.from(current.children)) visit(child);
    };
    visit(element);
    return [...urls].sort();
}

export function installExternalCallAudit(): {
    readonly observations: readonly string[];
    restore: () => void;
} {
    const observations = new Set<string>();
    const originalFetch = window.fetch;
    const originalOpen = XMLHttpRequest.prototype.open;
    const isExternal = (url: string): boolean => /^https?:\/\//iu.test(url);

    window.fetch = async (...args: Parameters<typeof fetch>) => {
        const input = args[0];
        const url = typeof input === "string"
            ? input
            : input instanceof URL
                ? input.href
                : String(input);
        if (isExternal(url)) observations.add(url);
        return await originalFetch(...args);
    };

    XMLHttpRequest.prototype.open = function patchedOpen(
        this: XMLHttpRequest,
        method: string,
        url: string | URL,
        ...rest: unknown[]
    ) {
        const value = url instanceof URL ? url.href : url;
        if (isExternal(String(value))) observations.add(String(value));
        return (originalOpen as unknown as (...openArgs: unknown[]) => void).apply(
            this,
            [method, url, ...rest],
        );
    };

    return {
        get observations() {
            return [...observations];
        },
        restore: () => {
            window.fetch = originalFetch;
            XMLHttpRequest.prototype.open = originalOpen;
        },
    };
}

async function sha256Hex(blob: Blob): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

async function decodePng(
    ownerDocument: Document,
    blob: Blob,
): Promise<ShareCardPixelData> {
    if (typeof createImageBitmap === "function") {
        const bitmap = await createImageBitmap(blob);
        const canvas = ownerDocument.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Unable to create a 2D canvas context.");
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        return context.getImageData(0, 0, canvas.width, canvas.height);
    }

    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    try {
        await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error("Probe PNG decoding failed."));
            image.src = objectUrl;
        });
        const canvas = ownerDocument.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Unable to create a 2D canvas context.");
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height);
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

function relativeRect(element: HTMLElement, cardEl: HTMLElement): ShareCardPixelRect {
    const elementRect = element.getBoundingClientRect();
    const cardRect = cardEl.getBoundingClientRect();
    return {
        x: (elementRect.left - cardRect.left) * CAPTURE_SCALE,
        y: (elementRect.top - cardRect.top) * CAPTURE_SCALE,
        width: elementRect.width * CAPTURE_SCALE,
        height: elementRect.height * CAPTURE_SCALE,
    };
}

function clipsOverflow(value: string): boolean {
    return value === "hidden"
        || value === "clip"
        || value === "auto"
        || value === "scroll";
}

function clipRectToAncestor(
    rect: ShareCardPixelRect,
    ancestor: HTMLElement,
    cardEl: HTMLElement,
): ShareCardPixelRect {
    const ancestorRect = relativeRect(ancestor, cardEl);
    const style = ancestor.ownerDocument.defaultView?.getComputedStyle(ancestor);
    const clipX = style ? clipsOverflow(style.overflowX) : false;
    const clipY = style ? clipsOverflow(style.overflowY) : false;
    if (!clipX && !clipY) return rect;

    const left = Math.max(rect.x, clipX ? ancestorRect.x : rect.x);
    const top = Math.max(rect.y, clipY ? ancestorRect.y : rect.y);
    const right = Math.min(
        rect.x + rect.width,
        clipX ? ancestorRect.x + ancestorRect.width : rect.x + rect.width,
    );
    const bottom = Math.min(
        rect.y + rect.height,
        clipY ? ancestorRect.y + ancestorRect.height : rect.y + rect.height,
    );
    return {
        x: left,
        y: top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
    };
}

export function visibleRelativeRect(
    element: HTMLElement,
    cardEl: HTMLElement,
): ShareCardPixelRect | null {
    let rect = relativeRect(element, cardEl);
    let ancestor = element.parentElement;
    while (ancestor && ancestor !== cardEl) {
        rect = clipRectToAncestor(rect, ancestor, cardEl);
        if (rect.width === 0 || rect.height === 0) return null;
        ancestor = ancestor.parentElement;
    }
    return rect.width === 0 || rect.height === 0 ? null : rect;
}

function selectedRects(render: ShareCardRenderHandle): ShareCardPixelRect[] {
    return Array.from(render.bodyEl.querySelectorAll("[data-pa-share-card-light-print=\"heading-text\"]"))
        .filter((element): element is HTMLElement => element instanceof HTMLElement)
        .map((element) => relativeRect(element, render.cardEl));
}

function protectedRects(render: ShareCardRenderHandle): ShareCardPixelRect[] {
    return Array.from(render.bodyEl.querySelectorAll(PROTECTED_SELECTORS.join(",")))
        .filter((element): element is HTMLElement => element instanceof HTMLElement)
        .map((element) => visibleRelativeRect(element, render.cardEl))
        .filter((rect): rect is ShareCardPixelRect => rect !== null);
}

function comparisonRecord(
    baseline: ShareCardPixelData,
    comparison: ShareCardPixelData,
    selected: readonly ShareCardPixelRect[],
    protectedRectsValue: readonly ShareCardPixelRect[],
    expectSelectedChange: boolean,
): PixelComparisonRecord {
    const evaluation = evaluateShareCardPixelComparison(
        baseline,
        comparison,
        selected,
        protectedRectsValue,
        expectSelectedChange,
        { selectedPaddingPixels: SELECTED_RECT_PADDING_PIXELS },
    );
    return {
        changedPixelCount: evaluation.changedPixelCount,
        selectedRegionChangedPixelCount: evaluation.selectedRegionChangedPixelCount,
        protectedRegionChangedPixelCount: evaluation.protectedRegionChangedPixelCount,
        outsideSelectedChangedPixelCount: evaluation.outsideSelectedChangedPixelCount,
        pass: evaluation.pass,
    };
}

function stableComparisonRecord(
    baseline: ShareCardPixelData,
    comparison: ShareCardPixelData,
): PixelComparisonRecord {
    const result = compareShareCardPixelSamples(baseline, comparison, [], []);
    return {
        changedPixelCount: result.changedPixelCount,
        selectedRegionChangedPixelCount: result.selectedRegionChangedPixelCount,
        protectedRegionChangedPixelCount: result.protectedRegionChangedPixelCount,
        outsideSelectedChangedPixelCount: result.outsideSelectedChangedPixelCount,
        pass: result.changedPixelCount === 0,
    };
}

export class ShareCardLightPrintProbeController {
    readonly modalRegistry: ShareCardLightPrintModalRegistry;
    private outputFolder: string | null = null;
    private outputFolderPromise: Promise<string> | null = null;
    private matrixStarted = false;
    private disposed = false;

    constructor(private readonly app: App) {
        this.assertSyntheticVault();
        // Keep lifecycle coordination for compatibility without touching host chrome.
        this.modalRegistry = new ShareCardLightPrintModalRegistry(() => undefined);
    }

    get currentOutputFolder(): string | null {
        return this.outputFolder;
    }

    status(): ShareCardLightPrintStatus {
        this.assertSyntheticVault();
        return {
            vault: this.app.vault.getName(),
            runDirectory: this.outputFolder,
            openModalCount: this.modalRegistry.openCount,
            lightDefinitionCount: document.querySelectorAll(".pa-share-card-light-print-defs").length,
            guardedFolderCount: document.querySelectorAll("[data-pa-light-print-probe=\"guarded\"]").length,
            chromeSnapshotActive: false,
        };
    }

    async open(options: ShareCardLightPrintOpenOptions = {}): Promise<ShareCardLightPrintOpenResult> {
        this.assertSyntheticVault();
        this.assertNotDisposed();
        const fixtureId = options.fixture ?? "short-zh";
        const effect = options.effect ?? "light";
        const theme = options.theme ?? "light";
        const fixture = fixtureById(fixtureId);
        const saveFolder = await this.getOutputFolder();

        const modal = new ProbeShareCardModal(
            this.app,
            {
                content: fixture.markdown,
                source: "note",
                sourceLabel: `Light print probe / ${fixtureId}`,
            },
            effect === "light",
            theme,
            this,
        ) as unknown as ShareCardModalDiagnostics;
        this.modalRegistry.add(modal, () => modal.disposeProbeOverrides());
        try {
            modal.open();
            await waitFor(() => this.isModalReady(modal));
            this.lockModalFolder(modal, saveFolder);
            return { modal, fixture: fixtureId, effect, theme, saveFolder };
        } catch (error) {
            modal.close();
            throw error;
        }
    }

    async runMatrix(): Promise<ShareCardLightPrintMatrixReport> {
        this.assertSyntheticVault();
        this.assertNotDisposed();
        if (this.modalRegistry.openCount > 0) {
            throw new Error("Close open probe modals before running the matrix.");
        }

        if (this.matrixStarted) {
            this.outputFolder = null;
            this.outputFolderPromise = this.createOutputFolder();
        }
        this.matrixStarted = true;
        const runDirectory = await this.getOutputFolder();
        const audit = installExternalCallAudit();
        const report: ShareCardLightPrintMatrixReport = {
            runDirectory,
            startedAt: new Date().toISOString(),
            shortCases: [],
            externalUrlObservations: [],
            networkObservationNote: "Fetch/XHR URLs are observations only; data/blob URLs and Performance resource-entry deltas are not treated as proof.",
            overallPass: false,
        };

        try {
            for (const theme of ["light", "dark"] as const) {
                for (const fixtureId of ["short-zh", "short-en"] as const) {
                    try {
                        report.shortCases.push(await this.runShortCase(fixtureId, theme));
                    } catch (error) {
                        report.shortCases.push({
                            fixture: fixtureId,
                            theme,
                            batchFontSize: 0,
                            pageCount: 0,
                            baseline: undefined as never,
                            light: undefined as never,
                            repeat: undefined as never,
                            baselineToLight: undefined as never,
                            repeatStability: undefined as never,
                            pass: false,
                            error: String(error),
                        });
                    }
                }
            }

            try {
                report.noHeading = await this.runShortCase("no-heading", "light", false);
            } catch (error) {
                report.noHeading = {
                    fixture: "no-heading",
                    theme: "light",
                    batchFontSize: 0,
                    pageCount: 0,
                    baseline: undefined as never,
                    light: undefined as never,
                    repeat: undefined as never,
                    baselineToLight: undefined as never,
                    repeatStability: undefined as never,
                    pass: false,
                    error: String(error),
                };
            }

            try {
                report.longEdge = await this.runLongEdgeCase();
            } catch (error) {
                report.longEdge = {
                    batchFontSize: 0,
                    pageCount: 0,
                    pages: [],
                    baselineLightPagesMatch: false,
                    sequenceCorrect: false,
                    totalPagesCorrect: false,
                    sourceEndsWithFinalSentence: false,
                    criticalPageIndex: -1,
                    savedPageIndexes: [],
                    baselineToLightByPage: [],
                    pass: false,
                    error: String(error),
                };
            }

            try {
                report.explicit14px = await this.runExplicit14pxCase();
            } catch (error) {
                report.explicit14px = {
                    fontSize: 14,
                    fitsBaseline: false,
                    fitsLight: false,
                    baselinePath: "",
                    lightPath: "",
                    comparison: undefined as never,
                    pass: false,
                    error: String(error),
                };
            }

            try {
                report.concurrency = await this.runConcurrencyCheck();
            } catch (error) {
                report.concurrency = {
                    firstFilterId: null,
                    secondFilterId: null,
                    idsDiffer: false,
                    firstDefinitionCount: 0,
                    secondDefinitionCount: 0,
                    unresolvedReferences: [String(error)],
                    pass: false,
                    error: String(error),
                };
            }

            report.finishedAt = new Date().toISOString();
            report.overallPass = report.shortCases.length === 4
                && report.shortCases.every((record) => record.pass)
                && (report.noHeading?.pass ?? false)
                && (report.longEdge?.pass ?? false)
                && (report.explicit14px?.pass ?? false)
                && (report.concurrency?.pass ?? false);
            return report;
        } finally {
            report.externalUrlObservations = [...audit.observations].sort();
            audit.restore();
            await this.writeMatrixReport(report);
        }
    }

    async cleanup(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        this.modalRegistry.closeAll();
        await waitForOwnerFrame(document);
    }

    modalClosed(modal: ShareCardLightPrintModalLike): void {
        this.modalRegistry.handleClosed(modal);
    }

    async getOutputFolder(): Promise<string> {
        this.assertSyntheticVault();
        this.assertNotDisposed();
        this.outputFolderPromise ??= this.createOutputFolder();
        this.outputFolder = await this.outputFolderPromise;
        return this.outputFolder;
    }

    private assertNotDisposed(): void {
        if (this.disposed) throw new Error("The Share Card light-print probe was cleaned up.");
    }

    private assertSyntheticVault(): void {
        if (this.app.vault.getName() !== EXPECTED_VAULT_NAME) {
            throw new Error(`Share Card light-print probe is limited to vault "${EXPECTED_VAULT_NAME}".`);
        }
    }

    private async createOutputFolder(): Promise<string> {
        try {
            await this.app.vault.createFolder(OUTPUT_ROOT);
        } catch {
            // The fixed root may already exist. Every run still creates a new child below.
        }
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const candidate = `${OUTPUT_ROOT}/r4-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            try {
                await this.app.vault.createFolder(candidate);
                return candidate;
            } catch (error) {
                if (attempt === 4) throw error;
            }
        }
        throw new Error("Unable to create a unique light-print run directory.");
    }

    private isModalReady(modal: ShareCardModalDiagnostics): boolean {
        return (modal.pages?.length ?? 0) > 0
            && modal.renderer !== undefined
            && modal.exporter !== undefined
            && modal.contentEl.getAttribute("aria-busy") === "false"
            && modal.contentEl.querySelector(".mod-cta") instanceof HTMLButtonElement
            && !(modal.contentEl.querySelector(".mod-cta") as HTMLButtonElement).disabled;
    }

    private lockModalFolder(modal: ShareCardModalDiagnostics, folder: string): void {
        const input = modal.contentEl.querySelector(".pa-share-card-folder-input");
        if (input instanceof HTMLInputElement) {
            input.value = folder;
            input.disabled = true;
            input.readOnly = true;
            input.setAttribute("data-pa-light-print-probe", "guarded");
        }
    }

    private async prepareScenario(
        fixtureId: ShareCardLightPrintFixtureId,
        theme: ShareCardTheme,
        lightPrint: boolean,
    ): Promise<PreparedScenario> {
        const opened = await this.open({
            effect: lightPrint ? "light" : "baseline",
            fixture: fixtureId,
            theme,
        });
        const modal = opened.modal as unknown as ShareCardModalDiagnostics;
        const pages = modal.pages ?? [];
        const appearance = modal.appearance;
        const renderer = modal.renderer;
        if (pages.length === 0 || !appearance || !renderer) {
            throw new Error(`Share Card did not prepare ${fixtureId}.`);
        }
        return {
            modal,
            fixture: fixtureById(fixtureId),
            pages,
            appearance,
            renderer,
            lightPrint,
        };
    }

    private async closeScenario(scenario: PreparedScenario | null): Promise<void> {
        if (!scenario) return;
        scenario.modal.close();
        await waitForOwnerFrame(document);
    }

    private async capturePage(
        scenario: PreparedScenario,
        pageIndex: number,
        fileName: string,
        appearanceOverride?: ShareCardExportAppearance,
    ): Promise<CapturedShareCard> {
        const page = scenario.pages[pageIndex];
        if (!page) throw new Error(`Page ${pageIndex} is unavailable for ${scenario.fixture.id}.`);
        const ownerDocument = scenario.modal.contentEl.ownerDocument;
        const host = ownerDocument.createElement("div");
        host.classList.add("pa-share-card-capture-host");
        ownerDocument.body?.appendChild(host);
        let render: ShareCardRenderHandle | null = null;
        try {
            render = await scenario.renderer.renderPage(page, {
                ...scenario.appearance,
                ...appearanceOverride,
                host,
            });
            await waitForOwnerFrame(ownerDocument);
            const selected = selectedRects(render);
            const protectedValue = protectedRects(render);
            const blob = await captureShareCardElement(render.cardEl);
            const pixels = await decodePng(ownerDocument, blob);
            if (pixels.width !== EXPECTED_PNG_WIDTH || pixels.height !== EXPECTED_PNG_HEIGHT) {
                throw new Error(`Unexpected PNG dimensions: ${pixels.width}x${pixels.height}.`);
            }
            if (blob.size === 0) throw new Error("Capture returned an empty PNG.");
            const inspection = inspectShareCardLightPrint(render.cardEl, render.bodyEl);
            const path = `${await this.getOutputFolder()}/${fileName}`;
            await this.app.vault.createBinary(path, await blob.arrayBuffer());
            return {
                path,
                byteSize: blob.size,
                width: pixels.width,
                height: pixels.height,
                sha256: await sha256Hex(blob),
                pixels,
                selectedRects: selected,
                protectedRects: protectedValue,
                selectedRectCount: selected.length,
                protectedRectCount: protectedValue.length,
                externalUrls: auditElementExternalUrls(render.cardEl),
                fits: render.fits(),
                usedPlainTextFallback: render.usedPlainTextFallback,
                sanitizationIssueCount: render.sanitizationIssues.length,
                lightDefinitionCount: inspection.definitionCount,
                lightUnresolvedReferences: inspection.unresolvedReferences,
            };
        } finally {
            render?.cleanup();
            host.remove();
        }
    }

    private async runShortCase(
        fixtureId: Exclude<ShareCardLightPrintFixtureId, "long-edge">,
        theme: ShareCardTheme,
        expectSelectedChange = true,
    ): Promise<ShortMatrixCaseRecord> {
        let baselineScenario: PreparedScenario | null = null;
        let lightScenario: PreparedScenario | null = null;
        try {
            baselineScenario = await this.prepareScenario(fixtureId, theme, false);
            const baseline = await this.capturePage(
                baselineScenario,
                0,
                `${fixtureId}-${theme}-baseline.png`,
            );
            await this.closeScenario(baselineScenario);
            baselineScenario = null;

            lightScenario = await this.prepareScenario(fixtureId, theme, true);
            const light = await this.capturePage(
                lightScenario,
                0,
                `${fixtureId}-${theme}-light.png`,
            );
            const repeat = await this.capturePage(
                lightScenario,
                0,
                `${fixtureId}-${theme}-light-repeat.png`,
            );
            const baselineToLight = comparisonRecord(
                baseline.pixels,
                light.pixels,
                light.selectedRects,
                light.protectedRects,
                expectSelectedChange,
            );
            const repeatStability = stableComparisonRecord(light.pixels, repeat.pixels);
            const pass = baseline.width === EXPECTED_PNG_WIDTH
                && baseline.height === EXPECTED_PNG_HEIGHT
                && light.byteSize > 0
                && baselineToLight.pass
                && repeatStability.pass
                && light.lightDefinitionCount === (expectSelectedChange ? 1 : 0)
                && light.lightUnresolvedReferences.length === 0
                && baseline.externalUrls.length === 0
                && light.externalUrls.length === 0;
            const { pixels: _baselinePixels, ...baselineRecord } = baseline;
            const { pixels: _lightPixels, ...lightRecord } = light;
            const { pixels: _repeatPixels, ...repeatRecord } = repeat;
            return {
                fixture: fixtureId,
                theme,
                batchFontSize: lightScenario!.appearance.fontSize ?? 16,
                pageCount: lightScenario!.pages.length,
                baseline: baselineRecord,
                light: lightRecord,
                repeat: repeatRecord,
                baselineToLight,
                repeatStability,
                pass,
            };
        } finally {
            await this.closeScenario(baselineScenario);
            await this.closeScenario(lightScenario);
        }
    }

    private async runLongEdgeCase(): Promise<LongMatrixRecord> {
        let baselineScenario: PreparedScenario | null = null;
        let lightScenario: PreparedScenario | null = null;
        try {
            baselineScenario = await this.prepareScenario("long-edge", "light", false);
            lightScenario = await this.prepareScenario("long-edge", "light", true);
            if (baselineScenario.pages.length !== lightScenario!.pages.length) {
                throw new Error("Baseline and light pagination differed.");
            }
            const pageRecords: LongPageRecord[] = [];
            const comparisons: LongMatrixRecord["baselineToLightByPage"] = [];
            const ownerDocument = lightScenario!.modal.contentEl.ownerDocument;

            for (const [index, page] of lightScenario!.pages.entries()) {
                const host = ownerDocument.createElement("div");
                host.classList.add("pa-share-card-capture-host");
                ownerDocument.body?.appendChild(host);
                let render: ShareCardRenderHandle | null = null;
                try {
                    render = await lightScenario!.renderer.renderPage(page, {
                        ...lightScenario!.appearance,
                        host,
                    });
                    await waitForOwnerFrame(ownerDocument);
                    const inspection = inspectShareCardLightPrint(render.cardEl, render.bodyEl);
                    const expectedDefinitionCount = inspection.selectedCount > 0 ? 1 : 0;
                    const selectionContractPass = inspection.definitionCount === expectedDefinitionCount
                        && inspection.unresolvedReferences.length === 0;
                    pageRecords.push({
                        pageIndex: page.pageIndex,
                        totalPages: page.totalPages,
                        sourceCharacters: page.content.length,
                        nonEmpty: page.content.trim().length > 0
                            && (render.bodyEl.textContent ?? "").trim().length > 0,
                        fits: render.fits(),
                        usedPlainTextFallback: render.usedPlainTextFallback,
                        sanitizationIssueCount: render.sanitizationIssues.length,
                        selectedCount: inspection.selectedCount,
                        expectedDefinitionCount,
                        definitionCount: inspection.definitionCount,
                        unresolvedReferences: inspection.unresolvedReferences,
                        selectionContractPass,
                    });
                } finally {
                    render?.cleanup();
                    host.remove();
                }
            }

            const sequenceCorrect = lightScenario!.pages.every(
                (page, index) => page.pageIndex === index,
            );
            const baselineLightPagesMatch = baselineScenario.pages.length === lightScenario!.pages.length
                && baselineScenario.pages.every((page, index) => {
                    const lightPage = lightScenario!.pages[index]!;
                    return page.pageIndex === lightPage.pageIndex
                        && page.totalPages === lightPage.totalPages
                        && page.content === lightPage.content
                        && JSON.stringify(page.renderPlan) === JSON.stringify(lightPage.renderPlan);
                });
            const totalPagesCorrect = lightScenario!.pages.length > 1
                && lightScenario!.pages.every((page) => page.totalPages === lightScenario!.pages.length);
            const sourceEndsWithFinalSentence = lightScenario!.pages.at(-1)
                ?.content.includes("pagination must not drop this sentence") ?? false;
            const firstOverflowIndex = pageRecords.findIndex((record) => !record.fits);
            const criticalPageIndex = firstOverflowIndex >= 0
                ? firstOverflowIndex
                : Math.floor((lightScenario!.pages.length - 1) / 2);
            const savedPageIndexes = [0, criticalPageIndex, lightScenario!.pages.length - 1]
                .filter((value, index, values) => values.indexOf(value) === index);

            for (const pageIndex of savedPageIndexes) {
                const baseline = await this.capturePage(
                    baselineScenario,
                    pageIndex,
                    `long-edge-light-baseline-p${pageIndex + 1}.png`,
                );
                const light = await this.capturePage(
                    lightScenario,
                    pageIndex,
                    `long-edge-light-light-p${pageIndex + 1}.png`,
                );
                const render = await lightScenario!.renderer.renderPage(
                    lightScenario!.pages[pageIndex]!,
                    lightScenario!.appearance,
                );
                try {
                    const inspection = inspectShareCardLightPrint(render.cardEl, render.bodyEl);
                    const expectedDefinitionCount = inspection.selectedCount > 0 ? 1 : 0;
                    const evaluation = comparisonRecord(
                        baseline.pixels,
                        light.pixels,
                        selectedRects(render),
                        protectedRects(render),
                        inspection.selectedCount > 0,
                    );
                    // A no-heading page must be byte-identical, not merely have
                    // no changes outside a heading rectangle.
                    const exactUnchanged = inspection.selectedCount === 0
                        && evaluation.changedPixelCount === 0;
                    comparisons.push({
                        pageIndex,
                        selectedCount: inspection.selectedCount,
                        expectedDefinitionCount,
                        definitionCount: inspection.definitionCount,
                        exactUnchanged,
                        ...evaluation,
                    });
                } finally {
                    render.cleanup();
                }
            }
            const pass = lightScenario!.pages.length > 1
                && sequenceCorrect
                && baselineLightPagesMatch
                && totalPagesCorrect
                && sourceEndsWithFinalSentence
                && pageRecords.every((record) => record.nonEmpty
                    && record.fits
                    && record.selectionContractPass)
                && comparisons.every((record) => record.pass
                    && record.definitionCount === record.expectedDefinitionCount
                    && (record.selectedCount === 0
                        ? record.exactUnchanged
                        : record.selectedRegionChangedPixelCount > 0));
            return {
                batchFontSize: lightScenario!.appearance.fontSize ?? 16,
                pageCount: lightScenario!.pages.length,
                pages: pageRecords,
                baselineLightPagesMatch,
                sequenceCorrect,
                totalPagesCorrect,
                sourceEndsWithFinalSentence,
                criticalPageIndex,
                savedPageIndexes,
                baselineToLightByPage: comparisons,
                pass,
            };
        } finally {
            await this.closeScenario(baselineScenario);
            await this.closeScenario(lightScenario);
        }
    }

    private async runExplicit14pxCase(): Promise<ExplicitFontRecord> {
        let baselineScenario: PreparedScenario | null = null;
        let lightScenario: PreparedScenario | null = null;
        try {
            baselineScenario = await this.prepareScenario("short-zh", "light", false);
            lightScenario = await this.prepareScenario("short-zh", "light", true);
            const appearance = { ...lightScenario!.appearance, fontSize: 14 };
            const baseline = await this.capturePage(
                baselineScenario,
                0,
                "explicit-14px-baseline.png",
                appearance,
            );
            const light = await this.capturePage(
                lightScenario,
                0,
                "explicit-14px-light.png",
                appearance,
            );
            const render = await lightScenario!.renderer.renderPage(
                lightScenario!.pages[0]!,
                appearance,
            );
            let comparison: PixelComparisonRecord;
            try {
                comparison = comparisonRecord(
                    baseline.pixels,
                    light.pixels,
                    selectedRects(render),
                    protectedRects(render),
                    true,
                );
            } finally {
                render.cleanup();
            }
            return {
                fontSize: 14,
                fitsBaseline: baseline.fits,
                fitsLight: light.fits,
                baselinePath: baseline.path,
                lightPath: light.path,
                comparison,
                pass: comparison.pass && baseline.fits && light.fits,
            };
        } finally {
            await this.closeScenario(baselineScenario);
            await this.closeScenario(lightScenario);
        }
    }

    private async runConcurrencyCheck(): Promise<ConcurrencyRecord> {
        let scenario: PreparedScenario | null = null;
        const hosts: HTMLElement[] = [];
        let first: ShareCardRenderHandle | null = null;
        let second: ShareCardRenderHandle | null = null;
        try {
            scenario = await this.prepareScenario("long-edge", "light", true);
            const ownerDocument = scenario.modal.contentEl.ownerDocument;
            for (let index = 0; index < 2; index += 1) {
                const host = ownerDocument.createElement("div");
                host.classList.add("pa-share-card-capture-host");
                ownerDocument.body?.appendChild(host);
                hosts.push(host);
            }
            [first, second] = await Promise.all([
                scenario.renderer.renderPage(scenario.pages[0]!, {
                    ...scenario.appearance,
                    host: hosts[0]!,
                }),
                scenario.renderer.renderPage(scenario.pages[0]!, {
                    ...scenario.appearance,
                    host: hosts[1]!,
                }),
            ]);
            const firstInspection = inspectShareCardLightPrint(first.cardEl, first.bodyEl);
            const secondInspection = inspectShareCardLightPrint(second.cardEl, second.bodyEl);
            const unresolvedReferences = [
                ...firstInspection.unresolvedReferences,
                ...secondInspection.unresolvedReferences,
            ];
            return {
                firstFilterId: firstInspection.filterIds[0] ?? null,
                secondFilterId: secondInspection.filterIds[0] ?? null,
                idsDiffer: (firstInspection.filterIds[0] ?? "") !== (secondInspection.filterIds[0] ?? ""),
                firstDefinitionCount: firstInspection.definitionCount,
                secondDefinitionCount: secondInspection.definitionCount,
                unresolvedReferences,
                pass: firstInspection.definitionCount === 1
                    && secondInspection.definitionCount === 1
                    && (firstInspection.filterIds[0] ?? "") !== (secondInspection.filterIds[0] ?? "")
                    && unresolvedReferences.length === 0,
            };
        } finally {
            first?.cleanup();
            second?.cleanup();
            for (const host of hosts) host.remove();
            await this.closeScenario(scenario);
        }
    }

    private async writeMatrixReport(report: ShareCardLightPrintMatrixReport): Promise<void> {
        const serializable = JSON.parse(JSON.stringify(report, (_key, value) => {
            if (value instanceof Uint8ClampedArray || value instanceof Uint8Array) return undefined;
            return value;
        })) as ShareCardLightPrintMatrixReport;
        const path = `${await this.getOutputFolder()}/r4-matrix-report.json`;
        try {
            await this.app.vault.createBinary(path, new TextEncoder().encode(JSON.stringify(serializable, null, 2)));
        } catch {
            // The in-memory return value remains available when the report file already exists.
        }
    }
}

export function createProbe(app: App): ShareCardLightPrintProbeController {
    return new ShareCardLightPrintProbeController(app);
}

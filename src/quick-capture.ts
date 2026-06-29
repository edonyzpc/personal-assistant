import { App, Modal, Notice, TFile, normalizePath } from "obsidian";

import { validateAppendConfinement, validateTargetConfinementSync } from "./ai-services/write-action-framework/target-confinement";

export const QUICK_CAPTURE_COMMAND_ID = "pa-quick-capture";
export const QUICK_CAPTURE_COMMAND_NAME = "PA: Quick Capture";

export type QuickCaptureDestination = "daily" | "inbox" | "current-file";

export interface QuickCaptureSettings {
    enabled: boolean;
    destination: QuickCaptureDestination;
    inboxPath: string;
    postProcessingEnabled: boolean;
    postProcessingDisclosureAccepted: boolean;
}

export const QUICK_CAPTURE_DEFAULTS: Readonly<QuickCaptureSettings> = Object.freeze({
    enabled: true,
    destination: "daily",
    inboxPath: "Inbox/Quick Capture.md",
    postProcessingEnabled: false,
    postProcessingDisclosureAccepted: false,
});

export interface QuickCaptureRuntimeSettings {
    targetPath: string;
    fileFormat: string;
    quickCapture?: Partial<QuickCaptureSettings>;
}

export interface QuickCaptureCopy {
    modalTitle: string;
    modalPlaceholder: string;
    save: string;
    cancel: string;
    savedDaily: string;
    savedInbox: string;
    savedCurrentFile: string;
    saveFailed: string;
}

export interface QuickCaptureHost {
    app: App;
    settings: QuickCaptureRuntimeSettings;
    formatDate(format: string): string;
    now(): Date;
    log(message: string, ...args: unknown[]): void;
    draft?: QuickCaptureDraftStore;
    postProcessCapture?(input: QuickCapturePostProcessInput): Promise<void> | void;
}

export interface QuickCaptureDraftStore {
    get(): string;
    set(value: string): void;
    clear(): void;
}

export type QuickCaptureResult =
    | { status: "empty" }
    | { status: "saved"; destination: QuickCaptureDestination; path: string; captureId: string };

export interface QuickCapturePostProcessInput {
    captureId: string;
    rawText: string;
    entry: string;
    destination: QuickCaptureDestination;
    path: string;
    capturedAt: string;
}

export interface QuickCaptureCaptureOptions {
    postProcess?: boolean;
}

const DESTINATIONS: readonly QuickCaptureDestination[] = ["daily", "inbox", "current-file"];
const QUICK_CAPTURE_MAX_PATH_LENGTH = 400;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

export function normalizeQuickCaptureDestination(value: unknown): QuickCaptureDestination {
    return DESTINATIONS.includes(value as QuickCaptureDestination)
        ? value as QuickCaptureDestination
        : QUICK_CAPTURE_DEFAULTS.destination;
}

export function normalizeQuickCaptureInboxPath(value: unknown): string {
    const raw = typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : QUICK_CAPTURE_DEFAULTS.inboxPath;
    const withExtension = raw.toLowerCase().endsWith(".md") ? raw : `${raw}.md`;
    const normalized = normalizePath(withExtension).replace(/^\.\//, "");
    return normalized === "." || normalized === "" ? QUICK_CAPTURE_DEFAULTS.inboxPath : normalized;
}

export function mergeQuickCaptureSettings(loaded: unknown): QuickCaptureSettings {
    const loadedObject = isRecord(loaded) ? loaded : {};
    return {
        enabled: typeof loadedObject.enabled === "boolean"
            ? loadedObject.enabled
            : QUICK_CAPTURE_DEFAULTS.enabled,
        destination: normalizeQuickCaptureDestination(loadedObject.destination),
        inboxPath: normalizeQuickCaptureInboxPath(loadedObject.inboxPath),
        postProcessingEnabled: typeof loadedObject.postProcessingEnabled === "boolean"
            ? loadedObject.postProcessingEnabled
            : QUICK_CAPTURE_DEFAULTS.postProcessingEnabled,
        postProcessingDisclosureAccepted: typeof loadedObject.postProcessingDisclosureAccepted === "boolean"
            ? loadedObject.postProcessingDisclosureAccepted
            : QUICK_CAPTURE_DEFAULTS.postProcessingDisclosureAccepted,
    };
}

function quickCaptureHash(text: string): string {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

export function buildQuickCaptureId(rawText: string, timestamp: Date): string {
    return `qc-${timestamp.getTime().toString(36)}-${quickCaptureHash(rawText).slice(0, 8)}`;
}

function ensureMarkdownExtension(path: string): string {
    return path.toLowerCase().endsWith(".md") ? path : `${path}.md`;
}

function normalizeVaultFolder(path: string): string {
    const normalized = normalizePath(String(path ?? "").trim()).replace(/^\.\//, "");
    return normalized === "." || normalized === "/" ? "" : normalized;
}

function joinVaultPath(folder: string, filePath: string): string {
    const normalizedFolder = normalizeVaultFolder(folder);
    const normalizedFile = normalizePath(filePath).replace(/^\.\//, "");
    if (!normalizedFolder) return normalizePath(normalizedFile);
    return normalizePath(`${normalizedFolder}/${normalizedFile}`);
}

export function buildQuickCaptureDailyPath(targetPath: string, formattedDate: string): string {
    const safeName = formattedDate.trim().length > 0 ? formattedDate.trim() : "Quick Capture";
    return joinVaultPath(targetPath, ensureMarkdownExtension(safeName));
}

function formatTime(timestamp: Date): string {
    const hh = String(timestamp.getHours()).padStart(2, "0");
    const mm = String(timestamp.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}

function fenceForText(text: string): string {
    const longest = text.match(/`+/g)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0;
    return "`".repeat(Math.max(3, longest + 1));
}

export function buildQuickCaptureEntry(rawText: string, timestamp: Date): string {
    const time = formatTime(timestamp);
    if (!rawText.includes("\n")) {
        return `- ${time} ${rawText}`;
    }
    const fence = fenceForText(rawText);
    const body = rawText.endsWith("\n") ? rawText : `${rawText}\n`;
    return `- ${time}\n${fence}text\n${body}${fence}`;
}

function appendEntry(existingContent: string, entry: string): string {
    if (existingContent.length === 0) return `${entry}\n`;
    const separator = existingContent.endsWith("\n\n")
        ? ""
        : existingContent.endsWith("\n")
            ? "\n"
            : "\n\n";
    return `${existingContent}${separator}${entry}\n`;
}

function parentFolder(path: string): string {
    const slash = path.lastIndexOf("/");
    return slash > 0 ? path.slice(0, slash) : "";
}

function validateQuickCaptureVaultPath(path: string): string {
    const result = validateTargetConfinementSync(path, {
        allowedRoots: [path],
        allowedExtensions: [".md"],
        allowMissingParent: true,
        maxPathLength: QUICK_CAPTURE_MAX_PATH_LENGTH,
    });
    if (!result.ok) {
        throw new Error(`Quick Capture target is not allowed: ${result.reason}`);
    }
    return result.normalizedPath;
}

async function ensureFolder(app: App, folder: string): Promise<void> {
    if (!folder) return;
    const segments = folder.split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
        current = current ? `${current}/${segment}` : segment;
        const existing = app.vault.getAbstractFileByPath(current);
        if (existing || await app.vault.adapter.exists(current)) continue;
        await app.vault.createFolder(current);
    }
}

async function appendToVaultPath(app: App, path: string, entry: string): Promise<string> {
    const normalizedPath = validateQuickCaptureVaultPath(path);
    const file = app.vault.getAbstractFileByPath(normalizedPath);
    if (file instanceof TFile) {
        const existing = await app.vault.read(file);
        await app.vault.modify(file, appendEntry(existing, entry));
        return normalizedPath;
    }
    if (file) {
        throw new Error(`Quick Capture target is not a Markdown file: ${normalizedPath}`);
    }
    await ensureFolder(app, parentFolder(normalizedPath));
    await app.vault.create(normalizedPath, `${entry}\n`);
    return normalizedPath;
}

function getCurrentQuickCaptureFile(app: App): TFile {
    const activeFile = app.workspace.getActiveFile();
    const validation = validateAppendConfinement(activeFile);
    if (!validation.valid) {
        throw new Error(validation.reason);
    }
    return validation.file;
}

async function appendToCurrentFile(app: App, file: TFile, entry: string): Promise<string> {
    const existing = await app.vault.read(file);
    await app.vault.modify(file, appendEntry(existing, entry));
    return file.path;
}

function savedMessage(copy: QuickCaptureCopy, destination: QuickCaptureDestination): string {
    if (destination === "inbox") return copy.savedInbox;
    if (destination === "current-file") return copy.savedCurrentFile;
    return copy.savedDaily;
}

export class QuickCaptureService {
    private readonly appendQueues = new Map<string, Promise<void>>();

    constructor(
        private readonly host: QuickCaptureHost,
        private readonly copy: QuickCaptureCopy,
    ) { }

    openModal(): void {
        new QuickCaptureModal(this.host.app, this.copy, async (text) => {
            await this.captureText(text);
            this.host.draft?.clear();
        }, {
            initialText: this.host.draft?.get() ?? "",
            onChange: (value) => this.host.draft?.set(value),
            onDiscard: () => this.host.draft?.clear(),
        }).open();
    }

    async captureText(rawText: string, options: QuickCaptureCaptureOptions = {}): Promise<QuickCaptureResult> {
        if (rawText.trim().length === 0) {
            return { status: "empty" };
        }

        const settings = mergeQuickCaptureSettings(this.host.settings.quickCapture);
        const timestamp = this.host.now();
        const entry = buildQuickCaptureEntry(rawText, timestamp);
        const captureId = buildQuickCaptureId(rawText, timestamp);
        try {
            if (settings.destination === "current-file") {
                const currentFile = getCurrentQuickCaptureFile(this.host.app);
                const path = await this.withAppendQueue(currentFile.path, () =>
                    appendToCurrentFile(this.host.app, currentFile, entry));
                new Notice(savedMessage(this.copy, settings.destination));
                this.schedulePostProcessing(settings, {
                    captureId,
                    rawText,
                    entry,
                    destination: settings.destination,
                    path,
                    capturedAt: timestamp.toISOString(),
                }, options);
                return { status: "saved", destination: settings.destination, path, captureId };
            }

            const path = settings.destination === "inbox"
                ? normalizeQuickCaptureInboxPath(settings.inboxPath)
                : buildQuickCaptureDailyPath(
                    this.host.settings.targetPath,
                    this.host.formatDate(this.host.settings.fileFormat),
                );
            const normalizedPath = validateQuickCaptureVaultPath(path);
            const savedPath = await this.withAppendQueue(normalizedPath, () =>
                appendToVaultPath(this.host.app, normalizedPath, entry));
            new Notice(savedMessage(this.copy, settings.destination));
            this.schedulePostProcessing(settings, {
                captureId,
                rawText,
                entry,
                destination: settings.destination,
                path: savedPath,
                capturedAt: timestamp.toISOString(),
            }, options);
            return { status: "saved", destination: settings.destination, path: savedPath, captureId };
        } catch (error) {
            this.host.log("Quick Capture save failed", error);
            new Notice(this.copy.saveFailed);
            throw error;
        }
    }

    private async withAppendQueue<T>(targetPath: string, task: () => Promise<T>): Promise<T> {
        const normalizedPath = normalizePath(targetPath).replace(/^\.\//, "");
        const previous = this.appendQueues.get(normalizedPath) ?? Promise.resolve();
        const run = previous.catch(() => undefined).then(task);
        const tail = run.then(() => undefined, () => undefined);
        this.appendQueues.set(normalizedPath, tail);
        try {
            return await run;
        } finally {
            if (this.appendQueues.get(normalizedPath) === tail) {
                this.appendQueues.delete(normalizedPath);
            }
        }
    }

    private schedulePostProcessing(
        settings: QuickCaptureSettings,
        input: QuickCapturePostProcessInput,
        options: QuickCaptureCaptureOptions,
    ): void {
        if (options.postProcess === false) return;
        if (!settings.postProcessingEnabled || !this.host.postProcessCapture) return;
        void Promise.resolve(this.host.postProcessCapture(input)).catch((error) => {
            this.host.log("Quick Capture post-processing failed", error);
        });
    }
}

class QuickCaptureModal extends Modal {
    private inputEl: HTMLTextAreaElement | null = null;
    private closeBehavior: "preserve" | "discard" = "preserve";

    constructor(
        app: App,
        private readonly copy: QuickCaptureCopy,
        private readonly onSubmit: (text: string) => Promise<void>,
        private readonly draft: {
            initialText: string;
            onChange(value: string): void;
            onDiscard(): void;
        },
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        (this as unknown as { modalEl?: HTMLElement }).modalEl?.addClass("pa-quick-capture-modal-shell");
        contentEl.empty();
        contentEl.addClass("pa-quick-capture-modal");
        contentEl.createEl("h2", { text: this.copy.modalTitle });

        const input = contentEl.createEl("textarea", {
            cls: "pa-quick-capture-modal__input",
            attr: {
                placeholder: this.copy.modalPlaceholder,
                rows: "12",
            },
        }) as HTMLTextAreaElement;
        input.value = this.draft.initialText;
        this.inputEl = input;

        const actions = contentEl.createDiv({ cls: "pa-quick-capture-modal__actions" });
        const cancelButton = actions.createEl("button", { text: this.copy.cancel });
        const saveButton = actions.createEl("button", {
            text: this.copy.save,
            cls: "mod-cta",
        });
        let submitting = false;
        const setSubmitting = (value: boolean) => {
            submitting = value;
            input.disabled = value;
            saveButton.disabled = value;
            cancelButton.disabled = value;
            if (value) {
                saveButton.setAttribute("aria-busy", "true");
                saveButton.setAttribute("aria-disabled", "true");
            } else {
                saveButton.removeAttribute("aria-busy");
                saveButton.removeAttribute("aria-disabled");
            }
        };

        const submit = async () => {
            if (submitting) return;
            const value = input.value;
            if (value.trim().length === 0) return;
            setSubmitting(true);
            try {
                await this.onSubmit(value);
                this.closeBehavior = "discard";
                this.close();
            } catch (error) {
                setSubmitting(false);
                throw error;
            }
        };

        input.addEventListener("input", () => {
            this.draft.onChange(input.value);
        });
        input.addEventListener("keydown", (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void submit().catch(() => undefined);
            }
        });
        cancelButton.addEventListener("click", () => {
            this.closeBehavior = "discard";
            this.draft.onDiscard();
            this.close();
        });
        saveButton.addEventListener("click", () => { void submit().catch(() => undefined); });
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    }

    onClose(): void {
        if (this.closeBehavior === "discard") {
            this.draft.onDiscard();
        } else if (this.inputEl) {
            this.draft.onChange(this.inputEl.value);
        }
        this.inputEl = null;
    }
}

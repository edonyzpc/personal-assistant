/**
 * Preview-Confirmation Lifecycle (Gate 2) — framework SDD §2.1.
 *
 * Generalizes the multi-section approval pattern from
 * `src/memory-manager.ts:612-679` (MemoryApprovalModal) into a reusable modal
 * that renders the {@link PreviewSpec} into 5 logical sections and captures a
 * 4-valued {@link ConfirmationOutcome} from the user.
 *
 * Mutex policy (SDD §2.1: "**不允许并发 preview**"):
 *   Concurrent show() calls are **serialized** (FIFO queue) — they wait their
 *   turn instead of being rejected. Pagelet may legitimately schedule multiple
 *   reviews; the user sees one modal at a time, in arrival order.
 *
 * Test seam:
 *   {@link PreviewRenderer} interface is dependency-injectable. Tests pass an
 *   in-memory `StubPreviewRenderer` (see preview-modal.spec.ts) to assert
 *   outcome routing and mutex serialization without booting Obsidian.
 *   Production wires {@link ObsidianPreviewRenderer} which extends Obsidian's
 *   `Modal` class — only exercised in Obsidian integration tests.
 *
 * Outcome mapping (matches SDD §2.1 table):
 *   - "confirmed": primary CTA clicked
 *   - "cancelled": secondary button clicked / ESC / ✕ / click-outside
 *   - "aborted":   external AbortSignal fired (turn cancelled / plugin unload)
 *   - "timeout":   reserved for Operations Agent mode; v1 never emits
 */

import { Component, MarkdownRenderer, Modal, Platform, Setting, type App } from "obsidian";

import type { ConfirmationOutcome, PreviewSpec } from "./types";

/** Content-length threshold for the append size warning (characters). */
const APPEND_SIZE_WARNING_THRESHOLD = 50_000;

/** Captures the user's verdict plus diagnostics for debug emit. */
export interface PreviewShowResult {
    outcome: ConfirmationOutcome;
    /** Section render errors (e.g., markdown render failed) — non-fatal. */
    renderWarnings?: string[];
}

/** DI surface for Gate 2. Production = {@link ObsidianPreviewRenderer}; tests stub. */
export interface PreviewRenderer {
    show(spec: PreviewSpec, options?: PreviewShowOptions): Promise<PreviewShowResult>;
}

export interface PreviewShowOptions {
    /** External cancellation source. When the signal aborts mid-await, outcome = "aborted". */
    signal?: AbortSignal;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutex wrapper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps another PreviewRenderer to serialize concurrent show() calls FIFO.
 * Each call awaits the prior call's completion before invoking the inner
 * renderer. AbortSignal still works while queued: if the signal fires while
 * a call is waiting in the queue, it skips the inner show() entirely.
 */
export function createMutexPreviewRenderer(inner: PreviewRenderer): PreviewRenderer {
    let tail: Promise<unknown> = Promise.resolve();
    return {
        async show(spec: PreviewSpec, options?: PreviewShowOptions): Promise<PreviewShowResult> {
            const myTurn = tail.then(() => undefined, () => undefined);
            let release!: () => void;
            tail = new Promise<void>((resolve) => {
                release = resolve;
            });
            try {
                await myTurn;
                // Skip the inner renderer if we were aborted while queued.
                if (options?.signal?.aborted) {
                    return { outcome: "aborted" };
                }
                return await inner.show(spec, options);
            } finally {
                release();
            }
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Obsidian Modal implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-spec lifecycle: build sections, capture outcome via promise resolution,
 * unwire AbortSignal listener in finally. Generalizes MemoryApprovalModal.
 *
 * Render policy:
 *   - `contentPreview.format === "markdown"`: render through Obsidian's
 *     `MarkdownRenderer.render`. On render failure we fall back to a `<pre>`
 *     text block (SDD §2.1 failure behavior line 212) and surface a
 *     renderWarning to the caller.
 *   - `contentPreview.format === "plain-text"`: always `<pre>` text.
 */
export class WriteActionPreviewModal extends Modal {
    private settled = false;
    private readonly renderHost = new Component();

    constructor(
        app: App,
        private readonly spec: PreviewSpec,
        private readonly onOutcome: (outcome: ConfirmationOutcome, warnings?: string[]) => void,
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("pa-write-action-modal");
        const renderWarnings: string[] = [];

        // Header banner. Keep framework identifiers in debug events, not in
        // ordinary user-facing copy.
        contentEl.createEl("h2", {
            text: "Review this local write",
        });

        // Section 1: Target — operationType → displayPath.
        this.addSection(
            "Target",
            this.spec.target.displayPath,
            "pa-write-action-modal__target",
        );

        // Section 2: Content preview — append-to-current-note has a richer
        // layout with context/divider/content; create-file retains the original
        // single-block markdown/plain-text preview.
        if (this.spec.operationType === "append-to-current-note" && this.spec.appendContext) {
            this.renderAppendPreview(renderWarnings);
        } else {
            this.renderCreateFilePreview(renderWarnings);
        }

        // Section 3: Impact — 3 booleans + byteSize.
        const impactLines = [
            this.spec.impact.usesAiProvider
                ? "This action may contact your configured AI provider."
                : "This save does not call your AI provider.",
            this.spec.impact.usesAiCredits
                ? "This action may use AI credits."
                : "This save does not use AI credits.",
            this.spec.impact.affectsExternalState
                ? "This action may affect external services."
                : "This save only writes to this vault.",
            `Preview size: ${this.spec.contentPreview.byteSize} bytes`,
        ];
        this.addSection("Impact", impactLines.join("\n"), "pa-write-action-modal__impact");

        // Section 4: Risk notes (callout per line). Render even when empty so
        // the user sees an explicit "none" rather than wondering if the
        // section was hidden.
        const riskBody = this.spec.riskNotes.length > 0
            ? this.spec.riskNotes.join("\n")
            : "Source notes are not modified.";
        this.addSection("Risk", riskBody, "pa-write-action-modal__risk");

        // Section 5: Action buttons (CTA + secondary). Labels come from the
        // spec so capabilities can i18n.
        const isMobile = Platform.isMobile;
        new Setting(this.contentEl)
            .addButton((button) => {
                button
                    .setCta()
                    .setButtonText(this.spec.confirmCopy.confirmLabel)
                    .onClick(() => this.resolveWith("confirmed", renderWarnings));
                if (isMobile) {
                    button.buttonEl.disabled = true;
                    setTimeout(() => { button.buttonEl.disabled = false; }, 500);
                }
            })
            .addButton((button) => {
                button
                    .setButtonText(this.spec.confirmCopy.cancelLabel)
                    .onClick(() => this.resolveWith("cancelled", renderWarnings));
            });

        this.renderHost.load();
    }

    onClose(): void {
        this.contentEl.empty();
        this.renderHost.unload();
        // Modal closed without resolving — SDD §2.1 maps ✕ / click-outside / ESC
        // to "cancelled". v1 doesn't emit a distinct "closed" outcome.
        if (!this.settled) {
            this.settled = true;
            this.onOutcome("cancelled");
        }
    }

    /**
     * External resolution path (used by Obsidian renderer to fire "aborted"
     * when an AbortSignal triggers mid-modal).
     */
    forceResolve(outcome: ConfirmationOutcome): void {
        this.resolveWith(outcome);
    }

    private resolveWith(outcome: ConfirmationOutcome, warnings?: string[]): void {
        if (this.settled) return;
        this.settled = true;
        this.onOutcome(outcome, warnings);
        this.close();
    }

    /**
     * Render the original create-file preview layout: a single "Preview"
     * section with markdown or plain-text content.
     */
    private renderCreateFilePreview(renderWarnings: string[]): void {
        const contentBlock = this.contentEl.createDiv({
            cls: "pa-write-action-modal__section pa-write-action-modal__content",
        });
        contentBlock.createDiv({
            cls: "pa-write-action-modal__section-title",
            text: "Preview",
        });
        const body = contentBlock.createDiv({ cls: "pa-write-action-modal__section-body" });
        this.renderContentBody(body, renderWarnings);
    }

    /**
     * Render the append-to-current-note preview layout:
     *   1. Context section — shows the last N lines of the existing note
     *   2. Divider — labeled "Content will be appended after this"
     *   3. Append content — rendered markdown (or plain-text fallback)
     *   4. Size warning — red callout when content exceeds threshold
     *
     * On mobile the context section is collapsed by default with a toggle.
     */
    private renderAppendPreview(renderWarnings: string[]): void {
        const appendContext = this.spec.appendContext!;
        const isMobile = Platform.isMobile;

        const contentBlock = this.contentEl.createDiv({
            cls: "pa-write-action-modal__section pa-write-action-modal__content",
        });
        if (isMobile) {
            contentBlock.addClass("pa-preview-modal-mobile");
        }
        contentBlock.createDiv({
            cls: "pa-write-action-modal__section-title",
            text: "Preview",
        });

        // Context sub-section: existing tail lines.
        const contextSection = contentBlock.createDiv({
            cls: "pa-preview-append-context",
        });
        contextSection.createDiv({
            cls: "pa-write-action-modal__section-title",
            text: "Context",
        });
        const contextBody = contextSection.createDiv({
            cls: "pa-write-action-modal__section-body pa-write-action-modal__section-body--multiline",
        });
        contextBody.setText(
            appendContext.existingTailLines.length > 0
                ? appendContext.existingTailLines.join("\n")
                : "(empty note)",
        );

        // Mobile toggle button for context visibility.
        if (isMobile) {
            let isContextExpanded = false;
            const toggleBtn = contentBlock.createEl("button", {
                cls: "pa-preview-append-context-toggle",
                text: "Show context",
            });
            toggleBtn.addEventListener("click", () => {
                isContextExpanded = !isContextExpanded;
                if (isContextExpanded) {
                    contextSection.addClass("is-expanded");
                    toggleBtn.setText("Hide context");
                } else {
                    contextSection.removeClass("is-expanded");
                    toggleBtn.setText("Show context");
                }
            });
        }

        // Divider line.
        contentBlock.createDiv({
            cls: "pa-write-action-modal__append-divider",
            text: "Content will be appended after this",
        });

        // Append content body.
        const appendBody = contentBlock.createDiv({
            cls: "pa-write-action-modal__section-body pa-write-action-modal__append-body",
        });
        this.renderContentBody(appendBody, renderWarnings);

        // Size warning when content exceeds threshold.
        if (this.spec.contentPreview.body.length > APPEND_SIZE_WARNING_THRESHOLD) {
            contentBlock.createDiv({
                cls: "pa-write-action-modal__append-size-warning",
                text: `Warning: Content is ${this.spec.contentPreview.body.length.toLocaleString()} characters — large appends may affect editor performance.`,
            });
        }
    }

    /**
     * Shared content renderer used by both create-file and append layouts.
     * Delegates to MarkdownRenderer for markdown format; falls back to <pre>
     * for plain-text or when markdown rendering throws.
     */
    private renderContentBody(body: HTMLElement, renderWarnings: string[]): void {
        if (this.spec.contentPreview.format === "markdown") {
            try {
                const renderResult = MarkdownRenderer.render(
                    this.app,
                    this.spec.contentPreview.body,
                    body,
                    this.spec.target.displayPath,
                    this.renderHost,
                ) as unknown;
                if (renderResult instanceof Promise) {
                    renderResult.catch((error: unknown) => {
                        renderWarnings.push(
                            `markdown render failed: ${error instanceof Error ? error.message : String(error)}`,
                        );
                        this.renderPlainTextFallback(body);
                    });
                }
            } catch (error) {
                renderWarnings.push(
                    `markdown render failed: ${error instanceof Error ? error.message : String(error)}`,
                );
                this.renderPlainTextFallback(body);
            }
        } else {
            this.renderPlainTextFallback(body);
        }
    }

    private renderPlainTextFallback(body: HTMLElement): void {
        const pre = body.createEl("pre", { cls: "pa-write-action-modal__plain-text" });
        pre.setText(this.spec.contentPreview.body);
    }

    private addSection(title: string, body: string, extraClass?: string): void {
        const section = this.contentEl.createDiv({
            cls: extraClass
                ? `pa-write-action-modal__section ${extraClass}`
                : "pa-write-action-modal__section",
        });
        section.createDiv({ cls: "pa-write-action-modal__section-title", text: title });
        section.createDiv({
            cls: body.includes("\n")
                ? "pa-write-action-modal__section-body pa-write-action-modal__section-body--multiline"
                : "pa-write-action-modal__section-body",
            text: body,
        });
    }
}

/**
 * Default production renderer. Spawns a {@link WriteActionPreviewModal} per
 * call. Tracks the live modal so an AbortSignal can dismiss it. Must be
 * wrapped with {@link createMutexPreviewRenderer} to enforce serial display.
 */
export class ObsidianPreviewRenderer implements PreviewRenderer {
    private liveModal: WriteActionPreviewModal | null = null;

    constructor(private readonly app: App) {}

    async show(spec: PreviewSpec, options?: PreviewShowOptions): Promise<PreviewShowResult> {
        if (options?.signal?.aborted) {
            return { outcome: "aborted" };
        }
        return new Promise<PreviewShowResult>((resolve) => {
            const cleanup = (): void => {
                this.liveModal = null;
                if (options?.signal) {
                    options.signal.removeEventListener("abort", onAbort);
                }
            };
            const onAbort = (): void => {
                this.liveModal?.forceResolve("aborted");
            };
            const modal = new WriteActionPreviewModal(this.app, spec, (outcome, warnings) => {
                cleanup();
                resolve(warnings && warnings.length > 0
                    ? { outcome, renderWarnings: warnings }
                    : { outcome });
            });
            this.liveModal = modal;
            if (options?.signal) {
                options.signal.addEventListener("abort", onAbort, { once: true });
            }
            try {
                modal.open();
            } catch (error) {
                cleanup();
                resolve({
                    outcome: "aborted",
                    renderWarnings: [
                        `modal mount failed: ${error instanceof Error ? error.message : String(error)}`,
                    ],
                });
            }
        });
    }
}

/**
 * Compose the Obsidian renderer with the mutex in one call. Use this in
 * runtime wiring; tests can compose their own stacks.
 */
export function createDefaultObsidianPreviewRenderer(app: App): PreviewRenderer {
    return createMutexPreviewRenderer(new ObsidianPreviewRenderer(app));
}

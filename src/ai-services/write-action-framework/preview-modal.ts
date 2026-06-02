/**
 * Preview-Confirmation Lifecycle (Gate 2) — framework SDD §2.1.
 *
 * Generalizes the multi-section approval pattern from
 * `src/memory-manager.ts:612-679` (MemoryApprovalModal) into a reusable modal
 * that renders 5 PreviewSpec sections and captures a 4-valued
 * {@link ConfirmationOutcome} from the user.
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
 * Outcome mapping (matches Step 0 ConfirmationOutcome enum):
 *   - "confirmed": primary CTA clicked
 *   - "cancelled": secondary button clicked
 *   - "closed":    modal closed via X / ESC / click-outside (no explicit button)
 *   - "aborted":   external AbortSignal fired (turn cancelled / plugin unload)
 */

import { Modal, Setting, type App } from "obsidian";

import type { ConfirmationOutcome, PreviewSpec } from "./types";

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
 */
export class WriteActionPreviewModal extends Modal {
    private settled = false;

    constructor(
        app: App,
        private readonly spec: PreviewSpec,
        private readonly onOutcome: (outcome: ConfirmationOutcome) => void,
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("pa-write-action-modal");

        // Header banner: action family + capability id from spec.target.category.
        contentEl.createEl("h2", { text: `Write action: ${this.spec.target.category}` });

        // Section 1: Target — high-visibility path display.
        this.addSection("Target", this.spec.target.path, "pa-write-action-modal__target");
        // Section 2: Impact — what side effects this incurs.
        this.addSection("Impact", this.spec.impact, "pa-write-action-modal__impact");
        // Section 3: Risk — caller-curated warning text.
        this.addSection("Risk", this.spec.risk, "pa-write-action-modal__risk");
        // Section 4: Action — what will happen on confirm.
        this.addSection("Action", this.spec.action, "pa-write-action-modal__action");
        // Section 5: Content preview — full markdown body (rendered as text in v1;
        // future iteration may swap to MarkdownRenderer.render once a Component
        // host is wired here).
        const contentBlock = contentEl.createDiv({ cls: "pa-write-action-modal__content" });
        contentBlock.createDiv({ cls: "pa-write-action-modal__section-title", text: "Preview" });
        const body = contentBlock.createDiv({ cls: "pa-write-action-modal__section-body" });
        body.setText(this.spec.contentMarkdown);

        new Setting(contentEl)
            .addButton((button) => {
                button
                    .setCta()
                    .setButtonText("Confirm")
                    .onClick(() => this.resolveWith("confirmed"));
            })
            .addButton((button) => {
                button
                    .setButtonText("Cancel")
                    .onClick(() => this.resolveWith("cancelled"));
            });
    }

    onClose(): void {
        this.contentEl.empty();
        // Modal closed without resolving — must report a non-confirmed outcome.
        if (!this.settled) {
            this.settled = true;
            this.onOutcome("closed");
        }
    }

    /**
     * External resolution path (used by Obsidian renderer to fire "aborted"
     * when an AbortSignal triggers mid-modal).
     */
    forceResolve(outcome: ConfirmationOutcome): void {
        this.resolveWith(outcome);
    }

    private resolveWith(outcome: ConfirmationOutcome): void {
        if (this.settled) return;
        this.settled = true;
        this.onOutcome(outcome);
        this.close();
    }

    private addSection(title: string, body: string, extraClass?: string): void {
        const section = this.contentEl.createDiv({
            cls: extraClass
                ? `pa-write-action-modal__section ${extraClass}`
                : "pa-write-action-modal__section",
        });
        section.createDiv({ cls: "pa-write-action-modal__section-title", text: title });
        section.createDiv({ cls: "pa-write-action-modal__section-body", text: body });
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
            const modal = new WriteActionPreviewModal(this.app, spec, (outcome) => {
                cleanup();
                resolve({ outcome });
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

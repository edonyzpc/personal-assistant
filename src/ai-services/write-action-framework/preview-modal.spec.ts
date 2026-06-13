import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * Per-suite obsidian mock: provides a richer Modal + Setting than the project's
 * shared `__mocks__/obsidian.ts`, so we can assert section rendering and button
 * wiring without booting a real Obsidian app. Pattern lifted from
 * `__tests__/memory-manager.test.ts`.
 */
type SettingButton = { text?: string; cta?: boolean; click?: () => void };
const mockSettingGroups: SettingButton[][] = [];

// Use `any` to dodge jest.Mock<UnknownFunction> strict-typing for arbitrary
// signatures — same pattern as __tests__/memory-manager.test.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockEl = any;

function createEl(): MockEl {
    const el = {
        children: [] as MockEl[],
        text: "",
        cls: "",
    } as MockEl;
    el.addClass = jest.fn((cls?: unknown) => {
        if (typeof cls === "string") el.cls = el.cls ? `${el.cls} ${cls}` : cls;
    });
    el.empty = jest.fn(() => {
        el.children.length = 0;
        el.text = "";
    });
    el.setText = jest.fn((text: unknown) => {
        el.text = typeof text === "string" ? text : String(text ?? "");
    });
    el.createEl = jest.fn((tag: unknown, options?: unknown) => {
        const opts = (options ?? {}) as { text?: string; cls?: string };
        const child = createEl();
        child.tag = typeof tag === "string" ? tag : "";
        if (opts.text) child.text = opts.text;
        if (opts.cls) child.cls = opts.cls;
        el.children.push(child);
        return child;
    });
    el.createDiv = jest.fn((options?: unknown) => {
        const opts = (options ?? {}) as { text?: string; cls?: string };
        const child = createEl();
        if (opts.text) child.text = opts.text;
        if (opts.cls) child.cls = opts.cls;
        el.children.push(child);
        return child;
    });
    return el;
}

function flattenSubtree(root: MockEl): MockEl[] {
    const out: MockEl[] = [];
    const stack: MockEl[] = [root];
    while (stack.length > 0) {
        const node = stack.pop();
        if (!node) continue;
        out.push(node);
        for (const child of (node.children ?? []) as MockEl[]) {
            stack.push(child);
        }
    }
    return out;
}

const markdownRenderCalls: Array<{ markdown: string; sourcePath: string }> = [];

jest.mock("obsidian", () => ({
    Modal: class {
        app: unknown;
        contentEl: MockEl = createEl();
        constructor(app: unknown) {
            this.app = app;
        }
        open(): void {
            (this as unknown as { onOpen: () => void }).onOpen();
        }
        close(): void {
            (this as unknown as { onClose: () => void }).onClose();
        }
        onOpen(): void {}
        onClose(): void {}
    },
    Setting: class {
        private readonly buttons: SettingButton[] = [];
        constructor(_container: unknown) {
            mockSettingGroups.push(this.buttons);
        }
        addButton(cb: (b: {
            setCta: () => unknown;
            setButtonText: (t: string) => unknown;
            onClick: (fn: () => void) => unknown;
        }) => void): this {
            const record: SettingButton = {};
            this.buttons.push(record);
            const btn = {
                setCta: () => {
                    record.cta = true;
                    return btn;
                },
                setButtonText: (text: string) => {
                    record.text = text;
                    return btn;
                },
                onClick: (fn: () => void) => {
                    record.click = fn;
                    return btn;
                },
            };
            cb(btn);
            return this;
        }
    },
    Component: class {
        load(): void {}
        unload(): void {}
    },
    MarkdownRenderer: {
        render: jest.fn(
            (_app: unknown, markdown: string, el: MockEl, sourcePath: string) => {
                markdownRenderCalls.push({ markdown, sourcePath });
                el.setText?.(markdown);
            },
        ),
    },
}));

// IMPORTANT: imports MUST come after jest.mock so the mock is wired before the
// preview-modal module pulls in obsidian.
import {
    createMutexPreviewRenderer,
    ObsidianPreviewRenderer,
    WriteActionPreviewModal,
    type PreviewRenderer,
} from "./preview-modal";
import type { ConfirmationOutcome, PreviewSpec } from "./types";

function buildSpec(overrides: Partial<PreviewSpec> = {}): PreviewSpec {
    return {
        operationType: "create-file",
        actionFamily: "pagelet-review-note",
        capabilityId: "pagelet.write_review_output",
        target: {
            kind: "vault-path",
            displayPath: ".pagelet/2026-06-02-meeting.md",
            folder: ".pagelet/",
            filename: "2026-06-02-meeting.md",
        },
        contentPreview: {
            format: "markdown",
            body: "# Heading\n\n- bullet\n- bullet",
            byteSize: 28,
        },
        impact: {
            usesAiProvider: false,
            usesAiCredits: false,
            affectsExternalState: false,
        },
        riskNotes: [],
        confirmCopy: { confirmLabel: "Adopt", cancelLabel: "Cancel" },
        ...overrides,
    };
}

beforeEach(() => {
    mockSettingGroups.length = 0;
    markdownRenderCalls.length = 0;
});

describe("WriteActionPreviewModal (PreviewSpec section rendering)", () => {
    it("renders Target/Preview/Impact/Risk sections + header on open", () => {
        const outcomes: ConfirmationOutcome[] = [];
        const modal = new WriteActionPreviewModal({} as never, buildSpec(), (o) => outcomes.push(o));
        modal.onOpen();
        // `contentEl` is typed as HTMLElement by Obsidian's Modal but is actually
        // our MockEl at runtime (per jest.mock above) — cast for inspection.
        const contentEl = (modal as unknown as { contentEl: MockEl }).contentEl;
        const titles = flattenSubtree(contentEl)
            .filter((c: MockEl) =>
                typeof c.cls === "string"
                && c.cls.includes("pa-write-action-modal__section-title"),
            )
            .map((c: MockEl) => c.text);
        expect(titles).toEqual(
            expect.arrayContaining(["Target", "Preview", "Impact", "Risk"]),
        );
        // Header is user-facing copy; framework ids stay in debug events.
        const header = flattenSubtree(contentEl).find((c: MockEl) => c.tag === "h2");
        expect(header?.text).toBe("Review this local write");
        const renderedText = flattenSubtree(contentEl)
            .map((c: MockEl) => c.text)
            .filter(Boolean)
            .join("\n");
        expect(renderedText).not.toContain("pagelet.write_review_output");
        expect(renderedText).not.toContain("usesAiProvider");
        expect(renderedText).toContain("Source notes are not modified.");
    });

    it("uses MarkdownRenderer.render when contentPreview.format=markdown", () => {
        const outcomes: ConfirmationOutcome[] = [];
        const modal = new WriteActionPreviewModal({} as never, buildSpec(), (o) => outcomes.push(o));
        modal.onOpen();
        expect(markdownRenderCalls).toHaveLength(1);
        expect(markdownRenderCalls[0].markdown).toContain("# Heading");
        expect(markdownRenderCalls[0].sourcePath).toBe(".pagelet/2026-06-02-meeting.md");
    });

    it("renders <pre> fallback when contentPreview.format=plain-text", () => {
        const outcomes: ConfirmationOutcome[] = [];
        const spec = buildSpec({
            contentPreview: { format: "plain-text", body: "Plain text body", byteSize: 15 },
        });
        const modal = new WriteActionPreviewModal({} as never, spec, (o) => outcomes.push(o));
        modal.onOpen();
        expect(markdownRenderCalls).toHaveLength(0);
        const contentEl = (modal as unknown as { contentEl: MockEl }).contentEl;
        const pre = flattenSubtree(contentEl).find(
            (c: MockEl) => c.tag === "pre" && typeof c.text === "string" && c.text.includes("Plain text body"),
        );
        expect(pre).toBeDefined();
    });

    it("uses confirmCopy.confirmLabel/cancelLabel for buttons", () => {
        const outcomes: ConfirmationOutcome[] = [];
        const spec = buildSpec({
            confirmCopy: { confirmLabel: "采纳", cancelLabel: "取消" },
        });
        const modal = new WriteActionPreviewModal({} as never, spec, (o) => outcomes.push(o));
        modal.onOpen();
        const buttons = mockSettingGroups.flat();
        expect(buttons.map((b) => b.text)).toEqual(["采纳", "取消"]);
        expect(buttons[0].cta).toBe(true);
        buttons[0].click?.();
        expect(outcomes).toEqual(["confirmed"]);
    });

    it("captures cancelled outcome via secondary button", () => {
        const outcomes: ConfirmationOutcome[] = [];
        const modal = new WriteActionPreviewModal({} as never, buildSpec(), (o) => outcomes.push(o));
        modal.onOpen();
        const buttons = mockSettingGroups.flat();
        buttons[1].click?.();
        expect(outcomes).toEqual(["cancelled"]);
    });

    it("maps onClose (✕ / click-outside / ESC) to cancelled per SDD §2.1", () => {
        const outcomes: ConfirmationOutcome[] = [];
        const modal = new WriteActionPreviewModal({} as never, buildSpec(), (o) => outcomes.push(o));
        modal.onOpen();
        modal.onClose();
        expect(outcomes).toEqual(["cancelled"]);
    });

    it("captures aborted outcome via forceResolve (external signal)", () => {
        const outcomes: ConfirmationOutcome[] = [];
        const modal = new WriteActionPreviewModal({} as never, buildSpec(), (o) => outcomes.push(o));
        modal.onOpen();
        modal.forceResolve("aborted");
        expect(outcomes).toEqual(["aborted"]);
    });

    it("does not double-resolve when onClose runs after a button click", () => {
        const outcomes: ConfirmationOutcome[] = [];
        const modal = new WriteActionPreviewModal({} as never, buildSpec(), (o) => outcomes.push(o));
        modal.onOpen();
        const buttons = mockSettingGroups.flat();
        buttons[0].click?.(); // settles to "confirmed", which calls close() → onClose()
        modal.onClose(); // simulate a late onClose
        expect(outcomes).toEqual(["confirmed"]);
    });
});

describe("ObsidianPreviewRenderer (Obsidian-backed renderer)", () => {
    it("resolves with the outcome reported by the underlying modal", async () => {
        const renderer = new ObsidianPreviewRenderer({} as never);
        const showPromise = renderer.show(buildSpec());
        // After show(), buttons should be available via the latest mockSettingGroups entry.
        // The modal's open() ran inside the Promise constructor, so just click the CTA.
        const buttons = mockSettingGroups.flat();
        buttons[0].click?.();
        await expect(showPromise).resolves.toEqual({ outcome: "confirmed" });
    });

    it("returns aborted immediately if signal already aborted at show()", async () => {
        const renderer = new ObsidianPreviewRenderer({} as never);
        const controller = new AbortController();
        controller.abort();
        await expect(renderer.show(buildSpec(), { signal: controller.signal })).resolves.toEqual({
            outcome: "aborted",
        });
    });

    it("forces aborted when signal fires while modal is open", async () => {
        const renderer = new ObsidianPreviewRenderer({} as never);
        const controller = new AbortController();
        const showPromise = renderer.show(buildSpec(), { signal: controller.signal });
        controller.abort();
        await expect(showPromise).resolves.toEqual({ outcome: "aborted" });
    });
});

describe("createMutexPreviewRenderer (serial mutex)", () => {
    /** A renderer that lets the test resolve each show() call explicitly. */
    function makeControllableRenderer(): {
        renderer: PreviewRenderer;
        inFlight: number;
        pending: Array<(o: ConfirmationOutcome) => void>;
    } {
        const state = {
            renderer: null as unknown as PreviewRenderer,
            inFlight: 0,
            pending: [] as Array<(o: ConfirmationOutcome) => void>,
        };
        state.renderer = {
            show: () => {
                state.inFlight += 1;
                if (state.inFlight > 1) {
                    throw new Error("mutex breach: two concurrent show() calls");
                }
                return new Promise((resolve) => {
                    state.pending.push((outcome) => {
                        state.inFlight -= 1;
                        resolve({ outcome });
                    });
                });
            },
        };
        return state;
    }

    it("serializes concurrent show() calls FIFO", async () => {
        const ctrl = makeControllableRenderer();
        const mutexed = createMutexPreviewRenderer(ctrl.renderer);
        const p1 = mutexed.show(buildSpec());
        const p2 = mutexed.show(buildSpec());
        const p3 = mutexed.show(buildSpec());
        // Only the first should be active.
        await Promise.resolve();
        await Promise.resolve();
        expect(ctrl.pending.length).toBe(1);
        ctrl.pending.shift()?.("confirmed");
        const r1 = await p1;
        expect(r1).toEqual({ outcome: "confirmed" });

        // Second now starts.
        await Promise.resolve();
        await Promise.resolve();
        expect(ctrl.pending.length).toBe(1);
        ctrl.pending.shift()?.("cancelled");
        const r2 = await p2;
        expect(r2).toEqual({ outcome: "cancelled" });

        // Third now starts.
        await Promise.resolve();
        await Promise.resolve();
        expect(ctrl.pending.length).toBe(1);
        ctrl.pending.shift()?.("aborted");
        const r3 = await p3;
        expect(r3).toEqual({ outcome: "aborted" });
    });

    it("returns aborted without invoking inner renderer when signal aborts while queued", async () => {
        const ctrl = makeControllableRenderer();
        const mutexed = createMutexPreviewRenderer(ctrl.renderer);
        const controller = new AbortController();
        const p1 = mutexed.show(buildSpec());
        const p2 = mutexed.show(buildSpec(), { signal: controller.signal });

        // Flush microtasks so p1's `await myTurn` resolves and inner.show() is
        // actually invoked (registering a pending resolver). Without these
        // awaits, the shift() below would no-op (pending is still empty).
        await Promise.resolve();
        await Promise.resolve();
        expect(ctrl.pending.length).toBe(1);

        // p2 is queued behind p1; abort the controller before p1 resolves.
        controller.abort();
        // p1 still pending → resolve it; p2 should then short-circuit to aborted.
        ctrl.pending.shift()?.("confirmed");
        await p1;
        await expect(p2).resolves.toEqual({ outcome: "aborted" });
        // Inner renderer must not have been called for p2.
        expect(ctrl.pending.length).toBe(0);
    });

    it("recovers and continues serving subsequent calls when an inner show() throws", async () => {
        const calls: number[] = [];
        const inner: PreviewRenderer = {
            show: jest.fn(async () => {
                calls.push(calls.length);
                if (calls.length === 1) throw new Error("boom");
                return { outcome: "confirmed" as ConfirmationOutcome };
            }) as PreviewRenderer["show"],
        };
        const mutexed = createMutexPreviewRenderer(inner);
        await expect(mutexed.show(buildSpec())).rejects.toThrow("boom");
        await expect(mutexed.show(buildSpec())).resolves.toEqual({ outcome: "confirmed" });
    });
});

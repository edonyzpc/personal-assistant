jest.mock("../src/share-card/share-card-font", () => ({
    registerShareCardFontFace: jest.fn().mockResolvedValue(undefined),
    unregisterShareCardFontFace: jest.fn(),
}));

import { Notice, type App } from "obsidian";
import {
    ShareCardModal,
    closeAllShareCardModals,
    detectShareCardTheme,
    type ShareCardModalDependencies,
} from "../src/share-card/share-card-modal";
import { ShareCardClipboardUnavailableError } from "../src/share-card/share-card-export";
import type { ShareCardExporter } from "../src/share-card/share-card-export";
import type {
    ShareCardPreparedCompletenessSummary,
    ShareCardRenderer,
} from "../src/share-card/share-card-renderer";
import {
    ShareCardResourceAbortedError,
    type LocalizedShareCardResources,
    type ShareCardResourceContext,
} from "../src/share-card/share-card-resources";
import {
    MAX_SHARE_CARD_CHARACTERS,
    type CardPage,
    type ShareCardData,
} from "../src/share-card/share-card-types";
import {
    ShareCardTestDocument,
    ShareCardTestElement,
    asDocument,
    asElement,
    flushShareCardTasks,
} from "./helpers/share-card-dom";

type NoticeConstructor = typeof Notice & {
    messages: Array<{ message?: unknown; timeout?: number }>;
};

describe("ShareCardModal", () => {
    const notices = (Notice as NoticeConstructor).messages;

    beforeEach(() => {
        notices.length = 0;
    });

    afterEach(() => {
        closeAllShareCardModals();
    });

    it("shows preparing state, renders responsive navigation, and cleans the Modal owner", async () => {
        const document = new ShareCardTestDocument();
        document.documentElement.classList.add("theme-dark");
        let resolvePages!: (pages: CardPage[]) => void;
        const paginate = jest.fn(() => new Promise<CardPage[]>((resolve) => {
            resolvePages = resolve;
        }));
        const renderCleanups: jest.Mock[] = [];
        const renderer = createRenderer(document, renderCleanups);
        const exporter = createExporter();
        const modal = createModal(document, {
            prepareMarkdown: () => ({ markdown: "one\n\ntwo", blocks: ["one", "two"] }),
            paginate,
            createRenderer: () => renderer,
            createExporter: () => exporter,
        });

        modal.onOpen();

        const status = document.body.querySelector(".pa-share-card-status")!;
        const viewport = document.body.querySelector(".pa-share-card-preview-viewport")!;
        const actions = document.body.querySelector(".pa-share-card-actions")!;
        const title = document.body.querySelector("h2")!;
        expect(status.textContent).toContain("Preparing");
        expect(status.getAttribute("role")).toBe("status");
        expect(status.getAttribute("aria-live")).toBe("polite");
        expect((modal.modalEl as unknown as ShareCardTestElement).getAttribute("aria-labelledby"))
            .toBe(title.id);
        expect(viewport.hidden).toBe(true);
        expect(actions.children.every((child) => child.disabled)).toBe(true);
        expect(document.listenerCount("resize")).toBe(1);

        await flushShareCardTasks();
        resolvePages([
            { content: "one", pageIndex: 0, totalPages: 2 },
            { content: "two", pageIndex: 1, totalPages: 2 },
        ]);
        await flushShareCardTasks();

        const scale = document.body.querySelector(".pa-share-card-preview-scale")!;
        const nav = document.body.querySelector(".pa-share-card-nav")!;
        expect(detectShareCardTheme(asDocument(document))).toBe("dark");
        expect(viewport.hidden).toBe(false);
        expect(scale.style.values.get("--pa-share-card-preview-scale")).toBe("1");
        expect(nav.hidden).toBe(false);
        expect(nav.children[0]!.getAttribute("aria-label")).toBeTruthy();
        expect(nav.children[0]!.disabled).toBe(true);
        expect(nav.children[2]!.disabled).toBe(false);
        expect(nav.children[1]!.textContent).toContain("1");
        expect(renderer.renderPage).toHaveBeenLastCalledWith(
            expect.objectContaining({ pageIndex: 0 }),
            expect.objectContaining({ theme: "dark", host: asElement(scale) }),
        );

        nav.children[2]!.click();
        await flushShareCardTasks();
        expect(nav.children[1]!.textContent).toContain("2");
        expect(nav.children[2]!.disabled).toBe(true);

        modal.onClose();
        expect(document.listenerCount("resize")).toBe(0);
        expect(renderer.cleanup).toHaveBeenCalledTimes(1);
        expect(renderCleanups.some((cleanup) => cleanup.mock.calls.length > 0)).toBe(true);
        expect((modal.contentEl as unknown as ShareCardTestElement).children).toHaveLength(0);
    });

    it("scales a narrow preview without changing the fixed render page", async () => {
        const document = new ShareCardTestDocument();
        const renderer = createRenderer(document, []);
        const modal = createModal(document, {
            prepareMarkdown: () => ({ markdown: "one", blocks: ["one"] }),
            paginate: async () => [{ content: "one", pageIndex: 0, totalPages: 1 }],
            createRenderer: () => renderer,
            createExporter: () => createExporter(),
        });

        modal.onOpen();
        const viewport = document.body.querySelector(".pa-share-card-preview-viewport")!;
        viewport.clientWidth = 270;
        await flushShareCardTasks();

        const scale = document.body.querySelector(".pa-share-card-preview-scale")!;
        expect(scale.style.values.get("--pa-share-card-preview-scale")).toBe("0.5");
        expect(scale.style.width).toBe("270px");
        expect(scale.style.height).toBe("360px");
        expect(renderer.renderPage).toHaveBeenCalledWith(
            expect.objectContaining({ content: "one" }),
            expect.objectContaining({ host: asElement(scale) }),
        );
        modal.onClose();
    });

    it("localizes explicit resources with invisible base-path context before pagination", async () => {
        const document = new ShareCardTestDocument();
        const localized: LocalizedShareCardResources = {
            markdown: "![missing](data:image/svg+xml,placeholder)",
            report: {
                complete: false,
                resolvedCount: 0,
                placeholderCount: 1,
                failedCount: 0,
                uniqueResourceCount: 1,
                totalResolvedBytes: 0,
                resources: [{
                    id: "resource-1",
                    kind: "markdown-image",
                    reference: "missing.png",
                    status: "placeholder",
                    failureReason: "resource-not-found",
                }],
            },
        };
        const contexts: ShareCardResourceContext[] = [];
        const localizeResources = jest.fn(async (
            _app: App,
            _markdown: string,
            context: ShareCardResourceContext,
        ) => {
            contexts.push(context);
            return localized;
        });
        const prepareMarkdown = jest.fn(() => ({
            markdown: localized.markdown,
            blocks: [localized.markdown],
        }));
        const paginate = jest.fn(async () => [{
            content: localized.markdown,
            pageIndex: 0,
            totalPages: 1,
        }]);
        const modal = createModal(document, {
            localizeResources: localizeResources as unknown as NonNullable<
                ShareCardModalDependencies["localizeResources"]
            >,
            prepareMarkdown,
            paginate,
            createRenderer: () => createRenderer(document, []),
            createExporter: () => createExporter(),
        });

        modal.onOpen();
        await flushShareCardTasks();

        expect(localizeResources).toHaveBeenCalledWith(
            expect.anything(),
            "share me",
            expect.objectContaining({ resourceBasePath: "source.md" }),
            expect.objectContaining({ placeholderText: expect.any(Function) }),
        );
        expect(contexts[0]?.cache).toBeDefined();
        expect(contexts[0]?.signal?.aborted).toBe(false);
        expect(prepareMarkdown).toHaveBeenCalledWith(localized.markdown);
        expect(paginate).toHaveBeenCalledWith(
            [localized.markdown],
            expect.any(Function),
            { originalCharacterCount: "share me".length },
        );
        const status = document.body.querySelector(".pa-share-card-status")!;
        expect(status.textContent).toContain("placeholder (1)");
        expect(status.dataset.tone).toBe("warning");
        expect(document.body.querySelectorAll("*").some((element) => (
            element.textContent.includes("source.md")
        ))).toBe(false);
        modal.onClose();
    });

    it("keeps a current-page render warning after copy succeeds", async () => {
        const document = new ShareCardTestDocument();
        const copyCurrentPage = jest.fn(async () => undefined);
        const renderer = createRenderer(document, [], {
            pageCompleteness: {
                0: { sanitizationIssueCount: 1, usedPlainTextFallback: false },
            },
        });
        const modal = createModal(document, {
            prepareMarkdown: () => ({ markdown: "one", blocks: ["one"] }),
            paginate: async () => [{ content: "one", pageIndex: 0, totalPages: 1 }],
            createRenderer: () => renderer,
            createExporter: () => createExporter({ copyCurrentPage }),
        });

        modal.onOpen();
        await flushShareCardTasks();
        const status = document.body.querySelector(".pa-share-card-status")!;
        expect(status.textContent).toContain("placeholder (1)");

        document.body.querySelector(".pa-share-card-actions")!.children[0]!.click();
        await flushShareCardTasks();

        expect(copyCurrentPage).toHaveBeenCalledTimes(1);
        expect(notices).toHaveLength(1);
        expect(String(notices[0]!.message)).toContain("copied");
        expect(status.textContent).toContain("placeholder (1)");
        expect(status.textContent).not.toContain("copied");
        expect(status.dataset.tone).toBe("warning");
        modal.onClose();
    });

    it("keeps a non-current prepared-page warning after Save all succeeds", async () => {
        const document = new ShareCardTestDocument();
        const pages = [0, 1].map((pageIndex) => ({
            content: `page ${pageIndex + 1}`,
            pageIndex,
            totalPages: 2,
        }));
        const renderer = createRenderer(document, [], {
            preparedCompleteness: {
                sanitizationIssueCount: 1,
                usedPlainTextFallback: false,
            },
        });
        const savePages = jest.fn(async () => ({
            savedPaths: ["PA-Cards/card-1.png", "PA-Cards/card-2.png"],
            attempted: 2,
        }));
        const modal = createModal(document, {
            prepareMarkdown: () => ({ markdown: "pages", blocks: ["page 1", "page 2"] }),
            paginate: async () => pages,
            createRenderer: () => renderer,
            createExporter: () => createExporter({ savePages }),
        });

        modal.onOpen();
        await flushShareCardTasks();
        expect(renderer.renderPage).toHaveBeenCalledTimes(1);
        expect(renderer.recordPreparedFinalPages).toHaveBeenCalledWith(
            pages,
            expect.objectContaining({ theme: "light" }),
        );

        document.body.querySelector(".pa-share-card-actions")!.children[1]!.click();
        await flushShareCardTasks();

        const status = document.body.querySelector(".pa-share-card-status")!;
        expect(savePages).toHaveBeenCalledWith(pages);
        expect(notices).toHaveLength(1);
        expect(String(notices[0]!.message)).toContain("Images saved: 2");
        expect(status.textContent).toContain("placeholder (1)");
        expect(status.textContent).not.toContain("Images saved");
        expect(status.dataset.tone).toBe("warning");
        modal.onClose();
    });

    it("combines a resource placeholder warning with prepared plain-text fallback", async () => {
        const document = new ShareCardTestDocument();
        const localized: LocalizedShareCardResources = {
            markdown: "localized",
            report: {
                complete: false,
                resolvedCount: 0,
                placeholderCount: 1,
                failedCount: 0,
                uniqueResourceCount: 1,
                totalResolvedBytes: 0,
                resources: [{
                    id: "resource-1",
                    kind: "markdown-image",
                    reference: "missing.png",
                    status: "placeholder",
                    failureReason: "resource-not-found",
                }],
            },
        };
        const renderer = createRenderer(document, [], {
            preparedCompleteness: {
                sanitizationIssueCount: 0,
                usedPlainTextFallback: true,
            },
        });
        const modal = createModal(document, {
            localizeResources: jest.fn(async () => localized) as unknown as NonNullable<
                ShareCardModalDependencies["localizeResources"]
            >,
            prepareMarkdown: () => ({ markdown: localized.markdown, blocks: [localized.markdown] }),
            paginate: async () => [{ content: localized.markdown, pageIndex: 0, totalPages: 1 }],
            createRenderer: () => renderer,
            createExporter: () => createExporter(),
        });

        modal.onOpen();
        await flushShareCardTasks();

        const status = document.body.querySelector(".pa-share-card-status")!;
        expect(status.textContent).toContain("placeholder (1)");
        expect(status.textContent).toContain("Plain text");
        expect(status.dataset.tone).toBe("warning");
        modal.onClose();
    });

    it("aborts pending resource preparation when the Modal closes", async () => {
        const document = new ShareCardTestDocument();
        let preparationSignal: AbortSignal | undefined;
        const localizeResources = jest.fn((
            _app: App,
            _markdown: string,
            context: ShareCardResourceContext,
        ) => {
            preparationSignal = context.signal;
            return new Promise<LocalizedShareCardResources>((_resolve, reject) => {
                context.signal?.addEventListener("abort", () => {
                    reject(new ShareCardResourceAbortedError());
                }, { once: true });
            });
        });
        const modal = createModal(document, {
            localizeResources: localizeResources as unknown as NonNullable<
                ShareCardModalDependencies["localizeResources"]
            >,
            createRenderer: () => createRenderer(document, []),
            createExporter: () => createExporter(),
        });

        modal.onOpen();
        await Promise.resolve();
        expect(preparationSignal?.aborted).toBe(false);
        modal.onClose();
        await flushShareCardTasks();

        expect(preparationSignal?.aborted).toBe(true);
        expect(notices).toHaveLength(0);
    });

    it("enforces exactly-once busy state and ignores completion after close", async () => {
        const document = new ShareCardTestDocument();
        let finishCopy!: () => void;
        const copyCurrentPage = jest.fn(() => new Promise<void>((resolve) => {
            finishCopy = resolve;
        }));
        const exporter = createExporter({ copyCurrentPage });
        const renderer = createRenderer(document, []);
        const modal = createModal(document, {
            prepareMarkdown: () => ({ markdown: "one", blocks: ["one"] }),
            paginate: async () => [{ content: "one", pageIndex: 0, totalPages: 1 }],
            createRenderer: () => renderer,
            createExporter: () => exporter,
        });
        modal.onOpen();
        await flushShareCardTasks();

        const content = modal.contentEl as unknown as ShareCardTestElement;
        const copyButton = document.body.querySelector(".pa-share-card-actions")!.children[0]!;
        copyButton.click();
        copyButton.click();

        expect(copyCurrentPage).toHaveBeenCalledTimes(1);
        expect(content.dataset.busy).toBe("true");
        expect(content.getAttribute("aria-busy")).toBe("true");
        expect(copyButton.getAttribute("aria-busy")).toBe("true");
        expect(document.body.querySelector(".pa-share-card-status")?.textContent)
            .toContain("Copying");

        modal.onClose();
        finishCopy();
        await flushShareCardTasks();
        expect(notices).toHaveLength(0);
    });

    it("announces saving while the export is in progress", async () => {
        const document = new ShareCardTestDocument();
        let finishSave!: (result: {
            savedPaths: string[];
            attempted: number;
        }) => void;
        const savePages = jest.fn(() => new Promise<{
            savedPaths: string[];
            attempted: number;
        }>((resolve) => {
            finishSave = resolve;
        }));
        const modal = createModal(document, {
            prepareMarkdown: () => ({ markdown: "one", blocks: ["one"] }),
            paginate: async () => [{ content: "one", pageIndex: 0, totalPages: 1 }],
            createRenderer: () => createRenderer(document, []),
            createExporter: () => createExporter({ savePages }),
        });
        modal.onOpen();
        await flushShareCardTasks();

        const content = modal.contentEl as unknown as ShareCardTestElement;
        const saveButton = document.body.querySelector(".pa-share-card-actions")!.children[1]!;
        saveButton.click();

        expect(savePages).toHaveBeenCalledTimes(1);
        expect(content.getAttribute("aria-busy")).toBe("true");
        expect(saveButton.getAttribute("aria-busy")).toBe("true");
        expect(document.body.querySelector(".pa-share-card-status")?.textContent)
            .toContain("Saving");

        finishSave({ savedPaths: ["PA-Cards/card.png"], attempted: 1 });
        await flushShareCardTasks();
        expect(content.getAttribute("aria-busy")).toBe("false");
        expect(saveButton.getAttribute("aria-busy")).toBeNull();
        modal.onClose();
    });

    it("copies the navigated current page but saves the complete ordered batch", async () => {
        const document = new ShareCardTestDocument();
        const pages = [0, 1, 2].map((pageIndex) => ({
            content: `page ${pageIndex + 1}`,
            pageIndex,
            totalPages: 3,
        }));
        const copyCurrentPage = jest.fn(async () => undefined);
        const savePages = jest.fn(async (received: readonly CardPage[]) => ({
            savedPaths: received.map((_, index) => `PA-Cards/card-${index + 1}.png`),
            attempted: received.length,
        }));
        const modal = createModal(document, {
            prepareMarkdown: () => ({ markdown: "pages", blocks: ["pages"] }),
            paginate: async () => pages,
            createRenderer: () => createRenderer(document, []),
            createExporter: () => createExporter({ copyCurrentPage, savePages }),
        });
        modal.onOpen();
        await flushShareCardTasks();

        const nav = document.body.querySelector(".pa-share-card-nav")!;
        nav.children[2]!.click();
        await flushShareCardTasks();
        document.body.querySelector(".pa-share-card-actions")!.children[0]!.click();
        await flushShareCardTasks();
        document.body.querySelector(".pa-share-card-actions")!.children[1]!.click();
        await flushShareCardTasks();

        expect(copyCurrentPage).toHaveBeenCalledWith(pages[1]);
        expect(savePages).toHaveBeenCalledWith(pages);
        expect(notices).toHaveLength(2);
        expect(String(notices[0]!.message)).toContain("copied");
        expect(String(notices[1]!.message)).toContain("Images saved: 3");
        expect(document.body.querySelector(".pa-share-card-status")?.textContent).toBe("");
        modal.onClose();
    });

    it("reports one truthful partial result and remains retryable", async () => {
        const document = new ShareCardTestDocument();
        const pages = [0, 1].map((pageIndex) => ({
            content: `page ${pageIndex + 1}`,
            pageIndex,
            totalPages: 2,
        }));
        const savePages = jest.fn()
            .mockResolvedValueOnce({
                savedPaths: ["PA-Cards/card-1.png"],
                attempted: 2,
                failedPageIndex: 1,
            })
            .mockResolvedValueOnce({
                savedPaths: ["PA-Cards/card-1-2.png", "PA-Cards/card-2-2.png"],
                attempted: 2,
            });
        const modal = createModal(document, {
            prepareMarkdown: () => ({ markdown: "pages", blocks: ["pages"] }),
            paginate: async () => pages,
            createRenderer: () => createRenderer(document, []),
            createExporter: () => createExporter({ savePages }),
        });
        modal.onOpen();
        await flushShareCardTasks();

        const saveButton = document.body.querySelector(".pa-share-card-actions")!.children[1]!;
        saveButton.click();
        saveButton.click();
        await flushShareCardTasks();

        expect(savePages).toHaveBeenCalledTimes(1);
        expect(notices).toHaveLength(1);
        expect(String(notices[0]!.message)).toContain("Saved 1 of 2");
        expect(document.body.querySelector(".pa-share-card-status")?.dataset.tone).toBe("error");
        expect(saveButton.disabled).toBe(false);

        saveButton.click();
        await flushShareCardTasks();
        expect(savePages).toHaveBeenCalledTimes(2);
        expect(notices).toHaveLength(2);
        expect(String(notices[1]!.message)).toContain("Images saved: 2");
        modal.onClose();
    });

    it("reports zero-saved and thrown save failures once without stale UI after close", async () => {
        const document = new ShareCardTestDocument();
        let finishClosedSave!: (result: { savedPaths: string[]; attempted: number }) => void;
        const savePages = jest.fn()
            .mockResolvedValueOnce({ savedPaths: [], attempted: 1, failedPageIndex: 0 })
            .mockRejectedValueOnce(new Error("folder unavailable"))
            .mockImplementationOnce(() => new Promise((resolve) => {
                finishClosedSave = resolve;
            }));
        const modal = createModal(document, {
            prepareMarkdown: () => ({ markdown: "one", blocks: ["one"] }),
            paginate: async () => [{ content: "one", pageIndex: 0, totalPages: 1 }],
            createRenderer: () => createRenderer(document, []),
            createExporter: () => createExporter({ savePages }),
        });
        modal.onOpen();
        await flushShareCardTasks();
        const saveButton = document.body.querySelector(".pa-share-card-actions")!.children[1]!;

        saveButton.click();
        await flushShareCardTasks();
        expect(notices).toHaveLength(1);
        expect(String(notices[0]!.message)).toContain("Could not save");

        saveButton.click();
        await flushShareCardTasks();
        expect(notices).toHaveLength(2);
        expect(String(notices[1]!.message)).toContain("Could not save");

        saveButton.click();
        expect(savePages).toHaveBeenCalledTimes(3);
        modal.onClose();
        finishClosedSave({ savedPaths: ["PA-Cards/card.png"], attempted: 1 });
        await flushShareCardTasks();
        expect(notices).toHaveLength(2);
    });

    it("rejects the original input limit before Markdown preprocessing", async () => {
        const document = new ShareCardTestDocument();
        const prepareMarkdown = jest.fn(() => ({ markdown: "short", blocks: ["short"] }));
        const paginate = jest.fn(async () => [{ content: "short", pageIndex: 0, totalPages: 1 }]);
        const modal = createModal(document, {
            prepareMarkdown,
            paginate,
            createRenderer: () => createRenderer(document, []),
            createExporter: () => createExporter(),
        }, {
            content: "x".repeat(MAX_SHARE_CARD_CHARACTERS + 1),
            source: "chat",
        });

        modal.onOpen();
        await flushShareCardTasks();

        expect(prepareMarkdown).not.toHaveBeenCalled();
        expect(paginate).not.toHaveBeenCalled();
        expect(document.body.querySelector(".pa-share-card-status")?.textContent)
            .toContain("too long");
        expect((modal.contentEl as unknown as ShareCardTestElement).getAttribute("aria-busy"))
            .toBe("false");
        modal.onClose();
    });

    it("closes each registered modal exactly once during teardown", async () => {
        const document = new ShareCardTestDocument();
        const dependencies: ShareCardModalDependencies = {
            prepareMarkdown: () => ({ markdown: "one", blocks: ["one"] }),
            paginate: async () => [{ content: "one", pageIndex: 0, totalPages: 1 }],
            createRenderer: () => createRenderer(document, []),
            createExporter: () => createExporter(),
        };
        const first = createModal(document, dependencies);
        const second = createModal(document, dependencies);
        first.onOpen();
        second.onOpen();
        await flushShareCardTasks();
        const firstClose = jest.spyOn(first, "close").mockImplementation(() => first.onClose());
        const secondClose = jest.spyOn(second, "close").mockImplementation(() => second.onClose());

        closeAllShareCardModals();
        closeAllShareCardModals();

        expect(firstClose).toHaveBeenCalledTimes(1);
        expect(secondClose).toHaveBeenCalledTimes(1);
    });

    it("reports clipboard failure without escalating to a Vault save", async () => {
        const document = new ShareCardTestDocument();
        const copyCurrentPage = jest.fn(async () => {
            throw new ShareCardClipboardUnavailableError();
        });
        const savePages = jest.fn();
        const exporter = createExporter({ copyCurrentPage, savePages });
        const renderer = createRenderer(document, []);
        const modal = createModal(document, {
            prepareMarkdown: () => ({ markdown: "one", blocks: ["one"] }),
            paginate: async () => [{ content: "one", pageIndex: 0, totalPages: 1 }],
            createRenderer: () => renderer,
            createExporter: () => exporter,
        });
        modal.onOpen();
        await flushShareCardTasks();

        const copyButton = document.body.querySelector(".pa-share-card-actions")!.children[0]!;
        copyButton.click();
        await flushShareCardTasks();

        expect(copyCurrentPage).toHaveBeenCalledTimes(1);
        expect(savePages).not.toHaveBeenCalled();
        expect(notices).toHaveLength(1);
        expect(String(notices[0]!.message)).toContain("unavailable");
        expect(copyButton.disabled).toBe(false);
        modal.onClose();
    });

    it("reports an unexpected preview failure without an unhandled navigation rejection", async () => {
        const document = new ShareCardTestDocument();
        const renderer = createRenderer(document, []);
        renderer.renderPage.mockRejectedValueOnce(new Error("preview failed"));
        const modal = createModal(document, {
            prepareMarkdown: () => ({ markdown: "one", blocks: ["one"] }),
            paginate: async () => [{ content: "one", pageIndex: 0, totalPages: 1 }],
            createRenderer: () => renderer,
            createExporter: () => createExporter(),
        });

        modal.onOpen();
        await flushShareCardTasks();

        const status = document.body.querySelector(".pa-share-card-status")!;
        const actions = document.body.querySelector(".pa-share-card-actions")!;
        expect(status.textContent).toContain("Could not prepare");
        expect(actions.children.every((child) => child.disabled)).toBe(true);
        modal.onClose();
    });
});

function createModal(
    document: ShareCardTestDocument,
    dependencies: ShareCardModalDependencies,
    data: ShareCardData = {
        content: "share me",
        source: "chat",
        sourceLabel: "PA Chat",
        resourceContext: { basePath: "source.md" },
    },
): ShareCardModal {
    const modal = new ShareCardModal({} as App, data, dependencies);
    const contentEl = document.createElement("div");
    const modalEl = document.createElement("div");
    modalEl.appendChild(contentEl);
    document.body.appendChild(modalEl);
    (modal as unknown as { contentEl: HTMLElement }).contentEl = asElement(contentEl);
    (modal as unknown as { modalEl: HTMLElement }).modalEl = asElement(modalEl);
    return modal;
}

function createRenderer(
    document: ShareCardTestDocument,
    renderCleanups: jest.Mock[],
    completeness: {
        preparedCompleteness?: ShareCardPreparedCompletenessSummary;
        pageCompleteness?: Readonly<Record<number, ShareCardPreparedCompletenessSummary>>;
    } = {},
): ShareCardRenderer & {
    renderPage: jest.Mock;
    cleanup: jest.Mock;
} {
    const renderPage = jest.fn(async (page: CardPage, options: { host?: HTMLElement }) => {
        const card = document.createElement("div");
        card.classList.add("pa-share-card");
        (options.host as unknown as ShareCardTestElement).appendChild(card);
        const cleanup = jest.fn(() => card.remove());
        renderCleanups.push(cleanup);
        const pageCompleteness = completeness.pageCompleteness?.[page.pageIndex] ?? {
            sanitizationIssueCount: 0,
            usedPlainTextFallback: false,
        };
        return {
            cardEl: asElement(card),
            bodyEl: asElement(document.createElement("div")),
            signal: new AbortController().signal,
            sanitizationIssues: Array.from(
                { length: pageCompleteness.sanitizationIssueCount },
                () => ({ tagName: "img", reason: "decode-failed" as const }),
            ),
            usedPlainTextFallback: pageCompleteness.usedPlainTextFallback,
            fits: () => true,
            cleanup,
        };
    });
    return {
        renderPage,
        fits: jest.fn(async () => true),
        recordPreparedFinalPages: jest.fn(),
        getPreparedCompletenessSummary: jest.fn(() => (
            completeness.preparedCompleteness ?? {
                sanitizationIssueCount: 0,
                usedPlainTextFallback: false,
            }
        )),
        cleanup: jest.fn(),
    } as unknown as ShareCardRenderer & {
        renderPage: jest.Mock;
        cleanup: jest.Mock;
    };
}

function createExporter(overrides: Partial<{
    copyCurrentPage: (page: CardPage) => Promise<void>;
    savePages: (pages: readonly CardPage[]) => Promise<{
        savedPaths: string[];
        attempted: number;
        failedPageIndex?: number;
    }>;
}> = {}): ShareCardExporter {
    return {
        canCopyImage: () => true,
        copyCurrentPage: jest.fn(async () => undefined),
        savePages: jest.fn(async (pages: readonly CardPage[]) => ({
            savedPaths: pages.map((_, index) => `PA-Cards/card-${index + 1}.png`),
            attempted: pages.length,
        })),
        ...overrides,
    } as unknown as ShareCardExporter;
}

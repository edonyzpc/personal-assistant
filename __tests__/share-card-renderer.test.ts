import { Component, MarkdownRenderer, type App } from "obsidian";
import {
    ShareCardRenderer,
    ShareCardRenderCancelledError,
} from "../src/share-card/share-card-renderer";
import {
    ShareCardTestDocument,
    asDocument,
    asElement,
} from "./helpers/share-card-dom";

describe("ShareCardRenderer", () => {
    const renderMock = MarkdownRenderer.render as jest.MockedFunction<typeof MarkdownRenderer.render>;

    beforeEach(() => {
        renderMock.mockImplementation(async (_app, markdown, element) => {
            element.textContent = markdown;
        });
    });

    it("renders the fixed card structure and measures actual body overflow", async () => {
        const document = new ShareCardTestDocument();
        const unload = jest.spyOn(Component.prototype, "unload");
        const renderer = new ShareCardRenderer({} as App, asDocument(document), {
            waitForFrame: async () => undefined,
        });

        const render = await renderer.renderPage({
            content: "# 安静且可信",
            pageIndex: 1,
            totalPages: 3,
        }, {
            theme: "dark",
            sourceLabel: "PA Chat",
            sourcePath: "notes/source.md",
        });

        expect(render.cardEl.classList.contains("pa-share-card")).toBe(true);
        expect(render.cardEl.classList.contains("is-dark")).toBe(true);
        expect(render.cardEl.querySelector(".pa-share-card-source")?.textContent).toBe("PA Chat");
        expect(render.cardEl.querySelector(".pa-share-card-brand")?.textContent)
            .toBe("PA · Personal Assistant");
        expect(render.cardEl.querySelector(".pa-share-card-page-number")?.textContent).toBe("2 / 3");
        expect(renderMock).toHaveBeenCalledWith(
            expect.anything(),
            "# 安静且可信",
            render.bodyEl,
            "notes/source.md",
            expect.any(Component),
        );
        const captureHost = document.body.querySelector(".pa-share-card-capture-host")!;
        expect(captureHost.getAttribute("aria-hidden")).toBe("true");
        expect(captureHost.getAttribute("inert")).toBe("");

        Object.defineProperties(render.bodyEl, {
            scrollHeight: { configurable: true, value: 501 },
            clientHeight: { configurable: true, value: 500 },
        });
        expect(render.fits()).toBe(true);
        expect(render.fits(0)).toBe(false);

        render.cleanup();
        render.cleanup();
        expect(document.body.querySelector(".pa-share-card-capture-host")).toBeNull();
        expect(unload).toHaveBeenCalledTimes(1);
        renderer.cleanup();
        unload.mockRestore();
    });

    it("falls back to plain text and unloads a failed Markdown component", async () => {
        renderMock.mockRejectedValueOnce(new Error("renderer failed"));
        const document = new ShareCardTestDocument();
        const unload = jest.spyOn(Component.prototype, "unload");
        const renderer = new ShareCardRenderer({} as App, asDocument(document), {
            waitForFrame: async () => undefined,
        });

        const render = await renderer.renderPage({
            content: "raw **markdown**",
            pageIndex: 0,
            totalPages: 1,
        }, { theme: "light" });

        expect(render.usedPlainTextFallback).toBe(true);
        expect(render.bodyEl.querySelector(".pa-share-card-body-fallback")?.textContent)
            .toBe("raw **markdown**");
        expect(unload).toHaveBeenCalledTimes(1);
        render.cleanup();
        expect(unload).toHaveBeenCalledTimes(1);
        renderer.cleanup();
        unload.mockRestore();
    });

    it("sanitizes detached rendered DOM before mounting it", async () => {
        const document = new ShareCardTestDocument();
        let connectedDuringRender: boolean | undefined;
        const unsafeContainer = document.createElement("div");
        unsafeContainer.textContent = "safe";
        unsafeContainer.setAttribute("class", "remote-bg");
        unsafeContainer.setAttribute("id", "remote-id");
        unsafeContainer.setAttribute("data-background", "https://example.com/data-bg.png");
        unsafeContainer.setAttribute("style", "background:url(https://example.com/bg.png)");
        unsafeContainer.setAttribute("src", "https://example.com/source");
        unsafeContainer.setAttribute("srcset", "https://example.com/source-2x 2x");
        unsafeContainer.setAttribute("poster", "https://example.com/poster.png");
        unsafeContainer.setAttribute("background", "https://example.com/legacy.png");
        unsafeContainer.setAttribute("onclick", "fetch('https://example.com/click')");
        const customElement = document.createElement("remote-widget");
        const customText = document.createElement("span");
        customText.textContent = "custom text kept";
        customElement.appendChild(customText);
        const completedTask = document.createElement("li");
        completedTask.classList.add("task-list-item");
        const completedCheckbox = document.createElement("input") as unknown as HTMLInputElement;
        completedCheckbox.classList.add("task-list-item-checkbox");
        completedCheckbox.setAttribute("type", "checkbox");
        completedCheckbox.checked = true;
        completedTask.appendChild(completedCheckbox as unknown as import("./helpers/share-card-dom").ShareCardTestElement);
        const pendingTask = document.createElement("li");
        pendingTask.classList.add("task-list-item");
        const pendingCheckbox = document.createElement("input") as unknown as HTMLInputElement;
        pendingCheckbox.classList.add("task-list-item-checkbox");
        pendingCheckbox.setAttribute("type", "checkbox");
        pendingTask.appendChild(pendingCheckbox as unknown as import("./helpers/share-card-dom").ShareCardTestElement);
        renderMock.mockImplementationOnce(async (_app, _markdown, element) => {
            const body = element as unknown as import("./helpers/share-card-dom").ShareCardTestElement;
            connectedDuringRender = body.isConnected;
            for (const tagName of [
                "img",
                "picture",
                "source",
                "iframe",
                "video",
                "audio",
                "canvas",
                "svg",
                "object",
                "embed",
                "script",
                "style",
                "link",
                "base",
                "meta",
                "button",
                "input",
                "select",
                "textarea",
            ]) {
                body.appendChild(document.createElement(tagName));
            }
            for (const className of [
                "internal-embed",
                "media-embed",
                "block-language-mermaid",
                "mermaid",
            ]) {
                const processor = document.createElement("div");
                processor.classList.add(className);
                body.appendChild(processor);
            }
            const diagram = document.createElement("div");
            diagram.classList.add("mermaid");
            body.appendChild(diagram);
            body.appendChild(unsafeContainer);
            body.appendChild(customElement);
            body.appendChild(completedTask);
            body.appendChild(pendingTask);
            const link = document.createElement("a");
            link.textContent = "readable label";
            link.setAttribute("href", "https://example.com/private");
            link.setAttribute("target", "_blank");
            body.appendChild(link);
        });
        const renderer = new ShareCardRenderer({} as App, asDocument(document), {
            waitForFrame: async () => {
                expect(unsafeContainer.isConnected).toBe(true);
                expect(unsafeContainer.getAttribute("style")).toBeNull();
                expect(unsafeContainer.getAttribute("src")).toBeNull();
                expect(unsafeContainer.getAttribute("class")).toBeNull();
                expect(unsafeContainer.getAttribute("data-background")).toBeNull();
                expect(customElement.isConnected).toBe(false);
                expect(customText.isConnected).toBe(true);
            },
        });

        const render = await renderer.renderPage({
            content: "safe text",
            pageIndex: 0,
            totalPages: 1,
        }, {
            theme: "light",
            host: asElement(document.body),
        });

        expect(connectedDuringRender).toBe(false);
        expect(render.bodyEl.querySelectorAll([
            "img",
            "picture",
            "source",
            "iframe",
            "video",
            "audio",
            "canvas",
            "svg",
            "object",
            "embed",
            "script",
            "style",
            "link",
            "base",
            "meta",
            "button",
            "input",
            "select",
            "textarea",
            ".internal-embed",
            ".media-embed",
            ".block-language-mermaid",
            ".mermaid",
        ].join(","))).toHaveLength(0);
        expect(unsafeContainer.textContent).toBe("safe");
        for (const attribute of [
            "class",
            "id",
            "data-background",
            "style",
            "src",
            "srcset",
            "poster",
            "background",
            "onclick",
        ]) {
            expect(unsafeContainer.getAttribute(attribute)).toBeNull();
        }
        expect(render.bodyEl.querySelector("remote-widget")).toBeNull();
        expect(render.bodyEl.querySelector("span")?.textContent).toBe("custom text kept");
        expect(Array.from(render.bodyEl.querySelectorAll("span"), (element) => element.textContent))
            .toEqual(expect.arrayContaining(["[x] ", "[ ] "]));
        expect(render.bodyEl.querySelector("a")?.textContent).toBe("readable label");
        expect(render.bodyEl.querySelector("a")?.getAttribute("href")).toBeNull();
        expect(render.bodyEl.querySelector("a")?.getAttribute("target")).toBeNull();
        render.cleanup();
        renderer.cleanup();
    });

    it("cleans an offscreen render when final layout settling fails", async () => {
        const document = new ShareCardTestDocument();
        const renderer = new ShareCardRenderer({} as App, asDocument(document), {
            waitForFrame: async () => {
                throw new Error("frame failed");
            },
        });

        await expect(renderer.renderPage({
            content: "safe text",
            pageIndex: 0,
            totalPages: 1,
        }, { theme: "light" })).rejects.toThrow("frame failed");
        expect(document.body.querySelector(".pa-share-card-capture-host")).toBeNull();
        renderer.cleanup();
    });

    it("cancels a render closed while Markdown rendering is pending", async () => {
        const document = new ShareCardTestDocument();
        let finishMarkdown!: () => void;
        renderMock.mockImplementationOnce((_app, _markdown, element) => {
            element.textContent = "rendered before async completion";
            return new Promise<void>((resolve) => {
                finishMarkdown = resolve;
            });
        });
        const waitForFrame = jest.fn(async () => undefined);
        const renderer = new ShareCardRenderer({} as App, asDocument(document), {
            waitForFrame,
        });

        const pending = renderer.renderPage({
            content: "safe text",
            pageIndex: 0,
            totalPages: 1,
        }, { theme: "light" });
        await Promise.resolve();
        renderer.cleanup();

        await expect(pending).rejects.toBeInstanceOf(ShareCardRenderCancelledError);
        expect(waitForFrame).not.toHaveBeenCalled();
        expect(document.body.querySelector(".pa-share-card-capture-host")).toBeNull();
        finishMarkdown();
    });

    it("cancels a render closed while final layout settling is pending", async () => {
        const document = new ShareCardTestDocument();
        let finishFrame!: () => void;
        const waitForFrame = jest.fn(() => new Promise<void>((resolve) => {
            finishFrame = resolve;
        }));
        const renderer = new ShareCardRenderer({} as App, asDocument(document), {
            waitForFrame,
        });

        const pending = renderer.renderPage({
            content: "safe text",
            pageIndex: 0,
            totalPages: 1,
        }, { theme: "light" });
        for (let index = 0; index < 5; index += 1) await Promise.resolve();
        expect(waitForFrame).toHaveBeenCalledTimes(1);
        renderer.cleanup();

        await expect(pending).rejects.toBeInstanceOf(ShareCardRenderCancelledError);
        expect(document.body.querySelector(".pa-share-card-capture-host")).toBeNull();
        finishFrame();
    });
});

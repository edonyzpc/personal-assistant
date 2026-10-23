import { act } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Component, MarkdownRenderer } from "obsidian";
import { Simulate } from "react-dom/test-utils";
import { matchCanvasCodeElements, parseCanvasBlocks } from "../src/chat/canvas/canvas-blocks";
import { mountCanvasPreview } from "../src/chat/canvas/mountCanvasPreview";
import type { CanvasArtifactService } from "../src/chat/canvas/canvas-artifact-service";
import type { CanvasPreviewProps } from "../src/chat/canvas/CanvasPreview";
import type { CanvasPreviewResourcePort } from "../src/chat/canvas/canvas-resource-port";

jest.mock("obsidian", () => {
    class Component {
        private callbacks: Array<() => void> = [];
        load() { /* test component */ }
        unload() { for (const callback of this.callbacks.splice(0)) callback(); }
        register(callback: () => void) { this.callbacks.push(callback); }
    }
    return { Component, MarkdownRenderer: { render: jest.fn(async () => undefined) } };
});

const { JSDOM } = require("jsdom") as {
    JSDOM: new (html: string, options: { url: string; pretendToBeVisual: boolean }) => {
        window: Window & { close(): void };
    };
};

const raw = JSON.stringify({
    nodes: [
        { id: "group", type: "group", x: -20, y: -20, width: 600, height: 240, label: "Group" },
        { id: "n", type: "text", x: 0, y: 0, width: 240, height: 120, text: "Hello Canvas" },
        { id: "url", type: "link", x: 360, y: 0, width: 180, height: 100, url: "https://example.test/" },
    ],
    edges: [{ id: "e", fromNode: "n", toNode: "url", label: "Related" }],
});
const markdown = [
    "```json",
    raw,
    "```",
    "> ```json",
    `> ${JSON.stringify({ nodes: [{ id: "nested", type: "text", x: 0, y: 0, width: 10, height: 10, text: "nested" }], edges: [] })}`,
    "> ```",
].join("\n");

function canvasCode(language: string, body: string): HTMLElement {
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.className = `language-${language} is-loaded`;
    code.textContent = body;
    pre.appendChild(code);
    return pre;
}

describe("Chat Canvas local installation", () => {
    const target = globalThis as unknown as Record<string, unknown>;
    const originals = new Map<string, PropertyDescriptor | undefined>();
    const keys = ["window", "self", "document", "navigator", "HTMLElement", "Element", "Node",
        "Text", "Comment", "Event", "MouseEvent", "DocumentFragment", "IS_REACT_ACT_ENVIRONMENT"];
    let dom: { window: Window & { close(): void } };
    beforeAll(() => {
        dom = new JSDOM("<!doctype html><html><body></body></html>", {
            url: "https://localhost/",
            pretendToBeVisual: true,
        });
        Object.defineProperty(dom.window.document, "win", { value: dom.window });
        (dom.window as unknown as { createDiv(): HTMLDivElement }).createDiv = () => dom.window.document.createElement("div");
        const source = dom.window as unknown as Record<string, unknown>;
        for (const key of keys) {
            originals.set(key, Object.getOwnPropertyDescriptor(target, key));
            Object.defineProperty(target, key, {
                configurable: true,
                writable: true,
                value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : source[key],
            });
        }
    });

    beforeEach(() => {
        document.body.replaceChildren();
        jest.mocked(MarkdownRenderer.render).mockReset().mockResolvedValue(undefined);
    });

    afterAll(() => {
        dom.window.close();
        for (const [key, descriptor] of originals) {
            if (descriptor) Object.defineProperty(target, key, descriptor);
            else Reflect.deleteProperty(target, key);
        }
    });

    it("mounts only exact native fences and cleans the React root with the native owner", async () => {
        const buffer = document.createElement("div");
        const nestedRaw = `${JSON.stringify({ nodes: [{ id: "nested", type: "text", x: 0, y: 0, width: 10, height: 10, text: "nested" }], edges: [] })}\n`;
        const first = canvasCode("json", `${raw}\n`);
        const secondParent = document.createElement("blockquote");
        const second = canvasCode("json", nestedRaw);
        secondParent.appendChild(second);
        buffer.append(first, secondParent);
        document.body.appendChild(buffer);
        const blocks = parseCanvasBlocks(markdown);
        const matches = matchCanvasCodeElements(buffer, blocks);
        expect(matches.map(match => match.block.occurrence)).toEqual([0, 0]);

        const owner = new Component() as Component;
        const save = jest.fn(async (_input: unknown) => ({ phase: "saved" as const, path: "A/test.canvas" }));
        const artifactService = {
            resolveArtifact: () => ({ status: "ready" as const, id: "canvas-1" }),
            suggestPath: () => "A/test.canvas",
            validateTargetPath: () => "A/test.canvas",
            save,
            verifyPending: async () => "unsaved" as const,
            open: async () => ({ phase: "opened" as const }),
            subscribe: () => () => undefined,
        } as unknown as CanvasArtifactService;
        let handle: ReturnType<typeof mountCanvasPreview> | undefined;
        const previewProps: Omit<CanvasPreviewProps, "owner"> = {
            app: {} as never,
            locale: "en",
            block: matches[0].block,
            capturedSourcePath: "Source/note.md",
            conversationId: "conv",
            turnIndex: 0,
            messageId: "assistant-1",
            messageContent: markdown,
            artifactService,
            isCurrent: () => true,
        };
        await act(async () => {
            handle = mountCanvasPreview(matches[0].pre, owner, previewProps);
            mountCanvasPreview(matches[1].pre, owner, { ...previewProps, block: matches[1].block });
        });
        const host = document.querySelector(".pa-chat-canvas-host") as HTMLElement;
        expect(host).toBeDefined();
        expect(matches[0].pre.isConnected).toBe(false);
        const viewports = Array.from(document.querySelectorAll<SVGSVGElement>(".pa-chat-canvas-svg"));
        expect(viewports).toHaveLength(2);
        const nameIds = viewports.map(viewport => viewport.getAttribute("aria-labelledby"));
        expect(new Set(nameIds).size).toBe(viewports.length);
        for (const viewport of viewports) {
            // Obsidian's aria-label tooltip assumes HTMLElement.isShown().
            expect(viewport.hasAttribute("aria-label")).toBe(false);
            const label = document.getElementById(viewport.getAttribute("aria-labelledby")!);
            expect(label?.tagName).toBe("title");
            expect(viewport.contains(label)).toBe(true);
            expect(label?.textContent).toBe("Canvas preview. Arrow keys pan; plus and minus zoom; zero fits the canvas.");
        }

        const zoomIn = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Zoom in")!;
        await act(async () => zoomIn.click());
        expect(save).not.toHaveBeenCalled();

        const svg = host.querySelector("svg")!;
        expect(svg.lastElementChild?.classList.contains("pa-chat-canvas-edge-group")).toBe(true);
        expect(svg.querySelector(".pa-chat-canvas-edge")?.getAttribute("d")).toMatch(/^M 240 60 /);
        const beforePan = svg.getAttribute("viewBox");
        await act(async () => Simulate.keyDown(svg, { key: "ArrowRight" }));
        expect(svg.getAttribute("viewBox")).not.toBe(beforePan);
        expect(save).not.toHaveBeenCalled();

        const saveButton = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Save and open")!;
        await act(async () => saveButton.click());
        expect(save).toHaveBeenCalledTimes(1);

        act(() => owner.unload());
        expect(host.isConnected).toBe(false);
        expect(handle).toBeDefined();
    });

    it("does not bind a source block when a third-party processor changed the code body", () => {
        const buffer = document.createElement("div");
        buffer.appendChild(canvasCode("json", `${raw} changed\n`));
        const matches = matchCanvasCodeElements(buffer, parseCanvasBlocks(`\`\`\`json\n${raw}\n\`\`\``));
        expect(matches).toEqual([]);
        expect(buffer.querySelector("pre")).toBeDefined();
    });

    it("fits distant content without including the empty space back to the origin", async () => {
        const distantRaw = JSON.stringify({ nodes: [{ id: "distant", type: "text", x: 10000, y: 10000,
            width: 240, height: 120, text: "Distant card" }], edges: [] });
        const pre = canvasCode("canvas", distantRaw);
        document.body.appendChild(pre);
        const owner = new Component();
        await act(async () => { mountCanvasPreview(pre, owner, {
            app: {} as never, locale: "en",
            block: parseCanvasBlocks(`\`\`\`canvas\n${distantRaw}\n\`\`\``)[0], capturedSourcePath: "Source.md",
            conversationId: null, turnIndex: -1, messageContent: distantRaw, isCurrent: () => true,
        }); });
        const svg = document.querySelector("svg")!;
        const button = (label: string) => Array.from(document.querySelectorAll("button")).find(item => item.textContent === label)!;
        expect(svg.getAttribute("viewBox")).toBe("10000 10000 240 120");
        await act(async () => button("Zoom in").click());
        expect(svg.getAttribute("viewBox")).not.toBe("10000 10000 240 120");
        await act(async () => button("Fit").click());
        expect(svg.getAttribute("viewBox")).toBe("10000 10000 240 120");
        act(() => owner.unload());
    });

    it.each(["resolve", "reject"])("releases late native renderer resources after closing before render %s", async outcome => {
        let finish!: () => void;
        const releaseResource = jest.fn();
        jest.mocked(MarkdownRenderer.render).mockImplementation(async (_app, _text, target, _path, renderOwner) => {
            await new Promise<void>(resolve => { finish = resolve; });
            renderOwner.register(releaseResource);
            target.textContent = "late native content";
            if (outcome === "reject") throw new Error("Native render failed after acquiring a resource");
        });
        const pre = canvasCode("canvas", raw);
        document.body.appendChild(pre);
        const owner = new Component();
        await act(async () => { mountCanvasPreview(pre, owner, {
            app: {} as never, locale: "en",
            block: parseCanvasBlocks(`\`\`\`canvas\n${raw}\n\`\`\``)[0], capturedSourcePath: "Source.md",
            conversationId: null, turnIndex: -1, messageContent: raw, isCurrent: () => true,
            resourcePort: { prepareMarkdown: async () => ({ markdown: "native content", sourcePath: "", unavailableCount: 0, slots: [] }) } as never,
        }); });
        expect(MarkdownRenderer.render).toHaveBeenCalledTimes(1);
        act(() => owner.unload());
        expect(document.querySelector(".pa-chat-canvas-host")).toBeNull();
        await act(async () => finish());
        expect(releaseResource).toHaveBeenCalledTimes(1);
        expect(document.body.textContent).not.toContain("late native content");
    });

    it("keeps the viewport and raw JSON while an initially unpersisted message receives its actual storage binding", async () => {
        const pre = canvasCode("canvas", raw);
        document.body.appendChild(pre);
        const owner = new Component();
        const save = jest.fn(async (_input: unknown) => ({ phase: "saved" as const, path: "A/test.canvas" }));
        const service = {
            resolveArtifact: () => ({ status: "ready", id: "bound" }),
            subscribe: () => () => undefined,
            suggestPath: () => "A/test.canvas", validateTargetPath: (path: string) => path, save,
        } as unknown as CanvasArtifactService;
        const props: Omit<CanvasPreviewProps, "owner"> = {
            app: {} as never, locale: "en", block: parseCanvasBlocks(`\`\`\`canvas\n${raw}\n\`\`\``)[0],
            capturedSourcePath: "Source.md", conversationId: null, turnIndex: -1,
            messageContent: raw, artifactService: service, isCurrent: () => true,
        };
        let handle: NonNullable<ReturnType<typeof mountCanvasPreview>>;
        await act(async () => { handle = mountCanvasPreview(pre, owner, props)!; });
        const button = (label: string) => Array.from(document.querySelectorAll("button")).find(item => item.textContent === label)!;
        expect(button("Save and open").disabled).toBe(true);
        await act(async () => { button("Zoom in").click(); button("Show JSON").click(); });
        const svg = document.querySelector("svg")!;
        const viewBox = svg.getAttribute("viewBox");
        await act(async () => handle.update({ ...props, conversationId: "actual-conversation", turnIndex: 9,
            userMessageSourceHash: "original-user-hash" }));
        expect(document.querySelector("svg")).toBe(svg);
        expect(svg.getAttribute("viewBox")).toBe(viewBox);
        expect(document.querySelector("details code")?.textContent).toBe(`${raw}\n`);
        await act(async () => button("Save and open").click());
        expect(save).toHaveBeenCalledWith(expect.objectContaining({ source: expect.objectContaining({
            conversationId: "actual-conversation", turnIndex: 9, userMessageSourceHash: "original-user-hash",
        }) }));
        act(() => owner.unload());
    });

    it("keeps native text independent of the save path and isolates late renderers after policy revalidation", async () => {
        const popout = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://localhost/", pretendToBeVisual: true });
        const popoutDocument = popout.window.document;
        Object.defineProperty(popoutDocument, "win", { value: popout.window });
        (popout.window as unknown as { createDiv(): HTMLDivElement }).createDiv = () => popoutDocument.createElement("div");
        const pending: Array<() => void> = [];
        const calls: Array<{ path: string; target: HTMLElement }> = [];
        jest.mocked(MarkdownRenderer.render).mockImplementation(async (_app, text, target, path) => {
            calls.push({ path, target });
            if (text === "child") {
                target.textContent = "current child";
                const link = target.ownerDocument.createElement("a");
                link.className = "internal-link";
                link.setAttribute("data-href", "./linked.md");
                link.textContent = "link";
                target.appendChild(link);
                return;
            }
            const slot = target.ownerDocument.createElement("span");
            slot.setAttribute("data-pa-canvas-slot", path);
            target.appendChild(slot);
            await new Promise<void>(resolve => pending.push(resolve));
        });
        const port = {
            prepareMarkdown: async ({ sourcePath }: { sourcePath: string }) => ({
                sourcePath, markdown: "parent", unavailableCount: 0,
                slots: [{ marker: sourcePath, kind: "markdown" as const, sourcePath: "Notes/embedded.md", prepared: {
                    markdown: "child", sourcePath: "Notes/embedded.md", unavailableCount: 0, slots: [],
                } }],
            }),
        } as unknown as CanvasPreviewResourcePort;
        const pre = popoutDocument.createElement("pre");
        popoutDocument.body.appendChild(pre);
        const owner = new Component();
        const openLinkText = jest.fn(async (_href: string, _sourcePath: string, _newLeaf: boolean | string) => undefined);
        const service = { suggestPath: () => "A/test.canvas", validateTargetPath: (path: string) => path } as unknown as CanvasArtifactService;
        let settingsChanged: () => void | Promise<void> = () => undefined;
        await act(async () => { mountCanvasPreview(pre, owner, {
            app: { workspace: { openLinkText } } as never, locale: "en",
            block: parseCanvasBlocks(`\`\`\`canvas\n${raw}\n\`\`\``)[0], capturedSourcePath: "Source.md",
            conversationId: null, turnIndex: -1, messageContent: raw,
            resourcePort: port, artifactService: service, isCurrent: () => true,
            onSettingsChanged: listener => { settingsChanged = listener; return () => undefined; },
        }); });
        const input = popoutDocument.querySelector("input")!;
        await act(async () => Simulate.change(input, { target: { value: "B/test.canvas" } } as never));
        expect(calls.map(call => call.path)).toEqual([""]);
        await act(async () => settingsChanged());
        expect(calls.map(call => call.path)).toEqual(["", ""]);
        await act(async () => pending[1]());
        expect(calls[2].path).toBe("Notes/embedded.md");
        const link = popoutDocument.querySelector<HTMLAnchorElement>(".internal-link")!;
        const svg = popoutDocument.querySelector("svg")!;
        const viewBox = svg.getAttribute("viewBox");
        await act(async () => {
            const start = { button: 0, pointerId: 1, clientX: 0, clientY: 0 };
            const move = { pointerId: 1, clientX: 100, clientY: 100 };
            Simulate.pointerDown(link, start);
            Simulate.pointerMove(svg, move);
            link.click();
        });
        expect(svg.getAttribute("viewBox")).toBe(viewBox);
        expect(openLinkText).toHaveBeenCalledWith("./linked.md", "Notes/embedded.md", false);
        await act(async () => pending[0]());
        expect(popoutDocument.querySelector(".pa-chat-canvas-native-markdown")?.textContent).toContain("current child");
        act(() => owner.unload());
        popout.window.close();
    });

    it("holds an in-flight resource while hidden and resumes it without another read", async () => {
        let visible = true;
        let resume: () => void = () => undefined;
        let finish!: (value: { markdown: string; sourcePath: string; unavailableCount: number; slots: [] }) => void;
        const prepareMarkdown = jest.fn(() => new Promise<typeof value>(resolve => { finish = resolve; }));
        const value = { markdown: "prepared", sourcePath: "A/test.canvas", unavailableCount: 0, slots: [] as [] };
        const pre = canvasCode("canvas", raw);
        document.body.appendChild(pre);
        const owner = new Component();
        await act(async () => { mountCanvasPreview(pre, owner, { app: {} as never, locale: "en",
            block: parseCanvasBlocks(`\`\`\`canvas\n${raw}\n\`\`\``)[0], capturedSourcePath: "Source.md",
            conversationId: null, turnIndex: -1, messageContent: raw,
            resourcePort: { prepareMarkdown } as unknown as CanvasPreviewResourcePort,
            isCurrent: () => true, isVisible: () => visible,
            onDisplayResume: listener => { resume = listener; return () => undefined; },
        }); });
        visible = false;
        await act(async () => finish(value));
        expect(MarkdownRenderer.render).not.toHaveBeenCalled();
        visible = true;
        await act(async () => resume());
        expect(prepareMarkdown).toHaveBeenCalledTimes(1);
        expect(MarkdownRenderer.render).toHaveBeenCalledTimes(1);
        act(() => owner.unload());
    });

    it("offers inspection and recheck for an unresolved save without replaying creation", async () => {
        const pre = canvasCode("canvas", raw);
        document.body.appendChild(pre);
        const owner = new Component();
        const block = parseCanvasBlocks(`\`\`\`canvas\n${raw}\n\`\`\``)[0];
        const save = jest.fn();
        const openCandidate = jest.fn(async () => ({ phase: "opened" }));
        const service = {
            resolveArtifact: () => ({ status: "ready", id: "pending", fileState: "unconfirmed", path: "A/test.canvas",
                record: { save: { phase: "pending", path: "A/test.canvas" } } }),
            subscribe: () => () => undefined, verifyPending: async () => "unknown",
            validateTargetPath: (path: string) => path, save, openCandidate,
        } as unknown as CanvasArtifactService;
        await act(async () => { mountCanvasPreview(pre, owner, { app: {} as never, locale: "en", block,
            capturedSourcePath: "Source.md", conversationId: "c", turnIndex: 0, messageContent: raw,
            artifactService: service, isCurrent: () => true }); });
        const buttons = Array.from(document.querySelectorAll("button"));
        expect(buttons.some(button => button.textContent === "Save and open")).toBe(false);
        await act(async () => buttons.find(button => button.textContent === "Open file to check")!.click());
        expect(openCandidate).toHaveBeenCalledTimes(1);
        expect(save).not.toHaveBeenCalled();
        act(() => owner.unload());
    });

    it("pans from a group image background after zooming while keeping node content interactive", async () => {
        const backgroundRaw = JSON.stringify({ nodes: [{ id: "g", type: "group", x: 0, y: 0,
            width: 1000, height: 1000, background: "image.png" }] });
        const pre = canvasCode("canvas", backgroundRaw);
        document.body.appendChild(pre);
        const owner = new Component();
        await act(async () => { mountCanvasPreview(pre, owner, {
            app: { vault: { getResourcePath: () => "app://local/image.png" } } as never, locale: "en",
            block: parseCanvasBlocks(`\`\`\`canvas\n${backgroundRaw}\n\`\`\``)[0], capturedSourcePath: "Source.md",
            conversationId: null, turnIndex: -1, messageContent: backgroundRaw, isCurrent: () => true,
            resourcePort: { resolve: async () => ({ status: "file", file: { path: "image.png", extension: "png" }, subpath: "" }) } as never,
        }); });
        const svg = document.querySelector("svg")!;
        const background = document.querySelector(".pa-chat-canvas-background")!;
        const before = svg.getAttribute("viewBox");
        await act(async () => {
            const start = { button: 0, pointerId: 2, clientX: 10, clientY: 10 };
            const move = { pointerId: 2, clientX: 60, clientY: 60 };
            Simulate.pointerDown(background, start);
            Simulate.pointerMove(svg, move);
            Simulate.pointerUp(svg);
        });
        expect(svg.getAttribute("viewBox")).not.toBe(before);
        act(() => owner.unload());
    });
});

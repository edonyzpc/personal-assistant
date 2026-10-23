import { describe, expect, it } from "@jest/globals";
import MarkdownIt from "markdown-it";
import { prepareChatMarkdownForDisplay } from "../src/chat/markdown-table-compat";
import { matchCanvasCodeElements, parseCanvasBlocks, parseCanvasDocument } from "../src/chat/canvas/canvas-blocks";

const { JSDOM } = require("jsdom") as {
    JSDOM: new (html: string) => { window: Window & { close(): void } };
};

const fence = (language: string, body: string, marker = "```"): string =>
    `${marker}${language}\n${body}\n${marker}`;

describe("Chat Canvas fence recognition", () => {
    it("accepts explicit and structurally certain JSON Canvas blocks", () => {
        const explicit = parseCanvasBlocks(fence("canvas", '{"nodes":[]}'));
        const inferred = parseCanvasBlocks(fence("json", '{"nodes":[{"id":"n","type":"text","x":0,"y":0,"width":10,"height":10,"text":"Hello"}],"edges":[]}'));
        const ambiguous = parseCanvasBlocks(fence("json", '{"nodes":[]}'));
        const invalid = parseCanvasBlocks(fence("canvas", '{"nodes":[{"id":"dup","type":"text","x":0,"y":0,"width":1,"height":1,"text":"First"},{"id":"dup","type":"text","x":0,"y":0,"width":1,"height":1,"text":"Second"}]}'));

        expect(explicit).toHaveLength(1);
        expect(explicit[0].status).toMatchObject({ kind: "preview" });
        expect(inferred).toHaveLength(1);
        expect(inferred[0].status).toMatchObject({ kind: "preview" });
        expect(ambiguous).toEqual([]);
        expect(invalid).toEqual([]);
    });

    it("does not enhance known text nodes without their required text", () => {
        const missingText = '{"nodes":[{"id":"n","type":"text","x":0,"y":0,"width":10,"height":10}]}';
        expect(parseCanvasBlocks(fence("json", missingText))).toEqual([]);
        expect(parseCanvasBlocks(fence("canvas", missingText))).toEqual([]);
    });

    it("rejects duplicate edge identities rather than giving multiple rendered edges the same key", () => {
        const node = { id: "n", type: "text", text: "Node", x: 0, y: 0, width: 10, height: 10 };
        const edge = { id: "edge", fromNode: "n", toNode: "n" };
        expect(parseCanvasDocument(JSON.stringify({ nodes: [node], edges: [edge, edge] }), true)).toBeNull();
    });

    it("keeps duplicate blocks independent and reads fences in lists and blockquotes", () => {
        const raw = '{"nodes":[]}';
        const source = [
            fence("canvas", raw),
            `> ${fence("canvas", raw).replace(/\n/g, "\n> ")}`,
            `- item`,
            `  ${fence("canvas", raw).replace(/\n/g, "\n  ")}`,
            fence("canvas", raw),
        ].join("\n");
        const blocks = parseCanvasBlocks(source);

        expect(blocks.map(block => [block.occurrence, block.sourceStartLine])).toEqual([
            [0, 0],
            [1, 3],
            [2, 7],
            [3, 10],
        ]);
        expect(blocks.map(block => block.status.kind)).toEqual(["preview", "preview", "preview", "preview"]);

        const pendingDuplicate = parseCanvasBlocks([fence("canvas", raw), `\`\`\`canvas\n${raw}\n`].join("\n"));
        expect(pendingDuplicate.map(block => [block.occurrence, block.status.kind])).toEqual([
            [0, "preview"], [1, "generating"],
        ]);
    });

    it("preserves original line endings while matching normalized code in ordinary and nested fences", () => {
        const raw = '{\r\n  "nodes": []\n}\r\n';
        const fenced = `\`\`\`canvas\r\n${raw}\`\`\``;
        const quoted = `> ${fenced.replace(/\n/g, "\n> ")}`;
        const listed = `- item\n\n  ${fenced.replace(/\r\n/g, "\n").replace(/\n/g, "\n  ")}`;
        const source = `${fenced}\n${quoted}\n${listed}`;
        const blocks = parseCanvasBlocks(source, source.replace(/\r\n/g, "\n"));
        const dom = new JSDOM(new MarkdownIt().render(source));
        try {
            expect(blocks.map(block => block.raw)).toEqual([raw, raw, raw.replace(/\r\n/g, "\n")]);
            expect(blocks.map(block => block.status.kind)).toEqual(["preview", "preview", "preview"]);
            expect(blocks.map(block => block.occurrence)).toEqual([0, 1, 0]);
            const matches = matchCanvasCodeElements(dom.window.document.body, blocks);
            expect(matches.map(match => match.block)).toEqual(blocks);
            expect(matches.map(match => match.code.textContent)).toEqual(Array(3).fill(raw.replace(/\r\n/g, "\n")));
        } finally {
            dom.window.close();
        }
    });

    it("pairs identical native code blocks in order and leaves ambiguous DOM untouched", () => {
        const raw = '{"nodes":[]}';
        const blocks = parseCanvasBlocks([fence("canvas", raw), fence("canvas", raw)].join("\n"));
        const dom = new JSDOM("<!doctype html><html><body></body></html>");
        try {
            const document = dom.window.document;
            const buffer = document.createElement("div");
            const preElements = blocks.map(block => {
                const pre = document.createElement("pre");
                const code = document.createElement("code");
                code.className = `language-${block.language}`;
                code.textContent = block.raw;
                pre.appendChild(code);
                buffer.appendChild(pre);
                return pre;
            });

            const matches = matchCanvasCodeElements(buffer, blocks);
            expect(matches.map(match => match.block.occurrence)).toEqual([0, 1]);
            expect(matches.map(match => match.pre)).toEqual(preElements);

            buffer.appendChild(preElements[0].cloneNode(true));
            expect(matchCanvasCodeElements(buffer, blocks)).toEqual([]);
            expect(buffer.querySelectorAll("pre")).toHaveLength(3);
        } finally {
            dom.window.close();
        }
    });

    it("uses the parser's container-relative closure for a fence nested in an ordered list", () => {
        const nested = '123. item\n\n     ```canvas\n     {"nodes":[]}\n     ```';
        expect(parseCanvasBlocks(nested)[0]).toMatchObject({ closed: true, status: { kind: "preview" } });
        expect(parseCanvasBlocks(nested.slice(0, nested.lastIndexOf("\n")))[0])
            .toMatchObject({ closed: false, status: { kind: "generating" } });
    });

    it("projects file subpaths, background styles and edge ends while retaining the source data", () => {
        const node = { x: 0, y: 0, width: 100, height: 100 };
        const raw = JSON.stringify({
            nodes: [
                { ...node, id: "file", type: "file", file: "Notes/note.md", subpath: "#Heading" },
                { ...node, id: "group", type: "group", background: "image.png", backgroundStyle: "repeat", color: "#AABBCC" },
            ],
            edges: [
                { id: "explicit", fromNode: "file", toNode: "group", fromEnd: "arrow", toEnd: "none" },
                { id: "default", fromNode: "group", toNode: "file" },
            ],
            extension: { retained: true },
        });
        const document = parseCanvasDocument(raw, true);
        expect(document?.nodes[0].subpath).toBe("#Heading");
        expect(document?.nodes[1]).toMatchObject({ backgroundStyle: "repeat", color: "#AABBCC" });
        expect(document?.edges.map(edge => [edge.fromEnd, edge.toEnd])).toEqual([["arrow", "none"], ["none", "arrow"]]);
        expect(parseCanvasBlocks(fence("jsoncanvas", raw))[0].raw).toBe(`${raw}\n`);
    });

    it("returns explicit unclosed fences as generating and never infers incomplete JSON", () => {
        const explicit = parseCanvasBlocks("```canvas\n{\"nodes\":[");
        const ordinary = parseCanvasBlocks("```json\n{\"nodes\":[");

        expect(explicit).toHaveLength(1);
        expect(explicit[0]).toMatchObject({ closed: false, status: { kind: "generating" } });
        expect(ordinary).toEqual([]);
    });

    it("pairs raw fences with the table-compatible display copy without offset arithmetic", () => {
        const source = [
            "Canvas:",
            "| A | B |",
            "| --- | --- |",
            "| 1 | 2 |",
            "",
            fence("canvas", '{"nodes":[]}'),
        ].join("\n");
        const display = prepareChatMarkdownForDisplay(source);
        const blocks = parseCanvasBlocks(source, display);

        expect(display).toContain("\n\n| A | B |");
        expect(blocks).toHaveLength(1);
        expect(blocks[0].sourceStartLine).toBe(5);
        expect(blocks[0].displayStartLine).toBe(6);
    });
});

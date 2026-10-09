import { EditorState } from "@codemirror/state";
import { Tree, NodeType } from "@lezer/common";
import { syntaxTree } from "@codemirror/language";
import { buildTagDecorations } from "../src/tag-appearance/editor";

jest.mock("@codemirror/language", () => ({ syntaxTree: jest.fn() }));

const syntaxTreeMock = syntaxTree as jest.MockedFunction<typeof syntaxTree>;
const rootType = NodeType.define({ id: 0, name: "Document" });
// Obsidian 1.14.4's live syntax-tree probe, rather than a substitute tag regex.
const beginType = NodeType.define({ id: 1, name: "formatting_formatting-hashtag_hashtag_hashtag-begin_meta_tag-" });
const endType = NodeType.define({ id: 2, name: "hashtag_hashtag-end_meta_tag-" });

function nativeTree(length: number, ranges: Array<{ from: number; to: number }>): Tree {
    const children: Tree[] = [];
    const positions: number[] = [];
    for (const range of ranges) {
        children.push(new Tree(beginType, [], [], 1), new Tree(endType, [], [], range.to - range.from - 1));
        positions.push(range.from, range.from + 1);
    }
    return new Tree(rootType, children, positions, length);
}

function marks(doc: string, visible = [{ from: 0, to: doc.length }]) {
    const state = EditorState.create({ doc });
    const result: Array<{ from: number; to: number; color: string }> = [];
    buildTagDecorations(state, visible).between(0, doc.length, (from, to, value) => {
        result.push({ from, to, color: value.spec.attributes["data-pa-tag-color"] });
    });
    return { state, result };
}

describe("native editor tag projection", () => {
    test("joins native begin/end tokens and uses the full Chinese nested name", () => {
        const doc = "#Topic #项目/工作";
        syntaxTreeMock.mockReturnValue(nativeTree(doc.length, [{ from: 0, to: 6 }, { from: 7, to: 13 }]));
        const { state, result } = marks(doc);
        expect(result).toEqual([
            { from: 0, to: 6, color: "blue" },
            { from: 7, to: 13, color: "brown" },
        ]);
        expect(state.doc.toString()).toBe(doc);
        expect(state.selection.main.from).toBe(0);
    });

    test("a visible slice inside a tag keeps its complete identity and deduplicates overlap", () => {
        const doc = "prefix #项目/工作 suffix";
        syntaxTreeMock.mockReturnValue(nativeTree(doc.length, [{ from: 7, to: 13 }]));
        expect(marks(doc, [{ from: 10, to: 11 }, { from: 11, to: 14 }]).result).toEqual([
            { from: 7, to: 13, color: "brown" },
        ]);
    });

    test("tag-looking Markdown without native hashtag tokens gets no decorations", () => {
        const doc = "# Heading\n`#Topic` \\#Topic https://example.test/#Topic\n```\n#Topic\n```";
        syntaxTreeMock.mockReturnValue(nativeTree(doc.length, []));
        expect(marks(doc).result).toEqual([]);
    });

    test("does not color an incomplete hashtag begin token", () => {
        syntaxTreeMock.mockReturnValue(new Tree(rootType, [new Tree(beginType, [], [], 1)], [0], 1));
        expect(marks("#").result).toEqual([]);
    });
});

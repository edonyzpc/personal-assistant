import { Prec, RangeSetBuilder, type EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { getTagColor } from "./palette";

function tagParts(node: SyntaxNode): string[] {
    return node.name.split("_");
}

/** Native Obsidian tokens separate the leading # from the full tag name. */
function nativeTagRange(node: SyntaxNode): { from: number; to: number } | undefined {
    const parts = tagParts(node);
    if (!parts.includes("hashtag")) return undefined;
    if (parts.includes("hashtag-begin")) {
        const end = node.nextSibling;
        if (end && end.from === node.to && tagParts(end).includes("hashtag-end")) {
            return { from: node.from, to: end.to };
        }
    } else if (parts.includes("hashtag-end")) {
        const begin = node.prevSibling;
        if (begin && begin.to === node.from && tagParts(begin).includes("hashtag-begin")) {
            return { from: begin.from, to: node.to };
        }
    }
    return undefined;
}

export function buildTagDecorations(
    state: EditorState,
    visibleRanges: readonly { from: number; to: number }[]
): DecorationSet {
    const ranges = new Map<number, number>();
    const tree = syntaxTree(state);
    for (const visible of visibleRanges) {
        tree.iterate({
            from: visible.from,
            to: visible.to,
            enter(node) {
                const range = nativeTagRange(node.node);
                if (range) ranges.set(range.from, range.to);
            },
        });
    }
    const builder = new RangeSetBuilder<Decoration>();
    for (const [from, to] of Array.from(ranges).sort(([left], [right]) => left - right)) {
        const color = getTagColor(state.doc.sliceString(from, to));
        builder.add(from, to, Decoration.mark({
            class: "pa-tag-appearance",
            attributes: { "data-pa-tag-color": color },
        }));
    }
    return builder.finish();
}

class TagAppearanceEditor {
    decorations: DecorationSet;

    constructor(view: EditorView) {
        this.decorations = buildTagDecorations(view.state, view.visibleRanges);
    }

    update(update: ViewUpdate): void {
        // A completed incremental parse can arrive without a document edit.
        if (update.docChanged || update.viewportChanged || syntaxTree(update.state) !== syntaxTree(update.startState)) {
            this.decorations = buildTagDecorations(update.state, update.view.visibleRanges);
        }
    }

    destroy(): void {
        this.decorations = Decoration.none;
    }
}

// Carry one fixed color identity across the complete native tag range.
// Obsidian may split this mark inside its hashtag begin/end spans;
// static CSS preserves native edge geometry in either nesting.
export const tagAppearanceEditorExtension = Prec.lowest(ViewPlugin.fromClass(TagAppearanceEditor, {
    decorations: (value) => value.decorations,
}));

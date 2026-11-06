import { EditorState } from '@codemirror/state';
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import { pluginField, sectionWordCountEditorPlugin } from '../src/stats/editor-plugin';

// Retain the real decorations and state. Expose the class through the same
// construction callback without needing a browser layout for a count update.
jest.mock('@codemirror/view', () => ({
    ...jest.requireActual('@codemirror/view'),
    ViewPlugin: {
        define: jest.requireActual('@codemirror/view').ViewPlugin.define,
        fromClass: (Owner: new (view: EditorView) => unknown) => ({ create: (view: EditorView) => new Owner(view) }),
    },
}));

it('refreshes section counts when the comment setting changes without a document edit', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'last');
    Object.defineProperty(Array.prototype, 'last', { configurable: true, value: function<T>(this: T[]) { return this[this.length - 1]; } });
    try {
        const settings = { displaySectionCounts: true, countComments: false };
        const state = EditorState.create({ doc: '# Heading\nvisible\n%% hidden words %%', extensions: [pluginField.init(() => ({ settings } as never))] });
        const view = { state, visibleRanges: [{ from: 0, to: state.doc.length }] } as unknown as EditorView;
        const owner = (sectionWordCountEditorPlugin as unknown as {
            create(view: EditorView): { decorations: DecorationSet; update(update: ViewUpdate): void };
        }).create(view);
        const counts = () => {
            const result: string[] = [];
            owner.decorations.between(0, state.doc.length, (_from, _to, decoration) => {
                result.push(decoration.spec.widget.getDisplayText());
            });
            return result;
        };
        expect(counts()).toEqual(['1']);
        settings.countComments = true;
        owner.update({ view, state, startState: state, docChanged: false, viewportChanged: false } as ViewUpdate);
        expect(counts()).toEqual(['3']);
        settings.countComments = false;
        owner.update({ view, state, startState: state, docChanged: false, viewportChanged: false } as ViewUpdate);
        expect(counts()).toEqual(['1']);
    } finally {
        if (descriptor) Object.defineProperty(Array.prototype, 'last', descriptor);
        else delete (Array.prototype as unknown as { last?: unknown }).last;
    }
});

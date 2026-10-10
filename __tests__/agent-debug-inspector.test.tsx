import { describe, expect, it, jest } from '@jest/globals';
import type { KeyboardEvent, ReactElement, SetStateAction } from 'react';
import { NodeInspector } from '../src/agent-debug/components/NodeInspector';
import type { DebugContent, DebugEvent } from '../src/agent-debug/types';

jest.mock('obsidian');

let mockHooks: InspectorRenderer;
jest.mock('react', () => ({
    ...jest.requireActual<typeof import('react')>('react'),
    useId: () => ':inspector:',
    useState: <T,>(initial: T | (() => T)) => mockHooks.useState(initial),
    useRef: <T,>(initial: T) => mockHooks.useRef(initial),
    useMemo: <T,>(factory: () => T) => factory(),
}));

// Use the existing view suite's hook pattern; real layout is checked in Obsidian.
class InspectorRenderer {
    private cells: unknown[] = [];
    private cursor = 0;
    tree: unknown;
    constructor(private readonly component: () => unknown) { this.render(); }
    useState<T>(initial: T | (() => T)): [T, (next: SetStateAction<T>) => void] {
        const index = this.cursor++;
        if (!(index in this.cells)) this.cells[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
        return [this.cells[index] as T, next => {
            this.cells[index] = typeof next === 'function' ? (next as (prior: T) => T)(this.cells[index] as T) : next;
        }];
    }
    useRef<T>(initial: T): { current: T } {
        const index = this.cursor++;
        if (!(index in this.cells)) this.cells[index] = { current: initial };
        return this.cells[index] as { current: T };
    }
    render(): void { mockHooks = this; this.cursor = 0; this.tree = this.component(); }
}

type Node = ReactElement<{
    children?: unknown; role?: string; hidden?: boolean; open?: boolean; tabIndex?: number;
    'aria-selected'?: boolean; 'aria-controls'?: string; id?: string;
    onClick?: () => void; onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
    onToggle?: (event: { currentTarget: { open: boolean } }) => void;
    group?: { kind: DebugContent['kind'] }; parts?: string[]; redactions?: string[];
}>;
function elements(tree: unknown): Node[] {
    if (Array.isArray(tree)) return tree.flatMap(elements);
    if (!tree || typeof tree !== 'object' || !('props' in tree)) return [];
    const node = tree as Node;
    return [node, ...elements(node.props.children)];
}
function renderChild(node: Node): InspectorRenderer {
    return new InspectorRenderer(() => (node.type as (props: Node['props']) => unknown)(node.props));
}
function event(overrides: Partial<DebugEvent> = {}): DebugEvent {
    return { vaultKey: 'vault', captureId: 'run', nodeId: 'tool', seq: 1, segment: 0, timestamp: 123,
        kind: 'tool', nodeKind: 'tool', label: 'read_note', status: 'completed', contentIds: [], ...overrides };
}
function content(kind: DebugContent['kind'], text: string, redactions: string[] = []): DebugContent {
    return { captureId: 'run', contentId: kind, kind, text, redactions } as DebugContent;
}
function inspector(contents: DebugContent[] = [], overrides: Partial<Parameters<typeof NodeInspector>[0]> = {}) {
    return NodeInspector({ event: event(), contents, session: [], loading: false, failed: false,
        onRetry: () => undefined, durationMs: 1200, ...overrides });
}

describe('Agent Debug inspector reading state', () => {
    it('opens with readable IO while keeping context and reasoning progressively disclosed', () => {
        const renderer = new InspectorRenderer(() => inspector([
            content('reasoning', 'recorded reasoning'), content('tool_output', '<script>plain text</script>', ['token']),
            content('tool_input', '{"path":"example.md"}'), content('context', 'recorded context'),
        ]));
        const tabs = elements(renderer.tree).filter(node => node.props.role === 'tab');
        expect(tabs.map(node => node.props['aria-selected'])).toEqual([true, false, false]);
        const groups = elements(renderer.tree).filter(node => node.props.group);
        expect(groups.map(node => node.props.group!.kind)).toEqual(['tool_input', 'tool_output', 'context', 'reasoning']);
        for (const node of groups) {
            const section = renderChild(renderChild(node).tree as Node);
            const secondary = ['context', 'reasoning'].includes(node.props.group!.kind);
            expect((section.tree as Node).type).toBe(secondary ? 'details' : 'section');
            if (secondary) expect((section.tree as Node).props.open).toBe(false);
            else expect(elements(section.tree).some(child => child.props.parts)).toBe(true);
        }
        const output = renderChild(renderChild(groups[1]).tree as Node);
        expect(JSON.stringify(output.tree)).toContain('token');
        const block = elements(output.tree).find(node => node.props.parts)!;
        expect(elements(renderChild(block).tree).find(node => node.type === 'pre')?.props.children).toBe('<script>plain text</script>');
    });

    it('keeps panels mounted and selection stable through refresh, with keyboard tab navigation', () => {
        let current = event();
        const onTabChange = jest.fn();
        const renderer = new InspectorRenderer(() => inspector([content('output', 'answer')], { event: current, onTabChange }));
        const tabs = () => elements(renderer.tree).filter(node => node.props.role === 'tab');
        const panels = () => elements(renderer.tree).filter(node => node.props.role === 'tabpanel');
        const io = panels()[0];
        const preventDefault = jest.fn();
        tabs()[0].props.onKeyDown?.({ key: 'End', preventDefault } as unknown as KeyboardEvent<HTMLButtonElement>);
        renderer.render();
        expect(preventDefault).toHaveBeenCalled();
        expect(onTabChange).toHaveBeenCalledTimes(1);
        expect(tabs().map(node => node.props.tabIndex)).toEqual([-1, -1, 0]);
        expect(panels().map(node => node.props.hidden)).toEqual([true, true, false]);
        expect(panels()[0].props.id).toBe(io.props.id);
        expect(elements(panels()[0]).find(node => node.props.group)?.key).toBe(elements(io).find(node => node.props.group)?.key);
        current = event({ timestamp: 456, status: 'running' });
        renderer.render();
        expect(tabs()[2].props['aria-selected']).toBe(true);
        tabs()[2].props.onClick?.();
        renderer.render();
        expect(onTabChange).toHaveBeenCalledTimes(1);
        tabs()[2].props.onKeyDown?.({ key: 'ArrowRight', preventDefault } as unknown as KeyboardEvent<HTMLButtonElement>);
        renderer.render();
        expect(onTabChange).toHaveBeenCalledTimes(2);
        expect(panels().map(node => node.props.hidden)).toEqual([false, true, true]);
        expect(tabs()[0].props['aria-controls']).toBe(panels()[0].props.id);
        tabs()[1].props.onClick?.();
        renderer.render();
        expect(onTabChange).toHaveBeenCalledTimes(3);
        expect(tabs()[1].props['aria-selected']).toBe(true);
    });

    it('preserves loaded text length through content refresh without eagerly exposing the full body', () => {
        const renderer = new InspectorRenderer(() => inspector([content('output', 'x'.repeat(40_000))]));
        const group = elements(renderer.tree).find(node => node.props.group)!;
        const section = renderChild(renderChild(group).tree as Node);
        const block = elements(section.tree).find(node => node.props.parts)!;
        let parts = block.props.parts!;
        const text = new InspectorRenderer(() => (block.type as (props: { parts: string[] }) => unknown)({ parts }));
        const visible = () => elements(text.tree).find(node => node.type === 'pre')?.props.children as string;
        expect(visible()).toHaveLength(16_384);
        elements(text.tree).find(node => node.type === 'button')?.props.onClick?.();
        text.render();
        expect(visible()).toHaveLength(32_768);
        parts = [...parts, 'new output'];
        text.render();
        expect(visible()).toHaveLength(32_768);
        expect(visible()).not.toContain('new output');
    });

    it('retains unavailable and failed-read feedback instead of inventing missing content or time', () => {
        const retry = jest.fn();
        const renderer = new InspectorRenderer(() => inspector([], {
            event: event({ availability: 'cleared', nodeKind: undefined }), failed: true, onRetry: retry, durationMs: undefined,
        }));
        const tree = JSON.stringify(renderer.tree);
        expect(tree).toContain('Related content has been cleared.');
        expect(tree).toContain('Type was not recorded in this older capture');
        expect(elements(renderer.tree).filter(node => node.props.group)).toHaveLength(0);
        elements(renderer.tree).find(node => node.type === 'button' && node.props.children === 'Retry reading')?.props.onClick?.();
        expect(retry).toHaveBeenCalledTimes(1);
    });
});

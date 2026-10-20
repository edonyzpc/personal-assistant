import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { act } from 'react';

import {
    createOperationsReviewModel,
    createOperationsRequestReviewModel,
} from '../src/ai-services/operations/operations-review-model';
import type {
    OperationExecutionResult,
    OperationsIntent,
    PreparedOperation,
} from '../src/ai-services/operations/types';
import { mountOperationsDiff } from '../src/chat/operations-review/mount';

type JSDOMLike = {
    window: Window;
};

const { JSDOM } = require('jsdom') as {
    JSDOM: new (html: string, options?: { url: string }) => JSDOMLike;
};

function operationFor(
    path: string,
    beforeState: string,
    afterState: string,
    id = `operation-${path}`,
): PreparedOperation {
    const unchanged = Array.from({ length: 10 }, (_value, index) => `unchanged-${index + 1}`);
    const before = [`${beforeState}-before`, ...unchanged, `${beforeState}-before-final`].join('\n');
    const after = [`${afterState}-after`, ...unchanged, `${afterState}-after-final`].join('\n');
    return {
        id,
        toolCallId: `call-${id}`,
        name: 'vault_process',
        input: {
            path,
            operation: 'replace',
            params: { search: before, replace: after },
        },
        path,
        expectedBefore: before,
        expectedAfter: after,
    };
}

function modelFor(path: string, state: string) {
    const operation = operationFor(path, state, state);
    const intent: OperationsIntent = {
        id: `intent-${path}`,
        runId: 'run-stable-group',
        turnId: 'turn-stable-group',
        createdAt: 1,
        expiresAt: 2,
        state: 'pending',
        operations: [operation],
    };
    return createOperationsReviewModel(intent);
}

function segmentedRequestModel(undoFirstReceipt: boolean) {
    const first = operationFor('notes/segments.md', 'first', 'first', 'operation-first-segment');
    const second = operationFor('notes/segments.md', 'external', 'second', 'operation-second-segment');
    const results: OperationExecutionResult[] = [first, second].map(operation => ({
        operationId: operation.id,
        toolCallId: operation.toolCallId,
        name: operation.name,
        path: operation.path,
        status: 'succeeded' as const,
        receiptId: operation.id === first.id ? 'receipt-first' : 'receipt-second',
    }));
    return {
        intentId: 'run-segments',
        ...createOperationsRequestReviewModel({
            runId: 'run-segments',
            intents: [{
                intent: {
                    id: 'intent-segments',
                    runId: 'run-segments',
                    turnId: 'turn-segments',
                    createdAt: 1,
                    expiresAt: 2,
                    state: 'pending',
                    operations: [first, second],
                },
                results,
            }],
            ...(undoFirstReceipt ? { undoneReceiptIds: ['receipt-first'] } : {}),
        }),
    };
}

function buttonByText(container: HTMLElement, text: string) {
    const button = Array.from(container.querySelectorAll('button'))
        .find(candidate => candidate.textContent === text);
    if (!button) throw new Error(`Missing button: ${text}`);
    return button;
}

function groupButton(group: Element, text: string) {
    const button = Array.from(group.querySelectorAll('button'))
        .find(candidate => candidate.textContent === text);
    if (!button) throw new Error(`Missing group button: ${text}`);
    return button;
}

async function withMountedDiff(
    container: HTMLElement,
    options: Parameters<typeof mountOperationsDiff>[1],
    run: (diff: ReturnType<typeof mountOperationsDiff>, release: () => Promise<void>) => Promise<void>,
): Promise<void> {
    let diff!: ReturnType<typeof mountOperationsDiff>;
    await act(async () => {
        diff = mountOperationsDiff(container, options);
    });
    let released = false;
    const release = async () => {
        if (released) return;
        released = true;
        await act(async () => diff.unmount());
    };
    try {
        await run(diff, release);
    } finally {
        await release();
    }
}

describe('mountOperationsDiff state retention', () => {
    let dom: JSDOMLike;
    let container: HTMLElement;
    const target = globalThis as unknown as Record<string, unknown>;
    const originalValues = new Map<string, unknown>();
    const hadValues = new Set<string>();
    const installedKeys = [
        'window', 'self', 'document', 'navigator', 'getComputedStyle',
        'requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver',
        'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLAnchorElement',
        'HTMLButtonElement', 'Element', 'Node', 'Text', 'Comment',
        'DocumentFragment', 'SVGElement', 'Event', 'MouseEvent', 'KeyboardEvent',
        'CustomEvent', 'CSSStyleDeclaration', 'DOMTokenList',
    ];

    beforeAll(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://localhost/' });
        const source = dom.window as unknown as Record<string, unknown>;
        for (const key of installedKeys) {
            if (key in target) hadValues.add(key);
            originalValues.set(key, target[key]);
            target[key] = source[key];
        }
        if ('IS_REACT_ACT_ENVIRONMENT' in target) hadValues.add('IS_REACT_ACT_ENVIRONMENT');
        originalValues.set('IS_REACT_ACT_ENVIRONMENT', target.IS_REACT_ACT_ENVIRONMENT);
        target.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterAll(() => {
        for (const key of [...installedKeys, 'IS_REACT_ACT_ENVIRONMENT'].reverse()) {
            if (hadValues.has(key)) target[key] = originalValues.get(key);
            else delete target[key];
        }
        container.remove();
        dom.window.close();
    });

    it('keeps expanded local Diff state while updating a stable group', async () => {
        await withMountedDiff(container, {
            model: modelFor('notes/stable-group.md', 'first'),
            mode: 'request',
        }, async (diff, release) => {
            expect(container.textContent).not.toContain('unchanged-5');
            expect(buttonByText(container, 'Show complete current text').getAttribute('aria-expanded')).toBe('false');
            expect(buttonByText(container, 'Show complete new text').getAttribute('aria-expanded')).toBe('false');
            await act(async () => buttonByText(container, 'Show more context').click());
            await act(async () => buttonByText(container, 'Show complete current text').click());
            await act(async () => buttonByText(container, 'Show complete new text').click());
            expect(container.textContent).toContain('unchanged-5');
            expect(container.textContent).toContain('first-before');
            expect(container.textContent).toContain('first-after');
            expect(buttonByText(container, 'Show complete current text').getAttribute('aria-expanded')).toBe('true');
            expect(buttonByText(container, 'Show complete new text').getAttribute('aria-expanded')).toBe('true');

            await act(async () => diff.update({
                model: modelFor('notes/stable-group.md', 'second'),
                mode: 'request',
            }));
            expect(container.textContent).toContain('unchanged-5');
            expect(container.textContent).toContain('second-before');
            expect(container.textContent).toContain('second-after');
            expect(container.textContent).not.toContain('first-before');
            expect(container.textContent).not.toContain('first-after');
            expect(buttonByText(container, 'Show complete current text').getAttribute('aria-expanded')).toBe('true');
            expect(buttonByText(container, 'Show complete new text').getAttribute('aria-expanded')).toBe('true');

            await act(async () => diff.update({
                model: modelFor('notes/replacement-group.md', 'replacement'),
                mode: 'request',
            }));
            expect(container.textContent).not.toContain('unchanged-5');
            expect(container.textContent).toContain('replacement-after');
            await act(async () => diff.update({
                model: modelFor('notes/stable-group.md', 'third'),
                mode: 'request',
            }));
            expect(container.textContent).not.toContain('unchanged-5');
            expect(container.textContent).toContain('third-before');
            expect(buttonByText(container, 'Show complete current text').getAttribute('aria-expanded')).toBe('false');
            expect(buttonByText(container, 'Show complete new text').getAttribute('aria-expanded')).toBe('false');

            await release();
            expect(container.textContent).toBe('');
        });
    });

    it('keeps a surviving request segment identity when an earlier segment is undone', async () => {
        await withMountedDiff(container, {
            model: segmentedRequestModel(false),
            mode: 'request',
        }, async (diff, release) => {
            const groups = Array.from(container.querySelectorAll('.pa-operations-diff__group'));
            expect(groups).toHaveLength(2);
            expect(groups[0]!.textContent).toContain('first-before');
            expect(groups[1]!.textContent).toContain('external-before');
            expect(groupButton(groups[0]!, 'Show complete current text').getAttribute('aria-expanded')).toBe('false');
            expect(groupButton(groups[1]!, 'Show complete current text').getAttribute('aria-expanded')).toBe('false');
            expect(groupButton(groups[1]!, 'Show complete new text').getAttribute('aria-expanded')).toBe('false');

            await act(async () => groupButton(groups[0]!, 'Show complete current text').click());
            await act(async () => groupButton(groups[1]!, 'Show complete new text').click());
            expect(groupButton(groups[0]!, 'Show complete current text').getAttribute('aria-expanded')).toBe('true');
            expect(groupButton(groups[1]!, 'Show complete current text').getAttribute('aria-expanded')).toBe('false');
            expect(groupButton(groups[1]!, 'Show complete new text').getAttribute('aria-expanded')).toBe('true');

            await act(async () => diff.update({
                model: segmentedRequestModel(true),
                mode: 'request',
            }));
            const survivingGroups = Array.from(container.querySelectorAll('.pa-operations-diff__group'));
            expect(survivingGroups).toHaveLength(1);
            expect(survivingGroups[0]!.textContent).toContain('external-before');
            expect(survivingGroups[0]!.textContent).toContain('second-after');
            expect(survivingGroups[0]!.textContent).not.toContain('first-before');
            expect(groupButton(survivingGroups[0]!, 'Show complete current text').getAttribute('aria-expanded')).toBe('false');
            expect(groupButton(survivingGroups[0]!, 'Show complete new text').getAttribute('aria-expanded')).toBe('true');

            await release();
            expect(container.textContent).toBe('');
        });
    });
});

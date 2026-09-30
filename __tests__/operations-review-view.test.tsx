import { describe, expect, it, jest } from '@jest/globals';
import { createRoot } from 'react-dom/client';

import { OperationsReviewSession } from '../src/ai-services/operations/operations-review-session';
import type { OperationsExecutionResult, OperationsIntent, UndoResult } from '../src/ai-services/operations/types';
import {
    OperationsReviewRouter,
    OPERATIONS_REVIEW_VIEW_TYPE,
} from '../src/chat/operations-review/OperationsReviewRouter';
import { OperationsReviewView } from '../src/chat/operations-review/OperationsReviewView';

jest.mock('obsidian');
jest.mock('react-dom/client', () => ({ createRoot: jest.fn() }));

type RenderedElement = {
    type: unknown;
    props: { session: OperationsReviewSession | null };
};

function reviewIntent(id = 'intent-view'): OperationsIntent {
    return {
        id,
        runId: 'run',
        turnId: 'turn',
        createdAt: 1,
        expiresAt: 2,
        state: 'pending',
        operations: [{
            id: `${id}-operation`,
            toolCallId: 'call',
            name: 'vault_create',
            input: { path: 'notes/private.md', content: 'PRIVATE_BODY' },
            path: 'notes/private.md',
            expectedBefore: null,
            expectedAfter: 'PRIVATE_BODY',
        }],
    };
}

function reviewSession(id = 'intent-view'): OperationsReviewSession {
    return new OperationsReviewSession({
        intent: reviewIntent(id),
        controller: {
            confirm: async (): Promise<OperationsExecutionResult> => { throw new Error('unused'); },
            cancel: (): OperationsIntent => { throw new Error('unused'); },
            undoMany: async (): Promise<UndoResult[]> => { throw new Error('unused'); },
        },
        sessionIdentity: 'view',
        isSourceCurrent: () => true,
    });
}

function makeLeaf() {
    const container = {};
    const leaf = {
        view: null as unknown,
        containerEl: { querySelector: () => container },
        setViewState: jest.fn(async (_state: unknown) => undefined),
        loadIfDeferred: jest.fn(async () => undefined),
    };
    return leaf;
}

function makeWorkspace(leaves: ReturnType<typeof makeLeaf>[] = [], newLeaf?: ReturnType<typeof makeLeaf>) {
    return {
        getLeavesOfType: jest.fn((viewType: string) => viewType === OPERATIONS_REVIEW_VIEW_TYPE
            ? leaves.map(leaf => ({ ...leaf, view: leaf.view }))
            : []),
        getLeaf: jest.fn((_kind: 'tab') => newLeaf ?? makeLeaf()),
        revealLeaf: jest.fn(async (_leaf: unknown) => undefined),
    };
}

describe('OperationsReviewView routing', () => {
    it('creates an independent leaf and serializes only an opaque review ID', async () => {
        const router = new OperationsReviewRouter();
        const session = reviewSession();
        router.register(session);
        const leaf = makeLeaf();
        const workspace = makeWorkspace([], leaf);
        leaf.setViewState.mockImplementation(async () => {
            leaf.view = new OperationsReviewView(leaf as never, router);
        });

        await router.open(session.reviewId, workspace as never);

        expect(workspace.getLeaf).toHaveBeenCalledWith('tab');
        expect(leaf.setViewState).toHaveBeenCalledWith({
            type: OPERATIONS_REVIEW_VIEW_TYPE,
            active: true,
        });
        const view = leaf.view as OperationsReviewView;
        expect(view.getState()).toEqual({ reviewId: session.reviewId });
        expect(JSON.stringify(view.getState())).not.toContain('PRIVATE_BODY');
        expect(JSON.stringify(view.getState())).not.toContain('notes/private.md');
    });

    it('reveals the existing leaf for the same review instead of opening another tab', async () => {
        const router = new OperationsReviewRouter();
        const session = reviewSession('intent-existing');
        router.register(session);
        const existing = makeLeaf();
        existing.view = {
            getViewType: () => OPERATIONS_REVIEW_VIEW_TYPE,
            reviewId: session.reviewId,
        };
        const workspace = makeWorkspace([existing]);

        await router.open(session.reviewId, workspace as never);

        expect(workspace.getLeaf).not.toHaveBeenCalled();
        expect(workspace.revealLeaf).toHaveBeenCalledWith(existing);
    });

    it('reuses a real routed OperationsReviewView on a later open after the in-flight guard completes', async () => {
        const router = new OperationsReviewRouter();
        const session = reviewSession('intent-sequential');
        router.register(session);
        const leaf = makeLeaf();
        const workspace = {
            getLeavesOfType: jest.fn(() => [leaf]),
            getLeaf: jest.fn(() => leaf),
            revealLeaf: jest.fn(async (_leaf: unknown) => undefined),
        };
        leaf.setViewState.mockImplementation(async () => {
            leaf.view = new OperationsReviewView(leaf as never, router);
        });

        await router.open(session.reviewId, workspace as never);
        await router.open(session.reviewId, workspace as never);

        const view = leaf.view as OperationsReviewView;
        expect(workspace.getLeaf).toHaveBeenCalledTimes(1);
        expect(workspace.revealLeaf).toHaveBeenCalledTimes(2);
        expect(workspace.revealLeaf).toHaveBeenNthCalledWith(1, leaf);
        expect(workspace.revealLeaf).toHaveBeenNthCalledWith(2, leaf);
        expect(view.reviewId).toBe(session.reviewId);
        expect(view.getState()).toEqual({ reviewId: session.reviewId });
    });

    it('reuses one in-flight leaf for concurrent opens of the same review', async () => {
        const router = new OperationsReviewRouter();
        const session = reviewSession('intent-concurrent');
        router.register(session);
        const leaf = makeLeaf();
        const workspace = makeWorkspace([], leaf);
        let resolveViewState!: () => void;
        leaf.setViewState.mockImplementation(async () => {
            await new Promise<void>(resolve => {
                resolveViewState = resolve;
            });
            leaf.view = new OperationsReviewView(leaf as never, router);
        });

        const first = router.open(session.reviewId, workspace as never);
        const second = router.open(session.reviewId, workspace as never);
        resolveViewState();
        await Promise.all([first, second]);

        expect(workspace.getLeaf).toHaveBeenCalledTimes(1);
        expect(workspace.revealLeaf).toHaveBeenCalledTimes(1);
    });

    it('allows retry after an open failure and does not revive an invalidated route', async () => {
        const router = new OperationsReviewRouter();
        const session = reviewSession('intent-open-failure');
        router.register(session);
        const failedLeaf = makeLeaf();
        const successfulLeaf = makeLeaf();
        const workspace = makeWorkspace([], successfulLeaf);
        failedLeaf.setViewState.mockRejectedValue(new Error('route unavailable'));
        let workspaceGetLeafCall = 0;
        workspace.getLeaf.mockImplementation(() => {
            workspaceGetLeafCall += 1;
            return workspaceGetLeafCall === 1 ? failedLeaf : successfulLeaf;
        });

        await expect(router.open(session.reviewId, workspace as never)).rejects.toThrow('route unavailable');
        successfulLeaf.setViewState.mockImplementation(async () => {
            successfulLeaf.view = new OperationsReviewView(successfulLeaf as never, router);
        });
        await router.open(session.reviewId, workspace as never);
        expect(workspace.getLeaf).toHaveBeenCalledTimes(2);

        const invalidated = reviewSession('intent-invalidated-open');
        router.register(invalidated);
        const pendingLeaf = makeLeaf();
        const invalidWorkspace = makeWorkspace([], pendingLeaf);
        let resolveInvalidOpen!: () => void;
        pendingLeaf.setViewState.mockImplementation(async () => {
            await new Promise<void>(resolve => {
                resolveInvalidOpen = resolve;
            });
            pendingLeaf.view = new OperationsReviewView(pendingLeaf as never, router);
        });
        const opening = router.open(invalidated.reviewId, invalidWorkspace as never);
        router.invalidate(invalidated.reviewId);
        resolveInvalidOpen();
        await expect(opening).rejects.toThrow('no longer available');
        expect(invalidWorkspace.revealLeaf).not.toHaveBeenCalled();
        expect(router.get(invalidated.reviewId)).toBeNull();
    });

    it('unmounts React state on close and detaches only its own leaf mapping', async () => {
        const render = jest.fn();
        const unmount = jest.fn();
        jest.mocked(createRoot).mockReturnValue({ render, unmount });
        const router = new OperationsReviewRouter();
        const session = reviewSession('intent-close');
        router.register(session);
        const leaf = makeLeaf();
        const view = new OperationsReviewView(leaf as never, router);
        await view.setState({ reviewId: session.reviewId, before: 'must not enter workspace state' });
        await view.onOpen();
        expect(view.getState()).toEqual({ reviewId: session.reviewId });
        expect((render.mock.calls[0]![0] as RenderedElement).props.session).toBe(session);

        await view.onClose();

        expect(unmount).toHaveBeenCalledTimes(1);
        await view.setState({ reviewId: 'opr-other-route' });
        expect(view.getState()).toEqual({ reviewId: 'opr-other-route' });
    });

    it('renders unavailable for a route whose runtime session was invalidated', async () => {
        const render = jest.fn();
        const unmount = jest.fn();
        jest.mocked(createRoot).mockReturnValue({ render, unmount });
        const router = new OperationsReviewRouter();
        const session = reviewSession('intent-invalid');
        router.register(session);
        const leaf = makeLeaf();
        const view = new OperationsReviewView(leaf as never, router);
        await view.setState({ reviewId: session.reviewId });
        await view.onOpen();
        router.invalidate(session.reviewId);
        await view.setState({ reviewId: session.reviewId });

        expect(router.get(session.reviewId)).toBeNull();
        expect((render.mock.calls[render.mock.calls.length - 1]![0] as RenderedElement).props.session).toBeNull();
        await view.onClose();
    });
});

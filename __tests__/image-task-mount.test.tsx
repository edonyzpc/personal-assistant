import { act } from 'react';
import { setIcon } from 'obsidian';
import type { ImageGenerationOutput, ImageGenerationTask } from '../src/chat/image-generation-types';
import type { ImageTaskCardProps, ImageTaskMessageAction } from '../src/chat/ui/ImageTaskCard';
import { createChatUiStore } from '../src/chat/ui/chat-ui-store';
import { mountImageTaskCard, type ImageTaskCardMountHandle } from '../src/chat/ui/image-task-mount';
import { CHAT_MENU_IDLE_CLOSE_MS } from '../src/chat/menu-helpers';
import { pluginT } from '../src/locales/plugin';

const { JSDOM } = require('jsdom') as {
    JSDOM: new (html: string, options: { url: string }) => { window: Window & { close(): void } };
};

const text = (key: string) => pluginT(`plugin.chat.createImage.${key}`, 'en');

function savedOutput(): ImageGenerationOutput {
    return { outputId: 'output-1', providerOrdinal: 0, saveState: 'saved',
        assetRef: { assetId: 'asset-1', contentHash: 'a'.repeat(64) } };
}

function taskFixture(taskId = 'task-1'): ImageGenerationTask {
    return {
        schemaVersion: 1, taskId, operationId: `operation-${taskId}`,
        conversationId: 'conversation', stableMessageId: 'message', revision: 1,
        createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z',
        request: { userPrompt: 'Original image request', submittedPrompt: 'Submitted image description',
            operation: 'generate', model: 'wan2.7-image', count: 1, inputRefs: [] },
        connection: { mode: 'inherit-chat', endpointIdentity: 'https://example.invalid',
            credentialSlot: 'chat', revision: 0 },
        state: 'completed', outputs: [savedOutput()],
    };
}

function propsFixture(taskId = 'task-1'): ImageTaskCardProps {
    return {
        task: taskFixture(taskId), store: createChatUiStore(), canDeliverOutputs: true,
        canSaveToNote: true, getMessageActions: () => [],
        actions: {
            regenerate: jest.fn(), stop: jest.fn(), approveWhiteBackground: jest.fn(), resume: jest.fn(),
            preview: jest.fn(), edit: jest.fn(), download: jest.fn(), copy: jest.fn(), save: jest.fn(),
            resolvePreview: jest.fn(async () => ({ url: 'blob:preview', release: jest.fn() })),
        },
    };
}

function element<T extends Element = HTMLElement>(container: ParentNode, selector: string): T {
    const result = container.querySelector<T>(selector);
    if (!result) throw new Error(`Missing ${selector}`);
    return result;
}

function button(container: ParentNode, label: string): HTMLButtonElement {
    const result = Array.from(container.querySelectorAll('button')).find(candidate =>
        candidate.getAttribute('aria-label') === label || candidate.textContent === label);
    if (!result) throw new Error(`Missing button: ${label}`);
    return result;
}

describe('image task real React mount', () => {
    let dom: { window: Window & { close(): void } };
    let container: HTMLElement;
    const mounted = new Set<ImageTaskCardMountHandle>();
    const target = globalThis as unknown as Record<string, unknown>;
    const originals = new Map<string, PropertyDescriptor | undefined>();
    const installedKeys = [
        'window', 'self', 'document', 'navigator', 'getComputedStyle',
        'HTMLElement', 'HTMLButtonElement', 'Element', 'Node', 'Text', 'Comment',
        'DocumentFragment', 'SVGElement', 'Event', 'MouseEvent', 'KeyboardEvent',
        'CustomEvent', 'IS_REACT_ACT_ENVIRONMENT',
    ];

    beforeAll(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://localhost/' });
        const source = dom.window as unknown as Record<string, unknown>;
        for (const key of installedKeys) {
            originals.set(key, Object.getOwnPropertyDescriptor(target, key));
            Object.defineProperty(target, key, { configurable: true, writable: true,
                value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : source[key] });
        }
    });

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        // Model the host icon API's DOM ownership, without implementing any card UI.
        (setIcon as jest.Mock).mockImplementation((host: HTMLElement, icon: string) => {
            const svg = host.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('data-icon', icon);
            host.replaceChildren(svg);
        });
    });

    afterEach(async () => {
        await act(async () => { for (const handle of mounted) handle.unmount(); });
        mounted.clear();
        container.remove();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    afterAll(() => {
        dom.window.close();
        for (const [key, descriptor] of originals) {
            if (descriptor) Object.defineProperty(target, key, descriptor);
            else delete target[key];
        }
    });

    async function mount(props: ImageTaskCardProps, host = container) {
        let handle!: ImageTaskCardMountHandle;
        await act(async () => { handle = mountImageTaskCard(host, props); });
        mounted.add(handle);
        return handle;
    }

    it('renders a saved output and forwards its actual controls with icon ownership', async () => {
        const props = propsFixture();
        const handle = await mount(props);
        const output = props.task.outputs[0];
        const row = element(container, '.pa-chat-image-task-card__output');
        const frame = element(row, '.pa-chat-image-task-card__image-frame');
        const actions = element(row, '.pa-chat-image-task-card__output-actions');
        expect(frame.nextElementSibling).toBe(actions);
        expect(actions.querySelectorAll('button')).toHaveLength(5);
        for (const [key, callback] of [
            ['editThis', props.actions.edit], ['download', props.actions.download],
            ['copy', props.actions.copy], ['saveToNote', props.actions.save],
        ] as const) {
            const control = button(row, text(key));
            expect(control.querySelector('svg')).not.toBeNull();
            expect(control.querySelector('.pa-sr-only')?.textContent).toBe(text(key));
            expect(control.querySelector('svg')?.parentElement).not.toBe(control);
            await act(async () => control.click());
            if (key === 'copy' || key === 'download') expect(callback).toHaveBeenCalledWith(output, document);
            else expect(callback).toHaveBeenCalledWith(output);
        }
        await act(async () => element<HTMLButtonElement>(frame, 'button').click());
        expect(props.actions.preview).toHaveBeenCalledWith(output);
        expect(element(container, '.pa-chat-image-task-card__details').previousElementSibling)
            .toBe(element(container, '.pa-chat-image-task-card__outputs'));
        const details = element<HTMLDetailsElement>(container, 'details');
        expect(details.open).toBe(false);
        for (const key of ['originalRequest', 'submittedRequest', 'model', 'count', 'createdAt']) {
            expect(details.textContent).toContain(text(`detail.${key}`));
        }
        expect(container.querySelector('.pa-chat-image-task-card__actions')).toBeNull();
        expect(row.querySelector('.pa-chat-image-task-card__output-state')).toBeNull();
        await act(async () => handle.update({ ...props, canSaveToNote: false }));
        expect(actions.querySelectorAll('button')).toHaveLength(4);
        expect(Array.from(actions.querySelectorAll('button')).some(control =>
            control.getAttribute('aria-label') === text('saveToNote'))).toBe(false);
    });

    it('keeps Details and output identity through task updates, hiding and another task refresh', async () => {
        const props = propsFixture();
        const release = jest.fn();
        props.actions.resolvePreview = jest.fn(async () => ({ url: 'blob:stable', release }));
        const handle = await mount(props);
        const details = element<HTMLDetailsElement>(container, 'details');
        const img = element<HTMLImageElement>(container, 'img');
        const row = element(container, '.pa-chat-image-task-card__output');
        await act(async () => {
            details.open = true;
            details.dispatchEvent(new Event('toggle'));
        });
        const next = { ...props, task: { ...props.task, state: 'partial' as const, revision: 2 },
            actions: { ...props.actions } };
        await act(async () => handle.update(next));
        expect(element(container, 'details')).toBe(details);
        expect(details.open).toBe(true);
        expect(element(container, '.pa-chat-image-task-card__output')).toBe(row);
        expect(element(container, 'img')).toBe(img);
        expect(props.actions.resolvePreview).toHaveBeenCalledTimes(1);

        const otherHost = document.createElement('div');
        container.appendChild(otherHost);
        const other = { ...propsFixture('task-2'), store: props.store };
        const otherHandle = await mount(other, otherHost);
        await act(async () => {
            other.store.getState().setTaskDetailsOpen('task-2', true);
            otherHandle.update({ ...other, task: { ...other.task, revision: 2 } });
        });
        expect(element(container, 'details')).toBe(details);
        expect(details.open).toBe(true);

        await act(async () => button(row, text('moreTaskActions')).click());
        expect(row.querySelector('[role="menu"]')).not.toBeNull();
        await act(async () => props.store.getState().setViewVisible(false));
        expect(row.querySelector('[role="menu"]')).toBeNull();
        expect(details.open).toBe(true);
        const latest = { ...next, task: { ...next.task, state: 'completed' as const, revision: 3 } };
        await act(async () => handle.update(latest));
        expect(element(container, 'article').getAttribute('data-state')).toBe('partial');
        expect(release).not.toHaveBeenCalled();
        await act(async () => props.store.getState().setViewVisible(true));
        expect(element(container, 'article').getAttribute('data-state')).toBe('completed');
        expect(element(container, 'details')).toBe(details);
        expect(element(container, 'img')).toBe(img);
        expect(props.actions.resolvePreview).toHaveBeenCalledTimes(1);
        await act(async () => handle.unmount());
        expect(release).toHaveBeenCalledTimes(1);
        expect(props.store.getState().taskDetailsOpen['task-1']).toBeUndefined();
        expect(props.store.getState().taskDetailsOpen['task-2']).toBe(true);
        expect(element<HTMLDetailsElement>(otherHost, 'details').open).toBe(true);
    });

    it('renders unknown, partial and transparency recovery without inventing progress', async () => {
        const props = propsFixture();
        const handle = await mount(props);
        const details = element<HTMLDetailsElement>(container, 'details');
        await act(async () => {
            details.open = true;
            details.dispatchEvent(new Event('toggle'));
            handle.update({ ...props, task: { ...props.task, state: 'submission_unknown', outputs: [],
                recoveryReason: 'provider_acceptance_unknown' } });
        });
        expect(container.textContent).toContain(text('recovery.acceptanceUnknown'));
        expect(container.textContent).not.toContain('%');
        expect(element(container, 'details')).toBe(details);
        expect(details.open).toBe(true);
        await act(async () => handle.update({ ...props, task: { ...props.task, state: 'partial',
            recoveryReason: 'provider_failed', outputs: [...props.task.outputs,
                { outputId: 'failed', providerOrdinal: 1, saveState: 'failed', recoveryReason: 'provider_failed' }] } }));
        expect(container.textContent).toContain(text('recovery.providerFailed'));
        expect(container.textContent).toContain(pluginT('plugin.chat.createImage.output', 'en', {
            number: 2, state: text('outputState.failed'),
        }));
        await act(async () => {
            button(container, text('stop')).click();
            button(container, text('recover')).click();
        });
        expect(props.actions.stop).toHaveBeenCalledTimes(1);
        expect(props.actions.resume).toHaveBeenCalledTimes(1);
        await act(async () => handle.update({ ...props, task: { ...props.task, state: 'not_submitted',
            outputs: [], recoveryReason: 'transparent_input_needs_confirmation' } }));
        await act(async () => button(container, text('approveWhiteBackground')).click());
        expect(props.actions.approveWhiteBackground).toHaveBeenCalledTimes(1);
        expect(element(container, '.pa-chat-image-task-card__header-controls')
            .querySelector('.pa-chat-image-task-card__more')).not.toBeNull();
    });

    it('reads current menu capabilities, handles keyboard/outside/idle closing and cleans listeners', async () => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'setImmediate'] });
        const props = propsFixture();
        let copyDisabled = false;
        const copy = jest.fn();
        const retry = jest.fn();
        let messageActions: ImageTaskMessageAction[] = [
            { id: 'copy', label: 'Copy message', icon: 'copy', get disabled() { return copyDisabled; }, run: copy },
        ];
        props.getMessageActions = jest.fn(() => messageActions);
        const add = jest.spyOn(document, 'addEventListener');
        const remove = jest.spyOn(document, 'removeEventListener');
        const scheduleTimer = jest.spyOn(window, 'setTimeout');
        const clearTimer = jest.spyOn(window, 'clearTimeout');
        const handle = await mount(props);
        const more = button(container, text('moreTaskActions'));
        expect(props.getMessageActions).not.toHaveBeenCalled();
        // The message finishes after the card mounted; there is no task update.
        messageActions = [...messageActions,
            { id: 'retry', label: 'Retry message', icon: 'rotate-cw', run: retry },
            { id: 'add', label: 'Add to editor', icon: 'file-plus', run: jest.fn() },
            { id: 'delete', label: 'Delete', icon: 'trash-2', danger: true, disabled: true, run: jest.fn() },
        ];
        copyDisabled = true;
        await act(async () => more.click());
        expect(props.getMessageActions).toHaveBeenCalled();
        expect(more.getAttribute('aria-haspopup')).toBe('menu');
        expect(more.getAttribute('aria-expanded')).toBe('true');
        const menu = element(container, '[role="menu"]');
        const regenerate = button(menu, text('regenerate'));
        expect(document.activeElement).toBe(regenerate);
        expect(button(menu, 'Copy message').disabled).toBe(true);
        expect(button(menu, 'Delete').disabled).toBe(true);
        expect(button(menu, 'Add to editor').disabled).toBe(false);
        await act(async () => button(menu, 'Copy message').click());
        expect(copy).not.toHaveBeenCalled();
        await act(async () => regenerate.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
        expect(document.activeElement).toBe(button(menu, 'Retry message'));
        await act(async () => button(menu, 'Retry message').dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape', bubbles: true,
        })));
        expect(container.querySelector('[role="menu"]')).toBeNull();
        expect(document.activeElement).toBe(more);
        expect(more.getAttribute('aria-expanded')).toBe('false');
        expect(retry).not.toHaveBeenCalled();
        await act(async () => more.click());
        await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
        expect(container.querySelector('[role="menu"]')).toBeNull();

        await act(async () => more.click());
        await act(async () => jest.advanceTimersByTime(CHAT_MENU_IDLE_CLOSE_MS - 1));
        await act(async () => element(container, '[role="menu"]').dispatchEvent(new Event('mousemove')));
        await act(async () => jest.advanceTimersByTime(CHAT_MENU_IDLE_CLOSE_MS - 1));
        expect(container.querySelector('[role="menu"]')).not.toBeNull();
        await act(async () => jest.advanceTimersByTime(1));
        expect(container.querySelector('[role="menu"]')).toBeNull();

        copyDisabled = false;
        await act(async () => more.click());
        expect(button(container, 'Copy message').disabled).toBe(false);
        await act(async () => button(container, 'Retry message').click());
        expect(retry).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[role="menu"]')).toBeNull();
        await act(async () => more.click());
        await act(async () => button(container, text('regenerate')).click());
        expect(props.actions.regenerate).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[role="menu"]')).toBeNull();
        await act(async () => more.click());
        await act(async () => handle.update({ ...props, task: { ...props.task, revision: 2 } }));
        const lastIdleTimerIndex = scheduleTimer.mock.calls.map(([, delay]) => delay)
            .lastIndexOf(CHAT_MENU_IDLE_CLOSE_MS);
        const pendingIdleTimer = scheduleTimer.mock.results[lastIdleTimerIndex].value;
        await act(async () => handle.unmount());
        for (const [type, listener, options] of add.mock.calls.filter(([type]) => type === 'pointerdown' || type === 'click')) {
            expect(remove).toHaveBeenCalledWith(type, listener, options);
        }
        expect(props.store.getState().taskMenusOpen).toEqual({});
        expect(clearTimer).toHaveBeenCalledWith(pendingIdleTimer);
    });

    it('starts a newly saved preview and releases resources on replacement, revocation and removal', async () => {
        const props = propsFixture();
        const releaseFirst = jest.fn();
        const releaseSecond = jest.fn();
        props.actions.resolvePreview = jest.fn()
            .mockResolvedValueOnce({ url: 'blob:first', release: releaseFirst })
            .mockResolvedValueOnce({ url: 'blob:second', release: releaseSecond });
        const output = props.task.outputs[0];
        const handle = await mount({ ...props, task: { ...props.task, outputs: [{ ...output, saveState: 'saving' }] } });
        expect(props.actions.resolvePreview).not.toHaveBeenCalled();
        await act(async () => handle.update(props));
        expect(element<HTMLImageElement>(container, 'img').src).toBe('blob:first');
        await act(async () => handle.update({ ...props, task: { ...props.task, outputs: [{ ...output,
            assetRef: { assetId: 'asset-2', contentHash: 'b'.repeat(64) } }] } }));
        expect(releaseFirst).toHaveBeenCalledTimes(1);
        expect(element<HTMLImageElement>(container, 'img').src).toBe('blob:second');
        await act(async () => handle.update({ ...props, canDeliverOutputs: false }));
        expect(releaseSecond).toHaveBeenCalledTimes(1);
        expect(container.querySelector('.pa-chat-image-task-card__output')).toBeNull();
        expect(container.querySelector('.pa-chat-image-task-card__output-action')).toBeNull();
        expect(container.textContent).not.toContain(props.task.request.submittedPrompt);
        await act(async () => handle.update({ ...props, task: { ...props.task, outputs: [] } }));
        await act(async () => handle.unmount());
        expect(releaseSecond).toHaveBeenCalledTimes(1);
    });

    it('retries only a failed card render and retains external Details state', async () => {
        const props = propsFixture();
        const healthy = { ...propsFixture('healthy-task'), store: props.store };
        const failedHost = document.createElement('div');
        const healthyHost = document.createElement('div');
        container.append(failedHost, healthyHost);
        const handle = await mount(props, failedHost);
        await mount(healthy, healthyHost);
        await act(async () => {
            props.store.getState().setTaskDetailsOpen(props.task.taskId, true);
            healthy.store.getState().setTaskDetailsOpen(healthy.task.taskId, true);
        });
        const healthyDetails = element<HTMLDetailsElement>(healthyHost, 'details');
        const brokenRequest = { ...props.task.request };
        Object.defineProperty(brokenRequest, 'userPrompt', { get() { throw new Error('render regression'); } });
        const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        await act(async () => handle.update({ ...props, task: { ...props.task, request: brokenRequest } }));
        expect(failedHost.querySelector('[role="alert"]')).not.toBeNull();
        expect(props.store.getState().taskDetailsOpen[props.task.taskId]).toBe(true);
        expect(element(healthyHost, 'details')).toBe(healthyDetails);
        expect(healthyDetails.open).toBe(true);
        await act(async () => handle.update(props));
        await act(async () => button(failedHost, text('retryRender')).click());
        expect(element<HTMLDetailsElement>(failedHost, 'details').open).toBe(true);
        expect(element(healthyHost, 'details')).toBe(healthyDetails);
        expect(healthyDetails.open).toBe(true);
        expect(healthy.actions.resolvePreview).toHaveBeenCalledTimes(1);
        for (const { actions } of [props, healthy]) {
            for (const action of [actions.regenerate, actions.stop, actions.resume, actions.save]) {
                expect(action).not.toHaveBeenCalled();
            }
        }
        error.mockRestore();
    });

    it('releases a preview that arrives after the output unmounts', async () => {
        const props = propsFixture();
        let resolve!: (value: { url: string; release(): void }) => void;
        const release = jest.fn();
        props.actions.resolvePreview = jest.fn(() => new Promise(done => { resolve = done; }));
        const handle = await mount(props);
        await act(async () => handle.unmount());
        await act(async () => resolve({ url: 'blob:late', release }));
        expect(release).toHaveBeenCalledTimes(1);
    });
});

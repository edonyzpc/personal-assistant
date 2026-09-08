import { Notice, type App } from 'obsidian';
import { GraphOptionsModal, type GraphOptions } from '../src/settings/graph-options-modal';
import { pluginT } from '../src/locales/plugin';
import { DomStubNode, findAllByClass, findAllByTag } from './helpers/dom-stub';

class ModalElement extends DomStubNode {
    onclick?: () => void | Promise<void>;
    onchange?: () => void;
    oninput?: () => void;
    focus = jest.fn();
    addClass(value: string): void { this.classList.add(value); }
    empty(): void { this.textContent = ''; }
    createEl(tag: string, options: { cls?: string; text?: string; attr?: Record<string, string> } = {}): ModalElement {
        const element = this.appendChild(new ModalElement(tag));
        if (options.cls) element.addClass(options.cls);
        if (options.text) element.setText(options.text);
        for (const [key, value] of Object.entries(options.attr ?? {})) element.setAttribute(key, value);
        return element;
    }
    createDiv(options?: Parameters<ModalElement['createEl']>[1]): ModalElement { return this.createEl('div', options); }
    createSpan(options?: Parameters<ModalElement['createEl']>[1]): ModalElement { return this.createEl('span', options); }
    click(): void | Promise<void> {
        if (this.disabled || this.hidden) return;
        for (let node = this.parentElement; node; node = node.parentElement) {
            if (node.disabled || node.hidden) return;
        }
        return this.onclick?.();
    }
}

const nodes = (root: DomStubNode, tag: string) => findAllByTag(root, tag) as ModalElement[];
const byClass = (root: DomStubNode, cls: string) => findAllByClass(root, cls)[0] as ModalElement;
const label = (root: DomStubNode, key: string, params?: Record<string, number>) => {
    const control = [...nodes(root, 'input'), ...nodes(root, 'select')]
        .find((element) => element.getAttribute('aria-label') === pluginT(key, 'en', params));
    if (!control) throw new Error(`Missing input: ${key}`);
    return control;
};
const button = (root: DomStubNode, key: string) => {
    const control = nodes(root, 'button').find((element) => element.textContent === pluginT(key));
    if (!control) throw new Error(`Missing button: ${key}`);
    return control;
};
const input = (element: ModalElement, value: string) => { element.value = value; element.oninput?.(); };
const toggle = (element: ModalElement, value: boolean) => { element.checked = value; element.onchange?.(); };
const deferred = () => {
    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
};

function setup() {
    const persisted: GraphOptions = {
        localGraph: { type: 'legacy-tab', notice: 'Keep notice', depth: 9,
            showTags: true, showAttach: true, showNeighbor: false, collapse: false, autoColors: false,
            resizeStyle: { width: 2400, height: 500 } },
        enableGraphColors: true,
        colorGroups: [
            { query: 'same', color: { a: 0.2, rgb: 100 } },
            { query: 'same', color: { a: 0.8, rgb: 200 } },
        ],
    };
    const readOptions = jest.fn(() => persisted);
    const saveOptions = jest.fn(async (_options: GraphOptions): Promise<void> => undefined);
    const applyOptions = jest.fn(async (): Promise<void> => undefined);
    const modal = new GraphOptionsModal({} as App, { readOptions, saveOptions, applyOptions });
    const root = new ModalElement('div');
    modal.contentEl = root as unknown as HTMLElement;
    modal.titleEl = new ModalElement('h2') as unknown as HTMLElement;
    const close = jest.spyOn(modal, 'close').mockImplementation(() => modal.onClose());
    modal.onOpen();
    const save = button(root, 'plugin.settings.graph.options.save');
    const cancel = button(root, 'plugin.settings.graph.options.cancel');
    const status = byClass(root, 'pa-graph-options__status');
    return { modal, root, persisted, readOptions, saveOptions, applyOptions, close, save, cancel, status };
}

describe('GraphOptionsModal', () => {
    it('opens and cancels a detached draft without saving or applying', async () => {
        const h = setup();
        const original = JSON.parse(JSON.stringify(h.persisted));
        input(label(h.root, 'plugin.settings.graph.depth.name'), '3');
        input(label(h.root, 'plugin.settings.graph.options.query', { number: 2 }), 'changed');
        toggle(label(h.root, 'plugin.settings.graphColors.enabled.name'), false);

        await h.cancel.click();

        expect(h.persisted).toEqual(original);
        expect(h.saveOptions).not.toHaveBeenCalled();
        expect(h.applyOptions).not.toHaveBeenCalled();
        expect(h.root.children).toHaveLength(0);
    });

    it('preserves all untouched legal values without clamping, including legacy type and dimensions', async () => {
        const h = setup();
        await h.save.click();

        expect(h.saveOptions).toHaveBeenCalledWith(h.persisted);
        expect(h.saveOptions.mock.calls[0][0]).not.toBe(h.persisted);
        expect(h.saveOptions.mock.invocationCallOrder[0]).toBeLessThan(h.applyOptions.mock.invocationCallOrder[0]);
        expect(h.applyOptions).toHaveBeenCalledTimes(1);
        expect(h.close).toHaveBeenCalledTimes(1);
    });

    it('saves duplicate color queries by index and retains alpha on RGB edits', async () => {
        const h = setup();
        input(label(h.root, 'plugin.settings.graph.options.query', { number: 2 }), 'second');
        input(label(h.root, 'plugin.settings.graph.options.color', { number: 2 }), '#abcdef');
        await h.save.click();

        expect(h.saveOptions.mock.calls[0][0].colorGroups).toEqual([
            { query: 'same', color: { a: 0.2, rgb: 100 } },
            { query: 'second', color: { a: 0.8, rgb: 0xabcdef } },
        ]);
        expect(h.persisted.colorGroups[1]).toEqual({ query: 'same', color: { a: 0.8, rgb: 200 } });
    });

    it('keeps other draft edits when color rules are added, removed or reset', async () => {
        const h = setup();
        input(label(h.root, 'plugin.settings.graph.depth.name'), '4');
        const rows = findAllByClass(h.root, 'pa-graph-options__rule');
        await button(rows[1], 'plugin.settings.graphColors.remove').click();
        await button(h.root, 'plugin.settings.graphColors.add').click();
        input(label(h.root, 'plugin.settings.graph.options.query', { number: 2 }), 'temporary');
        await button(findAllByClass(h.root, 'pa-graph-options__rule')[1], 'plugin.settings.graphColors.reset').click();
        await h.save.click();

        expect(h.saveOptions.mock.calls[0][0]).toMatchObject({ localGraph: { depth: 4 }, colorGroups: [
            h.persisted.colorGroups[0], { query: 'path:/', color: { a: 1, rgb: 6617700 } },
        ] });
    });

    it('retains color rules when custom colors are disabled and next-open choices are edited', async () => {
        const h = setup();
        toggle(label(h.root, 'plugin.settings.graphColors.enabled.name'), false);
        expect(byClass(h.root, 'pa-graph-options__colors').hidden).toBe(true);
        const type = label(h.root, 'plugin.settings.graph.options.openAs');
        type.value = 'popover';
        type.onchange?.();
        input(label(h.root, 'plugin.settings.graph.width'), '800');
        toggle(label(h.root, 'plugin.settings.graph.autoColors.name'), true);
        await h.save.click();

        expect(h.saveOptions.mock.calls[0][0]).toMatchObject({
            localGraph: { type: 'popover', resizeStyle: { width: 800, height: 500 }, autoColors: true },
            enableGraphColors: false, colorGroups: h.persisted.colorGroups,
        });
        expect(h.persisted.localGraph.resizeStyle.width).toBe(2400);
    });

    it('keeps the draft after save failure and retries without applying unsaved choices', async () => {
        const h = setup();
        h.saveOptions.mockRejectedValueOnce(new Error('disk'));
        input(label(h.root, 'plugin.settings.graph.depth.name'), '5');
        await h.save.click();

        expect(h.applyOptions).not.toHaveBeenCalled();
        expect(h.status.textContent).toBe(pluginT('plugin.settings.graph.options.saveFailed'));
        expect(h.close).not.toHaveBeenCalled();
        expect(label(h.root, 'plugin.settings.graph.depth.name').value).toBe('5');
        expect(h.save.disabled).toBe(false);
        await h.save.click();
        expect(h.saveOptions).toHaveBeenCalledTimes(2);
        expect(h.saveOptions.mock.calls[1][0].localGraph.depth).toBe(5);
        expect(h.applyOptions).toHaveBeenCalledTimes(1);
    });

    it('distinguishes successful persistence from failed live apply', async () => {
        const h = setup();
        h.applyOptions.mockRejectedValueOnce(new Error('closed leaf'));
        await h.save.click();

        expect(h.saveOptions).toHaveBeenCalledTimes(1);
        expect(h.status.textContent).toBe(pluginT('plugin.settings.graph.options.applyFailed'));
        expect(h.status.textContent).not.toBe(pluginT('plugin.settings.graph.options.saveFailed'));
        expect(h.close).not.toHaveBeenCalled();
        expect(h.save.disabled).toBe(false);
    });

    it('locks duplicate submissions and edits until both save and apply finish', async () => {
        const h = setup();
        const saved = deferred();
        const applied = deferred();
        h.saveOptions.mockImplementationOnce(() => saved.promise);
        h.applyOptions.mockImplementationOnce(() => applied.promise);
        const saving = h.save.click();
        await h.save.onclick?.();
        input(label(h.root, 'plugin.settings.graph.depth.name'), '2');
        expect(h.root.getAttribute('aria-busy')).toBe('true');
        expect(h.saveOptions).toHaveBeenCalledTimes(1);
        expect(h.saveOptions.mock.calls[0][0].localGraph.depth).toBe(9);
        saved.resolve();
        await Promise.resolve();
        await h.save.onclick?.();
        expect(h.saveOptions).toHaveBeenCalledTimes(1);
        expect(h.save.disabled).toBe(true);
        applied.resolve();
        await saving;
        expect(h.close).toHaveBeenCalledTimes(1);
    });

    it.each(['success', 'save failure', 'apply failure'] as const)('does not touch closed DOM after late %s', async (outcome) => {
        const h = setup();
        const pending = deferred();
        h.saveOptions.mockImplementationOnce(() => pending.promise);
        if (outcome === 'apply failure') h.applyOptions.mockRejectedValueOnce(new Error('leaf gone'));
        const saving = h.save.click();
        await h.cancel.click();
        const rootChange = jest.spyOn(h.root, 'setAttribute');
        const statusChange = jest.spyOn(h.status, 'setText');
        if (outcome === 'save failure') pending.reject(new Error('disk'));
        else pending.resolve();
        await saving;

        expect(h.root.children).toHaveLength(0);
        expect(rootChange).not.toHaveBeenCalled();
        expect(statusChange).not.toHaveBeenCalled();
        expect(h.applyOptions).toHaveBeenCalledTimes(outcome === 'save failure' ? 0 : 1);
        if (outcome === 'apply failure') {
            expect((Notice as unknown as { messages: Array<{ message: string }> }).messages.at(-1)?.message)
                .toBe(pluginT('plugin.settings.graph.options.applyFailed'));
        }
    });

    it('keeps a reopened modal independent from the previous save completion', async () => {
        const h = setup();
        const pending = deferred();
        h.saveOptions.mockImplementationOnce(() => pending.promise);
        const saving = h.save.click();
        await h.cancel.click();
        h.modal.onOpen();
        const newStatus = byClass(h.root, 'pa-graph-options__status');
        expect(h.root.getAttribute('aria-busy')).toBe('false');
        pending.resolve();
        await saving;

        expect(h.root.children.length).toBeGreaterThan(0);
        expect(h.close).toHaveBeenCalledTimes(1);
        expect(newStatus.textContent).toBe('');
        expect(button(h.root, 'plugin.settings.graph.options.save').disabled).toBe(false);
    });
});

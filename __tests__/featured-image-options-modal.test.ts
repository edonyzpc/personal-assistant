import type { App } from 'obsidian';
import { DomStubNode, findAllByTag } from './helpers/dom-stub';
import { FeaturedImageOptionsModal, type FeaturedImageOptionsModalHost } from '../src/settings/featured-image-options-modal';
import type { FeaturedImageDefaults, FeaturedImageRunAdmission, FeaturedImageRunOptions } from '../src/ai-services/featured-image-options';
import { pluginT } from '../src/locales/plugin';

jest.mock('../src/settings', () => ({
    normalizeFeaturedImageModel: (value: unknown) => value === 'wan2.7-image-pro' ? value : 'wan2.7-image',
    normalizeFeaturedImageCount: (value: unknown) => Math.min(4, Math.max(1, Math.floor(Number(value)) || 1)),
}));

class ModalElement extends DomStubNode {
    onclick?: () => void | Promise<void>;
    open = false;
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
        for (let node: DomStubNode | null = this; node; node = node.parentElement) {
            if (node.disabled || node.hidden) return;
        }
        return this.onclick?.();
    }
}

const defaults: FeaturedImageDefaults = { featuredImageModel: 'wan2.7-image-pro', numFeaturedImages: 3, featuredImagePath: 'images/featured' };
const admission = (): FeaturedImageRunAdmission => ({
    connection: { aiProvider: 'qwen', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', chatModelName: 'qwen-plus', embeddingModelName: 'text-embedding-v4' },
    imageEndpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    isCurrent: () => true,
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

function setup(host: FeaturedImageOptionsModalHost) {
    const modal = new FeaturedImageOptionsModal({} as App, host);
    const content = new ModalElement('div');
    Object.assign(modal, { contentEl: content, titleEl: new ModalElement('h2') });
    modal.close = jest.fn(() => modal.onClose());
    modal.onOpen();
    const nodes = (tag: string) => findAllByTag(content, tag) as ModalElement[];
    const button = (suffix: string) => nodes('button').find((node) => node.textContent === pluginT(`plugin.settings.featuredImage.options.${suffix}`))!;
    const status = () => nodes('p').find((node) => node.getAttribute('role') === 'status')!;
    return { modal, content, nodes, button, status };
}

describe('FeaturedImageOptionsModal', () => {
    it('opens in edit mode without any work and preserves all existing valid choices', async () => {
        const saveDefaults = jest.fn(async () => undefined);
        const ui = setup({ mode: 'edit', defaults, saveDefaults });
        expect(ui.nodes('select').map((node) => node.value)).toEqual(['wan2.7-image-pro', '3']);
        expect(ui.nodes('input')[0].value).toBe('images/featured');
        expect(ui.nodes('details')[0].open).toBe(false);
        expect(ui.nodes('select')[0].focus).toHaveBeenCalled();
        expect(saveDefaults).not.toHaveBeenCalled();
        ui.nodes('input')[0].value = 'another-folder';
        await ui.button('save').click();
        expect(saveDefaults).toHaveBeenCalledWith({ ...defaults, featuredImagePath: 'another-folder' });
        expect(ui.modal.close).toHaveBeenCalledTimes(1);
    });

    it('opens and cancels generation without preparing admission, saving, or calling a provider', async () => {
        const prepareRun = jest.fn(admission);
        const generate = jest.fn(async () => undefined);
        const saveDefaults = jest.fn(async () => undefined);
        const ui = setup({ mode: 'generate', sourceName: 'Bound note.md', defaults, prepareRun, saveDefaults, generate });
        expect(ui.nodes('p').some((node) => node.textContent === pluginT('plugin.settings.featuredImage.options.source', 'en', { name: 'Bound note.md' }))).toBe(true);
        ui.nodes('select')[1].value = '4';
        await ui.button('cancel').click();
        expect(prepareRun).not.toHaveBeenCalled();
        expect(saveDefaults).not.toHaveBeenCalled();
        expect(generate).not.toHaveBeenCalled();
        expect(defaults.numFeaturedImages).toBe(3);
    });

    it('waits for persistence before handing off immutable options and prevents duplicate submission', async () => {
        const saved = deferred<void>();
        const saveDefaults = jest.fn(() => saved.promise);
        const generate = jest.fn(async (_options: FeaturedImageRunOptions) => undefined);
        const prepareRun = jest.fn(admission);
        const ui = setup({ mode: 'generate', sourceName: 'note.md', defaults, prepareRun, saveDefaults, generate });
        const generating = ui.button('generate').click();
        await ui.button('generate').click();
        expect(saveDefaults).toHaveBeenCalledTimes(1);
        expect(prepareRun).toHaveBeenCalledTimes(1);
        expect(generate).not.toHaveBeenCalled();
        expect(ui.content.getAttribute('aria-busy')).toBe('true');
        saved.resolve();
        await generating;
        expect(generate).toHaveBeenCalledTimes(1);
        const options = generate.mock.calls[0][0];
        expect(options).toMatchObject(defaults);
        expect(Object.isFrozen(options)).toBe(true);
        expect(Object.isFrozen(options.connection)).toBe(true);
        expect(options.isCurrent()).toBe(true);
        expect(ui.modal.close).toHaveBeenCalledTimes(1);
    });

    it('keeps the edited draft after save failure and retries before generation', async () => {
        const saveDefaults = jest.fn<Promise<void>, [FeaturedImageDefaults]>()
            .mockRejectedValueOnce(new Error('storage failed')).mockResolvedValueOnce(undefined);
        const generate = jest.fn(async () => undefined);
        const ui = setup({ mode: 'generate', sourceName: 'note.md', defaults, prepareRun: admission, saveDefaults, generate });
        ui.nodes('select')[0].value = 'wan2.7-image';
        ui.nodes('select')[1].value = '4';
        ui.nodes('input')[0].value = 'edited';
        await ui.button('generate').click();
        expect(generate).not.toHaveBeenCalled();
        expect(ui.status().textContent).toBe(pluginT('plugin.settings.featuredImage.options.saveFailed'));
        expect(ui.nodes('input')[0].value).toBe('edited');
        expect(ui.nodes('select').map((node) => node.value)).toEqual(['wan2.7-image', '4']);
        await ui.button('generate').click();
        expect(saveDefaults).toHaveBeenLastCalledWith({ featuredImageModel: 'wan2.7-image', numFeaturedImages: 4, featuredImagePath: 'edited' });
        expect(generate).toHaveBeenCalledTimes(1);
    });

    it('allows an initiated save to settle after close without late generation or DOM resurrection', async () => {
        const saved = deferred<void>();
        const generate = jest.fn(async () => undefined);
        const ui = setup({ mode: 'generate', sourceName: 'note.md', defaults, prepareRun: admission, saveDefaults: () => saved.promise, generate });
        const generating = ui.button('generate').click();
        await ui.button('cancel').click();
        saved.resolve();
        await generating;
        expect(generate).not.toHaveBeenCalled();
        expect(ui.content.children).toHaveLength(0);
    });

    it('rejects a stale bound target before saving and rechecks identity after saving', async () => {
        const saveDefaults = jest.fn(async () => undefined);
        const generate = jest.fn(async () => undefined);
        const prepareRun = jest.fn<FeaturedImageRunAdmission | null, []>().mockReturnValue(null);
        const ui = setup({ mode: 'generate', sourceName: 'note.md', defaults, prepareRun, saveDefaults, generate });
        await ui.button('generate').click();
        expect(saveDefaults).not.toHaveBeenCalled();
        expect(ui.status().textContent).toBe(pluginT('plugin.settings.featuredImage.options.changed'));
        let current = true;
        prepareRun.mockReturnValue({ ...admission(), isCurrent: () => current });
        saveDefaults.mockImplementationOnce(async () => { current = false; });
        await ui.button('generate').click();
        expect(saveDefaults).toHaveBeenCalledTimes(1);
        expect(generate).not.toHaveBeenCalled();
        expect(ui.status().textContent).toBe(pluginT('plugin.settings.featuredImage.options.savedChanged'));
    });
});

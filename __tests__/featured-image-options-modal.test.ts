import type { App } from 'obsidian';
import { DomStubNode, findAllByTag } from './helpers/dom-stub';
import {
    FeaturedImageOptionsModal,
    mountFeaturedImageOptionsEditor,
    type FeaturedImageOptionsModalHost,
} from '../src/settings/featured-image-options-modal';
import type { FeaturedImageDefaults } from '../src/ai-services/featured-image-options';
import type { ImageGenerationConnection } from '../src/ai-services/image-generation-connection';
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

const nodes = (root: DomStubNode, tag: string) => findAllByTag(root, tag) as ModalElement[];
const button = (root: DomStubNode, suffix: string) => nodes(root, 'button')
    .find(node => node.textContent === pluginT(`plugin.settings.featuredImage.options.${suffix}`))!;

const defaults: FeaturedImageDefaults = {
    featuredImageModel: 'wan2.7-image-pro',
    numFeaturedImages: 3,
    featuredImagePath: 'images/featured',
};

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

function setup(saveDefaults: FeaturedImageOptionsModalHost['saveDefaults'], extra: Partial<FeaturedImageOptionsModalHost> = {}) {
    const modal = new FeaturedImageOptionsModal({} as App, { mode: 'edit', defaults, saveDefaults, ...extra });
    const content = new ModalElement('div');
    Object.assign(modal, { contentEl: content, titleEl: new ModalElement('h2') });
    modal.close = jest.fn(() => modal.onClose());
    modal.onOpen();
    const nodes = (tag: string) => findAllByTag(content, tag) as ModalElement[];
    const button = (suffix: string) => nodes('button').find(node => node.textContent
        === pluginT(`plugin.settings.featuredImage.options.${suffix}`))!;
    const status = () => nodes('p').find(node => node.getAttribute('role') === 'status')!;
    return { modal, content, nodes, button, status };
}

describe('FeaturedImageOptionsModal', () => {
    const openai: ImageGenerationConnection = {
        mode: 'inherit-chat', adapter: 'openai-image', providerId: 'openai', connectionId: 'openai-personal',
        baseURL: 'https://api.openai.com/v1', synchronousEndpoint: 'https://api.openai.com/v1/images/generations',
        asynchronousEndpoint: '', tasksEndpoint: '', credentialSlot: 'pa-openai-test', revision: 1,
        model: 'gpt-image-2.5-flare', sourceImageModel: 'gpt-image-1',
    };

    it('saves an OpenAI source model through the connection owner without writing it to legacy defaults', async () => {
        const saveDefaults = jest.fn(async () => undefined);
        const saveModel = jest.fn(async (_model: string) => undefined);
        const ui = setup(saveDefaults, { connection: openai, saveSourceImageModel: saveModel,
            defaults: { ...defaults, featuredImageModel: 'gpt-image-1', numFeaturedImages: 6 } });
        ui.nodes('select')[0].value = 'gpt-image-2.5-flare';
        await ui.button('save').click();
        expect(saveModel).toHaveBeenCalledWith('gpt-image-2.5-flare');
        expect(saveDefaults).not.toHaveBeenCalled();
        expect(ui.modal.close).toHaveBeenCalledTimes(1);
    });

    it('retains unsupported stored model/count values when saving only an attachment path', async () => {
        const saveDefaults = jest.fn(async () => undefined);
        const saveModel = jest.fn(async (_model: string) => undefined);
        const ui = setup(saveDefaults, { connection: openai, saveSourceImageModel: saveModel,
            defaults: { ...defaults, featuredImageModel: 'old-explicit-model', numFeaturedImages: 12 } });
        expect(ui.nodes('select').map(node => node.value)).toEqual(['old-explicit-model', '12']);
        ui.nodes('input')[0].value = 'new-images';
        await ui.button('save').click();
        expect(saveDefaults).toHaveBeenCalledWith({ featuredImagePath: 'new-images' });
        expect(saveModel).not.toHaveBeenCalled();
    });

    it('reports a saved model plus failed preferences and retries only the remaining draft', async () => {
        const saveDefaults = jest.fn<ReturnType<FeaturedImageOptionsModalHost['saveDefaults']>, Parameters<FeaturedImageOptionsModalHost['saveDefaults']>>()
            .mockRejectedValueOnce(new Error('preferences unavailable')).mockResolvedValue(undefined);
        const saveModel = jest.fn(async (_model: string) => undefined);
        const ui = setup(saveDefaults, { connection: openai, saveSourceImageModel: saveModel,
            defaults: { ...defaults, featuredImageModel: 'gpt-image-1', numFeaturedImages: 6 } });
        ui.nodes('select')[0].value = 'gpt-image-2.5-flare';
        ui.nodes('select')[1].value = '7';
        await ui.button('save').click();
        expect(ui.status().textContent).toBe(pluginT('plugin.settings.featuredImage.options.partiallySaved'));
        expect(ui.modal.close).not.toHaveBeenCalled();
        expect(ui.nodes('select').map(node => node.value)).toEqual(['gpt-image-2.5-flare', '7']);
        await ui.button('save').click();
        expect(saveModel).toHaveBeenCalledTimes(1);
        expect(saveDefaults).toHaveBeenNthCalledWith(1, { numFeaturedImages: 7 });
        expect(saveDefaults).toHaveBeenNthCalledWith(2, { numFeaturedImages: 7 });
        expect(ui.modal.close).toHaveBeenCalledTimes(1);
    });

    it('edits valid existing defaults without invoking a provider surface', async () => {
        const saveDefaults = jest.fn(async () => undefined);
        const ui = setup(saveDefaults);
        expect(ui.nodes('select').map(node => node.value)).toEqual(['wan2.7-image-pro', '3']);
        expect(ui.nodes('input')[0].value).toBe('images/featured');
        ui.nodes('input')[0].value = 'attachments/ai';
        await ui.button('save').click();
        expect(saveDefaults).toHaveBeenCalledWith({ featuredImagePath: 'attachments/ai' });
        expect(ui.modal.close).toHaveBeenCalledTimes(1);
    });

    it('prevents duplicate saves while persistence is pending', async () => {
        const saved = deferred<void>();
        const saveDefaults = jest.fn(() => saved.promise);
        const ui = setup(saveDefaults);
        ui.nodes('select')[0].value = 'wan2.7-image';
        const saving = ui.button('save').click();
        await ui.button('save').click();
        expect(saveDefaults).toHaveBeenCalledTimes(1);
        expect(ui.content.getAttribute('aria-busy')).toBe('true');
        saved.resolve();
        await saving;
        expect(ui.modal.close).toHaveBeenCalledTimes(1);
    });

    it('advances the saved baseline for a same-session reverse edit', async () => {
        const saveDefaults = jest.fn(async () => undefined);
        const content = new ModalElement('div');
        mountFeaturedImageOptionsEditor(content as unknown as HTMLElement, {
            mode: 'edit',
            defaults,
            saveDefaults,
        }, { close: jest.fn(), cancel: jest.fn() });

        nodes(content, 'select')[0].value = 'wan2.7-image';
        await button(content, 'save').click();
        expect(saveDefaults).toHaveBeenLastCalledWith({ featuredImageModel: 'wan2.7-image' });

        nodes(content, 'select')[0].value = 'wan2.7-image-pro';
        await button(content, 'save').click();
        expect(saveDefaults).toHaveBeenLastCalledWith({ featuredImageModel: 'wan2.7-image-pro' });
    });

    it('keeps the edited draft after failure', async () => {
        const saveDefaults = jest.fn(async () => { throw new Error('storage failed'); });
        const ui = setup(saveDefaults);
        ui.nodes('select')[0].value = 'wan2.7-image';
        ui.nodes('select')[1].value = '4';
        ui.nodes('input')[0].value = 'attachments/ai';
        await ui.button('save').click();
        expect(ui.status().textContent).toBe(pluginT('plugin.settings.featuredImage.options.saveFailed'));
        expect(ui.nodes('input')[0].value).toBe('attachments/ai');
        expect(ui.nodes('select').map(node => node.value)).toEqual(['wan2.7-image', '4']);
    });

    it('allows an initiated save to settle after close without resurrecting the DOM', async () => {
        const saved = deferred<void>();
        const saveDefaults = jest.fn(() => saved.promise);
        const ui = setup(saveDefaults);
        ui.nodes('input')[0].value = 'attachments/ai';
        const saving = ui.button('save').click();
        await ui.button('cancel').click();
        saved.resolve();
        await saving;
        expect(ui.content.children).toHaveLength(0);
    });
});

import type { App } from 'obsidian';
import { DomStubNode, findAllByTag } from './helpers/dom-stub';
import { FeaturedImageOptionsModal, type FeaturedImageOptionsModalHost } from '../src/settings/featured-image-options-modal';
import type { FeaturedImageDefaults } from '../src/ai-services/featured-image-options';
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

function setup(saveDefaults: FeaturedImageOptionsModalHost['saveDefaults']) {
    const modal = new FeaturedImageOptionsModal({} as App, { mode: 'edit', defaults, saveDefaults });
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
    it('edits valid existing defaults without invoking a provider surface', async () => {
        const saveDefaults = jest.fn(async () => undefined);
        const ui = setup(saveDefaults);
        expect(ui.nodes('select').map(node => node.value)).toEqual(['wan2.7-image-pro', '3']);
        expect(ui.nodes('input')[0].value).toBe('images/featured');
        ui.nodes('input')[0].value = 'attachments/ai';
        await ui.button('save').click();
        expect(saveDefaults).toHaveBeenCalledWith({ ...defaults, featuredImagePath: 'attachments/ai' });
        expect(ui.modal.close).toHaveBeenCalledTimes(1);
    });

    it('prevents duplicate saves while persistence is pending', async () => {
        const saved = deferred<void>();
        const saveDefaults = jest.fn(() => saved.promise);
        const ui = setup(saveDefaults);
        const saving = ui.button('save').click();
        await ui.button('save').click();
        expect(saveDefaults).toHaveBeenCalledTimes(1);
        expect(ui.content.getAttribute('aria-busy')).toBe('true');
        saved.resolve();
        await saving;
        expect(ui.modal.close).toHaveBeenCalledTimes(1);
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
        const saving = ui.button('save').click();
        await ui.button('cancel').click();
        saved.resolve();
        await saving;
        expect(ui.content.children).toHaveLength(0);
    });
});

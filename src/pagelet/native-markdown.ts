import { Component, MarkdownRenderer, type App } from 'obsidian';
import { pageletT, type PageletLocale } from '../locales/pagelet';
import { NativeMarkdownBridge } from '../ui/native-markdown-bridge';
import { el } from './dom-utils';

/** One native owner for one Pagelet body; actions and update controls stay outside. */
export class PageletNativeMarkdown {
    readonly controls: HTMLElement;
    private readonly bridge: NativeMarkdownBridge;
    private disposed = false;

    constructor(readonly host: HTMLElement, options: {
        app?: App;
        locale: PageletLocale;
        visible: boolean;
        fallback(host: HTMLElement, markdown: string): void;
        onLayout(): void;
    }) {
        this.controls = el('div', 'pa-pagelet-native-update');
        this.controls.hidden = true;
        this.controls.appendChild(el('span', undefined, pageletT('pagelet.ui.contentUpdated', options.locale)));
        const latest = el('button', 'pa-pagelet-native-show-latest', pageletT('pagelet.ui.showLatest', options.locale));
        latest.setAttribute('type', 'button');
        latest.addEventListener('click', () => this.bridge.showLatest());
        this.controls.appendChild(latest);
        this.bridge = new NativeMarkdownBridge(host, host.ownerDocument, {
            createOwner: () => { const owner = new Component(); owner.load(); return owner; },
            unloadOwner: owner => owner?.unload(),
            createBuffer: () => host.ownerDocument.win.createDiv(),
            prepare: (input, phase) => ({ input, markdown: input.content, mermaidSources: [],
                deferred: false, attachStaging: false, phase }),
            render: (prepared, buffer, owner) => {
                if (options.app && owner && prepared.phase === 'primary') {
                    return MarkdownRenderer.render(options.app, prepared.markdown, buffer, prepared.input.sourcePath, owner);
                }
                options.fallback(buffer, prepared.markdown);
                return Promise.resolve();
            },
            renderError: (prepared, buffer) => { buffer.textContent = prepared.markdown; },
            shouldFallback: () => true,
            canPublish: () => !this.disposed,
            onPublish: () => options.onLayout(),
            onStateChange: state => {
                this.controls.hidden = !state.updateAvailable || state.disposed;
                if (!state.rendering && !state.disposed) options.onLayout();
            },
        });
        this.setVisible(options.visible);
    }

    update(markdown: string, sourcePath: string): void {
        void this.bridge.request({ content: markdown, sourcePath, mode: 'full', deferMermaid: false });
    }

    isReady(): boolean { return !this.bridge.getState().rendering; }
    setVisible(visible: boolean): void { this.bridge.setDisplayPaused('view', !visible); }
    rebindDocument(): void { this.bridge.rebindDocument(this.host.ownerDocument); }
    dispose(): void {
        this.disposed = true;
        this.bridge.dispose();
        this.controls.remove();
    }
}

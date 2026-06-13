import { setIcon, Component, Modal, MarkdownRenderer } from 'obsidian';
import type PluginManager from '../main';
import { getPluginUiLanguage, pluginT } from '../locales/plugin';
import { toError } from "../error-utils";

export type MermaidFenceTransform = {
    markdown: string;
    deferred: boolean;
    sources: string[];
};

let mermaidPreviewModalId = 0;

function mermaidT(key: string, params?: Readonly<Record<string, string | number>>): string {
    return pluginT(key, getPluginUiLanguage(), params);
}

export function renderMarkdownWithOwner(
    plugin: PluginManager,
    markdown: string,
    target: HTMLElement,
    owner: Component,
): Promise<void> {
    try {
        return Promise.resolve(MarkdownRenderer.render(plugin.app, markdown, target, '', owner));
    } catch (error) {
        return Promise.reject(toError(error));
    }
}

export function createFencedCodeBlock(language: string, source: string): string {
    const fence = source.includes('```') ? '~~~~' : '```';
    const normalizedSource = source.endsWith('\n') ? source : `${source}\n`;
    return `${fence}${language}\n${normalizedSource}${fence}`;
}

export class MermaidPreviewModal extends Modal {
    private renderOwner: Component | null = null;

    constructor(
        private readonly plugin: PluginManager,
        private readonly mermaidSource: string,
    ) {
        super(plugin.app);
    }

    onOpen() {
        const { contentEl } = this;
        const titleId = `pa-chat-mermaid-modal-title-${++mermaidPreviewModalId}`;
        this.modalEl.classList.add('pa-chat-mermaid-modal-shell');
        contentEl.empty();
        contentEl.classList.add('pa-chat-mermaid-modal');
        contentEl.createEl('h2', {
            text: mermaidT('plugin.mermaid.title'),
            attr: { id: titleId },
        });
        this.modalEl.setAttribute('aria-labelledby', titleId);
        const viewport = contentEl.createDiv({ cls: 'pa-chat-mermaid-modal-viewport' });
        this.renderOwner = new Component();
        void renderMarkdownWithOwner(
            this.plugin,
            createFencedCodeBlock('mermaid', this.mermaidSource),
            viewport,
            this.renderOwner,
        ).then(() => {
            const diagrams = Array.from(
                viewport.querySelectorAll('.mermaid, .block-language-mermaid'),
            ) as HTMLElement[];
            for (const diagram of diagrams) {
                diagram.classList.add('pa-chat-mermaid-modal-diagram');
            }
        }).catch((error) => {
            viewport.setText(mermaidT('plugin.mermaid.renderFailed', { error: String(error) }));
        });
    }

    onClose() {
        this.renderOwner?.unload();
        this.renderOwner = null;
    }
}

export function transformMermaidFences(markdown: string, defer: boolean): MermaidFenceTransform {
    const lines = markdown.match(/[^\n]*(?:\n|$)/g)?.filter((line, index, all) =>
        index < all.length - 1 || line.length > 0
    ) ?? [];
    const output: string[] = [];
    const sources: string[] = [];
    let deferred = false;
    let activeFence: {
        marker: '`' | '~';
        length: number;
        mermaid: boolean;
        sourceLines: string[];
    } | null = null;

    for (const rawLine of lines) {
        const newlineMatch = rawLine.match(/(\r?\n)$/);
        const newline = newlineMatch?.[1] ?? '';
        const line = newline ? rawLine.slice(0, -newline.length) : rawLine;

        if (activeFence) {
            const close = parseFenceClose(line);
            if (
                close
                && close.marker === activeFence.marker
                && close.length >= activeFence.length
            ) {
                if (activeFence.mermaid) {
                    sources.push(activeFence.sourceLines.join(''));
                }
                activeFence = null;
                output.push(rawLine);
                continue;
            }

            if (activeFence.mermaid) {
                activeFence.sourceLines.push(rawLine);
            }
            output.push(rawLine);
            continue;
        }

        const open = parseFenceOpen(line);
        if (!open) {
            output.push(rawLine);
            continue;
        }

        const language = open.info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
        const mermaid = language === 'mermaid';
        activeFence = {
            marker: open.marker,
            length: open.length,
            mermaid,
            sourceLines: [],
        };

        if (mermaid && defer) {
            deferred = true;
            output.push(`${open.prefix}${open.fence}${open.spacing}${open.info.replace(/^mermaid\b/i, 'text')}${newline}`);
        } else {
            output.push(rawLine);
        }
    }

    return {
        markdown: output.join(''),
        deferred,
        sources,
    };
}

export function containsMermaidFence(markdown: string): boolean {
    return transformMermaidFences(markdown, true).deferred;
}

export function deferMermaidFences(markdown: string): MermaidFenceTransform {
    return transformMermaidFences(markdown, true);
}

export function getMermaidFenceSources(markdown: string): string[] {
    return transformMermaidFences(markdown, false).sources;
}

export function parseFenceOpen(line: string): {
    prefix: string;
    fence: string;
    marker: '`' | '~';
    length: number;
    spacing: string;
    info: string;
} | null {
    const match = line.match(/^((?:[ \t]{0,3}>[ \t]?)*[ \t]{0,3})(`{3,}|~{3,})([ \t]*)([^\r\n]*)$/);
    if (!match) return null;
    const fence = match[2];
    return {
        prefix: match[1],
        fence,
        marker: fence[0] as '`' | '~',
        length: fence.length,
        spacing: match[3],
        info: match[4],
    };
}

export function parseFenceClose(line: string): { marker: '`' | '~'; length: number } | null {
    const match = line.match(/^(?:[ \t]{0,3}>[ \t]?)*[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/);
    if (!match) return null;
    return {
        marker: match[1][0] as '`' | '~',
        length: match[1].length,
    };
}

export function hasAncestorWithClass(element: HTMLElement, className: string): boolean {
    let current = element.parentElement;
    while (current) {
        if (current.classList.contains(className)) return true;
        current = current.parentElement;
    }
    return false;
}

export function isMermaidDiagramCandidate(element: HTMLElement): boolean {
    return element.classList.contains('mermaid') || element.classList.contains('block-language-mermaid');
}

export function hasAncestorMermaidDiagramCandidate(element: HTMLElement, root: HTMLElement): boolean {
    let current = element.parentElement;
    while (current && current !== root) {
        if (isMermaidDiagramCandidate(current)) return true;
        current = current.parentElement;
    }
    return false;
}

export function getTopLevelMermaidDiagramCandidates(root: HTMLElement): HTMLElement[] {
    return (Array.from(
        root.querySelectorAll('.mermaid, .block-language-mermaid'),
    ) as HTMLElement[]).filter((diagram) => !hasAncestorMermaidDiagramCandidate(diagram, root));
}

export function nodeContainsMermaidDiagramCandidate(node: Node): boolean {
    const element = node as HTMLElement;
    if (!element?.classList) return false;
    if (isMermaidDiagramCandidate(element)) return true;
    return typeof element.querySelectorAll === 'function'
        && element.querySelectorAll('.mermaid, .block-language-mermaid').length > 0;
}

export function mutationMayAffectMermaidDiagrams(records: MutationRecord[]): boolean {
    return records.some((record) => {
        if (record.type === 'attributes') {
            return nodeContainsMermaidDiagramCandidate(record.target);
        }
        if (record.type !== 'childList') return false;
        return Array.from(record.addedNodes).some(nodeContainsMermaidDiagramCandidate);
    });
}

export function createElement<K extends keyof HTMLElementTagNameMap>(tagName: K): HTMLElementTagNameMap[K] | null {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
    return document.createElement(tagName);
}

export function renderMermaidSourceWarning(buffer: HTMLElement) {
    buffer.createDiv({
        cls: 'pa-chat-render-warning',
        text: mermaidT('plugin.mermaid.sourceWarning'),
    });
}

export function enhanceMermaidDiagrams(root: HTMLElement, plugin: PluginManager, mermaidSources: string[]): boolean {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return true;

    const diagrams = getTopLevelMermaidDiagramCandidates(root);
    const expectedCount = mermaidSources.filter((source) => source.trim()).length;
    if (expectedCount > 1 && diagrams.length < expectedCount) {
        // Source-specific preview buttons are positional, so wait until all rendered
        // Mermaid candidates are present before binding sources to buttons.
        return false;
    }

    let sourceIndex = 0;
    diagrams.forEach((diagram) => {
        sourceIndex += 1;
        const mermaidSource = mermaidSources[sourceIndex - 1];
        if (!diagram.parentElement || hasAncestorWithClass(diagram, 'pa-chat-mermaid-shell')) return;
        if (!mermaidSource?.trim()) return;

        const shell = createElement('div');
        const toolbar = createElement('div');
        const viewport = createElement('div');
        const button = createElement('button');
        const label = createElement('span');
        if (!shell || !toolbar || !viewport || !button || !label) return;

        shell.classList.add('pa-chat-mermaid-shell');
        toolbar.classList.add('pa-chat-mermaid-toolbar');
        viewport.classList.add('pa-chat-mermaid-viewport');
        button.classList.add('pa-chat-mermaid-open-button');
        button.type = 'button';
        button.setAttribute('aria-label', mermaidT('plugin.mermaid.open'));
        button.setAttribute('title', mermaidT('plugin.mermaid.open'));
        setIcon(button, 'zoom-in');
        label.classList.add('pa-sr-only');
        label.textContent = mermaidT('plugin.mermaid.open');
        button.appendChild(label);
        button.onclick = () => {
            new MermaidPreviewModal(plugin, mermaidSource).open();
        };

        diagram.parentElement.insertBefore(shell, diagram);
        viewport.appendChild(diagram);
        toolbar.appendChild(button);
        shell.appendChild(toolbar);
        shell.appendChild(viewport);
    });

    return expectedCount === 0
        || root.querySelectorAll('.pa-chat-mermaid-shell').length >= expectedCount;
}

export function scheduleMermaidEnhancement(
    root: HTMLElement,
    plugin: PluginManager,
    mermaidSources: string[],
    isCurrent: () => boolean,
    owner?: Component,
) {
    if (mermaidSources.length === 0) return;

    let stopped = false;
    let observer: MutationObserver | null = null;
    let fallbackFrameCount = 0;
    let fallbackFrameId: number | null = null;
    let observerFrameId: number | null = null;
    let timeoutId: number | null = null;

    const stop = () => {
        stopped = true;
        observer?.disconnect();
        observer = null;
        if (
            fallbackFrameId !== null
            && typeof window !== 'undefined'
            && typeof window.cancelAnimationFrame === 'function'
        ) {
            window.cancelAnimationFrame(fallbackFrameId);
        }
        fallbackFrameId = null;
        if (
            observerFrameId !== null
            && typeof window !== 'undefined'
            && typeof window.cancelAnimationFrame === 'function'
        ) {
            window.cancelAnimationFrame(observerFrameId);
        }
        observerFrameId = null;
        if (
            timeoutId !== null
            && typeof window !== 'undefined'
            && typeof window.clearTimeout === 'function'
        ) {
            window.clearTimeout(timeoutId);
        }
        timeoutId = null;
    };

    owner?.register(stop);

    const enhanceIfCurrent = (): boolean => {
        if (stopped) return true;
        if (!isCurrent()) {
            stop();
            return true;
        }
        const complete = enhanceMermaidDiagrams(root, plugin, mermaidSources);
        if (complete) stop();
        return complete;
    };

    const scheduleObservedEnhancement = () => {
        if (stopped || observerFrameId !== null) return;
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            observerFrameId = window.requestAnimationFrame(() => {
                observerFrameId = null;
                enhanceIfCurrent();
            });
            return;
        }
        enhanceIfCurrent();
    };

    if (enhanceIfCurrent()) return;

    if (typeof MutationObserver === 'function') {
        observer = new MutationObserver((records) => {
            if (!mutationMayAffectMermaidDiagrams(records)) return;
            scheduleObservedEnhancement();
        });
        observer.observe(root, {
            attributes: true,
            attributeFilter: ['class'],
            childList: true,
            subtree: true,
        });
    } else if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        const retryWithAnimationFrame = () => {
            fallbackFrameCount += 1;
            if (enhanceIfCurrent() || fallbackFrameCount >= 60) {
                stop();
                return;
            }
            fallbackFrameId = window.requestAnimationFrame(retryWithAnimationFrame);
        };
        fallbackFrameId = window.requestAnimationFrame(retryWithAnimationFrame);
    }

    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
        timeoutId = window.setTimeout(stop, 15000);
    }
}

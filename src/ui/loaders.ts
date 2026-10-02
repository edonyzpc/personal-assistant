/**
 * Quantum, Dot Pulse, Mirage and Ping adapted from ldrs 1.1.7.
 * Copyright (c) 2022 Griffin Johnston. MIT; see licenses/ldrs-MIT.txt.
 * Animation rules live in custom.pcss so Obsidian owns stylesheet loading.
 */
import { getOptionalPlatformDocument } from '../platform-dom';

export interface LoaderOptions {
    size?: number;
    speed?: number;
    color?: string;
}

function createLoader(
    parent: HTMLElement,
    kind: string,
    defaults: Required<LoaderOptions>,
    options: LoaderOptions,
): HTMLSpanElement {
    const element = parent.createSpan({
        cls: `pa-loader pa-loader-${kind}`,
        attr: { 'aria-hidden': 'true' },
    });
    element.setCssProps({
        '--pa-loader-size': `${options.size ?? defaults.size}px`,
        '--pa-loader-speed': `${options.speed ?? defaults.speed}s`,
        '--pa-loader-color': options.color ?? defaults.color,
    });
    return element;
}

export function createQuantumLoader(parent: HTMLElement, options: LoaderOptions = {}): HTMLSpanElement {
    const element = createLoader(parent, 'quantum', { size: 45, speed: 1.75, color: 'black' }, options);
    const container = element.createSpan({ cls: 'pa-loader-container' });
    for (let index = 0; index < 13; index += 1) {
        container.createSpan({ cls: 'pa-loader-particle' });
    }
    return element;
}

export function createDotPulseLoader(parent: HTMLElement, options: LoaderOptions = {}): HTMLSpanElement {
    const element = createLoader(parent, 'dot-pulse', { size: 43, speed: 1.3, color: 'black' }, options);
    element.createSpan({ cls: 'pa-loader-container' }).createSpan({ cls: 'pa-loader-dot' });
    return element;
}

export function createPingLoader(parent: HTMLElement, options: LoaderOptions = {}): HTMLSpanElement {
    const element = createLoader(parent, 'ping', { size: 45, speed: 2, color: 'black' }, options);
    element.createSpan({ cls: 'pa-loader-container' });
    return element;
}

let mirageId = 0;

export function createMirageLoader(parent: HTMLElement, options: LoaderOptions = {}): HTMLSpanElement {
    const element = createLoader(parent, 'mirage', { size: 60, speed: 2.5, color: 'black' }, options);
    const size = options.size ?? 60;
    const height = size * 0.23;
    const doc = parent.ownerDocument ?? getOptionalPlatformDocument();
    if (!doc) throw new Error('Document is unavailable.');
    const svgNode = (tag: string, attributes: Record<string, string> = {}): SVGElement => {
        const node = doc.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
        return node;
    };
    const svg = svgNode('svg', {
        class: 'pa-loader-svg', viewBox: `0 0 ${size} ${height}`,
        width: String(size), height: String(height), preserveAspectRatio: 'xMidYMid meet',
        focusable: 'false',
    });
    // Shadow DOM previously isolated this ID; native SVG instances need distinct references.
    const filterId = `pa-loader-mirage-ooze-${++mirageId}`;
    svg.setAttribute('filter', `url(#${filterId})`);
    for (let index = 0; index < 5; index += 1) svg.appendChild(svgNode('circle', { class: 'pa-loader-dot' }));
    const filter = svgNode('filter', { id: filterId });
    filter.appendChild(svgNode('feGaussianBlur', {
        in: 'SourceGraphic', stdDeviation: String(Math.trunc(size) / 20), result: 'blur',
    }));
    filter.appendChild(svgNode('feColorMatrix', {
        in: 'blur', mode: 'matrix', values: '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7', result: 'ooze',
    }));
    filter.appendChild(svgNode('feBlend', { in: 'SourceGraphic', in2: 'ooze' }));
    const defs = svgNode('defs');
    defs.appendChild(filter);
    svg.appendChild(defs);
    element.createSpan({ cls: 'pa-loader-container' }).appendChild(svg);
    return element;
}

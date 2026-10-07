import { createDotPulseLoader, createMirageLoader, createPingLoader, createQuantumLoader } from '../src/ui/loaders';
import { DomStubNode, findAllByClass, findAllByTag } from './helpers/dom-stub';
import { readFileSync } from 'node:fs';
import { parse } from 'postcss';
import { installObsidianDocumentHelpers } from './helpers/obsidian-dom';

class LoaderNode extends DomStubNode {
    readonly ownerDocument: {
        createElementNS(namespace: string, tag: string): LoaderNode;
        win: Window;
    } = installObsidianDocumentHelpers({
        createElementNS: (_namespace: string, tag: string) => {
            const node = new LoaderNode(tag, 'svg');
            Object.defineProperty(node, 'ownerDocument', { value: this.ownerDocument });
            return node;
        },
    });

    createSpan(options: { cls: string; attr?: Record<string, string> }): LoaderNode {
        const child = new LoaderNode('span');
        child.className = options.cls;
        for (const [key, value] of Object.entries(options.attr ?? {})) child.setAttribute(key, value);
        return this.appendChild(child);
    }

    setCssProps(props: Record<string, string>): void {
        for (const [key, value] of Object.entries(props)) this.style.setProperty(key, value);
    }
}

describe('native loaders', () => {
    it('overrides every animated loader part with equal-specificity reduced-motion rules', () => {
        const stylesheet = parse(readFileSync('src/custom.pcss', 'utf8'));
        const reducedSelectors = new Set<string>();
        stylesheet.walkAtRules('media', media => {
            if (media.params !== '(prefers-reduced-motion: reduce)') return;
            media.walkRules(rule => {
                if (rule.nodes.some(node => node.type === 'decl' && node.prop === 'animation' && node.value === 'none')) {
                    rule.selectors.forEach(selector => reducedSelectors.add(selector.replace(/::(before|after)/g, ':$1')));
                }
            });
        });
        const animatedSelectors: string[] = [];
        stylesheet.walkRules(rule => {
            if (!rule.nodes.some(node => node.type === 'decl' && node.prop === 'animation' && node.value.startsWith('pa-loader-'))) return;
            rule.selectors.forEach(selector => animatedSelectors.push(selector.replace(/\.pa-loader-(quantum|dot-pulse|mirage|ping)(?=\s)/, '.pa-loader')));
        });
        expect(animatedSelectors.length).toBeGreaterThan(0);
        for (const selector of animatedSelectors) expect(reducedSelectors.has(selector)).toBe(true);
    });

    it.each([
        [createQuantumLoader, 'quantum', '45px', '1.75s'],
        [createDotPulseLoader, 'dot-pulse', '43px', '1.3s'],
        [createMirageLoader, 'mirage', '60px', '2.5s'],
        [createPingLoader, 'ping', '45px', '2s'],
    ] as const)('preserves defaults and caller settings for %s', (create, kind, size, speed) => {
        const parent = new LoaderNode('div');
        const defaultLoader = create(parent as unknown as HTMLElement) as unknown as LoaderNode;
        expect(defaultLoader.classList.contains(`pa-loader-${kind}`)).toBe(true);
        expect(defaultLoader.getAttribute('aria-hidden')).toBe('true');
        expect(defaultLoader.style.props.get('--pa-loader-size')).toBe(size);
        expect(defaultLoader.style.props.get('--pa-loader-speed')).toBe(speed);
        const customLoader = create(parent as unknown as HTMLElement, { size: 16, speed: 1.75, color: 'currentColor' }) as unknown as LoaderNode;
        expect(customLoader.style.props.get('--pa-loader-size')).toBe('16px');
        expect(customLoader.style.props.get('--pa-loader-speed')).toBe('1.75s');
        expect(customLoader.style.props.get('--pa-loader-color')).toBe('currentColor');
        expect(findAllByTag(parent, 'style')).toHaveLength(0);
    });

    it('keeps every Quantum particle and isolates Mirage filters across instances', () => {
        const parent = new LoaderNode('div');
        createQuantumLoader(parent as unknown as HTMLElement);
        expect(findAllByClass(parent, 'pa-loader-particle')).toHaveLength(13);
        createMirageLoader(parent as unknown as HTMLElement, { size: 40 });
        createMirageLoader(parent as unknown as HTMLElement);
        const svgs = findAllByTag(parent, 'svg');
        const filters = findAllByTag(parent, 'filter');
        expect(svgs.every(svg => svg.namespace === 'svg')).toBe(true);
        expect(svgs.every(svg => (svg as LoaderNode).ownerDocument === parent.ownerDocument)).toBe(true);
        expect(findAllByTag(parent, 'circle')).toHaveLength(10);
        expect(filters[0].getAttribute('id')).not.toBe(filters[1].getAttribute('id'));
        svgs.forEach((svg, index) => expect(svg.getAttribute('filter')).toBe(`url(#${filters[index].getAttribute('id')})`));
        const viewBox = svgs[0].getAttribute('viewBox')?.split(' ').map(Number);
        expect(viewBox?.slice(0, 3)).toEqual([0, 0, 40]);
        expect(viewBox?.[3]).toBeCloseTo(9.2);
    });
});

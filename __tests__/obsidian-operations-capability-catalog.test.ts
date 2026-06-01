import { describe, expect, it } from '@jest/globals';

import {
    OBSIDIAN_OPERATIONS_CAPABILITY_CATALOG,
    buildObsidianOperationsPlannerGuidance,
    getObsidianOperationsCatalogSection,
} from '../src/ai-services/obsidian-operations-capability-catalog';
import { ToolRegistry } from '../src/ai-services/chat-tools';

describe('Obsidian Operations capability catalog', () => {
    it('contains the required local sections', () => {
        expect(OBSIDIAN_OPERATIONS_CAPABILITY_CATALOG.map((section) => section.id)).toEqual([
            'markdown',
            'canvas',
            'cli-target-semantics',
            'safety',
        ]);
    });

    it('distills Markdown structure rules without write semantics in planner guidance', () => {
        const markdown = getObsidianOperationsCatalogSection('markdown');
        const text = [
            markdown.summary,
            ...markdown.plannerGuidance,
        ].join(' ');

        expect(text).toContain('properties');
        expect(text).toContain('tags');
        expect(text).toContain('headings');
        expect(text).toContain('tasks');
        expect(text).toContain('callouts');
        expect(text).toContain('wikilinks');
        expect(text).toContain('embeds');
        expect(text).toContain('Mermaid');
        expect(text).toContain('footnotes');
    });

    it('distills Canvas structure rules and broken-structure concepts', () => {
        const canvas = getObsidianOperationsCatalogSection('canvas');
        const text = [
            canvas.summary,
            ...canvas.plannerGuidance,
        ].join(' ');

        expect(text).toContain('node');
        expect(text).toContain('edge');
        expect(text).toContain('duplicate ids');
        expect(text).toContain('dangling');
        expect(text).toContain('isolated nodes');
        expect(text).toContain('groups');
    });

    it('keeps CLI catalog content to target semantics instead of command execution', () => {
        const cli = getObsidianOperationsCatalogSection('cli-target-semantics');
        const guidance = cli.plannerGuidance.join(' ');

        expect(guidance).toContain('vault');
        expect(guidance).toContain('file');
        expect(guidance).toContain('path');
        expect(guidance).toContain('target concepts');
    });

    it('keeps safety language separate from Memory references and prohibited actions', () => {
        const safety = getObsidianOperationsCatalogSection('safety');
        const text = safety.plannerGuidance.join(' ');

        expect(text).toContain('untrusted read-only context');
        expect(text).toContain('Memory references');
        expect(text).toContain('Do not claim writes');
    });

    it('builds concise future planner guidance from selected sections', () => {
        const guidance = buildObsidianOperationsPlannerGuidance(['markdown', 'safety']);

        expect(guidance.length).toBeGreaterThan(0);
        expect(guidance.every((line) => line.startsWith('[markdown]') || line.startsWith('[safety]'))).toBe(true);
        expect(guidance.join('\n')).toContain('properties');
        expect(guidance.join('\n')).toContain('untrusted read-only context');
    });

    it('does not register Obsidian Operations tools during SPEC-01', () => {
        const registry = new ToolRegistry();

        expect(registry.has('inspect_obsidian_note')).toBe(false);
        expect(registry.has('read_canvas_summary')).toBe(false);
        expect(registry.has('search_vault_snippets')).toBe(false);
        expect(registry.has('list_vault_tags')).toBe(false);
    });
});

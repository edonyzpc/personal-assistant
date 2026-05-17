import { describe, expect, it } from '@jest/globals';

import {
    OBSIDIAN_OPERATIONS_CAPABILITY_CATALOG,
    assertObsidianOperationsCatalogValid,
    buildObsidianOperationsPlannerGuidance,
    getObsidianOperationsCatalogSection,
    validateObsidianOperationsCatalog,
    type ObsidianOperationsCatalogSection,
} from '../src/ai-services/obsidian-operations-capability-catalog';
import { ToolRegistry } from '../src/ai-services/chat-tools';

describe('Obsidian Operations capability catalog', () => {
    it('contains the required local sections', () => {
        expect(() => assertObsidianOperationsCatalogValid()).not.toThrow();

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
            ...markdown.representativeQueries,
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
        expect(markdown.negativeExamples.map((example) => example.userQuery).join(' ')).toContain('Append');
        expect(markdown.negativeExamples.map((example) => example.userQuery).join(' ')).toContain('Delete');
    });

    it('distills Canvas structure rules and broken-structure concepts', () => {
        const canvas = getObsidianOperationsCatalogSection('canvas');
        const text = [
            canvas.summary,
            ...canvas.plannerGuidance,
            ...canvas.representativeQueries,
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
        expect(cli.negativeExamples.map((example) => example.userQuery).join(' ')).toContain('shell command');
    });

    it('keeps safety language separate from Memory references and prohibited actions', () => {
        const safety = getObsidianOperationsCatalogSection('safety');
        const text = safety.plannerGuidance.join(' ');

        expect(text).toContain('untrusted read-only context');
        expect(text).toContain('Memory references');
        expect(text).toContain('Do not claim writes');
        expect(safety.negativeExamples.map((example) => example.userQuery).join(' ')).toContain('Install');
        expect(safety.negativeExamples.map((example) => example.userQuery).join(' ')).toContain('eval');
    });

    it('builds concise future planner guidance from selected sections', () => {
        const guidance = buildObsidianOperationsPlannerGuidance(['markdown', 'safety']);

        expect(guidance.length).toBeGreaterThan(0);
        expect(guidance.every((line) => line.startsWith('[markdown]') || line.startsWith('[safety]'))).toBe(true);
        expect(guidance.join('\n')).toContain('properties');
        expect(guidance.join('\n')).toContain('untrusted read-only context');
    });

    it('fails validation when a required section is missing', () => {
        const partial = OBSIDIAN_OPERATIONS_CAPABILITY_CATALOG.filter((section) => section.id !== 'canvas');
        const result = validateObsidianOperationsCatalog(partial);

        expect(result.ok).toBe(false);
        expect(result.errors).toContain('Catalog is missing required section: canvas');
    });

    it('fails validation when guidance exceeds its prompt budget', () => {
        const catalog = OBSIDIAN_OPERATIONS_CAPABILITY_CATALOG.map((section) => section.id === 'markdown'
            ? {
                ...section,
                promptBudgetChars: 1,
            }
            : section);
        const result = validateObsidianOperationsCatalog(catalog);

        expect(result.ok).toBe(false);
        expect(result.errors).toContain('markdown planner guidance exceeds prompt budget.');
    });

    it('fails validation when forbidden semantics appear outside negative examples', () => {
        const catalog = OBSIDIAN_OPERATIONS_CAPABILITY_CATALOG.map((section): ObsidianOperationsCatalogSection => section.id === 'markdown'
            ? {
                ...section,
                representativeQueries: [
                    ...section.representativeQueries,
                    'Please delete my current note now.',
                ],
            }
            : section);
        const result = validateObsidianOperationsCatalog(catalog);

        expect(result.ok).toBe(false);
        expect(result.errors).toContain('markdown contains forbidden semantic outside negative examples: delete');
    });

    it('does not register Obsidian Operations tools during SPEC-01', () => {
        const registry = new ToolRegistry();

        expect(registry.has('inspect_obsidian_note')).toBe(false);
        expect(registry.has('read_canvas_summary')).toBe(false);
        expect(registry.has('search_vault_snippets')).toBe(false);
        expect(registry.has('list_vault_tags')).toBe(false);
    });
});

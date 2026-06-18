import { describe, expect, it } from '@jest/globals';
import {
    PAGELET_RELATED_NOTES_QUERY_CONTENT_CHARS,
    buildPageletRelatedNotesQuery,
} from '../src/pagelet/related-notes-query';

describe('buildPageletRelatedNotesQuery', () => {
    it('keeps related-note queries inside the interactive embedding budget', () => {
        const content = 'a'.repeat(PAGELET_RELATED_NOTES_QUERY_CONTENT_CHARS + 120);

        const query = buildPageletRelatedNotesQuery({
            path: 'folder/Pagelet Smoke Golden.md',
            content,
        });

        expect(query).toContain('Title: Pagelet Smoke Golden');
        expect(query).toContain('Path: folder/Pagelet Smoke Golden.md');
        expect(query).toContain('a'.repeat(PAGELET_RELATED_NOTES_QUERY_CONTENT_CHARS));
        expect(query).not.toContain('a'.repeat(PAGELET_RELATED_NOTES_QUERY_CONTENT_CHARS + 1));
    });

    it('uses path context even when the note body is blank', () => {
        expect(buildPageletRelatedNotesQuery({
            path: 'Daily/2026-06-17.md',
            content: '   ',
        })).toBe('Title: 2026-06-17\n\nPath: Daily/2026-06-17.md');
    });
});

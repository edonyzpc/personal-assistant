/** Presence remains generated even when a partial/local edit damages the detail. */
export function hasWritingNoteProvenance(frontmatter: Record<string, unknown> | undefined): boolean {
    return !!frontmatter && Object.prototype.hasOwnProperty.call(frontmatter, 'pa_writing');
}

export const WRITING_NOTE_PROVENANCE_KEY = 'pa_writing';

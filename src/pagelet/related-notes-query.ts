export const PAGELET_RELATED_NOTES_QUERY_CONTENT_CHARS = 800;

export interface PageletRelatedNotesQueryInput {
    path: string;
    content: string;
}

export function buildPageletRelatedNotesQuery(input: PageletRelatedNotesQueryInput): string {
    const filename = input.path.split("/").pop() ?? input.path;
    const title = filename.replace(/\.md$/i, "").trim();
    const excerpt = input.content.trim().slice(0, PAGELET_RELATED_NOTES_QUERY_CONTENT_CHARS);
    return [
        title ? `Title: ${title}` : "",
        input.path ? `Path: ${input.path}` : "",
        excerpt,
    ].filter(Boolean).join("\n\n");
}

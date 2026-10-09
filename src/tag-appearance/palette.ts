const TAG_COLORS = [
    'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red',
] as const;

export type TagColor = typeof TAG_COLORS[number];

/** Normalize only the color key; callers keep the native tag text unchanged. */
export function normalizeTagName(name: string): string {
    return (name.startsWith('#') ? name.slice(1) : name).toLowerCase();
}

export function getTagColor(name: string): TagColor {
    let hash = 2166136261;
    const bytes = new TextEncoder().encode(normalizeTagName(name));
    for (const byte of bytes) {
        hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    }
    // This slot order is persistent behavior: palette edits must not reorder it.
    return TAG_COLORS[hash % TAG_COLORS.length];
}

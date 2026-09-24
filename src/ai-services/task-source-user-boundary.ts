/**
 * Find literal vault paths so the Agent can refer to real Host note handles.
 * A path mention is identity data, never a judgment about what may be read.
 */
export function extractTaskSourcePathMentions(userText: string): readonly string[] {
    const paths = new Set<string>();
    const pattern = /`([^`\r\n]+\.md)`|([^\s`"'“”‘’《》，。；;<>]+\.md)/gi;
    for (const match of userText.matchAll(pattern)) {
        const path = (match[1] ?? match[2]).trim();
        if (path) paths.add(path);
    }
    return [...paths];
}

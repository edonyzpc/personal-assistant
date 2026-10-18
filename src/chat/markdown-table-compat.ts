import MarkdownIt, { type Token } from 'markdown-it';

type MarkdownItInstance = ReturnType<typeof MarkdownIt>;

let tableStructureParser: MarkdownItInstance | null = null;

function getTableStructureParser(): MarkdownItInstance {
    tableStructureParser ??= new MarkdownIt({ html: true }).disable('inline');
    return tableStructureParser;
}

function isTableCompatibilityCandidate(source: string): boolean {
    return source.includes('\n') && source.includes('|') && source.includes('-')
        && !/\r(?!\n)/.test(source);
}

function getLineStarts(source: string): number[] {
    const lineStarts = [0];
    for (let index = source.indexOf('\n'); index !== -1; index = source.indexOf('\n', index + 1)) {
        lineStarts.push(index + 1);
    }
    return lineStarts;
}

export function prepareChatMarkdownForDisplay(source: string): string {
    if (!isTableCompatibilityCandidate(source)) return source;

    const tokens = getTableStructureParser().parse(source, {});
    const lineStarts = getLineStarts(source);
    const insertionOffsets: number[] = [];
    let previousMappedBlock: Token | undefined;
    for (const token of tokens) {
        if (token.level !== 0 || !token.map) continue;
        if (
            token.type === 'table_open'
            && previousMappedBlock?.type === 'paragraph_open'
            && previousMappedBlock.map?.[1] === token.map[0]
        ) {
            insertionOffsets.push(lineStarts[token.map[0]]);
        }
        previousMappedBlock = token;
    }
    if (insertionOffsets.length === 0) return source;

    for (let index = insertionOffsets.length - 1; index >= 0; index -= 1) {
        const offset = insertionOffsets[index];
        const lineBreak = source.slice(0, offset).endsWith('\r\n') ? '\r\n' : '\n';
        source = source.slice(0, offset) + lineBreak + source.slice(offset);
    }
    return source;
}

export interface RepeatedSourceContent {
    encoding: "adjacent-repeats-v1";
    segments: Array<{ text: string; count: number }>;
}

const MAX_REPEAT_SEGMENTS = 128;

/** Linear scan; only adjacent identical sentence/line pieces share a repeat count. */
export function encodeAdjacentRepeats(content: string): RepeatedSourceContent | undefined {
    const segments: RepeatedSourceContent["segments"] = [];
    let literalStart = 0;
    let runStart = 0;
    let runEnd = 0;
    let runText = "";
    let count = 0;
    const flushRun = () => {
        if (count > 1) {
            if (literalStart < runStart) segments.push({ text: content.slice(literalStart, runStart), count: 1 });
            segments.push({ text: runText, count });
            literalStart = runEnd;
        }
        return segments.length <= MAX_REPEAT_SEGMENTS;
    };
    for (let start = 0; start < content.length;) {
        let end = start;
        while (end < content.length) {
            const code = content.charCodeAt(end++);
            if (code === 13 || code === 10) {
                if (code === 13 && content.charCodeAt(end) === 10) end++;
                break;
            }
            if (isSentenceBoundary(code)) {
                while (isSentenceBoundary(content.charCodeAt(end))) end++;
                break;
            }
        }
        // Preserve all separator bytes/code units, including CRLF and blank lines.
        while (end < content.length && /\s/u.test(content.charAt(end))) end++;
        const text = content.slice(start, end);
        if (count > 0 && text === runText) {
            count++;
            runEnd = end;
        } else {
            if (!flushRun()) return undefined;
            runStart = start;
            runEnd = end;
            runText = text;
            count = 1;
        }
        start = end;
    }
    if (!flushRun() || segments.length === 0) return undefined;
    if (literalStart < content.length) segments.push({ text: content.slice(literalStart), count: 1 });
    if (segments.length > MAX_REPEAT_SEGMENTS) return undefined;
    const encoded: RepeatedSourceContent = { encoding: "adjacent-repeats-v1", segments };
    // Content is JSON inside the user message and escaped again in the full request.
    // All surrounding request fields are identical, so this is its exact size delta.
    return JSON.stringify(JSON.stringify(encoded)).length < JSON.stringify(JSON.stringify(content)).length ? encoded : undefined;
}

function isSentenceBoundary(code: number): boolean {
    return code === 46 || code === 33 || code === 63
        || code === 0x3002 || code === 0xff01 || code === 0xff1f;
}

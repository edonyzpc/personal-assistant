import type { Token } from "markdown-it";

export interface InlineSourceRange {
    rawStart: number;
    rawEnd: number;
}

interface InlineSourceMapMeta {
    sourceOffsets?: number[];
    sourceCandidates?: number[];
}

export function getTokenSourceRange(token: Token): InlineSourceRange | null {
    const meta = token.meta as Partial<InlineSourceRange> | null | undefined;
    if (typeof meta?.rawStart !== "number" || typeof meta.rawEnd !== "number") return null;
    if (!Number.isInteger(meta.rawStart)
        || !Number.isInteger(meta.rawEnd)
        || meta.rawStart < 0
        || meta.rawEnd <= meta.rawStart) {
        return null;
    }
    return { rawStart: meta.rawStart, rawEnd: meta.rawEnd };
}

export function mapInlineRangeToSource(
    inlineToken: Token,
    range: InlineSourceRange,
    explicitSourceStart?: number,
): InlineSourceRange {
    if (explicitSourceStart !== undefined) {
        return {
            rawStart: explicitSourceStart + range.rawStart,
            rawEnd: explicitSourceStart + range.rawEnd,
        };
    }
    const meta = inlineToken.meta as InlineSourceMapMeta | null | undefined;
    const offsets = meta?.sourceOffsets;
    if (Array.isArray(offsets)) {
        if (range.rawEnd > offsets.length
            || typeof offsets[range.rawStart] !== "number"
            || typeof offsets[range.rawEnd - 1] !== "number") {
            throw new Error("Unable to map Ghost inline token range to its source snapshot.");
        }
        return {
            rawStart: offsets[range.rawStart],
            rawEnd: offsets[range.rawEnd - 1] + 1,
        };
    }
    const candidates = meta?.sourceCandidates ?? [];
    if (candidates.length === 1) {
        return {
            rawStart: candidates[0] + range.rawStart,
            rawEnd: candidates[0] + range.rawEnd,
        };
    }
    throw new Error("Unable to identify a unique Ghost inline source range.");
}

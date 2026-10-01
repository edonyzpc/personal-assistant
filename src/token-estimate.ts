/** Approximation only; provider usage is the measurement authority. */
export function estimateApproximateTokens(text: string): number {
    const { cjk, other } = countTokenCharacters(text);
    return cjk + Math.ceil(other / 4);
}

/** Counts may be accumulated across text slices before applying the final rounding. */
export function countTokenCharacters(text: string): { cjk: number; other: number } {
    if (typeof text !== 'string') return { cjk: 0, other: 0 };
    let cjk = 0;
    let other = 0;
    for (const character of text) {
        const code = character.codePointAt(0)!;
        if ((code >= 0x3400 && code <= 0x4DBF)
            || (code >= 0x4E00 && code <= 0x9FFF)
            || (code >= 0xF900 && code <= 0xFAFF)
            || (code >= 0x20000 && code <= 0x2A6DF)
            || (code >= 0x2A700 && code <= 0x2B73F)
            || (code >= 0x2B740 && code <= 0x2B81F)
            || (code >= 0x2B820 && code <= 0x2CEAF)) cjk++;
        else other++;
    }
    return { cjk, other };
}

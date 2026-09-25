/** Approximation only; provider usage is the measurement authority. */
export function estimateApproximateTokens(text: string): number {
    if (!text) return 0;
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
    return cjk + Math.ceil(other / 4);
}

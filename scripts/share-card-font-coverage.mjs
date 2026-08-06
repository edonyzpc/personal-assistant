export function parseShareCardFontCodePoints(text) {
    const codePoints = new Set();
    for (const rawLine of text.split(/\r?\n/u)) {
        const line = rawLine.replace(/#.*/u, "").trim();
        if (!line) continue;
        if (line === "GB2312-LEVEL-1") {
            for (let lead = 0xB0; lead <= 0xD7; lead += 1) {
                const finalTrail = lead === 0xD7 ? 0xF9 : 0xFE;
                for (let trail = 0xA1; trail <= finalTrail; trail += 1) {
                    const character = new TextDecoder("gb18030", { fatal: true }).decode(
                        Uint8Array.of(lead, trail),
                    );
                    codePoints.add(character.codePointAt(0));
                }
            }
            continue;
        }
        const [startText, endText = startText] = line.split("-");
        const start = Number.parseInt(startText, 16);
        const end = Number.parseInt(endText, 16);
        if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || end > 0x10FFFF) {
            throw new Error(`Invalid code-point range: ${rawLine}.`);
        }
        for (let codePoint = start; codePoint <= end; codePoint += 1) codePoints.add(codePoint);
    }
    return [...codePoints].sort((left, right) => left - right);
}

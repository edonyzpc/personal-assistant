/* Copyright 2023 edonyzpc */

import type { LocalFont } from "@zumer/snapdom";

const FONT_FAMILY = "Source Han Serif SC";

let fontDataUrl: string | null = null;
let fontFace: FontFace | null = null;
let loadPromise: Promise<string> | null = null;
let registerPromise: Promise<void> | null = null;

async function decodeFontBinary(): Promise<string> {
    // @ts-expect-error -- binary handled by lazyBinaryPlugin in esbuild
    const { getBinaryAsync } = await import("./source-han-serif-sc-subset.woff2");
    const binary: Uint8Array = await getBinaryAsync();
    let encoded = "";
    const chunk = 32768;
    for (let offset = 0; offset < binary.length; offset += chunk) {
        encoded += String.fromCharCode(
            ...binary.subarray(offset, Math.min(offset + chunk, binary.length)),
        );
    }
    return `data:font/woff2;base64,${btoa(encoded)}`;
}

/**
 * Lazy-load and decode the bundled Source Han Serif SC subset.
 * Returns a data-URL suitable for FontFace and SnapDOM localFonts.
 * The decoded result is cached; subsequent calls return immediately.
 */
export async function loadShareCardFont(): Promise<string> {
    if (fontDataUrl) return fontDataUrl;
    if (!loadPromise) {
        loadPromise = decodeFontBinary().then((url) => {
            fontDataUrl = url;
            return url;
        }).catch((err) => {
            loadPromise = null;
            throw err;
        });
    }
    return loadPromise;
}

/**
 * Register the card font via the FontFace API so the browser uses it for
 * layout measurement during pagination. Call once before rendering card pages.
 * The renderer's existing `waitForFonts()` awaits `document.fonts.ready`.
 */
export async function registerShareCardFontFace(doc: Document): Promise<void> {
    if (fontFace) return;
    if (!registerPromise) {
        registerPromise = (async () => {
            const url = await loadShareCardFont();
            const face = new FontFace(FONT_FAMILY, `url(${url})`, {
                weight: "400",
                style: "normal",
                display: "swap",
            });
            (doc.fonts as unknown as Set<FontFace>).add(face);
            await face.load();
            fontFace = face;
        })().catch((err) => {
            registerPromise = null;
            throw err;
        });
    }
    return registerPromise;
}

/**
 * Remove the registered FontFace to reclaim browser memory (~6MB).
 * Call when the Share Card modal closes.
 */
export function unregisterShareCardFontFace(doc: Document): void {
    if (!fontFace) return;
    try {
        (doc.fonts as unknown as Set<FontFace>).delete(fontFace);
    } catch {
        // Ignore if already removed or not supported
    }
    fontFace = null;
}

/**
 * Build the SnapDOM `localFonts` array for card PNG capture.
 * SnapDOM embeds this data into the SVG intermediate representation,
 * ensuring the serif font renders in the final PNG regardless of system fonts.
 */
export async function getShareCardLocalFonts(): Promise<LocalFont[]> {
    const src = await loadShareCardFont();
    return [
        {
            family: FONT_FAMILY,
            src,
            weight: "400",
            style: "normal",
        },
    ];
}

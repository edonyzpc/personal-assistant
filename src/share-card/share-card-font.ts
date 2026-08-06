/* Copyright 2023 edonyzpc */

import type { LocalFont } from "@zumer/snapdom";

/** Internal family name avoids Adobe's reserved `Source` font name for this modified subset. */
export const SHARE_CARD_FONT_FAMILY = "PA Share Serif";

interface DocumentFontState {
    face: FontFace | null;
    loading: Promise<void>;
    references: number;
    added: boolean;
}

let fontDataUrl: string | null = null;
let loadPromise: Promise<string> | null = null;
const documentFontStates = new WeakMap<Document, DocumentFontState>();

async function loadBundledFontDataUrl(): Promise<string> {
    const { getShareCardFontDataUrlAsync } = await import(
        "./source-han-serif-sc-subset.woff2"
    );
    return getShareCardFontDataUrlAsync();
}

/** Lazy-load and decode the bundled Source Han Serif-derived subset. */
export async function loadShareCardFont(): Promise<string> {
    if (fontDataUrl) return fontDataUrl;
    if (!loadPromise) {
        loadPromise = loadBundledFontDataUrl().then((url) => {
            fontDataUrl = url;
            return url;
        }).catch((error) => {
            loadPromise = null;
            throw error;
        });
    }
    return loadPromise;
}

/**
 * Acquire one per-Document FontFace reference for preview measurement.
 * Concurrent modals share one load; the final release removes only that document's face.
 */
export async function registerShareCardFontFace(doc: Document): Promise<void> {
    let state = documentFontStates.get(doc);
    if (!state) {
        state = createDocumentFontState(doc);
        documentFontStates.set(doc, state);
    }
    state.references += 1;
    try {
        await state.loading;
    } catch (error) {
        state.references = Math.max(0, state.references - 1);
        if (state.references === 0 && documentFontStates.get(doc) === state) {
            documentFontStates.delete(doc);
        }
        throw error;
    }
}

/** Release one FontFace reference. Safe to call while the face is still loading. */
export function unregisterShareCardFontFace(doc: Document): void {
    const state = documentFontStates.get(doc);
    if (!state || state.references === 0) return;
    state.references -= 1;
    if (state.references > 0) return;
    if (state.face && state.added) {
        try {
            (doc.fonts as unknown as Set<FontFace>).delete(state.face);
        } catch {
            // The owner document may already be tearing down.
        }
        state.added = false;
    }
    if (documentFontStates.get(doc) === state) documentFontStates.delete(doc);
}

function createDocumentFontState(doc: Document): DocumentFontState {
    const state: DocumentFontState = {
        face: null,
        loading: Promise.resolve(),
        references: 0,
        added: false,
    };
    state.loading = (async () => {
        const url = await loadShareCardFont();
        const FontFaceCtor = doc.defaultView?.FontFace ?? globalThis.FontFace;
        if (typeof FontFaceCtor !== "function") {
            throw new Error("FontFace API is unavailable for Share Card rendering.");
        }
        const face = new FontFaceCtor(SHARE_CARD_FONT_FAMILY, `url(${url})`, {
            weight: "400",
            style: "normal",
            display: "swap",
        });
        await face.load();
        state.face = face;
        if (state.references > 0 && documentFontStates.get(doc) === state) {
            (doc.fonts as unknown as Set<FontFace>).add(face);
            state.added = true;
        }
    })();
    return state;
}

/** Build the exact local face descriptor used to generate SnapDOM artifact CSS. */
export async function getShareCardLocalFonts(): Promise<LocalFont[]> {
    const src = await loadShareCardFont();
    if (!src.startsWith("data:font/woff2;base64,")) {
        throw new Error("Share Card bundled font must be an inline WOFF2 data URL.");
    }
    return [{
        family: SHARE_CARD_FONT_FAMILY,
        src,
        weight: "400",
        style: "normal",
    }];
}

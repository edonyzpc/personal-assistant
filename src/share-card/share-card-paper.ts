/* Copyright 2023 edonyzpc */

import type { ShareCardTheme } from "./share-card-types";
import { DARK_PAPER_DATA_URI, LIGHT_PAPER_DATA_URI } from "./share-card-paper-data";

const paperReadiness = new WeakMap<Document, Map<ShareCardTheme, Promise<void>>>();

export function getPaperDataUri(theme: ShareCardTheme): string {
    return theme === "dark" ? DARK_PAPER_DATA_URI : LIGHT_PAPER_DATA_URI;
}

/** Root CSS backgrounds are outside the renderer's body-image readiness pass. */
export function ensurePaperReady(ownerDocument: Document, theme: ShareCardTheme): Promise<void> {
    let themes = paperReadiness.get(ownerDocument);
    if (!themes) {
        themes = new Map();
        paperReadiness.set(ownerDocument, themes);
    }
    const cached = themes.get(theme);
    if (cached) return cached;

    const image = ownerDocument.win.createEl("img");
    image.src = getPaperDataUri(theme);
    const pending = image.decode().catch((error: unknown) => {
        themes.delete(theme);
        throw error;
    });
    themes.set(theme, pending);
    return pending;
}

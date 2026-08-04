/* Copyright 2023 edonyzpc */

/** The source surface that opened a Share Card. */
export type ShareCardSource = "chat" | "pagelet" | "selection";

/** The visual theme is locked when the Share Card modal opens. */
export type ShareCardTheme = "light" | "dark";

/** Text already held by an explicit Share Card entry point. */
export interface ShareCardData {
    content: string;
    source: ShareCardSource;
    sourceLabel?: string;
    sourcePath?: string;
}

/** One measured page, using a zero-based page index. */
export interface CardPage {
    pageIndex: number;
    totalPages: number;
    content: string;
}

/** Truthful result for a sequential Vault save operation. */
export interface ShareCardSaveResult {
    savedPaths: string[];
    attempted: number;
    failedPageIndex?: number;
}

/** Fixed CSS-pixel dimensions of the capture target. */
export const CARD_WIDTH = 540;
export const CARD_HEIGHT = 720;

/** Fixed export density. A 540 x 720 card becomes a 1080 x 1440 PNG. */
export const CARD_DPR = 2;
export const CARD_OUTPUT_WIDTH = CARD_WIDTH * CARD_DPR;
export const CARD_OUTPUT_HEIGHT = CARD_HEIGHT * CARD_DPR;

/** Compatibility alias for capture adapters that describe DPR as scale. */
export const CARD_SCALE = CARD_DPR;

/** Hard, non-truncating v1 limits. */
export const MAX_SHARE_CARD_CHARACTERS = 50_000;
export const MAX_SHARE_CARD_PAGES = 24;

/** Compatibility aliases for callers that use shorter constant names. */
export const MAX_CONTENT_CHARS = MAX_SHARE_CARD_CHARACTERS;
export const MAX_CARD_PAGES = MAX_SHARE_CARD_PAGES;

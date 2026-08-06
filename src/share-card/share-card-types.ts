/* Copyright 2023 edonyzpc */

/** The source surface that opened a Share Card. */
export type ShareCardSource = "chat" | "pagelet" | "selection" | "note";

/** The visual theme is locked when the Share Card modal opens. */
export type ShareCardTheme = "light" | "dark";

/** Resolution-only context; values are never rendered into the card. */
export interface ShareCardResourceContext {
    basePath?: string;
}

/** Text already held by an explicit Share Card entry point. */
export interface ShareCardData {
    content: string;
    source: ShareCardSource;
    sourceLabel?: string;
    resourceContext?: ShareCardResourceContext;
}

/** One measured page, using a zero-based page index. */
export interface CardPage {
    pageIndex: number;
    totalPages: number;
    content: string;
    /** @internal Non-enumerable source identity used only by the static renderer. */
    readonly renderPlan?: ShareCardRenderPlan;
}

/** @internal Exact source identity for one static DOM segment on a card page. */
export interface ShareCardRenderPlanSegment {
    blockIndex: number;
    sourceStart: number;
    sourceEnd: number;
    markdown: string;
}

/** @internal Never serialized into ShareCardData or export payloads. */
export interface ShareCardRenderPlan {
    segments: readonly ShareCardRenderPlanSegment[];
}

/** Attach renderer-only metadata without changing JSON or public page equality. */
export function attachShareCardRenderPlan(
    page: CardPage,
    renderPlan: ShareCardRenderPlan,
): CardPage {
    Object.defineProperty(page, "renderPlan", {
        configurable: false,
        enumerable: false,
        value: renderPlan,
        writable: false,
    });
    return page;
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

/** Strip backtick-delimited inline code spans, preserving surrounding text. */
export function stripInlineCode(line: string): string {
    let output = "";
    let cursor = 0;
    while (cursor < line.length) {
        const start = line.indexOf("`", cursor);
        if (start < 0) return output + line.slice(cursor);
        let markerEnd = start + 1;
        while (line.charAt(markerEnd) === "`") markerEnd += 1;
        const marker = line.slice(start, markerEnd);
        const end = line.indexOf(marker, markerEnd);
        output += line.slice(cursor, start);
        if (end < 0) return output + line.slice(start);
        cursor = end + marker.length;
    }
    return output;
}

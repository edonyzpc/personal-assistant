/* Copyright 2023 edonyzpc */

import type { BubbleExplanationState } from "./types";

export interface BubbleStateContext {
    memoryReady: boolean;
    memoryPreparing: boolean;
    proactiveHintsEnabled: boolean;
    isMarkdownNote: boolean;
    noteContentLength: number;
    isDataBoundaryExcluded: boolean;
    pageletEnabled: boolean;
}

const MIN_NOTE_CONTENT_LENGTH = 50;

export function resolveBubbleExplanationState(ctx: BubbleStateContext): BubbleExplanationState {
    if (!ctx.pageletEnabled) return "intentionally-quiet";
    if (ctx.isDataBoundaryExcluded) return "context-limited-boundary";
    if (!ctx.memoryReady && !ctx.memoryPreparing) return "needs-setup";
    if (ctx.memoryPreparing) return "preparing";
    if (!ctx.isMarkdownNote || ctx.noteContentLength < MIN_NOTE_CONTENT_LENGTH) return "context-limited-short";
    if (!ctx.proactiveHintsEnabled) return "intentionally-quiet";
    return "ready-empty";
}

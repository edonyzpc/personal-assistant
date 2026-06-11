/* Copyright 2023 edonyzpc */

/**
 * Pagelet v2 — Write Action barrel exports (Phase 4 / Operations Agent mode).
 */

export { PageletActionExecutor } from "./ActionExecutor";
export type { ActionLogger } from "./ActionExecutor";

export type {
    ActionResult,
    AppendToDailyAction,
    ApplySuggestionAction,
    CreateTaskAction,
    PageletAction,
    PageletActionType,
} from "./types";

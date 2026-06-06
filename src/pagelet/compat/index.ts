/* Copyright 2023 edonyzpc */

/**
 * Pagelet — compatibility / a11y compat module barrel.
 *
 * Track B · B5 deliverable. Houses the bits that exist purely to
 * mediate with Obsidian itself (view-type gating, debounce, ribbon
 * placement, the Cmd+/ focus jump-in command) rather than the review
 * pipeline.
 *
 * Internal types stay internal; only the surface Track C / plugin
 * bootstrap consumes is re-exported here.
 */

export {
    PAGELET_ELIGIBLE_VIEW_TYPE,
    getActiveMarkdownView,
    isPageletEligibleView,
    type PageletViewTypeProbe,
    type PageletWorkspaceLike,
} from "./view-type";

export {
    PAGELET_DEFAULT_DEBOUNCE_MS,
    PAGELET_DEFAULT_IDEMPOTENCY_TTL_MS,
    PageletCoalescerClearedError,
    PageletReviewCoalescer,
    type PageletCoalescerEntrySnapshot,
    type PageletCoalescerOptions,
    type PageletReviewKey,
} from "./debounce";

export {
    PAGELET_DATA_PLUGIN_VALUE,
    PAGELET_RIBBON_CSS_CLASS,
    PAGELET_RIBBON_DEFAULT_TOOLTIP,
    PAGELET_RIBBON_ICON_ID,
    registerPageletRibbonIcon,
    type PageletRibbonElement,
    type PageletRibbonHost,
    type RegisterPageletRibbonOptions,
    type RegisterPageletRibbonResult,
} from "./ribbon";

export {
    PAGELET_FOCUS_LATEST_COMMAND_ID,
    PAGELET_FOCUS_LATEST_DEFAULT_HOTKEY,
    PAGELET_FOCUSABLE_SELECTORS,
    PAGELET_SUGGESTION_CARD_CLASS,
    findFirstFocusableInCard,
    findFirstSuggestionCard,
    findFocusTargetForCommand,
    registerPageletFocusCommand,
    type PageletCommandDefinition,
    type PageletCommandHost,
    type PageletFocusableElement,
    type PageletHotkey,
    type PageletQueryRoot,
    type RegisterPageletFocusCommandOptions,
} from "./focus-command";

export {
    PAGELET_OPEN_PANEL_COMMAND_ID,
    PAGELET_REVIEW_CURRENT_COMMAND_ID,
    registerPageletOpenPanelCommand,
    registerPageletReviewCurrentCommand,
    type RegisterPageletOpenPanelCommandOptions,
    type RegisterPageletReviewCurrentCommandOptions,
} from "./review-command";

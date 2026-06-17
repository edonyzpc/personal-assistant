export type {
    ConfinementConfig,
    ConfirmationOutcome,
    DebugErrorCategory,
    DebugEvent,
    DebugEventType,
    DebugObserver,
    PreviewSpec,
    TargetSnapshot,
    WriteActionCapability,
    WriteActionExecuteHooks,
    WriteActionFamily,
} from "./types";

export {
    ConfinementConfigError,
    DEFAULT_MAX_PATH_LENGTH,
    validateAllowedRoots,
    validateAppendConfinement,
    validateTargetConfinement,
    validateTargetConfinementSync,
} from "./target-confinement";
export type {
    AppendConfinementResult,
    ConfinementFsProbe,
    ConfinementRejectReason,
    ConfinementResult,
} from "./target-confinement";

export {
    combineDebugObservers,
    ConsoleDebugObserver,
    NOOP_DEBUG_OBSERVER,
    NoopDebugObserver,
} from "./debug-observer";

export {
    checkStaleReread,
    takeSnapshot,
} from "./stale-reread";
export type {
    StaleDriftDetail,
    StaleReadProbe,
    StaleReadResult,
} from "./stale-reread";

export {
    createDefaultObsidianPreviewRenderer,
    createMutexPreviewRenderer,
    ObsidianPreviewRenderer,
    WriteActionPreviewModal,
} from "./preview-modal";
export type {
    PreviewRenderer,
    PreviewShowOptions,
    PreviewShowResult,
} from "./preview-modal";

export {
    APPEND_CONTENT_MAX_CHARS,
    buildAppendPreview,
    buildBoundaryMarker,
    executeAppendWrite,
    rollbackAppend,
} from "./append-action";
export type {
    AppendActionInput,
    AppendActionResult,
} from "./append-action";

export {
    createActionExecutor,
    createSelfWriteRegistry,
    SELF_WRITE_WINDOW_MS,
} from "./runtime-integration";
export type {
    ActionExecutor,
    ActionExecutorOptions,
    FsProbe,
    FsRemoveProbe,
    SelfWriteRegistry,
    SelfWriteRegistryOptions,
} from "./runtime-integration";

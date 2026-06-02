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
    DEFAULT_MAX_PATH_LENGTH,
    validateTargetConfinement,
    validateTargetConfinementSync,
} from "./target-confinement";
export type {
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
    createActionExecutor,
    createSelfWriteRegistry,
    SELF_WRITE_WINDOW_MS,
} from "./runtime-integration";
export type {
    ActionExecutor,
    ActionExecutorOptions,
    FsProbe,
    SelfWriteRegistry,
    SelfWriteRegistryOptions,
} from "./runtime-integration";

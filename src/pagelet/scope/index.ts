/* Copyright 2023 edonyzpc */

export {
    ChangeDetector,
    InMemoryChangeDetectorStorage,
    LocalStorageChangeDetectorStorage,
} from "./ChangeDetector";
export type { ChangeDetectorState, ChangeDetectorStorage } from "./ChangeDetector";
export { ScopeResolver } from "./ScopeResolver";
export type {
    ExclusionReason,
    ScopeCandidate,
    ScopeConfig,
    ScopeResult,
} from "./types";

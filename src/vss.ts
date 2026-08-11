/* Copyright 2023 edonyzpc */

export { buildFtsQuery, VSS } from "./vss/vss-core";
export type { VSSChangeObservation, VSSRefreshStatus } from "./vss/vss-core";
export type {
    LexicalIndexStatus,
    LexicalProfileMarker,
    LexicalProfileState,
    VSSMemoryStatus,
    VSSMemoryStatusSnapshot,
} from "./vss/types";
export type {
    VSSFlushOptions,
    VSSLexicalRebuildOptions,
    VSSLexicalRebuildSummary,
    VSSOperationOptions,
    VSSOperationSummary,
    VSSProgressEvent,
    VSSProgressPhase,
} from "./vss/vss-maintenance";
export type {
    VSSReconcileOptions,
    VSSReconcileSummary,
    VSSVerifyOptions,
    VSSVerifySummary,
} from "./vss/vss-reconciler";

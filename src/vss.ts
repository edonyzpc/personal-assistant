/* Copyright 2023 edonyzpc */

export { buildFtsQuery, VSS } from "./vss/vss-core";
export type { VSSChangeObservation, VSSRefreshStatus } from "./vss/vss-core";
export type { VSSMemoryStatus, VSSMemoryStatusSnapshot } from "./vss/types";
export type {
    VSSFlushOptions,
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

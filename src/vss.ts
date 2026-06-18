/* Copyright 2023 edonyzpc */

export { buildFtsQuery, VSS } from "./vss/vss-core";
export type { VSSRefreshStatus } from "./vss/vss-core";
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

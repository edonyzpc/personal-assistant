/* Copyright 2023 edonyzpc */

export const DELIVERY_FINGERPRINT_VERSION = 1 as const;
export const ATTENTION_STATE_SCHEMA_VERSION = 1 as const;
export const MAX_SEEN_DELIVERIES = 2_000;

export type DeliveryFingerprintVersion = typeof DELIVERY_FINGERPRINT_VERSION;
export type AttentionStateSchemaVersion = typeof ATTENTION_STATE_SCHEMA_VERSION;
export type DeliveryKind = "recall" | "recap" | "review";
export type DeliveryPresentationSurface = "bubble" | "detail";
export type AttentionExplanationKind = "ready-empty" | "intentionally-quiet";
export type AttentionDeliveryMode = "persisted" | "session-only";

/**
 * Transient capability carried only by the delivery that may become visible.
 * The receipt itself must never be serialized by the attention store.
 */
export interface DeliveryReceipt {
    version: DeliveryFingerprintVersion;
    kind: DeliveryKind;
    fingerprint: string;
}

export interface RecallDeliveryReceiptInput {
    locale?: string | null;
    title?: string | null;
    body?: string | null;
    whyNow?: string | readonly string[] | null;
    excerpt?: string | readonly string[] | null;
    currentSourceIdentity?: string | null;
    recalledSourceIdentities?: readonly string[] | null;
}

export interface StructuredRecapScopeIdentity {
    kind?: string | null;
    label?: string | null;
    paths?: readonly string[] | null;
    tags?: readonly string[] | null;
}

export type RecapScopeIdentity =
    | string
    | StructuredRecapScopeIdentity
    | null
    | undefined;

export interface RecapDeliveryReceiptInput {
    locale?: string | null;
    title?: string | null;
    body?: string | null;
    whyItMatters?: string | readonly string[] | null;
    scopeIdentity?: RecapScopeIdentity;
    sourceIdentities?: readonly string[] | null;
}

export interface ReviewDeliveryReceiptInput {
    locale?: string | null;
    title?: string | null;
    body?: string | null;
    whyNow?: string | readonly string[] | null;
    anchorSourceIdentity?: string | null;
    sourceIdentities?: readonly string[] | null;
}

/** Content-free device-local record derived from a committed receipt. */
export interface DeliverySeenEntry {
    kind: DeliveryKind;
    fingerprint: string;
    seenAt: number;
    surface: DeliveryPresentationSurface;
}

export interface AttentionExplanationAcknowledgement {
    kind: AttentionExplanationKind;
    copyVersion: string;
    acknowledgedAt: number;
}

export interface PageletAttentionPersistedState {
    schemaVersion: AttentionStateSchemaVersion;
    fingerprintVersion: DeliveryFingerprintVersion;
    seen: DeliverySeenEntry[];
    acknowledgements: AttentionExplanationAcknowledgement[];
}

/** Host-provided, Vault-scoped device-local string storage. */
export interface PageletAttentionStorage {
    load(): string | null;
    save(serialized: string): void;
}

export type AttentionDeliveryDiagnosticReason =
    | "storage-unavailable"
    | "storage-read-failed"
    | "storage-parse-failed"
    | "storage-write-failed";

/** Deliberately excludes errors, keys, fingerprints, paths, or user content. */
export interface AttentionDeliveryDiagnostic {
    mode: "session-only";
    reason: AttentionDeliveryDiagnosticReason;
}

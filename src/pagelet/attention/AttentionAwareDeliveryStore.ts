/* Copyright 2023 edonyzpc */

import {
    ATTENTION_STATE_SCHEMA_VERSION,
    DELIVERY_FINGERPRINT_VERSION,
    MAX_SEEN_DELIVERIES,
    type AttentionDeliveryDiagnostic,
    type AttentionDeliveryMode,
    type AttentionExplanationAcknowledgement,
    type AttentionExplanationKind,
    type DeliveryKind,
    type DeliveryPresentationSurface,
    type DeliveryReceipt,
    type DeliverySeenEntry,
    type PageletAttentionPersistedState,
    type PageletAttentionStorage,
} from "./types";

export interface AttentionAwareDeliveryStoreOptions {
    storage?: PageletAttentionStorage;
    now?: () => number;
    onDiagnostic?: (diagnostic: AttentionDeliveryDiagnostic) => void;
}

const DELIVERY_KINDS = ["recall", "recap"] as const;
const DELIVERY_SURFACES = ["bubble", "detail"] as const;
const EXPLANATION_KINDS = ["ready-empty", "intentionally-quiet"] as const;
const STATE_KEYS = [
    "schemaVersion",
    "fingerprintVersion",
    "seen",
    "acknowledgements",
] as const;
const SEEN_ENTRY_KEYS = ["kind", "fingerprint", "seenAt", "surface"] as const;
const ACKNOWLEDGEMENT_KEYS = ["kind", "copyVersion", "acknowledgedAt"] as const;

export class AttentionAwareDeliveryStore {
    private readonly storage?: PageletAttentionStorage;
    private readonly now: () => number;
    private readonly onDiagnostic?: (diagnostic: AttentionDeliveryDiagnostic) => void;
    private readonly seen = new Map<string, DeliverySeenEntry>();
    private readonly acknowledgements = new Map<
        AttentionExplanationKind,
        AttentionExplanationAcknowledgement
    >();
    private currentMode: AttentionDeliveryMode = "persisted";

    constructor(options: AttentionAwareDeliveryStoreOptions = {}) {
        this.storage = options.storage;
        this.now = options.now ?? Date.now;
        this.onDiagnostic = options.onDiagnostic;
        this.initialize();
    }

    mode(): AttentionDeliveryMode {
        return this.currentMode;
    }

    isSeen(receipt: DeliveryReceipt): boolean {
        if (!isValidReceipt(receipt)) return false;
        return this.seen.has(seenKey(receipt.kind, receipt.fingerprint));
    }

    markSeen(receipt: DeliveryReceipt, surface: DeliveryPresentationSurface): void {
        if (!isValidReceipt(receipt) || !includes(DELIVERY_SURFACES, surface)) return;
        const entry: DeliverySeenEntry = {
            kind: receipt.kind,
            fingerprint: receipt.fingerprint,
            seenAt: this.timestamp(),
            surface,
        };
        this.seen.set(seenKey(entry.kind, entry.fingerprint), entry);
        this.evictOldestSeen();
        this.persist();
    }

    isExplanationAcknowledged(
        kind: AttentionExplanationKind,
        copyVersion: string,
    ): boolean {
        if (!includes(EXPLANATION_KINDS, kind) || !isValidCopyVersion(copyVersion)) {
            return false;
        }
        return this.acknowledgements.get(kind)?.copyVersion === copyVersion;
    }

    acknowledgeExplanation(
        kind: AttentionExplanationKind,
        copyVersion: string,
    ): void {
        if (!includes(EXPLANATION_KINDS, kind) || !isValidCopyVersion(copyVersion)) return;
        if (this.isExplanationAcknowledged(kind, copyVersion)) return;
        this.acknowledgements.set(kind, {
            kind,
            copyVersion,
            acknowledgedAt: this.timestamp(),
        });
        this.persist();
    }

    private initialize(): void {
        if (!this.storage) {
            this.lockSessionOnly("storage-unavailable");
            return;
        }

        let raw: string | null;
        try {
            raw = this.storage.load();
        } catch {
            this.lockSessionOnly("storage-read-failed");
            return;
        }
        if (raw === null) return;

        const parsed = parsePersistedState(raw);
        if (!parsed) {
            this.lockSessionOnly("storage-parse-failed");
            return;
        }

        for (const entry of parsed.seen) {
            this.seen.set(seenKey(entry.kind, entry.fingerprint), { ...entry });
        }
        for (const acknowledgement of parsed.acknowledgements) {
            this.acknowledgements.set(acknowledgement.kind, { ...acknowledgement });
        }
    }

    private timestamp(): number {
        const value = this.now();
        return Number.isSafeInteger(value) && value >= 0 ? value : Date.now();
    }

    private evictOldestSeen(): void {
        const overflow = this.seen.size - MAX_SEEN_DELIVERIES;
        if (overflow <= 0) return;
        const oldest = [...this.seen.values()]
            .sort(compareSeenEntries)
            .slice(0, overflow);
        for (const entry of oldest) {
            this.seen.delete(seenKey(entry.kind, entry.fingerprint));
        }
    }

    private persist(): void {
        if (this.currentMode === "session-only" || !this.storage) return;
        try {
            this.storage.save(JSON.stringify(this.buildPersistedState()));
        } catch {
            this.lockSessionOnly("storage-write-failed");
        }
    }

    private buildPersistedState(): PageletAttentionPersistedState {
        return {
            schemaVersion: ATTENTION_STATE_SCHEMA_VERSION,
            fingerprintVersion: DELIVERY_FINGERPRINT_VERSION,
            seen: [...this.seen.values()]
                .sort(compareSeenEntries)
                .map((entry) => ({ ...entry })),
            acknowledgements: [...this.acknowledgements.values()]
                .sort((left, right) => compareStrings(left.kind, right.kind))
                .map((entry) => ({ ...entry })),
        };
    }

    private lockSessionOnly(reason: AttentionDeliveryDiagnostic["reason"]): void {
        if (this.currentMode === "session-only") return;
        this.currentMode = "session-only";
        try {
            this.onDiagnostic?.({
                mode: "session-only",
                reason,
            });
        } catch {
            // Diagnostics must never change delivery behavior.
        }
    }
}

function parsePersistedState(serialized: string): PageletAttentionPersistedState | null {
    let value: unknown;
    try {
        value = JSON.parse(serialized);
    } catch {
        return null;
    }
    if (!isRecordWithExactKeys(value, STATE_KEYS)) return null;
    if (value.schemaVersion !== ATTENTION_STATE_SCHEMA_VERSION) return null;
    if (value.fingerprintVersion !== DELIVERY_FINGERPRINT_VERSION) return null;
    if (!Array.isArray(value.seen) || value.seen.length > MAX_SEEN_DELIVERIES) return null;
    if (!Array.isArray(value.acknowledgements)) return null;

    const seen: DeliverySeenEntry[] = [];
    const seenKeys = new Set<string>();
    for (const candidate of value.seen) {
        const entry = parseSeenEntry(candidate);
        if (!entry) return null;
        const key = seenKey(entry.kind, entry.fingerprint);
        if (seenKeys.has(key)) return null;
        seenKeys.add(key);
        seen.push(entry);
    }

    const acknowledgements: AttentionExplanationAcknowledgement[] = [];
    const acknowledgementKinds = new Set<AttentionExplanationKind>();
    for (const candidate of value.acknowledgements) {
        const acknowledgement = parseAcknowledgement(candidate);
        if (!acknowledgement || acknowledgementKinds.has(acknowledgement.kind)) return null;
        acknowledgementKinds.add(acknowledgement.kind);
        acknowledgements.push(acknowledgement);
    }
    if (acknowledgements.length > EXPLANATION_KINDS.length) return null;

    return {
        schemaVersion: ATTENTION_STATE_SCHEMA_VERSION,
        fingerprintVersion: DELIVERY_FINGERPRINT_VERSION,
        seen,
        acknowledgements,
    };
}

function parseSeenEntry(value: unknown): DeliverySeenEntry | null {
    if (!isRecordWithExactKeys(value, SEEN_ENTRY_KEYS)) return null;
    if (!includes(DELIVERY_KINDS, value.kind)) return null;
    if (!isFingerprintForKind(value.fingerprint, value.kind)) return null;
    if (!isTimestamp(value.seenAt)) return null;
    if (!includes(DELIVERY_SURFACES, value.surface)) return null;
    return {
        kind: value.kind,
        fingerprint: value.fingerprint,
        seenAt: value.seenAt,
        surface: value.surface,
    };
}

function parseAcknowledgement(value: unknown): AttentionExplanationAcknowledgement | null {
    if (!isRecordWithExactKeys(value, ACKNOWLEDGEMENT_KEYS)) return null;
    if (!includes(EXPLANATION_KINDS, value.kind)) return null;
    if (!isValidCopyVersion(value.copyVersion)) return null;
    if (!isTimestamp(value.acknowledgedAt)) return null;
    return {
        kind: value.kind,
        copyVersion: value.copyVersion,
        acknowledgedAt: value.acknowledgedAt,
    };
}

function isValidReceipt(value: DeliveryReceipt): boolean {
    return value.version === DELIVERY_FINGERPRINT_VERSION
        && includes(DELIVERY_KINDS, value.kind)
        && isFingerprintForKind(value.fingerprint, value.kind);
}

function isFingerprintForKind(value: unknown, kind: DeliveryKind): value is string {
    return typeof value === "string"
        && new RegExp(`^v${DELIVERY_FINGERPRINT_VERSION}:${kind}:[0-9a-f]{16}$`, "u").test(value);
}

function isValidCopyVersion(value: unknown): value is string {
    return typeof value === "string"
        && /^[a-z0-9][a-z0-9._:-]{0,63}$/iu.test(value);
}

function isTimestamp(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0;
}

function seenKey(kind: DeliveryKind, fingerprint: string): string {
    return `${kind}\u0000${fingerprint}`;
}

function compareSeenEntries(left: DeliverySeenEntry, right: DeliverySeenEntry): number {
    return left.seenAt - right.seenAt
        || compareStrings(left.kind, right.kind)
        || compareStrings(left.fingerprint, right.fingerprint);
}

function compareStrings(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function includes<const T extends readonly string[]>(
    values: T,
    value: unknown,
): value is T[number] {
    return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isRecordWithExactKeys<const T extends readonly string[]>(
    value: unknown,
    expectedKeys: T,
): value is Record<T[number], unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const keys = Object.keys(value).sort(compareStrings);
    const expected = [...expectedKeys].sort(compareStrings);
    return keys.length === expected.length
        && keys.every((key, index) => key === expected[index]);
}

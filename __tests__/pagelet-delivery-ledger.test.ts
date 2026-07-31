/* Copyright 2023 edonyzpc */

import { describe, expect, it, jest } from "@jest/globals";

import { AttentionAwareDeliveryStore } from "../src/pagelet/attention/AttentionAwareDeliveryStore";
import {
    ATTENTION_STATE_SCHEMA_VERSION,
    DELIVERY_FINGERPRINT_VERSION,
    MAX_SEEN_DELIVERIES,
    type AttentionDeliveryDiagnostic,
    type DeliveryKind,
    type DeliveryReceipt,
    type PageletAttentionPersistedState,
    type PageletAttentionStorage,
} from "../src/pagelet/attention/types";

class MemoryAttentionStorage implements PageletAttentionStorage {
    constructor(public serialized: string | null = null) {}

    load(): string | null {
        return this.serialized;
    }

    save(serialized: string): void {
        this.serialized = serialized;
    }
}

function receipt(index: number, kind: DeliveryKind = "recall"): DeliveryReceipt {
    return {
        version: DELIVERY_FINGERPRINT_VERSION,
        kind,
        fingerprint: `v1:${kind}:${index.toString(16).padStart(16, "0")}`,
    };
}

function emptyState(overrides: Partial<PageletAttentionPersistedState> = {}):
PageletAttentionPersistedState {
    return {
        schemaVersion: ATTENTION_STATE_SCHEMA_VERSION,
        fingerprintVersion: DELIVERY_FINGERPRINT_VERSION,
        seen: [],
        acknowledgements: [],
        ...overrides,
    };
}

describe("AttentionAwareDeliveryStore", () => {
    it("starts empty when persistent state is missing and round-trips content-free seen entries", () => {
        let clock = 100;
        const storage = new MemoryAttentionStorage();
        const first = new AttentionAwareDeliveryStore({
            storage,
            now: () => clock,
        });
        const target = receipt(1);

        expect(first.mode()).toBe("persisted");
        expect(first.isSeen(target)).toBe(false);
        first.markSeen(target, "bubble");
        expect(first.isSeen(target)).toBe(true);

        const persisted = JSON.parse(storage.serialized ?? "") as PageletAttentionPersistedState;
        expect(persisted).toEqual(emptyState({
            seen: [{
                kind: "recall",
                fingerprint: target.fingerprint,
                seenAt: 100,
                surface: "bubble",
            }],
        }));
        expect(JSON.stringify(persisted)).not.toContain("receipt");
        expect(JSON.stringify(persisted)).not.toContain("path");
        expect(JSON.stringify(persisted)).not.toContain("title");

        clock = 200;
        const reloaded = new AttentionAwareDeliveryStore({ storage, now: () => clock });
        expect(reloaded.mode()).toBe("persisted");
        expect(reloaded.isSeen(target)).toBe(true);
    });

    it("updates an existing fingerprint idempotently instead of adding a second entry", () => {
        let clock = 10;
        const storage = new MemoryAttentionStorage();
        const store = new AttentionAwareDeliveryStore({ storage, now: () => clock });
        const target = receipt(2, "recap");

        store.markSeen(target, "bubble");
        clock = 20;
        store.markSeen(target, "detail");

        const persisted = JSON.parse(storage.serialized ?? "") as PageletAttentionPersistedState;
        expect(persisted.seen).toEqual([{
            kind: "recap",
            fingerprint: target.fingerprint,
            seenAt: 20,
            surface: "detail",
        }]);
    });

    it("round-trips Deep Discover review receipts without changing the schema", () => {
        const storage = new MemoryAttentionStorage();
        const target = receipt(42, "review");
        const store = new AttentionAwareDeliveryStore({ storage, now: () => 42 });

        store.markSeen(target, "bubble");

        expect(store.isSeen(target)).toBe(true);
        expect(JSON.parse(storage.serialized ?? "")).toEqual(emptyState({
            seen: [{
                kind: "review",
                fingerprint: target.fingerprint,
                seenAt: 42,
                surface: "bubble",
            }],
        }));
        expect(new AttentionAwareDeliveryStore({ storage }).isSeen(target)).toBe(true);
    });

    it("evicts only the deterministic oldest-seen entry above 2,000 without a TTL", () => {
        const seededSeen = Array.from({ length: MAX_SEEN_DELIVERIES }, (_, index) => ({
            kind: "recall" as const,
            fingerprint: receipt(index).fingerprint,
            seenAt: index,
            surface: "bubble" as const,
        }));
        const storage = new MemoryAttentionStorage(JSON.stringify(emptyState({
            seen: seededSeen,
        })));
        const store = new AttentionAwareDeliveryStore({
            storage,
            now: () => MAX_SEEN_DELIVERIES,
        });

        expect(store.isSeen(receipt(0))).toBe(true);
        store.markSeen(receipt(MAX_SEEN_DELIVERIES), "detail");

        expect(store.isSeen(receipt(0))).toBe(false);
        expect(store.isSeen(receipt(1))).toBe(true);
        expect(store.isSeen(receipt(MAX_SEEN_DELIVERIES))).toBe(true);
        const persisted = JSON.parse(storage.serialized ?? "") as PageletAttentionPersistedState;
        expect(persisted.seen).toHaveLength(MAX_SEEN_DELIVERIES);
    });

    it("does not expire old seen entries by elapsed time", () => {
        const target = receipt(9);
        const storage = new MemoryAttentionStorage(JSON.stringify(emptyState({
            seen: [{
                kind: target.kind,
                fingerprint: target.fingerprint,
                seenAt: 1,
                surface: "bubble",
            }],
        })));
        const store = new AttentionAwareDeliveryStore({
            storage,
            now: () => 9_000_000_000_000,
        });

        expect(store.isSeen(target)).toBe(true);
    });

    it("persists acknowledgement independently by semantic kind and copy version", () => {
        const storage = new MemoryAttentionStorage();
        const store = new AttentionAwareDeliveryStore({
            storage,
            now: () => 500,
        });

        expect(store.isExplanationAcknowledged("ready-empty", "copy-v1")).toBe(false);
        store.acknowledgeExplanation("ready-empty", "copy-v1");
        expect(store.isExplanationAcknowledged("ready-empty", "copy-v1")).toBe(true);
        expect(store.isExplanationAcknowledged("ready-empty", "copy-v2")).toBe(false);
        expect(store.isExplanationAcknowledged("intentionally-quiet", "copy-v1")).toBe(false);

        const reloaded = new AttentionAwareDeliveryStore({ storage });
        expect(reloaded.isExplanationAcknowledged("ready-empty", "copy-v1")).toBe(true);
        reloaded.acknowledgeExplanation("ready-empty", "copy-v2");
        expect(reloaded.isExplanationAcknowledged("ready-empty", "copy-v1")).toBe(false);
        expect(reloaded.isExplanationAcknowledged("ready-empty", "copy-v2")).toBe(true);
    });

    it.each([
        ["invalid JSON", "{not-json"],
        ["wrong schema", JSON.stringify(emptyState({ schemaVersion: 2 as 1 }))],
        ["unknown state field", JSON.stringify({ ...emptyState(), legacySettings: {} })],
        ["unknown entry field", JSON.stringify(emptyState({
            seen: [{
                kind: "recall",
                fingerprint: receipt(3).fingerprint,
                seenAt: 1,
                surface: "bubble",
                title: "must not be accepted",
            }] as unknown as PageletAttentionPersistedState["seen"],
        }))],
        ["review kind with a mismatched fingerprint", JSON.stringify(emptyState({
            seen: [{
                kind: "review",
                fingerprint: receipt(4, "recap").fingerprint,
                seenAt: 1,
                surface: "bubble",
            }],
        }))],
        ["duplicate fingerprint", JSON.stringify(emptyState({
            seen: [
                {
                    kind: "recall",
                    fingerprint: receipt(4).fingerprint,
                    seenAt: 1,
                    surface: "bubble",
                },
                {
                    kind: "recall",
                    fingerprint: receipt(4).fingerprint,
                    seenAt: 2,
                    surface: "detail",
                },
            ],
        }))],
    ])("strictly rejects %s and locks this instance to session-only", (_label, raw) => {
        const diagnostics: AttentionDeliveryDiagnostic[] = [];
        const storage = new MemoryAttentionStorage(raw);
        const store = new AttentionAwareDeliveryStore({
            storage,
            onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
        });

        expect(store.mode()).toBe("session-only");
        expect(diagnostics).toEqual([{
            mode: "session-only",
            reason: "storage-parse-failed",
        }]);
        store.markSeen(receipt(99), "bubble");
        expect(store.isSeen(receipt(99))).toBe(true);
        expect(storage.serialized).toBe(raw);
    });

    it("locks session-only after a read failure and never retries persistent I/O", () => {
        const diagnostics: AttentionDeliveryDiagnostic[] = [];
        const storage = {
            load: jest.fn<() => string | null>(() => {
                throw new Error("private read detail");
            }),
            save: jest.fn<(serialized: string) => void>(),
        };
        const store = new AttentionAwareDeliveryStore({
            storage,
            onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
        });

        store.markSeen(receipt(5), "bubble");
        store.markSeen(receipt(6), "detail");

        expect(store.mode()).toBe("session-only");
        expect(store.isSeen(receipt(5))).toBe(true);
        expect(storage.load).toHaveBeenCalledTimes(1);
        expect(storage.save).not.toHaveBeenCalled();
        expect(diagnostics).toEqual([{
            mode: "session-only",
            reason: "storage-read-failed",
        }]);
        expect(JSON.stringify(diagnostics)).not.toContain("private read detail");
    });

    it("keeps current session truth and stops persistent writes after a write failure", () => {
        const diagnostics: AttentionDeliveryDiagnostic[] = [];
        const storage = {
            load: jest.fn<() => string | null>(() => null),
            save: jest.fn<(serialized: string) => void>(() => {
                throw new Error("quota with private detail");
            }),
        };
        const store = new AttentionAwareDeliveryStore({
            storage,
            onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
        });

        store.markSeen(receipt(7), "bubble");
        store.markSeen(receipt(8), "detail");

        expect(store.mode()).toBe("session-only");
        expect(store.isSeen(receipt(7))).toBe(true);
        expect(store.isSeen(receipt(8))).toBe(true);
        expect(storage.save).toHaveBeenCalledTimes(1);
        expect(diagnostics).toEqual([{
            mode: "session-only",
            reason: "storage-write-failed",
        }]);
        expect(JSON.stringify(diagnostics)).not.toContain("quota");
    });

    it("uses session-only state when no storage is injected and does not migrate legacy settings", () => {
        const diagnostics: AttentionDeliveryDiagnostic[] = [];
        const store = new AttentionAwareDeliveryStore({
            onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
        });

        expect(store.mode()).toBe("session-only");
        expect(store.isSeen(receipt(10))).toBe(false);
        store.markSeen(receipt(10), "bubble");
        expect(store.isSeen(receipt(10))).toBe(true);
        expect(diagnostics).toEqual([{
            mode: "session-only",
            reason: "storage-unavailable",
        }]);
    });
});

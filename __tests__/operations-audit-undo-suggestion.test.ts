import { describe, expect, it } from "@jest/globals";

import { OperationsUndoStore } from "../src/ai-services/operations/operations-undo-store";

describe("OperationsUndoStore", () => {
    it("keeps snapshots in memory with expiry and one-time consumption", () => {
        let now = 1_000;
        const store = new OperationsUndoStore({ now: () => now, ttlMs: 100, createId: () => "receipt" });
        store.create({
            intentId: "intent",
            operationId: "operation",
            path: "notes/a.md",
            kind: "vault_append",
            before: "before",
            expectedAfter: "after",
        });
        expect(store.get("receipt")).toMatchObject({ ok: true });
        store.markUsed("receipt");
        expect(store.get("receipt")).toEqual({ ok: false, reason: "used" });

        store.create({
            id: "expires",
            intentId: "intent",
            operationId: "operation-2",
            path: "notes/b.md",
            kind: "vault_create",
            before: null,
            expectedAfter: "new",
        });
        now += 101;
        expect(store.get("expires")).toEqual({ ok: false, reason: "expired" });
    });
});

import { IndexedDbUserProfileStore, MemoryUserProfileStore, type ProfileWriteGuard } from "../src/ai-services/memory-extraction/profile-store";
import { SerializedProfileGovernancePort } from "../src/ai-services/memory-extraction/profile-governance-port";
import type { UserProfileSnapshot } from "../src/ai-services/memory-extraction/type-a-extractor";

const NOW = new Date("2026-07-10T08:00:00.000Z");

function snapshot(text: string, conversationId = "conversation-1"): UserProfileSnapshot {
    return {
        updatedAt: NOW.toISOString(),
        records: [{
            key: "response-style",
            text,
            kind: "user_explicit",
            confidence: "high",
            conversationId,
            observedAt: NOW.toISOString(),
            occurrences: 1,
            conversationIds: [conversationId],
            confirmed: true,
        }],
        markdown: `# User Profile\n- ${text}`,
    };
}

describe("SerializedProfileGovernancePort", () => {
    it("rejects source revocation across an asynchronous mutation without writing or advancing cache", async () => {
        const store = new MemoryUserProfileStore();
        await store.setProfile(snapshot("Initial"));
        const port = new SerializedProfileGovernancePort(store, () => NOW);
        await port.initialize();
        const write = jest.spyOn(store, "setProfile");
        let release!: () => void;
        let entered!: () => void;
        const pending = new Promise<void>((resolve) => { release = resolve; });
        const started = new Promise<void>((resolve) => { entered = resolve; });
        const controller = new AbortController();
        const guard: ProfileWriteGuard = Object.assign(() => undefined, { signal: controller.signal });
        const mutation = port.mutate(async () => {
            entered();
            await pending;
            return snapshot("Rejected");
        }, guard);
        await started;
        // Existing initialization normalization is independent of this guarded projection.
        write.mockClear();
        controller.abort();
        release();
        await expect(mutation).rejects.toThrow("no longer current");
        expect(write).not.toHaveBeenCalled();
        expect(port.readSnapshot()?.records[0].text).toBe("Initial");
        expect((await store.getProfile())?.records[0].text).toBe("Initial");
        await port.mutate(() => snapshot("Later"));
        expect(port.readSnapshot()?.records[0].text).toBe("Later");
    });

    it("passes the same write guard to persistence and rechecks after a deferred store write", async () => {
        const store = new MemoryUserProfileStore();
        const port = new SerializedProfileGovernancePort(store, () => NOW);
        await port.initialize();
        let release!: () => void;
        let entered!: () => void;
        const started = new Promise<void>((resolve) => { entered = resolve; });
        const pending = new Promise<void>((resolve) => { release = resolve; });
        const persist = store.setProfile.bind(store);
        jest.spyOn(store, "setProfile").mockImplementationOnce(async (next, guard) => {
            entered();
            await pending;
            await persist(next, guard);
        });
        let current = true;
        const guard = () => { if (!current) throw new Error("source removed"); };
        const mutation = port.mutate(() => snapshot("Rejected"), guard);
        await started;
        expect(store.setProfile).toHaveBeenCalledWith(expect.anything(), guard);
        current = false;
        release();
        await expect(mutation).rejects.toThrow("source removed");
        expect(port.readSnapshot()).toBeNull();
        expect(await store.getProfile()).toBeNull();
    });

    it("adds immutable IDs during initialization and returns clone-safe state", async () => {
        const store = new MemoryUserProfileStore();
        await store.setProfile(snapshot("Prefer concise replies."));
        const port = new SerializedProfileGovernancePort(store, () => NOW);

        const loaded = await port.initialize();
        expect(loaded?.records[0].profileRecordId).toMatch(/^profile-[a-f0-9]{32}$/);
        loaded!.records[0].text = "mutated";
        expect(port.readSnapshot()?.records[0].text).toBe("Prefer concise replies.");
        expect((await store.getProfile())?.records[0].profileRecordId).toBe(
            port.readSnapshot()?.records[0].profileRecordId,
        );
    });

    it("serializes overlapping mutations against the latest committed snapshot", async () => {
        const store = new MemoryUserProfileStore();
        await store.setProfile(snapshot("Initial"));
        const port = new SerializedProfileGovernancePort(store, () => NOW);
        const order: string[] = [];

        const first = port.mutate(async (current) => {
            order.push(`first:${current?.records[0].text}`);
            await Promise.resolve();
            return snapshot("First");
        });
        const second = port.mutate((current) => {
            order.push(`second:${current?.records[0].text}`);
            return snapshot("Second");
        });

        await Promise.all([first, second]);
        expect(order).toEqual(["first:Initial", "second:First"]);
        expect(port.readSnapshot()?.records[0].text).toBe("Second");
    });

    it("does not advance cache when persistence fails", async () => {
        let reject = false;
        const stored = snapshot("Initial");
        const store = {
            initialize: async () => undefined,
            getProfile: async () => stored,
            setProfile: async () => {
                if (reject) throw new Error("write failed");
            },
            dispose: async () => undefined,
        };
        const port = new SerializedProfileGovernancePort(store, () => NOW);
        await port.initialize();
        reject = true;

        await expect(port.mutate(() => snapshot("Rejected"))).rejects.toThrow("write failed");
        expect(port.readSnapshot()?.records[0].text).toBe("Initial");
    });

    it("preserves an existing immutable ID across correction mutations", async () => {
        const original = snapshot("Initial");
        original.records[0].profileRecordId = "profile-11111111111111111111111111111111";
        const store = new MemoryUserProfileStore();
        await store.setProfile(original);
        const port = new SerializedProfileGovernancePort(store, () => NOW);
        await port.initialize();

        const corrected = await port.mutate((current) => {
            const next = snapshot("Corrected");
            next.records[0].profileRecordId = current!.records[0].profileRecordId;
            return next;
        });

        expect(corrected.records[0].profileRecordId).toBe(original.records[0].profileRecordId);
    });

    it("rejects replacement or duplication of an immutable ID", async () => {
        const store = new MemoryUserProfileStore();
        const original = snapshot("Initial");
        original.records[0].profileRecordId = "profile-11111111111111111111111111111111";
        await store.setProfile(original);
        const port = new SerializedProfileGovernancePort(store, () => NOW);
        await port.initialize();

        await expect(port.mutate(() => {
            const changed = snapshot("Changed");
            changed.records[0].profileRecordId = "profile-22222222222222222222222222222222";
            return changed;
        })).rejects.toThrow("cannot replace an immutable ID");
        expect(port.readSnapshot()?.records[0].profileRecordId).toBe(original.records[0].profileRecordId);

        await expect(port.mutate((current) => ({
            ...current!,
            records: [
                current!.records[0],
                {
                    ...current!.records[0],
                    key: "another-key",
                },
            ],
        }))).rejects.toThrow("invalid or duplicate immutable ID");
    });

    it("waits for in-flight initialization before closing the backing store", async () => {
        let releaseInitialize: (() => void) | null = null;
        let initialized = false;
        const dispose = jest.fn(async () => undefined);
        const store = {
            initialize: () => new Promise<void>((resolve) => {
                releaseInitialize = () => {
                    initialized = true;
                    resolve();
                };
            }),
            getProfile: async () => null,
            setProfile: async () => undefined,
            dispose,
        };
        const port = new SerializedProfileGovernancePort(store, () => NOW);
        const initializing = port.initialize();
        const disposing = port.dispose();
        expect(dispose).not.toHaveBeenCalled();

        releaseInitialize!();
        await expect(initializing).rejects.toThrow("disposed");
        await disposing;

        expect(initialized).toBe(true);
        expect(dispose).toHaveBeenCalledTimes(1);
    });

    it("rejects new work after disposal", async () => {
        const port = new SerializedProfileGovernancePort(new MemoryUserProfileStore(), () => NOW);
        await port.initialize();
        await port.dispose();

        expect(() => port.readSnapshot()).toThrow("disposed");
        expect(() => port.mutate(() => snapshot("No"))).toThrow("disposed");
    });
});

describe("guarded Profile store writes", () => {
    function controlledStore() {
        let saved: UserProfileSnapshot | null = null;
        let staged: UserProfileSnapshot | null = null;
        let finished = false;
        const put = jest.fn((entry: { value: UserProfileSnapshot }) => { staged = entry.value; });
        const transaction = {
            oncomplete: null as (() => void) | null,
            onerror: null as (() => void) | null,
            onabort: null as (() => void) | null,
            error: null,
            objectStore: () => ({ put }),
            abort: jest.fn(() => {
                if (finished) throw new Error("transaction finished");
                finished = true;
                staged = null;
                queueMicrotask(() => transaction.onabort?.());
            }),
        };
        const db = { transaction: jest.fn(() => transaction), close: jest.fn(), onversionchange: null };
        const factory = { open: () => {
            const request = { result: db, onsuccess: null as (() => void) | null };
            queueMicrotask(() => request.onsuccess?.());
            return request;
        } };
        const store = new IndexedDbUserProfileStore("guarded-profile", factory as unknown as IDBFactory);
        return { store, put, transaction, db, read: () => saved, complete: () => {
            if (finished) throw new Error("transaction finished");
            finished = true;
            saved = staged;
            transaction.oncomplete?.();
        } };
    }

    it("rejects a pre-aborted source before opening a write transaction or issuing put", async () => {
        const { store, put, db } = controlledStore();
        await store.initialize();
        const controller = new AbortController();
        controller.abort();
        const guard = Object.assign(() => undefined, { signal: controller.signal });
        await expect(store.setProfile(snapshot("Rejected"), guard)).rejects.toThrow("no longer current");
        expect(db.transaction).not.toHaveBeenCalled();
        expect(put).not.toHaveBeenCalled();
        const memory = new MemoryUserProfileStore();
        await expect(memory.setProfile(snapshot("Rejected"), guard)).rejects.toThrow("no longer current");
        expect(await memory.getProfile()).toBeNull();
    });

    it("aborts a staged put on source revocation before commit and removes the listener", async () => {
        const { store, put, transaction, read } = controlledStore();
        await store.initialize();
        const controller = new AbortController();
        const remove = jest.spyOn(controller.signal, "removeEventListener");
        const guard = Object.assign(() => undefined, { signal: controller.signal });
        const writing = store.setProfile(snapshot("Rejected"), guard);
        expect(put).toHaveBeenCalledTimes(1);
        expect(read()).toBeNull();
        controller.abort();
        expect(transaction.abort).toHaveBeenCalledTimes(1);
        await expect(writing).rejects.toThrow("aborted");
        expect(read()).toBeNull();
        expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    });

    it("checks the callback immediately before put and commits valid writes with listener cleanup", async () => {
        const rejected = controlledStore();
        await rejected.store.initialize();
        let checks = 0;
        await expect(rejected.store.setProfile(snapshot("Rejected"), () => {
            if (++checks === 2) throw new Error("stale before put");
        })).rejects.toThrow("stale before put");
        expect(rejected.put).not.toHaveBeenCalled();
        expect(rejected.transaction.abort).toHaveBeenCalled();

        const valid = controlledStore();
        await valid.store.initialize();
        const controller = new AbortController();
        const remove = jest.spyOn(controller.signal, "removeEventListener");
        const guard = Object.assign(() => undefined, { signal: controller.signal });
        const writing = valid.store.setProfile(snapshot("Accepted"), guard);
        valid.complete();
        await writing;
        expect(valid.read()?.records[0].text).toBe("Accepted");
        expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
        controller.abort();
        expect(valid.transaction.abort).not.toHaveBeenCalled();
    });
});

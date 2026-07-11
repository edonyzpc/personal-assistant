import { MemoryUserProfileStore } from "../src/ai-services/memory-extraction/profile-store";
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

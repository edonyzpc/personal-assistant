import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { parsePreviewPointer, type GhostPreviewPointer } from "../src/ghost-publishing/state-schema";
import { GhostPreviewStore, ghostDatabaseName } from "../src/ghost-publishing/state-store";
import { FakeGovernanceIndexedDbFactory } from "./helpers/fake-governance-indexeddb";

const POST = "a".repeat(24);
const PREVIEW = "b".repeat(24);
const pointer: GhostPreviewPointer = { siteId: "test-site", postId: POST, previewId: PREVIEW };
const stores: GhostPreviewStore[] = [];

function openStore(factory: FakeGovernanceIndexedDbFactory, isDesktop = () => true): GhostPreviewStore {
    const store = new GhostPreviewStore({ dbName: "ghost-preview-test", indexedDb: factory as unknown as IDBFactory, isDesktop });
    stores.push(store);
    return store;
}

afterEach(() => { stores.splice(0).forEach(store => store.close()); });

describe("Ghost preview resource pointers", () => {
    it("persists only the pointer and reopens, replaces and removes its exact site/post key", async () => {
        const factory = new FakeGovernanceIndexedDbFactory();
        const first = openStore(factory);
        expect(await first.read(pointer.siteId, POST)).toBeUndefined();
        const input = { ...pointer };
        await first.write(input);
        input.previewId = "c".repeat(24);
        first.close();

        const reopened = openStore(factory);
        expect(await reopened.read(pointer.siteId, POST)).toEqual(pointer);
        const stored = factory.backend.getStore("previews").get(`${pointer.siteId}/${POST}`);
        expect(stored).toEqual(pointer);
        expect(Object.keys(stored as object).sort()).toEqual(["postId", "previewId", "siteId"]);
        expect([...factory.backend.stores.keys()]).toEqual(["previews"]);
        expect(await reopened.read("other-site", POST)).toBeUndefined();

        const other = { ...pointer, postId: "d".repeat(24), previewId: "e".repeat(24) };
        const updated = { ...pointer, previewId: "c".repeat(24) };
        await reopened.write(other);
        await reopened.write(updated);
        expect(await reopened.read(pointer.siteId, POST)).toEqual(updated);
        await reopened.remove(pointer.siteId, POST);
        expect(await reopened.read(pointer.siteId, POST)).toBeUndefined();
        expect(await reopened.read(other.siteId, other.postId)).toEqual(other);
        await reopened.remove(pointer.siteId, POST);
    });

    it("rejects invalid identities and any operation, candidate, or confirmation fields before storage", async () => {
        const factory = new FakeGovernanceIndexedDbFactory();
        const store = openStore(factory);
        for (const input of [
            { ...pointer, siteId: "../site" }, { ...pointer, postId: "article-slug" },
            { ...pointer, previewId: "invalid" }, { ...pointer, previewId: POST },
            { ...pointer, candidate: { content: "Article text" } },
            { ...pointer, operationId: "old-operation" }, { ...pointer, confirmation: true },
        ]) {
            expect(() => parsePreviewPointer(input)).toThrow();
            await expect(store.write(input)).rejects.toMatchObject({ code: "invalid-state" });
        }
        expect(factory.openCalls).toHaveLength(0);
        expect(factory.backend.stores.size).toBe(0);
    });

    it("reports corrupt or mismatched stored pointers without repairing or deleting them", async () => {
        const factory = new FakeGovernanceIndexedDbFactory();
        const store = openStore(factory);
        await store.write(pointer);
        const key = `${pointer.siteId}/${POST}`;
        for (const corrupt of [
            { ...pointer, previewId: POST }, { ...pointer, siteId: "other-site" },
            { ...pointer, postId: "c".repeat(24) }, { ...pointer, candidate: "Old content" },
        ]) {
            factory.backend.getStore("previews").set(key, corrupt);
            await expect(store.read(pointer.siteId, POST)).rejects.toMatchObject({ code: "invalid-state" });
            expect(factory.backend.getStore("previews").get(key)).toEqual(corrupt);
        }
    });

    it("waits for the IndexedDB commit and retains the prior pointer when writes or deletion abort", async () => {
        const factory = new FakeGovernanceIndexedDbFactory();
        const first = openStore(factory);
        await first.write(pointer);
        factory.backend.failNextWriteCommit = true;
        await expect(first.write({ ...pointer, previewId: "c".repeat(24) })).rejects.toMatchObject({ code: "storage-unavailable" });
        first.close();

        const reopened = openStore(factory);
        expect(await reopened.read(pointer.siteId, POST)).toEqual(pointer);
        factory.backend.failNextWriteCommit = true;
        await expect(reopened.remove(pointer.siteId, POST)).rejects.toMatchObject({ code: "storage-unavailable" });
        expect(await reopened.read(pointer.siteId, POST)).toEqual(pointer);
        await reopened.remove(pointer.siteId, POST);
        expect(await reopened.read(pointer.siteId, POST)).toBeUndefined();
    });

    it("uses a new device/config namespace without opening or altering the old operation database", async () => {
        const base = { pluginId: "personal-assistant", vaultId: "test", configDir: ".obsidian", localPath: "/desktop-a/test" };
        const currentName = ghostDatabaseName(base);
        const oldName = currentName.replace("ghost-previews-v1-", "ghost-publishing-v1-");
        expect(currentName).not.toBe(oldName);
        for (const override of [{ pluginId: "other-plugin" }, { vaultId: "other-vault" },
            { configDir: ".obsidian-alt" }, { localPath: "/desktop-b/test" }]) {
            expect(ghostDatabaseName({ ...base, ...override })).not.toBe(currentName);
        }
        expect(() => ghostDatabaseName({ ...base, localPath: "" })).toThrow();

        const oldDatabase = new FakeGovernanceIndexedDbFactory();
        const oldRecord = { operationId: "legacy-op", candidate: { content: "Historical article" }, confirmation: null };
        oldDatabase.backend.upgraded = true;
        oldDatabase.backend.version = 1;
        oldDatabase.backend.getStore("operations").set("legacy-key", oldRecord);
        const currentDatabase = new FakeGovernanceIndexedDbFactory();
        // Route the existing transactional fake by database name, as a real factory does.
        const open = jest.fn((name: string, version?: number) =>
            (name === oldName ? oldDatabase : currentDatabase).open(name, version));
        const store = new GhostPreviewStore({ dbName: currentName, indexedDb: { open } as unknown as IDBFactory, isDesktop: () => true });
        stores.push(store);
        await store.write(pointer);
        await store.remove(pointer.siteId, POST);
        expect(open.mock.calls).toEqual([[currentName, 1]]);
        expect(oldDatabase.openCalls).toHaveLength(0);
        expect([...oldDatabase.backend.stores.keys()]).toEqual(["operations"]);
        expect(oldDatabase.backend.getStore("operations").get("legacy-key")).toEqual(oldRecord);
    });

    it("refuses mobile and closed-store access before opening IndexedDB", async () => {
        const factory = new FakeGovernanceIndexedDbFactory();
        const mobile = openStore(factory, () => false);
        await expect(mobile.read(pointer.siteId, POST)).rejects.toMatchObject({ code: "desktop-required" });
        await expect(mobile.write(pointer)).rejects.toMatchObject({ code: "desktop-required" });
        await expect(mobile.remove(pointer.siteId, POST)).rejects.toMatchObject({ code: "desktop-required" });
        const closed = openStore(factory);
        closed.close();
        await expect(closed.read(pointer.siteId, POST)).rejects.toMatchObject({ code: "storage-unavailable" });
        expect(factory.openCalls).toHaveLength(0);
    });

    it("reports blocked storage and an occupied incompatible database without replacing it", async () => {
        const blockedFactory = new FakeGovernanceIndexedDbFactory();
        blockedFactory.blockedOpenCount = 1;
        await expect(openStore(blockedFactory).read(pointer.siteId, POST)).rejects.toMatchObject({ code: "storage-unavailable" });

        const incompatible = new FakeGovernanceIndexedDbFactory();
        incompatible.backend.upgraded = true;
        incompatible.backend.version = 1;
        incompatible.backend.getStore("unrelated").set("owner", "Existing data");
        await expect(openStore(incompatible).write(pointer)).rejects.toMatchObject({ code: "storage-unavailable" });
        expect([...incompatible.backend.stores.keys()]).toEqual(["unrelated"]);
        expect(incompatible.backend.getStore("unrelated").get("owner")).toBe("Existing data");
        expect(incompatible.connections[0].closeCalls).toBe(1);
    });
});

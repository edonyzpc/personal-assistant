import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { buildRecipeInjection } from "../src/ghost-publishing/recipe";
import { prepareGhostExport } from "../src/ghost-publishing/exporter";
import {
    decodeCompletedRecord, encodeCompletedRecord, ghostOperationKey, ghostRecordPath,
    GhostStateError, parseLocalOperation, sealCompletedRecord, sealLocalOperation,
    ghostStateHash,
    type GhostSnapshot,
} from "../src/ghost-publishing/state-schema";
import { ghostDatabaseName, GhostCompletedRecordStore, GhostOperationStore } from "../src/ghost-publishing/state-store";
import { FakeGovernanceIndexedDbFactory } from "./helpers/fake-governance-indexeddb";

const now = "2026-09-29T09:00:00.000Z";
function snapshot(): GhostSnapshot {
    return {
        content: {
            title: "Synthetic publishing note",
            lexical: JSON.stringify({ root: { type: "root", version: 1, children: [{ type: "paragraph", version: 1, children: [{ type: "extended-text", version: 1, text: "Original content" }] }] } }),
            tags: [{ name: "Example" }], authors: [{ id: "synthetic-author" }], visibility: "public",
            feature_image: null, feature_image_alt: null, feature_image_caption: null,
            custom_excerpt: null, custom_template: null, codeinjection_head: null, codeinjection_foot: null, published_at: null,
        },
        managedFields: ["title", "lexical"],
        source: { targetPath: "A.md", dependencies: [{ path: "A.md", kind: "main", subpath: "", contentHash: "ab".repeat(32) }] },
        blocks: [{ id: "block-1", nodeKind: "paragraph", sourcePath: "A.md", sourceDependencyIndex: 0, sourceStartLine: 0, sourceEndLine: 1, sourceHash: "abcdef12", semanticSignature: "12345678", nodeIndex: 0 }],
        resources: [], profile: { siteId: "test-site" },
        recipe: buildRecipeInjection({ codeLanguages: [], hasMermaid: false, hasInlineMath: false, hasDisplayMath: false }, { siteId: "test-site" }).selection,
    };
}
function completed() {
    return sealCompletedRecord({
        schemaVersion: 1, revision: 1,
        binding: { siteId: "test-site", site: "http://127.0.0.1:2371/", noteUid: "note-1", postId: "post-1", postUrl: "http://127.0.0.1:2371/synthetic/" },
        completed: { postId: "post-1", postUrl: "http://127.0.0.1:2371/synthetic/", status: "published", updatedAt: now, verifiedAt: now },
        baseline: snapshot(),
    });
}
function operation() {
    return sealLocalOperation({
        schemaVersion: 1, revision: 1, operationId: "operation-1", siteId: "test-site", site: "http://127.0.0.1:2371/", noteUid: "note-1",
        kind: "create", state: "prepared", candidate: snapshot(), baselineRevision: null, target: {}, confirmation: null, updatedAt: now,
    });
}

const ownedDirectories: string[] = [];
afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all(ownedDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("Ghost publishing durable state", () => {
    it("accepts the real exporter manifest and block hashes without losing its content", async () => {
        const file = { path: "A.md", extension: "md", stat: { mtime: 1, size: 12 } };
        const exported = await prepareGhostExport({
            targetPath: "A.md", siteProfile: { siteId: "test-site" },
            host: { vault: { getAbstractFileByPath: () => file, read: async () => "Real content" }, parseYaml: () => ({}) },
            guard: { isCurrent: () => true, isPathAllowed: () => true, isNoteDomainAllowed: () => true, captureSourceValidity: () => () => true },
        });
        const candidate = {
            ...snapshot(), source: exported.sourceManifest, blocks: exported.blocks, recipe: exported.recipe.selection,
            content: { ...snapshot().content, lexical: JSON.stringify(exported.lexical) },
        };
        const saved = sealLocalOperation({ ...operation(), candidate });
        expect(parseLocalOperation(JSON.parse(JSON.stringify(saved))).candidate).toEqual(candidate);
    });

    it("round-trips complete nested data and rejects corruption, unknown schemas, or stored confirmation", () => {
        const record = completed();
        const text = encodeCompletedRecord(record);
        expect(text).toContain("pa_system: ghost-publishing");
        expect(decodeCompletedRecord(text, "test-site", "note-1")).toEqual(record);
        expect(() => decodeCompletedRecord(text.replace("Original content", "Tampered content"), "test-site", "note-1")).toThrow(GhostStateError);
        expect(() => decodeCompletedRecord(text, "other-site", "note-1")).toThrow(GhostStateError);
        const local = operation();
        expect(parseLocalOperation(JSON.parse(JSON.stringify(local)))).toEqual(local);
        expect(() => parseLocalOperation({ ...local, schemaVersion: 2 })).toThrow(GhostStateError);
        expect(() => parseLocalOperation({ ...local, confirmation: true })).toThrow(GhostStateError);
        expect(() => sealLocalOperation({ ...local, state: "cleanup_pending" })).toThrow(GhostStateError);
        expect(() => sealLocalOperation({ ...local, candidate: { ...snapshot(), blocks: [{ ...snapshot().blocks[0], sourceDependencyIndex: 5 }] } })).toThrow(GhostStateError);
        expect(() => sealCompletedRecord({ ...record, baseline: { ...snapshot(), content: { ...snapshot().content, lexical: '{"root":{"type":"root","version":1,"children":[{"type":"paragraph"}]}}' } } })).toThrow(GhostStateError);
    });

    it("reads a beta.17 record without inserting an SEO field or changing its checksum", () => {
        const old = completed();
        const checksum = old.checksum;
        expect(old.baseline.content).not.toHaveProperty("meta_description");
        const parsed = JSON.parse(JSON.stringify(old)) as typeof old;
        expect(parsed.baseline.content).not.toHaveProperty("meta_description");
        expect(parsed.checksum).toBe(checksum);
        const { checksum: _removed, ...body } = parsed;
        expect(ghostStateHash(body)).toBe(checksum);
        expect(decodeCompletedRecord(encodeCompletedRecord(old), "test-site", "note-1")).toEqual(old);
    });

    it("reads committed IndexedDB data from a new instance, rolls back failed commits, and rejects stale/overlapping operations", async () => {
        const factory = new FakeGovernanceIndexedDbFactory();
        const options = { dbName: "ghost-state-test", indexedDb: factory as unknown as IDBFactory, isDesktop: () => true };
        const first = new GhostOperationStore(options);
        const local = operation();
        await first.save(local, 0);
        local.candidate.content.title = "Mutated caller copy";
        first.close();
        const reopened = new GhostOperationStore(options);
        const [saved] = await reopened.list("test-site", "note-1");
        expect(saved.candidate.content.title).toBe("Synthetic publishing note");
        expect(saved.confirmation).toBeNull();
        const pending = sealLocalOperation({ ...saved, revision: 2, state: "pending", pending: { kind: "create_draft", marker: "#pa-ghost-op-operation-1", payloadHash: "ab".repeat(32) } });
        factory.backend.failNextWriteCommit = true;
        await expect(reopened.save(pending, 1)).rejects.toMatchObject({ code: "storage-unavailable" });
        expect((await reopened.list("test-site", "note-1"))[0]).toEqual(saved);
        await reopened.save(pending, 1);
        await expect(reopened.save(pending, 1)).rejects.toMatchObject({ code: "operation-conflict" });
        await expect(reopened.save(sealLocalOperation({ ...operation(), operationId: "operation-2" }), 0)).rejects.toMatchObject({ code: "operation-conflict" });
        const terminal = sealLocalOperation({ ...pending, revision: 3, state: "terminal", pending: undefined });
        await reopened.save(terminal, 2);
        const next = sealLocalOperation({ ...operation(), operationId: "operation-2" });
        await reopened.save(next, 0);
        expect(await reopened.list("test-site", "note-1")).toEqual([next]);
        factory.backend.getStore("operations").set(ghostOperationKey(next), { ...next, confirmation: true });
        await expect(reopened.list("test-site", "note-1")).rejects.toMatchObject({ code: "invalid-state" });
        reopened.close();
    });

    it("keeps device scopes distinct and refuses storage access on mobile", async () => {
        const base = { pluginId: "personal-assistant", vaultId: "test", configDir: ".obsidian", localPath: "/desktop-a/test" };
        expect(ghostDatabaseName(base)).not.toBe(ghostDatabaseName({ ...base, localPath: "/desktop-b/test" }));
        const factory = new FakeGovernanceIndexedDbFactory();
        const store = new GhostOperationStore({ dbName: "mobile", indexedDb: factory as unknown as IDBFactory, isDesktop: () => false });
        await expect(store.list("test-site", "note-1")).rejects.toMatchObject({ code: "desktop-required" });
        expect(factory.openCalls).toHaveLength(0);
        await expect(new GhostCompletedRecordStore({ vaultPath: "/unavailable", isDesktop: () => false }).read("test-site", "note-1")).rejects.toMatchObject({ code: "desktop-required" });
    });

    it("atomically creates and replaces one complete vault record and retains old data on failure", async () => {
        const directory = await fs.mkdtemp(join(tmpdir(), "pa-b153-record-test-"));
        ownedDirectories.push(directory);
        const store = new GhostCompletedRecordStore({ vaultPath: directory, isDesktop: () => true });
        const record = completed();
        await store.write(record, null);
        const path = join(directory, ghostRecordPath("test-site", "note-1"));
        const originalText = await fs.readFile(path, "utf8");
        const reopened = new GhostCompletedRecordStore({ vaultPath: directory, isDesktop: () => true });
        expect(await reopened.read("test-site", "note-1")).toEqual(record);
        const next = sealCompletedRecord({ ...record, revision: 2, baseline: { ...snapshot(), content: { ...snapshot().content, title: "Updated" } }, lastUndo: snapshot() });
        await expect(reopened.write(next, "wrong-checksum")).rejects.toMatchObject({ code: "record-conflict" });
        expect(await fs.readFile(path, "utf8")).toBe(originalText);
        jest.spyOn(fs, "rename").mockRejectedValueOnce(Object.assign(new Error("synthetic rename failure"), { code: "EPERM" }));
        await expect(reopened.write(next, record.checksum)).rejects.toMatchObject({ code: "storage-unavailable" });
        expect(await fs.readFile(path, "utf8")).toBe(originalText);
        await reopened.write(next, record.checksum);
        expect(await reopened.read("test-site", "note-1")).toEqual(next);
        expect((await fs.readdir(join(directory, "PA System/Ghost Publishing/test-site"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    });

    it("does not overwrite an occupied user file or a damaged system record", async () => {
        const directory = await fs.mkdtemp(join(tmpdir(), "pa-b153-record-test-"));
        ownedDirectories.push(directory);
        const target = join(directory, ghostRecordPath("test-site", "note-1"));
        await fs.mkdir(join(directory, "PA System/Ghost Publishing/test-site"), { recursive: true });
        const store = new GhostCompletedRecordStore({ vaultPath: directory, isDesktop: () => true });
        for (const existing of ["My own note", encodeCompletedRecord(completed()).replace('"schemaVersion": 1', '"schemaVersion": 7')]) {
            await fs.writeFile(target, existing);
            await expect(store.write(completed(), null)).rejects.toBeInstanceOf(GhostStateError);
            expect(await fs.readFile(target, "utf8")).toBe(existing);
        }
    });
});

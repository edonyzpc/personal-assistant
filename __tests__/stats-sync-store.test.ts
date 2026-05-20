import { describe, expect, it } from "@jest/globals";
import type { Vault } from "obsidian";
import { StatsSyncStore } from "../src/stats/stats-sync-store";
import {
    getStatsRecordKey,
    type StatsDailyDeviceRecord,
} from "../src/stats/stats-local-store";

describe("StatsSyncStore", () => {
    it("appends only changed own-device records and tracks checkpoint state", async () => {
        const adapter = new SyncMemoryAdapter();
        const store = new StatsSyncStore(createVault(adapter), "vault-id", "device-a");
        const record = createRecord();

        const first = await store.checkpoint([record], null);
        const second = await store.checkpoint([record], first.state);

        expect(first.exportedRecordCount).toBe(1);
        expect(second.exportedRecordCount).toBe(0);
        expect(adapter.appendCalls).toBe(1);
        const syncPath = store.getOwnSyncFilePath();
        expect(syncPath).toBe(".vault-config/plugins/personal-assistant/stats/devices/device-a.jsonl");
        const lines = adapter.files.get(syncPath)?.trim().split("\n") ?? [];
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0])).toEqual(expect.objectContaining({
            vaultId: "vault-id",
            date: "2026-05-19",
            deviceId: "device-a",
            revision: 1,
        }));
    });

    it("does not append again for timestamp-only record changes", async () => {
        const adapter = new SyncMemoryAdapter();
        const store = new StatsSyncStore(createVault(adapter), "vault-id", "device-a");
        const first = await store.checkpoint([createRecord({
            updatedAt: "2026-05-19T00:00:00.000Z",
        })], null);
        const second = await store.checkpoint([createRecord({
            updatedAt: "2026-05-19T00:05:00.000Z",
        })], first.state);

        expect(second.exportedRecordCount).toBe(0);
        expect(adapter.appendCalls).toBe(1);
        const syncPath = store.getOwnSyncFilePath();
        expect(adapter.files.get(syncPath)?.trim().split("\n")).toHaveLength(1);
    });

    it("migrates legacy timestamp-sensitive checkpoint hashes without appending", async () => {
        const record = createRecord({
            updatedAt: "2026-05-19T00:00:00.000Z",
        });
        const adapter = new SyncMemoryAdapter({
            ".vault-config/plugins/personal-assistant/stats/devices/device-a.jsonl": JSON.stringify(toSyncLine(record)) + "\n",
        });
        const store = new StatsSyncStore(createVault(adapter), "vault-id", "device-a");

        const result = await store.checkpoint([record], {
            version: 1,
            records: {
                [record.recordKey]: {
                    revision: record.revision,
                    hash: legacySyncHash(record),
                    exportedAt: "2026-05-19T00:01:00.000Z",
                },
            },
        });

        expect(result.exportedRecordCount).toBe(0);
        expect(adapter.appendCalls).toBe(0);
        expect(result.state.records[record.recordKey].hash).not.toBe(legacySyncHash(record));
    });

    it("rebuilds checkpoint state from an existing own-device sync file", async () => {
        const record = createRecord({
            updatedAt: "2026-05-19T00:00:00.000Z",
        });
        const adapter = new SyncMemoryAdapter({
            ".vault-config/plugins/personal-assistant/stats/devices/device-a.jsonl": JSON.stringify(toSyncLine(record)) + "\n",
        });
        const store = new StatsSyncStore(createVault(adapter), "vault-id", "device-a");

        const result = await store.checkpoint([{
            ...record,
            updatedAt: "2026-05-19T00:05:00.000Z",
        }], null);

        expect(result.exportedRecordCount).toBe(0);
        expect(adapter.appendCalls).toBe(0);
        expect(result.state.records[record.recordKey]).toEqual(expect.objectContaining({
            revision: 1,
        }));
    });

    it("imports sync records, skips conflicts, and keeps the newest revision", async () => {
        const adapter = new SyncMemoryAdapter({
            ".vault-config/plugins/personal-assistant/stats/devices/device-a.jsonl": [
                JSON.stringify(toSyncLine(createRecord({ revision: 1, updatedAt: "2026-05-19T00:00:00.000Z" }))),
                "<<<<<<< HEAD",
                JSON.stringify(toSyncLine(createRecord({ revision: 2, updatedAt: "2026-05-19T00:01:00.000Z" }))),
                JSON.stringify({ version: 3, vaultId: "other-vault" }),
                "{bad json",
            ].join("\n"),
            ".vault-config/plugins/personal-assistant/stats/devices/device-b.jsonl": JSON.stringify(toSyncLine(createRecord({
                date: "2026-05-20",
                deviceId: "device-b",
                revision: 1,
                recordKey: getStatsRecordKey("2026-05-20", "device-b"),
            }))),
        });
        const store = new StatsSyncStore(createVault(adapter), "vault-id", "device-a");

        const result = await store.importSyncedRecords();

        expect(result.records.map((record) => [record.date, record.deviceId, record.revision])).toEqual([
            ["2026-05-19", "device-a", 2],
            ["2026-05-20", "device-b", 1],
        ]);
        expect(result.errors).toEqual([
            expect.objectContaining({ message: "Skipped sync conflict marker." }),
            expect.objectContaining({ path: ".vault-config/plugins/personal-assistant/stats/devices/device-a.jsonl:5" }),
        ]);
    });
});

class SyncMemoryAdapter {
    files = new Map<string, string>();
    folders = new Set<string>([".vault-config"]);
    mkdirCalls = 0;
    appendCalls = 0;

    constructor(initialFiles: Record<string, string> = {}) {
        for (const [path, content] of Object.entries(initialFiles)) {
            const normalized = this.normalize(path);
            this.files.set(normalized, content);
            this.addParents(normalized);
        }
    }

    async exists(path: string): Promise<boolean> {
        const normalized = this.normalize(path);
        return this.files.has(normalized) || this.folders.has(normalized);
    }

    async mkdir(path: string): Promise<void> {
        this.mkdirCalls += 1;
        this.folders.add(this.normalize(path));
    }

    async read(path: string): Promise<string> {
        const content = this.files.get(this.normalize(path));
        if (content === undefined) throw new Error(`Missing file: ${path}`);
        return content;
    }

    async append(path: string, content: string): Promise<void> {
        this.appendCalls += 1;
        const normalized = this.normalize(path);
        this.files.set(normalized, `${this.files.get(normalized) ?? ""}${content}`);
    }

    async list(path: string): Promise<{ files: string[]; folders: string[] }> {
        const normalized = this.normalize(path);
        return {
            files: Array.from(this.files.keys()).filter((file) => this.parent(file) === normalized).sort(),
            folders: Array.from(this.folders).filter((folder) => this.parent(folder) === normalized).sort(),
        };
    }

    private addParents(path: string): void {
        let parent = this.parent(path);
        while (parent) {
            this.folders.add(parent);
            parent = this.parent(parent);
        }
    }

    private parent(path: string): string {
        const normalized = this.normalize(path);
        const index = normalized.lastIndexOf("/");
        return index >= 0 ? normalized.slice(0, index) : "";
    }

    private normalize(path: string): string {
        return path.replace(/\/+/g, "/").replace(/\/$/, "");
    }
}

function createVault(adapter: SyncMemoryAdapter): Vault {
    return {
        adapter,
        configDir: ".vault-config",
    } as unknown as Vault;
}

function createRecord(overrides: Partial<StatsDailyDeviceRecord> = {}): StatsDailyDeviceRecord {
    const date = overrides.date ?? "2026-05-19";
    const deviceId = overrides.deviceId ?? "device-a";
    return {
        version: 3,
        vaultId: "vault-id",
        recordKey: getStatsRecordKey(date, deviceId),
        date,
        deviceId,
        revision: 1,
        updatedAt: "2026-05-19T00:00:00.000Z",
        activity: { words: 1, characters: 5, sentences: 1, pages: 0.1, footnotes: 0, citations: 0 },
        snapshot: {
            totalWords: 10,
            totalCharacters: 50,
            totalSentences: 5,
            totalFootnotes: 0,
            totalCitations: 0,
            totalPages: 1,
            files: 1,
        },
        ...overrides,
    };
}

function toSyncLine(record: StatsDailyDeviceRecord): Omit<StatsDailyDeviceRecord, "recordKey"> {
    return {
        version: record.version,
        vaultId: record.vaultId,
        date: record.date,
        deviceId: record.deviceId,
        revision: record.revision,
        updatedAt: record.updatedAt,
        activity: record.activity,
        snapshot: record.snapshot,
    };
}

function legacySyncHash(record: StatsDailyDeviceRecord): string {
    return hashString(JSON.stringify(toSyncLine(record)));
}

function hashString(value: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

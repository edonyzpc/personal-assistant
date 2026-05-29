import { describe, expect, it } from "@jest/globals";
import type { Vault } from "obsidian";
import { LocalStatsRepository } from "../src/stats/stats-repository";
import { StatsSyncStore } from "../src/stats/stats-sync-store";
import { createStatsShard, getStatsDailyRoot } from "../src/stats/stats-store";
import {
    getStatsRecordKey,
    MemoryStatsLocalStore,
    SchemaIntegrityError,
    type FileCountCacheEntry,
    type StatsDailyDeviceRecord,
    type StatsLocalStore,
    type StatsMigrationMetadata,
    type StatsSyncState,
} from "../src/stats/stats-local-store";

describe("LocalStatsRepository", () => {
    it("serializes local writes so revisions cannot race", async () => {
        const localStore = new BlockingStatsLocalStore();
        const repository = new LocalStatsRepository({} as Vault, "vault-id", localStore);
        const deviceId = repository.getDeviceId();
        const first = createStatsShard(
            "2026-05-19",
            deviceId,
            { words: 1, characters: 5, sentences: 1, pages: 0.1, footnotes: 0, citations: 0 },
            { totalWords: 1, totalCharacters: 5, totalSentences: 1, totalFootnotes: 0, totalCitations: 0, totalPages: 0.1, files: 1 },
            "2026-05-19T00:00:00.000Z",
        );
        const second = createStatsShard(
            "2026-05-19",
            deviceId,
            { words: 2, characters: 10, sentences: 2, pages: 0.2, footnotes: 0, citations: 0 },
            { totalWords: 2, totalCharacters: 10, totalSentences: 2, totalFootnotes: 0, totalCitations: 0, totalPages: 0.2, files: 1 },
            "2026-05-19T00:00:01.000Z",
        );

        const firstWrite = repository.writeOwnShard(first);
        const secondWrite = repository.writeOwnShard(second);
        await localStore.waitForPendingWrites(1);
        await flushMicrotasks();

        expect(localStore.readRevisions).toEqual([0]);
        expect(localStore.pendingWrites).toBe(1);

        localStore.releaseNextWrite();
        await firstWrite;
        await localStore.waitForPendingWrites(1);

        expect(localStore.readRevisions).toEqual([0, 1]);

        localStore.releaseNextWrite();
        await secondWrite;

        const record = await localStore.getRecord("2026-05-19", deviceId);
        expect(record?.revision).toBe(2);
        expect(record?.activity.words).toBe(2);
    });

    it("does not rewrite local records for timestamp-only shard changes", async () => {
        const localStore = new MemoryStatsLocalStore();
        const repository = new LocalStatsRepository({} as Vault, "vault-id", localStore);
        const deviceId = repository.getDeviceId();
        const first = createStatsShard(
            "2026-05-19",
            deviceId,
            { words: 1, characters: 5, sentences: 1, pages: 0.1, footnotes: 0, citations: 0 },
            { totalWords: 1, totalCharacters: 5, totalSentences: 1, totalFootnotes: 0, totalCitations: 0, totalPages: 0.1, files: 1 },
            "2026-05-19T00:00:00.000Z",
        );
        const second = {
            ...first,
            updatedAt: "2026-05-19T00:05:00.000Z",
            activity: { ...first.activity },
            snapshot: { ...first.snapshot },
        };

        await repository.writeOwnShard(first);
        await repository.writeOwnShard(second);

        const record = await localStore.getRecord("2026-05-19", deviceId);
        expect(record?.revision).toBe(1);
        expect(record?.updatedAt).toBe("2026-05-19T00:00:00.000Z");
    });

    it("uses deterministic device tie-breakers for same-date snapshots", async () => {
        const localStore = new MemoryStatsLocalStore();
        await localStore.upsertRecord(createRecord({
            deviceId: "device-a",
            recordKey: getStatsRecordKey("2026-05-19", "device-a"),
            snapshot: {
                totalWords: 10,
                totalCharacters: 50,
                totalSentences: 5,
                totalFootnotes: 0,
                totalCitations: 0,
                totalPages: 1,
                files: 1,
            },
        }));
        await localStore.upsertRecord(createRecord({
            deviceId: "device-b",
            recordKey: getStatsRecordKey("2026-05-19", "device-b"),
            snapshot: {
                totalWords: 20,
                totalCharacters: 100,
                totalSentences: 10,
                totalFootnotes: 0,
                totalCitations: 0,
                totalPages: 2,
                files: 2,
            },
        }));
        const repository = new LocalStatsRepository({} as Vault, "vault-id", localStore);

        const dashboard = await repository.readDashboardData();

        expect(dashboard.days).toHaveLength(1);
        expect(dashboard.days[0].words).toBe(2);
        expect(dashboard.days[0].totalWords).toBe(20);
        expect(dashboard.days[0].deviceIds).toEqual(["device-a", "device-b"]);
    });

    it("imports configured legacy stats and v2 roots without vault data writes", async () => {
        const adapter = new RepositoryMemoryAdapter({
            "custom/stats.json": JSON.stringify({
                history: {
                    "2026-01-01": createLegacyDay(2),
                },
                modifiedFiles: {},
            }),
            ".vault-config/stats.json": JSON.stringify({
                history: {
                    "2026-01-01": createLegacyDay(99),
                    "2026-01-02": createLegacyDay(3),
                },
                modifiedFiles: {},
            }),
            ".obsidian/stats.json": JSON.stringify({
                history: {
                    "2026-01-03": createLegacyDay(4),
                },
                modifiedFiles: {},
            }),
            [`${getStatsDailyRoot(".vault-config")}/2026-01-04/device-a.json`]: JSON.stringify(createStatsShard(
                "2026-01-04",
                "device-a",
                { words: 5, characters: 50, sentences: 5, pages: 0.5, footnotes: 0, citations: 0 },
                { totalWords: 50, totalCharacters: 500, totalSentences: 50, totalFootnotes: 0, totalCitations: 0, totalPages: 5, files: 5 },
                "2026-01-04T00:00:00.000Z",
            )),
            [`${getStatsDailyRoot(".obsidian")}/2026-01-04/device-a.json`]: JSON.stringify(createStatsShard(
                "2026-01-04",
                "device-a",
                { words: 500, characters: 500, sentences: 50, pages: 50, footnotes: 0, citations: 0 },
                { totalWords: 500, totalCharacters: 5000, totalSentences: 500, totalFootnotes: 0, totalCitations: 0, totalPages: 50, files: 50 },
                "2026-01-04T01:00:00.000Z",
            )),
            [`${getStatsDailyRoot(".obsidian")}/2026-01-05/device-b.json`]: JSON.stringify(createStatsShard(
                "2026-01-05",
                "device-b",
                { words: 6, characters: 60, sentences: 6, pages: 0.6, footnotes: 0, citations: 0 },
                { totalWords: 60, totalCharacters: 600, totalSentences: 60, totalFootnotes: 0, totalCitations: 0, totalPages: 6, files: 6 },
                "2026-01-05T00:00:00.000Z",
            )),
        });
        const localStore = new MemoryStatsLocalStore();
        const repository = new LocalStatsRepository(createVault(adapter), "vault-id", localStore, "custom/stats.json");

        const dashboard = await repository.readDashboardData();
        const byDate = Object.fromEntries(dashboard.days.map((day) => [day.date, day]));

        expect(dashboard.days.map((day) => day.date)).toEqual([
            "2026-01-01",
            "2026-01-02",
            "2026-01-03",
            "2026-01-04",
            "2026-01-05",
        ]);
        expect(byDate["2026-01-01"].words).toBe(2);
        expect(byDate["2026-01-04"].words).toBe(5);
        expect(byDate["2026-01-04"].totalWords).toBe(50);
        expect(byDate["2026-01-05"].deviceIds).toEqual(["device-b"]);
        expect(adapter.mkdirCalls).toBe(0);
        expect(adapter.writeCalls).toBe(0);
        expect(adapter.deleteCalls).toBe(0);
        expect(adapter.files.has(`${getStatsDailyRoot(".vault-config")}/2026-01-04/device-a.json`)).toBe(true);
        expect(adapter.files.has(`${getStatsDailyRoot(".obsidian")}/2026-01-04/device-a.json`)).toBe(true);
        expect(adapter.files.has(`${getStatsDailyRoot(".obsidian")}/2026-01-05/device-b.json`)).toBe(true);
        expect(dashboard.errors).toEqual([
            expect.objectContaining({
                path: ".vault-config/stats.json#2026-01-01",
                message: "Duplicate statistics shard was not imported.",
            }),
            expect.objectContaining({
                path: `${getStatsDailyRoot(".obsidian")}/2026-01-04/device-a.json`,
                message: "Duplicate statistics shard was not imported.",
            }),
        ]);
        expect(adapter.files.has("custom/stats.json")).toBe(true);
        expect(adapter.files.has(".vault-config/stats.json")).toBe(true);
        expect(adapter.files.has(".obsidian/stats.json")).toBe(true);
        await expect(localStore.getMigrationMetadata()).resolves.toEqual(expect.objectContaining({
            validShardCount: 5,
            corruptShardCount: 2,
            importedRecordKeyCount: 5,
            cleanupStatus: "blocked",
        }));
    });

    it("deduplicates equivalent legacy stats and daily legacy shards without surfacing an issue", async () => {
        const legacyDay = createLegacyDay(2);
        const adapter = new RepositoryMemoryAdapter({
            ".vault-config/stats.json": JSON.stringify({
                history: {
                    "2026-01-01": legacyDay,
                },
                modifiedFiles: {},
            }),
            [`${getStatsDailyRoot(".vault-config")}/2026-01-01/legacy.json`]: JSON.stringify(createStatsShard(
                "2026-01-01",
                "legacy",
                {
                    words: legacyDay.words,
                    characters: legacyDay.characters,
                    sentences: legacyDay.sentences,
                    pages: legacyDay.pages,
                    footnotes: legacyDay.footnotes,
                    citations: legacyDay.citations,
                },
                {
                    totalWords: legacyDay.totalWords,
                    totalCharacters: legacyDay.totalCharacters,
                    totalSentences: legacyDay.totalSentences,
                    totalFootnotes: legacyDay.totalFootnotes,
                    totalCitations: legacyDay.totalCitations,
                    totalPages: legacyDay.totalPages,
                    files: legacyDay.files,
                },
                "2026-01-01T12:00:00.000Z",
            )),
        });
        const localStore = new MemoryStatsLocalStore();
        const repository = new LocalStatsRepository(createVault(adapter), "vault-id", localStore, "missing/stats.json");

        const dashboard = await repository.readDashboardData();
        const metadata = await localStore.getMigrationMetadata();

        expect(dashboard.errors).toEqual([]);
        expect(dashboard.days.map((day) => [day.date, day.words, day.totalWords, day.deviceIds])).toEqual([
            ["2026-01-01", 2, 20, ["legacy"]],
        ]);
        expect(dashboard.days[0].updatedAt).toBe("2026-01-01T12:00:00.000Z");
        expect(metadata).toEqual(expect.objectContaining({
            validShardCount: 2,
            corruptShardCount: 0,
            duplicateEquivalentShardCount: 1,
            importedRecordKeyCount: 1,
            cleanupStatus: "not-started",
        }));
        expect(adapter.files.has(".vault-config/stats.json")).toBe(true);
        expect(adapter.files.has(`${getStatsDailyRoot(".vault-config")}/2026-01-01/legacy.json`)).toBe(true);
    });

    it("records damaged v2 data as a migration issue while importing valid records", async () => {
        const adapter = new RepositoryMemoryAdapter({
            [`${getStatsDailyRoot(".vault-config")}/2026-02-01/device-a.json`]: JSON.stringify(createStatsShard(
                "2026-02-01",
                "device-a",
                { words: 7, characters: 70, sentences: 7, pages: 0.7, footnotes: 0, citations: 0 },
                { totalWords: 70, totalCharacters: 700, totalSentences: 70, totalFootnotes: 0, totalCitations: 0, totalPages: 7, files: 7 },
            )),
            [`${getStatsDailyRoot(".vault-config")}/2026-02-02/broken.json`]: "{not json",
        });
        const localStore = new MemoryStatsLocalStore();
        const repository = new LocalStatsRepository(createVault(adapter), "vault-id", localStore, "missing/stats.json");

        const dashboard = await repository.readDashboardData();
        const metadata = await localStore.getMigrationMetadata();

        expect(dashboard.days.map((day) => day.date)).toEqual(["2026-02-01"]);
        expect(dashboard.errors).toEqual([
            expect.objectContaining({
                path: `${getStatsDailyRoot(".vault-config")}/2026-02-02/broken.json`,
            }),
        ]);
        expect(metadata).toEqual(expect.objectContaining({
            validShardCount: 1,
            corruptShardCount: 1,
            importedRecordKeyCount: 1,
            cleanupStatus: "blocked",
        }));
        expect(metadata?.lastError).toContain("broken.json");
        expect(adapter.writeCalls).toBe(0);
        expect(adapter.deleteCalls).toBe(0);
    });

    it("records a migration issue when exists checks fail during import", async () => {
        const adapter = new RepositoryMemoryAdapter({
            [`${getStatsDailyRoot(".vault-config")}/2026-02-01/device-a.json`]: JSON.stringify(createStatsShard(
                "2026-02-01",
                "device-a",
                { words: 7, characters: 70, sentences: 7, pages: 0.7, footnotes: 0, citations: 0 },
                { totalWords: 70, totalCharacters: 700, totalSentences: 70, totalFootnotes: 0, totalCitations: 0, totalPages: 7, files: 7 },
            )),
        });
        adapter.existsFailures.add(".vault-config/stats.json");
        const localStore = new MemoryStatsLocalStore();
        const repository = new LocalStatsRepository(createVault(adapter), "vault-id", localStore, "missing/stats.json");

        const dashboard = await repository.readDashboardData();
        const metadata = await localStore.getMigrationMetadata();

        expect(dashboard.days.map((day) => day.date)).toEqual(["2026-02-01"]);
        expect(dashboard.errors).toEqual([
            expect.objectContaining({
                path: ".vault-config/stats.json",
            }),
        ]);
        expect(metadata).toEqual(expect.objectContaining({
            corruptShardCount: 1,
            cleanupStatus: "blocked",
        }));
    });

    it("records a migration issue for malformed v2 shard payloads", async () => {
        const adapter = new RepositoryMemoryAdapter({
            [`${getStatsDailyRoot(".vault-config")}/2026-02-02/broken.json`]: JSON.stringify({
                version: 2,
                date: "2026-02-02",
                deviceId: "device-a",
                updatedAt: "2026-02-02T00:00:00.000Z",
            }),
        });
        const localStore = new MemoryStatsLocalStore();
        const repository = new LocalStatsRepository(createVault(adapter), "vault-id", localStore, "missing/stats.json");

        const dashboard = await repository.readDashboardData();
        const metadata = await localStore.getMigrationMetadata();

        expect(dashboard.days).toEqual([]);
        expect(dashboard.errors).toEqual([
            expect.objectContaining({
                path: `${getStatsDailyRoot(".vault-config")}/2026-02-02/broken.json`,
                message: "Invalid statistics shard shape.",
            }),
        ]);
        expect(metadata).toEqual(expect.objectContaining({
            validShardCount: 0,
            corruptShardCount: 1,
            cleanupStatus: "blocked",
        }));
    });

    it("records a migration issue for malformed legacy stats days", async () => {
        const adapter = new RepositoryMemoryAdapter({
            ".vault-config/stats.json": JSON.stringify({
                history: {
                    "2026-02-03": {
                        words: "bad",
                    },
                },
                modifiedFiles: {},
            }),
        });
        const localStore = new MemoryStatsLocalStore();
        const repository = new LocalStatsRepository(createVault(adapter), "vault-id", localStore, "missing/stats.json");

        const dashboard = await repository.readDashboardData();
        const metadata = await localStore.getMigrationMetadata();

        expect(dashboard.days).toEqual([]);
        expect(dashboard.errors).toEqual([
            expect.objectContaining({
                path: ".vault-config/stats.json#2026-02-03",
                message: "Invalid legacy statistics day shape.",
            }),
        ]);
        expect(metadata).toEqual(expect.objectContaining({
            validShardCount: 0,
            corruptShardCount: 1,
            cleanupStatus: "blocked",
        }));
    });

    it("records a migration issue when a v2 shard is missing updatedAt", async () => {
        const adapter = new RepositoryMemoryAdapter({
            [`${getStatsDailyRoot(".vault-config")}/2026-02-04/broken.json`]: JSON.stringify({
                version: 2,
                date: "2026-02-04",
                deviceId: "device-a",
                activity: { words: 1, characters: 10, sentences: 1, pages: 0.1, footnotes: 0, citations: 0 },
                snapshot: {
                    totalWords: 10,
                    totalCharacters: 100,
                    totalSentences: 10,
                    totalFootnotes: 0,
                    totalCitations: 0,
                    totalPages: 1,
                    files: 1,
                },
            }),
        });
        const localStore = new MemoryStatsLocalStore();
        const repository = new LocalStatsRepository(createVault(adapter), "vault-id", localStore, "missing/stats.json");

        const dashboard = await repository.readDashboardData();
        const metadata = await localStore.getMigrationMetadata();

        expect(dashboard.days).toEqual([]);
        expect(dashboard.errors).toEqual([
            expect.objectContaining({
                path: `${getStatsDailyRoot(".vault-config")}/2026-02-04/broken.json`,
                message: "Invalid statistics shard shape.",
            }),
        ]);
        expect(metadata?.cleanupStatus).toBe("blocked");
    });

    it("records a migration issue when a v2 shard has a malformed updatedAt", async () => {
        const adapter = new RepositoryMemoryAdapter({
            [`${getStatsDailyRoot(".vault-config")}/2026-02-05/broken.json`]: JSON.stringify({
                version: 2,
                date: "2026-02-05",
                deviceId: "device-a",
                updatedAt: "not-a-date",
                activity: { words: 1, characters: 10, sentences: 1, pages: 0.1, footnotes: 0, citations: 0 },
                snapshot: {
                    totalWords: 10,
                    totalCharacters: 100,
                    totalSentences: 10,
                    totalFootnotes: 0,
                    totalCitations: 0,
                    totalPages: 1,
                    files: 1,
                },
            }),
        });
        const localStore = new MemoryStatsLocalStore();
        const repository = new LocalStatsRepository(createVault(adapter), "vault-id", localStore, "missing/stats.json");

        const dashboard = await repository.readDashboardData();
        const metadata = await localStore.getMigrationMetadata();

        expect(dashboard.days).toEqual([]);
        expect(dashboard.errors).toEqual([
            expect.objectContaining({
                path: `${getStatsDailyRoot(".vault-config")}/2026-02-05/broken.json`,
                message: "Invalid statistics shard shape.",
            }),
        ]);
        expect(metadata).toEqual(expect.objectContaining({
            validShardCount: 0,
            corruptShardCount: 1,
            cleanupStatus: "blocked",
        }));
    });

    it("allows repository initialization to retry after a local store failure", async () => {
        const adapter = new RepositoryMemoryAdapter({});
        const localStore = new FailingOnceStatsLocalStore();
        const repository = new LocalStatsRepository(createVault(adapter), "vault-id", localStore, "missing/stats.json");

        await expect(repository.readDashboardData()).rejects.toThrow("local init failed");
        await expect(repository.readDashboardData()).resolves.toEqual(expect.objectContaining({
            days: [],
        }));

        expect(localStore.initializeCalls).toBe(2);
    });

    it("keeps repeated imports idempotent and does not overwrite existing local records", async () => {
        const adapter = new RepositoryMemoryAdapter({
            [`${getStatsDailyRoot(".vault-config")}/2026-03-01/device-a.json`]: JSON.stringify(createStatsShard(
                "2026-03-01",
                "device-a",
                { words: 5, characters: 50, sentences: 5, pages: 0.5, footnotes: 0, citations: 0 },
                { totalWords: 50, totalCharacters: 500, totalSentences: 50, totalFootnotes: 0, totalCitations: 0, totalPages: 5, files: 5 },
            )),
        });
        const localStore = new MemoryStatsLocalStore();
        await localStore.upsertRecord(createRecord({
            date: "2026-03-01",
            deviceId: "device-a",
            recordKey: getStatsRecordKey("2026-03-01", "device-a"),
            revision: 9,
            activity: { words: 100, characters: 1000, sentences: 10, pages: 1, footnotes: 0, citations: 0 },
            snapshot: {
                totalWords: 1000,
                totalCharacters: 10000,
                totalSentences: 100,
                totalFootnotes: 0,
                totalCitations: 0,
                totalPages: 10,
                files: 10,
            },
        }));

        const firstRepository = new LocalStatsRepository(createVault(adapter), "vault-id", localStore, "missing/stats.json");
        const firstDashboard = await firstRepository.readDashboardData();
        const secondRepository = new LocalStatsRepository(createVault(adapter), "vault-id", localStore, "missing/stats.json");
        const secondDashboard = await secondRepository.readDashboardData();
        const record = await localStore.getRecord("2026-03-01", "device-a");

        expect(firstDashboard.days).toHaveLength(1);
        expect(secondDashboard.days).toHaveLength(1);
        expect(secondDashboard.days[0].words).toBe(100);
        expect(secondDashboard.days[0].totalWords).toBe(1000);
        expect(record?.revision).toBe(9);
        expect((await localStore.getAllRecords())).toHaveLength(1);
        const metadata = await localStore.getMigrationMetadata();
        expect(metadata).toEqual(expect.objectContaining({
            cleanupStatus: "not-started",
            corruptShardCount: 0,
        }));
        expect(metadata?.cleanupError).toBeUndefined();
        expect(adapter.files.has(`${getStatsDailyRoot(".vault-config")}/2026-03-01/device-a.json`)).toBe(true);
    });

    it("recovers blocked migration metadata on later clean scans", async () => {
        const adapter = new RepositoryMemoryAdapter({
            [`${getStatsDailyRoot(".vault-config")}/2026-04-01/device-a.json`]: JSON.stringify(createStatsShard(
                "2026-04-01",
                "device-a",
                { words: 1, characters: 10, sentences: 1, pages: 0.1, footnotes: 0, citations: 0 },
                { totalWords: 10, totalCharacters: 100, totalSentences: 10, totalFootnotes: 0, totalCitations: 0, totalPages: 1, files: 1 },
            )),
        });
        const localStore = new MemoryStatsLocalStore();
        await localStore.setMigrationMetadata({
            version: 1,
            v2ImportFingerprint: "old-fingerprint",
            validShardCount: 0,
            corruptShardCount: 1,
            importedRecordKeyCount: 0,
            aggregateHash: "old-aggregate",
            cleanupStatus: "blocked",
            importedAt: "2026-05-18T00:00:00.000Z",
            lastError: "old broken file",
        });
        const repository = new LocalStatsRepository(createVault(adapter), "vault-id", localStore, "missing/stats.json");

        await repository.readDashboardData();
        const metadata = await localStore.getMigrationMetadata();

        expect(metadata).toEqual(expect.objectContaining({
            validShardCount: 1,
            corruptShardCount: 0,
            cleanupStatus: "not-started",
        }));
        expect(metadata?.lastError).toBeUndefined();
    });

    it("imports v2 history read-only when old files become visible again", async () => {
        const adapter = new RepositoryMemoryAdapter({
            [`${getStatsDailyRoot(".vault-config")}/2026-04-02/device-a.json`]: JSON.stringify(createStatsShard(
                "2026-04-02",
                "device-a",
                { words: 1, characters: 10, sentences: 1, pages: 0.1, footnotes: 0, citations: 0 },
                { totalWords: 10, totalCharacters: 100, totalSentences: 10, totalFootnotes: 0, totalCitations: 0, totalPages: 1, files: 1 },
            )),
        });
        const localStore = new MemoryStatsLocalStore();
        await localStore.setMigrationMetadata({
            version: 1,
            v2ImportFingerprint: "old-fingerprint",
            validShardCount: 0,
            corruptShardCount: 0,
            importedRecordKeyCount: 0,
            aggregateHash: "old-aggregate",
            cleanupStatus: "complete",
            importedAt: "2026-05-18T00:00:00.000Z",
            cleanupTimestamp: "2026-05-18T00:01:00.000Z",
        });
        const repository = new LocalStatsRepository(createVault(adapter), "vault-id", localStore, "missing/stats.json");

        await repository.readDashboardData();
        const metadata = await localStore.getMigrationMetadata();

        expect(metadata).toEqual(expect.objectContaining({
            validShardCount: 1,
            corruptShardCount: 0,
            cleanupStatus: "not-started",
        }));
        expect(adapter.files.has(`${getStatsDailyRoot(".vault-config")}/2026-04-02/device-a.json`)).toBe(true);
        expect(adapter.deleteCalls).toBe(0);
    });

    it("clears old cleanup metadata on empty read-only scans", async () => {
        const adapter = new RepositoryMemoryAdapter({});
        const localStore = new MemoryStatsLocalStore();
        await localStore.setMigrationMetadata({
            version: 1,
            v2ImportFingerprint: "old-fingerprint",
            validShardCount: 0,
            corruptShardCount: 0,
            importedRecordKeyCount: 0,
            aggregateHash: "old-aggregate",
            cleanupStatus: "complete",
            importedAt: "2026-05-18T00:00:00.000Z",
            cleanupTimestamp: "2026-05-18T00:01:00.000Z",
        });
        const repository = new LocalStatsRepository(createVault(adapter), "vault-id", localStore, "missing/stats.json");

        await repository.readDashboardData();
        const metadata = await localStore.getMigrationMetadata();

        expect(metadata).toEqual(expect.objectContaining({
            validShardCount: 0,
            corruptShardCount: 0,
            importedRecordKeyCount: 0,
            cleanupStatus: "not-started",
        }));
        expect(metadata?.cleanupTimestamp).toBeUndefined();
    });

    it("keeps legacy stats files after read-only import", async () => {
        const adapter = new RepositoryMemoryAdapter({
            ".vault-config/stats.json": JSON.stringify({
                history: {
                    "2026-04-03": createLegacyDay(2),
                },
                modifiedFiles: {},
            }),
        });
        const localStore = new MemoryStatsLocalStore();
        await localStore.setMigrationMetadata({
            version: 1,
            v2ImportFingerprint: "old-fingerprint",
            validShardCount: 1,
            corruptShardCount: 0,
            importedRecordKeyCount: 1,
            aggregateHash: "old-aggregate",
            cleanupStatus: "complete",
            importedAt: "2026-05-18T00:00:00.000Z",
            cleanupTimestamp: "2026-05-18T00:01:00.000Z",
        });
        const repository = new LocalStatsRepository(createVault(adapter), "vault-id", localStore, "missing/stats.json");

        await repository.readDashboardData();
        const metadata = await localStore.getMigrationMetadata();

        expect(metadata).toEqual(expect.objectContaining({
            validShardCount: 1,
            corruptShardCount: 0,
            importedRecordKeyCount: 1,
            cleanupStatus: "not-started",
        }));
        expect(adapter.files.has(".vault-config/stats.json")).toBe(true);
        expect(adapter.deleteCalls).toBe(0);
    });

    it("keeps imported and unrelated v2 files during read-only import", async () => {
        const importedPath = `${getStatsDailyRoot(".vault-config")}/2026-04-04/device-a.json`;
        const unrelatedPath = `${getStatsDailyRoot(".vault-config")}/2026-04-04/readme.md`;
        const adapter = new RepositoryMemoryAdapter({
            [importedPath]: JSON.stringify(createStatsShard(
                "2026-04-04",
                "device-a",
                { words: 3, characters: 30, sentences: 3, pages: 0.3, footnotes: 0, citations: 0 },
                { totalWords: 30, totalCharacters: 300, totalSentences: 30, totalFootnotes: 0, totalCitations: 0, totalPages: 3, files: 3 },
            )),
            [unrelatedPath]: "keep me",
        });
        const localStore = new MemoryStatsLocalStore();
        const repository = new LocalStatsRepository(createVault(adapter), "vault-id", localStore, "missing/stats.json");

        await repository.readDashboardData();
        const metadata = await localStore.getMigrationMetadata();

        expect(metadata?.cleanupStatus).toBe("not-started");
        expect(adapter.files.has(importedPath)).toBe(true);
        expect(adapter.files.has(unrelatedPath)).toBe(true);
        expect(adapter.deleteCalls).toBe(0);
    });

    it("falls back to UnavailableStatsLocalStore when the local schema is corrupt (SDD §6.20)", async () => {
        const schemaStore = new SchemaFailingStatsLocalStore();
        const repository = new LocalStatsRepository({} as Vault, "vault-id", schemaStore, ".obsidian/stats.json");

        // SDD §3.2 contract: the SchemaIntegrityError is caught inside the repository
        // and the local store is swapped to the Unavailable variant. Initialize must
        // resolve successfully even though the underlying schema check threw.
        await expect(repository.initialize()).resolves.toBeUndefined();

        // Subsequent reads now hit UnavailableStatsLocalStore, which throws. The
        // StatsManager.getDashboardData try/catch surfaces this as empty dashboards;
        // here we assert the throw so the manager-level fallback has something to catch.
        await expect(repository.readDashboardData()).rejects.toThrow(/unavailable/i);
        await expect(repository.readLatestSnapshot()).rejects.toThrow(/unavailable/i);
    });

    it("imports synced records when dashboard data is read", async () => {
        const adapter = new RepositoryMemoryAdapter({
            ".vault-config/plugins/personal-assistant/stats/devices/device-b.jsonl": JSON.stringify(toSyncLine(createRecord({
                date: "2026-04-08",
                deviceId: "device-b",
                recordKey: getStatsRecordKey("2026-04-08", "device-b"),
                activity: { words: 8, characters: 80, sentences: 8, pages: 0.8, footnotes: 0, citations: 0 },
                snapshot: {
                    totalWords: 80,
                    totalCharacters: 800,
                    totalSentences: 80,
                    totalFootnotes: 0,
                    totalCitations: 0,
                    totalPages: 8,
                    files: 8,
                },
            }))) + "\n",
        });
        const localStore = new MemoryStatsLocalStore();
        const repository = new LocalStatsRepository(
            createVault(adapter),
            "vault-id",
            localStore,
            "missing/stats.json",
            new StatsSyncStore(createVault(adapter), "vault-id", "device-a"),
        );

        const dashboard = await repository.readDashboardData();

        expect(dashboard.days.map((day) => [day.date, day.words, day.totalWords, day.deviceIds])).toEqual([
            ["2026-04-08", 8, 80, ["device-b"]],
        ]);
        await expect(localStore.getRecord("2026-04-08", "device-b")).resolves.toEqual(expect.objectContaining({
            activity: expect.objectContaining({ words: 8 }),
        }));
    });
});

class BlockingStatsLocalStore implements StatsLocalStore {
    private readonly records = new Map<string, StatsDailyDeviceRecord>();
    private readonly releases: Array<() => void> = [];
    private readonly waiters: Array<() => void> = [];
    readRevisions: number[] = [];
    pendingWrites = 0;

    async initialize(): Promise<void> { }

    async getAllRecords(): Promise<StatsDailyDeviceRecord[]> {
        return Array.from(this.records.values()).map(cloneRecord);
    }

    async getRecord(date: string, deviceId: string): Promise<StatsDailyDeviceRecord | null> {
        const record = this.records.get(getStatsRecordKey(date, deviceId));
        this.readRevisions.push(record?.revision ?? 0);
        return record ? cloneRecord(record) : null;
    }

    async upsertRecord(record: StatsDailyDeviceRecord): Promise<void> {
        this.pendingWrites += 1;
        this.notifyWaiters();
        await new Promise<void>((resolve) => {
            this.releases.push(() => {
                this.records.set(record.recordKey, cloneRecord(record));
                this.pendingWrites -= 1;
                resolve();
            });
        });
    }

    async addRecordIfAbsent(record: StatsDailyDeviceRecord): Promise<boolean> {
        if (this.records.has(record.recordKey)) {
            return false;
        }
        await this.upsertRecord(record);
        return true;
    }

    async getMigrationMetadata(): Promise<StatsMigrationMetadata | null> {
        return null;
    }

    async setMigrationMetadata(_metadata: StatsMigrationMetadata): Promise<void> { }

    async getSyncState(): Promise<StatsSyncState | null> {
        return null;
    }

    async setSyncState(_state: StatsSyncState): Promise<void> { }

    async getAllFileCountEntries(): Promise<never[]> {
        return [];
    }

    async putFileCountEntries(_entries: unknown[]): Promise<void> { }

    async deleteFileCountEntries(_paths: string[]): Promise<void> { }

    async clearFileCountCache(): Promise<void> { }

    releaseNextWrite(): void {
        const release = this.releases.shift();
        if (!release) throw new Error("No pending write to release.");
        release();
    }

    async waitForPendingWrites(count: number): Promise<void> {
        while (this.pendingWrites < count) {
            await new Promise<void>((resolve) => this.waiters.push(resolve));
        }
    }

    private notifyWaiters(): void {
        this.waiters.splice(0).forEach((resolve) => resolve());
    }
}

class RepositoryMemoryAdapter {
    files = new Map<string, string>();
    folders = new Set<string>();
    existsFailures = new Set<string>();
    removeFailures = new Set<string>();
    beforeRead = new Map<string, () => void>();
    beforeRemove = new Map<string, () => void>();
    mkdirCalls = 0;
    writeCalls = 0;
    deleteCalls = 0;
    rmdirCalls = 0;

    constructor(initialFiles: Record<string, string>) {
        for (const [path, content] of Object.entries(initialFiles)) {
            const normalized = this.normalize(path);
            this.files.set(normalized, content);
            this.addParents(normalized);
        }
    }

    async exists(path: string): Promise<boolean> {
        const normalized = this.normalize(path);
        if (this.existsFailures.has(normalized)) {
            throw new Error(`exists failed: ${normalized}`);
        }
        return this.files.has(normalized) || this.folders.has(normalized);
    }

    async read(path: string): Promise<string> {
        const normalized = this.normalize(path);
        this.beforeRead.get(normalized)?.();
        const content = this.files.get(normalized);
        if (content === undefined) throw new Error(`Missing file: ${path}`);
        return content;
    }

    async list(path: string): Promise<{ files: string[]; folders: string[] }> {
        const normalized = this.normalize(path);
        return {
            files: Array.from(this.files.keys()).filter((file) => this.parent(file) === normalized).sort(),
            folders: Array.from(this.folders).filter((folder) => this.parent(folder) === normalized).sort(),
        };
    }

    async mkdir(_path: string): Promise<void> {
        this.mkdirCalls += 1;
    }

    async write(_path: string, _content: string): Promise<void> {
        this.writeCalls += 1;
    }

    async remove(path: string): Promise<void> {
        const normalized = this.normalize(path);
        if (this.removeFailures.has(normalized)) {
            throw new Error(`remove failed: ${normalized}`);
        }
        this.beforeRemove.get(normalized)?.();
        this.deleteCalls += 1;
        if (!this.files.delete(normalized)) {
            throw new Error(`Missing file: ${normalized}`);
        }
    }

    async rmdir(path: string, recursive: boolean): Promise<void> {
        const normalized = this.normalize(path);
        this.rmdirCalls += 1;
        if (!this.folders.has(normalized)) {
            throw new Error(`Missing folder: ${normalized}`);
        }
        const hasChildren = Array.from(this.files.keys()).some((file) => this.parent(file) === normalized)
            || Array.from(this.folders).some((folder) => this.parent(folder) === normalized);
        if (hasChildren && !recursive) {
            throw new Error(`Folder is not empty: ${normalized}`);
        }
        this.folders.delete(normalized);
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

class FailingOnceStatsLocalStore extends MemoryStatsLocalStore {
    initializeCalls = 0;

    async initialize(): Promise<void> {
        this.initializeCalls += 1;
        if (this.initializeCalls === 1) {
            throw new Error("local init failed");
        }
        await super.initialize();
    }
}

class SchemaFailingStatsLocalStore implements StatsLocalStore {
    async initialize(): Promise<void> {
        throw new SchemaIntegrityError(["required object store"]);
    }
    async getAllRecords(): Promise<StatsDailyDeviceRecord[]> { throw new Error("should not reach"); }
    async getRecord(): Promise<StatsDailyDeviceRecord | null> { throw new Error("should not reach"); }
    async upsertRecord(): Promise<void> { throw new Error("should not reach"); }
    async addRecordIfAbsent(): Promise<boolean> { throw new Error("should not reach"); }
    async getMigrationMetadata(): Promise<StatsMigrationMetadata | null> { throw new Error("should not reach"); }
    async setMigrationMetadata(): Promise<void> { throw new Error("should not reach"); }
    async getSyncState(): Promise<StatsSyncState | null> { throw new Error("should not reach"); }
    async setSyncState(): Promise<void> { throw new Error("should not reach"); }
    async getAllFileCountEntries(): Promise<FileCountCacheEntry[]> { throw new Error("should not reach"); }
    async putFileCountEntries(): Promise<void> { throw new Error("should not reach"); }
    async deleteFileCountEntries(): Promise<void> { throw new Error("should not reach"); }
    async clearFileCountCache(): Promise<void> { throw new Error("should not reach"); }
}

function createVault(adapter: RepositoryMemoryAdapter): Vault {
    return {
        adapter,
        configDir: ".vault-config",
    } as unknown as Vault;
}

function createLegacyDay(words: number) {
    return {
        words,
        characters: words * 10,
        sentences: words,
        pages: words / 10,
        files: words,
        footnotes: 0,
        citations: 0,
        totalWords: words * 10,
        totalCharacters: words * 100,
        totalSentences: words * 10,
        totalFootnotes: 0,
        totalCitations: 0,
        totalPages: words,
    };
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

function cloneRecord(record: StatsDailyDeviceRecord): StatsDailyDeviceRecord {
    return {
        ...record,
        activity: { ...record.activity },
        snapshot: { ...record.snapshot },
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

async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

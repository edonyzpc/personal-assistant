import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { createHash, webcrypto } from "node:crypto";

import { describe, expect, it, jest } from "@jest/globals";

interface OpfsStats {
    status?: string;
    backend?: string;
    fallbackMode?: boolean;
    storagePersisted?: boolean;
    fileCount?: number;
    chunkCount?: number;
    estimatedDbBytes?: number;
    lexicalProfileId?: string;
    lexicalProfileState?: string;
    lexicalGeneration?: number;
    databaseName?: string;
    opfsDirectory?: string;
    opfsVfsName?: string;
    databaseInstanceId?: string;
    indexId?: string;
    indexBuiltAt?: string;
    chunkMutationEpoch?: number;
    indexMutationEpoch?: number;
    rebuildEpoch?: number;
    lexicalMaintenanceEpoch?: number;
}

interface HarnessState {
    runner: string;
    pluginArtifact: string;
    loadedPluginArtifactSha256?: string | null;
    pluginVersion: string;
    appVersion: string;
    appVersionSource: string;
    stats: OpfsStats;
    files: Map<string, string>;
    reads: string[];
    writes: string[];
    statsCalls: Array<Record<string, unknown>>;
    forbiddenCalls: string[];
}

interface RuntimeOptions {
    pid: number;
    timeOrigin: number;
    mainProcessPid?: number;
    shellVersion?: string;
    electronVersion?: string;
    platform?: string;
    arch?: string;
    processType?: string;
    clockMs?: number;
}

interface OpfsRecorder {
    baselinePath: string;
    receiptPath: string;
    beforeAssertion: string;
    afterAssertion: string;
    captureBefore(options?: { operatorConfirmed?: boolean }): Promise<Record<string, any>>;
    captureAfter(options?: { operatorConfirmed?: boolean }): Promise<Record<string, any>>;
}

const repositoryRoot = resolve(__dirname, "..");
const runnerPath = resolve(repositoryRoot, "scripts/retrieval-opfs-restart-runner.js");
const runner = readFileSync(runnerPath, "utf8");
const BASELINE_PATH = "retrieval-opfs-restart-baseline.json";
const RECEIPT_PATH = "retrieval-opfs-restart-receipt.json";
const PLUGIN_PATH = ".obsidian/plugins/personal-assistant/main.js";

function createState(overrides: Partial<HarnessState> = {}): HarnessState {
    return {
        runner,
        pluginArtifact: "stable-plugin-artifact",
        pluginVersion: "2.9.0",
        appVersion: "1.13.4",
        appVersionSource: "obsidian.apiVersion",
        stats: {
            status: "ready",
            backend: "sqlite-wasm-opfs-sahpool",
            fallbackMode: false,
            storagePersisted: true,
            fileCount: 72,
            chunkCount: 144,
            estimatedDbBytes: 524_288,
            lexicalProfileId: "char-phrase-v1",
            lexicalProfileState: "ready",
            lexicalGeneration: 3,
            databaseName: "private-vault-id.sqlite3",
            opfsDirectory: "/personal-assistant-vss-v2/private-vault-id",
            opfsVfsName: "opfs-sahpool-private-vault-id",
            databaseInstanceId: "e6c8a888-f4af-44c2-9f87-a14d5739e3f0",
            indexId: "index-42f7138f-8472-40a4-b98c-57098d7511ff",
            indexBuiltAt: "2026-08-09T09:00:00.000Z",
            chunkMutationEpoch: 91,
            indexMutationEpoch: 104,
            rebuildEpoch: 2,
            lexicalMaintenanceEpoch: 7,
        },
        files: new Map<string, string>(),
        reads: [],
        writes: [],
        statsCalls: [],
        forbiddenCalls: [],
        ...overrides,
    };
}

async function bootRunner(
    state: HarnessState,
    options: RuntimeOptions,
): Promise<OpfsRecorder> {
    const electronVersion = options.electronVersion ?? "39.8.3";
    const DateForContext = options.clockMs === undefined
        ? Date
        : class FixedDate extends Date {
            constructor(value?: string | number) {
                super(value ?? options.clockMs ?? 0);
            }

            static now(): number {
                return options.clockMs as number;
            }
        };
    const forbidden = (name: string): never => {
        state.forbiddenCalls.push(name);
        throw new Error(`${name} must not be called`);
    };
    const artifactAtPluginLoad = state.pluginArtifact;
    const plugin = {
        manifest: { id: "personal-assistant", version: state.pluginVersion },
        getObsidianRuntimeIdentity: (): Record<string, string> => ({
            loadedAppVersion: state.appVersion,
            loadedAppVersionSource: state.appVersionSource,
        }),
        getLoadedPluginBuildIdentity: async (): Promise<Record<string, unknown>> => ({
            schemaVersion: 1,
            pluginId: "personal-assistant",
            pluginVersion: state.pluginVersion,
            pluginArtifactPath: PLUGIN_PATH,
            loadedPluginArtifactSha256: state.loadedPluginArtifactSha256 === undefined
                ? hash(artifactAtPluginLoad)
                : state.loadedPluginArtifactSha256,
            lexicalProfileRuntimeFingerprint: "char-phrase-v1:stable-runtime",
            capturedAtPluginLoad: new Date(options.clockMs ?? Date.now()).toISOString(),
            identitySource: "plugin-onload-cached-main-js",
            blocker: null,
        }),
        vss: {
            getStats: async (request: Record<string, unknown>): Promise<OpfsStats> => {
                state.statsCalls.push({ ...request });
                return { ...state.stats };
            },
            rebuildLocalIndex: (): never => forbidden("rebuildLocalIndex"),
            refresh: (): never => forbidden("refresh"),
            reconcile: (): never => forbidden("reconcile"),
        },
        memoryManager: {
            prepareMemory: (): never => forbidden("prepareMemory"),
            updateMemory: (): never => forbidden("updateMemory"),
        },
        aiService: {
            invoke: (): never => forbidden("provider.invoke"),
        },
    };
    const context: Record<string, unknown> = {
        app: {
            plugins: { plugins: { "personal-assistant": plugin } },
            vault: {
                configDir: ".obsidian",
                adapter: {
                    read: async (path: string): Promise<string> => {
                        state.reads.push(path);
                        if (path === "retrieval-opfs-restart-runner.js") return state.runner;
                        if (path === PLUGIN_PATH) return state.pluginArtifact;
                        const stored = state.files.get(path);
                        if (stored !== undefined) return stored;
                        throw new Error("file unavailable");
                    },
                    write: async (path: string, contents: string): Promise<void> => {
                        state.writes.push(path);
                        state.files.set(path, contents);
                    },
                },
            },
        },
        console: {
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        },
        crypto: webcrypto,
        navigator: {
            userAgent: `Mozilla/5.0 Electron/${electronVersion} Obsidian/${options.shellVersion ?? "1.12.7"}`,
        },
        performance: { timeOrigin: options.timeOrigin },
        process: {
            pid: options.pid,
            ppid: options.mainProcessPid ?? 704,
            type: options.processType ?? "renderer",
            platform: options.platform ?? "darwin",
            arch: options.arch ?? "arm64",
            versions: { electron: electronVersion },
        },
        TextEncoder,
        Date: DateForContext,
    };
    await runInNewContext(runner, context);
    return context.paRetrievalOpfsRestart as OpfsRecorder;
}

async function capturePassingBaseline(state: HarnessState): Promise<Record<string, any>> {
    const recorder = await bootRunner(state, { pid: 101, timeOrigin: 1_000 });
    return recorder.captureBefore({ operatorConfirmed: true });
}

describe("retrieval OPFS restart runner", () => {
    it("captures a content-free baseline from foreground durable OPFS stats", async () => {
        const state = createState();
        const recorder = await bootRunner(state, { pid: 101, timeOrigin: 1_000 });

        const baseline = await recorder.captureBefore({ operatorConfirmed: true });

        expect(baseline).toMatchObject({
            schemaVersion: 1,
            receiptType: "personal-assistant-retrieval-opfs-restart",
            phase: "before",
            status: "PASS",
            operatorAssertion: {
                status: "PASS",
                confirmed: true,
                basis: "operator-attestation-not-independently-verified",
            },
            snapshot: {
                status: "PASS",
                runtime: {
                    appVersion: "1.13.4",
                    appVersionSource: "obsidian.apiVersion",
                    shellVersion: "1.12.7",
                    electronVersion: "39.8.3",
                    platform: "darwin",
                    arch: "arm64",
                    pid: 101,
                    mainProcessPid: 704,
                    mainProcessIdentitySource: "electron-renderer:process.ppid",
                    timeOrigin: 1_000,
                },
                storage: {
                    status: "ready",
                    backend: "sqlite-wasm-opfs-sahpool",
                    fallbackMode: false,
                    storagePersistenceGrant: {
                        persisted: true,
                        role: "diagnostic-only-not-a-durable-ready-gate",
                    },
                    fileCount: 72,
                    chunkCount: 144,
                    estimatedDbBytes: 524_288,
                    lexicalProfile: {
                        id: "char-phrase-v1",
                        state: "ready",
                        generation: 3,
                    },
                    continuity: {
                        databaseInstanceIdSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
                        indexIdSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
                        indexBuiltAt: "2026-08-09T09:00:00.000Z",
                        chunkMutationEpoch: 91,
                        indexMutationEpoch: 104,
                        rebuildEpoch: 2,
                        lexicalMaintenanceEpoch: 7,
                    },
                },
                plugin: {
                    id: "personal-assistant",
                    version: "2.9.0",
                    artifactSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
                    loadedBuild: {
                        loadedPluginArtifactSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
                        identitySource: "plugin-onload-cached-main-js",
                        blocker: null,
                    },
                },
                runner: {
                    artifactSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
                },
            },
            evidencePolicy: {
                contentFree: true,
                rawStorageScopeStored: false,
                forbiddenRunnerActionsInvoked: [],
            },
            evidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        });
        expect(state.statsCalls).toEqual([{ mode: "foreground" }]);
        expect(state.writes).toEqual([BASELINE_PATH]);
        expect(state.forbiddenCalls).toEqual([]);

        const serialized = state.files.get(BASELINE_PATH) ?? "";
        expect(serialized).not.toContain("private-vault-id.sqlite3");
        expect(serialized).not.toContain("/personal-assistant-vss-v2/private-vault-id");
        expect(serialized).not.toContain("opfs-sahpool-private-vault-id");
        expect(serialized).not.toContain("e6c8a888-f4af-44c2-9f87-a14d5739e3f0");
        expect(serialized).not.toContain("index-42f7138f-8472-40a4-b98c-57098d7511ff");
        expect(baseline.snapshot.storage.scopeIdentity).toEqual({
            databaseNameSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            opfsDirectorySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            opfsVfsNameSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            combinedSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        });
    });

    it("passes only after a new process and time origin with all stable fields unchanged", async () => {
        const state = createState();
        const before = await capturePassingBaseline(state);
        const afterRecorder = await bootRunner(state, {
            pid: 202,
            mainProcessPid: 1_704,
            timeOrigin: 2_000,
        });

        const receipt = await afterRecorder.captureAfter({ operatorConfirmed: true });

        expect(receipt).toMatchObject({
            phase: "after",
            status: "PASS",
            runIdentitySha256: before.runIdentitySha256,
            evidenceWindow: {
                startedAt: before.capturedAt,
                finishedAt: expect.any(String),
                durationMs: expect.any(Number),
                maximumDurationMs: 900_000,
                withinMaximum: true,
            },
            operatorAssertions: {
                before: { status: "PASS", confirmed: true },
                after: { status: "PASS", confirmed: true },
                status: "PASS",
            },
            baselineBinding: {
                path: BASELINE_PATH,
                artifactSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
                evidenceSha256: before.evidenceSha256,
                status: "PASS",
            },
            comparison: {
                status: "PASS",
                fullAppRestart: {
                    status: "PASS",
                    pidChanged: true,
                    mainProcessPidChanged: true,
                    mainProcessIdentitySource: "electron-renderer:process.ppid",
                    timeOriginChanged: true,
                },
            },
            before: { runtime: { pid: 101, timeOrigin: 1_000 } },
            after: {
                runtime: { pid: 202, mainProcessPid: 1_704, timeOrigin: 2_000 },
            },
            evidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        });
        expect(Object.values(receipt.comparison.stableFields)).toEqual(
            expect.arrayContaining(["PASS"]),
        );
        expect(Object.values(receipt.comparison.stableFields)).not.toContain("FAIL");
        expect(state.statsCalls).toEqual([{ mode: "foreground" }, { mode: "foreground" }]);
        expect(state.writes).toEqual([BASELINE_PATH, RECEIPT_PATH]);
        expect(state.forbiddenCalls).toEqual([]);
        expect(state.reads).toEqual([
            PLUGIN_PATH,
            "retrieval-opfs-restart-runner.js",
            BASELINE_PATH,
            PLUGIN_PATH,
            "retrieval-opfs-restart-runner.js",
        ]);
        expect(state.writes.every((path) => path.endsWith(".json"))).toBe(true);
    });

    it("fails a plugin-reload-only or wrong-instance capture", async () => {
        const state = createState();
        await capturePassingBaseline(state);
        const afterRecorder = await bootRunner(state, { pid: 101, timeOrigin: 1_000 });

        const receipt = await afterRecorder.captureAfter({ operatorConfirmed: true });

        expect(receipt.status).toBe("FAIL");
        expect(receipt.comparison.fullAppRestart).toEqual({
            status: "FAIL",
            pidChanged: false,
            mainProcessPidChanged: false,
            mainProcessIdentitySource: "electron-renderer:process.ppid",
            timeOriginChanged: false,
        });
        expect(receipt.issues).toEqual(expect.arrayContaining([
            { code: "full_app_restart_pid_unchanged", status: "FAIL" },
            { code: "full_app_restart_main_process_pid_unchanged", status: "FAIL" },
            { code: "full_app_restart_time_origin_unchanged", status: "FAIL" },
        ]));
    });

    it("rejects a new renderer when the Electron main process did not restart", async () => {
        const state = createState();
        await capturePassingBaseline(state);
        const afterRecorder = await bootRunner(state, {
            pid: 202,
            mainProcessPid: 704,
            timeOrigin: 2_000,
        });

        const receipt = await afterRecorder.captureAfter({ operatorConfirmed: true });

        expect(receipt.status).toBe("FAIL");
        expect(receipt.comparison.fullAppRestart).toMatchObject({
            status: "FAIL",
            pidChanged: true,
            mainProcessPidChanged: false,
            timeOriginChanged: true,
        });
        expect(receipt.issues).toContainEqual({
            code: "full_app_restart_main_process_pid_unchanged",
            status: "FAIL",
        });
    });

    it("fails when the loaded plugin artifact drifts across the restart", async () => {
        const state = createState();
        await capturePassingBaseline(state);
        state.pluginArtifact = "changed-plugin-artifact";
        const afterRecorder = await bootRunner(state, {
            pid: 202, mainProcessPid: 1_704, timeOrigin: 2_000,
        });

        const receipt = await afterRecorder.captureAfter({ operatorConfirmed: true });

        expect(receipt.status).toBe("FAIL");
        expect(receipt.comparison.stableFields["plugin.artifactSha256"]).toBe("FAIL");
        expect(receipt.issues).toContainEqual({
            code: "stable_field_drift:plugin.artifactSha256",
            status: "FAIL",
        });
    });

    it("fails a stale loaded instance after a newer plugin artifact is copied to disk", async () => {
        const state = createState();
        await capturePassingBaseline(state);
        const oldLoadedSha256 = hash(state.pluginArtifact);
        state.pluginArtifact = "new-plugin-artifact-on-disk";
        state.loadedPluginArtifactSha256 = oldLoadedSha256;
        const afterRecorder = await bootRunner(state, {
            pid: 202, mainProcessPid: 1_704, timeOrigin: 2_000,
        });

        const receipt = await afterRecorder.captureAfter({ operatorConfirmed: true });

        expect(receipt.status).toBe("FAIL");
        expect(receipt.after.issues).toContainEqual({
            code: "loaded_plugin_artifact_mismatch",
            status: "FAIL",
        });
        expect(receipt.after.plugin.loadedBuild.loadedPluginArtifactSha256).toBe(
            oldLoadedSha256,
        );
        expect(receipt.after.plugin.artifactSha256).toBe(hash(state.pluginArtifact));
    });

    it("fails when the lexical profile marker drifts across the restart", async () => {
        const state = createState();
        await capturePassingBaseline(state);
        state.stats = { ...state.stats, lexicalGeneration: 4 };
        const afterRecorder = await bootRunner(state, {
            pid: 202, mainProcessPid: 1_704, timeOrigin: 2_000,
        });

        const receipt = await afterRecorder.captureAfter({ operatorConfirmed: true });

        expect(receipt.status).toBe("FAIL");
        expect(receipt.comparison.stableFields["storage.lexicalProfile.generation"]).toBe("FAIL");
        expect(receipt.issues).toContainEqual({
            code: "stable_field_drift:storage.lexicalProfile.generation",
            status: "FAIL",
        });
    });

    it("fails closed when the after snapshot falls back from durable OPFS", async () => {
        const state = createState();
        await capturePassingBaseline(state);
        state.stats = {
            ...state.stats,
            backend: "memory-vector-index",
            fallbackMode: true,
            storagePersisted: false,
        };
        const afterRecorder = await bootRunner(state, {
            pid: 202, mainProcessPid: 1_704, timeOrigin: 2_000,
        });

        const receipt = await afterRecorder.captureAfter({ operatorConfirmed: true });

        expect(receipt.status).toBe("FAIL");
        expect(receipt.after.status).toBe("FAIL");
        expect(receipt.after.issues).toEqual(expect.arrayContaining([
            { code: "vss_backend_invalid", status: "FAIL" },
            { code: "fallback_mode_active", status: "FAIL" },
        ]));
        expect(receipt.after.storage.storagePersistenceGrant).toMatchObject({
            persisted: false,
            role: "diagnostic-only-not-a-durable-ready-gate",
        });
        expect(receipt.comparison.status).toBe("BLOCKED");
    });

    it("accepts durable OPFS continuity when the persistence grant remains false", async () => {
        const state = createState();
        state.stats = { ...state.stats, storagePersisted: false };
        const baseline = await capturePassingBaseline(state);
        expect(baseline.status).toBe("PASS");
        expect(baseline.snapshot.storage.storagePersistenceGrant).toMatchObject({
            persisted: false,
            role: "diagnostic-only-not-a-durable-ready-gate",
        });
        const afterRecorder = await bootRunner(state, {
            pid: 202, mainProcessPid: 1_704, timeOrigin: 2_000,
        });

        const receipt = await afterRecorder.captureAfter({ operatorConfirmed: true });

        expect(receipt.status).toBe("PASS");
        expect(receipt.comparison.status).toBe("PASS");
        expect(receipt.after.storage.storagePersistenceGrant.persisted).toBe(false);
    });

    it("fails a rebuilt database even when file and chunk counts return to the baseline", async () => {
        const state = createState();
        await capturePassingBaseline(state);
        state.stats = {
            ...state.stats,
            databaseInstanceId: "36c45632-a0f8-4797-b365-ed326655dfe0",
            rebuildEpoch: (state.stats.rebuildEpoch ?? 0) + 1,
        };
        const afterRecorder = await bootRunner(state, {
            pid: 202, mainProcessPid: 1_704, timeOrigin: 2_000,
        });

        const receipt = await afterRecorder.captureAfter({ operatorConfirmed: true });

        expect(receipt.status).toBe("FAIL");
        expect(receipt.before.storage.fileCount).toBe(receipt.after.storage.fileCount);
        expect(receipt.before.storage.chunkCount).toBe(receipt.after.storage.chunkCount);
        expect(receipt.comparison.stableFields[
            "storage.continuity.databaseInstanceIdSha256"
        ]).toBe("FAIL");
        expect(receipt.comparison.stableFields[
            "storage.continuity.rebuildEpoch"
        ]).toBe("FAIL");
    });

    it("fails metadata-only automatic maintenance even when counts and source epoch do not move", async () => {
        const state = createState();
        await capturePassingBaseline(state);
        state.stats = {
            ...state.stats,
            indexMutationEpoch: (state.stats.indexMutationEpoch ?? 0) + 1,
        };
        const afterRecorder = await bootRunner(state, {
            pid: 202, mainProcessPid: 1_704, timeOrigin: 2_000,
        });

        const receipt = await afterRecorder.captureAfter({ operatorConfirmed: true });

        expect(receipt.status).toBe("FAIL");
        expect(receipt.before.storage.fileCount).toBe(receipt.after.storage.fileCount);
        expect(receipt.before.storage.chunkCount).toBe(receipt.after.storage.chunkCount);
        expect(receipt.before.storage.continuity.chunkMutationEpoch).toBe(
            receipt.after.storage.continuity.chunkMutationEpoch,
        );
        expect(receipt.comparison.stableFields[
            "storage.continuity.indexMutationEpoch"
        ]).toBe("FAIL");
    });

    it("fails source mutation or re-embedding even when final counts match", async () => {
        const state = createState();
        await capturePassingBaseline(state);
        state.stats = {
            ...state.stats,
            chunkMutationEpoch: (state.stats.chunkMutationEpoch ?? 0) + 1,
            indexMutationEpoch: (state.stats.indexMutationEpoch ?? 0) + 1,
        };
        const afterRecorder = await bootRunner(state, {
            pid: 202, mainProcessPid: 1_704, timeOrigin: 2_000,
        });

        const receipt = await afterRecorder.captureAfter({ operatorConfirmed: true });

        expect(receipt.status).toBe("FAIL");
        expect(receipt.before.storage.fileCount).toBe(receipt.after.storage.fileCount);
        expect(receipt.before.storage.chunkCount).toBe(receipt.after.storage.chunkCount);
        expect(receipt.comparison.stableFields[
            "storage.continuity.chunkMutationEpoch"
        ]).toBe("FAIL");
    });

    it("fails lexical maintenance that returns to the same profile and generation", async () => {
        const state = createState();
        await capturePassingBaseline(state);
        state.stats = {
            ...state.stats,
            indexMutationEpoch: (state.stats.indexMutationEpoch ?? 0) + 1,
            lexicalMaintenanceEpoch: (state.stats.lexicalMaintenanceEpoch ?? 0) + 1,
        };
        const afterRecorder = await bootRunner(state, {
            pid: 202, mainProcessPid: 1_704, timeOrigin: 2_000,
        });

        const receipt = await afterRecorder.captureAfter({ operatorConfirmed: true });

        expect(receipt.status).toBe("FAIL");
        expect(receipt.before.storage.lexicalProfile).toEqual(
            receipt.after.storage.lexicalProfile,
        );
        expect(receipt.comparison.stableFields[
            "storage.continuity.lexicalMaintenanceEpoch"
        ]).toBe("FAIL");
    });

    it("blocks missing required stats instead of manufacturing persistence evidence", async () => {
        const state = createState({
            stats: {
                status: "ready",
                backend: "sqlite-wasm-opfs-sahpool",
                fallbackMode: false,
                fileCount: 72,
                chunkCount: 144,
                estimatedDbBytes: 524_288,
                lexicalProfileId: "char-phrase-v1",
                lexicalProfileState: "ready",
                lexicalGeneration: 3,
                databaseName: "database.sqlite3",
                opfsDirectory: "/opfs/scope",
                opfsVfsName: "opfs-scope",
            },
        });
        const recorder = await bootRunner(state, { pid: 101, timeOrigin: 1_000 });

        const baseline = await recorder.captureBefore({ operatorConfirmed: true });

        expect(baseline.status).toBe("BLOCKED");
        expect(baseline.snapshot.status).toBe("BLOCKED");
        expect(baseline.issues).toContainEqual({
            code: "database_instance_id_missing",
            status: "BLOCKED",
        });
    });

    it("blocks an unconfirmed operator window and states its evidentiary limit", async () => {
        const state = createState();
        const recorder = await bootRunner(state, { pid: 101, timeOrigin: 1_000 });

        const baseline = await recorder.captureBefore();

        expect(baseline.status).toBe("BLOCKED");
        expect(baseline.operatorAssertion).toMatchObject({
            confirmed: false,
            confirmedAt: null,
            status: "BLOCKED",
        });
        expect(baseline.issues).toContainEqual({
            code: "operator_before_assertion_missing",
            status: "BLOCKED",
        });
        expect(baseline.limitations).toEqual(expect.arrayContaining([
            expect.stringContaining("cannot independently observe every action"),
            expect.stringContaining("operator-attested"),
        ]));
        expect(recorder.beforeAssertion).toContain("fully quit and relaunch");
        expect(recorder.afterAssertion).toContain("full quit and relaunch");
    });

    it("blocks an otherwise stable receipt when the restart window expires", async () => {
        const state = createState();
        const startedAtMs = Date.parse("2026-08-09T10:00:00.000Z");
        const beforeRecorder = await bootRunner(state, {
            pid: 101,
            mainProcessPid: 704,
            timeOrigin: 1_000,
            clockMs: startedAtMs,
        });
        await beforeRecorder.captureBefore({ operatorConfirmed: true });
        const afterRecorder = await bootRunner(state, {
            pid: 202,
            mainProcessPid: 1_704,
            timeOrigin: 2_000,
            clockMs: startedAtMs + 900_001,
        });

        const receipt = await afterRecorder.captureAfter({ operatorConfirmed: true });

        expect(receipt.status).toBe("BLOCKED");
        expect(receipt.comparison.status).toBe("PASS");
        expect(receipt.evidenceWindow).toMatchObject({
            durationMs: 900_001,
            maximumDurationMs: 900_000,
            withinMaximum: false,
        });
        expect(receipt.issues).toContainEqual({
            code: "evidence_window_expired",
            status: "BLOCKED",
        });
    });

    it("blocks a missing or integrity-drifted baseline", async () => {
        const missingState = createState();
        const missingRecorder = await bootRunner(missingState, {
            pid: 202, mainProcessPid: 1_704, timeOrigin: 2_000,
        });
        const missingReceipt = await missingRecorder.captureAfter({ operatorConfirmed: true });
        expect(missingReceipt.status).toBe("BLOCKED");
        expect(missingReceipt.issues).toContainEqual({
            code: "baseline_unavailable",
            status: "BLOCKED",
        });

        const tamperedState = createState();
        await capturePassingBaseline(tamperedState);
        const baseline = JSON.parse(tamperedState.files.get(BASELINE_PATH) ?? "{}") as Record<string, any>;
        baseline.snapshot.storage.fileCount += 1;
        tamperedState.files.set(BASELINE_PATH, `${JSON.stringify(baseline)}\n`);
        const tamperedRecorder = await bootRunner(tamperedState, {
            pid: 202, mainProcessPid: 1_704, timeOrigin: 2_000,
        });
        const tamperedReceipt = await tamperedRecorder.captureAfter({ operatorConfirmed: true });
        expect(tamperedReceipt.status).toBe("BLOCKED");
        expect(tamperedReceipt.issues).toContainEqual({
            code: "baseline_invalid",
            status: "BLOCKED",
        });
        expect(tamperedReceipt.before).toBeNull();
    });

    it("fails invalid formal runtime identity and blocks a missing identity seam", async () => {
        const invalidSourceState = createState({ appVersionSource: "app.version" });
        const invalidSourceRecorder = await bootRunner(
            invalidSourceState,
            { pid: 101, timeOrigin: 1_000 },
        );
        const invalidSource = await invalidSourceRecorder.captureBefore({ operatorConfirmed: true });
        expect(invalidSource.status).toBe("FAIL");
        expect(invalidSource.issues).toContainEqual({
            code: "app_version_source_invalid",
            status: "FAIL",
        });

        const missingState = createState({ appVersion: "" });
        const missingRecorder = await bootRunner(missingState, { pid: 101, timeOrigin: 1_000 });
        const missing = await missingRecorder.captureBefore({ operatorConfirmed: true });
        expect(missing.status).toBe("BLOCKED");
        expect(missing.issues).toContainEqual({
            code: "app_version_missing",
            status: "BLOCKED",
        });
    });
});

function hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

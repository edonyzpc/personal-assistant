import { TFile, type EventRef, type TAbstractFile } from "obsidian";

import type { MemoryExtractionScheduler } from "../ai-services/memory-extraction/extraction-scheduler";
import type { MemoryManager } from "../memory-manager";
import type { VSS, VSSChangeObservation } from "../vss";

const MEMORY_STARTUP_EVENT_REPLAY_WINDOW_MS = 90_000;
const MEMORY_STARTUP_EVENT_MTIME_GRACE_MS = 5_000;

export interface VaultEventBridgeDependencies {
    registerEvent(eventRef: EventRef): void;
    onMetadataEvent(
        event: "resolved" | "changed",
        callback: () => void,
    ): EventRef;
    onVaultEvent(
        event: "create" | "modify" | "rename" | "delete",
        callback: (file: TAbstractFile, oldPath?: string) => unknown,
    ): EventRef;
    onWorkspaceActiveLeafChange(callback: () => unknown): EventRef;
    onWorkspaceFileOpen(callback: (file: TFile | null) => unknown): EventRef;
    invalidateVaultInsightsSource(file: TAbstractFile, oldPath?: string): void;
    invalidateMemoryGraphTopology(): void;
    getVss(): VSS | null;
    getMemoryManager(): MemoryManager | null;
    getMemoryExtractionScheduler(): MemoryExtractionScheduler | null;
    isRecentPageletSelfWrite(path: string): boolean;
    scheduleMemoryStatus(): void;
}

export class VaultEventBridge {
    private memoryEventGateStartedAt = Date.now();

    constructor(private readonly dependencies: VaultEventBridgeDependencies) {}

    resetStartupEventGate(): void {
        this.memoryEventGateStartedAt = Date.now();
    }

    registerEventDispatch(): void {
        this.dependencies.registerEvent(
            this.dependencies.onMetadataEvent("resolved", () => {
                this.dependencies.invalidateMemoryGraphTopology();
            }),
        );
        this.dependencies.registerEvent(
            this.dependencies.onMetadataEvent("changed", () => {
                this.dependencies.invalidateMemoryGraphTopology();
            }),
        );
        this.dependencies.registerEvent(
            this.dependencies.onVaultEvent("create", async (file) => {
                this.dependencies.invalidateVaultInsightsSource(file);
                this.dependencies.invalidateMemoryGraphTopology();
                if (file instanceof TFile) {
                    if (this.dependencies.isRecentPageletSelfWrite(file.path)) return;
                    this.dependencies.getMemoryExtractionScheduler()?.handleVaultEvent(file, "vault-create");
                    await this.handleMemoryVaultChange(file, "vault-create");
                }
            }),
        );
        this.dependencies.registerEvent(
            this.dependencies.onVaultEvent("modify", async (file) => {
                this.dependencies.invalidateVaultInsightsSource(file);
                this.dependencies.invalidateMemoryGraphTopology();
                if (file instanceof TFile) {
                    if (this.dependencies.isRecentPageletSelfWrite(file.path)) return;
                    this.dependencies.getMemoryExtractionScheduler()?.handleVaultEvent(file, "vault-modify");
                    await this.handleMemoryVaultChange(file, "vault-modify");
                }
            }),
        );
        this.dependencies.registerEvent(
            this.dependencies.onVaultEvent("rename", async (file, oldPath) => {
                this.dependencies.invalidateVaultInsightsSource(file, oldPath);
                this.dependencies.invalidateMemoryGraphTopology();
                this.dependencies.getMemoryExtractionScheduler()?.handleVaultEvent(file, "vault-rename");
                if (file instanceof TFile && await this.dependencies.getVss()?.handleRename(file, oldPath ?? file.path)) {
                    this.dependencies.getMemoryManager()?.scheduleAutoFlush("vault-rename");
                    this.dependencies.scheduleMemoryStatus();
                }
            }),
        );
        this.dependencies.registerEvent(
            this.dependencies.onVaultEvent("delete", async (file) => {
                this.dependencies.invalidateVaultInsightsSource(file);
                this.dependencies.invalidateMemoryGraphTopology();
                if (file instanceof TFile) {
                    this.dependencies.getMemoryExtractionScheduler()?.handleVaultEvent(file, "vault-delete");
                    await this.dependencies.getVss()?.handleDelete(file);
                    this.dependencies.scheduleMemoryStatus();
                }
            }),
        );
        this.dependencies.registerEvent(
            this.dependencies.onWorkspaceActiveLeafChange(async () => {
                await this.dependencies.getVss()?.handleActiveLeafChange();
            }),
        );
        this.dependencies.registerEvent(
            this.dependencies.onWorkspaceFileOpen(async (file) => {
                if (await this.dependencies.getVss()?.handleFileOpen(file)) {
                    const state = this.dependencies.getVss()?.getMaintenanceState();
                    if (!state) return;
                    if (state.verificationPending > 0) {
                        this.dependencies.getMemoryManager()?.scheduleVerify("file-open");
                    }
                    if (state.dirtyCount > 0) {
                        this.dependencies.getMemoryManager()?.scheduleAutoFlush("file-open");
                    }
                    this.dependencies.scheduleMemoryStatus();
                }
            }),
        );
    }

    async handleMemoryVaultChange(
        file: TFile,
        reason: "vault-create" | "vault-modify",
    ): Promise<void> {
        const isStartupReplay = this.isLikelyStartupReplayMemoryEvent(file);
        const observation: VSSChangeObservation | undefined = await this.dependencies.getVss()
            ?.observeChangedFile(file, reason, "metadata-drift", {
                verifyMatchingMetadata: reason === "vault-modify" && !isStartupReplay,
            });
        if (!observation) return;
        if (observation.kind === "confirmed-dirty") {
            this.dependencies.getMemoryManager()?.scheduleAutoFlush(reason);
            this.dependencies.scheduleMemoryStatus();
        } else if (observation.kind === "verify-candidate") {
            this.dependencies.getMemoryManager()?.scheduleVerify(reason);
        }
    }

    isLikelyStartupReplayMemoryEvent(file: TFile): boolean {
        if (typeof this.memoryEventGateStartedAt !== "number" || !Number.isFinite(this.memoryEventGateStartedAt)) {
            this.memoryEventGateStartedAt = Date.now();
        }
        if (Date.now() - this.memoryEventGateStartedAt > MEMORY_STARTUP_EVENT_REPLAY_WINDOW_MS) {
            return false;
        }
        const mtime = file.stat?.mtime;
        return typeof mtime === "number"
            && mtime < this.memoryEventGateStartedAt - MEMORY_STARTUP_EVENT_MTIME_GRACE_MS;
    }
}

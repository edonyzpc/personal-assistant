import { type EventRef, moment as obsidianMoment, TFile } from "obsidian";

import {
    clearPlatformTimeout,
    setPlatformTimeout,
    type PlatformTimeoutHandle,
} from "../platform-dom";

export interface MetadataRule {
    key: string;
    value: string;
    t: string;
}

export interface MetadataUpdaterSettings {
    enableMetadataUpdating: boolean;
    metadataExcludePath: string[];
    metadatas: MetadataRule[];
}

interface MetadataWorkspace {
    on(event: "file-open", listener: (file: TFile | null) => void): EventRef;
}

interface MetadataCache {
    getCache(path: string): { frontmatter?: Record<string, unknown> } | null;
}

interface MetadataFileManager {
    processFrontMatter(
        file: TFile,
        fn: (frontmatter: Record<string, unknown>) => void,
    ): Promise<void>;
}

export interface MetadataUpdaterDependencies {
    workspace: MetadataWorkspace;
    metadataCache: MetadataCache;
    fileManager: MetadataFileManager;
    getSettings(): MetadataUpdaterSettings;
    log(message: unknown, ...args: unknown[]): void;
    setActive(active: boolean): void;
    notifyDisabled(): void;
    registerEvent(eventRef: EventRef): void;
}

const moment = obsidianMoment as unknown as (...args: unknown[]) => {
    format: (format: string) => string;
};
const METADATA_DEBOUNCE_MS = 100;
const METADATA_CLEANUP_MS = 100;

export class MetadataUpdater {
    private enabled = false;
    private disposed = false;
    private generation = 0;
    private eventRef: EventRef | null = null;
    private eventGeneration: number | null = null;
    private pendingFile: TFile | null = null;
    private pendingTimeout: PlatformTimeoutHandle | null = null;
    private cleanupTimeout: PlatformTimeoutHandle | null = null;

    constructor(private readonly dependencies: MetadataUpdaterDependencies) {}

    toggle(): void {
        if (this.disposed) return;
        if (!this.dependencies.getSettings().enableMetadataUpdating) {
            if (this.enabled) this.stop();
            this.dependencies.notifyDisabled();
            return;
        }
        if (this.enabled) {
            this.stop();
            return;
        }
        this.start();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.stop();
    }

    private start(): void {
        this.enabled = true;
        this.eventGeneration = this.generation;
        this.setActive(true);
        if (this.eventRef) return;
        this.eventRef = this.dependencies.workspace.on("file-open", this.handleFileOpen);
        this.dependencies.registerEvent(this.eventRef);
    }

    private stop(): void {
        this.enabled = false;
        this.eventGeneration = null;
        this.generation += 1;
        this.cancelPendingUpdate();
        this.cancelCleanup();
        this.setActive(false);
    }

    private readonly handleFileOpen = (file: TFile | null): void => {
        const generation = this.eventGeneration;
        if (!this.isCurrentArmedGeneration(generation)) return;
        if (!this.dependencies.getSettings().enableMetadataUpdating) {
            this.stop();
            return;
        }

        if (this.pendingTimeout !== null) {
            clearPlatformTimeout(this.pendingTimeout);
            this.pendingTimeout = null;
        }
        this.pendingFile = file;
        this.pendingTimeout = setPlatformTimeout(() => {
            this.processPendingUpdate(generation);
        }, METADATA_DEBOUNCE_MS);
    };

    private processPendingUpdate(generation: number): void {
        if (!this.isCurrentArmedGeneration(generation)) return;
        if (!this.dependencies.getSettings().enableMetadataUpdating) {
            this.stop();
            return;
        }

        this.pendingTimeout = null;
        const file = this.pendingFile;
        this.pendingFile = null;
        if (file === null) return;
        this.update(file, generation);
    }

    private update(file: TFile, generation: number): void {
        if (!this.isCurrentArmedGeneration(generation)) return;
        if (!this.dependencies.getSettings().enableMetadataUpdating) {
            this.stop();
            return;
        }
        if (!(file instanceof TFile) || file.extension !== "md") return;

        let filterPath = file.path;
        for (const path of this.dependencies.getSettings().metadataExcludePath) {
            if (path !== "" && file.path.startsWith(path)) {
                this.dependencies.log(`filtered ${file.path} in ${path}`);
                filterPath = "";
                break;
            }
        }

        const meta = this.dependencies.metadataCache.getCache(filterPath);
        if (!meta?.frontmatter) return;

        void this.dependencies.fileManager.processFrontMatter(file, (frontmatter) => {
            for (const key of Object.getOwnPropertyNames(frontmatter)) {
                for (const metaConfig of this.dependencies.getSettings().metadatas) {
                    if (key !== metaConfig.key) continue;
                    this.dependencies.log(frontmatter[key]);
                    let valueToChange: string;
                    switch (metaConfig.t) {
                        case "moment":
                            valueToChange = moment(new Date(file.stat.mtime)).format(metaConfig.value);
                            break;
                        case "string":
                            valueToChange = metaConfig.value;
                            break;
                        default:
                            valueToChange = metaConfig.value;
                            break;
                    }
                    frontmatter[key] = valueToChange;
                }
            }
            this.scheduleCleanup(generation);
        }).catch((error: unknown) => {
            this.dependencies.log("Failed to update metadata frontmatter", error);
        });
    }

    private isCurrentArmedGeneration(generation: number | null): generation is number {
        return !this.disposed
            && this.enabled
            && generation !== null
            && this.eventGeneration === generation
            && generation === this.generation;
    }

    private scheduleCleanup(generation: number): void {
        if (!this.isCurrentArmedGeneration(generation)) return;
        if (!this.dependencies.getSettings().enableMetadataUpdating) {
            this.stop();
            return;
        }

        this.cancelCleanup();
        this.cleanupTimeout = setPlatformTimeout(() => {
            if (generation !== this.generation) return;
            this.cancelPendingUpdate();
        }, METADATA_CLEANUP_MS);
    }

    private cancelPendingUpdate(): void {
        if (this.pendingTimeout !== null) {
            clearPlatformTimeout(this.pendingTimeout);
        }
        this.pendingTimeout = null;
        this.pendingFile = null;
    }

    private cancelCleanup(): void {
        if (this.cleanupTimeout !== null) {
            clearPlatformTimeout(this.cleanupTimeout);
        }
        this.cleanupTimeout = null;
    }

    private setActive(active: boolean): void {
        this.dependencies.setActive(active);
    }
}

/* Copyright 2023 edonyzpc */

import { App, ItemView, TFile, WorkspaceLeaf, addIcon, debounce, type Debouncer, type EventRef, type TAbstractFile } from "obsidian";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { PluginManager } from './plugin';
import RecordList from './components/RecordList'
import { icons } from './utils';

export const RECORD_PREVIEW_TYPE = "record-preview";
type ReactRoot = ReturnType<typeof createRoot>;

export class RecordPreview extends ItemView {
    componentRoot: ReactRoot | null = null;
    app: App;
    plugin: PluginManager;
    files: string[];
    private vaultEventRefs: EventRef[] = [];
    private isOpen = false;
    private openRunId = 0;
    private refreshRunId = 0;
    private debouncedRefresh: Debouncer<[], void>;

    constructor(app: App, plugin: PluginManager, leaf: WorkspaceLeaf) {
        plugin.log("startup new RecordList");
        super(leaf);
        addIcon('PluginAST_PREVIEW', icons['PluginAST_PREVIEW']);
        this.app = app;
        this.plugin = plugin;
        this.files = [];
        this.debouncedRefresh = debounce(() => {
            void this.refreshFiles().catch((error: unknown) => {
                this.plugin.log("failed to refresh preview records", error);
            });
        }, 150, true);
    }

    getViewType() {
        return RECORD_PREVIEW_TYPE;
    }

    getDisplayText() {
        return "Records Preview";
    }

    getIcon(): string {
        return "PluginAST_PREVIEW";
    }

    async onOpen() {
        this.isOpen = true;
        const openRunId = ++this.openRunId;
        await this.refreshFiles();
        if (!this.isOpen || openRunId !== this.openRunId) return;
        this.registerVaultEvents();
    }

    async onClose() {
        this.isOpen = false;
        this.openRunId++;
        this.refreshRunId++;
        this.debouncedRefresh.cancel();
        this.unregisterVaultEvents();
        this.componentRoot?.unmount();
        this.componentRoot = null;
    }

    private registerVaultEvents() {
        this.unregisterVaultEvents();
        this.vaultEventRefs = [
            this.app.vault.on("create", (file) => this.refreshOnVaultEvent("created", file)),
            this.app.vault.on("modify", (file) => this.refreshOnVaultEvent("changed", file)),
            this.app.vault.on("delete", (file) => this.refreshOnVaultEvent("deleted", file)),
            this.app.vault.on("rename", (file, oldPath) => this.refreshOnVaultEvent("renamed", file, oldPath)),
        ];
    }

    private unregisterVaultEvents() {
        for (const ref of this.vaultEventRefs) {
            this.app.vault.offref(ref);
        }
        this.vaultEventRefs = [];
    }

    private refreshOnVaultEvent(reason: string, file: TAbstractFile, oldPath?: string) {
        if (!this.shouldRefreshForPath(file.path) && (!oldPath || !this.shouldRefreshForPath(oldPath))) {
            return;
        }
        this.plugin.log(`update preview record for file[${file.path}] ${reason}`);
        this.debouncedRefresh();
    }

    private shouldRefreshForPath(path: string) {
        const targetPath = this.plugin.join(this.plugin.settings.targetPath);
        if (targetPath === "." || targetPath === "/" || targetPath === "") {
            return true;
        }
        return path === targetPath || path.startsWith(`${targetPath}/`);
    }

    private async refreshFiles() {
        const refreshRunId = ++this.refreshRunId;
        const dir = await this.app.vault.adapter.list(this.plugin.settings.targetPath);
        const files = dir.files.sort((file1, file2) => {
            const tFile1 = this.app.vault.getAbstractFileByPath(file1);
            const tFile2 = this.app.vault.getAbstractFileByPath(file2);
            if (tFile1 instanceof TFile && tFile2 instanceof TFile) {
                return tFile1.stat.mtime - tFile2.stat.mtime;
            }
            return file1 < file2 ? -1 : file1 > file2 ? 1 : 0;
        });
        const formattedFiles = files.filter((fileName, idx, _) => {
            const reg = RegExp(/\[(.*)\]/, "i");
            const formattedName = reg.exec(this.plugin.settings.fileFormat);
            if (formattedName && formattedName.length > 1) {
                // find the formatted files which format style is set in `setting.fileFormat`
                const fileNameWithoutPath = fileName.substring(fileName.lastIndexOf('/')+1);
                return fileNameWithoutPath.endsWith(".md") && fileNameWithoutPath.includes(formattedName[1]);
            } else {
                // no foramtted files
                return false;
            }
        });
        const formattedFileSet = new Set(formattedFiles);
        const nonformattedFiles = files.filter((fileName, idx, _) => {
            return fileName.endsWith(".md") && !formattedFileSet.has(fileName);
        });
        if (!this.isOpen || refreshRunId !== this.refreshRunId) return;
        this.files = formattedFiles.reverse().concat(nonformattedFiles.reverse());
        this.mountComponent(this.getPreviewLimit());
    }

    private mountComponent(limits: number) {
        if (!this.isOpen) return;
        if (!this.componentRoot) {
            this.componentRoot = createRoot(this.contentEl);
        }
        this.componentRoot.render(
            createElement(RecordList, {
                app: this.app,
                plugin: this.plugin,
                fileNames: this.files.slice(0, limits),
                container: this.containerEl,
            })
        );
    }

    private getPreviewLimit() {
        const limit = this.plugin.settings.previewLimits;
        if (!Number.isFinite(limit) || limit < 0) return 0;
        return Math.min(Math.floor(limit), this.files.length);
    }
}

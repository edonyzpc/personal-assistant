import { type App, Notice, TFile, normalizePath } from "obsidian";

import { RECORD_PREVIEW_TYPE } from "../preview";
import { buildNoteTemplateContext, DEFAULT_NOTE_TEMPLATE, renderNoteTemplate } from "../note-template";
import { linkRecordToIndex } from "./record-index";

export interface RecordActionSettings {
    targetPath: string;
    fileFormat: string;
    author: string;
    noteTemplate: string;
    recordIndexPath?: string;
}

export interface RecordActionDependencies {
    app: App;
    getSettings(): RecordActionSettings;
    log(message: string, ...args: unknown[]): void;
}

export function joinRecordPaths(...strings: string[]): string {
    const parts = strings.map((value) => String(value).trim()).filter((value) => value != null);
    return normalizePath(parts.join('/'));
}

export class RecordActions {
    constructor(private readonly dependencies: RecordActionDependencies) {}

    join(...strings: string[]): string {
        return joinRecordPaths(...strings);
    }

    async activatePreview(): Promise<void> {
        const { workspace } = this.dependencies.app;
        workspace.detachLeavesOfType(RECORD_PREVIEW_TYPE);

        const viewLeaf = workspace.getLeaf('tab');
        await viewLeaf.setViewState({
            type: RECORD_PREVIEW_TYPE,
            active: true,
        });

        await workspace.revealLeaf(viewLeaf);
    }

    async createNewNote(targetPath: string, fileName: string, timestamp: Date = new Date()): Promise<void> {
        const { vault, workspace } = this.dependencies.app;
        const normalizedTargetPath = this.join(targetPath);
        const directoryPath = this.isVaultRootPath(normalizedTargetPath) ? "" : normalizedTargetPath;
        const filePath = directoryPath === "" ? this.join(`${fileName}.md`) : this.join(directoryPath, `${fileName}.md`);

        try {
            if (vault.getAbstractFileByPath(filePath) instanceof TFile) {
                // If the file already exists, open it and send notification
                const files = vault.getMarkdownFiles();
                for (const file of files) {
                    if (file.path === filePath) {
                        const leaf = workspace.getLeaf('tab');
                        await leaf.openFile(file);
                        return;
                    }
                }
                throw new Error(`${filePath} already exists but fail to open`);
            }
            if (directoryPath !== '') {
                // If `input` includes a directory part, create it
                this.dependencies.log("creating directory path: ", directoryPath);
                await this.createDirectory(directoryPath);
            }
            this.dependencies.log("creating file: ", filePath);
            const settings = this.dependencies.getSettings();
            const template = settings.noteTemplate || DEFAULT_NOTE_TEMPLATE;
            const context = buildNoteTemplateContext(fileName, timestamp, settings.author, "#thoughts");
            const content = renderNoteTemplate(template, context);
            const file = await vault.create(filePath, content);
            await linkRecordToIndex(this.dependencies.app, filePath, settings.recordIndexPath, this.dependencies.log);
            const leaf = workspace.getLeaf('tab');
            await leaf.openFile(file);
        } catch (error: unknown) {
            new Notice((error as Error).toString());
        }
    }

    private isVaultRootPath(path: string): boolean {
        const normalizedPath = this.join(path);
        return normalizedPath === "" || normalizedPath === "." || normalizedPath === "/";
    }

    private async createDirectory(dir: string): Promise<void> {
        const { vault } = this.dependencies.app;
        const directoryPath = this.join(dir);
        if (this.isVaultRootPath(directoryPath)) {
            return;
        }
        /**
         * NOTE: `getAbstractFileByPath` will return TAbstractFile or null,
         * so, to check if the directory is exists, compare the return
         * value by using `==`.
         **/
        if (vault.getAbstractFileByPath(directoryPath) == undefined && !(await vault.adapter.exists(directoryPath))) {
            await vault.createFolder(directoryPath);
        }
    }
}

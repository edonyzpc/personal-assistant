import { MarkdownView, TFile } from "obsidian";
import type {
    Editor,
    MarkdownFileInfo,
    Menu,
    TAbstractFile,
    WorkspaceLeaf,
} from "obsidian";

import {
    createShareCardNoteData,
    createShareCardSelectionData,
} from "../share-card/share-card-source";
import type { ShareCardData } from "../share-card/share-card-types";

interface OpenableModal {
    open(): void;
}

export interface ShareCardActionsDependencies {
    createModal(data: ShareCardData): OpenableModal;
    closeAllModals(): void;
    getMenuTitle(): string;
    getFileMenuTitle(): string;
    readFile(file: TFile): Promise<string>;
    notifyEmpty(): void;
    notifyReadFailed(): void;
    readonly menuIcon: string;
}

export class ShareCardActions {
    private closed = false;

    constructor(private readonly dependencies: ShareCardActionsDependencies) {}

    checkShareSelection(
        checking: boolean,
        editor: Editor,
        info: MarkdownFileInfo,
    ): boolean {
        const selection = editor.getSelection();
        if (selection.trim().length === 0) return false;
        if (checking) return true;
        this.openSelection(selection, info.file?.path);
        return true;
    }

    handleEditorMenu(menu: Menu, editor: Editor, info: MarkdownFileInfo): void {
        const selection = editor.getSelection();
        if (selection.trim().length === 0) return;
        const basePath = info.file?.path;
        menu.addItem((item) => item
            .setTitle(this.dependencies.getMenuTitle())
            .setIcon(this.dependencies.menuIcon)
            .onClick(() => this.openSelection(selection, basePath)));
    }

    handleFileMenu(
        menu: Menu,
        file: TAbstractFile,
        leaf?: WorkspaceLeaf,
    ): void {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        menu.addItem((item) => item
            .setTitle(this.dependencies.getFileMenuTitle())
            .setIcon(this.dependencies.menuIcon)
            .onClick(() => {
                void this.openFile(file, leaf);
            }));
    }

    closeAll(): void {
        this.closed = true;
        this.dependencies.closeAllModals();
    }

    private openSelection(selection: string, basePath?: string): void {
        const data = createShareCardSelectionData(selection, basePath);
        if (!data) return;
        this.openData(data);
    }

    private async openFile(file: TFile, leaf?: WorkspaceLeaf): Promise<void> {
        if (this.closed) return;
        const view = leaf?.view;
        const matchingEditor = view instanceof MarkdownView
            && view.file?.path === file.path
            ? view.editor
            : undefined;
        const selection = matchingEditor?.getSelection?.() ?? "";
        const selectionData = createShareCardSelectionData(selection, file.path);
        if (selectionData) {
            this.openData(selectionData);
            return;
        }

        let rawNote: string;
        try {
            rawNote = matchingEditor?.getValue?.() ?? await this.dependencies.readFile(file);
        } catch {
            if (!this.closed) this.dependencies.notifyReadFailed();
            return;
        }
        if (this.closed) return;
        const data = createShareCardNoteData(rawNote, file.basename, file.path);
        if (!data) {
            this.dependencies.notifyEmpty();
            return;
        }
        this.openData(data);
    }

    private openData(data: ShareCardData): void {
        if (this.closed) return;
        this.dependencies.createModal(data).open();
    }
}

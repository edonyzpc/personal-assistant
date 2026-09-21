import type { Editor, MarkdownFileInfo, Menu } from "obsidian";

import type { ShareCardData } from "../share-card/share-card-types";

interface OpenableModal {
    open(): void;
}

export interface ShareCardActionsDependencies {
    createModal(data: ShareCardData): OpenableModal;
    closeAllModals(): void;
    getMenuTitle(): string;
    readonly menuIcon: string;
}

export class ShareCardActions {
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

    closeAll(): void {
        this.dependencies.closeAllModals();
    }

    private openSelection(selection: string, basePath?: string): void {
        this.dependencies.createModal({
            content: selection,
            source: "selection",
            ...(basePath ? { resourceContext: { basePath } } : {}),
        }).open();
    }
}

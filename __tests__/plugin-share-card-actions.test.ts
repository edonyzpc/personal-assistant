import { describe, expect, it, jest } from "@jest/globals";
import { MarkdownView, TFile, TFolder } from "obsidian";
import {
    WorkspaceLeaf,
    type Editor,
    type MarkdownFileInfo,
    type Menu,
} from "obsidian";

import { ShareCardActions } from "../src/plugin/share-card-actions";
import type { ShareCardData } from "../src/share-card/share-card-types";

interface MenuItemLike {
    setTitle(title: string): unknown;
    setIcon(icon: string): unknown;
    onClick(callback: () => void): unknown;
}

function createHarness() {
    const openedData: ShareCardData[] = [];
    const open = jest.fn();
    const createModal = jest.fn((data: ShareCardData) => {
        openedData.push(data);
        return { open };
    });
    const closeAllModals = jest.fn();
    const getMenuTitle = jest.fn(() => "Share selection as card");
    const getFileMenuTitle = jest.fn(() => "Share as card");
    const readFile = jest.fn(async (_file: TFile) => "");
    const notifyEmpty = jest.fn();
    const notifyReadFailed = jest.fn();
    const actions = new ShareCardActions({
        createModal,
        closeAllModals,
        getMenuTitle,
        getFileMenuTitle,
        readFile,
        notifyEmpty,
        notifyReadFailed,
        menuIcon: "image",
    });

    return {
        actions,
        createModal,
        openedData,
        open,
        closeAllModals,
        getMenuTitle,
        getFileMenuTitle,
        readFile,
        notifyEmpty,
        notifyReadFailed,
    };
}

function createEditor(selection: string, value = "") {
    return {
        getSelection: jest.fn(() => selection),
        getValue: jest.fn(() => value),
    } as unknown as Editor;
}

function createMenu() {
    const builders: Array<(item: MenuItemLike) => unknown> = [];
    const menu = {
        addItem: jest.fn((builder: (item: MenuItemLike) => unknown) => {
            builders.push(builder);
        }),
    } as unknown as Menu;
    return { menu, builders };
}

function clickMenuItem(builder: (item: MenuItemLike) => unknown): () => void {
    const callbacks: Array<() => void> = [];
    const item = {} as MenuItemLike;
    Object.assign(item, {
        setTitle: jest.fn(() => item),
        setIcon: jest.fn(() => item),
        onClick: jest.fn((callback: () => void) => {
            callbacks.push(callback);
            return item;
        }),
    });
    builder(item);
    return callbacks[0] ?? (() => undefined);
}

function createFile(path: string, extension: string): TFile {
    const name = path.split("/").pop() ?? path;
    const file = Object.create(TFile.prototype) as TFile;
    Object.assign(file, {
        path,
        name,
        basename: name.endsWith(`.${extension}`) ? name.slice(0, -extension.length - 1) : name,
        extension,
        stat: { mtime: 0, ctime: 0, size: 0 },
    });
    return file;
}

function createNoteFile(path: string): TFile {
    return createFile(path, "md");
}

function createFolder(path: string): TFolder {
    const folder = Object.create(TFolder.prototype) as TFolder;
    Object.assign(folder, {
        path,
        name: path.split("/").pop() ?? path,
        children: [],
    });
    return folder;
}

function createMarkdownView(editor: Editor, file: TFile): MarkdownView {
    const view = Object.create(MarkdownView.prototype) as MarkdownView;
    Object.assign(view, { editor, file });
    return view;
}

function createWorkspaceLeaf(view: MarkdownView): WorkspaceLeaf {
    return { view } as unknown as WorkspaceLeaf;
}

describe("ShareCardActions", () => {
    it("rejects empty or whitespace selections without opening a modal", () => {
        const harness = createHarness();
        const info: MarkdownFileInfo = { file: { path: "Notes/Source.md" } } as MarkdownFileInfo;

        expect(harness.actions.checkShareSelection(true, createEditor("   \n\t "), info)).toBe(false);
        expect(harness.actions.checkShareSelection(false, createEditor(""), info)).toBe(false);
        expect(harness.createModal).not.toHaveBeenCalled();
        expect(harness.open).not.toHaveBeenCalled();
    });

    it("checks a non-empty selection without side effects and executes with raw spacing", () => {
        const harness = createHarness();
        const rawSelection = "  # Keep spacing\n\n- item  ";
        const editor = createEditor(rawSelection);
        const info: MarkdownFileInfo = { file: { path: "Notes/Source.md" } } as MarkdownFileInfo;

        expect(harness.actions.checkShareSelection(true, editor, info)).toBe(true);
        expect(harness.createModal).not.toHaveBeenCalled();
        expect(harness.actions.checkShareSelection(false, editor, info)).toBe(true);

        expect(harness.openedData).toEqual([{
            content: rawSelection,
            source: "selection",
            resourceContext: { basePath: "Notes/Source.md" },
        }]);
        expect(harness.open).toHaveBeenCalledTimes(1);
    });

    it("opens without an empty resource context when no file path exists", () => {
        const harness = createHarness();
        const info: MarkdownFileInfo = {} as MarkdownFileInfo;

        expect(harness.actions.checkShareSelection(false, createEditor("selected"), info)).toBe(true);

        expect(harness.openedData).toEqual([{
            content: "selected",
            source: "selection",
        }]);
        expect(JSON.stringify(harness.openedData[0])).not.toContain("resourceContext");
    });

    it("creates and opens a fresh modal for each command execution", () => {
        const harness = createHarness();
        const info: MarkdownFileInfo = {} as MarkdownFileInfo;

        harness.actions.checkShareSelection(false, createEditor("first"), info);
        harness.actions.checkShareSelection(false, createEditor("second"), info);

        expect(harness.openedData.map((data) => data.content)).toEqual(["first", "second"]);
        expect(harness.createModal).toHaveBeenCalledTimes(2);
        expect(harness.open).toHaveBeenCalledTimes(2);
    });

    it("does not add a menu item for an empty selection", () => {
        const harness = createHarness();
        const { menu, builders } = createMenu();

        harness.actions.handleEditorMenu(menu, createEditor("  \n"), {
            file: { path: "Notes/Empty.md" },
        } as MarkdownFileInfo);

        expect(menu.addItem as jest.Mock).not.toHaveBeenCalled();
        expect(builders).toHaveLength(0);
        expect(harness.createModal).not.toHaveBeenCalled();
    });

    it("keeps the menu-open selection and path snapshot until click", () => {
        const harness = createHarness();
        const { menu, builders } = createMenu();
        const editor = createEditor("  menu selection  ");
        const file = { path: "Notes/Menu.md" };
        const info = { file } as MarkdownFileInfo;

        harness.actions.handleEditorMenu(menu, editor, info);
        expect(builders).toHaveLength(1);

        const item = {} as MenuItemLike;
        const setTitle = jest.fn<(title: string) => unknown>(() => item);
        const setIcon = jest.fn<(icon: string) => unknown>(() => item);
        const onClick = jest.fn<(callback: () => void) => unknown>(() => item);
        Object.assign(item, {
            setTitle,
            setIcon,
            onClick,
        });
        builders[0]!(item);
        expect(setTitle).toHaveBeenCalledWith("Share selection as card");
        expect(setIcon).toHaveBeenCalledWith("image");

        (editor.getSelection as unknown as jest.Mock<() => string>)
            .mockReturnValue("changed selection");
        Object.assign(file, { path: "Notes/Changed.md" });
        onClick.mock.calls[0]?.[0]();

        expect(harness.openedData).toEqual([{
            content: "  menu selection  ",
            source: "selection",
            resourceContext: { basePath: "Notes/Menu.md" },
        }]);
        expect(editor.getSelection).toHaveBeenCalledTimes(1);
    });

    it("adds the PA file-menu item only for Markdown files", () => {
        const harness = createHarness();
        const markdownMenu = createMenu();
        const pngMenu = createMenu();
        const folderMenu = createMenu();

        harness.actions.handleFileMenu(
            markdownMenu.menu,
            createNoteFile("Notes/Source.md"),
        );
        harness.actions.handleFileMenu(
            pngMenu.menu,
            createFile("Attachments/Image.png", "png"),
        );
        harness.actions.handleFileMenu(pngMenu.menu, createFolder("Notes"));
        harness.actions.handleFileMenu(folderMenu.menu, createFolder("Notes"));

        expect(markdownMenu.builders).toHaveLength(1);
        const item = {} as MenuItemLike;
        const setTitle = jest.fn<(_: string) => unknown>(() => item);
        const setIcon = jest.fn<(_: string) => unknown>(() => item);
        Object.assign(item, {
            setTitle,
            setIcon,
            onClick: jest.fn(() => item),
        });
        markdownMenu.builders[0]!(item);
        expect(setTitle).toHaveBeenCalledWith("Share as card");
        expect(setIcon).toHaveBeenCalledWith("image");
        expect(pngMenu.menu.addItem as jest.Mock).not.toHaveBeenCalled();
        expect(folderMenu.menu.addItem as jest.Mock).not.toHaveBeenCalled();
        expect(harness.createModal).not.toHaveBeenCalled();
    });

    it("uses a non-empty selection from the matching file view without reading Vault state", () => {
        const harness = createHarness();
        const { menu, builders } = createMenu();
        const file = createNoteFile("Notes/Selected.md");
        const rawSelection = "  selected **draft**  ";
        const editor = createEditor(rawSelection, "saved body");
        const view = createMarkdownView(editor, file);

        harness.actions.handleFileMenu(menu, file, createWorkspaceLeaf(view));
        const click = clickMenuItem(builders[0]!);
        click();

        expect(harness.getFileMenuTitle).toHaveBeenCalledTimes(1);
        expect(harness.openedData).toEqual([{
            content: rawSelection,
            source: "selection",
            resourceContext: { basePath: "Notes/Selected.md" },
        }]);
        expect(harness.readFile).not.toHaveBeenCalled();
    });

    it("shares the matching view's unsaved full-note editor value", async () => {
        const harness = createHarness();
        const { menu, builders } = createMenu();
        const file = createNoteFile("Notes/Today.md");
        const editor = createEditor("", "---\ntags: [private]\n---\nunsaved body\n");
        const view = createMarkdownView(editor, file);

        harness.actions.handleFileMenu(menu, file, createWorkspaceLeaf(view));
        clickMenuItem(builders[0]!)();
        await Promise.resolve();

        expect(harness.openedData).toEqual([{
            content: "unsaved body\n",
            source: "note",
            sourceLabel: "Today",
            resourceContext: { basePath: "Notes/Today.md" },
        }]);
        expect(harness.readFile).not.toHaveBeenCalled();
    });

    it("reads the menu file when no matching editor is available", async () => {
        const harness = createHarness();
        harness.readFile.mockResolvedValue("# Menu file\n");
        const target = createNoteFile("Notes/Target.md");
        const activeFile = createNoteFile("Notes/Active.md");
        const activeView = createMarkdownView(
            createEditor("active selection", "active note"),
            activeFile,
        );
        const { menu, builders } = createMenu();

        harness.actions.handleFileMenu(menu, target, createWorkspaceLeaf(activeView));
        clickMenuItem(builders[0]!)();
        await Promise.resolve();

        expect(harness.readFile).toHaveBeenCalledWith(target);
        expect(harness.openedData).toEqual([{
            content: "# Menu file\n",
            source: "note",
            sourceLabel: "Target",
            resourceContext: { basePath: "Notes/Target.md" },
        }]);
    });

    it("reads the menu file without a leaf and reports an empty note without opening a modal", async () => {
        const harness = createHarness();
        harness.readFile.mockResolvedValue("  \n\t");
        const file = createNoteFile("Notes/Empty.md");
        const { menu, builders } = createMenu();

        harness.actions.handleFileMenu(menu, file);
        clickMenuItem(builders[0]!)();
        await Promise.resolve();

        expect(harness.notifyEmpty).toHaveBeenCalledTimes(1);
        expect(harness.createModal).not.toHaveBeenCalled();
    });

    it("reports a failed note read without treating it as an empty success", async () => {
        const harness = createHarness();
        harness.readFile.mockRejectedValue(new Error("disk unavailable"));
        const file = createNoteFile("Notes/Failed.md");
        const { menu, builders } = createMenu();

        harness.actions.handleFileMenu(menu, file);
        clickMenuItem(builders[0]!)();
        await Promise.resolve();

        expect(harness.notifyReadFailed).toHaveBeenCalledTimes(1);
        expect(harness.notifyEmpty).not.toHaveBeenCalled();
        expect(harness.createModal).not.toHaveBeenCalled();
    });

    it("does not open a Modal when closeAll finishes after a deferred note read", async () => {
        const harness = createHarness();
        let resolveRead!: (content: string) => void;
        harness.readFile.mockImplementation(() => new Promise((resolve) => {
            resolveRead = resolve;
        }));
        const file = createNoteFile("Notes/Deferred.md");
        const { menu, builders } = createMenu();

        harness.actions.handleFileMenu(menu, file);
        clickMenuItem(builders[0]!)();
        harness.actions.closeAll();
        resolveRead("# Deferred\n");
        await Promise.resolve();

        expect(harness.closeAllModals).toHaveBeenCalledTimes(1);
        expect(harness.createModal).not.toHaveBeenCalled();
        expect(harness.open).not.toHaveBeenCalled();
    });

    it("delegates repeated close-all cleanup", () => {
        const harness = createHarness();

        harness.actions.closeAll();
        harness.actions.closeAll();

        expect(harness.closeAllModals).toHaveBeenCalledTimes(2);
    });
});

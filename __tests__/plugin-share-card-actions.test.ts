import { describe, expect, it, jest } from "@jest/globals";
import type { Editor, MarkdownFileInfo, Menu } from "obsidian";

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
    const actions = new ShareCardActions({
        createModal,
        closeAllModals,
        getMenuTitle,
        menuIcon: "image",
    });

    return { actions, createModal, openedData, open, closeAllModals, getMenuTitle };
}

function createEditor(selection: string) {
    return {
        getSelection: jest.fn(() => selection),
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

    it("delegates repeated close-all cleanup", () => {
        const harness = createHarness();

        harness.actions.closeAll();
        harness.actions.closeAll();

        expect(harness.closeAllModals).toHaveBeenCalledTimes(2);
    });
});

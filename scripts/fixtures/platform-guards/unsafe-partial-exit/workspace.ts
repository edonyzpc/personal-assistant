import { Platform } from "obsidian";

export function openDesktopWindow(app: any, shouldStop: boolean): void {
    if (!Platform.isDesktop) {
        if (shouldStop) return;
    }
    app.workspace.getLeaf("window");
}

import { Platform } from "obsidian";

export function openDesktopWindow(app: any, featureFlag: boolean): void {
    if (!Platform.isDesktop && featureFlag) return;
    app.workspace.getLeaf("window");
}

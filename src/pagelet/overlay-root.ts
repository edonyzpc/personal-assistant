/* Copyright 2023 edonyzpc */

/**
 * Pagelet -- shared overlay mount root.
 *
 * Pagelet surfaces (Bubble, Panel, Tab) are progressive-disclosure
 * layers within the workspace (D037), not chrome-level overlays. They
 * MUST mount under Obsidian's workspace container rather than directly
 * on the global body element, so they never cover the OS title bar / window
 * drag region (`-webkit-app-region: drag`) provided by Electron.
 *
 * Mounting on the global body element previously caused the Obsidian window to
 * become un-draggable after the plugin loaded, because full-viewport
 * fixed overlays intercepted the title bar's drag hit-test even while
 * visually hidden.
 *
 * The fallback chain is intentional: workspace.containerEl is the
 * canonical target on real Obsidian; `.app-container` covers the
 * Obsidian shell when workspace isn't ready yet; the global body element is
 * only a last resort for unit-test environments.
 */

import type { App } from "obsidian";

import { getPlatformDocument } from "../platform-dom";

export function getPageletOverlayRoot(app: App): HTMLElement {
    const workspaceContainer = (app.workspace as
        { containerEl?: HTMLElement }).containerEl;
    if (workspaceContainer instanceof HTMLElement) {
        return workspaceContainer;
    }

    const doc = getPlatformDocument();
    const appContainer = doc.querySelector(".app-container");
    if (appContainer instanceof HTMLElement) {
        return appContainer;
    }

    return doc.body;
}

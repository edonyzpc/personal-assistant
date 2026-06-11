/* Copyright 2023 edonyzpc */

/**
 * Pagelet v2 -- shared overlay mount root.
 *
 * Pagelet v2 surfaces (Bubble, Panel, Tab) are progressive-disclosure
 * layers within the workspace (D037), not chrome-level overlays. They
 * MUST mount under Obsidian's workspace container rather than directly
 * on `document.body`, so they never cover the OS title bar / window
 * drag region (`-webkit-app-region: drag`) provided by Electron.
 *
 * Mounting on `document.body` previously caused the Obsidian window to
 * become un-draggable after the plugin loaded, because full-viewport
 * fixed overlays (e.g. TabView with `inset: 0`) intercepted the title
 * bar's drag hit-test even while visually hidden.
 *
 * The fallback chain is intentional: workspace.containerEl is the
 * canonical target on real Obsidian; `.app-container` covers the
 * Obsidian shell when workspace isn't ready yet; `document.body` is
 * only a last resort for unit-test environments.
 */

import type { App } from "obsidian";

export function getPageletOverlayRoot(app: App): HTMLElement {
    const workspaceContainer = (app.workspace as
        { containerEl?: HTMLElement }).containerEl;
    if (workspaceContainer instanceof HTMLElement) {
        return workspaceContainer;
    }

    const appContainer = document.querySelector(".app-container");
    if (appContainer instanceof HTMLElement) {
        return appContainer;
    }

    return document.body;
}

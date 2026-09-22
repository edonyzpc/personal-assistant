import { type App, Notice, TFile } from "obsidian";

import { validateTargetConfinementSync } from "../ai-services/write-action-framework/target-confinement";
import { getPluginUiLanguage, pluginT } from "../locales/plugin";

/** Update the explicitly configured index without turning a saved note into a failed capture. */
export async function linkRecordToIndex(
    app: App,
    recordPath: string,
    configuredPath: string | undefined,
    log: (message: string, ...args: unknown[]) => void,
): Promise<void> {
    if (!configuredPath?.trim()) return;
    try {
        const path = configuredPath.trim().replace(/\.md$/i, "") + ".md";
        const validation = validateTargetConfinementSync(path, {
            allowedRoots: [path],
            allowedExtensions: [".md"],
            maxPathLength: 400,
        });
        if (!validation.ok) throw new Error(`Record index is not allowed: ${validation.reason}`);
        if (validation.normalizedPath === recordPath) throw new Error("Record cannot index itself");
        const index = app.vault.getAbstractFileByPath(validation.normalizedPath);
        if (!(index instanceof TFile)) throw new Error("Record index note does not exist");
        const title = recordPath.split("/").pop()?.replace(/\.md$/i, "");
        const link = `- [[${title}]]`;
        // Vault.process makes concurrent captures' check-and-append atomic.
        await app.vault.process(index, (content) => content.includes(link)
            ? content
            : `${content}${content.endsWith("\n") || !content ? "" : "\n"}${link}\n`);
    } catch (error) {
        log("Record saved, but index update failed", error);
        new Notice(pluginT("plugin.record.notice.indexFailed", getPluginUiLanguage()));
    }
}

import { type App, normalizePath } from "obsidian";

import { RECORD_PREVIEW_TYPE } from "../preview";

export interface RecordActionDependencies {
    app: App;
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
}

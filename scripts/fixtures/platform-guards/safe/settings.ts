import { Platform } from "obsidian";

class SettingsTab {
    private app: any;
    private plugin: any;

    private openApiTokenSecretEditor(): void {
        const existing = this.plugin.getConfiguredAPITokenSecret() ?? "";
        void existing;
    }

    private openDesktopWindow(): void {
        if (!Platform.isDesktop) return;
        this.app.workspace.getLeaf("window");
    }

    private openDesktopAfterExhaustiveMobileExit(returnNormally: boolean): void {
        if (!Platform.isDesktop) {
            if (returnNormally) return;
            else throw new Error("mobile-only stop");
        }
        this.app.workspace.getLeaf("window");
    }

    private openDesktopAfterDisjunctiveExit(shouldStop: boolean): void {
        if (!Platform.isDesktop || shouldStop) return;
        this.app.workspace.getLeaf("window");
    }
}

import type { Command, View, WorkspaceLeaf } from "obsidian";

export interface ObsidianViewRegistrationTarget {
    registerView(viewType: string, factory: (leaf: WorkspaceLeaf) => View): void;
}

export interface ObsidianCommandRegistrationTarget {
    addCommand(command: Command): void;
}

export interface ObsidianViewRegistration {
    viewType: string;
    createView: (leaf: WorkspaceLeaf) => View;
}

export function registerObsidianViews(
    target: ObsidianViewRegistrationTarget,
    registrations: readonly ObsidianViewRegistration[],
): void {
    for (const registration of registrations) {
        target.registerView(registration.viewType, registration.createView);
    }
}

export function registerObsidianCommands(
    target: ObsidianCommandRegistrationTarget,
    commands: readonly Command[],
): void {
    for (const command of commands) {
        target.addCommand(command);
    }
}

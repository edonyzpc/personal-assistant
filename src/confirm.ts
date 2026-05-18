import { App, Modal, Setting } from "obsidian";

export interface ConfirmUserActionOptions {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
}

export function confirmUserAction(app: App, options: ConfirmUserActionOptions): Promise<boolean> {
    if (typeof Modal !== "function") {
        return Promise.resolve(false);
    }
    return new Promise((resolve) => {
        class ConfirmUserActionModal extends Modal {
            private settled = false;

            constructor(
                app: App,
                private readonly modalOptions: ConfirmUserActionOptions,
                private readonly resolveDecision: (confirmed: boolean) => void,
            ) {
                super(app);
            }

            onOpen(): void {
                this.contentEl.empty();
                this.contentEl.createEl("h2", { text: this.modalOptions.title });
                this.contentEl.createEl("p", { text: this.modalOptions.message });
                new Setting(this.contentEl)
                    .addButton((button) => {
                        button
                            .setButtonText(this.modalOptions.cancelText ?? "Cancel")
                            .onClick(() => this.resolve(false));
                    })
                    .addButton((button) => {
                        button
                            .setCta()
                            .setButtonText(this.modalOptions.confirmText ?? "Confirm")
                            .onClick(() => this.resolve(true));
                    });
            }

            onClose(): void {
                this.contentEl.empty();
                if (!this.settled) {
                    this.resolveDecision(false);
                }
            }

            private resolve(confirmed: boolean): void {
                this.settled = true;
                this.resolveDecision(confirmed);
                this.close();
            }
        }

        new ConfirmUserActionModal(app, options, resolve).open();
    });
}

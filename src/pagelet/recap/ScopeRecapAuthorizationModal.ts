/* Copyright 2023 edonyzpc */

import { Modal, type App } from "obsidian";

import { pageletT, type PageletLocale } from "../../locales/pagelet";

export type ScopeRecapAuthorizationChoice = "run" | "adjust" | "cancel";

export interface ScopeRecapAuthorizationSummary {
    scopeLabel: string;
    includedSourceCount: number;
    skippedSourceCount: number;
    provider: string;
    model: string;
    endpoint: string;
    hourlyCap: number;
    dailyCap: number;
}

/**
 * @deprecated SG-06: Modal authorization removed in B-118. Settings default ON
 * with non-blocking first-use notification. This function is retained for
 * backward compatibility but should not be called from new code.
 *
 * Original: First-run disclosure for provider-backed Scope Recap preparation.
 * Closing the modal is treated as Adjust/later: it never grants consent and
 * it does not turn a non-choice into a durable opt-out.
 */
export function requestScopeRecapAuthorization(
    app: App,
    summary: ScopeRecapAuthorizationSummary,
    locale: PageletLocale,
): Promise<ScopeRecapAuthorizationChoice> {
    return new Promise((resolve) => {
        let settled = false;
        const settle = (choice: ScopeRecapAuthorizationChoice, modal: Modal): void => {
            if (settled) return;
            settled = true;
            resolve(choice);
            modal.close();
        };

        const modal = new class extends Modal {
            onOpen(): void {
                this.contentEl.empty();
                this.contentEl.addClass("pa-pagelet-recap-authorization");
                this.contentEl.createEl("h2", {
                    text: pageletT("pagelet.recap.authorization.title", locale),
                });
                this.contentEl.createEl("p", {
                    text: pageletT("pagelet.recap.authorization.intro", locale),
                });

                const facts = this.contentEl.createEl("ul");
                facts.createEl("li", {
                    text: pageletT("pagelet.recap.authorization.scope", locale, {
                        scope: summary.scopeLabel,
                        included: summary.includedSourceCount,
                        skipped: summary.skippedSourceCount,
                    }),
                });
                facts.createEl("li", {
                    text: pageletT("pagelet.recap.authorization.provider", locale, {
                        provider: summary.provider,
                        model: summary.model,
                        endpoint: summary.endpoint,
                    }),
                });
                facts.createEl("li", {
                    text: pageletT("pagelet.recap.authorization.cost", locale, {
                        hourly: summary.hourlyCap,
                        daily: summary.dailyCap,
                    }),
                });
                this.contentEl.createEl("p", {
                    text: pageletT("pagelet.recap.authorization.safety", locale),
                });

                const actions = this.contentEl.createDiv({ cls: "modal-button-container" });
                const run = actions.createEl("button", {
                    text: pageletT("pagelet.recap.authorization.run", locale),
                    cls: "mod-cta",
                    attr: { type: "button" },
                });
                run.addEventListener("click", () => settle("run", this));

                const adjust = actions.createEl("button", {
                    text: pageletT("pagelet.recap.authorization.adjust", locale),
                    attr: { type: "button" },
                });
                adjust.addEventListener("click", () => settle("adjust", this));

                const cancel = actions.createEl("button", {
                    text: pageletT("pagelet.recap.authorization.cancel", locale),
                    attr: { type: "button" },
                });
                cancel.addEventListener("click", () => settle("cancel", this));
            }

            onClose(): void {
                this.contentEl.empty();
                if (!settled) {
                    settled = true;
                    resolve("adjust");
                }
            }
        }(app);

        modal.open();
    });
}

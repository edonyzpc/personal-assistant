/* Copyright 2023 edonyzpc */

import { Modal, type App } from "obsidian";

import { pageletT, type PageletLocale } from "../locales/pagelet";

export type PageletReviewHighRiskChoice = "run" | "adjust" | "cancel" | "closed";

export interface PageletReviewHighRiskSummary {
    scopeLabel: string;
    includedSourceCount: number;
    skippedSourceCount: number;
    provider: string;
    model: string;
    endpoint: string;
    hourlyCap: number;
    dailyCap: number;
}

/** Per-run disclosure for a foreground Review that will send multiple notes. */
export function requestPageletReviewHighRiskDecision(
    app: App,
    summary: PageletReviewHighRiskSummary,
    locale: PageletLocale,
    signal?: AbortSignal,
): Promise<PageletReviewHighRiskChoice> {
    return new Promise((resolve) => {
        let settled = false;
        const modal: Modal = new class extends Modal {
            onOpen(): void {
                this.contentEl.empty();
                this.contentEl.addClass("pa-pagelet-review-high-risk");
                this.contentEl.createEl("h2", {
                    text: pageletT("pagelet.review.highRisk.title", locale),
                });
                this.contentEl.createEl("p", {
                    text: pageletT("pagelet.review.highRisk.intro", locale),
                });

                const facts = this.contentEl.createEl("ul");
                facts.createEl("li", {
                    text: pageletT("pagelet.review.highRisk.scope", locale, {
                        scope: summary.scopeLabel,
                        included: summary.includedSourceCount,
                        skipped: summary.skippedSourceCount,
                    }),
                });
                facts.createEl("li", {
                    text: pageletT("pagelet.review.highRisk.provider", locale, {
                        provider: summary.provider,
                        model: summary.model,
                        endpoint: summary.endpoint,
                    }),
                });
                facts.createEl("li", {
                    text: pageletT("pagelet.review.highRisk.cost", locale, {
                        hourly: summary.hourlyCap,
                        daily: summary.dailyCap,
                    }),
                });
                this.contentEl.createEl("p", {
                    text: pageletT("pagelet.review.highRisk.safety", locale),
                });
                this.contentEl.createEl("p", {
                    text: pageletT("pagelet.review.highRisk.optOut", locale),
                });

                const actions = this.contentEl.createDiv({ cls: "modal-button-container" });
                const run = actions.createEl("button", {
                    text: pageletT("pagelet.review.highRisk.run", locale),
                    cls: "mod-cta",
                    attr: { type: "button" },
                });
                run.addEventListener("click", () => settle("run", this));

                const adjust = actions.createEl("button", {
                    text: pageletT("pagelet.review.highRisk.adjust", locale),
                    attr: { type: "button" },
                });
                adjust.addEventListener("click", () => settle("adjust", this));

                const cancel = actions.createEl("button", {
                    text: pageletT("pagelet.review.highRisk.cancel", locale),
                    attr: { type: "button" },
                });
                cancel.addEventListener("click", () => settle("cancel", this));
            }

            onClose(): void {
                this.contentEl.empty();
                signal?.removeEventListener("abort", onAbort);
                if (settled) return;
                settled = true;
                resolve("closed");
            }
        }(app);
        const onAbort = (): void => settle("closed", modal);
        const settle = (choice: PageletReviewHighRiskChoice, modal: Modal): void => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener("abort", onAbort);
            resolve(choice);
            modal.close();
        };

        if (signal?.aborted) {
            settled = true;
            resolve("closed");
            return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
        modal.open();
    });
}

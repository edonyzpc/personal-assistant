/* Copyright 2023 edonyzpc */

/**
 * Pagelet -- ResearchManager.
 *
 * Manages "Research this finding" requests by building a research prompt
 * and routing it to the existing Chat (LLM) view. This mirrors the structured
 * review prompt pattern but is adapted for the Panel finding model.
 *
 * The research flow:
 *  1. Build a research prompt from the finding text and optional context.
 *  2. Locate the Chat view leaf (`pa-llm-view`).
 *  3. Populate the Chat composer with the prompt.
 *  4. Notify via callbacks on success or failure.
 *
 * The manager does NOT call WebSearch directly -- it prepares a prompt
 * that instructs the Chat model to use web search if available. This
 * keeps the write boundary clean (D025/D030) and respects the product
 * design rule: "WebSearch off until clicked."
 *
 * Design references:
 *  - `src/pagelet/orchestrator.ts` -- research prompt pattern
 *  - `src/locales/pagelet/{en,zh}.json` -- `pagelet.research.prompt.*`
 *  - `docs/pagelet-product-design.md` -- Privacy and Trust, WebSearch
 */

import { Notice } from "obsidian";
import type { App } from "obsidian";

import { getPageletUiLanguage, pageletT } from "../../locales/pagelet";
import type { ResearchCallbacks, ResearchRequest } from "./types";

/** The Obsidian view type registered by PA's Chat view. */
const CHAT_VIEW_TYPE = "pa-llm-view";

export class ResearchManager {
    constructor(
        private readonly app: App,
        private readonly callbacks: ResearchCallbacks,
    ) {}

    private t(key: string, params?: Readonly<Record<string, string | number>>): string {
        return pageletT(key, getPageletUiLanguage(), params);
    }

    // ======================================================================
    // Public API
    // ======================================================================

    /**
     * Research a finding by preparing a research prompt and routing it
     * to the Chat view.
     *
     * If no Chat view leaf is found, a Notice guides the user to open one.
     * This method never throws -- errors are routed to the callback.
     */
    async research(request: ResearchRequest): Promise<void> {
        new Notice(this.t("pagelet.research.status.researching"), 3000);

        const prompt = this.buildResearchPrompt(request);

        try {
            const chatLeaf = this.findChatLeaf();
            if (chatLeaf) {
                const populated = this.populateChatWithPrompt(chatLeaf, prompt);
                if (populated) {
                    new Notice(this.t("pagelet.panel.status.researchReady"), 4000);
                } else {
                    new Notice(this.t("pagelet.panel.status.researchBlocked"), 4000);
                }

                // Report success -- the actual research happens when the
                // user submits the prompt in Chat (possibly with WebSearch).
                this.callbacks.onResearchComplete({
                    query: prompt,
                    findings: [],
                    timestamp: Date.now(),
                });
            } else {
                new Notice(this.t("pagelet.research.status.openChat"), 4000);
            }
        } catch (error) {
            this.callbacks.onResearchError(
                error instanceof Error ? error : new Error(String(error)),
            );
        }
    }

    // ======================================================================
    // Prompt builder
    // ======================================================================

    /**
     * Build a research prompt following the structured review pattern from
     * `pagelet.research.prompt.*` locale keys.
     *
     * The prompt instructs the Chat model to:
     *  - Use web search if available before answering
     *  - Research the finding without modifying notes
     *  - Return concise external evidence and useful links
     */
    buildResearchPrompt(request: ResearchRequest): string {
        const lines = [
            this.t("pagelet.research.prompt.search"),
            "",
            this.t("pagelet.research.prompt.task"),
            "",
            `${this.t("pagelet.research.prompt.finding")}: ${sanitizePromptText(request.findingText)}`,
        ];

        if (request.sourceTitle) {
            lines.push(`${this.t("pagelet.research.prompt.source")}: ${sanitizePromptText(request.sourceTitle)}`);
        }
        if (request.sourceFile) {
            lines.push(`${this.t("pagelet.research.prompt.file")}: ${request.sourceFile}`);
        }

        lines.push(
            "",
            this.t("pagelet.research.prompt.output"),
        );

        return lines.join("\n");
    }

    // ======================================================================
    // Chat view integration
    // ======================================================================

    /**
     * Find an existing Chat view leaf. Returns `null` if none is open.
     * Uses the same chat view lookup pattern as the review orchestrator.
     */
    private findChatLeaf(): ReturnType<App["workspace"]["getLeavesOfType"]>[number] | null {
        const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
        return leaves.length > 0 ? leaves[0] : null;
    }

    /**
     * Attempt to populate the Chat composer with the research prompt.
     *
     * Returns `true` if the prompt was set, `false` if the composer
     * already had text (mirrors `chatView.prefillComposer` semantics).
     */
    private populateChatWithPrompt(
        leaf: ReturnType<App["workspace"]["getLeavesOfType"]>[number],
        prompt: string,
    ): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Chat view API is untyped
        const view = leaf.view as any;
        if (!view) return false;

        // Chat views may expose
        // `setInputText`. Try both, preferring `prefillComposer`.
        if (typeof view?.prefillComposer === "function") {
            return view.prefillComposer(prompt) as boolean;
        }
        if (typeof view?.setInputText === "function") {
            view.setInputText(prompt);
            return true;
        }

        return false;
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize text for inclusion in a prompt -- collapse newlines and
 * truncate to a reasonable length. Mirrors the structured review sanitize pattern.
 */
function sanitizePromptText(text: string, maxLength = 500): string {
    return text.replace(/[\n\r]+/g, " ").slice(0, maxLength);
}

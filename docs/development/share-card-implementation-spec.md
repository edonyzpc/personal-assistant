# PA Share Card Implementation Spec

## Overview

Implement a feature that converts PA AI-generated content (Chat replies, Pagelet insights, editor selections) into beautifully designed card images for social media sharing. The cards serve dual purpose: user convenience + organic PA plugin promotion.

**This is NOT a generic note screenshot tool** (obsidian-export-image already does that). This is specifically for PA's AI output, with branded visual identity.

---

## Technology Stack

- **DOM-to-image library**: `@zumer/snapdom` (npm: `@zumer/snapdom`)
  - Zero dependencies, ~15KB
  - SVG foreignObject approach — browser engine renders DOM into SVG, then rasterizes
  - Preserves all computed CSS (gradients, border-radius, pseudo-elements)
  - API: `snapdom.toCanvas(element, { scale })`, `snapdom.toPng(element)`, `snapdom.toBlob(element)`
- **Card rendering**: Imperative DOM (Obsidian's `createEl`/`createDiv` APIs) inside a `Modal` subclass
- **Card styling**: CSS classes in `src/custom.pcss`, using Tailwind prefix `pa-`
- **Content rendering**: Obsidian's `MarkdownRenderer.render()` for markdown-to-HTML

---

## File Structure

### New Files (4)

```
src/share-card/share-card-types.ts
src/share-card/share-card-capture.ts
src/share-card/share-card-paginator.ts
src/share-card/share-card-modal.ts
```

### Modified Files (7)

```
package.json
src/plugin.ts
src/chat/chat-view.ts
src/chat/types.ts
src/pagelet/panel/PanelView.ts
src/pagelet/panel/types.ts
src/custom.pcss
src/locales/plugin/en.json
src/locales/plugin/zh.json
```

---

## Step-by-Step Implementation

### Step 1: Install Dependency

```bash
npm install @zumer/snapdom
```

This adds it to `dependencies` in `package.json` (NOT devDependencies — it ships in the runtime bundle).

The library is browser-only, zero Node.js builtins, compatible with the existing esbuild config (`platform: "browser"`, `format: "cjs"`, `bundle: true`).

---

### Step 2: `src/share-card/share-card-types.ts`

```typescript
import type { App } from "obsidian";

/** Data passed to the ShareCardModal from any entry point */
export interface ShareCardData {
    /** Markdown content to render in the card */
    content: string;
    /** Which PA feature produced this content */
    source: "chat" | "pagelet" | "selection";
    /** Optional human-readable source label (e.g., "PA Chat", note filename) */
    sourceLabel?: string;
}

/** A single page of content after pagination */
export interface CardPage {
    /** 0-based page index */
    pageIndex: number;
    /** Total number of pages */
    totalPages: number;
    /** Markdown content for this page */
    content: string;
}

/** Card dimensions (in CSS pixels, before scale) */
export const CARD_WIDTH = 540;
export const CARD_HEIGHT = 720;
/** Output scale factor — 2x produces 1080×1440 retina output */
export const CARD_SCALE = 2;
/** Output dimensions */
export const CARD_OUTPUT_WIDTH = CARD_WIDTH * CARD_SCALE;   // 1080
export const CARD_OUTPUT_HEIGHT = CARD_HEIGHT * CARD_SCALE;  // 1440

/** Vertical space available for content (px) within one card page */
// Total 720 - top padding 40 - bottom padding 20 - brand bar 50 - content top margin 10 = 600
// First page also has optional source label (~24px) so usable ≈ 576
export const CONTENT_AREA_HEIGHT_FIRST_PAGE = 576;
export const CONTENT_AREA_HEIGHT_SUBSEQUENT = 600;

/** Estimated line height for content (px) */
export const ESTIMATED_LINE_HEIGHT = 22;

/** Max lines per page */
export const MAX_LINES_FIRST_PAGE = Math.floor(CONTENT_AREA_HEIGHT_FIRST_PAGE / ESTIMATED_LINE_HEIGHT); // ~26
export const MAX_LINES_SUBSEQUENT = Math.floor(CONTENT_AREA_HEIGHT_SUBSEQUENT / ESTIMATED_LINE_HEIGHT); // ~27
```

---

### Step 3: `src/share-card/share-card-capture.ts`

```typescript
import type { App } from "obsidian";
import { Notice, normalizePath } from "obsidian";
import { snapdom } from "@zumer/snapdom";
import { CARD_SCALE } from "./share-card-types";
import { getPluginUiLanguage, pluginT } from "../locales/plugin";

function t(key: string, params?: Record<string, string | number>): string {
    return pluginT(key, getPluginUiLanguage(), params);
}

/**
 * Capture a card DOM element to a PNG Blob.
 */
export async function captureCardToBlob(
    element: HTMLElement,
    scale: number = CARD_SCALE,
): Promise<Blob> {
    const result = await snapdom(element, { scale });
    const blob = await result.toBlob({ type: "image/png" });
    if (!blob) throw new Error("snapdom toBlob returned null");
    return blob;
}

/**
 * Capture a card and copy to clipboard.
 * Returns true on success, false if clipboard API is unavailable.
 */
export async function captureCardToClipboard(
    element: HTMLElement,
    scale: number = CARD_SCALE,
): Promise<boolean> {
    const blob = await captureCardToBlob(element, scale);

    // Check clipboard write availability (may not exist on mobile)
    if (!navigator.clipboard?.write) {
        return false;
    }

    try {
        await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob }),
        ]);
        new Notice(t("plugin.shareCard.copySuccess"));
        return true;
    } catch {
        return false;
    }
}

/**
 * Capture multiple card pages and save them to the vault.
 * Returns the array of created file paths.
 *
 * For a single page: saves as `{baseName}.png`
 * For multiple pages: saves as `{baseName}-1.png`, `{baseName}-2.png`, ...
 */
export async function captureCardsToVault(
    app: App,
    elements: HTMLElement[],
    baseName: string,
    folderPath: string = "PA-Cards",
    scale: number = CARD_SCALE,
): Promise<string[]> {
    const normalizedFolder = normalizePath(folderPath);

    // Ensure folder exists
    if (!app.vault.getAbstractFileByPath(normalizedFolder)) {
        await app.vault.createFolder(normalizedFolder);
    }

    const paths: string[] = [];

    for (let i = 0; i < elements.length; i++) {
        const blob = await captureCardToBlob(elements[i], scale);
        const buffer = await blob.arrayBuffer();

        const suffix = elements.length === 1 ? "" : `-${i + 1}`;
        const fileName = `${baseName}${suffix}.png`;
        const savePath = normalizePath(`${normalizedFolder}/${fileName}`);

        await app.vault.createBinary(savePath, buffer);
        paths.push(savePath);
    }

    new Notice(t("plugin.shareCard.saveSuccess", { count: paths.length, path: normalizedFolder }));
    return paths;
}
```

---

### Step 4: `src/share-card/share-card-paginator.ts`

```typescript
import {
    type CardPage,
    MAX_LINES_FIRST_PAGE,
    MAX_LINES_SUBSEQUENT,
} from "./share-card-types";

/**
 * Split markdown content into pages that fit within a card.
 *
 * Strategy:
 * 1. Split content into paragraphs (by double newline)
 * 2. Estimate line count per paragraph (by line breaks + wrapping estimate)
 * 3. Accumulate paragraphs until page limit is reached
 * 4. Split at paragraph boundaries; if a single paragraph exceeds a page,
 *    split at sentence boundaries or hard-cut at line limit
 */
export function paginateContent(markdown: string): CardPage[] {
    const trimmed = markdown.trim();
    if (!trimmed) {
        return [{ pageIndex: 0, totalPages: 1, content: "" }];
    }

    // Strip frontmatter if present
    const content = stripFrontmatter(trimmed);

    const paragraphs = content.split(/\n{2,}/);
    const pages: string[][] = [];
    let currentPage: string[] = [];
    let currentLineCount = 0;
    let isFirstPage = true;

    const maxLines = () => isFirstPage ? MAX_LINES_FIRST_PAGE : MAX_LINES_SUBSEQUENT;

    for (const para of paragraphs) {
        const paraLines = estimateLineCount(para);

        if (currentLineCount + paraLines <= maxLines()) {
            // Fits in current page
            currentPage.push(para);
            currentLineCount += paraLines;
        } else if (currentPage.length === 0) {
            // Single paragraph exceeds page — split it
            const splitParas = splitLongParagraph(para, maxLines());
            for (const chunk of splitParas) {
                pages.push([chunk]);
                isFirstPage = false;
            }
            continue;
        } else {
            // Start a new page
            pages.push(currentPage);
            isFirstPage = false;
            currentPage = [para];
            currentLineCount = paraLines;
        }
    }

    if (currentPage.length > 0) {
        pages.push(currentPage);
    }

    const totalPages = pages.length;
    return pages.map((pageParas, index) => ({
        pageIndex: index,
        totalPages,
        content: pageParas.join("\n\n"),
    }));
}

/** Estimate line count for a paragraph (based on newlines + rough char wrapping) */
function estimateLineCount(text: string): number {
    const lines = text.split("\n");
    let count = 0;
    for (const line of lines) {
        // Approximate: ~40 chars per line at 14px in a 460px content area
        count += Math.max(1, Math.ceil(line.length / 40));
    }
    return count;
}

/** Split a long paragraph into chunks that fit within maxLines */
function splitLongParagraph(text: string, maxLines: number): string[] {
    const lines = text.split("\n");
    const chunks: string[] = [];
    let currentChunk: string[] = [];
    let currentCount = 0;

    for (const line of lines) {
        const lineCount = Math.max(1, Math.ceil(line.length / 40));
        if (currentCount + lineCount > maxLines && currentChunk.length > 0) {
            chunks.push(currentChunk.join("\n"));
            currentChunk = [];
            currentCount = 0;
        }
        currentChunk.push(line);
        currentCount += lineCount;
    }

    if (currentChunk.length > 0) {
        chunks.push(currentChunk.join("\n"));
    }

    return chunks;
}

/** Remove YAML frontmatter from markdown content */
function stripFrontmatter(content: string): string {
    if (!content.startsWith("---")) return content;
    const endIndex = content.indexOf("\n---", 3);
    if (endIndex === -1) return content;
    return content.slice(endIndex + 4).trim();
}
```

---

### Step 5: `src/share-card/share-card-modal.ts`

```typescript
import { Component, MarkdownRenderer, Modal, Notice, Platform, Setting, type App } from "obsidian";
import { getPluginUiLanguage, pluginT } from "../locales/plugin";
import { type CardPage, type ShareCardData, CARD_WIDTH, CARD_HEIGHT } from "./share-card-types";
import { paginateContent } from "./share-card-paginator";
import { captureCardToClipboard, captureCardsToVault } from "./share-card-capture";

function t(key: string, params?: Record<string, string | number>): string {
    return pluginT(key, getPluginUiLanguage(), params);
}

export class ShareCardModal extends Modal {
    private pages: CardPage[] = [];
    private currentPageIndex = 0;
    private cardContainer: HTMLElement | null = null;
    private renderHost = new Component();
    private navEl: HTMLElement | null = null;
    private settled = false;

    constructor(
        app: App,
        private readonly data: ShareCardData,
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        // Shell styling
        (this as unknown as { modalEl?: HTMLElement }).modalEl?.classList.add(
            "pa-share-card-modal-shell",
        );
        contentEl.classList.add("pa-share-card-modal");

        // Title
        contentEl.createEl("h2", { text: t("plugin.shareCard.title") });

        // Paginate content
        this.pages = paginateContent(this.data.content);

        // Card wrapper (centers the card in the modal)
        const cardWrapper = contentEl.createDiv({ cls: "pa-share-card-wrapper" });

        // Card container — this is the element that gets captured
        this.cardContainer = cardWrapper.createDiv({
            cls: `pa-share-card ${this.getThemeClass()}`,
        });
        this.cardContainer.style.width = `${CARD_WIDTH}px`;
        this.cardContainer.style.height = `${CARD_HEIGHT}px`;

        // Render first page
        this.renderHost.load();
        void this.renderCurrentPage();

        // Navigation (only shown for multi-page)
        if (this.pages.length > 1) {
            this.navEl = contentEl.createDiv({ cls: "pa-share-card-nav" });
            this.renderNav();
        }

        // Action buttons
        const actionsEl = contentEl.createDiv({ cls: "pa-share-card-actions" });
        new Setting(actionsEl)
            .addButton((btn) => {
                btn.setButtonText(t("plugin.shareCard.exportCopy"))
                    .setCta()
                    .onClick(() => void this.handleCopy());
            })
            .addButton((btn) => {
                btn.setButtonText(
                    this.pages.length > 1
                        ? t("plugin.shareCard.exportSaveAll")
                        : t("plugin.shareCard.exportSave"),
                ).onClick(() => void this.handleSave());
            });
    }

    onClose(): void {
        this.contentEl.empty();
        this.renderHost.unload();
        this.cardContainer = null;
        this.navEl = null;
    }

    // ─── Rendering ─────────────────────────────────────────────────────────────

    private async renderCurrentPage(): Promise<void> {
        const container = this.cardContainer;
        if (!container) return;

        // Clear previous content (keep container structure)
        container.empty();

        const page = this.pages[this.currentPageIndex];

        // Background layer (CSS handles the actual visual via class)
        container.createDiv({ cls: "pa-share-card__bg" });

        // Content area
        const contentArea = container.createDiv({ cls: "pa-share-card__content" });

        // Source label (first page only)
        if (page.pageIndex === 0 && this.data.sourceLabel) {
            contentArea.createDiv({
                cls: "pa-share-card__source",
                text: this.data.sourceLabel,
            });
        }

        // Markdown body
        const bodyEl = contentArea.createDiv({ cls: "pa-share-card__body" });
        try {
            await MarkdownRenderer.render(
                this.app,
                page.content,
                bodyEl,
                "",
                this.renderHost,
            );
        } catch {
            // Fallback to plain text
            bodyEl.createEl("pre", { text: page.content, cls: "pa-share-card__body-fallback" });
        }

        // Divider + Brand bar (always present)
        container.createDiv({ cls: "pa-share-card__divider" });
        const brandBar = container.createDiv({ cls: "pa-share-card__brand" });
        brandBar.createSpan({ text: "PA · Personal Assistant", cls: "pa-share-card__brand-text" });

        // Page indicator (multi-page only)
        if (page.totalPages > 1) {
            brandBar.createSpan({
                text: `${page.pageIndex + 1}/${page.totalPages}`,
                cls: "pa-share-card__page-num",
            });
        }
    }

    private renderNav(): void {
        if (!this.navEl) return;
        this.navEl.empty();

        const page = this.pages[this.currentPageIndex];

        const prevBtn = this.navEl.createEl("button", {
            text: "‹",
            cls: "pa-share-card-nav__btn",
        });
        prevBtn.disabled = page.pageIndex === 0;
        prevBtn.onclick = () => this.goToPage(this.currentPageIndex - 1);

        this.navEl.createSpan({
            text: `${page.pageIndex + 1} / ${page.totalPages}`,
            cls: "pa-share-card-nav__label",
        });

        const nextBtn = this.navEl.createEl("button", {
            text: "›",
            cls: "pa-share-card-nav__btn",
        });
        nextBtn.disabled = page.pageIndex === page.totalPages - 1;
        nextBtn.onclick = () => this.goToPage(this.currentPageIndex + 1);
    }

    private goToPage(index: number): void {
        if (index < 0 || index >= this.pages.length) return;
        this.currentPageIndex = index;
        void this.renderCurrentPage();
        this.renderNav();
    }

    // ─── Export ─────────────────────────────────────────────────────────────────

    private async handleCopy(): Promise<void> {
        if (!this.cardContainer) return;
        const success = await captureCardToClipboard(this.cardContainer);
        if (!success) {
            // Fallback: save to vault if clipboard unavailable
            new Notice(t("plugin.shareCard.copyFailed"));
            await this.handleSave();
        }
    }

    private async handleSave(): Promise<void> {
        if (!this.cardContainer) return;

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const baseName = `pa-card-${timestamp}`;

        if (this.pages.length === 1) {
            // Single page — capture current card
            await captureCardsToVault(this.app, [this.cardContainer], baseName);
        } else {
            // Multi-page — render and capture each page sequentially
            const elements: HTMLElement[] = [];
            const originalIndex = this.currentPageIndex;

            for (let i = 0; i < this.pages.length; i++) {
                this.currentPageIndex = i;
                await this.renderCurrentPage();
                // Wait a frame for rendering to settle
                await new Promise((resolve) => requestAnimationFrame(resolve));
                elements.push(this.cardContainer!);
                // For multi-page we need to capture each frame individually
                // since we reuse the same container
            }

            // Actually for multi-page, we need to capture one-by-one
            const paths: string[] = [];
            for (let i = 0; i < this.pages.length; i++) {
                this.currentPageIndex = i;
                await this.renderCurrentPage();
                await new Promise((resolve) => requestAnimationFrame(resolve));
                await captureCardsToVault(this.app, [this.cardContainer!], `${baseName}-${i + 1}`);
            }

            // Restore original page
            this.currentPageIndex = originalIndex;
            await this.renderCurrentPage();
            this.renderNav();
        }
    }

    // ─── Helpers ────────────────────────────────────────────────────────────────

    private getThemeClass(): string {
        const isDark = document.body.classList.contains("theme-dark");
        return isDark ? "pa-share-card--dark" : "pa-share-card--light";
    }
}
```

---

### Step 6: CSS — Append to `src/custom.pcss`

Add the following CSS at the end of `src/custom.pcss`. This is approximately 300 lines.

```css
/* ═══════════════════════════════════════════════════════════════════════════
   Share Card Modal
   ═══════════════════════════════════════════════════════════════════════════ */

.pa-share-card-modal-shell {
    max-width: 620px;
    width: 90vw;
}

.pa-share-card-modal {
    padding: 16px;
}

.pa-share-card-modal h2 {
    margin: 0 0 16px 0;
    font-size: 16px;
    font-weight: 600;
}

/* Card Wrapper — centers the card */
.pa-share-card-wrapper {
    display: flex;
    justify-content: center;
    margin-bottom: 12px;
}

/* ─── Card Container (capture target) ─── */

.pa-share-card {
    position: relative;
    overflow: hidden;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
}

/* ─── Light Mode: 温暖纸感 ─── */

.pa-share-card--light {
    background: linear-gradient(160deg, #faf6f0, #f0ebe3);
}

.pa-share-card--light .pa-share-card__bg {
    position: absolute;
    inset: 0;
    /* Paper noise texture — subtle repeating gradient hack */
    background-image:
        /* Light stripe overlay (window shadow effect) */
        repeating-linear-gradient(
            45deg,
            transparent,
            transparent 18px,
            rgba(255, 248, 235, 0.45) 18px,
            rgba(255, 248, 235, 0.45) 36px
        ),
        /* Subtle noise texture */
        repeating-linear-gradient(
            0deg,
            rgba(139, 115, 85, 0.015) 0px,
            transparent 1px,
            transparent 3px
        ),
        repeating-linear-gradient(
            90deg,
            rgba(139, 115, 85, 0.015) 0px,
            transparent 1px,
            transparent 3px
        );
    pointer-events: none;
    z-index: 0;
}

.pa-share-card--light .pa-share-card__content {
    color: #3d2b1f;
}

.pa-share-card--light .pa-share-card__source {
    color: #8b7355;
}

.pa-share-card--light .pa-share-card__body {
    color: #3d2b1f;
}

.pa-share-card--light .pa-share-card__divider {
    border-top-color: #d4c4b0;
}

.pa-share-card--light .pa-share-card__brand-text {
    color: #8b7355;
}

.pa-share-card--light .pa-share-card__page-num {
    color: #8b7355;
}

/* ─── Dark Mode: 深邃星夜 ─── */

.pa-share-card--dark {
    background: linear-gradient(160deg, #0f0f14, #1a1a24);
}

.pa-share-card--dark .pa-share-card__bg {
    position: absolute;
    inset: 0;
    /* Bokeh light orbs + noise texture */
    background-image:
        radial-gradient(circle at 15% 20%, rgba(255, 255, 255, 0.06) 0%, transparent 50%),
        radial-gradient(circle at 75% 15%, rgba(255, 255, 255, 0.04) 0%, transparent 40%),
        radial-gradient(circle at 85% 65%, rgba(255, 255, 255, 0.07) 0%, transparent 45%),
        radial-gradient(circle at 25% 75%, rgba(255, 255, 255, 0.05) 0%, transparent 50%),
        radial-gradient(circle at 55% 45%, rgba(255, 255, 255, 0.03) 0%, transparent 35%),
        radial-gradient(circle at 40% 90%, rgba(255, 255, 255, 0.06) 0%, transparent 40%),
        radial-gradient(circle at 90% 85%, rgba(255, 255, 255, 0.04) 0%, transparent 30%),
        /* Subtle noise */
        repeating-linear-gradient(
            0deg,
            rgba(255, 255, 255, 0.008) 0px,
            transparent 1px,
            transparent 2px
        );
    pointer-events: none;
    z-index: 0;
}

.pa-share-card--dark .pa-share-card__content {
    color: #e8e4df;
}

.pa-share-card--dark .pa-share-card__source {
    color: #9a9590;
}

.pa-share-card--dark .pa-share-card__body {
    color: #e8e4df;
}

.pa-share-card--dark .pa-share-card__divider {
    border-top-color: rgba(255, 255, 255, 0.08);
}

.pa-share-card--dark .pa-share-card__brand-text {
    color: #7a7570;
}

.pa-share-card--dark .pa-share-card__page-num {
    color: #7a7570;
}

/* ─── Card internal layout ─── */

.pa-share-card__content {
    position: relative;
    z-index: 1;
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 40px 40px 0 40px;
    overflow: hidden;
}

.pa-share-card__source {
    font-size: 12px;
    line-height: 18px;
    margin-bottom: 12px;
    opacity: 0.7;
}

.pa-share-card__body {
    flex: 1;
    overflow: hidden;
    font-size: 14px;
    line-height: 22px;
}

/* Markdown rendered content inside card body */
.pa-share-card__body p {
    margin: 0 0 12px 0;
}

.pa-share-card__body p:last-child {
    margin-bottom: 0;
}

.pa-share-card__body ul,
.pa-share-card__body ol {
    margin: 0 0 12px 0;
    padding-left: 20px;
}

.pa-share-card__body li {
    margin-bottom: 4px;
}

.pa-share-card__body code {
    font-size: 12px;
    padding: 2px 4px;
    border-radius: 3px;
}

.pa-share-card--light .pa-share-card__body code {
    background: rgba(139, 115, 85, 0.08);
}

.pa-share-card--dark .pa-share-card__body code {
    background: rgba(255, 255, 255, 0.08);
}

.pa-share-card__body pre {
    font-size: 12px;
    line-height: 18px;
    padding: 12px;
    border-radius: 6px;
    overflow: hidden;
    margin: 0 0 12px 0;
}

.pa-share-card--light .pa-share-card__body pre {
    background: rgba(139, 115, 85, 0.06);
}

.pa-share-card--dark .pa-share-card__body pre {
    background: rgba(255, 255, 255, 0.05);
}

.pa-share-card__body strong {
    font-weight: 600;
}

.pa-share-card__body-fallback {
    white-space: pre-wrap;
    word-break: break-word;
    font-family: inherit;
}

/* ─── Divider + Brand bar ─── */

.pa-share-card__divider {
    position: relative;
    z-index: 1;
    border-top: 1px solid;
    margin: 0 40px;
}

.pa-share-card__brand {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 40px 16px 40px;
    font-size: 11px;
    line-height: 16px;
}

.pa-share-card__brand-text {
    letter-spacing: 0.5px;
}

.pa-share-card__page-num {
    font-variant-numeric: tabular-nums;
}

/* ─── Navigation (outside capture area) ─── */

.pa-share-card-nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-bottom: 12px;
}

.pa-share-card-nav__btn {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    color: var(--text-normal);
    font-size: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
}

.pa-share-card-nav__btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
}

.pa-share-card-nav__label {
    font-size: 13px;
    color: var(--text-muted);
    min-width: 40px;
    text-align: center;
}

/* ─── Action bar ─── */

.pa-share-card-actions .setting-item {
    border-top: none;
    padding-top: 0;
}

.pa-share-card-actions .setting-item-control {
    justify-content: center;
    gap: 8px;
}
```

---

### Step 7: Entry Point — Chat Message Share Button

#### 7a. Modify `src/chat/types.ts`

Add `shareButton` field to the `RenderedMessage` type:

```typescript
// In the RenderedMessage type (line 22), add after `deleteButton?`:
    shareButton?: HTMLButtonElement;
```

The full type becomes:
```typescript
export type RenderedMessage = {
    messageDiv: HTMLDivElement;
    roleEl: HTMLElement;
    loaderEl?: HTMLElement;
    contentDiv: HTMLElement;
    actionDiv: HTMLDivElement;
    actionMenu: HTMLDivElement;
    actionMenuButton: HTMLButtonElement;
    copyButton?: HTMLButtonElement;
    addMessageButton?: HTMLButtonElement;
    deleteButton?: HTMLButtonElement;
    shareButton?: HTMLButtonElement;      // ← ADD THIS
    renderToken: number;
    copyContent: string;
    renderOwner?: Component;
    sourcePath: string;
    renderedContent?: string;
    renderedContentMode?: 'full' | 'deferred-mermaid';
    memoryMetadata?: ChatTurnMemoryMetadata;
    canonicalTurn?: PaAgentPersistedTurn;
};
```

#### 7b. Modify `src/chat/chat-view.ts`

1. **Add import** at the top of file (near line 28, alongside other local imports):
```typescript
import { ShareCardModal } from '../share-card/share-card-modal';
```

2. **Add share button** inside `ensureCompletedMessageActions` function (at line ~1594, after the `addMessageButton` block and before the `onDelete` block):

```typescript
        // Share as card button
        if (!rendered.shareButton) {
            const shareButton = createMessageActionButton(rendered.actionDiv, {
                icon: 'share-2',
                cls: 'share-card-message-button',
                label: t("plugin.chat.action.shareAsCard"),
            });
            rendered.actionDiv.insertBefore(shareButton, rendered.actionMenuButton);
            shareButton.onclick = () => {
                new ShareCardModal(this.app, {
                    content: rendered.copyContent,
                    source: 'chat',
                    sourceLabel: 'PA Chat',
                }).open();
            };
            rendered.shareButton = shareButton;
        }
```

**IMPORTANT**: The `ensureCompletedMessageActions` function is inside the `openView` method closure. The `this.app` reference should use the outer `this` of the `LLMView` class. Check the surrounding context — if `this` doesn't refer to the view, use the `app` variable that's available in scope (look for how `options.onAddToEditor` accesses `app`).

Look at how the existing `addMessageButton.onclick` handler works (line 1590-1592) — it uses `options.onAddToEditor?.(rendered.copyContent)`. The share button can directly instantiate `ShareCardModal` since it doesn't need to go through the options pattern. If `this.app` is not available in scope, find how `app` is referenced (likely as a property of the view class or passed through constructor).

---

### Step 8: Entry Point — Pagelet Panel Share Button

#### 8a. Modify `src/pagelet/panel/types.ts`

Add to `PanelCallbacks` interface (after `onReviewQueueItemDismiss`):

```typescript
    onShareAsCard?: (findings: PanelFinding[]) => void;
```

#### 8b. Modify `src/pagelet/panel/PanelView.ts`

1. **Add import** at the top:
```typescript
import { ShareCardModal } from "../../share-card/share-card-modal";
```

2. **Add share button** in the footer section (after `expandTabBtn` creation at line 1154, before `root.appendChild(footer)` at line 1156):

```typescript
        // Share as card button
        const shareBtn = createHtmlElement("button");
        shareBtn.className = "pa-pagelet-panel-share-btn";
        shareBtn.textContent = pageletT("pagelet.panel.shareAsCard", this.getLocale());
        shareBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (this.currentExtra?.preparedReadOnly) return;
            const findings = this.getCurrentFindings();
            if (findings.length === 0) return;

            // Build markdown from findings
            const markdown = findings
                .map((f) => {
                    let text = `**${f.title}**\n\n${f.description}`;
                    if (f.insightText) text += `\n\n${f.insightText}`;
                    return text;
                })
                .join("\n\n---\n\n");

            new ShareCardModal(this.options.app!, {
                content: markdown,
                source: "pagelet",
                sourceLabel: "PA Pagelet",
            }).open();
        });
        footer.appendChild(shareBtn);
```

**NOTE**: You need to verify how `this.options.app` is accessed. Check `PanelViewOptions` interface in the types file — it has `app?: import("obsidian").App`. If `app` is optional, guard with `if (!this.options.app) return;`.

Also, `this.getCurrentFindings()` — you need to find the method or property that holds current findings. Search for where `onSaveAsReviewNote` is called — it passes findings. Look for `this.currentFindings` or similar. If no such method exists, look at how `handlePrimaryButtonClick` accesses findings and replicate that access pattern.

---

### Step 9: Entry Point — Editor Selection Command

#### Modify `src/plugin.ts`

1. **Add import** near other local imports:
```typescript
import { ShareCardModal } from './share-card/share-card-modal';
```

2. **Add command** after the existing `ai-assistant-featured-images` command block (~line 1597):

```typescript
        this.addCommand({
            id: 'share-selection-as-card',
            name: this.t("plugin.command.shareSelectionAsCard"),
            editorCallback: (editor: Editor) => {
                const sel = editor.getSelection().trim();
                if (!sel) {
                    new Notice(this.t("plugin.shareCard.noSelection"));
                    return;
                }
                new ShareCardModal(this.app, {
                    content: sel,
                    source: 'selection',
                }).open();
            },
        });
```

---

### Step 10: Locale Keys

#### `src/locales/plugin/en.json` — Add these keys:

```json
"plugin.command.shareSelectionAsCard": "Share selection as card image",
"plugin.chat.action.shareAsCard": "Share as card",
"plugin.shareCard.title": "Share as Card",
"plugin.shareCard.noSelection": "No text selected",
"plugin.shareCard.copySuccess": "Card image copied to clipboard",
"plugin.shareCard.copyFailed": "Cannot copy to clipboard, saving to vault instead",
"plugin.shareCard.saveSuccess": "Saved {count} card(s) to {path}",
"plugin.shareCard.exportCopy": "Copy to Clipboard",
"plugin.shareCard.exportSave": "Save as Image",
"plugin.shareCard.exportSaveAll": "Save All Pages"
```

#### `src/locales/plugin/zh.json` — Add these keys:

```json
"plugin.command.shareSelectionAsCard": "分享选中内容为卡片图片",
"plugin.chat.action.shareAsCard": "分享为卡片",
"plugin.shareCard.title": "分享为卡片",
"plugin.shareCard.noSelection": "没有选中文本",
"plugin.shareCard.copySuccess": "卡片已复制到剪贴板",
"plugin.shareCard.copyFailed": "无法复制到剪贴板，将保存到 Vault",
"plugin.shareCard.saveSuccess": "已保存 {count} 张卡片到 {path}",
"plugin.shareCard.exportCopy": "复制到剪贴板",
"plugin.shareCard.exportSave": "保存为图片",
"plugin.shareCard.exportSaveAll": "保存全部页"
```

#### Pagelet locale — `src/locales/pagelet/en.json` and `src/locales/pagelet/zh.json`

Add:
```json
// en
"pagelet.panel.shareAsCard": "Share as Card"

// zh
"pagelet.panel.shareAsCard": "分享为卡片"
```

**NOTE**: Find the pagelet locale files — they may be at `src/locales/pagelet/en.json` and `src/locales/pagelet/zh.json`, or inline in a TypeScript file. Search for where `pageletT` gets its translations from.

---

## Build & Verification

### Build Commands

```bash
npm install                          # Install @zumer/snapdom
npx tsc -noEmit -skipLibCheck        # Type-check
npm run tailwind:build               # Rebuild CSS (picks up new classes in custom.pcss)
npm run build                        # Full production build
make deploy                          # Deploy to test vault (if configured)
```

### Verification Checklist

After deploying to a test vault:

1. **Chat share**: Open PA Chat → ask a question → wait for AI response → see share button (share-2 icon) on the assistant message → click → ShareCardModal opens
2. **Pagelet share**: Trigger a Pagelet review → Panel opens with findings → footer has "Share as Card" button → click → ShareCardModal opens
3. **Selection share**: Open any markdown file → select text → Command Palette → "Share selection as card image" → ShareCardModal opens
4. **Light mode card**: Verify warm paper texture + diagonal light stripes + brown text + brand bar
5. **Dark mode card**: Toggle Obsidian to dark theme → verify deep black + bokeh orbs + warm white text
6. **Copy to clipboard**: Click "Copy to Clipboard" → paste into image viewer → verify 1080×1440 PNG matches preview
7. **Save to vault**: Click "Save as Image" → file appears in `PA-Cards/` folder in vault
8. **Pagination**: Use a long text (~50 lines) → verify multiple pages → navigate with ‹ › buttons → "Save All Pages" saves multiple files
9. **Consistency**: Side-by-side compare Modal preview vs exported PNG — should be visually identical

---

## Critical Implementation Notes

1. **Do NOT use `innerHTML` or `outerHTML` assignment** — Obsidian community review rejects this. Use `createEl`, `createDiv`, `setText`, `textContent` only.

2. **Do NOT create runtime `<style>` elements** — All CSS goes in `src/custom.pcss`.

3. **Import paths**: The project uses TypeScript path resolution with `.ts` extensions omitted. Import as `'../share-card/share-card-modal'` not `'../share-card/share-card-modal.ts'`.

4. **`createHtmlElement`** in PanelView: The Pagelet code uses a local `createHtmlElement("div")` helper (likely imported or defined nearby). Use the same pattern there, not Obsidian's `createEl`.

5. **`t()` function pattern**: Chat view uses `makePluginTranslator(getPluginUiLanguage())` which returns a `t` function. The share card module defines its own local `t()` wrapper.

6. **`setPlatformTimeout`**: If you need timeouts, use `setPlatformTimeout` from `"../platform-dom"` instead of raw `setTimeout` (cross-platform compatibility).

7. **`snapdom` API**: The library exports `snapdom` as a named export. Usage:
   ```typescript
   import { snapdom } from '@zumer/snapdom';
   const result = await snapdom(element, { scale: 2 });
   const blob = await result.toBlob({ type: 'image/png' });
   ```
   Check the actual npm package exports — if it doesn't export `toBlob` on the result, it may have `snapdom.toBlob(element, options)` as a static method instead. Refer to the README at https://github.com/zumerlab/snapdom.

8. **Git commit**: Use `git commit -s` (signed-off). Do NOT add `Co-Authored-By` trailer.

---

## Visual Design Reference

The card visual style is inspired by three reference images:

- **Light mode** = fusion of:
  - Image 1: Warm brown frame + diagonal sunlight shadow stripes through window + cream/paper background
  - Image 3: Structured layout on aged paper texture + educational card feel

- **Dark mode** = inspired by:
  - Image 2: Deep black with subtle noise texture + scattered soft white bokeh orbs (like snow/stars) + handwritten white text on dark background

Key aesthetic principles (from all three references):
- **Texture over flat color** — paper noise, light effects, bokeh give physical depth
- **Generous spacing** — content breathes, not cramped
- **Warm color temperature** — even dark mode has warm undertones (not cold blue-gray)
- **Content is the hero** — no UI chrome competes with the text
- **Brand is subtle** — small bottom strip, not a banner

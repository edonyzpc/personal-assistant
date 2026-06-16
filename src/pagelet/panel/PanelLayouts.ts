/* Copyright 2023 edonyzpc */

/**
 * Pagelet -- Panel layout renderers.
 *
 * Each function populates a container element with layout-specific
 * DOM content. Layout types:
 *
 *  - review:   Timeline-based review of recent note activity.
 *  - current:  Current note AI analysis.
 *  - discover: Connection map + related notes list.
 *  - summary:  Periodic summary markdown preview.
 *
 * CSS classes use the `pa-pagelet-panel-` prefix to avoid collisions.
 */

import { Component, MarkdownRenderer } from "obsidian";
import type { App } from "obsidian";

import type { NoteConnection, PanelFinding } from "./types";
import { pageletT, type PageletLocale } from "../../locales/pagelet";
import {
    createSuggestionCardRenderer,
    type SuggestionCardRenderer,
} from "../ui";
import { getPlatformDocument } from "../../platform-dom";
import { clearChildren, el } from "../dom-utils";

export interface PanelLayoutRenderOptions {
    onSuggestionRenderer?: (renderer: SuggestionCardRenderer) => void;
    onSuggestionSourceClick?: (finding: PanelFinding, sourceId: string) => void;
    onSuggestionAccept?: (finding: PanelFinding) => void;
    onSuggestionDismiss?: (finding: PanelFinding) => void;
    onRelatedNoteClick?: (noteName: string, finding: PanelFinding) => void;
    onResearchFinding?: (finding: PanelFinding) => void;
}

// ---------------------------------------------------------------------------
// Review timeline layout
// ---------------------------------------------------------------------------

/**
 * Render timeline-based review content into a container element.
 *
 * Produces a vertical timeline with section labels (e.g., "today",
 * "yesterday"), dot + connector lines, and optional insight cards
 * with accent border.
 */
export function renderReviewTimeline(
    container: HTMLElement,
    findings: PanelFinding[],
    locale: PageletLocale = "en",
    options: PanelLayoutRenderOptions = {},
): void {
    clearChildren(container);

    const timeline = el("div", "pa-pagelet-panel-timeline");
    if (findings.length === 0) {
        timeline.appendChild(el("div", "pa-pagelet-panel-timeline-section-label",
            pageletT("pagelet.panel.empty", locale)));
        container.appendChild(timeline);
        return;
    }

    // Group findings by date label (uses timestamp or falls back to index)
    const groups = groupByDate(findings);

    let groupIdx = 0;
    for (const [label, items] of groups) {
        if (groupIdx > 0) {
            timeline.appendChild(el("div", "pa-pagelet-panel-timeline-divider"));
        }
        timeline.appendChild(
            el("div", "pa-pagelet-panel-timeline-section-label", label),
        );

        for (const finding of items) {
            timeline.appendChild(renderTimelineItem(finding, locale, options));
        }
        groupIdx++;
    }

    container.appendChild(timeline);
}

/** Group findings into date buckets based on their timestamp field. */
function groupByDate(
    findings: PanelFinding[],
): Array<[string, PanelFinding[]]> {
    const groups = new Map<string, PanelFinding[]>();

    for (const f of findings) {
        const label = f.timestamp ?? "​"; // zero-width space as fallback
        if (!groups.has(label)) {
            groups.set(label, []);
        }
        groups.get(label)!.push(f);
    }

    return Array.from(groups.entries());
}

/** Build a single timeline item. */
function renderTimelineItem(
    finding: PanelFinding,
    locale: PageletLocale = "en",
    options: PanelLayoutRenderOptions = {},
): HTMLElement {
    const item = el("div", "pa-pagelet-panel-timeline-item");

    // Left column: dot + connector
    const line = el("div", "pa-pagelet-panel-timeline-line");
    const dotClass = finding.insightText
        ? "pa-pagelet-panel-timeline-dot pa-pagelet-panel-timeline-dot--accent"
        : "pa-pagelet-panel-timeline-dot";
    line.appendChild(el("div", dotClass));
    line.appendChild(el("div", "pa-pagelet-panel-timeline-connector"));
    item.appendChild(line);

    // Right column: content
    const content = el("div", "pa-pagelet-panel-timeline-content");
    if (finding.suggestion) {
        const mount = el("div", "pa-pagelet-panel-suggestion-card-host");
        const renderer = createSuggestionCardRenderer(
            mount,
            {
                suggestion: finding.suggestion,
                diagnostics: finding.diagnostics,
                onSourceClick: (sourceId) => options.onSuggestionSourceClick?.(finding, sourceId),
                onAccept: () => options.onSuggestionAccept?.(finding),
                onDismiss: () => options.onSuggestionDismiss?.(finding),
                onRelatedNoteClick: (noteName) => options.onRelatedNoteClick?.(noteName, finding),
                onResearch: () => options.onResearchFinding?.(finding),
            },
            { locale },
        );
        options.onSuggestionRenderer?.(renderer);
        content.appendChild(mount);
        item.appendChild(content);
        return item;
    }

    content.appendChild(
        el("div", "pa-pagelet-panel-timeline-title", finding.title),
    );
    if (finding.description) {
        content.appendChild(
            el("div", "pa-pagelet-panel-timeline-meta", finding.description),
        );
    }
    if (finding.insightText) {
        content.appendChild(
            el("div", "pa-pagelet-panel-timeline-insight", finding.insightText),
        );
    }

    // Action buttons
    if (finding.actions && finding.actions.length > 0) {
        const actionsRow = el("div", "pa-pagelet-panel-timeline-actions");
        for (const action of finding.actions) {
            const btn = el("button", "pa-pagelet-panel-timeline-action-btn", action.label);
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                action.callback();
            });
            actionsRow.appendChild(btn);
        }
        content.appendChild(actionsRow);
    }

    item.appendChild(content);
    return item;
}

// ---------------------------------------------------------------------------
// Current note analysis layout
// ---------------------------------------------------------------------------

/**
 * Render current note analysis into a container element.
 *
 * Shows a summary card at the top followed by AI analysis items
 * using the timeline-item structure.
 */
export function renderCurrentNoteAnalysis(
    container: HTMLElement,
    findings: PanelFinding[],
    locale: PageletLocale = "en",
    options: PanelLayoutRenderOptions = {},
): void {
    clearChildren(container);

    const wrapper = el("div", "pa-pagelet-panel-timeline");
    const hasSuggestions = findings.some((finding) => Boolean(finding.suggestion));

    // Summary card (first finding is treated as the summary)
    if (findings.length > 0 && !hasSuggestions) {
        wrapper.appendChild(
            el("div", "pa-pagelet-panel-timeline-section-label", findings[0].title),
        );

        const summaryCard = el("div", "pa-pagelet-panel-summary-card");
        summaryCard.appendChild(
            el("div", "pa-pagelet-panel-summary-title", findings[0].title),
        );
        summaryCard.appendChild(
            el("div", "pa-pagelet-panel-summary-meta", findings[0].description),
        );
        const cardWrap = el("div", "pa-pagelet-panel-card-wrap");
        cardWrap.appendChild(summaryCard);
        wrapper.appendChild(cardWrap);
    }

    // AI analysis items
    const startIndex = hasSuggestions ? 0 : 1;
    if (findings.length > startIndex) {
        wrapper.appendChild(
            el("div", "pa-pagelet-panel-timeline-section-label",
                pageletT("pagelet.panel.current.analysis", locale)),
        );

        for (let i = startIndex; i < findings.length; i++) {
            wrapper.appendChild(renderTimelineItem(findings[i], locale, options));
        }
    } else {
        wrapper.appendChild(el("div", "pa-pagelet-panel-timeline-section-label",
            pageletT("pagelet.panel.cards.empty", locale)));
    }

    container.appendChild(wrapper);
}

// ---------------------------------------------------------------------------
// Discovery layout
// ---------------------------------------------------------------------------

/**
 * Render knowledge discovery map + connections.
 *
 * Creates a simplified connection map with positioned note nodes
 * and dashed SVG lines between them, followed by a list of
 * connections with strength indicators.
 */
export function renderDiscoveryLayout(
    container: HTMLElement,
    findings: PanelFinding[],
    connections?: NoteConnection[],
    locale: PageletLocale = "en",
): void {
    clearChildren(container);

    const wrapper = el("div", "pa-pagelet-panel-timeline");

    // Connection map section
    wrapper.appendChild(
        el("div", "pa-pagelet-panel-timeline-section-label",
            pageletT("pagelet.panel.discovery.map", locale)),
    );
    const mapWrap = el("div", "pa-pagelet-panel-card-wrap");
    mapWrap.appendChild(renderConnectionMap(findings, connections));
    wrapper.appendChild(mapWrap);

    // Connection list section
    if (connections && connections.length > 0) {
        wrapper.appendChild(
            el("div", "pa-pagelet-panel-timeline-divider"),
        );
        wrapper.appendChild(
            el("div", "pa-pagelet-panel-timeline-section-label",
                pageletT("pagelet.panel.discovery.connections", locale)),
        );

        for (const conn of connections) {
            wrapper.appendChild(renderConnectionItem(conn, locale));
        }
    }

    // Additional findings below connections
    if (findings.length > 0) {
        wrapper.appendChild(
            el("div", "pa-pagelet-panel-timeline-divider"),
        );
        for (const finding of findings) {
            if (finding.insightText) {
                wrapper.appendChild(renderTimelineItem(finding));
            }
        }
    }

    container.appendChild(wrapper);
}

/** Build the connection map container with nodes and SVG lines. */
function renderConnectionMap(
    findings: PanelFinding[],
    connections?: NoteConnection[],
): HTMLElement {
    const map = el("div", "pa-pagelet-panel-connection-map");

    // Determine center and related nodes from findings/connections
    const nodeNames: string[] = [];
    if (findings.length > 0) {
        nodeNames.push(findings[0].title);
    }

    // Collect unique note names from connections
    if (connections) {
        for (const c of connections) {
            if (!nodeNames.includes(c.fromNote)) nodeNames.push(c.fromNote);
            if (!nodeNames.includes(c.toNote)) nodeNames.push(c.toNote);
        }
    }

    // Fallback to finding titles if we don't have enough nodes
    if (nodeNames.length < 2) {
        for (const f of findings) {
            if (!nodeNames.includes(f.title)) nodeNames.push(f.title);
        }
    }

    // Position nodes in a radial layout around center
    const positions = calculateNodePositions(nodeNames.length);

    // Create SVG for connection lines
    const svgNS = "http://www.w3.org/2000/svg";
    const doc = getPlatformDocument();
    const svg = doc.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "pa-pagelet-panel-connection-svg");
    svg.setAttribute("aria-hidden", "true");

    // Draw lines between connected nodes
    if (connections) {
        for (const conn of connections) {
            const fromIdx = nodeNames.indexOf(conn.fromNote);
            const toIdx = nodeNames.indexOf(conn.toNote);
            if (fromIdx >= 0 && toIdx >= 0) {
                const line = doc.createElementNS(svgNS, "line");
                line.setAttribute("x1", positions[fromIdx].x + "%");
                line.setAttribute("y1", positions[fromIdx].y + "%");
                line.setAttribute("x2", positions[toIdx].x + "%");
                line.setAttribute("y2", positions[toIdx].y + "%");
                line.setAttribute("stroke", "var(--background-modifier-border, #3a3a3a)");
                line.setAttribute("stroke-width", conn.strength === "strong" ? "1.6" : "1.0");
                line.setAttribute("stroke-dasharray", "4 3");
                if (conn.strength === "weak") {
                    line.setAttribute("opacity", "0.5");
                }
                svg.appendChild(line);
            }
        }
    } else if (nodeNames.length > 1) {
        // No connections data -- draw lines from center to all others
        for (let i = 1; i < nodeNames.length && i < positions.length; i++) {
            const line = doc.createElementNS(svgNS, "line");
            line.setAttribute("x1", positions[0].x + "%");
            line.setAttribute("y1", positions[0].y + "%");
            line.setAttribute("x2", positions[i].x + "%");
            line.setAttribute("y2", positions[i].y + "%");
            line.setAttribute("stroke", "var(--background-modifier-border, #3a3a3a)");
            line.setAttribute("stroke-width", "1.2");
            line.setAttribute("stroke-dasharray", "4 3");
            svg.appendChild(line);
        }
    }

    map.appendChild(svg);

    // Create node elements
    for (let i = 0; i < nodeNames.length && i < positions.length; i++) {
        const node = el("div",
            i === 0
                ? "pa-pagelet-panel-map-node pa-pagelet-panel-map-node--center"
                : "pa-pagelet-panel-map-node pa-pagelet-panel-map-node--related",
            nodeNames[i],
        );
        node.setCssStyles({
            left: positions[i].x + "%",
            top: positions[i].y + "%",
            transform: "translate(-50%, -50%)",
        });
        map.appendChild(node);
    }

    return map;
}

/** Calculate radial positions for nodes (center + radial layout). */
function calculateNodePositions(
    count: number,
): Array<{ x: number; y: number }> {
    if (count === 0) return [];
    // Center node
    const positions: Array<{ x: number; y: number }> = [{ x: 50, y: 50 }];

    // Surrounding nodes in a circle
    const radius = 32; // percentage from center
    for (let i = 1; i < count; i++) {
        const angle = ((i - 1) / (count - 1)) * 2 * Math.PI - Math.PI / 2;
        positions.push({
            x: Math.round(50 + radius * Math.cos(angle)),
            y: Math.round(50 + radius * Math.sin(angle)),
        });
    }

    return positions;
}

/** Build a connection item for the list below the map. */
function renderConnectionItem(
    conn: NoteConnection,
    locale: PageletLocale = "en",
): HTMLElement {
    const item = el("div", "pa-pagelet-panel-timeline-item");

    // Dot with strength-based color
    const line = el("div", "pa-pagelet-panel-timeline-line");
    const dotClass = conn.strength === "strong"
        ? "pa-pagelet-panel-timeline-dot pa-pagelet-panel-timeline-dot--accent"
        : "pa-pagelet-panel-timeline-dot";
    line.appendChild(el("div", dotClass));
    line.appendChild(el("div", "pa-pagelet-panel-timeline-connector"));
    item.appendChild(line);

    // Content
    const content = el("div", "pa-pagelet-panel-timeline-content");
    content.appendChild(
        el("div", "pa-pagelet-panel-timeline-title",
            `${conn.fromNote} ↔ ${conn.toNote}`),
    );

    const strengthLabel = pageletT(
        `pagelet.panel.discovery.strength.${conn.strength}`, locale,
    );
    content.appendChild(
        el("div", "pa-pagelet-panel-timeline-meta", strengthLabel),
    );

    if (conn.sharedConcepts.length > 0) {
        const sep = locale === "zh" ? "、" : ", ";
        content.appendChild(
            el("div", "pa-pagelet-panel-timeline-insight",
                pageletT("pagelet.panel.discovery.sharedConceptsList", locale, {
                    concepts: conn.sharedConcepts.join(sep),
                })),
        );
    }

    item.appendChild(content);
    return item;
}

// ---------------------------------------------------------------------------
// Summary preview layout
// ---------------------------------------------------------------------------

/**
 * Render periodic summary preview.
 *
 * Displays generated markdown content as formatted HTML preview.
 * When an Obsidian `App` and `Component` are provided, uses the
 * native `MarkdownRenderer.render()` for full-fidelity rendering
 * (internal links, callouts, code blocks, etc.).  Falls back to
 * the lightweight `simpleMarkdownRender` for test environments
 * where Obsidian APIs are unavailable.
 */
export function renderSummaryPreview(
    container: HTMLElement,
    markdown: string,
    app?: App,
    component?: Component,
    sourcePath?: string,
    locale: PageletLocale = "en",
): void {
    clearChildren(container);

    const wrapper = el("div", "pa-pagelet-panel-timeline");

    wrapper.appendChild(
        el("div", "pa-pagelet-panel-timeline-section-label",
            pageletT("pagelet.panel.layout.summaryPreview", locale)),
    );

    const preview = el("div", "pa-pagelet-panel-summary-preview");

    if (app && component) {
        // Use Obsidian's native markdown renderer
        MarkdownRenderer.render(
            app,
            markdown,
            preview,
            sourcePath ?? "",
            component,
        );
    } else {
        // Fallback for environments without App/Component (tests)
        renderSimpleMarkdownPreview(preview, markdown);
    }

    const cardWrap = el("div", "pa-pagelet-panel-card-wrap");
    cardWrap.appendChild(preview);
    wrapper.appendChild(cardWrap);

    container.appendChild(wrapper);
}

/** Minimal markdown renderer for preview purposes. */
function renderSimpleMarkdownPreview(container: HTMLElement, md: string): void {
    const lines = md.split("\n");

    for (const raw of lines) {
        const line = raw.trimEnd();
        if (line.startsWith("## ")) {
            container.appendChild(el("h4", "pa-pagelet-panel-preview-h2", line.slice(3)));
        } else if (line.startsWith("# ")) {
            container.appendChild(el("h3", "pa-pagelet-panel-preview-h1", line.slice(2)));
        } else if (line.startsWith("- ")) {
            container.appendChild(el("div", "pa-pagelet-panel-preview-li", `• ${line.slice(2)}`));
        } else if (line.trim() === "") {
            container.appendChild(el("br"));
        } else {
            container.appendChild(el("p", "pa-pagelet-panel-preview-p", line));
        }
    }
}

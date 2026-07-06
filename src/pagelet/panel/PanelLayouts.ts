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
 *  - summary:  Recap or generated review markdown preview.
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
import { clearChildren, el } from "../dom-utils";
import {
    clearPlatformTimeout,
    getPlatformDocument,
    setPlatformTimeout,
    type PlatformTimeoutHandle,
} from "../../platform-dom";

export interface PanelLayoutRenderOptions {
    onSuggestionRenderer?: (renderer: SuggestionCardRenderer) => void;
    onSuggestionSourceClick?: (finding: PanelFinding, sourceId: string) => void;
    onSuggestionAccept?: (finding: PanelFinding) => void;
    onSuggestionDismiss?: (finding: PanelFinding) => void;
    onRelatedNoteClick?: (noteName: string, finding: PanelFinding) => void;
    onConnectionNodeClick?: (noteName: string, sourcePath?: string) => void;
    onResearchFinding?: (finding: PanelFinding) => void;
    sourcePath?: string;
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
 * Creates an interactive note graph, followed by a list of
 * discovered connections with strength indicators.
 */
export function renderDiscoveryLayout(
    container: HTMLElement,
    findings: PanelFinding[],
    connections?: NoteConnection[],
    locale: PageletLocale = "en",
    options: PanelLayoutRenderOptions = {},
): void {
    clearChildren(container);

    const wrapper = el("div", "pa-pagelet-panel-timeline");

    // Connection map section
    wrapper.appendChild(
        el("div", "pa-pagelet-panel-timeline-section-label",
            pageletT("pagelet.panel.discovery.map", locale)),
    );
    const mapWrap = el("div", "pa-pagelet-panel-card-wrap");
    mapWrap.appendChild(renderConnectionMap(
        findings,
        connections,
        locale,
        options.sourcePath,
        options.onConnectionNodeClick,
    ));
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

const MAX_CONNECTION_MAP_NODES = 8;
const MAX_CONNECTION_LABEL_CHARS = 34;
const CONNECTION_GRAPH_WIDTH = 360;
const CONNECTION_GRAPH_HEIGHT = 220;
const CONNECTION_GRAPH_SVG_NS = "http://www.w3.org/2000/svg";
const CONNECTION_GRAPH_CLICK_SUPPRESS_MS = 250;
let connectionGraphTitleSequence = 0;

interface ConnectionGraphNode {
    name: string;
    label: string;
    x: number;
    y: number;
    radius: number;
    fill: string;
    stroke: string;
    current: boolean;
}

interface ConnectionGraphEdge {
    from: number;
    to: number;
    strength: NoteConnection["strength"];
    color: string;
}

/** Build the connection map container with an interactive SVG graph. */
function renderConnectionMap(
    findings: PanelFinding[],
    connections?: NoteConnection[],
    locale: PageletLocale = "en",
    sourcePath?: string,
    onNodeClick?: (noteName: string, sourcePath?: string) => void,
): HTMLElement {
    const map = el("div", "pa-pagelet-panel-connection-map");
    const viewport = el("div", "pa-pagelet-panel-connection-graph-wrap");
    map.appendChild(viewport);

    const nodeNames = collectConnectionNodeNames(findings, connections, sourcePath);
    if (nodeNames.length === 0) {
        viewport.appendChild(el("div", "pa-pagelet-panel-connection-empty",
            pageletT("pagelet.panel.discovery.emptyMap", locale)));
        return map;
    }

    renderInteractiveConnectionGraph(viewport, nodeNames, connections, locale, sourcePath, onNodeClick);
    return map;
}

function collectConnectionNodeNames(
    findings: readonly PanelFinding[],
    connections?: readonly NoteConnection[],
    sourcePath?: string,
): string[] {
    const nodes: string[] = [];
    const seen = new Set<string>();
    const push = (name: string | undefined): void => {
        const normalized = normalizeNoteNodeName(name);
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        nodes.push(normalized);
    };

    push(sourcePath);

    if (connections && connections.length > 0) {
        const currentNote = normalizeNoteNodeName(sourcePath).length > 0
            ? sourcePath
            : connections.find((connection) =>
                normalizeNoteNodeName(connection.fromNote).length > 0
            )?.fromNote;
        push(currentNote);
        for (const connection of connections) {
            push(connection.fromNote);
            push(connection.toNote);
        }
    }

    if (nodes.length < 2) {
        for (const finding of findings) {
            push(finding.sourceFile);
        }
    }

    return nodes.slice(0, MAX_CONNECTION_MAP_NODES);
}

function normalizeNoteNodeName(name: string | undefined): string {
    return (name ?? "").trim().replace(/\\/g, "/").replace(/\/+/g, "/");
}

function renderInteractiveConnectionGraph(
    viewport: HTMLElement,
    nodeNames: readonly string[],
    connections?: readonly NoteConnection[],
    locale: PageletLocale = "en",
    sourcePath?: string,
    onNodeClick?: (noteName: string, sourcePath?: string) => void,
): void {
    const doc = getPlatformDocument();
    const { nodes, edges } = buildConnectionGraphModel(nodeNames, connections);
    const titleIdPrefix = `pa-pagelet-connection-node-title-${++connectionGraphTitleSequence}`;
    const svg = doc.createElementNS(CONNECTION_GRAPH_SVG_NS, "svg");
    svg.setAttribute("class", "pa-pagelet-panel-connection-graph");
    svg.setAttribute("viewBox", `0 0 ${CONNECTION_GRAPH_WIDTH} ${CONNECTION_GRAPH_HEIGHT}`);
    svg.setAttribute("role", "group");
    svg.setAttribute("aria-label", pageletT("pagelet.panel.discovery.graphAriaLabel", locale));

    const edgeLayer = doc.createElementNS(CONNECTION_GRAPH_SVG_NS, "g");
    edgeLayer.setAttribute("class", "pa-pagelet-panel-connection-edge-layer");
    const nodeLayer = doc.createElementNS(CONNECTION_GRAPH_SVG_NS, "g");
    nodeLayer.setAttribute("class", "pa-pagelet-panel-connection-node-layer");
    svg.appendChild(edgeLayer);
    svg.appendChild(nodeLayer);

    const edgeElements = edges.map((edge) => {
        const line = doc.createElementNS(CONNECTION_GRAPH_SVG_NS, "line");
        line.setAttribute("class", `pa-pagelet-panel-connection-edge pa-pagelet-panel-connection-edge--${edge.strength}`);
        line.setAttribute("stroke", edge.color);
        line.setAttribute("data-strength", edge.strength);
        edgeLayer.appendChild(line);
        return line;
    });

    let activeDrag: {
        index: number;
        pointerId: number;
        start: { x: number; y: number };
        pointerType: string;
        moved: boolean;
    } | null = null;
    const suppressClickTimers = new WeakMap<SVGGElement, PlatformTimeoutHandle>();
    const clearSuppressedClick = (group: SVGGElement): void => {
        const timer = suppressClickTimers.get(group);
        if (timer !== undefined) {
            clearPlatformTimeout(timer);
            suppressClickTimers.delete(group);
        }
        group.removeAttribute("data-suppress-click");
    };
    const suppressNextClick = (group: SVGGElement): void => {
        clearSuppressedClick(group);
        group.setAttribute("data-suppress-click", "true");
        const timer = setPlatformTimeout(() => {
            suppressClickTimers.delete(group);
            group.removeAttribute("data-suppress-click");
        }, CONNECTION_GRAPH_CLICK_SUPPRESS_MS);
        suppressClickTimers.set(group, timer);
    };

    const nodeGroups = nodes.map((node, index) => {
        const group = doc.createElementNS(CONNECTION_GRAPH_SVG_NS, "g");
        group.setAttribute("class", [
            "pa-pagelet-panel-connection-node",
            node.current ? "pa-pagelet-panel-connection-node--current" : "",
        ].filter(Boolean).join(" "));
        group.setAttribute("data-note-path", node.name);
        group.setAttribute("role", "button");
        group.setAttribute("tabindex", "0");

        const title = doc.createElementNS(CONNECTION_GRAPH_SVG_NS, "title");
        title.setAttribute("id", `${titleIdPrefix}-${index}`);
        title.textContent = node.name;
        group.appendChild(title);
        group.setAttribute("aria-labelledby", title.getAttribute("id") ?? "");

        const hit = doc.createElementNS(CONNECTION_GRAPH_SVG_NS, "circle");
        hit.setAttribute("class", "pa-pagelet-panel-connection-node-hit");
        hit.setAttribute("r", String(Math.max(node.radius + 12, 26)));
        group.appendChild(hit);

        const circle = doc.createElementNS(CONNECTION_GRAPH_SVG_NS, "circle");
        circle.setAttribute("class", "pa-pagelet-panel-connection-node-dot");
        circle.setAttribute("r", String(node.radius));
        circle.setAttribute("fill", node.fill);
        circle.setAttribute("stroke", node.stroke);
        group.appendChild(circle);

        const text = doc.createElementNS(CONNECTION_GRAPH_SVG_NS, "text");
        text.setAttribute("class", "pa-pagelet-panel-connection-node-label");
        text.textContent = node.label;
        group.appendChild(text);

        group.addEventListener("pointerdown", (event) => {
            if (event.pointerType !== "touch") {
                event.preventDefault();
            }
            event.stopPropagation();
            activeDrag = {
                index,
                pointerId: event.pointerId,
                start: pointerToGraphPoint(svg, event),
                pointerType: event.pointerType,
                moved: false,
            };
            group.setAttribute("data-dragging", "true");
            try {
                (group as unknown as { setPointerCapture?: (pointerId: number) => void })
                    .setPointerCapture?.(event.pointerId);
            } catch {
                // Synthetic pointer events used by smoke tests may not own capture.
            }
        });
        group.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (group.getAttribute("data-suppress-click") === "true") {
                clearSuppressedClick(group);
                return;
            }
            onNodeClick?.(node.name, sourcePath);
        });
        group.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            onNodeClick?.(node.name, sourcePath);
        });

        nodeLayer.appendChild(group);
        updateNodeGroup(group, node);
        return group;
    });

    const updateEdges = (): void => {
        edges.forEach((edge, index) => {
            const from = nodes[edge.from];
            const to = nodes[edge.to];
            const line = edgeElements[index];
            line.setAttribute("x1", String(from.x));
            line.setAttribute("y1", String(from.y));
            line.setAttribute("x2", String(to.x));
            line.setAttribute("y2", String(to.y));
        });
    };
    updateEdges();

    const finishDrag = (event: PointerEvent): void => {
        if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
        const group = nodeGroups[activeDrag.index];
        group.removeAttribute("data-dragging");
        if (activeDrag.moved) {
            suppressNextClick(group);
        }
        activeDrag = null;
    };

    svg.addEventListener("pointermove", (event) => {
        if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
        const point = pointerToGraphPoint(svg, event);
        const node = nodes[activeDrag.index];
        const deltaX = point.x - activeDrag.start.x;
        const deltaY = point.y - activeDrag.start.y;
        if (
            activeDrag.pointerType === "touch"
            && !activeDrag.moved
            && Math.abs(deltaY) > 6
            && Math.abs(deltaY) > Math.abs(deltaX)
        ) {
            nodeGroups[activeDrag.index].removeAttribute("data-dragging");
            activeDrag = null;
            return;
        }
        if (Math.abs(deltaX) + Math.abs(deltaY) > 3) {
            activeDrag.moved = true;
        }
        if (!activeDrag.moved) return;
        event.preventDefault();
        node.x = clamp(point.x, 18, CONNECTION_GRAPH_WIDTH - 18);
        node.y = clamp(point.y, 18, CONNECTION_GRAPH_HEIGHT - 18);
        updateNodeGroup(nodeGroups[activeDrag.index], node);
        updateEdges();
    });
    svg.addEventListener("pointerup", finishDrag);
    svg.addEventListener("pointercancel", finishDrag);
    svg.addEventListener("mouseleave", () => {
        if (!activeDrag) return;
        nodeGroups[activeDrag.index].removeAttribute("data-dragging");
        activeDrag = null;
    });

    viewport.appendChild(svg);
}

function findDuplicateBaseLabels(nodeNames: readonly string[]): Set<string> {
    const counts = new Map<string, number>();
    for (const name of nodeNames) {
        const key = basenameWithoutMarkdown(name).toLowerCase();
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set([...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([name]) => name));
}

function formatConnectionGraphLabel(
    noteName: string,
    duplicateBaseLabels: ReadonlySet<string>,
): string {
    const baseName = basenameWithoutMarkdown(noteName);
    const label = duplicateBaseLabels.has(baseName.toLowerCase())
        ? noteName.replace(/\.md$/i, "")
        : baseName;
    return truncateMiddle(label, MAX_CONNECTION_LABEL_CHARS);
}

function basenameWithoutMarkdown(noteName: string): string {
    const normalized = normalizeNoteNodeName(noteName).replace(/\/$/g, "");
    const parts = normalized.split("/").filter(Boolean);
    const baseName = parts.length > 0 ? parts[parts.length - 1] : normalized;
    return (baseName || normalized || "Untitled").replace(/\.md$/i, "");
}

function truncateMiddle(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    const suffixLength = Math.floor((maxLength - 3) / 2);
    const prefixLength = maxLength - 3 - suffixLength;
    return `${value.slice(0, prefixLength)}...${value.slice(value.length - suffixLength)}`;
}

function buildConnectionGraphModel(
    nodeNames: readonly string[],
    connections?: readonly NoteConnection[],
): { nodes: ConnectionGraphNode[]; edges: ConnectionGraphEdge[] } {
    const duplicateBaseLabels = findDuplicateBaseLabels(nodeNames);
    const positions = calculateConnectionGraphPositions(nodeNames.length);
    const nodes = nodeNames.map((name, index): ConnectionGraphNode => {
        const color = CONNECTION_NODE_PALETTE[index % CONNECTION_NODE_PALETTE.length];
        return {
            name,
            label: formatConnectionGraphLabel(name, duplicateBaseLabels),
            x: positions[index]?.x ?? CONNECTION_GRAPH_WIDTH / 2,
            y: positions[index]?.y ?? CONNECTION_GRAPH_HEIGHT / 2,
            radius: index === 0 ? 3.5 : 2.75,
            fill: color.fill,
            stroke: color.stroke,
            current: index === 0,
        };
    });
    const nodeIndex = new Map(nodeNames.map((name, index) => [name, index]));
    const edges: ConnectionGraphEdge[] = [];
    const rendered = new Set<string>();
    const addEdge = (
        fromName: string,
        toName: string,
        strength: NoteConnection["strength"] = "medium",
    ): void => {
        const from = nodeIndex.get(normalizeNoteNodeName(fromName));
        const to = nodeIndex.get(normalizeNoteNodeName(toName));
        if (from === undefined || to === undefined || from === to) return;
        const key = [from, to].sort().join("-");
        if (rendered.has(key)) return;
        rendered.add(key);
        edges.push({ from, to, strength, color: connectionEdgeColor(strength, edges.length) });
    };

    if (connections && connections.length > 0) {
        for (const connection of connections) {
            addEdge(connection.fromNote, connection.toNote, connection.strength);
        }
    } else {
        for (const related of nodeNames.slice(1)) {
            addEdge(nodeNames[0], related);
        }
    }

    return { nodes, edges };
}

const CONNECTION_NODE_PALETTE = [
    { fill: "#38bdf8", stroke: "#0369a1" },
    { fill: "#a78bfa", stroke: "#6d28d9" },
    { fill: "#34d399", stroke: "#047857" },
    { fill: "#f59e0b", stroke: "#b45309" },
    { fill: "#fb7185", stroke: "#be123c" },
    { fill: "#2dd4bf", stroke: "#0f766e" },
    { fill: "#c084fc", stroke: "#7e22ce" },
    { fill: "#84cc16", stroke: "#4d7c0f" },
];

function calculateConnectionGraphPositions(count: number): Array<{ x: number; y: number }> {
    if (count <= 0) return [];
    const center = { x: 132, y: 112 };
    const positions = [center];
    const relatedCount = count - 1;
    if (relatedCount <= 0) return positions;

    for (let i = 0; i < relatedCount; i++) {
        const angle = relatedCount === 1
            ? 0
            : -Math.PI * 0.52 + (i / (relatedCount - 1)) * Math.PI * 1.04;
        positions.push({
            x: Math.round(center.x + Math.cos(angle) * 112),
            y: Math.round(center.y + Math.sin(angle) * 76),
        });
    }
    return positions.map((point) => ({
        x: clamp(point.x, 28, CONNECTION_GRAPH_WIDTH - 48),
        y: clamp(point.y, 26, CONNECTION_GRAPH_HEIGHT - 26),
    }));
}

function connectionEdgeColor(strength: NoteConnection["strength"], index: number): string {
    if (strength === "strong") return "#0ea5e9";
    if (strength === "weak") return "#a78bfa";
    return ["#22c55e", "#f59e0b", "#ec4899", "#14b8a6"][index % 4];
}

function pointerToGraphPoint(svg: SVGSVGElement, event: PointerEvent): { x: number; y: number } {
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
        return { x: CONNECTION_GRAPH_WIDTH / 2, y: CONNECTION_GRAPH_HEIGHT / 2 };
    }
    return {
        x: ((event.clientX - rect.left) / rect.width) * CONNECTION_GRAPH_WIDTH,
        y: ((event.clientY - rect.top) / rect.height) * CONNECTION_GRAPH_HEIGHT,
    };
}

function updateNodeGroup(group: SVGGElement, node: ConnectionGraphNode): void {
    group.setAttribute("transform", `translate(${node.x} ${node.y})`);
    const label = group.querySelector<SVGTextElement>(".pa-pagelet-panel-connection-node-label");
    if (!label) return;
    const labelOnRight = node.x < CONNECTION_GRAPH_WIDTH * 0.68;
    label.setAttribute("x", String(labelOnRight ? node.radius + 9 : -node.radius - 9));
    label.setAttribute("y", "4");
    label.setAttribute("text-anchor", labelOnRight ? "start" : "end");
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
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
 * Render recap or generated review markdown preview.
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
        void Promise.resolve(MarkdownRenderer.render(
            app,
            markdown,
            preview,
            sourcePath ?? "",
            component,
        )).catch(() => {
            clearChildren(preview);
            renderSimpleMarkdownPreview(preview, markdown);
        });
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

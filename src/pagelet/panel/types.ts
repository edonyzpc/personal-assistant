/* Copyright 2023 edonyzpc */

/**
 * Pagelet v2 -- Panel component types.
 *
 * The Panel is a side panel (~380px wide) for deeper exploration.
 * It supports scenario-adaptive layouts that change based on which
 * scenario opened it (review, current note, discovery, summary).
 */

/** Which scenario opened the Panel -- determines layout */
export type PanelLayoutType = "review" | "current" | "discover" | "summary";

/** A panel finding item */
export interface PanelFinding {
    title: string;
    description: string;
    sourceFile?: string;
    sourceTitle?: string;
    insightText?: string;
    timestamp?: string;
    actions?: PanelAction[];
}

/** Panel action button */
export interface PanelAction {
    label: string;
    callback: () => void;
}

/** Panel callbacks to parent */
export interface PanelCallbacks {
    onExpandToTab: () => void;
    onClose: () => void;
    onSourceClick: (sourceLink: string) => void;
    onSaveAsReviewNote: (findings: PanelFinding[]) => void;
    onToggleHints?: () => void;
}

/** Options for creating a PanelView */
export interface PanelViewOptions {
    app?: import("obsidian").App;
    callbacks: PanelCallbacks;
    locale?: import("../../locales/pagelet").PageletLocale;
}

/** Discovery connection between notes */
export interface NoteConnection {
    fromNote: string;
    toNote: string;
    strength: "strong" | "medium" | "weak";
    sharedConcepts: string[];
}

/** Discovery result */
export interface DiscoveryResult {
    connections: NoteConnection[];
    themes: Array<{ name: string; notes: string[]; concepts: string[] }>;
    gaps: Array<{ topic: string; description: string }>;
}

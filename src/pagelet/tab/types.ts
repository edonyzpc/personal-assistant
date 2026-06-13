/* Copyright 2023 edonyzpc */

import type { PageletLocale } from "../../locales/pagelet";
import type { PanelFinding } from "../panel/types";

/**
 * Pagelet -- Tab component types.
 *
 * The Tab is a full editor tab for complex exploration.
 * It shows overview, theme clustering, and action suggestions.
 */

/** A section within the Tab view */
export interface TabSection {
    title: string;
    cards: TabCard[];
}

/** A card within a Tab section */
export interface TabCard {
    title?: string;
    body: string;
    tags?: string[];
}

export type PageletDetailContent = PanelFinding[] | TabSection[];

export interface PageletDetailPayload {
    title: string;
    content: PageletDetailContent;
    locale: PageletLocale;
}

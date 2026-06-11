/* Copyright 2023 edonyzpc */

import type { TFile } from "obsidian";

/** A note that is a candidate for review */
export interface ScopeCandidate {
    file: TFile;
    mtime: number;
    sizeBytes: number;
}

/** Exclusion rule types */
export type ExclusionReason =
    | "trash"
    | "hidden-folder"
    | "pagelet-output"
    | "template"
    | "plugin-generated"
    | "empty"
    | "non-markdown"
    | "pagelet-frontmatter"
    | "too-large"
    | "excluded-folder"
    | "excluded-tag"
    | "excluded-pattern";

/** Result of scope resolution */
export interface ScopeResult {
    included: ScopeCandidate[];
    excluded: Array<{ file: TFile; reason: ExclusionReason }>;
}

/** Configuration for scope resolution */
export interface ScopeConfig {
    excludedFolders: string[];
    excludedTags: string[];
    excludedPatterns: string[];
    maxFileSizeBytes: number;
    reviewsFolder: string;
}

/* Copyright 2023 edonyzpc */

import type { TFile } from "obsidian";

/** A single preload finding (structured AI output) */
export interface PreloadFinding {
    text: string;
    sourceFile: string;
    sourceTitle: string;
    confidence?: number;
}

/** Result of a single preload cycle */
export interface PreloadResult {
    findings: PreloadFinding[];
    analyzedFiles: string[];
    analyzedAt: number;
    tokenCost: { input: number; output: number };
}

/** Cache entry */
export interface PreloadCacheEntry {
    result: PreloadResult;
    cachedAt: number;
}

/** Preload engine configuration */
export interface PreloadConfig {
    enabled: boolean;
    intervalMinutes: number;
    perHourCap: number;
    perDayCap: number;
    tokenBudget: { input: number; output: number };
}

/** Error category for preload cycle failures */
export type PreloadErrorCategory = "network" | "auth" | "rate-limit" | "parse" | "unknown";

/** Preload engine events for listeners */
export type PreloadEvent =
    | { type: "cycle-start" }
    | { type: "cycle-complete"; result: PreloadResult }
    | { type: "cycle-skip"; reason: "no-changes" | "budget-exceeded" | "disabled" }
    | { type: "cycle-error"; error: Error; category: PreloadErrorCategory }
    | { type: "circuit-breaker"; backoffMs: number; consecutiveErrors: number };

/** Callback type for LLM analysis — injected by the caller */
export type AnalyzeCallback = (files: TFile[], config: PreloadConfig) => Promise<PreloadResult>;

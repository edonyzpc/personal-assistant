import type { TFile } from "obsidian";

import type { AIUtils, CreateEmbeddingsOptions } from "../ai-services/ai-utils";
import { toError } from "../error-utils";
import { clearPlatformTimeout, setPlatformTimeout } from "../platform-dom";
import type { VSSChunk } from "./types";

export const EMBEDDING_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000];
export const QWEN_TEXT_EMBEDDING_SAFE_TPM = 900_000;

export type EmbeddingsModel = Awaited<ReturnType<AIUtils["createEmbeddings"]>>;
export type EmbeddingsModelProvider = () => Promise<EmbeddingsModel>;

export interface EmbeddingBatchPolicy {
    maxBatchItems: number;
    minRequestGapMs: number;
    safeTokensPerMinute?: number;
    retryDelaysMs: number[];
    createOptions: CreateEmbeddingsOptions;
}

export interface RebuildFileState {
    file: TFile;
    contentHash: string;
    chunks: VSSChunk[];
    embeddings: number[][];
    remaining: number;
    failed: boolean;
}

export interface RebuildChunkWorkItem {
    state: RebuildFileState;
    chunkIndex: number;
    text: string;
}

export function getProgressFileName(file: TFile): string {
    return file.name || file.path.split("/").pop() || file.path;
}

export function getProgressPathName(path: string): string {
    return path.split("/").pop() || path;
}

export function estimateEmbeddingTokensForTexts(texts: string[]): number {
    return texts.reduce((total, text) => total + estimateEmbeddingTokensForText(text), 0);
}

export function estimateEmbeddingTokensForText(text: string): number {
    const cjkMatches = text.match(/[\u3400-\u9FFF\uF900-\uFAFF]/g);
    const cjkCount = cjkMatches?.length ?? 0;
    const nonCjkCount = Math.max(0, text.length - cjkCount);
    return Math.max(1, cjkCount + Math.ceil(nonCjkCount / 4));
}

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setPlatformTimeout(resolve, ms));
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timeout = setPlatformTimeout(
            () => reject(Object.assign(new Error(`VSS operation timed out after ${timeoutMs}ms.`), { code: "vss-timeout" })),
            timeoutMs,
        );
        promise.then(
            (value) => {
                clearPlatformTimeout(timeout);
                resolve(value);
            },
            (error) => {
                clearPlatformTimeout(timeout);
                reject(toError(error));
            },
        );
    });
}

export function isRetryableEmbeddingError(error: unknown): boolean {
    const status = getErrorStatus(error);
    if (status === 408 || status === 429 || (status !== undefined && status >= 500)) {
        return true;
    }

    const message = getErrorMessage(error).toLowerCase();
    return [
        "rate limit",
        "too many requests",
        "requests rate limit exceeded",
        "you exceeded your current requests",
        "allocated quota exceeded",
        "you exceeded your current quota",
        "request rate increased too quickly",
        "timeout",
        "timed out",
        "network",
        "fetch failed",
        "econnreset",
        "econnaborted",
        "temporarily",
    ].some(fragment => message.includes(fragment));
}

export function getErrorStatus(error: unknown): number | undefined {
    if (!isObject(error)) return undefined;
    const directStatus = numberValueOrUndefined(error.status) ?? numberValueOrUndefined(error.statusCode);
    if (directStatus !== undefined) return directStatus;
    const response = error.response;
    return isObject(response) ? numberValueOrUndefined(response.status) : undefined;
}

export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (isObject(error) && typeof error.message === "string") return error.message;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

export function estimateEmbeddingTokens(chunkCount: number): number {
    return chunkCount * 1_000;
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isMissingFileError(error: unknown): boolean {
    return error !== null
        && typeof error === "object"
        && "code" in error
        && (error as { code?: unknown }).code === "ENOENT";
}

function numberValueOrUndefined(value: unknown): number | undefined {
    return typeof value === "number" ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

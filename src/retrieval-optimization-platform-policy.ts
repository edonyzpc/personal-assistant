/* Copyright 2023 edonyzpc */

import { Platform } from "obsidian";

import type { RetrievalOptimizationFlags } from "./ai-services/AiServiceHost";

export const B125_WINDOWS_SUPPORT_WAIVER_ID =
    "B-125-WIN32-TEMPORARY-SUPPORT-WAIVER-2026-08-13";

export type EffectiveRetrievalOptimizationFlags = Readonly<
    Required<RetrievalOptimizationFlags>
>;

const DISABLED_RETRIEVAL_OPTIMIZATION_FLAGS: EffectiveRetrievalOptimizationFlags =
    Object.freeze({
        lexicalProfile: false,
        strictReranker: false,
        graphPpr: false,
        relaxedRecovery: false,
    });

export function isB125RetrievalOptimizationPlatformSupported(
    isWindows = Platform?.isWin === true,
): boolean {
    return !isWindows;
}

export function resolveB125RetrievalOptimizationFlags(
    flags: Readonly<RetrievalOptimizationFlags> | undefined,
    isWindows = Platform?.isWin === true,
): EffectiveRetrievalOptimizationFlags {
    if (!isB125RetrievalOptimizationPlatformSupported(isWindows)) {
        return DISABLED_RETRIEVAL_OPTIMIZATION_FLAGS;
    }
    return {
        lexicalProfile: flags?.lexicalProfile === true,
        strictReranker: flags?.strictReranker === true,
        graphPpr: flags?.graphPpr === true,
        relaxedRecovery: flags?.relaxedRecovery === true,
    };
}

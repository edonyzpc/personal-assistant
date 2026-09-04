/* Copyright 2023 edonyzpc */

import { Platform } from "obsidian";

import type { RetrievalOptimizationFlags } from "./ai-services/AiServiceHost";

export const B125_WINDOWS_SUPPORT_WAIVER_ID =
    "B-125-WIN32-TEMPORARY-SUPPORT-WAIVER-2026-08-13";
export const B125_ANDROID_SUPPORT_WAIVER_ID =
    "B-125-ANDROID-TEMPORARY-SUPPORT-WAIVER-2026-09-04";

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

const B125_ROLLOUT_AUTHORITY = Object.freeze({
    featureId: "B-125" as const,
    sourceDecisionId: "DEC-027" as const,
    decisionId: "DEC-031" as const,
    ownerApprovalDate: "2026-09-04" as const,
});

/**
 * Versioned shipping-default authority for the approved B-125 rollout.
 *
 * These defaults are runtime policy, not calibration evidence and not
 * persisted settings. Sparse explicit boolean settings remain per-flag
 * rollback overrides.
 */
export const B125_RETRIEVAL_OPTIMIZATION_ROLLOUT_PROFILE = Object.freeze({
    id: "b125-retrieval-optimization-rollout" as const,
    version: 1 as const,
    authority: B125_ROLLOUT_AUTHORITY,
    buildDefaults: Object.freeze({
        lexicalProfile: true,
        strictReranker: true,
        graphPpr: true,
        relaxedRecovery: true,
    }) satisfies EffectiveRetrievalOptimizationFlags,
});

export type B125RetrievalOptimizationPlatformMask =
    | "none"
    | "windows"
    | "android"
    | "unsupported";

export interface B125RetrievalOptimizationRuntimePlatform {
    readonly isWindows: boolean;
    readonly isAndroid: boolean;
    readonly isMacOS: boolean;
    readonly isLinux: boolean;
    readonly isIos: boolean;
}

export interface B125RetrievalOptimizationPolicySnapshot {
    readonly rolloutId: typeof B125_RETRIEVAL_OPTIMIZATION_ROLLOUT_PROFILE.id;
    readonly rolloutVersion: typeof B125_RETRIEVAL_OPTIMIZATION_ROLLOUT_PROFILE.version;
    readonly authority: typeof B125_RETRIEVAL_OPTIMIZATION_ROLLOUT_PROFILE.authority;
    readonly platformSupported: boolean;
    readonly platformMask: B125RetrievalOptimizationPlatformMask;
    readonly effectiveFlags: EffectiveRetrievalOptimizationFlags;
}

function resolvePlatformMask(
    platform: B125RetrievalOptimizationRuntimePlatform,
): B125RetrievalOptimizationPlatformMask {
    if (platform.isWindows) return "windows";
    if (platform.isAndroid) return "android";
    if (platform.isMacOS || platform.isLinux || platform.isIos) return "none";
    return "unsupported";
}

function getRuntimePlatform(): B125RetrievalOptimizationRuntimePlatform {
    return {
        isWindows: Platform?.isWin === true,
        isAndroid: Platform?.isAndroidApp === true,
        isMacOS: Platform?.isMacOS === true,
        isLinux: Platform?.isLinux === true,
        isIos: Platform?.isIosApp === true,
    };
}

export function isB125RetrievalOptimizationPlatformSupported(
    platform = getRuntimePlatform(),
): boolean {
    return resolvePlatformMask(platform) === "none";
}

export function resolveB125RetrievalOptimizationFlags(
    flags: Readonly<RetrievalOptimizationFlags> | undefined,
    platform = getRuntimePlatform(),
): EffectiveRetrievalOptimizationFlags {
    if (!isB125RetrievalOptimizationPlatformSupported(platform)) {
        return DISABLED_RETRIEVAL_OPTIMIZATION_FLAGS;
    }
    const defaults = B125_RETRIEVAL_OPTIMIZATION_ROLLOUT_PROFILE.buildDefaults;
    return Object.freeze({
        lexicalProfile: typeof flags?.lexicalProfile === "boolean"
            ? flags.lexicalProfile
            : defaults.lexicalProfile,
        strictReranker: typeof flags?.strictReranker === "boolean"
            ? flags.strictReranker
            : defaults.strictReranker,
        graphPpr: typeof flags?.graphPpr === "boolean"
            ? flags.graphPpr
            : defaults.graphPpr,
        relaxedRecovery: typeof flags?.relaxedRecovery === "boolean"
            ? flags.relaxedRecovery
            : defaults.relaxedRecovery,
    });
}

export function resolveB125RetrievalOptimizationPolicySnapshot(
    flags: Readonly<RetrievalOptimizationFlags> | undefined,
    platform = getRuntimePlatform(),
): B125RetrievalOptimizationPolicySnapshot {
    const platformMask = resolvePlatformMask(platform);
    return Object.freeze({
        rolloutId: B125_RETRIEVAL_OPTIMIZATION_ROLLOUT_PROFILE.id,
        rolloutVersion: B125_RETRIEVAL_OPTIMIZATION_ROLLOUT_PROFILE.version,
        authority: B125_RETRIEVAL_OPTIMIZATION_ROLLOUT_PROFILE.authority,
        platformSupported: platformMask === "none",
        platformMask,
        effectiveFlags: resolveB125RetrievalOptimizationFlags(
            flags,
            platform,
        ),
    });
}

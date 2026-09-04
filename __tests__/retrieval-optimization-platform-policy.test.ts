import { describe, expect, it } from "@jest/globals";
import { Platform } from "obsidian";

import {
    B125_RETRIEVAL_OPTIMIZATION_ROLLOUT_PROFILE,
    B125_WINDOWS_SUPPORT_WAIVER_ID,
    B125_ANDROID_SUPPORT_WAIVER_ID,
    type B125RetrievalOptimizationRuntimePlatform,
    isB125RetrievalOptimizationPlatformSupported,
    resolveB125RetrievalOptimizationFlags,
    resolveB125RetrievalOptimizationPolicySnapshot,
} from "../src/retrieval-optimization-platform-policy";

function runtimePlatform(
    overrides: Partial<B125RetrievalOptimizationRuntimePlatform> = {},
): B125RetrievalOptimizationRuntimePlatform {
    return {
        isWindows: false,
        isAndroid: false,
        isMacOS: false,
        isLinux: false,
        isIos: false,
        ...overrides,
    };
}

const MACOS_PLATFORM = runtimePlatform({ isMacOS: true });

describe("B-125 retrieval optimization platform policy", () => {
    it("uses the versioned owner-approved rollout profile as supported-platform build defaults", () => {
        expect(B125_RETRIEVAL_OPTIMIZATION_ROLLOUT_PROFILE).toEqual({
            id: "b125-retrieval-optimization-rollout",
            version: 1,
            authority: {
                featureId: "B-125",
                sourceDecisionId: "DEC-027",
                decisionId: "DEC-031",
                ownerApprovalDate: "2026-09-04",
            },
            buildDefaults: {
                lexicalProfile: true,
                strictReranker: true,
                graphPpr: true,
                relaxedRecovery: true,
            },
        });
        expect(Object.isFrozen(B125_RETRIEVAL_OPTIMIZATION_ROLLOUT_PROFILE)).toBe(true);
        expect(Object.isFrozen(B125_RETRIEVAL_OPTIMIZATION_ROLLOUT_PROFILE.authority)).toBe(true);
        expect(Object.isFrozen(B125_RETRIEVAL_OPTIMIZATION_ROLLOUT_PROFILE.buildDefaults)).toBe(true);
        for (const platform of [
            MACOS_PLATFORM,
            runtimePlatform({ isLinux: true }),
            runtimePlatform({ isIos: true }),
        ]) {
            expect(isB125RetrievalOptimizationPlatformSupported(platform)).toBe(true);
            for (const rawFlags of [undefined, {}]) {
                expect(resolveB125RetrievalOptimizationFlags(rawFlags, platform)).toEqual({
                    lexicalProfile: true,
                    strictReranker: true,
                    graphPpr: true,
                    relaxedRecovery: true,
                });
            }
        }
    });

    it("preserves explicit per-flag boolean overrides and does not mutate sparse settings", () => {
        const persisted = {
            lexicalProfile: false,
            strictReranker: true,
        };

        expect(resolveB125RetrievalOptimizationFlags(persisted, MACOS_PLATFORM)).toEqual({
            lexicalProfile: false,
            strictReranker: true,
            graphPpr: true,
            relaxedRecovery: true,
        });
        expect(persisted).toEqual({
            lexicalProfile: false,
            strictReranker: true,
        });
    });

    it("falls back per field for missing or invalid raw values", () => {
        const persisted = {
            lexicalProfile: false,
            strictReranker: "invalid",
            graphPpr: null,
            relaxedRecovery: 0,
        } as unknown as Parameters<typeof resolveB125RetrievalOptimizationFlags>[0];

        expect(resolveB125RetrievalOptimizationFlags(persisted, MACOS_PLATFORM)).toEqual({
            lexicalProfile: false,
            strictReranker: true,
            graphPpr: true,
            relaxedRecovery: true,
        });
        expect(persisted).toEqual({
            lexicalProfile: false,
            strictReranker: "invalid",
            graphPpr: null,
            relaxedRecovery: 0,
        });
    });

    it("preserves explicitly enabled flags on supported platforms", () => {
        expect(resolveB125RetrievalOptimizationFlags({
            lexicalProfile: true,
            strictReranker: true,
            graphPpr: true,
            relaxedRecovery: true,
        }, MACOS_PLATFORM)).toEqual({
            lexicalProfile: true,
            strictReranker: true,
            graphPpr: true,
            relaxedRecovery: true,
        });
    });

    it("forces every B-125 flag off on Windows without mutating persisted settings", () => {
        const persisted = {
            lexicalProfile: true,
            strictReranker: true,
            graphPpr: true,
            relaxedRecovery: true,
        };

        const windowsPlatform = runtimePlatform({ isWindows: true, isMacOS: true });
        expect(isB125RetrievalOptimizationPlatformSupported(windowsPlatform)).toBe(false);
        expect(resolveB125RetrievalOptimizationFlags(persisted, windowsPlatform)).toEqual({
            lexicalProfile: false,
            strictReranker: false,
            graphPpr: false,
            relaxedRecovery: false,
        });
        expect(persisted).toEqual({
            lexicalProfile: true,
            strictReranker: true,
            graphPpr: true,
            relaxedRecovery: true,
        });
        expect(B125_WINDOWS_SUPPORT_WAIVER_ID).toBe(
            "B-125-WIN32-TEMPORARY-SUPPORT-WAIVER-2026-08-13",
        );
    });

    it("forces every B-125 flag off on Android without mutating persisted settings", () => {
        const persisted = {
            lexicalProfile: false,
            strictReranker: true,
        };

        const androidPlatform = runtimePlatform({ isAndroid: true, isIos: true });
        expect(isB125RetrievalOptimizationPlatformSupported(androidPlatform)).toBe(false);
        expect(resolveB125RetrievalOptimizationFlags(persisted, androidPlatform)).toEqual({
            lexicalProfile: false,
            strictReranker: false,
            graphPpr: false,
            relaxedRecovery: false,
        });
        expect(persisted).toEqual({
            lexicalProfile: false,
            strictReranker: true,
        });
        expect(B125_ANDROID_SUPPORT_WAIVER_ID).toBe(
            "B-125-ANDROID-TEMPORARY-SUPPORT-WAIVER-2026-09-04",
        );
    });

    it("returns a content-free identity-bound policy snapshot", () => {
        const snapshot = resolveB125RetrievalOptimizationPolicySnapshot({
            lexicalProfile: false,
        }, MACOS_PLATFORM);

        expect(snapshot).toEqual({
            rolloutId: "b125-retrieval-optimization-rollout",
            rolloutVersion: 1,
            authority: {
                featureId: "B-125",
                sourceDecisionId: "DEC-027",
                decisionId: "DEC-031",
                ownerApprovalDate: "2026-09-04",
            },
            platformSupported: true,
            platformMask: "none",
            effectiveFlags: {
                lexicalProfile: false,
                strictReranker: true,
                graphPpr: true,
                relaxedRecovery: true,
            },
        });
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot.effectiveFlags)).toBe(true);
        expect(resolveB125RetrievalOptimizationPolicySnapshot(
            undefined,
            runtimePlatform({ isWindows: true }),
        )).toMatchObject({
            platformSupported: false,
            platformMask: "windows",
        });
        expect(resolveB125RetrievalOptimizationPolicySnapshot(
            undefined,
            runtimePlatform({ isAndroid: true }),
        )).toMatchObject({
            platformSupported: false,
            platformMask: "android",
        });
    });

    it("fails closed on an unknown or incomplete runtime platform identity", () => {
        const unknownPlatform = runtimePlatform();

        expect(isB125RetrievalOptimizationPlatformSupported(unknownPlatform)).toBe(false);
        expect(resolveB125RetrievalOptimizationPolicySnapshot(undefined, unknownPlatform)).toEqual(
            expect.objectContaining({
                platformSupported: false,
                platformMask: "unsupported",
                effectiveFlags: {
                    lexicalProfile: false,
                    strictReranker: false,
                    graphPpr: false,
                    relaxedRecovery: false,
                },
            }),
        );
    });

    it("applies every unsupported-platform mask before missing, partial, or all-true raw flags", () => {
        const platformCases: Array<[
            string,
            B125RetrievalOptimizationRuntimePlatform,
            "windows" | "android" | "unsupported",
        ]> = [
            ["windows", runtimePlatform({ isWindows: true }), "windows"],
            ["android", runtimePlatform({ isAndroid: true }), "android"],
            ["unknown", runtimePlatform(), "unsupported"],
            [
                "incomplete",
                { isWindows: false, isAndroid: false } as B125RetrievalOptimizationRuntimePlatform,
                "unsupported",
            ],
        ];
        const rawCases = [
            undefined,
            { strictReranker: true },
            {
                lexicalProfile: true,
                strictReranker: true,
                graphPpr: true,
                relaxedRecovery: true,
            },
        ];

        for (const [, platform, expectedMask] of platformCases) {
            for (const rawFlags of rawCases) {
                const before = rawFlags ? { ...rawFlags } : rawFlags;
                expect(resolveB125RetrievalOptimizationPolicySnapshot(rawFlags, platform)).toMatchObject({
                    platformSupported: false,
                    platformMask: expectedMask,
                    effectiveFlags: {
                        lexicalProfile: false,
                        strictReranker: false,
                        graphPpr: false,
                        relaxedRecovery: false,
                    },
                });
                expect(rawFlags).toEqual(before);
            }
        }
    });

    it("uses Obsidian platform identity in the production default path", () => {
        const originalPlatform = {
            isWin: Platform.isWin,
            isAndroidApp: Platform.isAndroidApp,
            isMacOS: Platform.isMacOS,
            isLinux: Platform.isLinux,
            isIosApp: Platform.isIosApp,
        };
        Platform.isWin = true;
        Platform.isAndroidApp = false;
        Platform.isMacOS = true;
        Platform.isLinux = false;
        Platform.isIosApp = false;
        try {
            expect(isB125RetrievalOptimizationPlatformSupported()).toBe(false);
            expect(resolveB125RetrievalOptimizationFlags({
                lexicalProfile: true,
                strictReranker: true,
                graphPpr: true,
                relaxedRecovery: true,
            })).toEqual({
                lexicalProfile: false,
                strictReranker: false,
                graphPpr: false,
                relaxedRecovery: false,
            });
        } finally {
            Platform.isWin = false;
            Platform.isAndroidApp = true;
            Platform.isMacOS = false;
            Platform.isLinux = false;
            Platform.isIosApp = true;
        }

        try {
            expect(isB125RetrievalOptimizationPlatformSupported()).toBe(false);
            expect(resolveB125RetrievalOptimizationPolicySnapshot(undefined)).toMatchObject({
                platformSupported: false,
                platformMask: "android",
            });
        } finally {
            Platform.isWin = false;
            Platform.isAndroidApp = false;
            Platform.isMacOS = false;
            Platform.isLinux = false;
            Platform.isIosApp = false;
        }

        try {
            expect(isB125RetrievalOptimizationPlatformSupported()).toBe(false);
            expect(resolveB125RetrievalOptimizationPolicySnapshot(undefined)).toMatchObject({
                platformSupported: false,
                platformMask: "unsupported",
            });
        } finally {
            Platform.isWin = originalPlatform.isWin;
            Platform.isAndroidApp = originalPlatform.isAndroidApp;
            Platform.isMacOS = originalPlatform.isMacOS;
            Platform.isLinux = originalPlatform.isLinux;
            Platform.isIosApp = originalPlatform.isIosApp;
        }
    });
});

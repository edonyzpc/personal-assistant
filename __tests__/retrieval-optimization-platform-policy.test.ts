import { describe, expect, it } from "@jest/globals";
import { Platform } from "obsidian";

import {
    B125_WINDOWS_SUPPORT_WAIVER_ID,
    isB125RetrievalOptimizationPlatformSupported,
    resolveB125RetrievalOptimizationFlags,
} from "../src/retrieval-optimization-platform-policy";

describe("B-125 retrieval optimization platform policy", () => {
    it("preserves enabled flags on supported platforms", () => {
        expect(isB125RetrievalOptimizationPlatformSupported(false)).toBe(true);
        expect(resolveB125RetrievalOptimizationFlags({
            lexicalProfile: true,
            strictReranker: true,
            graphPpr: true,
            relaxedRecovery: true,
        }, false)).toEqual({
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

        expect(isB125RetrievalOptimizationPlatformSupported(true)).toBe(false);
        expect(resolveB125RetrievalOptimizationFlags(persisted, true)).toEqual({
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

    it("uses Obsidian Platform.isWin in the production default path", () => {
        const originalIsWin = Platform.isWin;
        Platform.isWin = true;
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
            Platform.isWin = originalIsWin;
        }
    });
});

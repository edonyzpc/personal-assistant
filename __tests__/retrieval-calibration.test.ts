import { describe, expect, it } from "@jest/globals";

import {
    RETRIEVAL_CALIBRATION_PROFILE,
    isValidRetrievalSearchRuntimeParameters,
    selectRetrievalSearchRuntimeParameters,
} from "../src/vss/retrieval-calibration";

describe("EC-02 retrieval calibration profile", () => {
    it("freezes the provisional default-off standard candidate identity", () => {
        expect(RETRIEVAL_CALIBRATION_PROFILE).toMatchObject({
            id: "ec02-char-phrase-runtime-v1",
            version: 1,
            provisional: true,
            defaultEnabled: false,
            offlineWinnerId: "clause_OR/body_favor/compact/k30_equal",
        });
        expect(RETRIEVAL_CALIBRATION_PROFILE.candidate.standard).toEqual({
            profileId: "ec02-char-phrase-runtime-v1",
            profileVersion: 1,
            variant: "candidate",
            mode: "standard",
            provisional: true,
            evidence: "offline_provisional_winner",
            vectorRaw: 8,
            lexicalRaw: 12,
            fusionRaw: 18,
            queryMode: "clause_OR",
            bm25Weights: [1.25, 1.25, 2, 0.25],
            rrf: { k: 30, sourceWeights: [1, 1] },
        });
    });

    it("keeps flag-off baseline and relaxed evidence explicit", () => {
        expect(selectRetrievalSearchRuntimeParameters(false, "standard")).toMatchObject({
            variant: "baseline",
            vectorRaw: 8,
            lexicalRaw: 8,
            fusionRaw: 12,
            queryMode: "strict_AND",
            bm25Weights: [1, 1, 1, 1],
            rrf: { k: 60, sourceWeights: [1, 1] },
        });
        expect(selectRetrievalSearchRuntimeParameters(true, "relaxed")).toMatchObject({
            variant: "candidate",
            mode: "relaxed",
            evidence: "inherited_unvalidated",
            vectorRaw: 12,
            lexicalRaw: 12,
            fusionRaw: 18,
            queryMode: "strict_AND",
        });
    });

    it("accepts only registered versioned parameter sets", () => {
        const candidate = RETRIEVAL_CALIBRATION_PROFILE.candidate.standard;
        expect(isValidRetrievalSearchRuntimeParameters(candidate)).toBe(true);
        expect(isValidRetrievalSearchRuntimeParameters({
            ...candidate,
            lexicalRaw: candidate.lexicalRaw + 1,
        })).toBe(false);
        expect(isValidRetrievalSearchRuntimeParameters({
            ...candidate,
            profileVersion: candidate.profileVersion + 1,
        })).toBe(false);
    });

    it("centralizes inherited graph and lexical runtime envelopes without approving them", () => {
        expect(RETRIEVAL_CALIBRATION_PROFILE.graph).toMatchObject({
            evidence: "inherited_unvalidated",
            budgetMs: 8_000,
            laneTopN: 12,
            probeTopN: 30,
            maxPathsPerBatch: 64,
            maxCandidatePaths: 512,
            maxChunksScanned: 6_000,
            cosine: { standard: 0.3, relaxed: 0.2 },
        });
        expect(RETRIEVAL_CALIBRATION_PROFILE.lexicalRuntime).toEqual({
            evidence: "inherited_unvalidated",
            searchBudgetMs: 500,
            rebuildBatchSize: 128,
            maxRebuildBatchSize: 256,
            sqliteProgressOperationInterval: 1_000,
        });
    });
});

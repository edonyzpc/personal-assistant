import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from '@jest/globals';

interface CalibrationReport {
    fixture: { fingerprint: string; cases: number; holdouts: number };
    runtimeCalibration: {
        profileId: string;
        profileVersion: number;
        provisional: boolean;
        defaultEnabled: boolean;
        offlineWinnerId: string;
        queryInputContract: string;
        standardCandidate: {
            profileId: string;
            profileVersion: number;
            variant: string;
            mode: string;
            provisional: boolean;
            evidence: string;
            vectorRaw: number;
            lexicalRaw: number;
            fusionRaw: number;
            queryMode: string;
            bm25Weights: number[];
            rrf: { k: number; sourceWeights: number[] };
        };
        relaxedEvidence: string;
    };
    integrity: {
        passed: boolean;
        allRrfSourcePermutationsStable: boolean;
        orUplifts: string[];
        longNotePressure: string[];
        collisionHits: string[];
        sensitivity: Record<string, boolean>;
    };
    pipeline: {
        order: string[];
        scoreThreshold: number;
        thresholdAppliedTo: string;
        directPathCap: number;
        finalProxyCap: number;
    };
    gridDefinition: { configurations: number; holdoutUsedForSelection: boolean };
    gridResults: Array<{ configId: string; meanThresholdRemoved: number; sourcePermutationStable: boolean }>;
    queryEvidence: Array<{
        caseId: string;
        mode: string;
        expression: string;
        cjkRunPhrasesPreserved: boolean;
        topLevelShapeValid: boolean;
    }>;
    provisionalCandidates: Array<{ config: FrozenWinnerConfig }>;
    bestProvisionalConfig: FrozenWinnerConfig;
    caseEvidence: Array<{
        caseId: string;
        lexical: { rawChunkCount: number; pathCount: number; duplicateChunkRatio: number };
        stageCounts: { directPaths: number; finalProxyPaths: number };
    }>;
    interpretationBoundary: string;
}

interface FrozenWinnerConfig {
    id: string;
    queryMode: string;
    bm25: { id: string; title: number; heading: number; body: number; path: number };
    depth: { id: string; vectorRaw: number; lexicalRaw: number; fusionRaw: number };
    rrf: { id: string; k: number; vectorWeight: number; lexicalWeight: number };
}

const FROZEN_PROVISIONAL_WINNER: FrozenWinnerConfig = {
    id: 'clause_OR/body_favor/compact/k30_equal',
    queryMode: 'clause_OR',
    bm25: { id: 'body_favor', title: 1.25, heading: 1.25, body: 2, path: 0.25 },
    depth: { id: 'compact', vectorRaw: 8, lexicalRaw: 12, fusionRaw: 18 },
    rrf: { id: 'k30_equal', k: 30, vectorWeight: 1, lexicalWeight: 1 },
};

describe('Phase 0B EC-02 offline calibration evidence', () => {
    it('runs the real sqlite-wasm grid through the frozen bounded pipeline', () => {
        const repositoryRoot = resolve(__dirname, '..');
        const result = spawnSync(
            process.execPath,
            ['scripts/fts-evidence-calibration.mjs', '--json', '--top=3'],
            {
                cwd: repositoryRoot,
                encoding: 'utf8',
                maxBuffer: 8 * 1024 * 1024,
            },
        );

        expect(result.status).toBe(0);
        expect(result.error).toBeUndefined();
        const report = JSON.parse(result.stdout) as CalibrationReport;

        expect(report.fixture).toMatchObject({
            fingerprint: 'b1cdd4c1b61de7c54a53efbb61c178362bf1914e4185739ea1975a8a7efee2a5',
            cases: 14,
            holdouts: 4,
        });
        expect(report.runtimeCalibration).toEqual({
            profileId: 'ec02-char-phrase-runtime-v1',
            profileVersion: 1,
            provisional: true,
            defaultEnabled: false,
            offlineWinnerId: 'clause_OR/body_favor/compact/k30_equal',
            queryInputContract: 'fixture.query through production buildFtsQuery(string, mode)',
            standardCandidate: {
                profileId: 'ec02-char-phrase-runtime-v1',
                profileVersion: 1,
                variant: 'candidate',
                mode: 'standard',
                provisional: true,
                evidence: 'offline_provisional_winner',
                vectorRaw: 8,
                lexicalRaw: 12,
                fusionRaw: 18,
                queryMode: 'clause_OR',
                bm25Weights: [1.25, 1.25, 2, 0.25],
                rrf: { k: 30, sourceWeights: [1, 1] },
            },
            relaxedEvidence: 'inherited_unvalidated',
        });
        expect(report.integrity.passed).toBe(true);
        expect(report.integrity.allRrfSourcePermutationsStable).toBe(true);
        expect(report.integrity.orUplifts.length).toBeGreaterThanOrEqual(2);
        expect(report.integrity.longNotePressure).toHaveLength(2);
        expect(report.integrity.collisionHits.length).toBeGreaterThanOrEqual(3);
        expect(report.integrity.sensitivity).toEqual({
            queryMode: true,
            bm25: true,
            depth: true,
            rrf: true,
        });

        expect(report.pipeline).toMatchObject({
            order: [
                'rrf_raw_chunks',
                'score_threshold_0.01',
                'canonical_path_collapse',
                'direct_cap_12',
                'fixture_relevance_proxy_cap_8',
            ],
            scoreThreshold: 0.01,
            thresholdAppliedTo: 'unrounded RRF score',
            directPathCap: 12,
            finalProxyCap: 8,
        });
        expect(report.gridDefinition).toMatchObject({
            configurations: 120,
            holdoutUsedForSelection: false,
        });
        expect(report.gridResults).toHaveLength(120);
        expect(report.gridResults[0]?.configId).toBe(FROZEN_PROVISIONAL_WINNER.id);
        expect(report.gridResults.every((entry) => entry.sourcePermutationStable)).toBe(true);
        expect(report.gridResults.some((entry) => entry.meanThresholdRemoved > 0)).toBe(true);
        expect(report.provisionalCandidates).toHaveLength(3);
        expect(report.provisionalCandidates[0]?.config).toEqual(FROZEN_PROVISIONAL_WINNER);
        expect(report.bestProvisionalConfig).toEqual(FROZEN_PROVISIONAL_WINNER);

        const orQuery = report.queryEvidence.find((entry) => (
            entry.caseId === 'or-travel-invoice' && entry.mode === 'clause_OR'
        ));
        expect(orQuery).toMatchObject({
            cjkRunPhrasesPreserved: true,
            topLevelShapeValid: true,
        });
        expect(orQuery?.expression).toContain(' OR ');
        expect(orQuery?.expression).toMatch(/"c[0-9a-f]+ c[0-9a-f]+/u);

        const longNote = report.caseEvidence.find((entry) => entry.caseId === 'long-note-coffee');
        expect(longNote?.lexical.rawChunkCount).toBeGreaterThan(longNote?.lexical.pathCount ?? 0);
        expect(longNote?.lexical.duplicateChunkRatio).toBeGreaterThan(0.5);
        expect(longNote?.stageCounts.directPaths).toBeLessThanOrEqual(12);
        expect(longNote?.stageCounts.finalProxyPaths).toBeLessThanOrEqual(8);
        expect(report.interpretationBoundary).toMatch(/provisional offline evidence/u);
        expect(report.interpretationBoundary).toMatch(/slowest-supported-device/u);
    }, 30_000);
});

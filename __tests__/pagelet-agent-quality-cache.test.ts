import { describe, expect, it, jest } from '@jest/globals';

import {
    PageletAgentCache,
    createPageletAgentCacheIdentity,
    createPageletInsightCollectionId,
    createPageletInsightId,
    hashPageletInsightBody,
    hashPageletInsightClaim,
    hashPageletAgentCacheIdentity,
    normalizePageletInsightBody,
    normalizePageletInsightClaim,
    pageletAgentPolicyIdentityKey,
} from '../src/pagelet/agent/pagelet-agent-cache';
import {
    arePageletAgentInsightsDistinct,
    classifyPageletInsightSourceSupport,
    evaluatePageletAgentQuality,
} from '../src/pagelet/agent/pagelet-agent-quality-gate';
import {
    PageletDeepDiscoverController,
    pageletDeepDiscoverCommitSealIsCurrent,
} from '../src/pagelet/agent/pagelet-deep-discover-controller';
import { PageletDeepDiscoverScheduler } from '../src/pagelet/agent/pagelet-deep-discover-scheduler';
import { pageletAgentInsightToDeliveryCandidate } from '../src/pagelet/agent/delivery-adapter';
import type {
    PageletAgentPolicyIdentity,
    PageletAgentRunResult,
    PageletAgentSourceMaterial,
    PageletAgentSourceSnapshot,
    PageletAgentVerifiedInsight,
    PageletAnchorSnapshot,
    PageletDeepDiscoverControllerResult,
} from '../src/pagelet/agent/types';

const anchor: PageletAnchorSnapshot = {
    path: 'notes/anchor.md',
    content: '# Anchor\n验证反馈后再发布',
    mtime: 10,
    size: 22,
    contentHash: 'a'.repeat(64),
    capturedAt: 100,
};
const relatedMaterial: PageletAgentSourceMaterial = {
    path: 'notes/related.md',
    content: '# Related\n直接发布会放大风险',
    mtime: 11,
    size: 24,
    contentHash: 'b'.repeat(64),
    capturedAt: 101,
};
const anchorMaterial: PageletAgentSourceMaterial = {
    ...anchor,
};
const policyIdentity: PageletAgentPolicyIdentity = {
    dataBoundaryIdentity: 'boundary-1',
    providerPolicyIdentity: 'provider-policy-1',
    modelIdentity: 'provider:test-model',
    locale: 'zh',
};

function snapshots(): PageletAgentSourceSnapshot[] {
    return [
        {
            path: anchor.path,
            mtime: anchor.mtime,
            size: anchor.size,
            contentHash: anchor.contentHash,
        },
        {
            path: relatedMaterial.path,
            mtime: relatedMaterial.mtime,
            size: relatedMaterial.size,
            contentHash: relatedMaterial.contentHash,
        },
    ];
}

function makeRun(finalText: string): PageletAgentRunResult {
    return {
        loopResult: {
            status: 'completed',
            transcript: [],
            committedFinalText: finalText,
            turns: [],
        },
        finalText,
        anchor,
        sourceSnapshots: snapshots(),
        sourceTools: new Map([
            [anchor.path, new Set(['get_current_note_context'])],
            [relatedMaterial.path, new Set(['inspect_obsidian_note'])],
        ]),
        toolProvenance: [
            {
                toolName: 'get_current_note_context',
                sourceRecords: [{
                    kind: 'context-used',
                    dedupKey: anchor.path,
                    path: anchor.path,
                }],
                isError: false,
                promptText: anchor.content,
            },
            {
                toolName: 'inspect_obsidian_note',
                sourceRecords: [{
                    kind: 'context-used',
                    dedupKey: relatedMaterial.path,
                    path: relatedMaterial.path,
                }],
                isError: false,
                promptText: relatedMaterial.content,
            },
        ],
        webObservations: [],
        metrics: { modelTurns: 2, toolCalls: 2, wallTimeMs: 100 },
        runtimeCompletion: {
            loopStatus: 'completed',
            endReason: 'final_text_ready',
            diagnosticTypes: [],
            lastTurnStatus: null,
            providerStopReason: null,
            finalTextState: 'candidate',
            citationCoverage: 'complete',
            turnCount: 0,
            toolCallCount: 0,
            insightDraftCount: 1,
            emptyFinalAnswerRetryCount: 0,
        },
    };
}

function materials(): Map<string, PageletAgentSourceMaterial> {
    return new Map([
        [anchor.path, anchorMaterial],
        [relatedMaterial.path, relatedMaterial],
    ]);
}

describe('Pagelet agent quality gate', () => {
    it('rejects a repeated/detail-expanded second claim while allowing independent evidence', () => {
        const sources = snapshots();
        expect(arePageletAgentInsightsDistinct(
            { normalizedBody: '发布策略存在风险冲突', sources },
            { normalizedBody: '发布策略存在风险冲突并需要继续关注', sources },
        )).toBe(false);
        expect(arePageletAgentInsightsDistinct(
            { normalizedBody: '发布策略存在风险冲突', sources },
            { normalizedBody: '回滚检查点缺失导致行动无法撤销', sources },
        )).toBe(true);
        expect(arePageletAgentInsightsDistinct(
            {
                normalizedBody: 'Release rollback risk grows because deployment validation is missing',
                sources,
            },
            {
                normalizedBody: 'Missing deployment validation increases release rollback risk',
                sources,
            },
        )).toBe(false);
    });

    it('accepts a current, cross-note, path-grounded and evidence-supported finding', async () => {
        const run = makeRun([
            '## 发布策略存在风险缺口',
            '`notes/anchor.md` 要求验证反馈后再发布；',
            '`notes/related.md` 的直接发布会放大风险，因此两者的发布假设发生冲突。',
        ].join('\n'));
        const result = await evaluatePageletAgentQuality({
            run,
            sourceMaterials: materials(),
            readCurrentSourceSnapshot: async (path) => snapshots().find((source) => source.path === path) ?? null,
            isPathAllowed: () => true,
        });

        expect(result).toMatchObject({
            accepted: true,
            sourceRefs: [
                { path: 'notes/anchor.md' },
                { path: 'notes/related.md' },
            ],
        });
    });

    it('rejects only an explicit numbered Insight 1/2 heading bundle, not one numbered heading', async () => {
        const single = makeRun([
            '## 洞察 1：发布策略存在风险缺口',
            '`notes/anchor.md` 要求验证反馈后再发布；',
            '`notes/related.md` 的直接发布会放大风险，因此发布假设发生冲突。',
        ].join('\n'));
        const singleResult = await evaluatePageletAgentQuality({
            run: single,
            sourceMaterials: materials(),
            readCurrentSourceSnapshot: async (path) => (
                snapshots().find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
        });
        expect(singleResult.accepted).toBe(true);

        const bundled = makeRun([
            '## 洞察 1：发布策略存在风险缺口',
            '`notes/anchor.md` 要求验证反馈后再发布；',
            '`notes/related.md` 的直接发布会放大风险，因此发布假设发生冲突。',
            '',
            '## Insight 2: rollback checkpoint gap',
            '`notes/anchor.md` 的验证反馈没有形成回滚检查点；',
            '`notes/related.md` 说明直接发布会放大行动风险。',
        ].join('\n'));
        await expect(evaluatePageletAgentQuality({
            run: bundled,
            sourceMaterials: materials(),
            readCurrentSourceSnapshot: async (path) => (
                snapshots().find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
        })).resolves.toEqual({ accepted: false, reason: 'bundled-insights' });
    });

    it('matches supplementary-plane Han evidence by Unicode code point', async () => {
        const astralAnchor: PageletAnchorSnapshot = {
            ...anchor,
            content: '# Anchor\n𠮷野家的上线验证仍缺失',
        };
        const astralRelated: PageletAgentSourceMaterial = {
            ...relatedMaterial,
            content: '# Related\n𠮷野家的回滚风险正在增加',
        };
        const run = makeRun([
            '## 𠮷野家上线存在回滚风险',
            '`notes/anchor.md` 显示𠮷野家的上线验证仍缺失；',
            '`notes/related.md` 显示𠮷野家的回滚风险增加，因此两者揭示同一行动缺口。',
        ].join('\n'));
        run.anchor = astralAnchor;
        run.sourceSnapshots = [
            { ...astralAnchor },
            {
                path: astralRelated.path,
                mtime: astralRelated.mtime,
                size: astralRelated.size,
                contentHash: astralRelated.contentHash,
            },
        ];

        const quality = await evaluatePageletAgentQuality({
            run,
            sourceMaterials: new Map([
                [astralAnchor.path, astralAnchor],
                [astralRelated.path, astralRelated],
            ]),
            readCurrentSourceSnapshot: async (path) => (
                run.sourceSnapshots.find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
        });

        expect(quality.accepted).toBe(true);
    });

    it('rejects ungrounded paths and shallow existing-link restatements', async () => {
        const ungroundedRun = makeRun(
            '`notes/anchor.md` 与 `notes/related.md` 有冲突，但 `notes/missing.md` 才是关键风险。',
        );
        const ungrounded = await evaluatePageletAgentQuality({
            run: ungroundedRun,
            sourceMaterials: materials(),
            readCurrentSourceSnapshot: async (path) => snapshots().find((source) => source.path === path) ?? null,
            isPathAllowed: () => true,
        });
        expect(ungrounded).toEqual({ accepted: false, reason: 'ungrounded-path' });

        const shallowAnchor: PageletAnchorSnapshot = {
            ...anchor,
            content: '# Anchor\n蓝色标签',
            size: 17,
            contentHash: '7'.repeat(64),
        };
        const shallowRelated: PageletAgentSourceMaterial = {
            ...relatedMaterial,
            content: '# Related\n蓝色标签',
            size: 18,
            contentHash: '8'.repeat(64),
        };
        const makeShallowRun = (body: string) => {
            const run = makeRun(body);
            run.anchor = shallowAnchor;
            run.sourceSnapshots = [shallowAnchor, shallowRelated].map((source) => ({
                path: source.path,
                mtime: source.mtime,
                size: source.size,
                contentHash: source.contentHash,
            }));
            run.toolProvenance = [
                {
                    ...run.toolProvenance[0]!,
                    promptText: shallowAnchor.content,
                },
                {
                    ...run.toolProvenance[1]!,
                    promptText: shallowRelated.content,
                },
            ];
            return run;
        };
        const shallowMaterials = new Map<string, PageletAgentSourceMaterial>([
            [shallowAnchor.path, shallowAnchor],
            [shallowRelated.path, shallowRelated],
        ]);
        const shallowRun = makeShallowRun([
            '`notes/anchor.md` 写有蓝色标签；',
            '`notes/related.md` 也写有蓝色标签。',
        ].join('\n'));
        const shallow = await evaluatePageletAgentQuality({
            run: shallowRun,
            sourceMaterials: shallowMaterials,
            readCurrentSourceSnapshot: async (path) => (
                shallowRun.sourceSnapshots.find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
            anchorRelations: { explicitLinks: ['notes/related.md'] },
        });
        expect(shallow).toEqual({ accepted: false, reason: 'shallow-link' });

        const shallowCauseTerms = await evaluatePageletAgentQuality({
            run: makeShallowRun([
                '`notes/anchor.md` 写有蓝色标签；',
                '`notes/related.md` 也写有蓝色标签，两者都提到故障原因和采样缺陷。',
            ].join('\n')),
            sourceMaterials: shallowMaterials,
            readCurrentSourceSnapshot: async (path) => (
                shallowRun.sourceSnapshots.find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
            anchorRelations: { explicitLinks: ['notes/related.md'] },
        });
        expect(shallowCauseTerms).toEqual({ accepted: false, reason: 'shallow-link' });
    });

    it('resolves explicit paths containing spaces without rescanning their inner basename', async () => {
        const spacedAnchor: PageletAnchorSnapshot = {
            ...anchor,
            path: 'notes/anchor note.md',
        };
        const spacedRelated: PageletAgentSourceMaterial = {
            ...relatedMaterial,
            path: 'notes/related note.md',
        };
        const run = makeRun([
            '`notes/anchor note.md` 要求验证反馈后再发布；',
            '[[notes/related note|关联笔记]] 的直接发布会放大风险；',
            '[同一关联来源](notes/related note.md) 因此证明发布假设发生冲突。',
        ].join('\n'));
        run.anchor = spacedAnchor;
        run.sourceSnapshots = [
            { ...spacedAnchor },
            {
                path: spacedRelated.path,
                mtime: spacedRelated.mtime,
                size: spacedRelated.size,
                contentHash: spacedRelated.contentHash,
            },
        ];
        run.sourceTools = new Map([
            [spacedAnchor.path, new Set(['get_current_note_context'])],
            [spacedRelated.path, new Set(['inspect_obsidian_note'])],
        ]);
        run.toolProvenance = [
            {
                ...run.toolProvenance[0]!,
                sourceRecords: [{
                    kind: 'context-used',
                    dedupKey: spacedAnchor.path,
                    path: spacedAnchor.path,
                }],
            },
            {
                ...run.toolProvenance[1]!,
                sourceRecords: [{
                    kind: 'context-used',
                    dedupKey: spacedRelated.path,
                    path: spacedRelated.path,
                }],
            },
        ];
        const spacedSnapshots = run.sourceSnapshots;
        const result = await evaluatePageletAgentQuality({
            run,
            sourceMaterials: new Map([
                [spacedAnchor.path, spacedAnchor],
                [spacedRelated.path, spacedRelated],
            ]),
            readCurrentSourceSnapshot: async (path) => (
                spacedSnapshots.find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
        });

        expect(result).toMatchObject({
            accepted: true,
            sourceRefs: [
                { path: 'notes/anchor note.md' },
                { path: 'notes/related note.md' },
            ],
        });
    });

    it('rejects unknown spaced paths and does not fall back from a fake directory to a basename', async () => {
        const unknownSpaced = await evaluatePageletAgentQuality({
            run: makeRun(
                '`notes/anchor.md` 与 `notes/related.md` 有冲突，但 `notes/missing note.md` 才是关键风险。',
            ),
            sourceMaterials: materials(),
            readCurrentSourceSnapshot: async (path) => (
                snapshots().find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
        });
        expect(unknownSpaced).toEqual({ accepted: false, reason: 'ungrounded-path' });

        const fakeDirectory = await evaluatePageletAgentQuality({
            run: makeRun(
                '`fake/anchor.md` 与 `notes/related.md` 的发布策略存在风险冲突。',
            ),
            sourceMaterials: materials(),
            readCurrentSourceSnapshot: async (path) => (
                snapshots().find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
        });
        expect(fakeDirectory).toEqual({ accepted: false, reason: 'ungrounded-path' });
    });

    it('does not let malformed inline-code or emphasis path mentions bypass grounding', async () => {
        const malformedInlineCode = await evaluatePageletAgentQuality({
            run: makeRun(
                '`notes/anchor.md` 与 `notes/related.md` 有冲突，但 `notes/missing.md,` 可能改变结论。',
            ),
            sourceMaterials: materials(),
            readCurrentSourceSnapshot: async (path) => (
                snapshots().find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
        });
        expect(malformedInlineCode).toEqual({
            accepted: false,
            reason: 'ungrounded-path',
        });

        const emphasized = await evaluatePageletAgentQuality({
            run: makeRun(
                '`notes/anchor.md` 与 `notes/related.md` 有冲突，但 **notes/missing.md** 可能改变结论。',
            ),
            sourceMaterials: materials(),
            readCurrentSourceSnapshot: async (path) => (
                snapshots().find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
        });
        expect(emphasized).toEqual({
            accepted: false,
            reason: 'ungrounded-path',
        });

        const codeInLinkLabel = await evaluatePageletAgentQuality({
            run: makeRun(
                '[参见 `notes/anchor.md`](<notes/missing note.md>) 与 `notes/related.md` 的发布冲突。',
            ),
            sourceMaterials: materials(),
            readCurrentSourceSnapshot: async (path) => (
                snapshots().find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
        });
        expect(codeInLinkLabel).toEqual({
            accepted: false,
            reason: 'ungrounded-path',
        });

        const bareFragment = await evaluatePageletAgentQuality({
            run: makeRun(
                '`notes/anchor.md` 与 `notes/related.md` 有冲突，notes/missing.md#结论也被提及。',
            ),
            sourceMaterials: materials(),
            readCurrentSourceSnapshot: async (path) => (
                snapshots().find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
        });
        expect(bareFragment).toEqual({
            accepted: false,
            reason: 'ungrounded-path',
        });

        for (const groundedBareModifier of [
            'notes/anchor.md#验证 反馈后再发布',
            'notes/anchor.md|验证 反馈后再发布',
        ]) {
            const result = await evaluatePageletAgentQuality({
                run: makeRun([
                    groundedBareModifier,
                    '`notes/related.md` 说明直接发布会放大风险，因此两者存在冲突。',
                ].join('\n')),
                sourceMaterials: materials(),
                readCurrentSourceSnapshot: async (path) => (
                    snapshots().find((source) => source.path === path) ?? null
                ),
                isPathAllowed: () => true,
            });
            expect(result).toEqual({
                accepted: false,
                reason: 'ungrounded-path',
            });
        }

        for (const hiddenPath of [
            '`Source: notes/missing.md`',
            'source:notes/missing.md',
            'notes/missing.md#',
            'notes/missing.md|',
            'notes/missing.md#foo|',
            '__notes/missing.md__',
            '_notes/missing.md_',
            '__notes/missing_file.md__',
            '_notes/missing_file.md_',
        ]) {
            const hidden = await evaluatePageletAgentQuality({
                run: makeRun(
                    `\`notes/anchor.md\` 与 \`notes/related.md\` 有冲突，另见 ${hiddenPath}。`,
                ),
                sourceMaterials: materials(),
                readCurrentSourceSnapshot: async (path) => (
                    snapshots().find((source) => source.path === path) ?? null
                ),
                isPathAllowed: () => true,
            });
            expect(hidden).toEqual({
                accepted: false,
                reason: 'ungrounded-path',
            });
        }
    });

    it('supports unique short wikilinks and rejects ambiguous basenames', async () => {
        const unique = await evaluatePageletAgentQuality({
            run: makeRun(
                '[[anchor]] 要求验证反馈后再发布；[[related]] 的直接发布会放大风险，因此发布假设发生冲突。',
            ),
            sourceMaterials: materials(),
            readCurrentSourceSnapshot: async (path) => (
                snapshots().find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
        });
        expect(unique.accepted).toBe(true);

        const ambiguousRun = makeRun(
            '[[anchor]] 要求验证反馈后再发布；[[related]] 的直接发布会放大风险，因此发布假设发生冲突。',
        );
        ambiguousRun.sourceSnapshots = [
            ...ambiguousRun.sourceSnapshots,
            {
                path: 'archive/anchor.md',
                mtime: 12,
                size: 20,
                contentHash: 'c'.repeat(64),
            },
        ];
        const ambiguous = await evaluatePageletAgentQuality({
            run: ambiguousRun,
            sourceMaterials: materials(),
            readCurrentSourceSnapshot: async (path) => (
                ambiguousRun.sourceSnapshots.find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
        });
        expect(ambiguous).toEqual({ accepted: false, reason: 'ungrounded-path' });

        const shortInlineCode = await evaluatePageletAgentQuality({
            run: makeRun(
                '`anchor.md` 要求验证反馈后再发布；`related.md` 的直接发布会放大风险，因此发布假设发生冲突。',
            ),
            sourceMaterials: materials(),
            readCurrentSourceSnapshot: async (path) => (
                snapshots().find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
        });
        expect(shortInlineCode).toEqual({
            accepted: false,
            reason: 'ungrounded-path',
        });
    });

    it('preserves percent and hash characters in exact inline-code paths', async () => {
        const specialAnchor: PageletAnchorSnapshot = {
            ...anchor,
            path: 'notes/100% Review.md',
        };
        const specialRelated: PageletAgentSourceMaterial = {
            ...relatedMaterial,
            path: 'notes/C# Review.md',
        };
        const run = makeRun([
            '`notes/100% Review.md` 要求验证反馈后再发布；',
            '`notes/C# Review.md` 的直接发布会放大风险，因此发布假设发生冲突。',
        ].join('\n'));
        run.anchor = specialAnchor;
        run.sourceSnapshots = [
            { ...specialAnchor },
            {
                path: specialRelated.path,
                mtime: specialRelated.mtime,
                size: specialRelated.size,
                contentHash: specialRelated.contentHash,
            },
        ];
        run.sourceTools = new Map([
            [specialAnchor.path, new Set(['get_current_note_context'])],
            [specialRelated.path, new Set(['inspect_obsidian_note'])],
        ]);
        run.toolProvenance = [
            {
                ...run.toolProvenance[0]!,
                sourceRecords: [{
                    kind: 'context-used',
                    dedupKey: specialAnchor.path,
                    path: specialAnchor.path,
                }],
            },
            {
                ...run.toolProvenance[1]!,
                sourceRecords: [{
                    kind: 'context-used',
                    dedupKey: specialRelated.path,
                    path: specialRelated.path,
                }],
            },
        ];

        const result = await evaluatePageletAgentQuality({
            run,
            sourceMaterials: new Map([
                [specialAnchor.path, specialAnchor],
                [specialRelated.path, specialRelated],
            ]),
            readCurrentSourceSnapshot: async (path) => (
                run.sourceSnapshots.find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
        });

        expect(result).toMatchObject({
            accepted: true,
            sourceRefs: [
                { path: 'notes/100% Review.md' },
                { path: 'notes/C# Review.md' },
            ],
        });
    });

    it('rejects changed source snapshots and exact NO_INSIGHT silently', async () => {
        const stale = await evaluatePageletAgentQuality({
            run: makeRun([
                '`notes/anchor.md` 要求验证反馈后再发布；',
                '`notes/related.md` 的直接发布会放大风险，因此发布假设发生冲突。',
            ].join('\n')),
            sourceMaterials: materials(),
            readCurrentSourceSnapshot: async (path) => {
                const source = snapshots().find((candidate) => candidate.path === path);
                return source && path === relatedMaterial.path
                    ? { ...source, contentHash: 'changed' }
                    : source ?? null;
            },
            isPathAllowed: () => true,
        });
        expect(stale).toEqual({ accepted: false, reason: 'stale-source' });

        const quiet = await evaluatePageletAgentQuality({
            run: makeRun('NO_INSIGHT'),
            sourceMaterials: materials(),
            readCurrentSourceSnapshot: async () => null,
            isPathAllowed: () => true,
        });
        expect(quiet).toEqual({ accepted: false, reason: 'no-insight' });
    });

    it('rejects a final standalone NO_INSIGHT line without treating earlier or inline mentions as terminal', async () => {
        const verboseQuiet = await evaluatePageletAgentQuality({
            run: makeRun([
                '## 分析过程',
                '`notes/anchor.md` 与 `notes/related.md` 都已检查，但证据仍不足。',
                '',
                'NO_INSIGHT',
                '',
            ].join('\n')),
            sourceMaterials: materials(),
            readCurrentSourceSnapshot: async () => null,
            isPathAllowed: () => true,
        });
        expect(verboseQuiet).toEqual({ accepted: false, reason: 'no-insight' });

        const ordinaryMentions = await evaluatePageletAgentQuality({
            run: makeRun([
                'NO_INSIGHT',
                '协议中的 `NO_INSIGHT` 只是普通标记说明。',
                '## 发布策略存在风险缺口',
                '`notes/anchor.md` 要求验证反馈后再发布；',
                '`notes/related.md` 的直接发布会放大风险，因此两者的发布假设发生冲突。',
            ].join('\n')),
            sourceMaterials: materials(),
            readCurrentSourceSnapshot: async (path) => (
                snapshots().find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
        });
        expect(ordinaryMentions.accepted).toBe(true);
    });

    it('rejects a stale Memory-only lead without current non-anchor content evidence', async () => {
        const run = makeRun(
            '`notes/anchor.md` 与 `notes/related.md` 的发布策略存在风险冲突。',
        );
        run.sourceTools = new Map([
            [anchor.path, new Set(['get_current_note_context'])],
            [relatedMaterial.path, new Set(['search_memory'])],
        ]);
        run.toolProvenance = [
            run.toolProvenance[0]!,
            {
                toolName: 'search_memory',
                sourceRecords: [{
                    kind: 'context-used',
                    dedupKey: relatedMaterial.path,
                    path: relatedMaterial.path,
                }],
                isError: false,
                promptText: 'Stale Memory snapshot for the related note.',
            },
        ];

        const result = await evaluatePageletAgentQuality({
            run,
            sourceMaterials: materials(),
            readCurrentSourceSnapshot: async (path) => (
                snapshots().find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
        });

        expect(result).toEqual({ accepted: false, reason: 'unsupported-source' });
    });

    it('classifies which cited source is only a path without concrete evidence', () => {
        const sourcePath = 'notes/template-diagnosis.md';
        const source: PageletAgentSourceMaterial = {
            path: sourcePath,
            content: '# Diagnosis\ninherited disabled template skip flag',
            mtime: 20,
            size: 50,
            contentHash: 'c'.repeat(64),
            capturedAt: 200,
        };
        const semanticAnchor: PageletAgentSourceMaterial = {
            ...anchorMaterial,
            content: '# Frozen symptom\nazure umbrella stalls at dawn',
            size: 47,
            contentHash: 'd'.repeat(64),
        };
        const successfulSources = new Map<string, PageletAgentSourceSnapshot>([
            [semanticAnchor.path, semanticAnchor],
            [source.path, source],
        ]);
        const sourceMaterials = new Map<string, PageletAgentSourceMaterial>([
            [semanticAnchor.path, semanticAnchor],
            [source.path, source],
        ]);
        const sourceTools = new Map<string, ReadonlySet<string>>([
            [semanticAnchor.path, new Set(['get_current_note_context'])],
            [source.path, new Set(['inspect_obsidian_note'])],
        ]);
        const citedPaths = new Set([semanticAnchor.path, source.path]);

        expect(classifyPageletInsightSourceSupport({
            body: [
                '`notes/anchor.md` supplies the entry context, while',
                '`notes/template-diagnosis.md` records an inherited disabled template skip flag.',
            ].join('\n'),
            anchorPath: semanticAnchor.path,
            citedPaths,
            successfulSources,
            sourceMaterials,
            sourceTools,
        })).toBe('anchor-overlap-missing');
        expect(classifyPageletInsightSourceSupport({
            body: [
                '`notes/anchor.md` records that the azure umbrella stalls at dawn, while',
                '`notes/template-diagnosis.md` supplies the supporting context.',
            ].join('\n'),
            anchorPath: semanticAnchor.path,
            citedPaths,
            successfulSources,
            sourceMaterials,
            sourceTools,
        })).toBe('non-anchor-overlap-missing');
        for (const pathOnlyReference of [
            'notes/anchor.md#azure-umbrella',
            'notes/anchor.md|azure-umbrella',
            'notes/anchor.md#symptom|azure-umbrella',
        ]) {
            expect(classifyPageletInsightSourceSupport({
                body: [
                    pathOnlyReference,
                    '`notes/template-diagnosis.md` records an inherited disabled template skip flag.',
                ].join('\n'),
                anchorPath: semanticAnchor.path,
                citedPaths,
                successfulSources,
                sourceMaterials,
                sourceTools,
            })).toBe('anchor-overlap-missing');
        }
    });
});

describe('Pagelet agent cache and controller', () => {
    function createDeferredSourceRead(
        blockedPath: string,
        blockedCall: number,
        readMaterials: () => ReadonlyMap<string, PageletAgentSourceMaterial>,
    ) {
        let calls = 0;
        let releaseBlocked: (() => void) | undefined;
        let notifyBlocked: (() => void) | undefined;
        const blocked = new Promise<void>((resolve) => {
            notifyBlocked = resolve;
        });
        return {
            blocked,
            captureSourceMaterial: async (path: string) => {
                if (path !== blockedPath) return readMaterials().get(path) ?? null;
                calls += 1;
                if (calls !== blockedCall) return readMaterials().get(path) ?? null;
                notifyBlocked?.();
                await new Promise<void>((resolve) => {
                    releaseBlocked = resolve;
                });
                return readMaterials().get(path) ?? null;
            },
            release() {
                if (!releaseBlocked) throw new Error('source read is not blocked');
                releaseBlocked();
            },
        };
    }

    function verifiedInsight(web = false): PageletAgentVerifiedInsight {
        const cacheIdentity = createPageletAgentCacheIdentity({
            anchor,
            sources: snapshots(),
            policyIdentity,
        });
        const body = '`notes/anchor.md` 与 `notes/related.md` 的发布策略存在风险冲突。';
        const normalizedBody = normalizePageletInsightBody(body);
        const normalizedClaim = normalizePageletInsightClaim(body);
        const insightId = createPageletInsightId({
            anchor: cacheIdentity.anchor,
            normalizedBody,
            normalizedClaim,
            sources: snapshots(),
        });
        return {
            insightId,
            collectionId: createPageletInsightCollectionId([insightId]),
            body,
            normalizedBody,
            normalizedClaim,
            bodyHash: hashPageletInsightBody(normalizedBody),
            claimHash: hashPageletInsightClaim(normalizedClaim),
            anchor: cacheIdentity.anchor,
            sources: snapshots(),
            sourceRefs: snapshots().map((source) => ({ path: source.path })),
            cacheIdentity,
            cacheIdentityHash: hashPageletAgentCacheIdentity(cacheIdentity),
            triggerReason: 'explicit',
            preparedAt: 1_000,
            metrics: { modelTurns: 2, toolCalls: 2, wallTimeMs: 100 },
            webObservations: web ? [{ url: 'https://example.com', observationHash: 'web' }] : [],
        };
    }

    function verifiedSibling(
        body: string,
        sources: PageletAgentSourceSnapshot[],
    ): PageletAgentVerifiedInsight {
        const base = verifiedInsight();
        const normalizedBody = normalizePageletInsightBody(body);
        const normalizedClaim = normalizePageletInsightClaim(body);
        const cacheIdentity = createPageletAgentCacheIdentity({
            anchor,
            sources,
            policyIdentity,
        });
        const insightId = createPageletInsightId({
            anchor: cacheIdentity.anchor,
            normalizedBody,
            normalizedClaim,
            sources,
        });
        return {
            ...base,
            insightId,
            collectionId: createPageletInsightCollectionId([insightId]),
            body,
            normalizedBody,
            normalizedClaim,
            bodyHash: hashPageletInsightBody(normalizedBody),
            claimHash: hashPageletInsightClaim(normalizedClaim),
            sources,
            sourceRefs: sources.map((source) => ({ path: source.path })),
            cacheIdentity,
            cacheIdentityHash: hashPageletAgentCacheIdentity(cacheIdentity),
        };
    }

    it('accepts a production commit seal only while host lifecycle state is current', () => {
        const insight = verifiedInsight();
        const policyIdentityKey = pageletAgentPolicyIdentityKey(policyIdentity);

        expect(pageletDeepDiscoverCommitSealIsCurrent({
            seal: {
                schemaVersion: 1,
                controllerEpoch: 7,
                evidenceEpoch: 'evidence-7',
                policyIdentityKey,
            },
            collection: {
                collectionId: insight.collectionId,
                anchor: insight.anchor,
                insights: [insight],
                preparedAt: insight.preparedAt,
            },
            controllerEpoch: 7,
            evidenceEpoch: 'evidence-7',
            currentPolicyIdentityKey: policyIdentityKey,
            controllerPolicyIdentityKey: policyIdentityKey,
            isPathAllowed: () => true,
        })).toBe(true);
    });

    it.each([
        ['controller lifecycle', { controllerEpoch: 8 }],
        ['evidence epoch', { evidenceEpoch: 'evidence-8' }],
        ['policy identity', { currentPolicyIdentityKey: 'policy-8' }],
        ['source boundary', {
            isPathAllowed: (path: string) => path !== relatedMaterial.path,
        }],
    ] as const)('fails the production commit seal closed on %s drift', (_label, override) => {
        const insight = verifiedInsight();
        const policyIdentityKey = pageletAgentPolicyIdentityKey(policyIdentity);
        const state = {
            seal: {
                schemaVersion: 1 as const,
                controllerEpoch: 7,
                evidenceEpoch: 'evidence-7',
                policyIdentityKey,
            },
            collection: {
                collectionId: insight.collectionId,
                anchor: insight.anchor,
                insights: [insight],
                preparedAt: insight.preparedAt,
            },
            controllerEpoch: 7,
            evidenceEpoch: 'evidence-7',
            currentPolicyIdentityKey: policyIdentityKey,
            controllerPolicyIdentityKey: policyIdentityKey,
            isPathAllowed: () => true,
            ...override,
        };

        expect(pageletDeepDiscoverCommitSealIsCurrent(state)).toBe(false);
    });

    it('invalidates cache on source change and caps web-backed reuse at 24 hours', async () => {
        const cache = new PageletAgentCache();
        cache.put(verifiedInsight(true));
        const valid = await cache.getValid({
            anchor,
            policyIdentity,
            readSourceSnapshot: async (path) => snapshots().find((source) => source.path === path) ?? null,
            isPathAllowed: () => true,
            now: 1_000 + 24 * 60 * 60 * 1000 - 1,
        });
        expect(valid).not.toBeNull();

        const expired = await cache.getValid({
            anchor,
            policyIdentity,
            readSourceSnapshot: async (path) => snapshots().find((source) => source.path === path) ?? null,
            isPathAllowed: () => true,
            now: 1_000 + 24 * 60 * 60 * 1000,
        });
        expect(expired).toBeNull();

        cache.put(verifiedInsight(false));
        const changed = await cache.getValid({
            anchor,
            policyIdentity,
            readSourceSnapshot: async (path) => {
                const source = snapshots().find((candidate) => candidate.path === path);
                return source && path === relatedMaterial.path ? { ...source, mtime: 99 } : source ?? null;
            },
            isPathAllowed: () => true,
            now: 2_000,
        });
        expect(changed).toBeNull();
    });

    it('refuses a cache entry whose verified-looking body ends with standalone NO_INSIGHT', async () => {
        const cache = new PageletAgentCache();
        cache.put(verifiedSibling([
            '## 分析过程',
            '`notes/anchor.md` 与 `notes/related.md` 的材料仍不足。',
            '',
            'NO_INSIGHT',
        ].join('\n'), snapshots()));

        await expect(cache.getValidCollection({
            anchor,
            policyIdentity,
            readSourceSnapshot: async (path) => (
                snapshots().find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
        })).resolves.toBeNull();
    });

    it('rejects a collection that repeats one insight identity', async () => {
        const cache = new PageletAgentCache();
        const first = verifiedInsight();
        const collectionId = createPageletInsightCollectionId([
            first.insightId,
            first.insightId,
        ]);
        first.collectionId = collectionId;
        const duplicate = { ...first, collectionId };
        cache.putCollection({
            collectionId,
            anchor: first.anchor,
            insights: [first, duplicate],
            preparedAt: first.preparedAt,
        });

        await expect(cache.getValidCollection({
            anchor,
            policyIdentity,
            readSourceSnapshot: async (path) => snapshots().find((source) => source.path === path) ?? null,
            isPathAllowed: () => true,
        })).resolves.toBeNull();
    });

    it('revalidates cached siblings independently and atomically keeps the current one', async () => {
        const cache = new PageletAgentCache();
        const first = verifiedInsight();
        const third: PageletAgentSourceSnapshot = {
            path: 'notes/third.md',
            mtime: 12,
            size: 30,
            contentHash: 'c'.repeat(64),
        };
        const secondBody = '`notes/anchor.md` 与 `notes/third.md` 揭示回滚检查点缺失的行动风险。';
        const secondNormalizedBody = normalizePageletInsightBody(secondBody);
        const secondNormalizedClaim = normalizePageletInsightClaim(secondBody);
        const secondSources = [snapshots()[0]!, third];
        const secondCacheIdentity = createPageletAgentCacheIdentity({
            anchor,
            sources: secondSources,
            policyIdentity,
        });
        const secondId = createPageletInsightId({
            anchor: secondCacheIdentity.anchor,
            normalizedBody: secondNormalizedBody,
            normalizedClaim: secondNormalizedClaim,
            sources: secondSources,
        });
        const second: PageletAgentVerifiedInsight = {
            ...first,
            insightId: secondId,
            body: secondBody,
            normalizedBody: secondNormalizedBody,
            normalizedClaim: secondNormalizedClaim,
            bodyHash: hashPageletInsightBody(secondNormalizedBody),
            claimHash: hashPageletInsightClaim(secondNormalizedClaim),
            sources: secondSources,
            sourceRefs: secondSources.map((source) => ({ path: source.path })),
            cacheIdentity: secondCacheIdentity,
            cacheIdentityHash: hashPageletAgentCacheIdentity(secondCacheIdentity),
        };
        const collectionId = createPageletInsightCollectionId([first.insightId, second.insightId]);
        first.collectionId = collectionId;
        second.collectionId = collectionId;
        cache.putCollection({
            collectionId,
            anchor: first.anchor,
            insights: [first, second],
            preparedAt: first.preparedAt,
        });

        const current = await cache.getValidCollection({
            anchor,
            policyIdentity,
            readSourceSnapshot: async (path) => (
                path === third.path
                    ? null
                    : snapshots().find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
            now: 2_000,
        });

        expect(current?.insights).toHaveLength(1);
        expect(current?.insights[0]?.insightId).toBe(first.insightId);
        expect(current?.collectionId).toBe(createPageletInsightCollectionId([first.insightId]));
        expect(current?.insights[0]?.collectionId).toBe(current?.collectionId);
    });

    it('isolates a non-abort cache read failure and freshly revalidates the sibling', async () => {
        const cache = new PageletAgentCache();
        const first = verifiedInsight();
        const third: PageletAgentSourceSnapshot = {
            path: 'notes/third.md',
            mtime: 12,
            size: 30,
            contentHash: 'c'.repeat(64),
        };
        const second = verifiedSibling(
            '`notes/anchor.md` 与 `notes/third.md` 揭示回滚检查点缺失的行动风险。',
            [snapshots()[0]!, third],
        );
        const collectionId = createPageletInsightCollectionId([first.insightId, second.insightId]);
        first.collectionId = collectionId;
        second.collectionId = collectionId;
        cache.putCollection({
            collectionId,
            anchor: first.anchor,
            insights: [first, second],
            preparedAt: first.preparedAt,
        });
        let anchorReads = 0;

        const current = await cache.getValidCollection({
            anchor,
            policyIdentity,
            readSourceSnapshot: async (path) => {
                if (path === anchor.path && ++anchorReads === 1) {
                    throw new Error('one sibling read failed');
                }
                if (path === third.path) return third;
                return snapshots().find((source) => source.path === path) ?? null;
            },
            isPathAllowed: () => true,
            now: 2_000,
        });

        expect(anchorReads).toBe(2);
        expect(current?.insights.map((insight) => insight.insightId)).toEqual([second.insightId]);
        expect(current?.collectionId).toBe(createPageletInsightCollectionId([second.insightId]));
        expect(current?.insights[0]?.collectionId).toBe(current?.collectionId);
    });

    it('does not let an in-flight regroup overwrite a newer cache entry', async () => {
        const cache = new PageletAgentCache();
        const first = verifiedInsight();
        const third: PageletAgentSourceSnapshot = {
            path: 'notes/third.md',
            mtime: 12,
            size: 30,
            contentHash: 'c'.repeat(64),
        };
        const staleSibling = verifiedSibling(
            '`notes/anchor.md` 与 `notes/third.md` 揭示旧的回滚风险。',
            [snapshots()[0]!, third],
        );
        const oldCollectionId = createPageletInsightCollectionId([
            first.insightId,
            staleSibling.insightId,
        ]);
        first.collectionId = oldCollectionId;
        staleSibling.collectionId = oldCollectionId;
        cache.putCollection({
            collectionId: oldCollectionId,
            anchor: first.anchor,
            insights: [first, staleSibling],
            preparedAt: first.preparedAt,
        });
        const sourceRead = createDeferredSourceRead(
            relatedMaterial.path,
            1,
            () => materials(),
        );

        const pending = cache.prepareValidCollection({
            anchor,
            policyIdentity,
            readSourceSnapshot: async (path) => {
                const material = await sourceRead.captureSourceMaterial(path);
                return material ? {
                    path: material.path,
                    mtime: material.mtime,
                    size: material.size,
                    contentHash: material.contentHash,
                } : null;
            },
            isPathAllowed: () => true,
            now: 2_000,
        });
        await sourceRead.blocked;
        const replacement = verifiedSibling(
            '`notes/anchor.md` 与 `notes/related.md` 揭示新的发布校验缺口。',
            snapshots(),
        );
        cache.put(replacement);
        sourceRead.release();

        await expect(pending).resolves.toBeNull();
        await expect(cache.getValidCollection({
            anchor,
            policyIdentity,
            readSourceSnapshot: async (path) => (
                snapshots().find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
            now: 2_000,
        })).resolves.toMatchObject({
            collectionId: replacement.collectionId,
            insights: [{ insightId: replacement.insightId }],
        });
        expect(cache.getMutationSnapshot()).toEqual({ version: 2, entryCount: 1 });
    });

    it('does not let an in-flight stale read delete a newer cache entry', async () => {
        const cache = new PageletAgentCache();
        cache.put(verifiedInsight());
        let currentMaterials = materials();
        const sourceRead = createDeferredSourceRead(
            relatedMaterial.path,
            1,
            () => currentMaterials,
        );
        const pending = cache.prepareValidCollection({
            anchor,
            policyIdentity,
            readSourceSnapshot: async (path) => {
                const material = await sourceRead.captureSourceMaterial(path);
                return material ? {
                    path: material.path,
                    mtime: material.mtime,
                    size: material.size,
                    contentHash: material.contentHash,
                } : null;
            },
            isPathAllowed: () => true,
            now: 2_000,
        });
        await sourceRead.blocked;
        const replacement = verifiedSibling(
            '`notes/anchor.md` 与 `notes/related.md` 揭示新的审批缺口。',
            snapshots(),
        );
        cache.put(replacement);
        currentMaterials = new Map([[anchor.path, anchorMaterial]]);
        sourceRead.release();

        await expect(pending).resolves.toBeNull();
        await expect(cache.getValidCollection({
            anchor,
            policyIdentity,
            readSourceSnapshot: async (path) => (
                snapshots().find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
            now: 2_000,
        })).resolves.toMatchObject({
            collectionId: replacement.collectionId,
            insights: [{ insightId: replacement.insightId }],
        });
        expect(cache.getMutationSnapshot()).toEqual({ version: 2, entryCount: 1 });
    });

    it('rejects cached delivery when the visible body no longer matches its body identity', async () => {
        const cache = new PageletAgentCache();
        const corrupted = verifiedInsight();
        corrupted.body = `${corrupted.body}\n未经验证的新结论`;
        cache.put(corrupted);

        await expect(cache.getValidCollection({
            anchor,
            policyIdentity,
            readSourceSnapshot: async (path) => (
                snapshots().find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
            now: 2_000,
        })).resolves.toBeNull();
    });

    it('admits only after cache miss, then reuses cache without another run or admission', async () => {
        const runtimeRun = jest.fn(async (_request: unknown) => makeRun([
            '## 发布策略存在风险缺口',
            '`notes/anchor.md` 要求验证反馈后再发布；',
            '`notes/related.md` 的直接发布会放大风险，因此发布假设发生冲突。',
        ].join('\n')));
        const admitRun = jest.fn(async () => ({ ok: true as const }));
        const controller = new PageletDeepDiscoverController({
            runtime: { run: runtimeRun },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: async (path) => materials().get(path) ?? null,
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => 'evidence-1',
            controllerEpoch: 1,
            isPathAllowed: () => true,
            isSeen: () => true,
            admitRun,
            now: () => 2_000,
        });

        const first = await controller.run({
            path: anchor.path,
            triggerReason: 'explicit',
        });
        const second = await controller.run({
            path: anchor.path,
            triggerReason: 'open-changed-note',
        });

        expect(first.status).toBe('verified');
        expect(second.status).toBe('cache-hit');
        expect(admitRun).toHaveBeenCalledTimes(1);
        expect(runtimeRun).toHaveBeenCalledTimes(1);

        const candidate = pageletAgentInsightToDeliveryCandidate(
            (first as Extract<typeof first, { status: 'verified' }>).insight,
            'zh',
        );
        expect(candidate).toMatchObject({
            kind: 'review',
            route: { surface: 'panel', payloadType: 'pagelet-agent-insight-v1' },
            deliveryReceipt: { kind: 'review' },
        });
    });

    it('atomically commits zero, one, or two independent natural-Markdown insights', async () => {
        const firstBody = [
            '## 发布策略存在风险缺口',
            '`notes/anchor.md` 要求验证反馈后再发布；',
            '`notes/related.md` 的直接发布会放大风险，因此发布假设发生冲突。',
        ].join('\n');
        const secondBody = [
            '## 回滚检查点缺失',
            '`notes/anchor.md` 的验证反馈没有形成回滚检查点；',
            '`notes/related.md` 说明直接发布会放大风险，因此行动流程仍有缺口。',
        ].join('\n');
        const cache = new PageletAgentCache();
        const twoRun = makeRun(secondBody);
        twoRun.insightDrafts = [
            { body: firstBody, origin: 'staged', declaredSourceIds: snapshots().map((source) => source.path) },
            { body: secondBody, origin: 'terminal', declaredSourceIds: [] },
        ];
        const controller = new PageletDeepDiscoverController({
            runtime: { run: async () => twoRun },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: async (path) => materials().get(path) ?? null,
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => 'evidence-1',
            controllerEpoch: 1,
            isPathAllowed: () => true,
            cache,
            now: () => 2_000,
        });

        const two = await controller.run({
            path: anchor.path,
            triggerReason: 'explicit',
            force: true,
        });
        expect(two.status).toBe('verified');
        if (two.status !== 'verified') throw new Error('expected verified collection');
        expect(two.insights).toHaveLength(2);
        expect(new Set(two.insights.map((insight) => insight.insightId)).size).toBe(2);
        expect(two.insights.every((insight) => insight.collectionId === two.collection.collectionId)).toBe(true);
        const candidates = two.insights.map((insight) => pageletAgentInsightToDeliveryCandidate(insight, 'zh'));
        expect(candidates.map((candidate) => candidate.id)).toEqual(two.insights.map((insight) => insight.insightId));
        expect(candidates[0]?.deliveryReceipt).not.toEqual(candidates[1]?.deliveryReceipt);

        const cached = await cache.getValidCollection({
            anchor,
            policyIdentity,
            readSourceSnapshot: async (path) => snapshots().find((source) => source.path === path) ?? null,
            isPathAllowed: () => true,
            now: 2_001,
        });
        expect(cached?.insights).toHaveLength(2);

        const oneRun = makeRun('NO_INSIGHT');
        oneRun.insightDrafts = [{
            body: firstBody,
            origin: 'staged',
            declaredSourceIds: snapshots().map((source) => source.path),
        }];
        const oneController = new PageletDeepDiscoverController({
            runtime: { run: async () => oneRun },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: async (path) => materials().get(path) ?? null,
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => 'evidence-1',
            controllerEpoch: 1,
            isPathAllowed: () => true,
            now: () => 3_000,
        });
        const one = await oneController.run({ path: anchor.path, triggerReason: 'explicit', force: true });
        expect(one.status === 'verified' ? one.insights : []).toHaveLength(1);

        const zeroCache = new PageletAgentCache();
        const zeroController = new PageletDeepDiscoverController({
            runtime: { run: async () => ({ ...makeRun('NO_INSIGHT'), insightDrafts: [] }) },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: async (path) => materials().get(path) ?? null,
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => 'evidence-1',
            controllerEpoch: 1,
            isPathAllowed: () => true,
            cache: zeroCache,
        });
        await expect(zeroController.run({ path: anchor.path, triggerReason: 'explicit', force: true }))
            .resolves.toMatchObject({ status: 'quiet', reason: 'no-insight' });
        await expect(zeroCache.getValidCollection({
            anchor,
            policyIdentity,
            readSourceSnapshot: async () => null,
            isPathAllowed: () => true,
        })).resolves.toBeNull();
    });

    it('atomically commits a second explicit-link finding expressed as Chinese root cause and defect', async () => {
        const linkedAnchorContent = [
            '# Pagelet 双洞察入口',
            'PGL-CORAL-318 珊瑚邮筒只在周三出现归档延迟。',
            'PGL-SILVER-624 银色温室只在清晨出现湿度误报。',
            '[[retrieval-smoke/pagelet/54-double-source-a|珊瑚邮筒归档复盘]]',
            '[[retrieval-smoke/pagelet/55-double-source-b|银色温室传感器复盘]]',
        ].join('\n');
        const linkedAnchor: PageletAnchorSnapshot = {
            path: 'retrieval-smoke/pagelet/50-current-note.md',
            content: linkedAnchorContent,
            mtime: 50,
            size: linkedAnchorContent.length,
            contentHash: '5'.repeat(64),
            capturedAt: 500,
        };
        const coralContent = [
            '# 珊瑚邮筒归档复盘',
            'PGL-CORAL-318 珊瑚邮筒只在周三出现归档延迟，压缩任务与归档任务共享单并发队列。',
        ].join('\n');
        const coral: PageletAgentSourceMaterial = {
            path: 'retrieval-smoke/pagelet/54-double-source-a.md',
            content: coralContent,
            mtime: 54,
            size: coralContent.length,
            contentHash: '4'.repeat(64),
            capturedAt: 504,
        };
        const silverContent = [
            '# 银色温室传感器复盘',
            'PGL-SILVER-624 银色温室只在清晨出现湿度误报，传感器预热完成前采集了第一笔读数。',
        ].join('\n');
        const silver: PageletAgentSourceMaterial = {
            path: 'retrieval-smoke/pagelet/55-double-source-b.md',
            content: silverContent,
            mtime: 55,
            size: silverContent.length,
            contentHash: '6'.repeat(64),
            capturedAt: 505,
        };
        const firstBody = [
            '## 珊瑚邮筒存在任务调度冲突',
            '`retrieval-smoke/pagelet/50-current-note.md` 记录 PGL-CORAL-318 的周三归档延迟；',
            '`retrieval-smoke/pagelet/54-double-source-a.md` 显示压缩与归档共享单并发队列，两者揭示任务调度冲突。',
        ].join('\n');
        const secondBody = [
            '## 银色温室误报的根因',
            '`retrieval-smoke/pagelet/50-current-note.md` 记录 PGL-SILVER-624 的清晨湿度误报；',
            '`retrieval-smoke/pagelet/55-double-source-b.md` 显示预热完成前采集第一笔读数，根因是采样缺陷。',
        ].join('\n');
        const run = makeRun(secondBody);
        run.anchor = linkedAnchor;
        run.sourceSnapshots = [linkedAnchor, coral, silver].map((source) => ({
            path: source.path,
            mtime: source.mtime,
            size: source.size,
            contentHash: source.contentHash,
        }));
        run.sourceTools = new Map([
            [linkedAnchor.path, new Set(['get_current_note_context'])],
            [coral.path, new Set(['inspect_obsidian_note'])],
            [silver.path, new Set(['inspect_obsidian_note'])],
        ]);
        run.toolProvenance = [
            {
                toolName: 'get_current_note_context',
                sourceRecords: [{
                    kind: 'context-used',
                    dedupKey: linkedAnchor.path,
                    path: linkedAnchor.path,
                }],
                isError: false,
                promptText: linkedAnchor.content,
            },
            ...[coral, silver].map((source) => ({
                toolName: 'inspect_obsidian_note',
                sourceRecords: [{
                    kind: 'context-used' as const,
                    dedupKey: source.path,
                    path: source.path,
                }],
                isError: false,
                promptText: source.content,
            })),
        ];
        run.insightDrafts = [
            {
                body: firstBody,
                origin: 'staged',
                declaredSourceIds: [linkedAnchor.path, coral.path],
            },
            {
                body: secondBody,
                origin: 'terminal',
                declaredSourceIds: [],
            },
        ];
        const sourceMaterials = new Map<string, PageletAgentSourceMaterial>([
            [linkedAnchor.path, linkedAnchor],
            [coral.path, coral],
            [silver.path, silver],
        ]);
        const captureSourceMaterial = jest.fn(async (path: string) => (
            sourceMaterials.get(path) ?? null
        ));
        const cache = new PageletAgentCache();
        const controller = new PageletDeepDiscoverController({
            runtime: { run: async () => run },
            captureSnapshot: async () => linkedAnchor,
            captureSourceMaterial,
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => 'evidence-1',
            controllerEpoch: 1,
            isPathAllowed: () => true,
            getAnchorRelations: () => ({ explicitLinks: [coral.path, silver.path] }),
            cache,
            now: () => 5_000,
        });

        const result = await controller.run({
            path: linkedAnchor.path,
            triggerReason: 'explicit',
            force: true,
        });

        expect(result.status).toBe('verified');
        if (result.status !== 'verified') throw new Error('expected verified collection');
        expect(result.insights.map((insight) => insight.body)).toEqual([firstBody, secondBody]);
        expect(result.insights).toHaveLength(2);
        expect(result.insights.every((insight) => (
            insight.collectionId === result.collection.collectionId
        ))).toBe(true);
        expect(new Set(captureSourceMaterial.mock.calls.map(([path]) => path))).toEqual(new Set([
            linkedAnchor.path,
            coral.path,
            silver.path,
        ]));
        await expect(cache.getValidCollection({
            anchor: linkedAnchor,
            policyIdentity,
            readSourceSnapshot: async (path) => {
                const source = sourceMaterials.get(path);
                return source ? {
                    path: source.path,
                    mtime: source.mtime,
                    size: source.size,
                    contentHash: source.contentHash,
                } : null;
            },
            isPathAllowed: () => true,
            now: 5_001,
        })).resolves.toMatchObject({ insights: [{ body: firstBody }, { body: secondBody }] });
    });

    it('keeps an explicit numbered two-insight terminal blob out of cache and delivery', async () => {
        const bundledBody = [
            '## Insight 1: release validation conflict',
            '`notes/anchor.md` requires validation before release, while',
            '`notes/related.md` shows direct release increases risk.',
            '',
            '## 洞察 2：回滚检查点缺失',
            '`notes/anchor.md` 的验证反馈没有形成回滚检查点；',
            '`notes/related.md` 说明直接发布会放大行动风险。',
        ].join('\n');
        const run = makeRun(bundledBody);
        run.insightDrafts = [{
            body: bundledBody,
            origin: 'terminal',
            declaredSourceIds: [],
        }];
        const cache = new PageletAgentCache();
        const onResult = jest.fn();
        const controller = new PageletDeepDiscoverController({
            runtime: { run: async () => run },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: async (path) => materials().get(path) ?? null,
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => 'evidence-1',
            controllerEpoch: 1,
            isPathAllowed: () => true,
            cache,
            onResult,
        });

        const result = await controller.run({
            path: anchor.path,
            triggerReason: 'explicit',
            force: true,
        });

        expect(result).toEqual(expect.objectContaining({
            status: 'quiet',
            reason: 'bundled-insights',
        }));
        expect(onResult).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'quiet', reason: 'bundled-insights' }),
            expect.objectContaining({ path: anchor.path }),
        );
        const deliveryCandidates = result.status === 'verified'
            ? result.insights.map((insight) => pageletAgentInsightToDeliveryCandidate(insight, 'zh'))
            : [];
        expect(deliveryCandidates).toEqual([]);
        await expect(cache.getValidCollection({
            anchor,
            policyIdentity,
            readSourceSnapshot: async () => null,
            isPathAllowed: () => true,
        })).resolves.toBeNull();
    });

    it('keeps explicit and background runs quiet when explanatory Markdown ends in NO_INSIGHT', async () => {
        const verboseNoInsight = [
            '## 分析过程',
            '`notes/anchor.md` 与 `notes/related.md` 都已检查，但不足以形成新洞察。',
            '',
            'NO_INSIGHT',
            '',
        ].join('\n');
        const run = makeRun(verboseNoInsight);
        run.insightDrafts = [{
            body: verboseNoInsight,
            origin: 'terminal',
            declaredSourceIds: [],
        }];
        const cache = new PageletAgentCache();
        const runtimeRun = jest.fn(async () => run);
        const controller = new PageletDeepDiscoverController({
            runtime: { run: runtimeRun },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: async (path) => materials().get(path) ?? null,
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => 'evidence-1',
            controllerEpoch: 1,
            isPathAllowed: () => true,
            cache,
        });

        await expect(controller.run({
            path: anchor.path,
            triggerReason: 'explicit',
            force: true,
        })).resolves.toMatchObject({ status: 'quiet', reason: 'no-insight' });
        await expect(controller.run({
            path: anchor.path,
            triggerReason: 'open-changed-note',
        })).resolves.toMatchObject({ status: 'quiet', reason: 'no-insight' });
        expect(runtimeRun).toHaveBeenCalledTimes(2);
        await expect(cache.getValidCollection({
            anchor,
            policyIdentity,
            readSourceSnapshot: async () => null,
            isPathAllowed: () => true,
        })).resolves.toBeNull();
    });

    it('rejects a repeated second insight and keeps a verified first when only second evidence goes stale', async () => {
        const firstBody = [
            '## 发布策略存在风险缺口',
            '`notes/anchor.md` 要求验证反馈后再发布；',
            '`notes/related.md` 的直接发布会放大风险，因此发布假设发生冲突。',
        ].join('\n');
        const duplicateRun = makeRun(firstBody);
        duplicateRun.insightDrafts = [
            { body: firstBody, origin: 'staged', declaredSourceIds: snapshots().map((source) => source.path) },
            { body: firstBody, origin: 'terminal', declaredSourceIds: [] },
        ];
        const duplicateController = new PageletDeepDiscoverController({
            runtime: { run: async () => duplicateRun },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: async (path) => materials().get(path) ?? null,
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => 'evidence-1',
            controllerEpoch: 1,
            isPathAllowed: () => true,
        });
        const duplicate = await duplicateController.run({
            path: anchor.path,
            triggerReason: 'explicit',
            force: true,
        });
        expect(duplicate.status === 'verified' ? duplicate.insights : []).toHaveLength(1);

        const thirdContent = '# Third\n回滚检查点缺失会导致行动风险';
        const third = {
            path: 'notes/third.md',
            content: thirdContent,
            mtime: 12,
            size: thirdContent.length,
            contentHash: 'c'.repeat(64),
            capturedAt: 102,
        };
        const staleSecondRun = makeRun([
            '## 回滚检查点缺失',
            '`notes/anchor.md` 的验证反馈没有形成回滚检查点；',
            '`notes/third.md` 说明缺失会导致行动风险。',
        ].join('\n'));
        staleSecondRun.sourceSnapshots.push({ ...third });
        staleSecondRun.sourceTools = new Map([
            ...staleSecondRun.sourceTools,
            [third.path, new Set(['inspect_obsidian_note'])],
        ]);
        staleSecondRun.toolProvenance.push({
            toolName: 'inspect_obsidian_note',
            sourceRecords: [{ kind: 'context-used', dedupKey: third.path, path: third.path }],
            isError: false,
            promptText: third.content,
        });
        staleSecondRun.insightDrafts = [
            { body: firstBody, origin: 'staged', declaredSourceIds: snapshots().map((source) => source.path) },
            { body: staleSecondRun.finalText, origin: 'terminal', declaredSourceIds: [] },
        ];
        const staleSecondController = new PageletDeepDiscoverController({
            runtime: { run: async () => staleSecondRun },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: async (path) => (
                path === third.path ? null : materials().get(path) ?? null
            ),
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => 'evidence-1',
            controllerEpoch: 1,
            isPathAllowed: (path) => path !== third.path,
        });
        const staleSecond = await staleSecondController.run({
            path: anchor.path,
            triggerReason: 'explicit',
            force: true,
        });
        expect(staleSecond.status === 'verified' ? staleSecond.insights : []).toHaveLength(1);
        if (staleSecond.status === 'verified') expect(staleSecond.insight.body).toBe(firstBody);
    });

    it('independently keeps a valid second when the staged first source is stale', async () => {
        const staleFirstBody = [
            '## 旧来源已经失效',
            '`notes/anchor.md` 的验证反馈与 `notes/stale-first.md` 的旧发布策略冲突。',
        ].join('\n');
        const secondBody = [
            '## 当前发布策略存在风险缺口',
            '`notes/anchor.md` 要求验证反馈后再发布；',
            '`notes/related.md` 的直接发布会放大风险，因此发布假设发生冲突。',
        ].join('\n');
        const staleContent = '# Stale first\n旧发布策略存在冲突';
        const staleSnapshot: PageletAgentSourceSnapshot = {
            path: 'notes/stale-first.md',
            mtime: 12,
            size: staleContent.length,
            contentHash: 'c'.repeat(64),
        };
        const run = makeRun(secondBody);
        run.sourceSnapshots.push(staleSnapshot);
        run.sourceTools = new Map([
            ...run.sourceTools,
            [staleSnapshot.path, new Set(['inspect_obsidian_note'])],
        ]);
        run.toolProvenance.push({
            toolName: 'inspect_obsidian_note',
            sourceRecords: [{
                kind: 'context-used',
                dedupKey: staleSnapshot.path,
                path: staleSnapshot.path,
            }],
            isError: false,
            promptText: staleContent,
        });
        run.insightDrafts = [
            {
                body: staleFirstBody,
                origin: 'staged',
                declaredSourceIds: [anchor.path, staleSnapshot.path],
            },
            { body: secondBody, origin: 'terminal', declaredSourceIds: [] },
        ];
        const cache = new PageletAgentCache();
        const controller = new PageletDeepDiscoverController({
            runtime: { run: async () => run },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: async (path) => (
                path === staleSnapshot.path ? null : materials().get(path) ?? null
            ),
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => 'evidence-1',
            controllerEpoch: 1,
            isPathAllowed: () => true,
            cache,
            now: () => 4_000,
        });

        const verified = await controller.run({
            path: anchor.path,
            triggerReason: 'explicit',
            force: true,
        });

        expect(verified.status).toBe('verified');
        if (verified.status !== 'verified') throw new Error('expected verified second insight');
        expect(verified.insights).toHaveLength(1);
        expect(verified.insight.body).toBe(secondBody);
        await expect(cache.getValidCollection({
            anchor,
            policyIdentity,
            readSourceSnapshot: async (path) => (
                snapshots().find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
            now: 4_001,
        })).resolves.toMatchObject({ insights: [{ body: secondBody }] });
    });

    it('re-reads each accepted insight at commit and isolates a late non-abort source failure', async () => {
        const firstBody = [
            '## 发布策略存在风险缺口',
            '`notes/anchor.md` 要求验证反馈后再发布；',
            '`notes/related.md` 的直接发布会放大风险，因此发布假设发生冲突。',
        ].join('\n');
        const secondBody = [
            '## 回滚检查点缺失',
            '`notes/anchor.md` 的验证反馈没有形成回滚检查点；',
            '`notes/third.md` 说明缺失会导致行动风险。',
        ].join('\n');
        const thirdContent = '# Third\n回滚检查点缺失会导致行动风险';
        const third: PageletAgentSourceMaterial = {
            path: 'notes/third.md',
            content: thirdContent,
            mtime: 12,
            size: thirdContent.length,
            contentHash: 'c'.repeat(64),
            capturedAt: 102,
        };
        const run = makeRun(secondBody);
        run.sourceSnapshots.push({ ...third });
        run.sourceTools = new Map([
            ...run.sourceTools,
            [third.path, new Set(['inspect_obsidian_note'])],
        ]);
        run.toolProvenance.push({
            toolName: 'inspect_obsidian_note',
            sourceRecords: [{ kind: 'context-used', dedupKey: third.path, path: third.path }],
            isError: false,
            promptText: third.content,
        });
        run.insightDrafts = [
            { body: firstBody, origin: 'staged', declaredSourceIds: [anchor.path, relatedMaterial.path] },
            { body: secondBody, origin: 'terminal', declaredSourceIds: [] },
        ];
        const currentMaterials = new Map(materials());
        currentMaterials.set(third.path, third);
        const reads = new Map<string, number>();
        const cache = new PageletAgentCache();
        const controller = new PageletDeepDiscoverController({
            runtime: { run: async () => run },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: async (path) => {
                const count = (reads.get(path) ?? 0) + 1;
                reads.set(path, count);
                if (path === relatedMaterial.path && count === 3) {
                    throw new Error('late source read failed');
                }
                return currentMaterials.get(path) ?? null;
            },
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => 'evidence-1',
            controllerEpoch: 1,
            isPathAllowed: () => true,
            cache,
            now: () => 5_000,
        });

        const verified = await controller.run({
            path: anchor.path,
            triggerReason: 'explicit',
            force: true,
        });

        expect(reads.get(relatedMaterial.path)).toBe(3);
        expect(reads.get(third.path)).toBe(3);
        expect(verified.status).toBe('verified');
        if (verified.status !== 'verified') throw new Error('expected current sibling');
        expect(verified.insights.map((insight) => insight.body)).toEqual([secondBody]);
        expect(verified.collection.collectionId).toBe(
            createPageletInsightCollectionId([verified.insight.insightId]),
        );
        expect(verified.insight.collectionId).toBe(verified.collection.collectionId);
    });

    it('retries the whole commit group when reading one insight changes an earlier sibling epoch', async () => {
        const firstBody = [
            '## 发布策略存在风险缺口',
            '`notes/anchor.md` 要求验证反馈后再发布；',
            '`notes/related.md` 的直接发布会放大风险，因此发布假设发生冲突。',
        ].join('\n');
        const secondBody = [
            '## 回滚检查点缺失',
            '`notes/anchor.md` 的验证反馈没有形成回滚检查点；',
            '`notes/third.md` 说明缺失会导致行动风险。',
        ].join('\n');
        const thirdContent = '# Third\n回滚检查点缺失会导致行动风险';
        const third: PageletAgentSourceMaterial = {
            path: 'notes/third.md',
            content: thirdContent,
            mtime: 12,
            size: thirdContent.length,
            contentHash: 'c'.repeat(64),
            capturedAt: 102,
        };
        const run = makeRun(secondBody);
        run.sourceSnapshots.push({ ...third });
        run.sourceTools = new Map([
            ...run.sourceTools,
            [third.path, new Set(['inspect_obsidian_note'])],
        ]);
        run.toolProvenance.push({
            toolName: 'inspect_obsidian_note',
            sourceRecords: [{ kind: 'context-used', dedupKey: third.path, path: third.path }],
            isError: false,
            promptText: third.content,
        });
        run.insightDrafts = [
            { body: firstBody, origin: 'staged', declaredSourceIds: [anchor.path, relatedMaterial.path] },
            { body: secondBody, origin: 'terminal', declaredSourceIds: [] },
        ];
        const currentMaterials = new Map(materials());
        currentMaterials.set(third.path, third);
        let epoch = 'evidence-1';
        const reads = new Map<string, number>();
        const controller = new PageletDeepDiscoverController({
            runtime: { run: async () => run },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: async (path) => {
                const count = (reads.get(path) ?? 0) + 1;
                reads.set(path, count);
                if (path === third.path && count === 3) {
                    currentMaterials.set(relatedMaterial.path, {
                        ...relatedMaterial,
                        contentHash: 'changed-after-first-sibling',
                    });
                    epoch = 'evidence-2';
                }
                return currentMaterials.get(path) ?? null;
            },
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => epoch,
            controllerEpoch: 1,
            isPathAllowed: () => true,
            now: () => 6_000,
        });

        const verified = await controller.run({
            path: anchor.path,
            triggerReason: 'explicit',
            force: true,
        });

        expect(verified.status).toBe('verified');
        if (verified.status !== 'verified') throw new Error('expected stable healthy sibling');
        expect(verified.insights.map((insight) => insight.body)).toEqual([secondBody]);
        expect(reads.get(relatedMaterial.path)).toBe(4);
        expect(reads.get(third.path)).toBe(4);
        expect(verified.collection.collectionId).toBe(
            createPageletInsightCollectionId([verified.insight.insightId]),
        );
    });

    it.each(['request-abort', 'controller-cancel', 'controller-dispose'] as const)(
        'does not commit or publish a fresh result after %s enters the final source-read window',
        async (mode) => {
            const body = [
                '## 发布策略存在风险缺口',
                '`notes/anchor.md` 要求验证反馈后再发布；',
                '`notes/related.md` 的直接发布会放大风险，因此发布假设发生冲突。',
            ].join('\n');
            const currentMaterials = materials();
            const sourceRead = createDeferredSourceRead(
                relatedMaterial.path,
                3,
                () => currentMaterials,
            );
            const requestAbort = new AbortController();
            const cache = new PageletAgentCache();
            const onResult = jest.fn();
            const onRunComplete = jest.fn();
            const controller = new PageletDeepDiscoverController({
                runtime: { run: async () => makeRun(body) },
                captureSnapshot: async () => anchor,
                captureSourceMaterial: sourceRead.captureSourceMaterial,
                getPolicyIdentity: () => policyIdentity,
                getEvidenceEpoch: () => 'evidence-1',
                controllerEpoch: 1,
                isPathAllowed: () => true,
                cache,
                onResult,
                onRunComplete,
            });

            const pending = controller.run({
                path: anchor.path,
                triggerReason: 'explicit',
                force: true,
                ...(mode === 'request-abort' ? { signal: requestAbort.signal } : {}),
            });
            await sourceRead.blocked;
            if (mode === 'request-abort') requestAbort.abort();
            if (mode === 'controller-cancel') controller.cancel();
            if (mode === 'controller-dispose') controller.dispose();
            sourceRead.release();

            await expect(pending).resolves.toMatchObject({
                status: 'quiet',
                reason: 'aborted',
                metrics: { modelTurns: 2, toolCalls: 2, wallTimeMs: 100 },
                runtimeCompletion: { loopStatus: 'completed' },
            });
            expect(cache.getMutationSnapshot()).toEqual({ version: 0, entryCount: 0 });
            expect(onRunComplete).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'quiet', reason: 'aborted' }),
                expect.any(Object),
                expect.objectContaining({ cacheAfter: { version: 0, entryCount: 0 } }),
            );
            expect(onResult).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'quiet', reason: 'aborted' }),
                expect.any(Object),
            );
            expect(onResult).not.toHaveBeenCalledWith(
                expect.objectContaining({ status: 'verified' }),
                expect.any(Object),
            );
        },
    );

    it('does not commit when abort is queued at the final fresh-helper return boundary', async () => {
        const body = [
            '## 发布策略存在风险缺口',
            '`notes/anchor.md` 要求验证反馈后再发布；',
            '`notes/related.md` 的直接发布会放大风险，因此发布假设发生冲突。',
        ].join('\n');
        const requestAbort = new AbortController();
        const cache = new PageletAgentCache();
        let epochReads = 0;
        const controller = new PageletDeepDiscoverController({
            runtime: { run: async () => makeRun(body) },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: async (path) => materials().get(path) ?? null,
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => {
                epochReads += 1;
                if (epochReads === 2) queueMicrotask(() => requestAbort.abort());
                return 'evidence-1';
            },
            controllerEpoch: 1,
            isPathAllowed: () => true,
            cache,
        });

        await expect(controller.run({
            path: anchor.path,
            triggerReason: 'explicit',
            force: true,
            signal: requestAbort.signal,
        })).resolves.toMatchObject({
            status: 'quiet',
            reason: 'aborted',
            metrics: { modelTurns: 2, toolCalls: 2, wallTimeMs: 100 },
            runtimeCompletion: { loopStatus: 'completed' },
        });
        expect(epochReads).toBe(2);
        expect(cache.getMutationSnapshot()).toEqual({ version: 0, entryCount: 0 });
    });

    it('revalidates the whole fresh group when source evidence changes in the final source-read window', async () => {
        const body = [
            '## 发布策略存在风险缺口',
            '`notes/anchor.md` 要求验证反馈后再发布；',
            '`notes/related.md` 的直接发布会放大风险，因此发布假设发生冲突。',
        ].join('\n');
        const cache = new PageletAgentCache();
        let epoch = 'evidence-1';
        let currentMaterials = materials();
        const sourceRead = createDeferredSourceRead(
            relatedMaterial.path,
            3,
            () => currentMaterials,
        );
        const controller = new PageletDeepDiscoverController({
            runtime: { run: async () => makeRun(body) },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: sourceRead.captureSourceMaterial,
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => epoch,
            controllerEpoch: 1,
            isPathAllowed: () => true,
            cache,
        });

        const pending = controller.run({
            path: anchor.path,
            triggerReason: 'explicit',
            force: true,
        });
        await sourceRead.blocked;
        currentMaterials = new Map(currentMaterials);
        currentMaterials.set(relatedMaterial.path, {
            ...relatedMaterial,
            contentHash: 'changed-in-final-source-window',
        });
        epoch = 'evidence-2';
        sourceRead.release();

        await expect(pending).resolves.toMatchObject({
            status: 'quiet',
            reason: 'stale-source',
            metrics: { modelTurns: 2, toolCalls: 2, wallTimeMs: 100 },
        });
        expect(cache.getMutationSnapshot()).toEqual({ version: 0, entryCount: 0 });
    });

    it('retries an epoch-only final-read drift and seals the stable retry', async () => {
        const body = [
            '## 发布策略存在风险缺口',
            '`notes/anchor.md` 要求验证反馈后再发布；',
            '`notes/related.md` 的直接发布会放大风险，因此发布假设发生冲突。',
        ].join('\n');
        const currentMaterials = materials();
        const sourceRead = createDeferredSourceRead(
            relatedMaterial.path,
            3,
            () => currentMaterials,
        );
        let epoch = 'evidence-1';
        const cache = new PageletAgentCache();
        const controller = new PageletDeepDiscoverController({
            runtime: { run: async () => makeRun(body) },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: sourceRead.captureSourceMaterial,
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => epoch,
            controllerEpoch: 7,
            isPathAllowed: () => true,
            cache,
        });

        const pending = controller.run({
            path: anchor.path,
            triggerReason: 'explicit',
            force: true,
        });
        await sourceRead.blocked;
        epoch = 'evidence-2';
        sourceRead.release();

        await expect(pending).resolves.toMatchObject({
            status: 'verified',
            commitSeal: {
                schemaVersion: 1,
                controllerEpoch: 7,
                evidenceEpoch: 'evidence-2',
                policyIdentityKey: pageletAgentPolicyIdentityKey(policyIdentity),
            },
        });
        expect(cache.getMutationSnapshot()).toEqual({ version: 1, entryCount: 1 });
    });

    it.each(['policy', 'boundary'] as const)(
        'fails fresh commit closed when %s changes during the final source read',
        async (change) => {
            const body = [
                '## 发布策略存在风险缺口',
                '`notes/anchor.md` 要求验证反馈后再发布；',
                '`notes/related.md` 的直接发布会放大风险，因此发布假设发生冲突。',
            ].join('\n');
            const currentMaterials = materials();
            const sourceRead = createDeferredSourceRead(
                relatedMaterial.path,
                3,
                () => currentMaterials,
            );
            let currentPolicy = policyIdentity;
            let relatedAllowed = true;
            const cache = new PageletAgentCache();
            const controller = new PageletDeepDiscoverController({
                runtime: { run: async () => makeRun(body) },
                captureSnapshot: async () => anchor,
                captureSourceMaterial: sourceRead.captureSourceMaterial,
                getPolicyIdentity: () => currentPolicy,
                getEvidenceEpoch: () => 'evidence-1',
                controllerEpoch: 1,
                isPathAllowed: (path) => path !== relatedMaterial.path || relatedAllowed,
                cache,
            });

            const pending = controller.run({
                path: anchor.path,
                triggerReason: 'explicit',
                force: true,
            });
            await sourceRead.blocked;
            if (change === 'policy') {
                currentPolicy = { ...policyIdentity, dataBoundaryIdentity: 'boundary-2' };
            } else {
                relatedAllowed = false;
            }
            sourceRead.release();

            await expect(pending).resolves.toMatchObject(change === 'policy'
                ? { status: 'stale', reason: 'policy-identity-changed' }
                : { status: 'quiet', reason: 'stale-source' });
            expect(cache.getMutationSnapshot()).toEqual({ version: 0, entryCount: 0 });
        },
    );

    it('retries an epoch-only cache read drift and seals the cache hit under the new epoch', async () => {
        const cache = new PageletAgentCache();
        cache.put(verifiedInsight());
        const currentMaterials = materials();
        const sourceRead = createDeferredSourceRead(
            relatedMaterial.path,
            1,
            () => currentMaterials,
        );
        let epoch = 'evidence-1';
        const runtimeRun = jest.fn();
        const controller = new PageletDeepDiscoverController({
            runtime: { run: runtimeRun as never },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: sourceRead.captureSourceMaterial,
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => epoch,
            controllerEpoch: 7,
            isPathAllowed: () => true,
            cache,
        });

        const pending = controller.run({
            path: anchor.path,
            triggerReason: 'explicit',
        });
        await sourceRead.blocked;
        epoch = 'evidence-2';
        sourceRead.release();

        await expect(pending).resolves.toMatchObject({
            status: 'cache-hit',
            commitSeal: {
                schemaVersion: 1,
                controllerEpoch: 7,
                evidenceEpoch: 'evidence-2',
                policyIdentityKey: pageletAgentPolicyIdentityKey(policyIdentity),
            },
        });
        expect(runtimeRun).not.toHaveBeenCalled();
        expect(cache.getMutationSnapshot()).toEqual({ version: 1, entryCount: 1 });
    });

    it('does not publish or regroup cache when abort is queued at the final cache-helper boundary', async () => {
        const cache = new PageletAgentCache();
        const first = verifiedInsight();
        const third: PageletAgentSourceSnapshot = {
            path: 'notes/third.md',
            mtime: 12,
            size: 30,
            contentHash: 'c'.repeat(64),
        };
        const second = verifiedSibling(
            '`notes/anchor.md` 与 `notes/third.md` 揭示回滚检查点缺失的行动风险。',
            [snapshots()[0]!, third],
        );
        const collectionId = createPageletInsightCollectionId([first.insightId, second.insightId]);
        first.collectionId = collectionId;
        second.collectionId = collectionId;
        cache.putCollection({
            collectionId,
            anchor: first.anchor,
            insights: [first, second],
            preparedAt: first.preparedAt,
        });
        const requestAbort = new AbortController();
        const runtimeRun = jest.fn();
        let epochReads = 0;
        const controller = new PageletDeepDiscoverController({
            runtime: { run: runtimeRun as never },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: async (path) => materials().get(path) ?? null,
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => {
                epochReads += 1;
                if (epochReads === 4) queueMicrotask(() => requestAbort.abort());
                return 'evidence-1';
            },
            controllerEpoch: 1,
            isPathAllowed: () => true,
            cache,
        });

        await expect(controller.run({
            path: anchor.path,
            triggerReason: 'explicit',
            signal: requestAbort.signal,
        })).resolves.toEqual({ status: 'quiet', reason: 'aborted' });
        expect(epochReads).toBe(4);
        expect(runtimeRun).not.toHaveBeenCalled();
        expect(cache.getMutationSnapshot()).toEqual({ version: 1, entryCount: 1 });
    });

    it('does not let policy-drift cleanup delete a newer cache entry', async () => {
        const cache = new PageletAgentCache();
        cache.put(verifiedInsight());
        const nextPolicy = {
            ...policyIdentity,
            dataBoundaryIdentity: 'boundary-2',
        };
        const replacement = verifiedSibling(
            '`notes/anchor.md` 与 `notes/related.md` 揭示新的策略校验缺口。',
            snapshots(),
        );
        replacement.cacheIdentity = createPageletAgentCacheIdentity({
            anchor,
            sources: snapshots(),
            policyIdentity: nextPolicy,
        });
        replacement.cacheIdentityHash = hashPageletAgentCacheIdentity(
            replacement.cacheIdentity,
        );
        let currentPolicy = policyIdentity;
        let epochReads = 0;
        const runtimeRun = jest.fn();
        const controller = new PageletDeepDiscoverController({
            runtime: { run: runtimeRun as never },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: async (path) => materials().get(path) ?? null,
            getPolicyIdentity: () => currentPolicy,
            getEvidenceEpoch: () => {
                epochReads += 1;
                if (epochReads === 3) {
                    queueMicrotask(() => {
                        currentPolicy = nextPolicy;
                        cache.put(replacement);
                    });
                }
                return 'evidence-1';
            },
            controllerEpoch: 1,
            isPathAllowed: () => true,
            cache,
        });

        await expect(controller.run({
            path: anchor.path,
            triggerReason: 'explicit',
        })).resolves.toEqual({
            status: 'stale',
            reason: 'policy-identity-changed',
        });
        expect(runtimeRun).not.toHaveBeenCalled();
        await expect(cache.getValidCollection({
            anchor,
            policyIdentity: nextPolicy,
            readSourceSnapshot: async (path) => (
                snapshots().find((source) => source.path === path) ?? null
            ),
            isPathAllowed: () => true,
            now: 2_000,
        })).resolves.toMatchObject({
            collectionId: replacement.collectionId,
            insights: [{ insightId: replacement.insightId }],
        });
        expect(cache.getMutationSnapshot()).toEqual({ version: 2, entryCount: 1 });
    });

    it('does not return a cache hit after abort enters the final cache source-read window', async () => {
        const requestAbort = new AbortController();
        const cache = new PageletAgentCache();
        cache.put(verifiedInsight());
        const currentMaterials = materials();
        const sourceRead = createDeferredSourceRead(
            relatedMaterial.path,
            1,
            () => currentMaterials,
        );
        const runtimeRun = jest.fn();
        const onResult = jest.fn();
        const controller = new PageletDeepDiscoverController({
            runtime: { run: runtimeRun as never },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: sourceRead.captureSourceMaterial,
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => 'evidence-1',
            controllerEpoch: 1,
            isPathAllowed: () => true,
            cache,
            onResult,
        });

        const pending = controller.run({
            path: anchor.path,
            triggerReason: 'explicit',
            signal: requestAbort.signal,
        });
        await sourceRead.blocked;
        requestAbort.abort();
        sourceRead.release();

        await expect(pending).resolves.toEqual({ status: 'quiet', reason: 'aborted' });
        expect(runtimeRun).not.toHaveBeenCalled();
        expect(cache.getMutationSnapshot()).toEqual({ version: 1, entryCount: 1 });
        expect(onResult).not.toHaveBeenCalledWith(
            expect.objectContaining({ status: 'cache-hit' }),
            expect.any(Object),
        );
    });

    it('fails delivered-action validation closed when abort enters the final source-read window', async () => {
        const requestAbort = new AbortController();
        const currentMaterials = materials();
        const sourceRead = createDeferredSourceRead(
            relatedMaterial.path,
            1,
            () => currentMaterials,
        );
        const controller = new PageletDeepDiscoverController({
            runtime: { run: jest.fn() as never },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: sourceRead.captureSourceMaterial,
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => 'evidence-1',
            controllerEpoch: 1,
            isPathAllowed: () => true,
        });
        const identity = pageletAgentInsightToDeliveryCandidate(
            verifiedInsight(),
            'en',
        ).pageletAgent.validationIdentity;

        const pending = controller.validateInsight(identity, requestAbort.signal);
        await sourceRead.blocked;
        requestAbort.abort();
        sourceRead.release();

        await expect(pending).resolves.toBe(false);
    });

    it('fails delivered-action validation closed when the controller is disposed mid-read', async () => {
        const currentMaterials = materials();
        const sourceRead = createDeferredSourceRead(
            relatedMaterial.path,
            1,
            () => currentMaterials,
        );
        const controller = new PageletDeepDiscoverController({
            runtime: { run: jest.fn() as never },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: sourceRead.captureSourceMaterial,
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => 'evidence-1',
            controllerEpoch: 1,
            isPathAllowed: () => true,
        });
        const identity = pageletAgentInsightToDeliveryCandidate(
            verifiedInsight(),
            'en',
        ).pageletAgent.validationIdentity;

        const pending = controller.validateInsight(identity);
        await sourceRead.blocked;
        controller.dispose();
        sourceRead.release();

        await expect(pending).resolves.toBe(false);
    });

    it('fails delivered-action validation closed when a source leaves the boundary mid-read', async () => {
        const currentMaterials = materials();
        const sourceRead = createDeferredSourceRead(
            relatedMaterial.path,
            1,
            () => currentMaterials,
        );
        let relatedAllowed = true;
        const controller = new PageletDeepDiscoverController({
            runtime: { run: jest.fn() as never },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: sourceRead.captureSourceMaterial,
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => 'evidence-1',
            controllerEpoch: 1,
            isPathAllowed: (path) => path !== relatedMaterial.path || relatedAllowed,
        });
        const identity = pageletAgentInsightToDeliveryCandidate(
            verifiedInsight(),
            'en',
        ).pageletAgent.validationIdentity;

        const pending = controller.validateInsight(identity);
        await sourceRead.blocked;
        relatedAllowed = false;
        sourceRead.release();

        await expect(pending).resolves.toBe(false);
    });

    it('retries a cached collection under the new epoch and preserves only the healthy sibling', async () => {
        const cache = new PageletAgentCache();
        const first = verifiedInsight();
        const third: PageletAgentSourceSnapshot = {
            path: 'notes/third.md',
            mtime: 12,
            size: 30,
            contentHash: 'c'.repeat(64),
        };
        const second = verifiedSibling(
            '`notes/anchor.md` 与 `notes/third.md` 揭示回滚检查点缺失的行动风险。',
            [snapshots()[0]!, third],
        );
        const collectionId = createPageletInsightCollectionId([first.insightId, second.insightId]);
        first.collectionId = collectionId;
        second.collectionId = collectionId;
        cache.putCollection({
            collectionId,
            anchor: first.anchor,
            insights: [first, second],
            preparedAt: first.preparedAt,
        });
        let epoch = 'cache-epoch-1';
        let relatedCurrent: PageletAgentSourceSnapshot = snapshots()[1]!;
        let thirdReads = 0;

        const current = await cache.getValidCollection({
            anchor,
            policyIdentity,
            getEvidenceEpoch: () => epoch,
            readSourceSnapshot: async (path) => {
                if (path === relatedMaterial.path) return relatedCurrent;
                if (path === third.path) {
                    thirdReads += 1;
                    if (thirdReads === 1) {
                        relatedCurrent = { ...relatedCurrent, contentHash: 'changed-during-b' };
                        epoch = 'cache-epoch-2';
                    }
                    return third;
                }
                return snapshots().find((source) => source.path === path) ?? null;
            },
            isPathAllowed: () => true,
            now: 2_000,
        });

        expect(thirdReads).toBe(2);
        expect(current?.insights.map((insight) => insight.insightId)).toEqual([second.insightId]);
        expect(current?.collectionId).toBe(createPageletInsightCollectionId([second.insightId]));
    });

    it('projects complete immutable action and Chat context without hidden runtime fields', () => {
        const body = `## Complete insight\n${'source-backed detail '.repeat(40)}`;
        const insight = {
            ...verifiedInsight(true),
            body,
            metrics: { modelTurns: 99, toolCalls: 88, wallTimeMs: 77 },
            webObservations: [
                { url: 'https://example.com/evidence', observationHash: 'one' },
                { url: 'https://example.com/evidence', observationHash: 'two' },
            ],
        };

        const candidate = pageletAgentInsightToDeliveryCandidate(insight, 'en');

        expect(candidate.pageletAgent.directAction).toEqual({
            kind: 'link-related',
            candidateId: insight.insightId,
            anchorPath: 'notes/anchor.md',
            sourcePath: 'notes/related.md',
            label: 'Link “related” from “anchor”',
        });
        expect(candidate.pageletAgent.handoff).toMatchObject({
            version: 1,
            id: insight.insightId,
            body,
            anchor: insight.anchor,
            sources: insight.sources,
            sourceRefs: [
                { path: 'notes/anchor.md', title: 'anchor' },
                { path: 'notes/related.md', title: 'related' },
            ],
            webUrls: ['https://example.com/evidence'],
            triggerReason: 'explicit',
            preparedAt: 1_000,
            pipelineVersion: 'pagelet-deep-discover-v2',
        });
        expect(Object.keys(candidate.pageletAgent.handoff).sort()).toEqual([
            'anchor',
            'body',
            'id',
            'pipelineVersion',
            'preparedAt',
            'sourceRefs',
            'sources',
            'triggerReason',
            'version',
            'webUrls',
            'whyNow',
        ]);
        expect(candidate.pageletAgent.handoff).not.toHaveProperty('metrics');
        expect(Object.isFrozen(candidate.pageletAgent.handoff)).toBe(true);
        expect(Object.isFrozen(candidate.pageletAgent.validationIdentity.cacheIdentity.sources)).toBe(true);
    });

    it('omits the direct route when no verified non-anchor source exists', () => {
        const insight = verifiedInsight();
        insight.sources = [{ ...insight.anchor }];
        insight.sourceRefs = [{ path: insight.anchor.path }];
        insight.cacheIdentity = {
            ...insight.cacheIdentity,
            sources: [{ ...insight.anchor }],
        };
        insight.cacheIdentityHash = hashPageletAgentCacheIdentity(insight.cacheIdentity);

        const candidate = pageletAgentInsightToDeliveryCandidate(insight, 'en');

        expect(candidate.pageletAgent.directAction).toBeUndefined();
        expect(candidate.pageletAgent.handoff.body).toBe(insight.body);
    });

    it('revalidates exact policy and source snapshots without invoking the provider runtime', async () => {
        const runtimeRun = jest.fn();
        let currentPolicy = policyIdentity;
        let currentMaterials = materials();
        const captureSourceMaterial = jest.fn(async (path: string) => currentMaterials.get(path) ?? null);
        const controller = new PageletDeepDiscoverController({
            runtime: { run: runtimeRun as never },
            captureSnapshot: async () => anchor,
            captureSourceMaterial,
            getPolicyIdentity: () => currentPolicy,
            getEvidenceEpoch: () => 'evidence-1',
            controllerEpoch: 1,
            isPathAllowed: () => true,
            now: () => 2_000,
        });
        const identity = pageletAgentInsightToDeliveryCandidate(
            verifiedInsight(),
            'en',
        ).pageletAgent.validationIdentity;

        await expect(controller.validateInsight(identity)).resolves.toBe(true);
        expect(runtimeRun).not.toHaveBeenCalled();

        currentMaterials = new Map(materials());
        currentMaterials.set(relatedMaterial.path, { ...relatedMaterial, contentHash: 'changed' });
        await expect(controller.validateInsight(identity)).resolves.toBe(false);

        currentMaterials = materials();
        currentPolicy = { ...policyIdentity, dataBoundaryIdentity: 'boundary-2' };
        await expect(controller.validateInsight(identity)).resolves.toBe(false);
        expect(runtimeRun).not.toHaveBeenCalled();
    });

    it('fails an action closed when reading source B changes already-validated source A', async () => {
        const identity = pageletAgentInsightToDeliveryCandidate(
            verifiedInsight(),
            'en',
        ).pageletAgent.validationIdentity;
        let epoch = 'action-epoch-1';
        let currentAnchor: PageletAgentSourceMaterial = anchorMaterial;
        let anchorReads = 0;
        const controller = new PageletDeepDiscoverController({
            runtime: { run: jest.fn() as never },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: async (path) => {
                if (path === anchor.path) {
                    anchorReads += 1;
                    return currentAnchor;
                }
                if (path === relatedMaterial.path && epoch === 'action-epoch-1') {
                    currentAnchor = { ...anchorMaterial, contentHash: 'changed-during-source-b' };
                    epoch = 'action-epoch-2';
                }
                return materials().get(path) ?? null;
            },
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => epoch,
            controllerEpoch: 1,
            isPathAllowed: () => true,
        });

        await expect(controller.validateInsight(identity)).resolves.toBe(false);
        expect(anchorReads).toBe(2);
    });

    it('expires a delivered web-backed validation identity at the reuse boundary', async () => {
        const insight = verifiedInsight(true);
        const identity = pageletAgentInsightToDeliveryCandidate(insight, 'en')
            .pageletAgent.validationIdentity;
        const runtimeRun = jest.fn();
        const controller = new PageletDeepDiscoverController({
            runtime: { run: runtimeRun as never },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: async (path) => materials().get(path) ?? null,
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => 'evidence-1',
            controllerEpoch: 1,
            isPathAllowed: () => true,
            now: () => insight.preparedAt + 24 * 60 * 60 * 1000,
        });

        await expect(controller.validateInsight(identity)).resolves.toBe(false);
        expect(runtimeRun).not.toHaveBeenCalled();
    });

    it('exposes the same provider-free validation through the scheduler seam', async () => {
        const identity = pageletAgentInsightToDeliveryCandidate(
            verifiedInsight(),
            'en',
        ).pageletAgent.validationIdentity;
        const controller = new PageletDeepDiscoverController({
            runtime: { run: jest.fn() as never },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: async (path) => materials().get(path) ?? null,
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => 'evidence-1',
            controllerEpoch: 1,
            isPathAllowed: () => true,
        });
        const scheduler = new PageletDeepDiscoverScheduler({ controller, delayMs: 0 });

        await expect(scheduler.validateInsight(identity)).resolves.toBe(true);
        scheduler.dispose();
        await expect(scheduler.validateInsight(identity)).resolves.toBe(false);
    });

    it('uses the trigger-time anchor snapshot instead of recapturing after scheduling', async () => {
        const runtimeRun = jest.fn(async (_request: unknown) => makeRun([
            '## 发布策略存在风险缺口',
            '`notes/anchor.md` 要求验证反馈后再发布；',
            '`notes/related.md` 的直接发布会放大风险，因此发布假设发生冲突。',
        ].join('\n')));
        const captureSnapshot = jest.fn(async () => null);
        const controller = new PageletDeepDiscoverController({
            runtime: { run: runtimeRun },
            captureSnapshot,
            captureSourceMaterial: async (path) => materials().get(path) ?? null,
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => 'evidence-1',
            controllerEpoch: 1,
            isPathAllowed: () => true,
        });

        const result = await controller.run({
            path: anchor.path,
            triggerReason: 'leave-note',
            anchorSnapshot: anchor,
        });

        expect(result.status).toBe('verified');
        expect(captureSnapshot).not.toHaveBeenCalled();
        expect(runtimeRun).toHaveBeenCalledWith(expect.objectContaining({
            anchor,
            triggerReason: 'leave-note',
        }));
    });

    it.each([
        ['explicit', '你刚刚请拾页深入看看。'],
        ['leave-note', '离开这篇笔记时，一条有用的关联浮现了。'],
        ['edit-idle', '刚才的编辑告一段落后，一条有用的关联浮现了。'],
        ['open-changed-note', '重新打开这篇有变化的笔记时，一条有用的关联浮现了。'],
        ['future-trigger-id', '一条值得留意的关联刚刚浮现了。'],
    ])('localizes the %s trigger without exposing its internal ID', (triggerReason, expected) => {
        const candidate = pageletAgentInsightToDeliveryCandidate({
            ...verifiedInsight(),
            triggerReason,
        }, 'zh');

        expect(candidate.whyNow).toEqual([expected]);
        expect(candidate.whyNow.join(' ')).not.toContain(triggerReason);
    });

    it('keeps a heading insight receipt stable across proactive trigger reasons', () => {
        const body = [
            '## 发布策略存在风险缺口',
            '`notes/anchor.md` 要求验证反馈后再发布；',
            '`notes/related.md` 的直接发布会放大风险，因此发布假设发生冲突。',
        ].join('\n');
        const insight = {
            ...verifiedInsight(),
            body,
            normalizedBody: normalizePageletInsightBody(body),
        };
        const afterLeave = pageletAgentInsightToDeliveryCandidate({
            ...insight,
            triggerReason: 'leave-note',
        }, 'zh');
        const afterEdit = pageletAgentInsightToDeliveryCandidate({
            ...insight,
            triggerReason: 'edit-idle',
        }, 'zh');

        expect(afterLeave.title).toBe('发布策略存在风险缺口');
        expect(afterLeave.whyNow).not.toEqual(afterEdit.whyNow);
        expect(afterLeave.deliveryReceipt).toEqual(afterEdit.deliveryReceipt);
    });

    it('rejects a seen proactive insight while preserving its Markdown heading for identity', async () => {
        const body = [
            '## 发布策略存在风险缺口',
            '`notes/anchor.md` 要求验证反馈后再发布；',
            '`notes/related.md` 的直接发布会放大风险，因此发布假设发生冲突。',
        ].join('\n');
        const isSeen = jest.fn((input: {
            body: string;
            normalizedBody: string;
        }) => (
            input.body === body
            && input.normalizedBody === normalizePageletInsightBody(body)
        ));
        const controller = new PageletDeepDiscoverController({
            runtime: { run: async () => makeRun(body) },
            captureSnapshot: async () => anchor,
            captureSourceMaterial: async (path) => materials().get(path) ?? null,
            getPolicyIdentity: () => policyIdentity,
            getEvidenceEpoch: () => 'evidence-1',
            controllerEpoch: 1,
            isPathAllowed: () => true,
            isSeen,
        });

        const result = await controller.run({
            path: anchor.path,
            triggerReason: 'open-changed-note',
        });

        expect(result).toEqual(expect.objectContaining({
            status: 'quiet',
            reason: 'seen',
        }));
        expect(isSeen).toHaveBeenCalledWith(expect.objectContaining({
            body,
            normalizedBody: normalizePageletInsightBody(body),
        }));
    });

    it('coalesces scheduled triggers for the same path without owning plugin or UI state', async () => {
        let scheduled: (() => void) | undefined;
        const run = jest.fn(async (_request: unknown) => ({ status: 'quiet', reason: 'no-insight' } as const));
        const scheduler = new PageletDeepDiscoverScheduler({
            controller: {
                run,
                dispose: jest.fn(),
            } as unknown as PageletDeepDiscoverController,
            delayMs: 5_000,
            setTimer: (callback) => {
                scheduled = callback;
                return 1 as unknown as ReturnType<typeof setTimeout>;
            },
            clearTimer: jest.fn(),
        });

        const first = scheduler.schedule({ path: anchor.path, triggerReason: 'edit-idle' });
        const second = scheduler.schedule({ path: anchor.path, triggerReason: 'open-changed-note' });
        scheduled?.();
        const [firstResult, secondResult] = await Promise.all([first, second]);

        expect(run).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith({
            path: anchor.path,
            triggerReason: 'open-changed-note',
        });
        expect(firstResult).toEqual(secondResult);
    });

    it('serializes automatic triggers for different paths without dropping either run', async () => {
        const scheduled: Array<() => void> = [];
        let activeRuns = 0;
        let maxActiveRuns = 0;
        let releaseFirstRun: (() => void) | undefined;
        const firstRunBlocked = new Promise<void>((resolve) => {
            releaseFirstRun = resolve;
        });
        let notifyFirstRunStarted: (() => void) | undefined;
        const firstRunStarted = new Promise<void>((resolve) => {
            notifyFirstRunStarted = resolve;
        });
        const run = jest.fn(async (request: { path: string }) => {
            activeRuns += 1;
            maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
            if (request.path === 'notes/a.md') {
                notifyFirstRunStarted?.();
                await firstRunBlocked;
            }
            activeRuns -= 1;
            return { status: 'quiet', reason: 'no-insight' } as const;
        });
        const scheduler = new PageletDeepDiscoverScheduler({
            controller: {
                run,
                dispose: jest.fn(),
            } as unknown as PageletDeepDiscoverController,
            delayMs: 5_000,
            setTimer: (callback) => {
                scheduled.push(callback);
                return scheduled.length as unknown as ReturnType<typeof setTimeout>;
            },
            clearTimer: jest.fn(),
        });

        const first = scheduler.schedule({
            path: 'notes/a.md',
            triggerReason: 'leave-note',
        });
        const second = scheduler.schedule({
            path: 'notes/b.md',
            triggerReason: 'open-changed-note',
        });
        scheduled[0]?.();
        scheduled[1]?.();
        await firstRunStarted;

        expect(run).toHaveBeenCalledTimes(1);

        releaseFirstRun?.();
        await Promise.all([first, second]);

        expect(run.mock.calls.map(([request]) => request.path)).toEqual([
            'notes/a.md',
            'notes/b.md',
        ]);
        expect(maxActiveRuns).toBe(1);
    });

    it('lets an explicit run preempt automatic work without allowing queued automatic work to preempt it', async () => {
        const scheduled: Array<() => void> = [];
        const releases = new Map<string, () => void>();
        let activeRuns = 0;
        let maxActiveRuns = 0;
        let notifyFirstStarted: (() => void) | undefined;
        let notifyExplicitStarted: (() => void) | undefined;
        let notifySecondStarted: (() => void) | undefined;
        const firstStarted = new Promise<void>((resolve) => {
            notifyFirstStarted = resolve;
        });
        const explicitStarted = new Promise<void>((resolve) => {
            notifyExplicitStarted = resolve;
        });
        const secondStarted = new Promise<void>((resolve) => {
            notifySecondStarted = resolve;
        });
        const run = jest.fn((request: { path: string }) => {
            activeRuns += 1;
            maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
            if (request.path === 'notes/a.md') notifyFirstStarted?.();
            if (request.path === 'notes/explicit.md') notifyExplicitStarted?.();
            if (request.path === 'notes/b.md') notifySecondStarted?.();
            return new Promise<PageletDeepDiscoverControllerResult>((resolve) => {
                releases.set(request.path, () => {
                    activeRuns -= 1;
                    resolve({ status: 'quiet', reason: 'no-insight' });
                });
            });
        });
        const cancel = jest.fn();
        const scheduler = new PageletDeepDiscoverScheduler({
            controller: {
                run,
                cancel,
                dispose: jest.fn(),
            } as unknown as PageletDeepDiscoverController,
            delayMs: 5_000,
            setTimer: (callback) => {
                scheduled.push(callback);
                return scheduled.length as unknown as ReturnType<typeof setTimeout>;
            },
            clearTimer: jest.fn(),
        });

        const first = scheduler.schedule({
            path: 'notes/a.md',
            triggerReason: 'leave-note',
        });
        const second = scheduler.schedule({
            path: 'notes/b.md',
            triggerReason: 'open-changed-note',
        });
        scheduled[0]?.();
        scheduled[1]?.();
        await firstStarted;

        const explicit = scheduler.runNow({
            path: 'notes/explicit.md',
            triggerReason: 'explicit',
            force: true,
        });
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(run.mock.calls.map(([request]) => request.path)).toEqual(['notes/a.md']);

        releases.get('notes/a.md')?.();
        await explicitStarted;
        expect(run.mock.calls.map(([request]) => request.path)).toEqual([
            'notes/a.md',
            'notes/explicit.md',
        ]);

        releases.get('notes/explicit.md')?.();
        await explicit;
        await secondStarted;
        expect(run.mock.calls.map(([request]) => request.path)).toEqual([
            'notes/a.md',
            'notes/explicit.md',
            'notes/b.md',
        ]);

        releases.get('notes/b.md')?.();
        await Promise.all([first, second]);
        expect(maxActiveRuns).toBe(1);
    });

    it('requeues a cross-anchor automatic run and merges a newer same-path trigger', async () => {
        const scheduled: Array<() => void> = [];
        const controlledRuns: Array<{
            request: { path: string; triggerReason: string };
            finish(result: PageletDeepDiscoverControllerResult): void;
        }> = [];
        let activeRuns = 0;
        let maxActiveRuns = 0;
        let notifyInterruptedStarted: (() => void) | undefined;
        let notifyExplicitStarted: (() => void) | undefined;
        let notifyResumedStarted: (() => void) | undefined;
        const interruptedStarted = new Promise<void>((resolve) => {
            notifyInterruptedStarted = resolve;
        });
        const explicitStarted = new Promise<void>((resolve) => {
            notifyExplicitStarted = resolve;
        });
        const resumedStarted = new Promise<void>((resolve) => {
            notifyResumedStarted = resolve;
        });
        const run = jest.fn((request: { path: string; triggerReason: string }) => {
            activeRuns += 1;
            maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
            const runIndex = controlledRuns.length;
            if (runIndex === 0) notifyInterruptedStarted?.();
            if (runIndex === 1) notifyExplicitStarted?.();
            if (runIndex === 2) notifyResumedStarted?.();
            return new Promise<PageletDeepDiscoverControllerResult>((resolve) => {
                controlledRuns.push({
                    request,
                    finish: (result) => {
                        activeRuns -= 1;
                        resolve(result);
                    },
                });
            });
        });
        const clearTimer = jest.fn();
        const scheduler = new PageletDeepDiscoverScheduler({
            controller: {
                run,
                cancel: jest.fn(),
                dispose: jest.fn(),
            } as unknown as PageletDeepDiscoverController,
            delayMs: 5_000,
            setTimer: (callback) => {
                scheduled.push(callback);
                return scheduled.length as unknown as ReturnType<typeof setTimeout>;
            },
            clearTimer,
        });

        const interrupted = scheduler.schedule({
            path: 'notes/automatic.md',
            triggerReason: 'leave-note',
        });
        scheduled[0]?.();
        await interruptedStarted;

        const explicit = scheduler.runNow({
            path: 'notes/explicit.md',
            triggerReason: 'explicit',
            force: true,
        });
        const newer = scheduler.schedule({
            path: 'notes/automatic.md',
            triggerReason: 'edit-idle',
        });

        controlledRuns[0].finish({ status: 'quiet', reason: 'aborted' });
        await explicitStarted;
        expect(controlledRuns.map(({ request }) => request)).toEqual([
            { path: 'notes/automatic.md', triggerReason: 'leave-note' },
            { path: 'notes/explicit.md', triggerReason: 'explicit', force: true },
        ]);

        controlledRuns[1].finish({ status: 'quiet', reason: 'no-insight' });
        await explicit;
        await resumedStarted;
        expect(controlledRuns[2].request).toEqual({
            path: 'notes/automatic.md',
            triggerReason: 'edit-idle',
        });

        const resumedResult = { status: 'quiet', reason: 'no-insight' } as const;
        controlledRuns[2].finish(resumedResult);
        await expect(Promise.all([interrupted, newer])).resolves.toEqual([
            resumedResult,
            resumedResult,
        ]);
        expect(clearTimer).toHaveBeenCalled();
        expect(maxActiveRuns).toBe(1);
    });

    it('does not requeue an automatic run superseded by an explicit run for the same anchor', async () => {
        const scheduled: Array<() => void> = [];
        const controlledRuns: Array<{
            finish(result: PageletDeepDiscoverControllerResult): void;
        }> = [];
        let notifyAutomaticStarted: (() => void) | undefined;
        let notifyExplicitStarted: (() => void) | undefined;
        const automaticStarted = new Promise<void>((resolve) => {
            notifyAutomaticStarted = resolve;
        });
        const explicitStarted = new Promise<void>((resolve) => {
            notifyExplicitStarted = resolve;
        });
        const run = jest.fn((_request: { path: string }) => {
            const runIndex = controlledRuns.length;
            if (runIndex === 0) notifyAutomaticStarted?.();
            if (runIndex === 1) notifyExplicitStarted?.();
            return new Promise<PageletDeepDiscoverControllerResult>((resolve) => {
                controlledRuns.push({ finish: resolve });
            });
        });
        const scheduler = new PageletDeepDiscoverScheduler({
            controller: {
                run,
                cancel: jest.fn(),
                dispose: jest.fn(),
            } as unknown as PageletDeepDiscoverController,
            delayMs: 5_000,
            setTimer: (callback) => {
                scheduled.push(callback);
                return scheduled.length as unknown as ReturnType<typeof setTimeout>;
            },
            clearTimer: jest.fn(),
        });

        const automatic = scheduler.schedule({
            path: 'notes/same.md',
            triggerReason: 'leave-note',
        });
        scheduled[0]?.();
        await automaticStarted;
        const explicit = scheduler.runNow({
            path: 'notes/same.md',
            triggerReason: 'explicit',
            force: true,
        });

        const aborted = { status: 'quiet', reason: 'aborted' } as const;
        controlledRuns[0].finish(aborted);
        await expect(automatic).resolves.toEqual(aborted);
        await explicitStarted;
        controlledRuns[1].finish({ status: 'quiet', reason: 'no-insight' });
        await explicit;

        expect(run).toHaveBeenCalledTimes(2);
    });

    it('resolves active, queued automatic, and queued explicit waiters when disposed', async () => {
        const scheduled: Array<() => void> = [];
        let notifyStarted: (() => void) | undefined;
        const started = new Promise<void>((resolve) => {
            notifyStarted = resolve;
        });
        const run = jest.fn((_request: { path: string }) => {
            notifyStarted?.();
            return new Promise<PageletDeepDiscoverControllerResult>(() => undefined);
        });
        const dispose = jest.fn();
        const scheduler = new PageletDeepDiscoverScheduler({
            controller: {
                run,
                cancel: jest.fn(),
                dispose,
            } as unknown as PageletDeepDiscoverController,
            delayMs: 5_000,
            setTimer: (callback) => {
                scheduled.push(callback);
                return scheduled.length as unknown as ReturnType<typeof setTimeout>;
            },
            clearTimer: jest.fn(),
        });

        const activeAutomatic = scheduler.schedule({
            path: 'notes/a.md',
            triggerReason: 'leave-note',
        });
        scheduled[0]?.();
        await started;
        const queuedAutomatic = scheduler.schedule({
            path: 'notes/b.md',
            triggerReason: 'open-changed-note',
        });
        scheduled[1]?.();
        const queuedExplicit = scheduler.runNow({
            path: 'notes/explicit.md',
            triggerReason: 'explicit',
            force: true,
        });

        scheduler.dispose();
        const results = await Promise.all([
            activeAutomatic,
            queuedAutomatic,
            queuedExplicit,
            scheduler.runNow({
                path: 'notes/after-dispose.md',
                triggerReason: 'explicit',
                force: true,
            }),
        ]);

        expect(results).toEqual([
            { status: 'quiet', reason: 'aborted' },
            { status: 'quiet', reason: 'aborted' },
            { status: 'quiet', reason: 'aborted' },
            { status: 'quiet', reason: 'aborted' },
        ]);
        expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('resolves an active explicit waiter immediately when its request signal aborts', async () => {
        const abortController = new AbortController();
        const cancel = jest.fn();
        const run = jest.fn(() => (
            new Promise<PageletDeepDiscoverControllerResult>(() => undefined)
        ));
        const scheduler = new PageletDeepDiscoverScheduler({
            controller: {
                run,
                cancel,
                dispose: jest.fn(),
            } as unknown as PageletDeepDiscoverController,
        });

        const explicit = scheduler.runNow({
            path: 'notes/explicit.md',
            triggerReason: 'explicit',
            force: true,
            signal: abortController.signal,
        });
        expect(run).toHaveBeenCalledTimes(1);

        abortController.abort();

        await expect(explicit).resolves.toEqual({
            status: 'quiet',
            reason: 'aborted',
        });
        expect(cancel).toHaveBeenCalledTimes(1);
        scheduler.dispose();
    });
});

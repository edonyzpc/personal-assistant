import { describe, expect, it, jest } from '@jest/globals';

import {
    PageletAgentCache,
    createPageletAgentCacheIdentity,
    hashPageletAgentCacheIdentity,
    normalizePageletInsightBody,
} from '../src/pagelet/agent/pagelet-agent-cache';
import { evaluatePageletAgentQuality } from '../src/pagelet/agent/pagelet-agent-quality-gate';
import { PageletDeepDiscoverController } from '../src/pagelet/agent/pagelet-deep-discover-controller';
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
    };
}

function materials(): Map<string, PageletAgentSourceMaterial> {
    return new Map([
        [anchor.path, anchorMaterial],
        [relatedMaterial.path, relatedMaterial],
    ]);
}

describe('Pagelet agent quality gate', () => {
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

        const shallowRun = makeRun(
            '`notes/anchor.md` 与 `notes/related.md` 相关，都提到发布。',
        );
        const shallow = await evaluatePageletAgentQuality({
            run: shallowRun,
            sourceMaterials: materials(),
            readCurrentSourceSnapshot: async (path) => snapshots().find((source) => source.path === path) ?? null,
            isPathAllowed: () => true,
            anchorRelations: { explicitLinks: ['notes/related.md'] },
        });
        expect(shallow).toEqual({ accepted: false, reason: 'shallow-link' });
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

        for (const hiddenPath of [
            '`Source: notes/missing.md`',
            'source:notes/missing.md',
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
            run: makeRun('`notes/anchor.md` 与 `notes/related.md` 的发布策略存在风险冲突。'),
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
});

describe('Pagelet agent cache and controller', () => {
    function verifiedInsight(web = false): PageletAgentVerifiedInsight {
        const cacheIdentity = createPageletAgentCacheIdentity({
            anchor,
            sources: snapshots(),
            policyIdentity,
        });
        const body = '`notes/anchor.md` 与 `notes/related.md` 的发布策略存在风险冲突。';
        return {
            body,
            normalizedBody: normalizePageletInsightBody(body),
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

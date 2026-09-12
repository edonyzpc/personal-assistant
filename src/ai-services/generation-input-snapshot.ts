import { z } from 'zod';
import { cloneImageRef, type ImageRef } from '../chat/image-types';
import { validateSourceRefPathShape } from '../pa/contracts/source-ref';
import type { SourceRecordBoundary, SourceRecordKind } from './chat-types';

export type GenerationInputIdentityState = 'none' | 'identified' | 'unknown';

export interface GenerationInputTaskSource {
    /** Why this record entered the request. Distinct records are never collapsed by path. */
    purpose: 'task_material';
    kind: SourceRecordKind;
    boundary: SourceRecordBoundary | 'unknown';
    dedupKey: string;
    turnId?: string;
    providerId?: string;
    capabilityName?: string;
    /** A current-process file revision is useful for the live guard, but is not a reload-safe hash. */
    revision:
        | { state: 'identified'; scope: 'current_process'; path: string; mtime: number; size: number }
        | { state: 'unknown'; path?: string; url?: string };
}

export type GenerationInputPersonalSource =
    | { state: 'none' }
    | { state: 'identified'; mode: 'governed'; revisions: Array<{ claimId: string; revisionId: string }> }
    | { state: 'unknown'; mode: 'governed' | 'legacy' };

export type GenerationInputInsightsSource =
    | { state: 'none' }
    | { state: 'unknown'; mode: 'governed' | 'legacy' };

/** Host-only background facts paired with the prompt projection that used them. */
export interface GenerationInputBackgroundSources {
    personal: GenerationInputPersonalSource;
    insights: GenerationInputInsightsSource;
}

export type GenerationInputStyleSource =
    | { state: 'none' }
    | { state: 'identified'; revisionIds: string[] }
    | { state: 'unknown' };

export type GenerationInputParentSource =
    | { state: 'none' }
    | { state: 'identified'; versionId: string; textHash: { algorithm: 'sha256'; value: string } };

export type GenerationInputPageletSource =
    | { state: 'none' }
    | { state: 'unknown'; id: string; pipelineVersion: string;
        anchor: { path: string; mtime: number; size: number; contentHash: { algorithm: 'unspecified'; value: string } };
        sources: Array<{ path: string; mtime: number; size: number; contentHash: { algorithm: 'unspecified'; value: string } }> };

export interface GenerationInputSnapshot {
    schemaVersion: 1;
    inputPurpose: 'writing';
    task: {
        state: GenerationInputIdentityState;
        sources: GenerationInputTaskSource[];
    };
    personal: GenerationInputPersonalSource;
    insights: GenerationInputInsightsSource;
    style: GenerationInputStyleSource;
    /** The complete selected image list. An empty list is an exact fact. */
    images: Array<{ ref: ImageRef; hashAlgorithm: 'sha256' }>;
    parent: GenerationInputParentSource;
    pagelet: GenerationInputPageletSource;
}

const shortText = z.string().min(1).max(4096);
const sourcePath = shortText.refine(path => validateSourceRefPathShape({ path }).ok, 'Invalid source path');
const revisionId = z.string().min(1).max(256);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const webUrl = z.string().url().max(8192).refine(value => {
    try {
        const protocol = new URL(value).protocol;
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}, 'Unsupported source URL protocol');
const taskSourceSchema = z.object({
    purpose: z.literal('task_material'),
    kind: z.enum(['memory-reference', 'context-used', 'web-source', 'skill-guide']),
    boundary: z.enum(['memory', 'current-note', 'read-only-tool', 'vault', 'web', 'skill-context', 'unknown']),
    dedupKey: shortText,
    turnId: shortText.optional(), providerId: shortText.optional(), capabilityName: shortText.optional(),
    revision: z.discriminatedUnion('state', [
        z.object({ state: z.literal('identified'), scope: z.literal('current_process'), path: sourcePath,
            mtime: z.number().finite().nonnegative(), size: z.number().finite().nonnegative() }).strict(),
        z.object({ state: z.literal('unknown'), path: sourcePath.optional(), url: webUrl.optional() }).strict(),
    ]),
}).strict().superRefine((source, context) => {
    const validBoundary = source.kind === 'memory-reference' ? source.boundary === 'memory'
        : source.kind === 'web-source' ? source.boundary === 'web'
            : source.kind === 'skill-guide' ? source.boundary === 'skill-context'
                : source.boundary === 'current-note' || source.boundary === 'read-only-tool'
                    || source.boundary === 'vault';
    if (!validBoundary) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent task source boundary' });
    }
});
const personalSchema = z.discriminatedUnion('state', [
    z.object({ state: z.literal('none') }).strict(),
    z.object({ state: z.literal('identified'), mode: z.literal('governed'),
        revisions: z.array(z.object({ claimId: revisionId, revisionId }).strict()).min(1).max(2048) }).strict(),
    z.object({ state: z.literal('unknown'), mode: z.enum(['governed', 'legacy']) }).strict(),
]);
const insightsSchema = z.discriminatedUnion('state', [
    z.object({ state: z.literal('none') }).strict(),
    z.object({ state: z.literal('unknown'), mode: z.enum(['governed', 'legacy']) }).strict(),
]);
const styleSchema = z.discriminatedUnion('state', [
    z.object({ state: z.literal('none') }).strict(),
    z.object({ state: z.literal('identified'), revisionIds: z.array(revisionId).min(1).max(2048) }).strict(),
    z.object({ state: z.literal('unknown') }).strict(),
]);
const parentSchema = z.discriminatedUnion('state', [
    z.object({ state: z.literal('none') }).strict(),
    z.object({ state: z.literal('identified'), versionId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
        textHash: z.object({ algorithm: z.literal('sha256'), value: sha256 }).strict() }).strict(),
]);
const pageletRevisionSchema = z.object({ path: sourcePath,
    mtime: z.number().finite().nonnegative(), size: z.number().finite().nonnegative(),
    contentHash: z.object({ algorithm: z.literal('unspecified'), value: shortText }).strict() }).strict();
const pageletSchema = z.discriminatedUnion('state', [
    z.object({ state: z.literal('none') }).strict(),
    z.object({ state: z.literal('unknown'), id: revisionId, pipelineVersion: revisionId,
        anchor: pageletRevisionSchema, sources: z.array(pageletRevisionSchema).max(2048) }).strict(),
]);
const generationInputSnapshotSchema = z.object({
    schemaVersion: z.literal(1), inputPurpose: z.literal('writing'),
    task: z.object({ state: z.enum(['none', 'identified', 'unknown']),
        sources: z.array(taskSourceSchema).max(2048) }).strict().superRefine((task, context) => {
        const valid = task.state === 'none' ? task.sources.length === 0
            : task.state === 'identified' ? task.sources.length > 0
                && task.sources.every(source => source.revision.state === 'identified')
                : true;
        if (!valid) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent task source identity' });
    }),
    personal: personalSchema, insights: insightsSchema, style: styleSchema,
    images: z.array(z.object({ ref: z.unknown(), hashAlgorithm: z.literal('sha256') }).strict()).max(2048),
    parent: parentSchema, pagelet: pageletSchema,
}).strict();

export function cloneGenerationInputBackgroundSources(
    value: GenerationInputBackgroundSources,
): GenerationInputBackgroundSources {
    return {
        personal: value.personal.state === 'identified'
            ? { ...value.personal, revisions: value.personal.revisions.map(revision => ({ ...revision })) }
            : { ...value.personal },
        insights: { ...value.insights },
    };
}

export function cloneGenerationInputSnapshot(value: unknown): GenerationInputSnapshot {
    const parsed = generationInputSnapshotSchema.parse(value);
    return {
        schemaVersion: 1,
        inputPurpose: 'writing',
        task: {
            state: parsed.task.state,
            sources: parsed.task.sources.map(source => ({
                ...source,
                revision: { ...source.revision },
            })),
        },
        ...cloneGenerationInputBackgroundSources({ personal: parsed.personal, insights: parsed.insights }),
        style: parsed.style.state === 'identified'
            ? { state: 'identified', revisionIds: [...parsed.style.revisionIds] }
            : { ...parsed.style },
        images: parsed.images.map(image => ({
            ref: cloneImageRef(image.ref),
            hashAlgorithm: 'sha256',
        })),
        parent: parsed.parent.state === 'identified'
            ? { state: 'identified', versionId: parsed.parent.versionId,
                textHash: { algorithm: 'sha256', value: parsed.parent.textHash.value } }
            : { state: 'none' },
        pagelet: parsed.pagelet.state === 'unknown'
            ? {
                state: 'unknown', id: parsed.pagelet.id, pipelineVersion: parsed.pagelet.pipelineVersion,
                anchor: { ...parsed.pagelet.anchor,
                    contentHash: { algorithm: 'unspecified', value: parsed.pagelet.anchor.contentHash.value } },
                sources: parsed.pagelet.sources.map(source => ({ ...source,
                    contentHash: { algorithm: 'unspecified', value: source.contentHash.value } })),
            }
            : { state: 'none' },
    };
}

/** True when D13 confirmation must cover a persisted identity the host cannot fully replay. */
export function generationInputNeedsRecoveryConfirmation(value: unknown): boolean {
    const snapshot = cloneGenerationInputSnapshot(value);
    return snapshot.task.state !== 'none'
        || snapshot.personal.state === 'unknown'
        || snapshot.insights.state !== 'none'
        || snapshot.style.state === 'unknown'
        || snapshot.pagelet.state !== 'none';
}

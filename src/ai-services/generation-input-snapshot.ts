import { z } from 'zod';
import { cloneImageRef, type ImageRef } from '../chat/image-types';
import { validateSourceRefPathShape } from '../pa/contracts/source-ref';
import type { ObservedSourceRevision, SourceRecordBoundary, SourceRecordKind } from './chat-types';

export type GenerationInputIdentityState = 'none' | 'identified' | 'unknown';

interface GenerationInputTaskSourceBase {
    /** Why this record entered the request. Distinct records are never collapsed by path. */
    purpose: 'task_material';
    kind: SourceRecordKind;
    boundary: SourceRecordBoundary | 'unknown';
    dedupKey: string;
    turnId?: string;
    providerId?: string;
    capabilityName?: string;
}

/** Historical v1 stat is retained for display and its original recovery guard only. */
export interface GenerationInputTaskSourceV1 extends GenerationInputTaskSourceBase {
    revision:
        | { state: 'identified'; scope: 'current_process'; path: string; mtime: number; size: number }
        | { state: 'unknown'; path?: string; url?: string };
}

export interface GenerationInputTaskSourceV2 extends GenerationInputTaskSourceBase {
    path?: string;
    url?: string;
    revision: ObservedSourceRevision;
}

export type GenerationInputTaskSource = GenerationInputTaskSourceV1 | GenerationInputTaskSourceV2;

/** Exact input ancestry for T-06; absence is unknown, never an empty proof. */
export type GenerationInputLineage =
    | { state: 'unknown' }
    | { state: 'complete'; dependencies: Array<{
        kind: 'current_input' | 'vault' | 'web' | 'personal' | 'insights' | 'style'
            | 'pagelet' | 'image' | 'writing_parent' | 'skill_context';
        identity: string;
        observedRevision?: ObservedSourceRevision;
    }> };

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

interface GenerationInputSnapshotBase {
    inputPurpose: 'writing';
    personal: GenerationInputPersonalSource;
    insights: GenerationInputInsightsSource;
    style: GenerationInputStyleSource;
    /** The complete selected image list. An empty list is an exact fact. */
    images: Array<{ ref: ImageRef; hashAlgorithm: 'sha256' }>;
    parent: GenerationInputParentSource;
    pagelet: GenerationInputPageletSource;
}

export interface GenerationInputSnapshotV1 extends GenerationInputSnapshotBase {
    schemaVersion: 1;
    task: {
        state: GenerationInputIdentityState;
        sources: GenerationInputTaskSourceV1[];
    };
}

export interface GenerationInputSnapshotV2 extends GenerationInputSnapshotBase {
    schemaVersion: 2;
    task: { state: GenerationInputIdentityState; sources: GenerationInputTaskSourceV2[] };
    lineage?: GenerationInputLineage;
}

export type GenerationInputSnapshot = GenerationInputSnapshotV1 | GenerationInputSnapshotV2;

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
const taskSourceFields = {
    purpose: z.literal('task_material'),
    kind: z.enum(['memory-reference', 'context-used', 'web-source', 'skill-guide']),
    boundary: z.enum(['memory', 'current-note', 'read-only-tool', 'vault', 'web', 'skill-context', 'unknown']),
    dedupKey: shortText,
    turnId: shortText.optional(), providerId: shortText.optional(), capabilityName: shortText.optional(),
};
const taskSourceSchemaV1 = z.object({
    ...taskSourceFields,
    revision: z.discriminatedUnion('state', [
        z.object({ state: z.literal('identified'), scope: z.literal('current_process'), path: sourcePath,
            mtime: z.number().finite().nonnegative(), size: z.number().finite().nonnegative() }).strict(),
        z.object({ state: z.literal('unknown'), path: sourcePath.optional(), url: webUrl.optional() }).strict(),
    ]),
}).strict().superRefine(validateTaskSourceBoundary);

const observedRevisionSchema = z.discriminatedUnion('state', [
    z.object({ state: z.literal('identified'), basis: z.enum(['vault_read', 'editor_snapshot', 'metadata_snapshot']),
        digest: z.object({ algorithm: z.literal('sha1'),
            scope: z.enum(['whole_file', 'editor_projection', 'metadata_projection', 'body_partition',
                'properties_partition', 'snippet_projection']),
            value: z.string().regex(/^[a-f0-9]{40}$/) }).strict(),
        stat: z.object({ mtime: z.number().finite().nonnegative(),
            size: z.number().finite().nonnegative() }).strict().optional() }).strict(),
    z.object({ state: z.literal('unknown'), reason: z.enum(['not_captured', 'legacy', 'unstable_read']) }).strict(),
]).superRefine((revision, context) => {
    if (revision.state !== 'identified') return;
    const valid = revision.basis === 'vault_read'
        ? ['whole_file', 'body_partition', 'properties_partition', 'snippet_projection'].includes(revision.digest.scope)
        : revision.basis === 'editor_snapshot' ? revision.digest.scope === 'editor_projection'
            : revision.digest.scope === 'metadata_projection';
    if (!valid) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent revision scope' });
});
export function parseObservedSourceRevision(value: unknown): ObservedSourceRevision | undefined {
    const parsed = observedRevisionSchema.safeParse(value);
    if (!parsed.success) return undefined;
    const revision = parsed.data;
    return revision.state === 'identified'
        ? { ...revision, digest: { ...revision.digest }, ...(revision.stat ? { stat: { ...revision.stat } } : {}) }
        : { ...revision };
}
const taskSourceSchemaV2 = z.object({
    ...taskSourceFields,
    path: sourcePath.optional(), url: webUrl.optional(),
    revision: observedRevisionSchema,
}).strict().superRefine((source, context) => {
    validateTaskSourceBoundary(source, context);
    if (source.revision.state === 'identified' && (!source.path || source.kind === 'web-source')) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Identified source needs a verifiable note path' });
    }
});

function validateTaskSourceBoundary(source: { kind: string; boundary: string }, context: z.RefinementCtx): void {
    const validBoundary = source.kind === 'memory-reference' ? source.boundary === 'memory'
        : source.kind === 'web-source' ? source.boundary === 'web'
            : source.kind === 'skill-guide' ? source.boundary === 'skill-context'
                : source.boundary === 'current-note' || source.boundary === 'read-only-tool'
                    || source.boundary === 'vault';
    if (!validBoundary) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent task source boundary' });
    }
}
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
const taskSchemaV1 = z.object({ state: z.enum(['none', 'identified', 'unknown']),
    sources: z.array(taskSourceSchemaV1).max(2048) }).strict().superRefine(validateTaskIdentity);
const taskSchemaV2 = z.object({ state: z.enum(['none', 'identified', 'unknown']),
    sources: z.array(taskSourceSchemaV2).max(2048) }).strict().superRefine(validateTaskIdentity);
function validateTaskIdentity(task: { state: GenerationInputIdentityState;
    sources: Array<{ revision: { state?: unknown } }> }, context: z.RefinementCtx): void {
    const valid = task.state === 'none' ? task.sources.length === 0
        : task.state === 'identified' ? task.sources.length > 0
            && task.sources.every(source => source.revision.state === 'identified') : true;
    if (!valid) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent task source identity' });
}
const commonSnapshotFields = {
    inputPurpose: z.literal('writing'),
    personal: personalSchema, insights: insightsSchema, style: styleSchema,
    images: z.array(z.object({ ref: z.unknown(), hashAlgorithm: z.literal('sha256') }).strict()).max(2048),
    parent: parentSchema, pagelet: pageletSchema,
};
const lineageSchema = z.discriminatedUnion('state', [
    z.object({ state: z.literal('unknown') }).strict(),
    z.object({ state: z.literal('complete'), dependencies: z.array(z.object({
        kind: z.enum(['current_input', 'vault', 'web', 'personal', 'insights', 'style', 'pagelet',
            'image', 'writing_parent', 'skill_context']), identity: shortText,
        observedRevision: observedRevisionSchema.optional(),
    }).strict()).min(1).max(2048) }).strict(),
]);
const generationInputSnapshotSchemaV1 = z.object({
    ...commonSnapshotFields,
    schemaVersion: z.literal(1), inputPurpose: z.literal('writing'),
    task: taskSchemaV1,
}).strict();
const generationInputSnapshotSchemaV2 = z.object({
    ...commonSnapshotFields,
    schemaVersion: z.literal(2), task: taskSchemaV2,
    lineage: lineageSchema.optional(),
}).strict();
const generationInputSnapshotSchema = z.discriminatedUnion('schemaVersion', [
    generationInputSnapshotSchemaV1, generationInputSnapshotSchemaV2,
]);

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
        schemaVersion: parsed.schemaVersion,
        inputPurpose: 'writing',
        task: {
            state: parsed.task.state,
            sources: parsed.task.sources.map(source => ({
                ...source,
                revision: source.revision.state === 'identified' && 'digest' in source.revision
                    ? { ...source.revision, digest: { ...source.revision.digest },
                        ...(source.revision.stat ? { stat: { ...source.revision.stat } } : {}) }
                    : { ...source.revision },
            })),
        },
        ...(parsed.schemaVersion === 2 && parsed.lineage ? { lineage: parsed.lineage.state === 'complete'
            ? { state: 'complete', dependencies: parsed.lineage.dependencies.map(dependency => ({ ...dependency,
                ...(dependency.observedRevision ? { observedRevision: parseObservedSourceRevision(dependency.observedRevision) } : {}),
            })) }
            : { state: 'unknown' } } : {}),
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
    } as GenerationInputSnapshot;
}

/** True when D13 confirmation must cover a persisted identity the host cannot fully replay. */
export function generationInputNeedsRecoveryConfirmation(value: unknown): boolean {
    const snapshot = cloneGenerationInputSnapshot(value);
    return snapshot.schemaVersion === 2 && snapshot.lineage?.state !== 'complete'
        || snapshot.task.state !== 'none'
        || snapshot.personal.state === 'unknown'
        || snapshot.insights.state !== 'none'
        || snapshot.style.state === 'unknown'
        || snapshot.pagelet.state !== 'none';
}

/** A live path guard cannot prove legacy input or replay an editor/partition observation. */
export function generationInputRequiresConfirmationDespiteLiveReceipt(value: unknown): boolean {
    let snapshot: GenerationInputSnapshot;
    try {
        snapshot = cloneGenerationInputSnapshot(value);
    } catch {
        return true;
    }
    if (snapshot.schemaVersion === 1) return generationInputNeedsRecoveryConfirmation(snapshot);
    return snapshot.lineage?.state !== 'complete'
        || snapshot.task.state === 'unknown'
        || snapshot.task.sources.some(source => source.kind === 'skill-guide'
            || source.revision.state !== 'identified'
            || source.revision.basis !== 'vault_read'
            || source.revision.digest.scope !== 'whole_file');
}

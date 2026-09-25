import { z } from 'zod';
import type { ImageRef } from '../chat/image-types';
import { validateSourceRefPathShape } from '../pa/contracts/source-ref';
import type { GenerationInputInsightsSource, GenerationInputLineage, GenerationInputSnapshot,
    GenerationInputPersonalSource, GenerationInputTaskSourceV2 } from './generation-input-snapshot';
import type { WritingVersion } from '../chat/writing-types';
import type { ChatSourceScope } from './chat-source-scope';
import type { ObservedSourceRevision, SourceRecord } from './chat-types';

/** Host-owned ancestry of content that actually entered a model request. */
export type InputDependency =
    | { kind: 'user-text'; messageId: string }
    | { kind: 'attachment'; ownerMessageId: string; ref: ImageRef }
    | { kind: 'vault'; path: string; via: 'note' | 'memory' | 'pagelet' }
    | { kind: 'run-notes-observation'; runId: string; owner: 'vault' | 'memory';
        sourceEpoch: string; memoryEnabled?: boolean }
    | { kind: 'personal'; source: Extract<GenerationInputPersonalSource, { state: 'identified' }> }
    | { kind: 'insight'; source: Exclude<GenerationInputInsightsSource, { state: 'none' }> }
    | { kind: 'writing-style'; revisionIds: string[] }
    | { kind: 'writing-version'; versionId: string; textHash: string }
    | { kind: 'web'; providerId: string; resultKey: string };

export interface InputLineage {
    schemaVersion: 1;
    completeness: 'complete' | 'unknown';
    dependencies: InputDependency[];
}

const identity = z.string().trim().min(1).max(4096);
const shortIdentity = z.string().trim().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const path = identity.refine(value => validateSourceRefPathShape({ path: value }).ok);
const dependencySchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('user-text'), messageId: shortIdentity }).strict(),
    z.object({ kind: z.literal('attachment'), ownerMessageId: shortIdentity,
        ref: z.object({ assetId: shortIdentity, contentHash: hash }).strict() }).strict(),
    z.object({ kind: z.literal('vault'), path, via: z.enum(['note', 'memory', 'pagelet']) }).strict(),
    z.object({ kind: z.literal('run-notes-observation'), runId: shortIdentity,
        owner: z.enum(['vault', 'memory']), sourceEpoch: identity,
        memoryEnabled: z.boolean().optional() }).strict(),
    z.object({ kind: z.literal('personal'), source: z.object({ state: z.literal('identified'),
        mode: z.literal('governed'), revisions: z.array(z.object({ claimId: shortIdentity,
            revisionId: shortIdentity }).strict()).min(1).max(2048) }).strict() }).strict(),
    z.object({ kind: z.literal('insight'), source: z.object({ state: z.literal('unknown'),
        mode: z.enum(['governed', 'legacy']) }).strict() }).strict(),
    z.object({ kind: z.literal('writing-style'), revisionIds: z.array(shortIdentity).min(1).max(2048) }).strict(),
    z.object({ kind: z.literal('writing-version'), versionId: shortIdentity, textHash: hash }).strict(),
    z.object({ kind: z.literal('web'), providerId: shortIdentity, resultKey: identity }).strict(),
]);
const lineageSchema = z.object({ schemaVersion: z.literal(1),
    completeness: z.enum(['complete', 'unknown']), dependencies: z.array(dependencySchema).max(2048) }).strict();

export function parseInputLineage(value: unknown): InputLineage | undefined {
    const parsed = lineageSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
}

export function cloneInputLineage(value: unknown): InputLineage | undefined {
    const parsed = parseInputLineage(value);
    if (!parsed) return undefined;
    return { schemaVersion: 1, completeness: parsed.completeness,
        dependencies: parsed.dependencies.map(dependency => {
            if (dependency.kind === 'attachment') return { ...dependency, ref: { ...dependency.ref } };
            if (dependency.kind === 'personal') return { ...dependency, source: { ...dependency.source,
                revisions: dependency.source.revisions.map(revision => ({ ...revision })) } };
            if (dependency.kind === 'insight') return { ...dependency, source: { ...dependency.source } };
            if (dependency.kind === 'writing-style') return { ...dependency, revisionIds: [...dependency.revisionIds] };
            return { ...dependency };
        }) };
}

/** Persisted presence is meaningful: a damaged receipt must remain unknown after cloning. */
export function cloneRecordedInputLineage(value: unknown): InputLineage | undefined {
    if (value === undefined) return undefined;
    return cloneInputLineage(value) ?? unknownInputLineage();
}

export function unknownInputLineage(dependencies: readonly InputDependency[] = []): InputLineage {
    return { schemaVersion: 1, completeness: 'unknown', dependencies: dependencies.map(dependency =>
        cloneInputLineage({ schemaVersion: 1, completeness: 'unknown', dependencies: [dependency] })!.dependencies[0]) };
}

export function completeInputLineage(dependencies: readonly InputDependency[] = []): InputLineage {
    const copied = cloneInputLineage({ schemaVersion: 1, completeness: 'complete', dependencies });
    if (!copied) throw new Error('Invalid complete input lineage');
    return copied;
}

/** Missing or malformed ancestry contaminates the whole derived value. */
export function unionInputLineages(...values: readonly (InputLineage | undefined)[]): InputLineage {
    const dependencies = new Map<string, InputDependency>();
    let complete = values.length > 0;
    for (const value of values) {
        const parsed = cloneInputLineage(value);
        if (!parsed || parsed.completeness !== 'complete') complete = false;
        for (const dependency of parsed?.dependencies ?? []) dependencies.set(JSON.stringify(dependency), dependency);
    }
    return { schemaVersion: 1, completeness: complete ? 'complete' : 'unknown',
        dependencies: [...dependencies.values()] };
}

export interface InputLineageAdmission {
    isVaultAllowed(path: string, via: 'note' | 'memory' | 'pagelet'): boolean;
    isRunNotesObservationAllowed?(observation: Extract<InputDependency,
        { kind: 'run-notes-observation' }>): boolean;
    isWebAllowed(providerId: string, resultKey: string): boolean;
    isAttachmentAllowed?(ref: ImageRef): boolean;
    isPersonalAllowed?(source: Extract<GenerationInputPersonalSource, { state: 'identified' }>): boolean;
    isInsightAllowed?(source: Exclude<GenerationInputInsightsSource, { state: 'none' }>): boolean;
    isWritingStyleAllowed?(revisionIds: readonly string[]): boolean;
    isWritingVersionAllowed?(versionId: string, textHash: string): boolean;
}

export function admitsInputLineage(value: unknown, scope: ChatSourceScope, admission: InputLineageAdmission): boolean {
    const lineage = parseInputLineage(value);
    if (!lineage || lineage.completeness !== 'complete') return false;
    try {
        return lineage.dependencies.every(dependency => {
            switch (dependency.kind) {
                case 'user-text': return true;
                case 'attachment': return admission.isAttachmentAllowed?.(dependency.ref) === true;
                case 'vault': return scope !== 'web' && admission.isVaultAllowed(dependency.path, dependency.via);
                case 'run-notes-observation': return scope !== 'web'
                    && admission.isRunNotesObservationAllowed?.(dependency) === true;
                case 'personal': return scope !== 'web' && admission.isPersonalAllowed?.(dependency.source) === true;
                case 'insight': return scope !== 'web' && admission.isInsightAllowed?.(dependency.source) === true;
                case 'writing-style': return scope !== 'web' && admission.isWritingStyleAllowed?.(dependency.revisionIds) === true;
                case 'writing-version': return scope !== 'web'
                    && admission.isWritingVersionAllowed?.(dependency.versionId, dependency.textHash) === true;
                case 'web': return scope !== 'notes' && admission.isWebAllowed(dependency.providerId, dependency.resultKey);
            }
        });
    } catch { return false; }
}

/** A displayed citation is not a full dependency proof; only actual source receipts qualify. */
export function sourceRecordsInputLineage(records: readonly SourceRecord[]): InputLineage {
    if (records.length === 0) return unknownInputLineage();
    const dependencies: InputDependency[] = [];
    let complete = true;
    for (const record of records) {
        if (record.statusOnly && record.metadata?.sourceDependency !== true) continue;
        if (record.sourceBoundary === 'web') {
            if (!record.providerId || !record.dedupKey || !record.url) { complete = false; continue; }
            dependencies.push({ kind: 'web', providerId: record.providerId, resultKey: record.dedupKey });
        } else if (record.sourceBoundary === 'memory' || record.kind === 'memory-reference') {
            if (!record.path) { complete = false; continue; }
            dependencies.push({ kind: 'vault', path: record.path, via: 'memory' });
        } else if (record.sourceBoundary === 'current-note' || record.sourceBoundary === 'read-only-tool'
            || record.sourceBoundary === 'vault') {
            if (!record.path) { complete = false; continue; }
            dependencies.push({ kind: 'vault', path: record.path, via: 'note' });
        } else complete = false;
    }
    const copied = cloneInputLineage({ schemaVersion: 1,
        completeness: complete ? 'complete' : 'unknown', dependencies });
    return copied ?? unknownInputLineage();
}

/** Writing v2 stores the same closed dependency objects in its existing lineage field. */
export function toGenerationInputLineage(
    value: InputLineage | undefined,
    taskSources: readonly GenerationInputTaskSourceV2[],
): GenerationInputLineage {
    const lineage = parseInputLineage(value);
    if (!lineage || lineage.completeness !== 'complete') return { state: 'unknown' };
    const kind = (dependency: InputDependency): Extract<GenerationInputLineage, { state: 'complete' }>['dependencies'][number]['kind'] => {
        switch (dependency.kind) {
            case 'user-text': return 'current_input';
            case 'attachment': return 'image';
            case 'vault': return dependency.via === 'pagelet' ? 'pagelet' : 'vault';
            case 'run-notes-observation': return 'vault';
            case 'personal': return 'personal';
            case 'insight': return 'insights';
            case 'writing-style': return 'style';
            case 'writing-version': return 'writing_parent';
            case 'web': return 'web';
        }
    };
    const dependencies = lineage.dependencies.flatMap(dependency => {
        const revisions = dependency.kind === 'vault'
            ? taskSources.filter(source => source.path === dependency.path).map(source => source.revision)
            : [];
        const matching = revisions.length ? revisions : [undefined];
        return matching.map(observedRevision => ({ kind: kind(dependency),
            identity: JSON.stringify(dependency), ...(observedRevision ? { observedRevision } : {}) }));
    });
    return dependencies.length <= 2048 ? { state: 'complete', dependencies } : { state: 'unknown' };
}

/** Decode the existing Writing v2 lineage into the same closed dependency type. */
export function generationInputSnapshotInputLineage(source: GenerationInputSnapshot | undefined): InputLineage {
    if (!source || source.schemaVersion !== 2 || source.lineage?.state !== 'complete') return unknownInputLineage();
    const dependencies: InputDependency[] = [];
    const decoded: Array<{ dependency: InputDependency; observedRevision?: ObservedSourceRevision }> = [];
    let valid = true;
    for (const entry of source.lineage.dependencies) {
        let raw: unknown;
        try { raw = JSON.parse(entry.identity); } catch { valid = false; continue; }
        const parsed = parseInputLineage({ schemaVersion: 1, completeness: 'complete', dependencies: [raw] });
        if (!parsed) { valid = false; continue; }
        const dependency = parsed.dependencies[0];
        const expectedKind = dependency.kind === 'user-text' ? 'current_input'
            : dependency.kind === 'attachment' ? 'image'
            : dependency.kind === 'vault' ? dependency.via === 'pagelet' ? 'pagelet' : 'vault'
            : dependency.kind === 'run-notes-observation' ? 'vault'
            : dependency.kind === 'personal' ? 'personal'
            : dependency.kind === 'insight' ? 'insights'
            : dependency.kind === 'writing-style' ? 'style'
            : dependency.kind === 'writing-version' ? 'writing_parent' : 'web';
        dependencies.push(dependency);
        if (entry.kind !== expectedKind) { valid = false; continue; }
        decoded.push({ dependency, observedRevision: entry.observedRevision });
    }
    const coversTaskSource = (task: typeof source.task.sources[number]): boolean => {
        if (!task.path || task.revision.state !== 'identified' || task.kind === 'skill-guide') return false;
        const via = task.kind === 'memory-reference' ? 'memory' : 'note';
        return decoded.some(({ dependency, observedRevision }) => dependency.kind === 'vault'
            && dependency.path === task.path && dependency.via === via
            && sameObservedRevision(observedRevision, task.revision));
    };
    const personal = source.personal;
    const coversPersonal = personal.state !== 'identified' || personal.revisions.every(revision =>
        dependencies.some(dependency => dependency.kind === 'personal'
            && dependency.source.mode === personal.mode
            && dependency.source.revisions.some(candidate => candidate.claimId === revision.claimId
                && candidate.revisionId === revision.revisionId)));
    const coversStyle = source.style.state !== 'identified' || source.style.revisionIds.every(revisionId =>
        dependencies.some(dependency => dependency.kind === 'writing-style'
            && dependency.revisionIds.includes(revisionId)));
    const coversImages = source.images.every(image => dependencies.some(dependency =>
        dependency.kind === 'attachment' && dependency.ref.assetId === image.ref.assetId
        && dependency.ref.contentHash === image.ref.contentHash));
    const parent = source.parent;
    const coversParent = parent.state !== 'identified' || dependencies.some(dependency =>
        dependency.kind === 'writing-version' && dependency.versionId === parent.versionId
        && dependency.textHash === parent.textHash.value);
    return !valid || source.task.state === 'unknown' || source.personal.state === 'unknown'
        || source.insights.state !== 'none' || source.style.state === 'unknown'
        || source.pagelet.state !== 'none' || !source.task.sources.every(coversTaskSource)
        || !coversPersonal || !coversStyle || !coversImages || !coversParent
        ? unknownInputLineage(dependencies) : completeInputLineage(dependencies);
}

function sameObservedRevision(a: ObservedSourceRevision | undefined, b: ObservedSourceRevision): boolean {
    return a?.state === 'identified' && b.state === 'identified'
        && a.basis === b.basis && a.digest.algorithm === b.digest.algorithm
        && a.digest.scope === b.digest.scope && a.digest.value === b.digest.value
        && a.stat?.mtime === b.stat?.mtime && a.stat?.size === b.stat?.size;
}

/** A parent is reusable only if its stored v2 ancestry was complete and can be parsed. */
export function writingVersionInputLineage(version: WritingVersion | undefined): InputLineage {
    if (!version) return completeInputLineage();
    const source = version.generationInput;
    const direct = generationInputSnapshotInputLineage(source);
    if (direct.completeness !== 'complete') return direct;
    if (version.parentVersionId
        && (source?.parent.state !== 'identified' || source.parent.versionId !== version.parentVersionId)) {
        return unknownInputLineage();
    }
    if (!version.parentVersionId && source?.parent.state !== 'none') return unknownInputLineage();
    return unionInputLineages(completeInputLineage([{ kind: 'writing-version',
        versionId: version.id, textHash: version.textHash },
    ...(version.origin === 'user_edited' ? [{ kind: 'user-text' as const, messageId: version.messageId }] : [])]),
    direct);
}

export async function resolveWritingVersionInputLineage(
    version: WritingVersion,
    getVersion: (id: string) => Promise<WritingVersion | null>,
    visited = new Set<string>(),
): Promise<InputLineage> {
    if (visited.has(version.id)) return unknownInputLineage();
    const direct = writingVersionInputLineage(version);
    if (direct.completeness !== 'complete') return direct;
    if (!version.parentVersionId) return direct;
    visited.add(version.id);
    try {
        const parent = await getVersion(version.parentVersionId);
        const expected = version.generationInput?.parent;
        if (!parent || expected?.state !== 'identified' || parent.id !== expected.versionId
            || parent.textHash !== expected.textHash.value) return unknownInputLineage();
        const ancestor = await resolveWritingVersionInputLineage(parent, getVersion, visited);
        return unionInputLineages(direct, ancestor);
    } catch { return unknownInputLineage(); }
    finally { visited.delete(version.id); }
}

import type { ImageRef } from '../chat/image-types';
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

export function cloneGenerationInputSnapshot(value: GenerationInputSnapshot): GenerationInputSnapshot {
    return {
        schemaVersion: 1,
        inputPurpose: 'writing',
        task: {
            state: value.task.state,
            sources: value.task.sources.map(source => ({
                ...source,
                revision: { ...source.revision },
            })),
        },
        ...cloneGenerationInputBackgroundSources({ personal: value.personal, insights: value.insights }),
        style: value.style.state === 'identified'
            ? { state: 'identified', revisionIds: [...value.style.revisionIds] }
            : { ...value.style },
        images: value.images.map(image => ({
            ref: { ...image.ref },
            hashAlgorithm: 'sha256',
        })),
        parent: value.parent.state === 'identified'
            ? { state: 'identified', versionId: value.parent.versionId,
                textHash: { algorithm: 'sha256', value: value.parent.textHash.value } }
            : { state: 'none' },
        pagelet: value.pagelet.state === 'unknown'
            ? {
                state: 'unknown', id: value.pagelet.id, pipelineVersion: value.pagelet.pipelineVersion,
                anchor: { ...value.pagelet.anchor,
                    contentHash: { algorithm: 'unspecified', value: value.pagelet.anchor.contentHash.value } },
                sources: value.pagelet.sources.map(source => ({ ...source,
                    contentHash: { algorithm: 'unspecified', value: source.contentHash.value } })),
            }
            : { state: 'none' },
    };
}

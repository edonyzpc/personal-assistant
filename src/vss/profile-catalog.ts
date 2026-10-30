import { stableHash } from '../pa/helpers';
import { getEmbeddingProfileSignature, type EmbeddingProfile } from './types';

export interface MemoryStorageTarget {
    databaseName: string;
    opfsDirectory: string;
    opfsVfsName: string;
}

export interface MemoryProfileEntry {
    profileId: string;
    profile: EmbeddingProfile;
    storage: MemoryStorageTarget;
    storageKind: 'legacy' | 'profile';
    legacySignature?: string;
    origin: 'initial-setup' | 'configuration-change' | 'migration';
}

export interface MemoryProfileCatalog {
    version: 1;
    entries: MemoryProfileEntry[];
    firstUse: 'eligible' | 'consumed' | 'unknown';
    selectionRevision?: string;
    legacy: { state: 'unexamined' | 'absent' | 'bound' | 'unknown'; storage: MemoryStorageTarget };
}

export function getMemoryProfileId(profile: EmbeddingProfile): string {
    return `profile-${stableHash(getEmbeddingProfileSignature(profile))}`;
}

export function createMemoryProfileEntry(
    vaultScope: string,
    profile: EmbeddingProfile,
    origin: MemoryProfileEntry['origin'],
): MemoryProfileEntry {
    const profileId = getMemoryProfileId(profile);
    return {
        profileId,
        profile: { ...profile },
        storageKind: 'profile',
        origin,
        storage: {
            databaseName: `personal-assistant-vss-${profileId}.sqlite3`,
            opfsDirectory: `/personal-assistant-vss-v2/${vaultScope}/profiles/${profileId}`,
            opfsVfsName: `opfs-sahpool-${stableHash(`${vaultScope}/${profileId}`)}`,
        },
    };
}

/** Persisted catalog is a boundary. A hash match never proves profile equality. */
export function findMemoryProfile(catalog: MemoryProfileCatalog, profile: EmbeddingProfile): MemoryProfileEntry | undefined {
    const id = getMemoryProfileId(profile);
    const entry = catalog.entries.find((candidate) => candidate.profileId === id);
    if (entry && getEmbeddingProfileSignature(entry.profile) !== getEmbeddingProfileSignature(profile)) {
        throw new Error('Memory profile storage identity conflicts with its recorded configuration.');
    }
    return entry;
}

export function parseLegacyEmbeddingProfile(signature: string): EmbeddingProfile | null {
    const parts = signature.split('|');
    if (parts.length !== 5) return null;
    const [provider, baseURL, model, dimensionText, metric] = parts;
    const dimensions = Number(dimensionText);
    if (!provider || !model || !Number.isSafeInteger(dimensions) || dimensions <= 0 || metric !== 'COSINE') return null;
    return { provider, baseURL, model, dimensions, distanceMetric: metric };
}

export function cloneMemoryProfileCatalog(catalog: MemoryProfileCatalog): MemoryProfileCatalog {
    return { ...catalog, legacy: { ...catalog.legacy, storage: { ...catalog.legacy.storage } },
        entries: catalog.entries.map((entry) => ({ ...entry, profile: { ...entry.profile }, storage: { ...entry.storage } })) };
}

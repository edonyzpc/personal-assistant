import { describe, expect, it } from '@jest/globals';
import {
    getVSSIndexStateDir,
    getVSSManifestPath,
    getVSSMarkerPath,
    shouldEnableMemoryFallback,
} from '../src/vss/state';
import {
    VSS_FALLBACK_MAX_CHUNKS,
    VSS_FALLBACK_MAX_MEMORY_BYTES,
    type VSSIndexManifest,
} from '../src/vss/types';

describe('VSS index state helpers', () => {
    const baseManifest: VSSIndexManifest = {
        schemaVersion: 1,
        deviceId: 'device-a',
        profileSignature: 'provider|url|model|1024|COSINE',
        fileCount: 10,
        chunkCount: 100,
        estimatedMemoryBytes: 1024,
        legacyJsonCacheBytes: 2048,
        updatedAt: '2026-05-02T00:00:00.000Z',
    };

    it('stores marker and manifest in a device-scoped vault directory', () => {
        expect(getVSSIndexStateDir('device-a')).toBe('.obsidian/plugins/personal-assistant/vss-index-state/device-a');
        expect(getVSSMarkerPath('device-a')).toBe('.obsidian/plugins/personal-assistant/vss-index-state/device-a/marker.json');
        expect(getVSSManifestPath('device-a')).toBe('.obsidian/plugins/personal-assistant/vss-index-state/device-a/manifest.json');
    });

    it('enables Memory fallback only when both hard caps are satisfied', () => {
        expect(shouldEnableMemoryFallback({
            ...baseManifest,
            chunkCount: VSS_FALLBACK_MAX_CHUNKS,
            estimatedMemoryBytes: VSS_FALLBACK_MAX_MEMORY_BYTES,
        })).toBe(true);

        expect(shouldEnableMemoryFallback({
            ...baseManifest,
            chunkCount: VSS_FALLBACK_MAX_CHUNKS + 1,
            estimatedMemoryBytes: 1024,
        })).toBe(false);

        expect(shouldEnableMemoryFallback({
            ...baseManifest,
            chunkCount: 100,
            estimatedMemoryBytes: VSS_FALLBACK_MAX_MEMORY_BYTES + 1,
        })).toBe(false);

        expect(shouldEnableMemoryFallback(null)).toBe(false);
    });
});

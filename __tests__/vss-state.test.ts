import { describe, expect, it } from '@jest/globals';
import type { Vault } from 'obsidian';
import {
    getVSSIndexStateDir,
    getVSSManifestPath,
    getVSSMarkerPath,
    readVSSMarker,
    removeVSSMarker,
    shouldEnableMemoryFallback,
    writeVSSMarker,
} from '../src/vss/state';
import {
    VSS_FALLBACK_MAX_CHUNKS,
    VSS_FALLBACK_MAX_MEMORY_BYTES,
    type VSSIndexManifest,
    type VSSIndexMarker,
} from '../src/vss/types';

class MemoryAdapter {
    files = new Map<string, string>();
    folders = new Set<string>();

    async exists(path: string): Promise<boolean> {
        const normalized = this.normalize(path);
        return this.files.has(normalized) || this.folders.has(normalized);
    }

    async mkdir(path: string): Promise<void> {
        this.folders.add(this.normalize(path));
    }

    async read(path: string): Promise<string> {
        const content = this.files.get(this.normalize(path));
        if (content === undefined) {
            const error = new Error(`Missing file: ${path}`) as Error & { code?: string };
            error.code = 'ENOENT';
            throw error;
        }
        return content;
    }

    async write(path: string, content: string): Promise<void> {
        this.files.set(this.normalize(path), content);
    }

    async remove(path: string): Promise<void> {
        this.files.delete(this.normalize(path));
    }

    private normalize(path: string): string {
        return path.replace(/\/+/g, '/').replace(/\/$/, '');
    }
}

function createVault(adapter: MemoryAdapter, configDir = '.obsidian'): Vault {
    return {
        adapter,
        configDir,
    } as unknown as Vault;
}

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
    const baseMarker: VSSIndexMarker = {
        schemaVersion: 1,
        deviceId: 'device-a',
        indexId: 'index-a',
        profileSignature: 'provider|url|model|1024|COSINE',
        backend: 'sqlite',
        chunkCount: 100,
        fileCount: 10,
        builtAt: '2026-05-02T00:00:00.000Z',
        lastVerifiedAt: '2026-05-02T00:00:00.000Z',
        storagePersisted: true,
    };

    it('stores marker and manifest in a device-scoped vault directory', () => {
        expect(getVSSIndexStateDir('device-a')).toBe('.obsidian/plugins/personal-assistant/vss-index-state/device-a');
        expect(getVSSMarkerPath('device-a')).toBe('.obsidian/plugins/personal-assistant/vss-index-state/device-a/marker.json');
        expect(getVSSManifestPath('device-a')).toBe('.obsidian/plugins/personal-assistant/vss-index-state/device-a/manifest.json');
    });

    it('uses custom vault config directories for new VSS state writes', async () => {
        const adapter = new MemoryAdapter();
        const vault = createVault(adapter, '.vault-config');

        await writeVSSMarker(vault, baseMarker);

        expect(adapter.files.has('.vault-config/plugins/personal-assistant/vss-index-state/device-a/marker.json')).toBe(true);
        expect(adapter.files.has('.obsidian/plugins/personal-assistant/vss-index-state/device-a/marker.json')).toBe(false);
    });

    it('reads and removes legacy VSS state when a custom config directory is used', async () => {
        const adapter = new MemoryAdapter();
        const vault = createVault(adapter, '.vault-config');
        await adapter.write(
            '.obsidian/plugins/personal-assistant/vss-index-state/device-a/marker.json',
            JSON.stringify(baseMarker),
        );

        await expect(readVSSMarker(vault, 'device-a')).resolves.toMatchObject({ indexId: 'index-a' });
        await removeVSSMarker(vault, 'device-a');

        expect(adapter.files.has('.obsidian/plugins/personal-assistant/vss-index-state/device-a/marker.json')).toBe(false);
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

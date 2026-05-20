import { describe, expect, it } from '@jest/globals';
import type { Vault } from 'obsidian';
import {
    getVSSIndexStateDir,
    getVSSManifestPath,
    getVSSMarkerPath,
    readVSSMarker,
} from '../src/vss/state';
import { type VSSIndexMarker } from '../src/vss/types';

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

    it('keeps legacy marker and manifest paths device-scoped for read-only migration', () => {
        expect(getVSSIndexStateDir('device-a')).toBe('.obsidian/plugins/personal-assistant/vss-index-state/device-a');
        expect(getVSSMarkerPath('device-a')).toBe('.obsidian/plugins/personal-assistant/vss-index-state/device-a/marker.json');
        expect(getVSSManifestPath('device-a')).toBe('.obsidian/plugins/personal-assistant/vss-index-state/device-a/manifest.json');
    });

    it('reads marker from the current vault config directory', async () => {
        const adapter = new MemoryAdapter();
        const vault = createVault(adapter, '.vault-config');
        await adapter.write(
            '.vault-config/plugins/personal-assistant/vss-index-state/device-a/marker.json',
            JSON.stringify(baseMarker),
        );

        await expect(readVSSMarker(vault, 'device-a')).resolves.toMatchObject({ indexId: 'index-a' });
    });

    it('falls back to legacy .obsidian marker reads when a custom config directory is used', async () => {
        const adapter = new MemoryAdapter();
        const vault = createVault(adapter, '.vault-config');
        await adapter.write(
            '.obsidian/plugins/personal-assistant/vss-index-state/device-a/marker.json',
            JSON.stringify(baseMarker),
        );

        await expect(readVSSMarker(vault, 'device-a')).resolves.toMatchObject({ indexId: 'index-a' });
    });
});

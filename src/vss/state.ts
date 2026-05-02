import { normalizePath, type Vault } from "obsidian";
import { getDeviceId } from "../stats/stats-store";
import {
    VSS_FALLBACK_MAX_CHUNKS,
    VSS_FALLBACK_MAX_MEMORY_BYTES,
    type VSSIndexManifest,
    type VSSIndexMarker,
} from "./types";

export const VSS_INDEX_STATE_ROOT = ".obsidian/plugins/personal-assistant/vss-index-state";

export function getVSSDeviceId(): string {
    return getDeviceId();
}

export function getVSSIndexStateDir(deviceId: string): string {
    return normalizePath(`${VSS_INDEX_STATE_ROOT}/${deviceId}`);
}

export function getVSSMarkerPath(deviceId: string): string {
    return normalizePath(`${getVSSIndexStateDir(deviceId)}/marker.json`);
}

export function getVSSManifestPath(deviceId: string): string {
    return normalizePath(`${getVSSIndexStateDir(deviceId)}/manifest.json`);
}

export function shouldEnableMemoryFallback(manifest: VSSIndexManifest | null): boolean {
    if (!manifest) return false;
    return manifest.chunkCount <= VSS_FALLBACK_MAX_CHUNKS
        && manifest.estimatedMemoryBytes <= VSS_FALLBACK_MAX_MEMORY_BYTES;
}

export async function ensureVSSIndexStateDir(vault: Vault, deviceId: string): Promise<void> {
    const dir = getVSSIndexStateDir(deviceId);
    const parts = dir.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        if (!await vault.adapter.exists(current)) {
            await vault.adapter.mkdir(current);
        }
    }
}

export async function readVSSMarker(vault: Vault, deviceId: string): Promise<VSSIndexMarker | null> {
    return readJsonFile<VSSIndexMarker>(vault, getVSSMarkerPath(deviceId), isVSSIndexMarker);
}

export async function writeVSSMarker(vault: Vault, marker: VSSIndexMarker): Promise<void> {
    await ensureVSSIndexStateDir(vault, marker.deviceId);
    await vault.adapter.write(getVSSMarkerPath(marker.deviceId), JSON.stringify(marker, null, 2));
}

export async function removeVSSMarker(vault: Vault, deviceId: string): Promise<void> {
    await removeIfExists(vault, getVSSMarkerPath(deviceId));
}

export async function readVSSManifest(vault: Vault, deviceId: string): Promise<VSSIndexManifest | null> {
    return readJsonFile<VSSIndexManifest>(vault, getVSSManifestPath(deviceId), isVSSIndexManifest);
}

export async function writeVSSManifest(vault: Vault, manifest: VSSIndexManifest): Promise<void> {
    await ensureVSSIndexStateDir(vault, manifest.deviceId);
    await vault.adapter.write(getVSSManifestPath(manifest.deviceId), JSON.stringify(manifest, null, 2));
}

export async function removeVSSManifest(vault: Vault, deviceId: string): Promise<void> {
    await removeIfExists(vault, getVSSManifestPath(deviceId));
}

async function readJsonFile<T>(
    vault: Vault,
    path: string,
    guard: (value: unknown) => value is T,
): Promise<T | null> {
    try {
        const raw = await vault.adapter.read(path);
        if (typeof raw !== "string" || raw.trim() === "") return null;
        const parsed = JSON.parse(raw);
        return guard(parsed) ? parsed : null;
    } catch (error) {
        if (isMissingFileError(error)) return null;
        if (error instanceof SyntaxError) return null;
        throw error;
    }
}

async function removeIfExists(vault: Vault, path: string): Promise<void> {
    if (await vault.adapter.exists(path)) {
        await vault.adapter.remove(path);
    }
}

function isMissingFileError(error: unknown): boolean {
    return error !== null
        && typeof error === "object"
        && "code" in error
        && (error as { code?: unknown }).code === "ENOENT";
}

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isVSSIndexMarker(value: unknown): value is VSSIndexMarker {
    if (!isObject(value)) return false;
    return typeof value.schemaVersion === "number"
        && typeof value.deviceId === "string"
        && typeof value.indexId === "string"
        && typeof value.profileSignature === "string"
        && typeof value.backend === "string"
        && typeof value.chunkCount === "number"
        && typeof value.fileCount === "number"
        && typeof value.builtAt === "string"
        && typeof value.lastVerifiedAt === "string"
        && typeof value.storagePersisted === "boolean";
}

function isVSSIndexManifest(value: unknown): value is VSSIndexManifest {
    if (!isObject(value)) return false;
    return typeof value.schemaVersion === "number"
        && typeof value.deviceId === "string"
        && typeof value.profileSignature === "string"
        && typeof value.fileCount === "number"
        && typeof value.chunkCount === "number"
        && typeof value.estimatedMemoryBytes === "number"
        && typeof value.legacyJsonCacheBytes === "number"
        && typeof value.updatedAt === "string";
}

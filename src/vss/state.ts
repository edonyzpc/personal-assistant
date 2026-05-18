import { normalizePath, type Vault } from "obsidian";
import { getDeviceId } from "../stats/stats-store";
import {
    VSS_FALLBACK_MAX_CHUNKS,
    VSS_FALLBACK_MAX_MEMORY_BYTES,
    type VSSIndexManifest,
    type VSSIndexMarker,
} from "./types";
import { getVaultConfigDir, joinVaultConfigPath, LEGACY_CONFIG_DIR, uniqueNormalizedPaths } from "../obsidian-paths";

const VSS_INDEX_STATE_CHILD_PATH = "plugins/personal-assistant/vss-index-state";
export const LEGACY_VSS_INDEX_STATE_ROOT = joinVaultConfigPath(LEGACY_CONFIG_DIR, VSS_INDEX_STATE_CHILD_PATH);
export const VSS_INDEX_STATE_ROOT = LEGACY_VSS_INDEX_STATE_ROOT;

export function getVSSDeviceId(): string {
    return getDeviceId();
}

export function getVSSIndexStateRoot(configDir = LEGACY_CONFIG_DIR): string {
    return joinVaultConfigPath(configDir, VSS_INDEX_STATE_CHILD_PATH);
}

export function getVSSIndexStateDir(deviceId: string, configDir = LEGACY_CONFIG_DIR): string {
    return normalizePath(`${getVSSIndexStateRoot(configDir)}/${deviceId}`);
}

export function getVSSMarkerPath(deviceId: string, configDir = LEGACY_CONFIG_DIR): string {
    return normalizePath(`${getVSSIndexStateDir(deviceId, configDir)}/marker.json`);
}

export function getVSSManifestPath(deviceId: string, configDir = LEGACY_CONFIG_DIR): string {
    return normalizePath(`${getVSSIndexStateDir(deviceId, configDir)}/manifest.json`);
}

export function shouldEnableMemoryFallback(manifest: VSSIndexManifest | null): boolean {
    if (!manifest) return false;
    return manifest.chunkCount <= VSS_FALLBACK_MAX_CHUNKS
        && manifest.estimatedMemoryBytes <= VSS_FALLBACK_MAX_MEMORY_BYTES;
}

export async function ensureVSSIndexStateDir(vault: Vault, deviceId: string): Promise<void> {
    const dir = getVSSIndexStateDir(deviceId, getVaultConfigDir(vault));
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
    return readFirstJsonFile<VSSIndexMarker>(vault, getVSSMarkerReadPaths(vault, deviceId), isVSSIndexMarker);
}

export async function writeVSSMarker(vault: Vault, marker: VSSIndexMarker): Promise<void> {
    await ensureVSSIndexStateDir(vault, marker.deviceId);
    await vault.adapter.write(getVSSMarkerPath(marker.deviceId, getVaultConfigDir(vault)), JSON.stringify(marker, null, 2));
}

export async function removeVSSMarker(vault: Vault, deviceId: string): Promise<void> {
    for (const path of getVSSMarkerReadPaths(vault, deviceId)) {
        await removeIfExists(vault, path);
    }
}

export async function readVSSManifest(vault: Vault, deviceId: string): Promise<VSSIndexManifest | null> {
    return readFirstJsonFile<VSSIndexManifest>(vault, getVSSManifestReadPaths(vault, deviceId), isVSSIndexManifest);
}

export async function writeVSSManifest(vault: Vault, manifest: VSSIndexManifest): Promise<void> {
    await ensureVSSIndexStateDir(vault, manifest.deviceId);
    await vault.adapter.write(getVSSManifestPath(manifest.deviceId, getVaultConfigDir(vault)), JSON.stringify(manifest, null, 2));
}

export async function removeVSSManifest(vault: Vault, deviceId: string): Promise<void> {
    for (const path of getVSSManifestReadPaths(vault, deviceId)) {
        await removeIfExists(vault, path);
    }
}

function getVSSMarkerReadPaths(vault: Vault, deviceId: string): string[] {
    const configDir = getVaultConfigDir(vault);
    return uniqueNormalizedPaths([
        getVSSMarkerPath(deviceId, configDir),
        getVSSMarkerPath(deviceId, LEGACY_CONFIG_DIR),
    ]);
}

function getVSSManifestReadPaths(vault: Vault, deviceId: string): string[] {
    const configDir = getVaultConfigDir(vault);
    return uniqueNormalizedPaths([
        getVSSManifestPath(deviceId, configDir),
        getVSSManifestPath(deviceId, LEGACY_CONFIG_DIR),
    ]);
}

async function readFirstJsonFile<T>(
    vault: Vault,
    paths: string[],
    guard: (value: unknown) => value is T,
): Promise<T | null> {
    for (const path of paths) {
        const value = await readJsonFile<T>(vault, path, guard);
        if (value) return value;
    }
    return null;
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

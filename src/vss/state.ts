import { normalizePath, type Vault } from "obsidian";
import { getDeviceId } from "../stats/stats-store";
import { type VSSIndexMarker } from "./types";
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

export async function readVSSMarker(vault: Vault, deviceId: string): Promise<VSSIndexMarker | null> {
    return readFirstJsonFile<VSSIndexMarker>(vault, getVSSMarkerReadPaths(vault, deviceId), isVSSIndexMarker);
}


function getVSSMarkerReadPaths(vault: Vault, deviceId: string): string[] {
    const configDir = getVaultConfigDir(vault);
    return uniqueNormalizedPaths([
        getVSSMarkerPath(deviceId, configDir),
        getVSSMarkerPath(deviceId, LEGACY_CONFIG_DIR),
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

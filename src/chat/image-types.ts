export type ImagePurpose = "preview" | "provider" | "note";
export type ImageAcquisition = "original_file" | "unverified_import";
export type ImageAssetState = "preserving" | "available" | "missing" | "changed";

export interface ImageRef { assetId: string; contentHash: string; }
export interface MessageImage { ref: ImageRef; ordinal: number; label: string; }
export interface ImageAssetOwner { kind: "turn" | "writing" | "save"; id: string; }

export interface ImageAsset {
    id: string;
    source: "imported" | "vault_reference";
    originalPath: string;
    originalHash: string;
    byteLength: number;
    detectedMime: string;
    acquisition: ImageAcquisition;
    state: ImageAssetState;
    anchorPath: string;
    anchorKind: 'logical_root' | 'existing_note';
    createdAt: number;
    owners: ImageAssetOwner[];
    /** Import directory is immutable even if the source file is later renamed. */
    importDirectory?: string;
    recoveryReason?: "input_required" | "path_conflict" | "finalize_failed";
}

/** Location determines chat-only ownership; provenance alone never grants deletion. */
export function isChatImageAsset(asset: ImageAsset): boolean {
    const parent = asset.originalPath.split('/').slice(0, -1);
    if (!parent.includes('pa-images')) return false;
    return asset.source === 'vault_reference' || !asset.importDirectory
        || asset.originalPath.startsWith(asset.importDirectory + '/');
}

export interface ImageVariantRecord {
    id: string;
    assetId: string;
    contentHash: string;
    processorVersion: number;
    purpose: ImagePurpose;
    policyFingerprint: string;
    blob: Blob;
    mime: string;
    width: number;
    height: number;
    byteLength: number;
    lastUsedAt: number;
}

export interface ImageVariantLease {
    blob: Blob;
    mime: string;
    width: number;
    height: number;
    persistent: boolean;
    warning?: "cache_not_retained";
    release(): void;
}

export type ImageSyncState = "configured" | "needs_user_setup" | "unknown";
export interface ImageSyncReceipt {
    directory: string;
    obsidianSync: ImageSyncState;
    git: ImageSyncState;
    iCloud: ImageSyncState;
    gitignoreRule: string;
    gitTracked: "unknown";
    previouslyUploaded: "unknown";
    noticeDismissed: boolean;
    noticeRequired: boolean;
}

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
// A writing version may associate images from many turns. The send limit of 8
// belongs to request admission, not this persisted metadata validator.
const MAX_METADATA_IMAGE_REFS = 2048;
function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid image metadata.");
    return value as Record<string, unknown>;
}
function string(value: unknown, max: number): string {
    if (typeof value !== "string" || value.length > max || Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error("Invalid image metadata text.");
    return value;
}
function integer(value: unknown, min = 0): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) throw new Error("Invalid image metadata number.");
    return value;
}
export function validateImagePath(value: unknown): string {
    const path = string(value, 4096);
    if (!path || path.startsWith("/") || path.includes("\\") || path.includes(":")
        || path.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
        throw new Error("Image path must stay inside the vault.");
    }
    return path;
}
export function cloneImageRef(value: unknown): ImageRef {
    const ref = object(value);
    if (typeof ref.assetId !== "string" || !ID.test(ref.assetId)
        || typeof ref.contentHash !== "string" || !HASH.test(ref.contentHash)) throw new Error("Invalid image reference.");
    return { assetId: ref.assetId, contentHash: ref.contentHash };
}
export function cloneMessageImages(value: unknown): MessageImage[] {
    if (!Array.isArray(value) || value.length > MAX_METADATA_IMAGE_REFS) throw new Error("Invalid message image list.");
    return value.map((input) => {
        const image = object(input);
        return { ref: cloneImageRef(image.ref), ordinal: integer(image.ordinal), label: string(image.label, 512) };
    });
}
export const parseMessageImages = cloneMessageImages;

export function cloneImageAsset(value: unknown): ImageAsset {
    const asset = object(value);
    const ref = cloneImageRef({ assetId: asset.id, contentHash: asset.originalHash });
    if (!["imported", "vault_reference"].includes(String(asset.source))
        || !["original_file", "unverified_import"].includes(String(asset.acquisition))
        || !["preserving", "available", "missing", "changed"].includes(String(asset.state))) throw new Error("Invalid image asset state.");
    if (asset.anchorKind !== 'logical_root' && asset.anchorKind !== 'existing_note') throw new Error('Invalid image anchor kind.');
    if (!Array.isArray(asset.owners) || asset.owners.length > 10000) throw new Error("Invalid image owner list.");
    const owners = asset.owners.map((input) => {
        const owner = object(input);
        if (owner.kind !== "turn" && owner.kind !== "writing" && owner.kind !== "save") throw new Error("Invalid image owner.");
        const id = string(owner.id, 1024);
        if (!id) throw new Error("Invalid image owner.");
        return { kind: owner.kind, id } as ImageAssetOwner;
    });
    const mime = string(asset.detectedMime, 128);
    if (!/^(image\/[a-z0-9.+-]+|application\/octet-stream)$/.test(mime)) throw new Error("Invalid image MIME.");
    const result: ImageAsset = {
        id: ref.assetId, originalHash: ref.contentHash,
        source: asset.source as ImageAsset["source"], originalPath: validateImagePath(asset.originalPath),
        byteLength: integer(asset.byteLength), detectedMime: mime,
        acquisition: asset.acquisition as ImageAcquisition, state: asset.state as ImageAssetState,
        anchorPath: validateImagePath(asset.anchorPath), anchorKind: asset.anchorKind, createdAt: integer(asset.createdAt), owners,
    };
    if (asset.importDirectory !== undefined) result.importDirectory = validateImagePath(asset.importDirectory);
    if (result.anchorKind === 'logical_root' && result.anchorPath !== 'PA Chat.md') throw new Error('Invalid logical image anchor.');
    if (result.source === "imported" && !result.importDirectory) throw new Error("Imported image directory is required.");
    if (asset.recoveryReason !== undefined) {
        if (!["input_required", "path_conflict", "finalize_failed"].includes(String(asset.recoveryReason))) throw new Error("Invalid image recovery state.");
        result.recoveryReason = asset.recoveryReason as ImageAsset["recoveryReason"];
    }
    return result;
}

export function cloneImageVariant(value: unknown): ImageVariantRecord {
    const variant = object(value);
    const ref = cloneImageRef({ assetId: variant.assetId, contentHash: variant.contentHash });
    if (!["preview", "provider", "note"].includes(String(variant.purpose))) throw new Error("Invalid image variant purpose.");
    // Blob objects may originate in another Obsidian window; avoid instanceof.
    const blob = variant.blob as Blob;
    if (!blob || typeof blob.arrayBuffer !== "function" || typeof blob.slice !== "function"
        || !Number.isSafeInteger(blob.size)) throw new Error("Image variant Blob is required.");
    const byteLength = integer(variant.byteLength);
    if (blob.size !== byteLength || byteLength > 4 * 1024 * 1024) throw new Error("Invalid image variant size.");
    if (variant.mime !== "image/jpeg" || blob.type !== "image/jpeg") throw new Error("Invalid image variant MIME.");
    const result = { id: string(variant.id, 512), assetId: ref.assetId, contentHash: ref.contentHash,
        processorVersion: integer(variant.processorVersion, 1), purpose: variant.purpose as ImagePurpose,
        policyFingerprint: string(variant.policyFingerprint, 256), blob, mime: "image/jpeg",
        width: integer(variant.width, 1), height: integer(variant.height, 1), byteLength,
        lastUsedAt: integer(variant.lastUsedAt) };
    if (!result.id || !result.policyFingerprint) throw new Error("Invalid image variant identity.");
    return result;
}

export function imageTurnOwnerId(conversationId: string, turnIndex: number): string {
    return JSON.stringify([conversationId, turnIndex]);
}

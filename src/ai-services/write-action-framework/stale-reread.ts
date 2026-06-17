/**
 * Stale Re-read Module (Gate 3) — framework SDD §2.3, mode A + mode B.
 *
 * Detects time-of-check / time-of-use drift between when the preview was shown
 * to the user and when the write actually executes.
 *
 * Mode A: target snapshot (folder existence + target existence).
 * Mode B: SHA-256 content hash for append/replace families — detects content
 *         changes between preview and execute (TOCTOU protection).
 *
 * Lifecycle:
 *   1. After Gate 1 passes, framework calls `takeSnapshot(target, fs, options)`.
 *   2. Modal renders; user confirms.
 *   3. Before calling `capability.executeWrite`, framework calls
 *      `checkStaleReread(snapshot, fs)`.
 *   4. Any drift (folder disappeared, target appeared, content changed, or —
 *      defensive — folder reappeared after being absent) returns
 *      `{ stale: true, drift: {...} }` and the runtime emits
 *      `gate.stale-reread.drift`.
 */

import { getPlatformCrypto } from "../../platform-dom";
import type { TargetSnapshot } from "./types";

export interface StaleReadProbe {
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
}

export interface StaleDriftDetail {
    folderDisappeared?: boolean;
    folderReappeared?: boolean;
    targetAppeared?: boolean;
    targetDisappeared?: boolean;
    contentChanged?: boolean;
}

export type StaleReadResult =
    | { stale: false; checkedAt: number }
    | { stale: true; drift: StaleDriftDetail; checkedAt: number };

/** Convert an ArrayBuffer digest to a lowercase hex string. */
function hexEncode(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/** Compute SHA-256 hex digest of `text` using the platform Crypto API. */
async function sha256(text: string): Promise<string> {
    const subtle = getPlatformCrypto()?.subtle;
    if (!subtle) {
        throw new Error("stale-reread mode B requires Web Crypto API (subtle)");
    }
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
    return hexEncode(digest);
}

/**
 * Capture folder/target existence at the moment a preview is shown.
 * Folder is derived as the parent of `targetPath` (POSIX-style); a target at
 * the vault root reports `folderExists=true` (root always exists).
 *
 * When `options.includeContentHash` is true (mode B), the file content is read
 * and its SHA-256 hash + byte length are stored in the snapshot for later
 * content-change detection.
 */
export async function takeSnapshot(
    target: { targetPath: string; folder: string },
    fs: StaleReadProbe,
    options?: { includeContentHash?: boolean },
    now: () => number = Date.now,
): Promise<TargetSnapshot> {
    const { targetPath, folder } = target;
    const folderExists = folder === "" ? true : await fs.exists(folder);
    const targetExists = await fs.exists(targetPath);

    const snap: TargetSnapshot = {
        targetPath,
        folderExists,
        targetExists,
        capturedAt: now(),
    };

    if (options?.includeContentHash && targetExists) {
        const content = await fs.read(targetPath);
        snap.contentHash = await sha256(content);
        snap.contentLength = new TextEncoder().encode(content).byteLength;
    }

    return snap;
}

/**
 * Re-read folder/target existence and compare against the snapshot. **Any**
 * difference between snapshot and current state counts as drift, even
 * superficially "harmless" ones (e.g., a target that briefly appeared and
 * disappeared again is not observable here, but a folder that vanished and
 * came back IS reported because `folderReappeared` could mask a structural
 * change underneath).
 *
 * Mode B: if the snapshot includes `contentHash`, the file is re-read and its
 * content is compared. A length-mismatch short-circuit avoids a full SHA-256
 * when the byte length alone proves drift.
 */
export async function checkStaleReread(
    snapshot: TargetSnapshot,
    fs: StaleReadProbe,
    now: () => number = Date.now,
): Promise<StaleReadResult> {
    const lastSlash = snapshot.targetPath.lastIndexOf("/");
    const folder = lastSlash > 0 ? snapshot.targetPath.substring(0, lastSlash) : "";
    const folderNow = folder === "" ? true : await fs.exists(folder);
    const targetNow = await fs.exists(snapshot.targetPath);

    const drift: StaleDriftDetail = {};
    if (snapshot.folderExists && !folderNow) drift.folderDisappeared = true;
    if (!snapshot.folderExists && folderNow) drift.folderReappeared = true;
    if (!snapshot.targetExists && targetNow) drift.targetAppeared = true;
    if (snapshot.targetExists && !targetNow) drift.targetDisappeared = true;

    // Mode B: content hash comparison (only when snapshot has a hash AND target still exists)
    if (snapshot.contentHash != null && targetNow) {
        const content = await fs.read(snapshot.targetPath);
        const currentLength = new TextEncoder().encode(content).byteLength;
        if (currentLength !== snapshot.contentLength) {
            // Length mismatch — skip full hash, guaranteed drift.
            drift.contentChanged = true;
        } else {
            const currentHash = await sha256(content);
            if (currentHash !== snapshot.contentHash) {
                drift.contentChanged = true;
            }
        }
    }

    if (Object.keys(drift).length === 0) {
        return { stale: false, checkedAt: now() };
    }
    return { stale: true, drift, checkedAt: now() };
}

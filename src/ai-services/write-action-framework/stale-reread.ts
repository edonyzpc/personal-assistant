/**
 * Stale Re-read Module (Gate 3) — framework SDD §2.3, mode A only.
 *
 * Detects time-of-check / time-of-use drift between when the preview was shown
 * to the user and when the write actually executes. v1 covers only "mode A":
 * target snapshot (folder existence + target existence). Mode B (source content
 * hash for append/replace families) is deferred to Operations Agent mode — see
 * framework SDD §10 upgrade trigger.
 *
 * Lifecycle:
 *   1. After Gate 1 passes, framework calls `takeSnapshot(normalizedPath, fs)`.
 *   2. Modal renders; user confirms.
 *   3. Before calling `capability.executeWrite`, framework calls
 *      `checkStaleReread(snapshot, fs)`.
 *   4. Any drift (folder disappeared, target appeared, or — defensive — folder
 *      reappeared after being absent) returns `{ stale: true, drift: {...} }`
 *      and the runtime emits `gate.stale-reread.drift`.
 */

import type { TargetSnapshot } from "./types";

export interface StaleReadProbe {
    exists(path: string): Promise<boolean>;
}

export interface StaleDriftDetail {
    folderDisappeared?: boolean;
    folderReappeared?: boolean;
    targetAppeared?: boolean;
    targetDisappeared?: boolean;
}

export type StaleReadResult =
    | { stale: false; checkedAt: number }
    | { stale: true; drift: StaleDriftDetail; checkedAt: number };

/**
 * Capture folder/target existence at the moment a preview is shown.
 * Folder is derived as the parent of `targetPath` (POSIX-style); a target at
 * the vault root reports `folderExists=true` (root always exists).
 */
export async function takeSnapshot(
    targetPath: string,
    fs: StaleReadProbe,
    now: () => number = Date.now,
): Promise<TargetSnapshot> {
    const lastSlash = targetPath.lastIndexOf("/");
    const folder = lastSlash > 0 ? targetPath.substring(0, lastSlash) : "";
    const folderExists = folder === "" ? true : await fs.exists(folder);
    const targetExists = await fs.exists(targetPath);
    return {
        targetPath,
        folderExists,
        targetExists,
        capturedAt: now(),
    };
}

/**
 * Re-read folder/target existence and compare against the snapshot. **Any**
 * difference between snapshot and current state counts as drift, even
 * superficially "harmless" ones (e.g., a target that briefly appeared and
 * disappeared again is not observable here, but a folder that vanished and
 * came back IS reported because `folderReappeared` could mask a structural
 * change underneath).
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

    if (Object.keys(drift).length === 0) {
        return { stale: false, checkedAt: now() };
    }
    return { stale: true, drift, checkedAt: now() };
}

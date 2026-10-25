import { describe, expect, it, jest } from "@jest/globals";

import {
    checkStaleReread,
    takeSnapshot,
    type StaleReadProbe,
} from "./stale-reread";

function probe(existsMap: Record<string, boolean>): StaleReadProbe {
    return {
        exists: jest.fn(async (path: string) => existsMap[path] ?? false) as StaleReadProbe["exists"],
    };
}

/** Helper: derive folder from a target path (mirrors takeSnapshot's caller convention). */
function target(targetPath: string): { targetPath: string; folder: string } {
    const lastSlash = targetPath.lastIndexOf("/");
    return { targetPath, folder: lastSlash > 0 ? targetPath.substring(0, lastSlash) : "" };
}

describe("takeSnapshot (framework SDD §2.3)", () => {
    it("captures folderExists + targetExists at vault path", async () => {
        const fs = probe({ ".pagelet": true, ".pagelet/foo.md": false });
        const snap = await takeSnapshot(target(".pagelet/foo.md"), fs, () => 1000);
        expect(snap).toEqual({
            targetPath: ".pagelet/foo.md",
            folderExists: true,
            targetExists: false,
            capturedAt: 1000,
        });
    });

    it("reports folderExists=true implicitly when target is at vault root", async () => {
        const fs = probe({ "root.md": false });
        const snap = await takeSnapshot(target("root.md"), fs);
        expect(snap.folderExists).toBe(true);
        expect(snap.targetExists).toBe(false);
    });

    it("captures targetExists=true when target already exists", async () => {
        const fs = probe({ ".pagelet": true, ".pagelet/foo.md": true });
        const snap = await takeSnapshot(target(".pagelet/foo.md"), fs);
        expect(snap.folderExists).toBe(true);
        expect(snap.targetExists).toBe(true);
    });
});

describe("checkStaleReread (drift detection)", () => {
    it("returns stale=false when state is unchanged", async () => {
        const fs = probe({ ".pagelet": true, ".pagelet/foo.md": false });
        const snap = await takeSnapshot(target(".pagelet/foo.md"), fs);
        const result = await checkStaleReread(snap, fs, () => 2000);
        expect(result).toEqual({ stale: false, checkedAt: 2000 });
    });

    it("detects targetAppeared when another actor created the file after preview", async () => {
        const fsBefore = probe({ ".pagelet": true, ".pagelet/foo.md": false });
        const snap = await takeSnapshot(target(".pagelet/foo.md"), fsBefore);
        const fsAfter = probe({ ".pagelet": true, ".pagelet/foo.md": true });
        const result = await checkStaleReread(snap, fsAfter);
        expect(result.stale).toBe(true);
        if (result.stale) expect(result.drift).toMatchObject({ targetAppeared: true });
    });

    it("detects folderDisappeared when the parent folder is removed after preview", async () => {
        const fsBefore = probe({ ".pagelet": true, ".pagelet/foo.md": false });
        const snap = await takeSnapshot(target(".pagelet/foo.md"), fsBefore);
        const fsAfter = probe({ ".pagelet": false, ".pagelet/foo.md": false });
        const result = await checkStaleReread(snap, fsAfter);
        expect(result.stale).toBe(true);
        if (result.stale) expect(result.drift).toMatchObject({ folderDisappeared: true });
    });

    it("detects targetDisappeared when a snapshot-time-existing target is removed", async () => {
        // edge case: snapshot saw target as existing (collision would have rejected
        // at Gate 1 in real flow, but verify drift detection is symmetric)
        const fsBefore = probe({ ".pagelet": true, ".pagelet/foo.md": true });
        const snap = await takeSnapshot(target(".pagelet/foo.md"), fsBefore);
        const fsAfter = probe({ ".pagelet": true, ".pagelet/foo.md": false });
        const result = await checkStaleReread(snap, fsAfter);
        expect(result.stale).toBe(true);
        if (result.stale) expect(result.drift).toMatchObject({ targetDisappeared: true });
    });

    it("detects folderReappeared (defensive drift signal)", async () => {
        const fsBefore = probe({ ".pagelet": false, ".pagelet/foo.md": false });
        const snap = await takeSnapshot(target(".pagelet/foo.md"), fsBefore);
        const fsAfter = probe({ ".pagelet": true, ".pagelet/foo.md": false });
        const result = await checkStaleReread(snap, fsAfter);
        expect(result.stale).toBe(true);
        if (result.stale) expect(result.drift).toMatchObject({ folderReappeared: true });
    });

    it("reports multiple drift flags together (folderDisappeared + targetAppeared)", async () => {
        const fsBefore = probe({ ".pagelet": true, ".pagelet/foo.md": false });
        const snap = await takeSnapshot(target(".pagelet/foo.md"), fsBefore);
        const fsAfter = probe({ ".pagelet": false, ".pagelet/foo.md": true });
        const result = await checkStaleReread(snap, fsAfter);
        expect(result.stale).toBe(true);
        if (result.stale) {
            expect(result.drift).toMatchObject({
                folderDisappeared: true,
                targetAppeared: true,
            });
        }
    });
});

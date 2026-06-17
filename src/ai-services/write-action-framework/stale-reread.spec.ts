import { describe, expect, it, jest } from "@jest/globals";

import {
    checkStaleReread,
    takeSnapshot,
    type StaleReadProbe,
} from "./stale-reread";

function probe(
    existsMap: Record<string, boolean>,
    readMap: Record<string, string> = {},
): StaleReadProbe {
    return {
        exists: jest.fn(async (path: string) => existsMap[path] ?? false) as StaleReadProbe["exists"],
        read: jest.fn(async (path: string) => readMap[path] ?? "") as StaleReadProbe["read"],
    };
}

/** Helper: derive folder from a target path (mirrors takeSnapshot's caller convention). */
function target(targetPath: string): { targetPath: string; folder: string } {
    const lastSlash = targetPath.lastIndexOf("/");
    return { targetPath, folder: lastSlash > 0 ? targetPath.substring(0, lastSlash) : "" };
}

describe("takeSnapshot (framework SDD §2.3 mode A)", () => {
    it("captures folderExists + targetExists at vault path", async () => {
        const fs = probe({ ".pagelet": true, ".pagelet/foo.md": false });
        const snap = await takeSnapshot(target(".pagelet/foo.md"), fs, undefined, () => 1000);
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

describe("takeSnapshot mode B (content hash)", () => {
    it("stores contentHash and contentLength when includeContentHash is true", async () => {
        const content = "# Hello world\nsome text";
        const fs = probe(
            { ".pagelet": true, ".pagelet/note.md": true },
            { ".pagelet/note.md": content },
        );
        const snap = await takeSnapshot(
            target(".pagelet/note.md"),
            fs,
            { includeContentHash: true },
        );
        expect(snap.contentHash).toBeDefined();
        expect(typeof snap.contentHash).toBe("string");
        // SHA-256 hex is 64 chars
        expect(snap.contentHash).toHaveLength(64);
        expect(snap.contentLength).toBe(new TextEncoder().encode(content).byteLength);
    });

    it("does not populate contentHash when includeContentHash is false/omitted", async () => {
        const fs = probe(
            { ".pagelet": true, ".pagelet/note.md": true },
            { ".pagelet/note.md": "content" },
        );
        const snap = await takeSnapshot(target(".pagelet/note.md"), fs);
        expect(snap.contentHash).toBeUndefined();
        expect(snap.contentLength).toBeUndefined();
    });

    it("does not populate contentHash when target does not exist (even if includeContentHash is true)", async () => {
        const fs = probe({ ".pagelet": true, ".pagelet/note.md": false });
        const snap = await takeSnapshot(
            target(".pagelet/note.md"),
            fs,
            { includeContentHash: true },
        );
        expect(snap.contentHash).toBeUndefined();
        expect(snap.contentLength).toBeUndefined();
    });
});

describe("checkStaleReread mode B (content drift)", () => {
    it("detects content change via hash mismatch", async () => {
        const originalContent = "original text";
        const fsBefore = probe(
            { ".pagelet": true, ".pagelet/note.md": true },
            { ".pagelet/note.md": originalContent },
        );
        const snap = await takeSnapshot(
            target(".pagelet/note.md"),
            fsBefore,
            { includeContentHash: true },
        );

        const changedContent = "modified text";
        const fsAfter = probe(
            { ".pagelet": true, ".pagelet/note.md": true },
            { ".pagelet/note.md": changedContent },
        );
        const result = await checkStaleReread(snap, fsAfter);
        expect(result.stale).toBe(true);
        if (result.stale) {
            expect(result.drift.contentChanged).toBe(true);
        }
    });

    it("uses contentLength shortcut — skips full hash on length mismatch", async () => {
        const originalContent = "short";
        const fsBefore = probe(
            { ".pagelet": true, ".pagelet/note.md": true },
            { ".pagelet/note.md": originalContent },
        );
        const snap = await takeSnapshot(
            target(".pagelet/note.md"),
            fsBefore,
            { includeContentHash: true },
        );

        // Changed content has different byte length
        const longerContent = "short plus extra content appended here";
        const fsAfter = probe(
            { ".pagelet": true, ".pagelet/note.md": true },
            { ".pagelet/note.md": longerContent },
        );
        const result = await checkStaleReread(snap, fsAfter);
        expect(result.stale).toBe(true);
        if (result.stale) {
            expect(result.drift.contentChanged).toBe(true);
        }
    });

    it("returns stale=false when content is unchanged", async () => {
        const content = "stable content stays the same";
        const fsBefore = probe(
            { ".pagelet": true, ".pagelet/note.md": true },
            { ".pagelet/note.md": content },
        );
        const snap = await takeSnapshot(
            target(".pagelet/note.md"),
            fsBefore,
            { includeContentHash: true },
        );

        // Same content on re-read
        const fsAfter = probe(
            { ".pagelet": true, ".pagelet/note.md": true },
            { ".pagelet/note.md": content },
        );
        const result = await checkStaleReread(snap, fsAfter);
        expect(result.stale).toBe(false);
    });

    it("skips content check when target has been removed (reports targetDisappeared instead)", async () => {
        const content = "will be deleted";
        const fsBefore = probe(
            { ".pagelet": true, ".pagelet/note.md": true },
            { ".pagelet/note.md": content },
        );
        const snap = await takeSnapshot(
            target(".pagelet/note.md"),
            fsBefore,
            { includeContentHash: true },
        );

        // Target removed — content check should not run
        const fsAfter = probe(
            { ".pagelet": true, ".pagelet/note.md": false },
        );
        const result = await checkStaleReread(snap, fsAfter);
        expect(result.stale).toBe(true);
        if (result.stale) {
            expect(result.drift.targetDisappeared).toBe(true);
            expect(result.drift.contentChanged).toBeUndefined();
        }
    });

    it("mode A non-regression: existence-only drift still works without contentHash", async () => {
        // Snapshot without mode B
        const fsBefore = probe({ ".pagelet": true, ".pagelet/foo.md": false });
        const snap = await takeSnapshot(target(".pagelet/foo.md"), fsBefore);
        expect(snap.contentHash).toBeUndefined();

        // Target appears — mode A drift
        const fsAfter = probe({ ".pagelet": true, ".pagelet/foo.md": true });
        const result = await checkStaleReread(snap, fsAfter);
        expect(result.stale).toBe(true);
        if (result.stale) {
            expect(result.drift.targetAppeared).toBe(true);
            expect(result.drift.contentChanged).toBeUndefined();
        }
    });
});

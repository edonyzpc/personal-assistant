import { describe, expect, it } from "@jest/globals";
import {
    GhostNoteBindingAdapter,
    type GhostBindingHost,
} from "../src/ghost-publishing/binding";
import type { GhostPublishingSourceFile, GhostPublishingSourceGuard } from "../src/ghost-publishing/types";

const SITE = "https://ghost.example/blog/";
const POST_ID = "0123456789abcdef01234567";
const BODY = "# Original heading\r\n\r\n  untouched whitespace\r\n![[cover.png]]\r\n";

interface NoteFile extends GhostPublishingSourceFile {
    text: string;
    stat: { mtime: number; size: number };
}

function frontmatterInfo(markdown: string): { exists: boolean; frontmatter: string; contentStart: number } {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
    return match
        ? { exists: true, frontmatter: match[1], contentStart: match[0].length }
        : { exists: false, frontmatter: "", contentStart: 0 };
}

// JSON mappings are valid YAML. The adapter uses the injected public parser,
// while this fixture keeps actual serialized Properties and body bytes separate.
function noteText(properties: Record<string, unknown> | null, body = BODY): string {
    return properties === null ? body : `---\n${JSON.stringify(properties, null, 2)}\n---\n${body}`;
}

function properties(file: NoteFile): Record<string, unknown> {
    const info = frontmatterInfo(file.text);
    return info.exists ? JSON.parse(info.frontmatter) : {};
}

function noteBody(file: NoteFile): string {
    return file.text.slice(frontmatterInfo(file.text).contentStart);
}

function fixture(inputs: Array<{ path: string; properties: Record<string, unknown> | null }>) {
    const files: NoteFile[] = inputs.map((input) => {
        const text = noteText(input.properties);
        return { path: input.path, extension: "md", text, stat: { mtime: 1, size: text.length } };
    });
    const cache = new Map<GhostPublishingSourceFile, Record<string, unknown>>(
        files.map((file) => [file, structuredClone(properties(file))]),
    );
    const state = {
        writes: 0,
        processCalls: 0,
        reads: [] as string[],
        readHook: undefined as undefined | (() => Promise<void>),
        mutationHook: undefined as undefined | ((file: NoteFile) => Promise<void>),
        writeFails: false,
    };
    const replace = (file: NoteFile, text: string) => {
        file.text = text;
        file.stat = { mtime: file.stat.mtime + 1, size: text.length };
    };
    const host: GhostBindingHost = {
        vault: {
            getAbstractFileByPath: (path) => files.find((file) => file.path === path) ?? null,
            getMarkdownFiles: () => [...files],
            read: async (source) => {
                state.reads.push(source.path);
                await state.readHook?.();
                return (source as NoteFile).text;
            },
        },
        metadataCache: { getFileCache: (file) => ({ frontmatter: cache.get(file) }) },
        fileManager: {
            processFrontMatter: async (source, mutate) => {
                state.processCalls++;
                const file = source as NoteFile;
                await state.mutationHook?.(file);
                if (state.writeFails) throw new Error("private local write error");
                // Like processFrontMatter, callback sees the latest Properties,
                // and a thrown callback cannot commit a partial mutation.
                const current = properties(file);
                const latestBody = noteBody(file);
                mutate(current);
                replace(file, noteText(current, latestBody));
                state.writes++;
                // Intentionally leave cache stale to exercise fresh Vault.read authority.
            },
        },
        getFrontMatterInfo: frontmatterInfo,
        parseYaml: (yaml) => JSON.parse(yaml),
    };
    return { files, cache, state, host, replace };
}

function guard(overrides: Partial<GhostPublishingSourceGuard> = {}): GhostPublishingSourceGuard {
    return {
        isCurrent: () => true,
        isPathAllowed: () => true,
        isNoteDomainAllowed: () => true,
        captureSourceValidity: () => () => true,
        ...overrides,
    };
}

function adapter(host: GhostBindingHost, isDesktop = () => true): GhostNoteBindingAdapter {
    return new GhostNoteBindingAdapter(host, { site: SITE, isDesktop });
}

describe("Ghost single-ID note association", () => {
    it("reads only GHOST_ID without writing identity or consulting another note", async () => {
        const legacy = { pa_ghost: { note_uid: "old", site: "https://old.example", post_id: POST_ID },
            pa_ghost_post_id: POST_ID, pa_ghost_site: "bad", pa_ghost_post_url: 42, title: "Keep" };
        const f = fixture([{ path: "legacy.md", properties: legacy }, { path: "bound.md", properties: { ...legacy, GHOST_ID: POST_ID.toUpperCase() } }]);
        expect(await adapter(f.host).resolve({ path: "legacy.md" }, guard())).toMatchObject({ path: "legacy.md", changed: false });
        expect((await adapter(f.host).resolve({ path: "legacy.md" }, guard())).postId).toBeUndefined();
        expect(await adapter(f.host).resolve({ path: "bound.md" }, guard())).toMatchObject({ postId: POST_ID, changed: false });
        expect(f.state.writes).toBe(0);
        expect(properties(f.files[0])).toEqual(legacy);
        expect(f.state.reads).toEqual(["legacy.md", "legacy.md", "bound.md"]);
    });

    it("distinguishes an absent ID from an illegal value even when an old field contains a valid ID", async () => {
        for (const value of ["", null, 42, {}, [], "not-a-post-id"]) {
            const f = fixture([{ path: "note.md", properties: { GHOST_ID: value, pa_ghost_post_id: POST_ID } }]);
            await expect(adapter(f.host).resolve({ path: "note.md" }, guard())).rejects.toMatchObject({ code: "invalid-binding" });
            expect(f.state.processCalls).toBe(0);
            expect(properties(f.files[0]).GHOST_ID).toEqual(value);
        }
        const empty = fixture([{ path: "note.md", properties: null }]);
        expect((await adapter(empty.host).resolve({ path: "note.md" }, guard())).postId).toBeUndefined();
        expect(empty.state.writes).toBe(0);
    });

    it("writes only the confirmed formal ID and preserves old keys, current body and other Properties", async () => {
        const other = { pa_ghost: { note_uid: "old" }, pa_ghost_post_id: "old", title: "Title", tags: ["Keep"], custom: { nested: true } };
        const f = fixture([{ path: "note.md", properties: other }]);
        const latest = BODY + "\r\nAdded while reviewing.";
        f.state.mutationHook = async (file) => f.replace(file, noteText({ ...properties(file), owner: "new" }, latest));
        const api = adapter(f.host);
        expect(await api.writeBinding({ path: "note.md" }, { postId: POST_ID, expectedPostId: null }, guard()))
            .toMatchObject({ postId: POST_ID, changed: true });
        expect(properties(f.files[0])).toEqual({ ...other, owner: "new", GHOST_ID: POST_ID });
        expect(noteBody(f.files[0])).toBe(latest);
        expect(await api.writeBinding({ path: "note.md" }, { postId: POST_ID, expectedPostId: null }, guard()))
            .toMatchObject({ changed: false });
        expect(f.state.writes).toBe(1);
    });

    it("replaces only the captured original ID and preserves it when the local write fails", async () => {
        const originalId = "b".repeat(24);
        const f = fixture([{ path: "note.md", properties: { GHOST_ID: originalId, other: true } }]);
        const api = adapter(f.host);
        await expect(api.writeBinding({ path: "note.md" }, { postId: POST_ID }, guard()))
            .rejects.toMatchObject({ code: "identity-mismatch" });
        f.state.writeFails = true;
        await expect(api.writeBinding({ path: "note.md" }, { postId: POST_ID, expectedPostId: originalId }, guard()))
            .rejects.toMatchObject({ code: "write-failed" });
        expect(properties(f.files[0])).toEqual({ GHOST_ID: originalId, other: true });
        f.state.writeFails = false;
        expect(await api.writeBinding({ path: "note.md" }, { postId: POST_ID, expectedPostId: originalId }, guard()))
            .toMatchObject({ postId: POST_ID, changed: true });
    });

    it("checks the latest callback association before changing Properties", async () => {
        const f = fixture([{ path: "note.md", properties: { title: "Keep" } }]);
        f.state.mutationHook = async (file) => f.replace(file, noteText({ ...properties(file), GHOST_ID: "c".repeat(24) }));
        await expect(adapter(f.host).writeBinding({ path: "note.md" }, { postId: POST_ID, expectedPostId: null }, guard()))
            .rejects.toMatchObject({ code: "identity-mismatch" });
        expect(f.state.writes).toBe(0);
        expect(properties(f.files[0])).toEqual({ title: "Keep", GHOST_ID: "c".repeat(24) });
    });

    it("requires desktop, a current guard and an allowed path before reading", async () => {
        const f = fixture([{ path: "note.md", properties: null }]);
        await expect(adapter(f.host, () => false).resolve({ path: "note.md" }, guard())).rejects.toMatchObject({ code: "unsupported-platform" });
        await expect(adapter(f.host).resolve({ path: "note.md" }, undefined as unknown as GhostPublishingSourceGuard))
            .rejects.toMatchObject({ code: "missing-guard" });
        await expect(adapter(f.host).resolve({ path: "note.md" }, guard({ isPathAllowed: () => false })))
            .rejects.toMatchObject({ code: "guard-revoked" });
        expect(f.state.reads).toEqual([]);
    });

    it("blocks actual revocation after a read and inside the property write", async () => {
        for (const point of ["read", "write"]) {
            const f = fixture([{ path: "note.md", properties: null }]);
            let active = true;
            if (point === "read") f.state.readHook = async () => { active = false; };
            else f.state.mutationHook = async () => { active = false; };
            await expect(adapter(f.host).writeBinding({ path: "note.md" }, { postId: POST_ID }, guard({ captureSourceValidity: () => () => active })))
                .rejects.toMatchObject({ code: "guard-revoked" });
            expect(f.state.writes).toBe(0);
            expect(properties(f.files[0])).toEqual({});
        }
    });

    it("rejects a different file at the same path instead of writing its association", async () => {
        const f = fixture([{ path: "note.md", properties: null }]);
        f.state.mutationHook = async () => { f.files[0] = { ...f.files[0], text: noteText({ owner: "replacement" }) }; };
        await expect(adapter(f.host).writeBinding({ path: "note.md" }, { postId: POST_ID }, guard()))
            .rejects.toMatchObject({ code: "source-changed" });
        expect(f.state.writes).toBe(0);
        expect(properties(f.files[0])).toEqual({ owner: "replacement" });
    });

    it("rejects malformed Properties and unsafe selections without inventing an unbound article", async () => {
        const f = fixture([{ path: "note.md", properties: null }]);
        f.replace(f.files[0], "---\nGHOST_ID: unfinished");
        await expect(adapter(f.host).resolve({ path: "note.md" }, guard())).rejects.toMatchObject({ code: "invalid-frontmatter" });
        for (const path of ["/note.md", "../note.md", "a//note.md", "a\\note.md", "a\nnote.md"]) {
            await expect(adapter(f.host).resolve({ path }, guard())).rejects.toMatchObject({ code: "invalid-selection" });
        }
        expect(f.state.processCalls).toBe(0);
    });
});

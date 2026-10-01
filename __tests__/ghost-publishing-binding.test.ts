import { describe, expect, it, jest } from "@jest/globals";
import {
    GhostNoteBindingAdapter,
    type GhostBindingHost, type GhostNoteBinding,
} from "../src/ghost-publishing/binding";
import type { GhostPublishingSourceFile, GhostPublishingSourceGuard } from "../src/ghost-publishing/types";

const SITE = "https://ghost.example/blog/";
const UID = "note-identity-one";
const POST_ID = "0123456789abcdef01234567";
const POST_URL = "https://public.example/article/";
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
    return new GhostNoteBindingAdapter(host, { site: SITE, isDesktop, createNoteUid: () => UID });
}

function binding(extra: Partial<GhostNoteBinding> = {}): GhostNoteBinding {
    return { note_uid: UID, site: SITE, ...extra };
}

describe("Ghost note binding adapter", () => {
    it("persists UID before the remote identity, preserves real body/other Properties and permits local repair without replacing identity", async () => {
        const other = { title: "Local title", tags: ["keep", "unchanged"], custom: { nested: true } };
        const f = fixture([{ path: "note.md", properties: other }]);
        const api = adapter(f.host);
        const initial = await api.ensureNoteUid({ path: "note.md" }, guard());
        expect(initial).toMatchObject({ path: "note.md", binding: binding(), changed: true });
        expect(properties(f.files[0])).toEqual({
            ...other,
            pa_ghost: UID,
            pa_ghost_site: SITE,
        });
        expect(noteBody(f.files[0])).toBe(BODY);
        expect(f.cache.get(f.files[0])?.pa_ghost).toBeUndefined();

        f.state.writeFails = true;
        await expect(api.writeBinding({ path: "note.md", noteUid: UID }, { postId: POST_ID, postUrl: POST_URL }, guard()))
            .rejects.toMatchObject({ code: "write-failed" });
        expect(properties(f.files[0])).toEqual({
            ...other, pa_ghost: UID, pa_ghost_site: SITE,
        });
        f.state.writeFails = false;
        const repaired = await api.writeBinding({ path: "note.md", noteUid: UID }, { postId: POST_ID, postUrl: POST_URL }, guard());
        expect(repaired.binding).toEqual(binding({ post_id: POST_ID, post_url: POST_URL }));
        expect(properties(f.files[0])).toEqual({
            ...other,
            pa_ghost: UID,
            pa_ghost_site: SITE,
            pa_ghost_post_id: POST_ID,
            pa_ghost_post_url: POST_URL,
        });
        expect(noteBody(f.files[0])).toBe(BODY);
        expect(await api.ensureNoteUid({ path: "note.md" }, guard())).toMatchObject({ changed: false, binding: repaired.binding });
        expect(await api.writeBinding({ path: "note.md", noteUid: UID }, { postId: POST_ID, postUrl: POST_URL }, guard()))
            .toMatchObject({ changed: false });
        expect(f.state.writes).toBe(2);
        expect(f.state.processCalls).toBe(3);
        expect(properties(f.files[0])).toEqual({
            ...other,
            pa_ghost: UID,
            pa_ghost_site: SITE,
            pa_ghost_post_id: POST_ID,
            pa_ghost_post_url: POST_URL,
        });
    });

    it("reads native Text properties, migrates old objects atomically, and rejects mixed identities", async () => {
        const native = fixture([{ path: "note.md", properties: {
            pa_ghost: UID, pa_ghost_site: SITE, keep: "value",
        } }]);
        const nativeApi = adapter(native.host);
        const resolved = await nativeApi.resolve({ path: "note.md" }, guard());
        expect(resolved).toMatchObject({ binding: binding(), changed: false });
        await expect(nativeApi.ensureNoteUid({ path: "note.md" }, guard())).resolves.toMatchObject({ changed: false });
        expect(native.state.processCalls).toBe(0);

        const old = fixture([{ path: "note.md", properties: {
            pa_ghost: binding({ post_id: POST_ID, post_url: POST_URL }), keep: "value",
        } }]);
        const oldApi = adapter(old.host);
        const migrated = await oldApi.ensureNoteUid({ path: "note.md" }, guard());
        expect(migrated.binding).toEqual(binding({ post_id: POST_ID, post_url: POST_URL }));
        expect(old.state.processCalls).toBe(1);
        expect(properties(old.files[0])).toEqual({
            pa_ghost: UID,
            pa_ghost_site: SITE,
            pa_ghost_post_id: POST_ID,
            pa_ghost_post_url: POST_URL,
            keep: "value",
        });
        expect(noteBody(old.files[0])).toBe(BODY);

        const exact = fixture([{ path: "note.md", properties: {
            pa_ghost: binding(), pa_ghost_site: SITE,
        } }]);
        await expect(adapter(exact.host).ensureNoteUid({ path: "note.md" }, guard()))
            .rejects.toMatchObject({ code: "invalid-binding" });
        expect(exact.state.processCalls).toBe(0);

        const mixed = fixture([{ path: "note.md", properties: {
            pa_ghost: binding(), pa_ghost_site: "https://another.example/",
        } }]);
        await expect(adapter(mixed.host).ensureNoteUid({ path: "note.md" }, guard()))
            .rejects.toMatchObject({ code: "invalid-binding" });
        expect(mixed.state.processCalls).toBe(0);

        const partial = fixture([{ path: "note.md", properties: { pa_ghost_site: SITE } }]);
        await expect(adapter(partial.host).ensureNoteUid({ path: "note.md" }, guard()))
            .rejects.toMatchObject({ code: "invalid-binding" });
        expect(partial.state.processCalls).toBe(0);

        const numeric = fixture([{ path: "note.md", properties: {
            pa_ghost: UID, pa_ghost_site: SITE, pa_ghost_post_id: Number(POST_ID), pa_ghost_post_url: POST_URL,
        } }]);
        await expect(adapter(numeric.host).ensureNoteUid({ path: "note.md" }, guard()))
            .rejects.toMatchObject({ code: "invalid-binding" });
        expect(numeric.state.processCalls).toBe(0);

        const duplicate = fixture([
            { path: "native.md", properties: { pa_ghost: UID, pa_ghost_site: SITE } },
            { path: "legacy.md", properties: { pa_ghost: binding() } },
        ]);
        await expect(adapter(duplicate.host).resolve({ path: "native.md" }, guard()))
            .rejects.toMatchObject({ code: "duplicate-identity" });
    });

    it("inventories malformed same-UID copies before strict target parsing without writing", async () => {
        const cases = [
            {
                target: { pa_ghost: UID, pa_ghost_site: SITE },
                copy: { pa_ghost: UID },
            },
            {
                target: { pa_ghost: binding() },
                copy: { pa_ghost: { ...binding(), future_schema: true } },
            },
        ];
        for (const identityCase of cases) {
            const f = fixture([
                { path: "target.md", properties: identityCase.target },
                { path: "copy.md", properties: identityCase.copy },
            ]);
            await expect(adapter(f.host).ensureNoteUid({ path: "target.md" }, guard()))
                .rejects.toMatchObject({ code: "duplicate-identity" });
            expect(f.state.processCalls).toBe(0);
            expect(f.state.writes).toBe(0);
        }
    });

    it("requires desktop and a fresh guard, and blocks revocation after read and inside processFrontMatter before any mutation", async () => {
        const f = fixture([{ path: "note.md", properties: null }]);
        const api = adapter(f.host);
        await expect(api.ensureNoteUid({ path: "note.md" }, undefined as unknown as GhostPublishingSourceGuard))
            .rejects.toMatchObject({ code: "missing-guard" });
        await expect(adapter(f.host, () => false).ensureNoteUid({ path: "note.md" }, guard()))
            .rejects.toMatchObject({ code: "unsupported-platform" });
        expect(f.state.reads).toEqual([]);

        let current = true;
        const admission = guard({ isCurrent: () => current });
        f.state.readHook = async () => { await Promise.resolve(); current = false; };
        await expect(api.ensureNoteUid({ path: "note.md" }, admission)).rejects.toMatchObject({ code: "guard-revoked" });
        expect(f.state.processCalls).toBe(0);
        expect(f.state.writes).toBe(0);

        current = true;
        f.state.readHook = undefined;
        f.state.mutationHook = async () => { await Promise.resolve(); current = false; };
        await expect(api.ensureNoteUid({ path: "note.md" }, admission)).rejects.toMatchObject({ code: "guard-revoked" });
        expect(f.state.processCalls).toBe(1);
        expect(f.state.writes).toBe(0);
        expect(f.files[0].text).toBe(BODY);
    });

    it("does not choose the first duplicate UID or read all vault bodies while finding a unique identity", async () => {
        const f = fixture([
            { path: "one.md", properties: { pa_ghost: binding() } },
            { path: "copy.md", properties: { pa_ghost: binding() } },
            { path: "private.md", properties: { title: "unrelated" } },
        ]);
        const api = adapter(f.host);
        await expect(api.resolve({ path: "one.md", noteUid: UID }, guard())).rejects.toMatchObject({ code: "duplicate-identity" });
        expect(f.state.reads).toEqual([]);
        await expect(api.ensureNoteUid({ path: "one.md" }, guard())).rejects.toMatchObject({ code: "duplicate-identity" });
        expect(f.state.reads).toEqual(["one.md"]);
        expect(f.state.writes).toBe(0);
        expect(f.state.processCalls).toBe(0);
    });

    it("resolves a moved note by its unique UID, checks the current path and preserves the same post ID", async () => {
        const existing = binding({ post_id: POST_ID, post_url: POST_URL });
        const f = fixture([
            { path: "before.md", properties: { pa_ghost: existing, keep: "value" } },
            { path: "private.md", properties: { title: "unrelated" } },
        ]);
        f.files[0].path = "folder/after.md";
        const allowed = jest.fn<(path: string) => boolean>((path) => path === "folder/after.md");
        const admission = guard({ isPathAllowed: allowed });
        const api = adapter(f.host);
        const found = await api.resolve({ path: "before.md", noteUid: UID }, admission);
        expect(found).toMatchObject({ path: "folder/after.md", binding: existing, changed: false });
        expect(found.file).toBe(f.files[0]);
        const changedUrl = "https://public.example/actual-article/";
        const updated = await api.writeBinding({ path: "before.md", noteUid: UID }, { postId: POST_ID, postUrl: changedUrl }, admission);
        expect(updated.binding).toEqual({ ...existing, post_url: changedUrl });
        expect(updated.path).toBe("folder/after.md");
        expect(f.state.writes).toBe(1);
        expect(f.state.reads.every((path) => path === "folder/after.md")).toBe(true);
        expect(allowed.mock.calls.every(([path]) => path === "folder/after.md")).toBe(true);
        expect(noteBody(f.files[0])).toBe(BODY);
        expect(properties(f.files[0]).keep).toBe("value");
    });

    it("refuses damaged or unknown Properties, another site and another post without overwriting any existing value", async () => {
        const cases: Array<{ value: unknown; code: string }> = [
            { value: null, code: "invalid-binding" },
            { value: { ...binding(), future_schema: 2 }, code: "invalid-binding" },
            { value: { ...binding(), post_id: POST_ID }, code: "invalid-binding" },
            { value: { ...binding(), site: "https://another.example/" }, code: "site-mismatch" },
        ];
        for (const test of cases) {
            const f = fixture([{ path: "note.md", properties: { pa_ghost: test.value, keep: "untouched" } }]);
            const original = f.files[0].text;
            await expect(adapter(f.host).ensureNoteUid({ path: "note.md" }, guard())).rejects.toMatchObject({ code: test.code });
            expect(f.files[0].text).toBe(original);
            expect(f.state.processCalls).toBe(0);
        }
        const f = fixture([{ path: "note.md", properties: { pa_ghost: binding({ post_id: POST_ID, post_url: POST_URL }) } }]);
        const original = f.files[0].text;
        await expect(adapter(f.host).writeBinding({ path: "note.md", noteUid: UID }, { postId: "1123456789abcdef01234567", postUrl: POST_URL }, guard()))
            .rejects.toMatchObject({ code: "post-mismatch" });
        expect(f.files[0].text).toBe(original);
        expect(f.state.processCalls).toBe(0);
    });

    it("checks the latest callback Properties and preserves concurrent body edits while refusing a stale result", async () => {
        const f = fixture([{ path: "note.md", properties: { keep: "initial" } }]);
        const api = adapter(f.host);
        f.state.mutationHook = async (file) => {
            await Promise.resolve();
            f.replace(file, noteText({ keep: "latest", pa_ghost: { unsupported: true } }));
        };
        await expect(api.ensureNoteUid({ path: "note.md" }, guard())).rejects.toMatchObject({ code: "invalid-binding" });
        expect(properties(f.files[0])).toEqual({ keep: "latest", pa_ghost: { unsupported: true } });
        expect(f.state.writes).toBe(0);

        const bodyChange = fixture([{ path: "note.md", properties: { keep: "initial" } }]);
        const concurrentBody = `${BODY}\nUser added this while PA was waiting.\n`;
        bodyChange.state.mutationHook = async (file) => {
            await Promise.resolve();
            bodyChange.replace(file, noteText({ keep: "latest" }, concurrentBody));
        };
        await expect(adapter(bodyChange.host).ensureNoteUid({ path: "note.md" }, guard()))
            .rejects.toMatchObject({ code: "source-changed" });
        expect(noteBody(bodyChange.files[0])).toBe(concurrentBody);
        expect(properties(bodyChange.files[0])).toEqual({
            keep: "latest", pa_ghost: UID, pa_ghost_site: SITE,
        });
        expect(bodyChange.state.writes).toBe(1);
    });
});

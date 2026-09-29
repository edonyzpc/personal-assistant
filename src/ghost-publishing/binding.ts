import type { GhostPublishingSourceFile, GhostPublishingSourceGuard } from "./types";

export interface GhostNoteBinding {
    note_uid: string;
    site: string;
    post_id?: string;
    post_url?: string;
}

export interface GhostNoteSelection {
    path: string;
    /** A prior identity allows a renamed note to be located without guessing by name. */
    noteUid?: string;
}

export interface GhostResolvedNote {
    file: GhostPublishingSourceFile;
    path: string;
    binding: GhostNoteBinding | null;
    /** Caller must export again after a binding write or a path change. */
    changed: boolean;
}

export interface GhostBindingHost {
    vault: {
        getAbstractFileByPath(path: string): GhostPublishingSourceFile | null;
        getMarkdownFiles(): GhostPublishingSourceFile[];
        read(file: GhostPublishingSourceFile): Promise<string>;
    };
    metadataCache: {
        getFileCache(file: GhostPublishingSourceFile): { frontmatter?: Record<string, unknown> } | null;
    };
    fileManager: {
        processFrontMatter(file: GhostPublishingSourceFile, mutate: (frontmatter: Record<string, unknown>) => void): Promise<void>;
    };
    getFrontMatterInfo(markdown: string): { exists: boolean; frontmatter: string; contentStart: number };
    parseYaml(yaml: string): unknown;
}

export interface GhostBindingOptions {
    site: string;
    isDesktop(): boolean;
    createNoteUid?(): string;
}

export type GhostBindingErrorCode =
    | "unsupported-platform" | "missing-guard" | "guard-revoked" | "invalid-selection"
    | "note-not-found" | "duplicate-identity" | "identity-mismatch" | "metadata-unavailable"
    | "invalid-frontmatter" | "invalid-binding" | "site-mismatch" | "post-mismatch"
    | "source-changed" | "read-failed" | "write-failed" | "write-unverified";

export class GhostBindingError extends Error {
    constructor(readonly code: GhostBindingErrorCode) {
        super(`Ghost note binding: ${code}`);
        this.name = "GhostBindingError";
    }
}

interface Admission {
    assert(path?: string): void;
}

interface NoteSnapshot extends GhostResolvedNote {
    body: string;
}

const IDENTITY = /^[a-zA-Z0-9_-]{1,128}$/;
const POST_ID = /^[a-f\d]{24}$/i;
const BINDING_KEYS = new Set(["note_uid", "site", "post_id", "post_url"]);

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}

function canonicalUrl(value: string, site: boolean): string {
    try {
        const url = new URL(value);
        if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("Invalid URL");
        if (site) {
            if (url.search || url.hash || /%2f|%5c/i.test(url.pathname)) throw new Error("Invalid site");
            url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
        }
        return url.href;
    } catch {
        throw new GhostBindingError("invalid-binding");
    }
}

function validateSelection(selection: GhostNoteSelection): void {
    const path = selection?.path;
    if (typeof path !== "string" || !path || path.length > 4096 || path.startsWith("/") || path.includes("\\")
        || path.includes("\0") || path.split("/").some((part) => !part || part === "." || part === "..")
        || selection.noteUid !== undefined && !IDENTITY.test(selection.noteUid)) {
        throw new GhostBindingError("invalid-selection");
    }
}

function sameBinding(left: GhostNoteBinding | null, right: GhostNoteBinding | null): boolean {
    return left === null || right === null ? left === right
        : left.note_uid === right.note_uid && left.site === right.site
            && left.post_id === right.post_id && left.post_url === right.post_url;
}

export class GhostNoteBindingAdapter {
    readonly site: string;
    private writes: Promise<void> = Promise.resolve();

    constructor(private readonly host: GhostBindingHost, private readonly options: GhostBindingOptions) {
        this.site = canonicalUrl(options.site, true);
    }

    async resolve(selection: GhostNoteSelection, guard: GhostPublishingSourceGuard): Promise<GhostResolvedNote> {
        validateSelection(selection);
        const admission = this.admission(guard);
        const resolved = await this.resolveCurrent(selection, admission);
        return this.result(resolved, false);
    }

    /** Persist identity before any remote create. Existing identities are never replaced. */
    ensureNoteUid(selection: GhostNoteSelection, guard: GhostPublishingSourceGuard): Promise<GhostResolvedNote> {
        const target = { ...selection };
        return this.serialize(async () => {
            validateSelection(target);
            const admission = this.admission(guard);
            const before = await this.resolveCurrent(target, admission);
            if (before.binding) return this.result(before, false);
            let noteUid: string;
            try {
                noteUid = this.options.createNoteUid?.() ?? globalThis.crypto.randomUUID();
            } catch {
                throw new GhostBindingError("invalid-binding");
            }
            if (!IDENTITY.test(noteUid)) throw new GhostBindingError("invalid-binding");
            const desired: GhostNoteBinding = { note_uid: noteUid, site: this.site };
            return this.write(before, desired, admission);
        });
    }

    /** A write failure is propagated so the service keeps its known remote ID and repairs locally. */
    writeBinding(
        selection: GhostNoteSelection & { noteUid: string },
        remote: { postId: string; postUrl: string },
        guard: GhostPublishingSourceGuard,
    ): Promise<GhostResolvedNote> {
        const target = { ...selection };
        const remoteIdentity = { ...remote };
        return this.serialize(async () => {
            validateSelection(target);
            if (!IDENTITY.test(target.noteUid) || !POST_ID.test(remoteIdentity.postId)) throw new GhostBindingError("invalid-binding");
            const postUrl = canonicalUrl(remoteIdentity.postUrl, false);
            const admission = this.admission(guard);
            const before = await this.resolveCurrent(target, admission);
            if (!before.binding) throw new GhostBindingError("identity-mismatch");
            if (before.binding.post_id && before.binding.post_id !== remoteIdentity.postId) throw new GhostBindingError("post-mismatch");
            const desired: GhostNoteBinding = {
                note_uid: before.binding.note_uid, site: this.site,
                post_id: remoteIdentity.postId, post_url: postUrl,
            };
            if (sameBinding(before.binding, desired)) return this.result(before, false);
            return this.write(before, desired, admission);
        });
    }

    private serialize<T>(action: () => Promise<T>): Promise<T> {
        const next = this.writes.then(action);
        this.writes = next.then(() => {}, () => {});
        return next;
    }

    private admission(guard: GhostPublishingSourceGuard): Admission {
        if (!guard || typeof guard.isCurrent !== "function" || typeof guard.isPathAllowed !== "function") {
            throw new GhostBindingError("missing-guard");
        }
        let sourceValidity: (() => boolean) | undefined;
        const assert = (path?: string) => {
            if (!this.options.isDesktop()) throw new GhostBindingError("unsupported-platform");
            try {
                if (!guard.isCurrent() || guard.isNoteDomainAllowed?.() === false
                    || path !== undefined && guard.isPathAllowed(path, "task_material") !== true
                    || sourceValidity && sourceValidity() !== true) throw new Error("Revoked");
            } catch {
                throw new GhostBindingError("guard-revoked");
            }
        };
        assert();
        try {
            sourceValidity = guard.captureSourceValidity?.();
        } catch {
            throw new GhostBindingError("guard-revoked");
        }
        assert();
        return { assert };
    }

    private binding(frontmatter: Record<string, unknown>): GhostNoteBinding | null {
        if (!Object.prototype.hasOwnProperty.call(frontmatter, "pa_ghost")) return null;
        const value = record(frontmatter.pa_ghost);
        if (!value || Object.keys(value).some((key) => !BINDING_KEYS.has(key))
            || typeof value.note_uid !== "string" || !IDENTITY.test(value.note_uid)
            || typeof value.site !== "string") throw new GhostBindingError("invalid-binding");
        const site = canonicalUrl(value.site, true);
        if (site !== this.site) throw new GhostBindingError("site-mismatch");
        const result: GhostNoteBinding = { note_uid: value.note_uid, site };
        const hasPostId = Object.prototype.hasOwnProperty.call(value, "post_id");
        const hasPostUrl = Object.prototype.hasOwnProperty.call(value, "post_url");
        if (hasPostId !== hasPostUrl) throw new GhostBindingError("invalid-binding");
        if (hasPostId) {
            if (typeof value.post_id !== "string" || !POST_ID.test(value.post_id)
                || typeof value.post_url !== "string") throw new GhostBindingError("invalid-binding");
            result.post_id = value.post_id;
            result.post_url = canonicalUrl(value.post_url, false);
        }
        return result;
    }

    private parse(markdown: string): { binding: GhostNoteBinding | null; body: string } {
        try {
            const info = this.host.getFrontMatterInfo(markdown);
            if (!info.exists) {
                // An unterminated Properties block must not be mistaken for an unbound note.
                if (/^\uFEFF?---[\t ]*(?:\r?\n|$)/u.test(markdown)) throw new GhostBindingError("invalid-frontmatter");
                return { binding: null, body: markdown };
            }
            if (!Number.isInteger(info.contentStart) || info.contentStart < 0 || info.contentStart > markdown.length) {
                throw new GhostBindingError("invalid-frontmatter");
            }
            const frontmatter = info.frontmatter.trim() ? record(this.host.parseYaml(info.frontmatter)) : {};
            if (!frontmatter) throw new GhostBindingError("invalid-frontmatter");
            return { binding: this.binding(frontmatter), body: markdown.slice(info.contentStart) };
        } catch (error) {
            if (error instanceof GhostBindingError) throw error;
            throw new GhostBindingError("invalid-frontmatter");
        }
    }

    private metadataCandidates(noteUid: string, admission: Admission): GhostPublishingSourceFile[] {
        admission.assert();
        try {
            const candidates = new Map<string, GhostPublishingSourceFile>();
            for (const file of this.host.vault.getMarkdownFiles()) {
                // This is an identity-only metadata scan, never a vault-wide source/body read.
                const frontmatter = this.host.metadataCache.getFileCache(file)?.frontmatter;
                if (record(frontmatter?.pa_ghost)?.note_uid === noteUid) candidates.set(file.path, file);
            }
            admission.assert();
            return [...candidates.values()];
        } catch (error) {
            if (error instanceof GhostBindingError) throw error;
            throw new GhostBindingError("metadata-unavailable");
        }
    }

    private assertUnique(noteUid: string, file: GhostPublishingSourceFile, admission: Admission): void {
        const paths = new Set(this.metadataCandidates(noteUid, admission).map((candidate) => candidate.path));
        // The fresh target may not have reached MetadataCache after our own write yet.
        paths.add(file.path);
        if (paths.size > 1) throw new GhostBindingError("duplicate-identity");
    }

    private async resolveCurrent(selection: GhostNoteSelection, admission: Admission): Promise<NoteSnapshot> {
        admission.assert();
        let file = this.host.vault.getAbstractFileByPath(selection.path);
        if (selection.noteUid) {
            const candidates = this.metadataCandidates(selection.noteUid, admission);
            if (candidates.length > 1) throw new GhostBindingError("duplicate-identity");
            if (candidates.length === 1) file = candidates[0];
        }
        if (!file || file.extension !== "md") throw new GhostBindingError("note-not-found");
        const snapshot = await this.read(file, admission);
        if (selection.noteUid && snapshot.binding?.note_uid !== selection.noteUid) throw new GhostBindingError("identity-mismatch");
        if (snapshot.binding) this.assertUnique(snapshot.binding.note_uid, file, admission);
        admission.assert(file.path);
        return snapshot;
    }

    private async read(file: GhostPublishingSourceFile, admission: Admission): Promise<NoteSnapshot> {
        admission.assert(file.path);
        const path = file.path;
        const before = file.stat ? { mtime: file.stat.mtime, size: file.stat.size } : undefined;
        let markdown: string;
        try {
            markdown = await this.host.vault.read(file);
        } catch {
            throw new GhostBindingError("read-failed");
        }
        admission.assert(file.path);
        if (file.path !== path || this.host.vault.getAbstractFileByPath(path) !== file
            || before && (before.mtime !== file.stat?.mtime || before.size !== file.stat?.size)) {
            throw new GhostBindingError("source-changed");
        }
        const parsed = this.parse(markdown);
        return { file, path, binding: parsed.binding, body: parsed.body, changed: false };
    }

    private async write(before: NoteSnapshot, desired: GhostNoteBinding, admission: Admission): Promise<GhostResolvedNote> {
        this.assertUnique(desired.note_uid, before.file, admission);
        admission.assert(before.file.path);
        try {
            await this.host.fileManager.processFrontMatter(before.file, (frontmatter) => {
                admission.assert(before.file.path);
                if (before.file.path !== before.path || this.host.vault.getAbstractFileByPath(before.path) !== before.file) {
                    throw new GhostBindingError("source-changed");
                }
                if (!record(frontmatter)) throw new GhostBindingError("invalid-frontmatter");
                const current = this.binding(frontmatter);
                if (!sameBinding(current, before.binding)) throw new GhostBindingError("identity-mismatch");
                this.assertUnique(desired.note_uid, before.file, admission);
                // Obsidian atomically updates only Properties; the latest body and other keys survive.
                frontmatter.pa_ghost = { ...desired };
            });
        } catch (error) {
            if (error instanceof GhostBindingError) throw error;
            throw new GhostBindingError("write-failed");
        }
        const after = await this.read(before.file, admission);
        if (after.body !== before.body) throw new GhostBindingError("source-changed");
        if (!sameBinding(after.binding, desired)) throw new GhostBindingError("write-unverified");
        this.assertUnique(desired.note_uid, after.file, admission);
        return this.result(after, true);
    }

    private result(snapshot: NoteSnapshot, changed: boolean): GhostResolvedNote {
        return { file: snapshot.file, path: snapshot.path, binding: snapshot.binding, changed };
    }
}

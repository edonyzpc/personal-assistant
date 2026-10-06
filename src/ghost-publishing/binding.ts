import type { GhostPublishingSourceFile, GhostPublishingSourceGuard } from "./types";
import { canonicalGhostSite } from "./configuration";
import { ghostBindingProperties, writeGhostIdProperty } from "./binding-properties";

export interface GhostNoteSelection { path: string; }

export interface GhostResolvedNote {
    file: GhostPublishingSourceFile;
    path: string;
    postId?: string;
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

export interface GhostBindingOptions { site: string; isDesktop(): boolean; }

export type GhostBindingErrorCode =
    | "unsupported-platform" | "missing-guard" | "guard-revoked" | "invalid-selection"
    | "note-not-found" | "identity-mismatch" | "invalid-frontmatter" | "invalid-binding"
    | "source-changed" | "read-failed" | "write-failed" | "write-unverified";

export class GhostBindingError extends Error {
    constructor(readonly code: GhostBindingErrorCode) {
        super("Ghost note binding: " + code);
        this.name = "GhostBindingError";
    }
}

interface Admission { assert(path?: string): void; }
const POST_ID = /^[a-f\d]{24}$/i;

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}

function validateSelection(selection: GhostNoteSelection): void {
    const path = selection?.path;
    if (typeof path !== "string" || !path || path.length > 4096 || path.startsWith("/") || /[\\\0\r\n]/.test(path)
        || path.split("/").some((part) => !part || part === "." || part === "..")) {
        throw new GhostBindingError("invalid-selection");
    }
}

export class GhostNoteBindingAdapter {
    readonly site: string;
    private writes: Promise<void> = Promise.resolve();

    constructor(private readonly host: GhostBindingHost, private readonly options: GhostBindingOptions) {
        this.site = canonicalGhostSite(options.site);
    }

    async resolve(selection: GhostNoteSelection, guard: GhostPublishingSourceGuard): Promise<GhostResolvedNote> {
        validateSelection(selection);
        return this.readSelection(selection, this.admission(guard));
    }

    /** The service supplies its captured association after confirmed remote success. */
    writeBinding(
        selection: GhostNoteSelection,
        remote: { postId: string; expectedPostId?: string | null },
        guard: GhostPublishingSourceGuard,
    ): Promise<GhostResolvedNote> {
        const target = { ...selection };
        const desired = { ...remote };
        const action = async (): Promise<GhostResolvedNote> => {
            validateSelection(target);
            if (!POST_ID.test(desired.postId) || desired.expectedPostId != null && !POST_ID.test(desired.expectedPostId)) {
                throw new GhostBindingError("invalid-binding");
            }
            desired.postId = desired.postId.toLowerCase();
            if (desired.expectedPostId) desired.expectedPostId = desired.expectedPostId.toLowerCase();
            const admission = this.admission(guard);
            const before = await this.readSelection(target, admission);
            if (before.postId === desired.postId) return before;
            const expected = desired.expectedPostId ?? null;
            if ((before.postId ?? null) !== expected) throw new GhostBindingError("identity-mismatch");
            admission.assert(before.path);
            try {
                await this.host.fileManager.processFrontMatter(before.file, (frontmatter) => {
                    admission.assert(before.path);
                    if (before.file.path !== before.path || this.host.vault.getAbstractFileByPath(before.path) !== before.file) {
                        throw new GhostBindingError("source-changed");
                    }
                    if (!record(frontmatter)) throw new GhostBindingError("invalid-frontmatter");
                    if ((this.postId(frontmatter) ?? null) !== expected) throw new GhostBindingError("identity-mismatch");
                    // Obsidian's atomic Properties update preserves the latest body and every other key.
                    writeGhostIdProperty(frontmatter, desired.postId);
                });
            } catch (error) {
                if (error instanceof GhostBindingError) throw error;
                throw new GhostBindingError("write-failed");
            }
            if (before.file.path !== before.path || this.host.vault.getAbstractFileByPath(before.path) !== before.file) {
                throw new GhostBindingError("source-changed");
            }
            const after = await this.readSelection(target, admission);
            if (after.postId !== desired.postId) throw new GhostBindingError("write-unverified");
            return { ...after, changed: true };
        };
        const next = this.writes.then(action);
        this.writes = next.then(() => {}, () => {});
        return next;
    }

    private admission(guard: GhostPublishingSourceGuard): Admission {
        if (!guard || typeof guard.isCurrent !== "function" || typeof guard.isPathAllowed !== "function") {
            throw new GhostBindingError("missing-guard");
        }
        let sourceValidity: (() => boolean) | undefined;
        const assert = (path?: string): void => {
            if (!this.options.isDesktop()) throw new GhostBindingError("unsupported-platform");
            try {
                if (!guard.isCurrent() || guard.isNoteDomainAllowed?.() === false
                    || path !== undefined && guard.isPathAllowed(path, "task_material") !== true
                    || sourceValidity && sourceValidity() !== true) throw new Error("Revoked");
            } catch { throw new GhostBindingError("guard-revoked"); }
        };
        assert();
        try { sourceValidity = guard.captureSourceValidity?.(); }
        catch { throw new GhostBindingError("guard-revoked"); }
        assert();
        return { assert };
    }

    private postId(frontmatter: Record<string, unknown>): string | undefined {
        const result = ghostBindingProperties(frontmatter);
        if (result.status === "invalid") throw new GhostBindingError("invalid-binding");
        return result.status === "bound" ? result.postId : undefined;
    }

    private parse(markdown: string): string | undefined {
        try {
            const info = this.host.getFrontMatterInfo(markdown);
            if (!info.exists) {
                if (/^\uFEFF?---[\t ]*(?:\r?\n|$)/u.test(markdown)) throw new GhostBindingError("invalid-frontmatter");
                return undefined;
            }
            if (!Number.isInteger(info.contentStart) || info.contentStart < 0 || info.contentStart > markdown.length) {
                throw new GhostBindingError("invalid-frontmatter");
            }
            const frontmatter = info.frontmatter.trim() ? record(this.host.parseYaml(info.frontmatter)) : {};
            if (!frontmatter) throw new GhostBindingError("invalid-frontmatter");
            return this.postId(frontmatter);
        } catch (error) {
            if (error instanceof GhostBindingError) throw error;
            throw new GhostBindingError("invalid-frontmatter");
        }
    }

    private async readSelection(selection: GhostNoteSelection, admission: Admission): Promise<GhostResolvedNote> {
        admission.assert(selection.path);
        const file = this.host.vault.getAbstractFileByPath(selection.path);
        if (!file || file.extension !== "md") throw new GhostBindingError("note-not-found");
        const path = file.path;
        const before = file.stat ? { mtime: file.stat.mtime, size: file.stat.size } : undefined;
        let markdown: string;
        try { markdown = await this.host.vault.read(file); }
        catch { throw new GhostBindingError("read-failed"); }
        admission.assert(path);
        if (file.path !== path || this.host.vault.getAbstractFileByPath(path) !== file
            || before && (before.mtime !== file.stat?.mtime || before.size !== file.stat?.size)) {
            throw new GhostBindingError("source-changed");
        }
        const postId = this.parse(markdown);
        return { file, path, ...(postId ? { postId } : {}), changed: false };
    }
}

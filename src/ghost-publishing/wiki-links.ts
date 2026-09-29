import type { GhostBindingHost } from "./binding";
import { canonicalGhostSite } from "./configuration";
import { ghostBindingSchema, parseCompletedRecord, type GhostCompletedRecord } from "./state-schema";
import type { GhostPublishingHost, GhostPublishingSourceGuard, WikiLinkOccurrence, WikiLinkTarget } from "./types";

export interface GhostWikiLinkRecordAccess {
    readCompletedRecord?(siteId: string, noteUid: string): Promise<GhostCompletedRecord | null>;
    /** Synchronous final freshness fence. Actual reads still verify schema and checksum. */
    getCompletedRecordRevision?(siteId: string, noteUid: string): string | number;
}

export class GhostWikiLinkError extends Error {
    constructor(readonly code: "source-revoked" | "source-changed") {
        super(`Ghost links: ${code}.`);
    }
}

export interface GhostWikiLinkReceipt {
    targets: Record<string, WikiLinkTarget>;
    assertCurrent(): void;
}

/** Reads only explicit, uniquely resolved and allowed link targets. No publication or full-vault body scan. */
export async function resolveGhostWikiLinks(links: readonly WikiLinkOccurrence[], options: GhostWikiLinkRecordAccess & {
    host: GhostBindingHost & GhostPublishingHost;
    guard: GhostPublishingSourceGuard;
    siteId: string;
    siteUrl: string;
    assertCurrent(): void;
    getSourceRevision(path: string): string | number;
}): Promise<GhostWikiLinkReceipt> {
    const { host, guard, siteId } = options;
    const site = canonicalGhostSite(options.siteUrl);
    const revisions = new Map<string, string | number>();
    const records = new Map<string, string | number>();
    const uidOwners = new Map<string, { path: string; identity: string }>();
    const selections: Array<{ occurrence: WikiLinkOccurrence; identity: string }> = [];
    const targets: Record<string, WikiLinkTarget> = Object.create(null) as Record<string, WikiLinkTarget>;
    const identities = new Map<string, string>();

    function assertCore(): void {
        options.assertCurrent();
        if (!guard.isCurrent() || guard.isNoteDomainAllowed?.() === false) throw new GhostWikiLinkError("source-revoked");
    }
    function allowed(path: string): boolean { return guard.isPathAllowed(path, "task_material") === true; }
    function owners(uid: string, targetPath: string): string[] {
        assertCore();
        if (!allowed(targetPath)) throw new GhostWikiLinkError("source-revoked");
        const paths = new Set([targetPath]);
        // As in the binding adapter, this is an identity-only metadata inventory.
        // It never reads other notes' bodies or completed publication records.
        for (const file of host.vault.getMarkdownFiles()) {
            const binding = host.metadataCache.getFileCache(file)?.frontmatter?.pa_ghost;
            if (binding && typeof binding === "object" && !Array.isArray(binding)
                && (binding as Record<string, unknown>).note_uid === uid) paths.add(file.path);
        }
        assertCore();
        return [...paths].sort();
    }
    function select(occurrence: WikiLinkOccurrence): { paths: string[]; identity: string } {
        assertCore();
        if (!allowed(occurrence.sourcePath)) throw new GhostWikiLinkError("source-revoked");
        const linkpath = occurrence.target.split("#", 1)[0].trim();
        const requested = linkpath.replace(/\.md$/i, "");
        const files = host.vault.getMarkdownFiles();
        let matches = !requested ? files.filter((file) => file.path === occurrence.sourcePath)
            : files.filter((file) => file.path.replace(/\.md$/i, "") === requested);
        if (requested && !requested.includes("/")) {
            matches = files.filter((file) => file.path.split("/").at(-1)?.replace(/\.md$/i, "") === requested);
        } else if (matches.length === 0 && requested) {
            matches = files.filter((file) => file.path.replace(/\.md$/i, "").endsWith(`/${requested}`));
        }
        const resolved = linkpath ? host.metadataCache.getFirstLinkpathDest?.(linkpath, occurrence.sourcePath)
            : host.vault.getAbstractFileByPath(occurrence.sourcePath);
        if (matches.length === 0 && resolved?.extension === "md") matches = [resolved];
        const paths = [...new Set(matches.map((file) => file.path))].sort();
        // Do not substitute the first similarly named note for Obsidian's actual resolved target.
        const identity = JSON.stringify({ paths, resolved: resolved?.path ?? null });
        return { paths: paths.length > 1 || resolved && paths.includes(resolved.path) ? paths : [], identity };
    }
    function assertCurrent(): void {
        assertCore();
        for (const [path, revision] of revisions) {
            if (!allowed(path)) throw new GhostWikiLinkError("source-revoked");
            if (options.getSourceRevision(path) !== revision) throw new GhostWikiLinkError("source-changed");
        }
        for (const { occurrence, identity } of selections) {
            if (select(occurrence).identity !== identity) throw new GhostWikiLinkError("source-changed");
        }
        for (const [uid, revision] of records) {
            if (options.getCompletedRecordRevision?.(siteId, uid) !== revision) throw new GhostWikiLinkError("source-changed");
        }
        for (const [uid, owner] of uidOwners) {
            if (JSON.stringify(owners(uid, owner.path)) !== owner.identity) throw new GhostWikiLinkError("source-changed");
        }
    }

    for (const occurrence of links) {
        assertCurrent();
        const selection = select(occurrence);
        selections.push({ occurrence, identity: selection.identity });
        let result: WikiLinkTarget = { status: selection.paths.length > 1 ? "ambiguous" : "missing" };
        const path = selection.paths.length === 1 ? selection.paths[0] : undefined;
        if (path && allowed(path)) {
            revisions.set(path, options.getSourceRevision(path));
            const file = host.vault.getAbstractFileByPath(path);
            if (file?.extension === "md") {
                assertCurrent();
                const markdown = await host.vault.read(file);
                assertCurrent();
                result = { status: "unpublished" };
                let raw: Record<string, unknown> | undefined;
                try {
                    const info = host.getFrontMatterInfo(markdown);
                    const frontmatter = info.exists ? host.parseYaml(info.frontmatter) as Record<string, unknown> : undefined;
                    const value = frontmatter?.pa_ghost;
                    if (value && typeof value === "object" && !Array.isArray(value)) raw = value as Record<string, unknown>;
                } catch { /* Damaged Properties cannot establish publication. */ }
                if (raw && Object.keys(raw).every((key) => ["note_uid", "site", "post_id", "post_url"].includes(key))) {
                    const binding = ghostBindingSchema.safeParse({ noteUid: raw.note_uid, siteId, site: raw.site,
                        postId: raw.post_id, postUrl: raw.post_url });
                    if (binding.success && binding.data.site === site && options.readCompletedRecord && options.getCompletedRecordRevision) {
                        const uid = binding.data.noteUid;
                        const ownerPaths = owners(uid, path);
                        uidOwners.set(uid, { path, identity: JSON.stringify(ownerPaths) });
                        if (ownerPaths.length > 1) {
                            result = { status: "ambiguous" };
                        } else {
                            records.set(uid, options.getCompletedRecordRevision(siteId, uid));
                            assertCurrent();
                            let record: GhostCompletedRecord | null = null;
                            try {
                                const value = await options.readCompletedRecord(siteId, uid);
                                assertCurrent();
                                if (value) record = parseCompletedRecord(value);
                            } catch (error) {
                                assertCurrent();
                                if (error instanceof GhostWikiLinkError) throw error;
                            }
                            if (record && record.binding.siteId === siteId && record.binding.site === site
                                && record.binding.noteUid === uid && record.binding.postId === binding.data.postId
                                && record.binding.postUrl === binding.data.postUrl && record.completed.status === "published") {
                                const url = new URL(record.completed.postUrl);
                                const base = new URL(site);
                                if (url.origin === base.origin && url.pathname.startsWith(base.pathname) && !url.search && !url.hash) {
                                    result = { status: "published", url: url.href, ...(occurrence.target.includes("#") ? { anchorFallback: true } : {}) };
                                }
                            }
                        }
                    }
                }
            }
        } else if (path) result = { status: "unpublished" };
        const identity = JSON.stringify({ paths: selection.paths, result });
        if (identities.has(occurrence.target) && identities.get(occurrence.target) !== identity) result = { status: "ambiguous" };
        else identities.set(occurrence.target, identity);
        if (targets[occurrence.target]?.status !== "ambiguous") targets[occurrence.target] = result;
    }
    assertCurrent();
    return { targets, assertCurrent };
}

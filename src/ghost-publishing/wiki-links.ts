import type { GhostBindingHost } from "./binding";
import { ghostBindingProperties } from "./binding-properties";
import { canonicalGhostSite } from "./configuration";
import type { GhostPublishingHost, GhostPublishingSourceFile, GhostPublishingSourceGuard, WikiLinkOccurrence, WikiLinkTarget } from "./types";

export interface GhostWikiLinkPostAccess {
    readPost(postId: string): Promise<{ id: string; status: string; url: string } | null>;
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
export async function resolveGhostWikiLinks(links: readonly WikiLinkOccurrence[], options: GhostWikiLinkPostAccess & {
    host: GhostBindingHost & GhostPublishingHost;
    guard: GhostPublishingSourceGuard;
    siteUrl: string;
    assertCurrent(): void;
    getSourceRevision(path: string): string | number;
}): Promise<GhostWikiLinkReceipt> {
    const { host, guard } = options;
    const site = canonicalGhostSite(options.siteUrl);
    const revisions = new Map<string, string | number>();
    const files = new Map<string, GhostPublishingSourceFile>();
    const selections: Array<{ occurrence: WikiLinkOccurrence; identity: string }> = [];
    const targets: Record<string, WikiLinkTarget> = Object.create(null) as Record<string, WikiLinkTarget>;
    const identities = new Map<string, string>();

    function assertCore(): void {
        options.assertCurrent();
        if (!guard.isCurrent() || guard.isNoteDomainAllowed?.() === false) throw new GhostWikiLinkError("source-revoked");
    }
    function allowed(path: string): boolean { return guard.isPathAllowed(path, "task_material") === true; }
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
            const file = files.get(path);
            if (file && (file.path !== path || host.vault.getAbstractFileByPath(path) !== file)) {
                throw new GhostWikiLinkError("source-changed");
            }
        }
        for (const { occurrence, identity } of selections) {
            if (select(occurrence).identity !== identity) throw new GhostWikiLinkError("source-changed");
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
                files.set(path, file);
                assertCurrent();
                result = { status: "unpublished" };
                let postId: string | undefined;
                try {
                    const markdown = await host.vault.read(file);
                    assertCurrent();
                    const info = host.getFrontMatterInfo(markdown);
                    const frontmatter = info.exists ? host.parseYaml(info.frontmatter) as Record<string, unknown> : undefined;
                    if (frontmatter) {
                        const properties = ghostBindingProperties(frontmatter);
                        if (properties.status === "bound") postId = properties.postId;
                    }
                } catch {
                    // A read/Properties problem degrades this auxiliary link; revocation still stops preparation.
                    assertCurrent();
                }
                if (postId) {
                    try {
                        const post = await options.readPost(postId);
                        assertCurrent();
                        if (post?.id === postId && post.status === "published") {
                            const url = new URL(post.url);
                            const base = new URL(site);
                            if (url.origin === base.origin && url.pathname.startsWith(base.pathname)
                                && !url.username && !url.password && !url.search && !url.hash) {
                                result = { status: "published", url: url.href, ...(occurrence.target.includes("#") ? { anchorFallback: true } : {}) };
                            }
                        }
                    } catch {
                        // API failure cannot establish publication; it does not authorize another target.
                        assertCurrent();
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

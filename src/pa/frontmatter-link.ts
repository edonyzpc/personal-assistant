import { getFrontMatterInfo, parseYaml, type App, type TFile } from "obsidian";
import { normalizeVaultPath } from "./helpers";

export interface PaRelatedLinkOptions {
    bidirectional?: boolean;
}

export type PaRelatedLinkResult =
    | { ok: true; changed: boolean }
    | { ok: false; reason: "file-not-found" | "frontmatter-unavailable" | "frontmatter-write-failed" };

const PA_RELATED_KEY = "pa-related";

export function readPaRelatedLinksFromMarkdown(markdown: string): string[] {
    const info = getFrontMatterInfo(markdown);
    if (!info.exists) {
        if (/^\uFEFF?---\s*(?:\r?\n|$)/u.test(markdown)) {
            throw new Error("The target note has invalid Properties.");
        }
        return [];
    }
    let frontmatter: Record<string, unknown> = {};
    if (info.frontmatter.trim()) {
        const parsed = parseYaml(info.frontmatter);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("The target note has invalid Properties.");
        }
        frontmatter = parsed as Record<string, unknown>;
    }
    const raw = frontmatter[PA_RELATED_KEY];
    if (raw === undefined || raw === null) return [];
    const values = typeof raw === "string"
        ? [raw]
        : Array.isArray(raw) && raw.every((entry) => typeof entry === "string")
            ? raw as string[]
            : null;
    if (!values) throw new Error("The existing pa-related Property needs review in Chat.");
    const deduplicated: string[] = [];
    const identities = new Set<string>();
    for (const value of values) {
        const trimmed = value.trim();
        if (!trimmed) continue;
        const wikilinkIdentity = paRelatedWikilinkIdentity(trimmed);
        const identity = wikilinkIdentity === null
            ? `literal:${trimmed}`
            : `wikilink:${wikilinkIdentity}`;
        if (identities.has(identity)) continue;
        identities.add(identity);
        deduplicated.push(trimmed);
    }
    return deduplicated;
}

export function paRelatedWikilinkIdentity(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed.startsWith("[[") || !trimmed.endsWith("]]")) return null;
    const inner = trimmed.slice(2, -2);
    if (!inner || inner.includes("[") || inner.includes("]")) return null;
    const aliasAt = inner.indexOf("|");
    const destination = (aliasAt === -1 ? inner : inner.slice(0, aliasAt)).trim();
    const fragmentAt = destination.indexOf("#");
    const rawPath = (fragmentAt === -1 ? destination : destination.slice(0, fragmentAt)).trim();
    if (!rawPath) return null;
    const path = rawPath.replace(/\.md$/iu, "");
    if (fragmentAt === -1) return path;
    return `${path}#${destination.slice(fragmentAt + 1).trim()}`;
}

function asMarkdownFile(value: unknown): TFile | null {
    const file = value as TFile | null | undefined;
    return file && typeof file.path === "string" && file.extension === "md" ? file : null;
}

function wikilink(path: string): string {
    return `[[${normalizeVaultPath(path)}]]`;
}

function coercePaRelatedLinks(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
    }
    if (typeof value === "string" && value.trim().length > 0) {
        return [value.trim()];
    }
    return [];
}

function getMarkdownFile(app: App, path: string): TFile | null {
    return asMarkdownFile(app.vault.getAbstractFileByPath(normalizeVaultPath(path)));
}

async function updatePaRelatedLink(
    app: App,
    sourceFile: TFile,
    targetPath: string,
    operation: "add" | "remove",
): Promise<PaRelatedLinkResult> {
    if (!app.fileManager?.processFrontMatter) return { ok: false, reason: "frontmatter-unavailable" };

    const targetLink = wikilink(targetPath);
    let changed = false;
    try {
        await app.fileManager.processFrontMatter(sourceFile, (frontmatter) => {
            const existingLinks = coercePaRelatedLinks(frontmatter[PA_RELATED_KEY]);
            if (operation === "add") {
                if (!existingLinks.includes(targetLink)) {
                    existingLinks.push(targetLink);
                    changed = true;
                }
                frontmatter[PA_RELATED_KEY] = existingLinks;
                return;
            }

            const nextLinks = existingLinks.filter((link) => link !== targetLink);
            changed = nextLinks.length !== existingLinks.length;
            frontmatter[PA_RELATED_KEY] = nextLinks;
        });
        return { ok: true, changed };
    } catch {
        return { ok: false, reason: "frontmatter-write-failed" };
    }
}

// Callers MUST check Data Boundary (isDataBoundaryAllowedPath) for both
// sourcePath and targetPath before calling this function.
export async function addPaRelatedLink(
    app: App,
    sourcePath: string,
    targetPath: string,
    options: PaRelatedLinkOptions = {},
): Promise<PaRelatedLinkResult> {
    if (!app.fileManager?.processFrontMatter) return { ok: false, reason: "frontmatter-unavailable" };
    const sourceFile = getMarkdownFile(app, sourcePath);
    if (!sourceFile) return { ok: false, reason: "file-not-found" };
    const targetFile = options.bidirectional === false ? null : getMarkdownFile(app, targetPath);
    if (options.bidirectional !== false && !targetFile) return { ok: false, reason: "file-not-found" };

    const sourceResult = await updatePaRelatedLink(app, sourceFile, targetPath, "add");
    if (!sourceResult.ok) return sourceResult;
    if (options.bidirectional === false) return sourceResult;

    const targetResult = await updatePaRelatedLink(app, targetFile!, sourcePath, "add");
    if (!targetResult.ok) {
        if (sourceResult.changed) {
            await updatePaRelatedLink(app, sourceFile, targetPath, "remove");
        }
        return targetResult;
    }
    return {
        ok: true,
        changed: sourceResult.changed || targetResult.changed,
    };
}

export async function removePaRelatedLink(
    app: App,
    sourcePath: string,
    targetPath: string,
): Promise<PaRelatedLinkResult> {
    const sourceFile = getMarkdownFile(app, sourcePath);
    if (!sourceFile) return { ok: false, reason: "file-not-found" };
    return updatePaRelatedLink(app, sourceFile, targetPath, "remove");
}

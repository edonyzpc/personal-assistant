import {
    getFrontMatterInfo,
    normalizePath,
    parseYaml,
    type CachedMetadata,
    type TAbstractFile,
    TFile,
} from "obsidian";

import {
    decideDataBoundaryForSource,
    type DataBoundaryDecision,
} from "../pa/contracts";
import { hasWritingNoteProvenance } from "../chat/writing-note-provenance";
import type { GraphBoundarySnapshotSource } from "../graph/graph-boundary-snapshot";
import type { GraphPathClass } from "../graph/personalized-pagerank";
import { stableHash } from "../pa/helpers";
import type { DataBoundarySettings } from "../settings";
import type { PageletSettings } from "../settings/pagelet";
import { ScopeResolver } from "../pagelet/scope/ScopeResolver";
import { stableStringify } from "../ai-services/agent-utils";

export type SourceConsumer = "chat" | "pagelet";

export interface SourceAccessHost {
    vault: {
        getMarkdownFiles(): TFile[];
        getAbstractFileByPath?(path: string): TAbstractFile | null;
        read(file: TFile): Promise<string>;
    };
    metadataCache?: {
        getFileCache?(file: TFile): CachedMetadata | null;
        resolvedLinks?: Record<string, Record<string, number>>;
    };
}

export interface SourceAccessSettingsSnapshot {
    dataBoundary: DataBoundarySettings;
    memoryExcludePrefixes: readonly string[];
    pagelet: PageletSettings;
}

export interface SourceAccessDependencies {
    app: SourceAccessHost;
    getSettings(): SourceAccessSettingsSnapshot;
    log(message: string, detail?: unknown): void;
}

export interface LatestMemorySource {
    path: string;
    markdown: string;
    mtime: number;
    size: number;
}

export interface LatestMemoryContentBoundary {
    allowed: boolean;
    tags: string[];
    isGenerated: boolean;
}

export function buildMemoryDataBoundaryFingerprint(
    settings: Readonly<DataBoundarySettings>,
): string {
    const canonical = {
        excludedFolders: [...settings.excludedFolders].map((value) => value.trim()).filter(Boolean).sort(),
        excludedTags: [...settings.excludedTags]
            .map((value) => value.trim().replace(/^#+/, "").toLowerCase())
            .filter(Boolean)
            .sort(),
        generatedNotePolicy: settings.generatedNotePolicy,
        providerDisclosureReasons: [...settings.providerDisclosureReasons].sort(),
        cleanupGroups: [...settings.cleanupGroups].sort(),
    };
    return `data_boundary:${stableHash(JSON.stringify(canonical))}`;
}

function createAbortError(): Error {
    const error = new Error("Source capture aborted");
    error.name = "AbortError";
    return error;
}

export class SourceAccess {
    private memoryGraphTopologyEpoch = 0;

    constructor(private readonly dependencies: SourceAccessDependencies) {}

    getMemoryDataBoundaryFingerprint(): string {
        return buildMemoryDataBoundaryFingerprint(this.dependencies.getSettings().dataBoundary);
    }

    getVSSFiles(): TFile[] {
        return this.dependencies.app.vault.getMarkdownFiles()
            .filter((file) => this.isVSSFileEligible(file));
    }

    isVSSFileEligible(file: TFile, markdown?: string): boolean {
        const normalizedExcludePaths = this.normalizedMemoryExcludePrefixes();
        return file.extension === "md"
            && !normalizedExcludePaths.some((prefix) => file.path.startsWith(prefix))
            && (markdown === undefined
                ? this.isDataBoundaryAllowedFile(file)
                : this.getLatestDataBoundaryContentBoundary(file.path, markdown)?.allowed === true);
    }

    decideDataBoundaryForPath(path: string): DataBoundaryDecision {
        const normalizedPath = normalizePath(path).replace(/^\.\//, "");
        const file = this.dependencies.app.vault.getAbstractFileByPath?.(normalizedPath);
        if (file instanceof TFile) {
            return decideDataBoundaryForSource(
                {
                    path: file.path,
                    tags: this.getDataBoundaryTags(file),
                    isGenerated: this.isGeneratedDataBoundaryFile(file),
                },
                this.dependencies.getSettings().dataBoundary,
            );
        }
        const isGenerated = normalizedPath.startsWith(".pagelet/")
            || normalizedPath === ".pagelet"
            || normalizedPath.startsWith("pagelet-generated/")
            || normalizedPath === "pagelet-generated";
        return decideDataBoundaryForSource(
            { path: normalizedPath, isGenerated },
            this.dependencies.getSettings().dataBoundary,
        );
    }

    isDataBoundaryAllowedPath(path: string): boolean {
        return this.decideDataBoundaryForPath(path).decision === "allow";
    }

    isMemoryProviderPathAllowed(path: string): boolean {
        const normalizedPath = normalizePath(path).replace(/^\.\//, "");
        const excludedByMemoryPath = this.normalizedMemoryExcludePrefixes()
            .some((prefix) => normalizedPath.startsWith(prefix));
        return !excludedByMemoryPath && this.isDataBoundaryAllowedPath(normalizedPath);
    }

    isDataBoundaryAllowedFile(file: TFile): boolean {
        return decideDataBoundaryForSource(
            {
                path: file.path,
                tags: this.getDataBoundaryTags(file),
                isGenerated: this.isGeneratedDataBoundaryFile(file),
            },
            this.dependencies.getSettings().dataBoundary,
        ).decision === "allow";
    }

    isPageletProviderPathAllowed(path: string): boolean {
        const file = this.dependencies.app.vault.getAbstractFileByPath?.(normalizePath(path));
        return file instanceof TFile
            && file.extension === "md"
            && this.isPageletProviderSourceAllowedFile(file);
    }

    isPageletProviderSourceAllowedFile(file: TFile, markdown?: string): boolean {
        const resolver = this.createPageletProviderSourceResolver();
        if (!this.isPageletProviderSourceAllowedByResolver(file, resolver)) return false;
        return markdown === undefined
            || this.getLatestPageletContentBoundary(file.path, markdown)?.allowed === true;
    }

    async captureLatestMemorySource(
        path: string,
        isPathAllowed: (path: string) => boolean,
        consumer: SourceConsumer,
        signal?: AbortSignal,
    ): Promise<LatestMemorySource | null> {
        if (signal?.aborted) throw createAbortError();
        const normalizedPath = normalizePath(path).replace(/^\.\//, "");
        try {
            if (!normalizedPath.toLowerCase().endsWith(".md") || !isPathAllowed(normalizedPath)) {
                return null;
            }
            const file = this.dependencies.app.vault.getAbstractFileByPath?.(normalizedPath);
            if (!(file instanceof TFile) || file.extension !== "md") return null;
            const before = { mtime: file.stat.mtime, size: file.stat.size };
            const markdown = await this.dependencies.app.vault.read(file);
            if (signal?.aborted) throw createAbortError();
            const current = this.dependencies.app.vault.getAbstractFileByPath?.(normalizedPath);
            if (
                current !== file
                || !(current instanceof TFile)
                || current.extension !== "md"
                || current.stat.mtime !== before.mtime
                || current.stat.size !== before.size
                || !isPathAllowed(current.path)
            ) return null;
            const boundary = this.getLatestMemoryContentBoundary(current.path, markdown, consumer);
            if (boundary?.allowed !== true) return null;
            return {
                path: current.path,
                markdown,
                mtime: current.stat.mtime,
                size: current.stat.size,
            };
        } catch (error) {
            if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
                throw createAbortError();
            }
            this.dependencies.log("Latest Memory source read failed closed", {
                errorType: error instanceof Error ? error.name : "unknown",
            });
            return null;
        }
    }

    getLatestPageletContentBoundary(
        path: string,
        markdown: string,
    ): LatestMemoryContentBoundary | null {
        return this.getLatestMemoryContentBoundary(path, markdown, "pagelet");
    }

    getLatestDataBoundaryContentBoundary(
        path: string,
        markdown: string,
    ): LatestMemoryContentBoundary | null {
        return this.getLatestMemoryContentBoundary(path, markdown, "chat");
    }

    getLatestMemoryContentBoundary(
        path: string,
        markdown: string,
        consumer: SourceConsumer,
    ): LatestMemoryContentBoundary | null {
        try {
            const frontmatterInfo = getFrontMatterInfo(markdown);
            if (
                !frontmatterInfo.exists
                && /^\uFEFF?---\s*(?:\r?\n|$)/.test(markdown)
            ) return null;
            let frontmatter: Record<string, unknown> = {};
            if (frontmatterInfo.exists && frontmatterInfo.frontmatter.trim()) {
                const parsed = parseYaml(frontmatterInfo.frontmatter);
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
                frontmatter = parsed as Record<string, unknown>;
            }

            const tags = new Set<string>();
            this.collectDataBoundaryTags(frontmatter.tags, tags);
            this.collectDataBoundaryTags(frontmatter.tag, tags);
            this.collectLatestMarkdownBodyTags(
                markdown.slice(frontmatterInfo.contentStart),
                tags,
            );
            const normalizedTags = [...tags];
            const settings = this.dependencies.getSettings();
            const isGenerated = frontmatter.pagelet === true
                || (typeof frontmatter.pagelet === "string"
                    && frontmatter.pagelet.trim().toLowerCase() === "true")
                || hasWritingNoteProvenance(frontmatter);
            const excludedTags = new Set([
                "no-ai",
                ...(consumer === "pagelet" ? ["no-review"] : []),
                ...(consumer === "pagelet" ? settings.pagelet.excludedTags ?? [] : []),
                ...(settings.dataBoundary.excludedTags ?? []),
            ].map((tag) => (
                tag.trim().replace(/^#+/, "").toLowerCase()
            )));
            const tagDenied = normalizedTags.some((tag) => excludedTags.has(tag));
            const dataBoundaryDecision = decideDataBoundaryForSource(
                { path, tags: normalizedTags, isGenerated },
                settings.dataBoundary,
            );
            return {
                allowed: !tagDenied
                    && (consumer !== "pagelet" || !isGenerated)
                    && dataBoundaryDecision.decision === "allow",
                tags: normalizedTags,
                isGenerated,
            };
        } catch (error) {
            this.dependencies.log("Latest Memory source boundary parse failed closed", {
                errorType: error instanceof Error ? error.name : "unknown",
            });
            return null;
        }
    }

    getDataBoundaryTags(file: TFile): string[] {
        const tags = new Set<string>();
        const cache = this.dependencies.app.metadataCache?.getFileCache?.(file);
        const metadataTags = Array.isArray(cache?.tags) ? cache.tags : [];
        for (const tag of metadataTags) {
            if (typeof tag === "string") {
                this.collectDataBoundaryTag(tag, tags);
            } else if (tag && typeof tag === "object" && typeof (tag as { tag?: unknown }).tag === "string") {
                this.collectDataBoundaryTag((tag as { tag: string }).tag, tags);
            }
        }
        const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
        this.collectDataBoundaryTags(frontmatter?.tags, tags);
        this.collectDataBoundaryTags(frontmatter?.tag, tags);
        return [...tags];
    }

    isGeneratedDataBoundaryFile(file: TFile): boolean {
        const frontmatter = this.dependencies.app.metadataCache?.getFileCache?.(file)?.frontmatter as Record<string, unknown> | undefined;
        const pageletMarker = frontmatter?.pagelet;
        const normalizedPath = normalizePath(file.path).replace(/^\.\//, "");
        return pageletMarker === true
            || (typeof pageletMarker === "string" && pageletMarker.trim().toLowerCase() === "true")
            || hasWritingNoteProvenance(frontmatter)
            || normalizedPath === ".pagelet"
            || normalizedPath.startsWith(".pagelet/")
            || normalizedPath === "pagelet-generated"
            || normalizedPath.startsWith("pagelet-generated/");
    }

    getPageletSettingsWithDataBoundary(): PageletSettings {
        const settings = this.dependencies.getSettings();
        const dataBoundaryGeneratedFolders = settings.dataBoundary.generatedNotePolicy === "include-generated"
            ? []
            : [".pagelet", "pagelet-generated"];
        return {
            ...settings.pagelet,
            excludedFolders: this.uniqueSettingList([
                ...(settings.pagelet.excludedFolders ?? []),
                ...(settings.dataBoundary.excludedFolders ?? []),
                ...dataBoundaryGeneratedFolders,
            ]),
            excludedTags: this.uniqueSettingList([
                ...(settings.pagelet.excludedTags ?? []),
                ...(settings.dataBoundary.excludedTags ?? []).map((tag) => tag.replace(/^#+/, "").toLowerCase()),
            ]),
            excludedPatterns: settings.pagelet.excludedPatterns ?? [],
        };
    }

    createPageletProviderSourceResolver(): ScopeResolver {
        const settings = this.getPageletSettingsWithDataBoundary();
        return new ScopeResolver(this.dependencies.app, {
            excludedFolders: [...settings.excludedFolders],
            excludedTags: [...settings.excludedTags],
            excludedPatterns: [...settings.excludedPatterns],
            maxFileSizeBytes: 100 * 1024,
            reviewsFolder: settings.reviewsFolder,
        });
    }

    isPageletProviderSourceAllowedByResolver(file: TFile, resolver: ScopeResolver): boolean {
        return this.isDataBoundaryAllowedFile(file)
            && resolver.resolveCurrentNote(file).included.length === 1;
    }

    invalidateMemoryGraphTopology(): void {
        this.memoryGraphTopologyEpoch = this.memoryGraphTopologyEpoch >= Number.MAX_SAFE_INTEGER
            ? 1
            : this.memoryGraphTopologyEpoch + 1;
    }

    createMemoryGraphBoundarySnapshotSource(
        consumer: SourceConsumer,
    ): GraphBoundarySnapshotSource | undefined {
        const resolvedLinks = this.dependencies.app.metadataCache?.resolvedLinks as
            | Record<string, Record<string, number>>
            | undefined;
        if (!resolvedLinks) return undefined;
        const pageletResolver = consumer === "pagelet"
            ? this.createPageletProviderSourceResolver()
            : undefined;
        return {
            resolvedLinks,
            getEpoch: () => this.getMemoryGraphTopologyEpoch(consumer),
            classifyPath: (path) => this.classifyMemoryGraphPath(path, consumer, pageletResolver),
            canonicalizePath: (path) => this.canonicalizeMemoryGraphPath(path),
        };
    }

    getMemoryGraphTopologyEpoch(consumer: SourceConsumer): string {
        const settings = this.dependencies.getSettings();
        const vssExcludePrefixes = [...settings.memoryExcludePrefixes]
            .map((path) => path.trim())
            .filter(Boolean)
            .sort();
        const pageletBoundary = consumer === "pagelet"
            ? (() => {
                const pageletSettings = this.getPageletSettingsWithDataBoundary();
                return {
                    excludedFolders: [...pageletSettings.excludedFolders].sort(),
                    excludedTags: [...pageletSettings.excludedTags].sort(),
                    excludedPatterns: [...pageletSettings.excludedPatterns].sort(),
                    reviewsFolder: pageletSettings.reviewsFolder,
                };
            })()
            : undefined;
        const policyIdentity = stableHash(stableStringify({
            shared: this.getMemoryDataBoundaryFingerprint(),
            vssExcludePrefixes,
            pageletBoundary,
        }));
        return `memory-graph:${this.memoryGraphTopologyEpoch}:${consumer}:${policyIdentity}`;
    }

    classifyMemoryGraphPath(
        path: string,
        consumer: SourceConsumer,
        pageletResolver?: ScopeResolver,
    ): GraphPathClass {
        const canonicalPath = this.canonicalizeMemoryGraphPath(path);
        if (!canonicalPath) return "blocked";
        const file = this.dependencies.app.vault.getAbstractFileByPath?.(canonicalPath);
        if (!(file instanceof TFile) || file.extension !== "md") return "blocked";

        const generated = this.isGeneratedDataBoundaryFile(file);
        const sharedAllowed = this.isMemoryProviderPathAllowed(file.path);
        const consumerAllowed = consumer === "pagelet"
            ? Boolean(pageletResolver)
                && this.isPageletProviderSourceAllowedByResolver(file, pageletResolver!)
            : true;
        if (sharedAllowed && consumerAllowed) return "allowed_markdown";

        if (generated || (consumer === "pagelet" && file.path.startsWith(".pagelet/"))) {
            return "blocked";
        }
        return "opaque_excluded_markdown";
    }

    canonicalizeMemoryGraphPath(path: string): string | null {
        if (typeof path !== "string") return null;
        const canonicalPath = normalizePath(path.trim()).replace(/^\.\//, "");
        if (
            !canonicalPath
            || canonicalPath.startsWith("/")
            || /^[A-Za-z]:\//.test(canonicalPath)
            || canonicalPath.split("/").some((segment) => !segment || segment === "..")
        ) return null;
        return canonicalPath;
    }

    private normalizedMemoryExcludePrefixes(): string[] {
        return this.dependencies.getSettings().memoryExcludePrefixes
            .map((path) => path.trim())
            .filter(Boolean);
    }

    private collectLatestMarkdownBodyTags(markdown: string, tags: Set<string>): void {
        const withoutNonContent = markdown
            .replace(/<!--[\s\S]*?-->/g, " ")
            .replace(/(^|\n)\s*```[^\n]*\n[\s\S]*?\n\s*```(?=\n|$)/g, " ")
            .replace(/(^|\n)\s*~~~[^\n]*\n[\s\S]*?\n\s*~~~(?=\n|$)/g, " ")
            .replace(/`[^`\n]*`/g, " ");
        const tagPattern = /(^|[\s([{"'>])#([\p{L}\p{N}_/-]+)/gu;
        for (const match of withoutNonContent.matchAll(tagPattern)) {
            this.collectDataBoundaryTag(match[2] ?? "", tags);
        }
    }

    private collectDataBoundaryTags(value: unknown, tags: Set<string>): void {
        if (Array.isArray(value)) {
            value.forEach((entry) => this.collectDataBoundaryTags(entry, tags));
            return;
        }
        if (typeof value !== "string") return;
        value
            .split(/[,\s]+/)
            .map((tag) => tag.trim().replace(/^#+/, "").toLowerCase())
            .filter(Boolean)
            .forEach((tag) => tags.add(tag));
    }

    private collectDataBoundaryTag(value: string, tags: Set<string>): void {
        const tag = value.trim().replace(/^#+/, "").toLowerCase();
        if (tag) tags.add(tag);
    }

    private uniqueSettingList(values: readonly string[]): string[] {
        const seen = new Set<string>();
        const result: string[] = [];
        for (const value of values) {
            const normalized = value.trim();
            if (!normalized || seen.has(normalized)) continue;
            seen.add(normalized);
            result.push(normalized);
        }
        return result;
    }
}

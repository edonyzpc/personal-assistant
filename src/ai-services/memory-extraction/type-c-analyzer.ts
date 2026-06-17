import type { App, TFile } from "obsidian";
import { normalizePath } from "obsidian";

export interface VaultMetacognitionSnapshot {
    generatedAt: string;
    fileCount: number;
    folderThemes: Array<{ folder: string; count: number }>;
    tagTaxonomy: Array<{ tag: string; count: number }>;
    linkTopology: {
        hubNotes: Array<{ path: string; inbound: number; outbound: number }>;
        unresolvedLinks: Array<{ target: string; count: number }>;
    };
    writingHabits: {
        busiestWeekdays: Array<{ weekday: string; count: number }>;
        averageWords: number;
        recentlyActive: string[];
    };
    topicClusters: Array<{ label: string; paths: string[] }>;
    knowledgeGaps: Array<{ label: string; evidence: string }>;
    trends: Array<{ label: string; count: number }>;
}

export class TypeCVaultMetacognitionAnalyzer {
    constructor(private readonly app: App) {}

    analyze(now = new Date()): VaultMetacognitionSnapshot {
        const files = this.app.vault.getMarkdownFiles();
        const folderThemes = rankFolders(files);
        const tagTaxonomy = rankTags(this.app, files);
        const linkTopology = analyzeLinks(this.app, files);
        const writingHabits = analyzeWritingHabits(files);
        const topicClusters = inferTopicClusters(files);
        const knowledgeGaps = inferKnowledgeGaps(linkTopology.unresolvedLinks);
        const trends = inferTrends(files, now.getTime());
        return {
            generatedAt: now.toISOString(),
            fileCount: files.length,
            folderThemes,
            tagTaxonomy,
            linkTopology,
            writingHabits,
            topicClusters,
            knowledgeGaps,
            trends,
        };
    }

    renderMarkdown(snapshot: VaultMetacognitionSnapshot): string {
        return [
            "# Vault Insights",
            "",
            `Generated: ${snapshot.generatedAt}`,
            `Files analyzed: ${snapshot.fileCount}`,
            "",
            "## Folder Themes",
            ...renderCountRows(snapshot.folderThemes, "folder"),
            "",
            "## Tag Taxonomy",
            ...renderCountRows(snapshot.tagTaxonomy, "tag"),
            "",
            "## Link Topology",
            ...snapshot.linkTopology.hubNotes.slice(0, 10).map((note) => {
                return `- ${note.path}: ${note.inbound} inbound, ${note.outbound} outbound`;
            }),
            "",
            "## Writing Habits",
            `- Average note length: ${snapshot.writingHabits.averageWords} words`,
            ...snapshot.writingHabits.busiestWeekdays.map((entry) => `- ${entry.weekday}: ${entry.count} note(s)`),
            "",
            "## Topic Clusters",
            ...snapshot.topicClusters.map((cluster) => `- ${cluster.label}: ${cluster.paths.slice(0, 5).join(", ")}`),
            "",
            "## Knowledge Gaps",
            ...(snapshot.knowledgeGaps.length > 0
                ? snapshot.knowledgeGaps.map((gap) => `- ${gap.label}: ${gap.evidence}`)
                : ["- No repeated unresolved-link gaps detected."]),
            "",
            "## Trends",
            ...snapshot.trends.map((trend) => `- ${trend.label}: ${trend.count} recent note(s)`),
        ].join("\n").trim() + "\n";
    }
}

function rankFolders(files: readonly TFile[]): Array<{ folder: string; count: number }> {
    const counts = new Map<string, number>();
    for (const file of files) {
        const path = normalizePath(file.path);
        const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "/";
        counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
    return sortCounts(counts).slice(0, 12).map(([folder, count]) => ({ folder, count }));
}

function rankTags(app: App, files: readonly TFile[]): Array<{ tag: string; count: number }> {
    const counts = new Map<string, number>();
    for (const file of files) {
        const cache = app.metadataCache.getFileCache(file);
        const rawTags = [
            ...(cache?.tags?.map((tag) => tag.tag) ?? []),
            ...normalizeFrontmatterTags(cache?.frontmatter?.tags),
            ...normalizeFrontmatterTags(cache?.frontmatter?.tag),
        ];
        for (const tag of rawTags) {
            const normalized = tag.startsWith("#") ? tag : `#${tag}`;
            counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
        }
    }
    return sortCounts(counts).slice(0, 20).map(([tag, count]) => ({ tag, count }));
}

function analyzeLinks(app: App, files: readonly TFile[]): VaultMetacognitionSnapshot["linkTopology"] {
    const resolvedLinks = app.metadataCache.resolvedLinks ?? {};
    const unresolvedLinks = app.metadataCache.unresolvedLinks ?? {};
    const inbound = new Map<string, number>();
    const outbound = new Map<string, number>();
    for (const [source, targets] of Object.entries(resolvedLinks)) {
        const outCount = Object.values(targets ?? {}).reduce((sum, count) => sum + Number(count || 0), 0);
        outbound.set(source, outCount);
        for (const [target, count] of Object.entries(targets ?? {})) {
            inbound.set(target, (inbound.get(target) ?? 0) + Number(count || 0));
        }
    }
    const filePaths = new Set(files.map((file) => normalizePath(file.path)));
    const hubNotes = [...filePaths].map((path) => ({
        path,
        inbound: inbound.get(path) ?? 0,
        outbound: outbound.get(path) ?? 0,
    })).sort((left, right) => (right.inbound + right.outbound) - (left.inbound + left.outbound)).slice(0, 12);

    const unresolved = new Map<string, number>();
    for (const targets of Object.values(unresolvedLinks)) {
        for (const [target, count] of Object.entries(targets ?? {})) {
            unresolved.set(target, (unresolved.get(target) ?? 0) + Number(count || 0));
        }
    }
    return {
        hubNotes,
        unresolvedLinks: sortCounts(unresolved).slice(0, 20).map(([target, count]) => ({ target, count })),
    };
}

function analyzeWritingHabits(files: readonly TFile[]): VaultMetacognitionSnapshot["writingHabits"] {
    const weekdays = new Map<string, number>();
    const recent = [...files].sort((left, right) => right.stat.mtime - left.stat.mtime).slice(0, 10);
    let totalWords = 0;
    for (const file of files) {
        const weekday = new Date(file.stat.mtime || file.stat.ctime || 0).toLocaleDateString("en-US", { weekday: "short" });
        weekdays.set(weekday, (weekdays.get(weekday) ?? 0) + 1);
        totalWords += Math.max(1, Math.round((file.stat.size ?? 0) / 6));
    }
    return {
        busiestWeekdays: sortCounts(weekdays).slice(0, 7).map(([weekday, count]) => ({ weekday, count })),
        averageWords: files.length > 0 ? Math.round(totalWords / files.length) : 0,
        recentlyActive: recent.map((file) => file.path),
    };
}

function inferTopicClusters(files: readonly TFile[]): Array<{ label: string; paths: string[] }> {
    const byFolder = new Map<string, string[]>();
    for (const file of files) {
        const folder = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "Root";
        byFolder.set(folder, [...(byFolder.get(folder) ?? []), file.path]);
    }
    return [...byFolder.entries()]
        .sort((left, right) => right[1].length - left[1].length)
        .slice(0, 8)
        .map(([label, paths]) => ({ label, paths: paths.slice(0, 12) }));
}

function inferKnowledgeGaps(
    unresolvedLinks: VaultMetacognitionSnapshot["linkTopology"]["unresolvedLinks"],
): Array<{ label: string; evidence: string }> {
    return unresolvedLinks
        .filter((entry) => entry.count >= 2)
        .slice(0, 10)
        .map((entry) => ({
            label: entry.target,
            evidence: `${entry.count} unresolved link reference(s) point here.`,
        }));
}

function inferTrends(files: readonly TFile[], nowMs: number): Array<{ label: string; count: number }> {
    const cutoff = nowMs - 30 * 24 * 60 * 60 * 1000;
    const counts = new Map<string, number>();
    for (const file of files) {
        if ((file.stat.mtime ?? 0) < cutoff) continue;
        const folder = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "Root";
        counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
    return sortCounts(counts).slice(0, 8).map(([label, count]) => ({ label, count }));
}

function normalizeFrontmatterTags(value: unknown): string[] {
    if (Array.isArray(value)) return value.flatMap(normalizeFrontmatterTags);
    if (typeof value === "string") {
        return value.split(/[,\s]+/).map((entry) => entry.trim()).filter(Boolean);
    }
    return [];
}

function sortCounts(counts: Map<string, number>): Array<[string, number]> {
    return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function renderCountRows<T extends "folder" | "tag">(
    rows: Array<Record<T, string> & { count: number }>,
    key: T,
): string[] {
    return rows.length > 0 ? rows.map((row) => `- ${row[key]}: ${row.count}`) : ["- None detected."];
}

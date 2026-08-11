import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, resolve, sep } from "node:path";

import { describe, expect, it } from "@jest/globals";

import { createHeadingAwareMarkdownChunks } from "../src/vss/markdown-chunker";

interface RangeStageSegment {
    idPrefix: string;
    from: number;
    to: number;
    pad: number;
    sampleClass: "warmup" | "measured" | "probe";
    promptId: string;
}

interface SingleStageSegment {
    id: string;
    sampleClass: "warmup" | "measured" | "probe";
    promptId: string;
}

type StageSegment = RangeStageSegment | SingleStageSegment;

interface PerformanceWorkload {
    schemaVersion: number;
    conversationPolicy: string;
    fixtureCase: {
        id: string;
        wave1Direct: {
            pathPrefix: string;
            from: number;
            to: number;
            pad: number;
        };
        wave1GraphHubPath: string;
        wave2FreshDirectPaths: string[];
        wave2GraphHubPath: string;
        requiredDisconnectedWaves: boolean;
    };
    prompts: Record<string, { text: string; expectedShape: string }>;
    qualification: { requiredBeforeEnvelope: string[] };
    stages: {
        standardPerformance: StageSegment[];
        retryPerformanceBatch1: StageSegment[];
        retryPerformanceBatch2: StageSegment[];
        cancellationProbe: StageSegment[];
    };
}

interface RetrievalFixtureManifest {
    fixtureVersion: string;
    deviceMeasurementPlan: {
        version: string;
        diagnosticsEvidence: {
            schemaVersion: number;
            standardPerformanceEpisodeCount: number;
            retryPerformanceEpisodeCount: number;
            retryPerformanceBatchEpisodeCounts: number[];
            cancellationProbeEpisodeCount: number;
        };
        performanceWorkload: PerformanceWorkload;
    };
    files: Record<string, string>;
}

interface WorkloadItem {
    id: string;
    sampleClass: string;
    promptId: string;
}

const repositoryRoot = resolve(__dirname, "..");
const fixtureVaultRoot = join(repositoryRoot, "__fixtures__/retrieval-smoke/vault");
const manifest = JSON.parse(readFileSync(
    join(repositoryRoot, "__fixtures__/retrieval-smoke/manifest.json"),
    "utf8",
)) as RetrievalFixtureManifest;
const workload = manifest.deviceMeasurementPlan.performanceWorkload;
const pollutionSourcePath = "retrieval-smoke/graph/performance-pollution-probe.md";
const pollutionTargetPath = "retrieval-smoke/performance/200-wave1-direct-01.md";
const pollutionLinkCases = [
    ["full-path wikilink", "[[retrieval-smoke/performance/200-wave1-direct-01|D01]]"],
    ["relative wikilink", "[[performance/200-wave1-direct-01|D01]]"],
    ["basename wikilink", "[[200-wave1-direct-01|D01]]"],
    ["full-path Markdown link", "[D01](retrieval-smoke/performance/200-wave1-direct-01.md)"],
    ["relative Markdown link", "[D01](../performance/200-wave1-direct-01.md)"],
    ["basename Markdown link", "[D01](200-wave1-direct-01.md)"],
] as const;

describe("retrieval performance fixture", () => {
    it("freezes the v5/v9 workload into 23/12/11/1 unique ordered episodes", () => {
        expect(manifest.fixtureVersion).toBe("b125-retrieval-smoke-v5");
        expect(manifest.deviceMeasurementPlan.version).toBe("b125-device-measurement-v9");
        expect(Object.keys(workload).sort()).toEqual([
            "conversationPolicy",
            "fixtureCase",
            "prompts",
            "qualification",
            "schemaVersion",
            "stages",
        ]);
        expect(workload).toMatchObject({
            schemaVersion: 1,
            conversationPolicy: "fresh-chat-per-episode",
            prompts: {
                "standard-v1": {
                    text: "只从我的笔记中回答：PFS-731 银色潮闸告警的完整原因是什么？",
                    expectedShape: "one-attempt-full-graph",
                },
                "retry-v1": {
                    text: "只从我的笔记中回答：PFR-842 琥珀罗盘事故的完整根因是什么？",
                    expectedShape: "two-attempt-full-graph-with-projection",
                },
                "cancel-v1": {
                    text: "只从我的笔记中回答：PFS-731 银色潮闸告警的完整原因与修复方向是什么？",
                    expectedShape: "one-attempt-same-worker-cancel",
                },
            },
            qualification: {
                requiredBeforeEnvelope: ["standard-v1", "retry-v1"],
            },
        });

        const standard = expandStage(workload.stages.standardPerformance);
        const retryBatch1 = expandStage(workload.stages.retryPerformanceBatch1);
        const retryBatch2 = expandStage(workload.stages.retryPerformanceBatch2);
        const cancellation = expandStage(workload.stages.cancellationProbe);
        const diagnostics = manifest.deviceMeasurementPlan.diagnosticsEvidence;

        expect(standard.map(({ id }) => id)).toEqual([
            ...numberedIds("perf-std-warmup-", 1, 3),
            ...numberedIds("perf-std-measured-", 1, 20),
        ]);
        expect(retryBatch1.map(({ id }) => id)).toEqual([
            ...numberedIds("perf-retry-warmup-", 1, 3),
            ...numberedIds("perf-retry-measured-", 1, 9),
        ]);
        expect(retryBatch2.map(({ id }) => id)).toEqual(
            numberedIds("perf-retry-measured-", 10, 20),
        );
        expect(cancellation.map(({ id }) => id)).toEqual(["perf-cancel-probe-01"]);
        expect([standard.length, retryBatch1.length, retryBatch2.length, cancellation.length])
            .toEqual([23, 12, 11, 1]);
        expect(diagnostics).toMatchObject({
            schemaVersion: 1,
            standardPerformanceEpisodeCount: standard.length,
            retryPerformanceEpisodeCount: retryBatch1.length + retryBatch2.length,
            retryPerformanceBatchEpisodeCounts: [retryBatch1.length, retryBatch2.length],
            cancellationProbeEpisodeCount: cancellation.length,
        });

        const sequence = [...standard, ...retryBatch1, ...retryBatch2, ...cancellation];
        expect(new Set(sequence.map(({ id }) => id)).size).toBe(47);
        expect(standard.every(({ promptId }) => promptId === "standard-v1")).toBe(true);
        expect([...retryBatch1, ...retryBatch2]
            .every(({ promptId }) => promptId === "retry-v1")).toBe(true);
        expect(cancellation[0]?.promptId).toBe("cancel-v1");
    });

    it("keeps the two convergence waves disconnected and every note to one short chunk", () => {
        const fixtureCase = workload.fixtureCase;
        const wave1DirectPaths = expandFixtureRange(fixtureCase.wave1Direct);
        const wave1Paths = new Set([...wave1DirectPaths, fixtureCase.wave1GraphHubPath]);
        const wave2Paths = new Set([
            ...fixtureCase.wave2FreshDirectPaths,
            fixtureCase.wave2GraphHubPath,
        ]);
        const performancePaths = [...wave1Paths, ...wave2Paths];

        expect(fixtureCase).toMatchObject({
            id: "perf-full-graph-two-wave-v1",
            requiredDisconnectedWaves: true,
        });
        expect(wave1DirectPaths).toHaveLength(12);
        expect(performancePaths).toHaveLength(16);
        expect([...wave1Paths].filter((path) => wave2Paths.has(path))).toEqual([]);

        const contents = new Map(performancePaths.map((fixturePath) => [
            fixturePath,
            readFixture(fixturePath),
        ]));
        const wave1HubLinks = readWikiLinks(contents.get(fixtureCase.wave1GraphHubPath) ?? "");
        const wave2HubLinks = readWikiLinks(contents.get(fixtureCase.wave2GraphHubPath) ?? "");

        expect(wave1HubLinks).toEqual(wave1DirectPaths.map(withoutMarkdownExtension));
        expect(wave2HubLinks).toEqual(
            fixtureCase.wave2FreshDirectPaths.map(withoutMarkdownExtension),
        );
        const promptDiscriminators =
            /PFS-731|PFR-842|银色潮闸|琥珀罗盘|告警|完整原因|事故|完整根因|修复方向/;
        expect(contents.get(fixtureCase.wave1GraphHubPath)).not.toMatch(promptDiscriminators);
        expect(contents.get(fixtureCase.wave2GraphHubPath)).not.toMatch(promptDiscriminators);

        for (const directPath of [...wave1DirectPaths, ...fixtureCase.wave2FreshDirectPaths]) {
            expect(readWikiLinks(contents.get(directPath) ?? "")).toEqual([]);
        }
        for (const target of wave1HubLinks) {
            expect(wave1Paths.has(`${target}.md`)).toBe(true);
            expect(wave2Paths.has(`${target}.md`)).toBe(false);
        }
        for (const target of wave2HubLinks) {
            expect(wave2Paths.has(`${target}.md`)).toBe(true);
            expect(wave1Paths.has(`${target}.md`)).toBe(false);
        }

        const allFixturePaths = listFixtureFiles(fixtureVaultRoot);
        const performanceEdges = collectPerformanceEdges(
            allFixturePaths.map((sourcePath) => ({ sourcePath, markdown: readFixture(sourcePath) })),
            allFixturePaths,
        );
        const expectedPerformanceEdges = [
            ...wave1DirectPaths.map((targetPath) =>
                `${fixtureCase.wave1GraphHubPath}->${targetPath}`),
            ...fixtureCase.wave2FreshDirectPaths.map((targetPath) =>
                `${fixtureCase.wave2GraphHubPath}->${targetPath}`),
        ].sort();
        expect(performanceEdges).toEqual(expectedPerformanceEdges);

        const directBodies = wave1DirectPaths.map((fixturePath) =>
            (contents.get(fixturePath) ?? "").split("\n\n").slice(1).join("\n\n").trim());
        expect(new Set(directBodies).size).toBe(1);
        for (const body of directBodies) {
            expect(body).toContain("`PFS-731` 银色潮闸告警的完整原因已确认");
            expect(body).toContain("`PFR-842` 琥珀罗盘事故的完整根因仍未确认");
            expect(body).toContain("根因闭环缺失，不能给出完整根因");
        }

        const wave2Target = contents.get(fixtureCase.wave2FreshDirectPaths[0] ?? "") ?? "";
        const wave2Helper = contents.get(fixtureCase.wave2FreshDirectPaths[1] ?? "") ?? "";
        expect(wave2Target).toContain("因此完整根因是校验进程没有在换班后刷新校准纪元");
        expect(wave2Helper).toContain("这支持“旧纪元未刷新”的根因");
        for (const content of [wave2Target, wave2Helper]) {
            expect(countPromptSignals(directBodies[0] ?? ""))
                .toBeGreaterThan(countPromptSignals(content));
        }

        for (const fixturePath of performancePaths) {
            const markdown = contents.get(fixturePath) ?? "";
            const chunks = createHeadingAwareMarkdownChunks({
                path: fixturePath,
                markdown,
                contentHash: sha256(Buffer.from(markdown)),
                created: 0,
                lastModified: 0,
            });
            expect(chunks).toHaveLength(1);
            expect(markdown.length).toBeLessThan(4_000);
        }
    });

    it.each(pollutionLinkCases)("routes a %s into the performance-edge scan", (_label, markdown) => {
        const fixturePaths = listFixtureFiles(fixtureVaultRoot);
        expect(collectPerformanceEdges(
            [{ sourcePath: pollutionSourcePath, markdown }],
            fixturePaths,
        )).toEqual([`${pollutionSourcePath}->${pollutionTargetPath}`]);
    });

    it("binds every source fixture path to its canonical raw-byte digest", () => {
        const actualPaths = listFixtureFiles(fixtureVaultRoot);
        const manifestPaths = Object.keys(manifest.files).sort();

        expect(manifestPaths).toEqual(actualPaths);
        for (const fixturePath of actualPaths) {
            const bytes = readFileSync(join(fixtureVaultRoot, fixturePath));
            expect(manifest.files[fixturePath]).toBe(sha256(bytes));
        }
    });
});

function expandStage(segments: StageSegment[]): WorkloadItem[] {
    return segments.flatMap((segment) => {
        if ("id" in segment) {
            return [{
                id: segment.id,
                sampleClass: segment.sampleClass,
                promptId: segment.promptId,
            }];
        }
        return numberedIds(segment.idPrefix, segment.from, segment.to, segment.pad).map((id) => ({
            id,
            sampleClass: segment.sampleClass,
            promptId: segment.promptId,
        }));
    });
}

function numberedIds(prefix: string, from: number, to: number, pad = 2): string[] {
    return Array.from({ length: to - from + 1 }, (_, offset) =>
        `${prefix}${String(from + offset).padStart(pad, "0")}`);
}

function expandFixtureRange(range: PerformanceWorkload["fixtureCase"]["wave1Direct"]): string[] {
    return numberedIds(range.pathPrefix, range.from, range.to, range.pad)
        .map((path) => `${path}.md`);
}

function readFixture(fixturePath: string): string {
    return readFileSync(join(fixtureVaultRoot, fixturePath), "utf8");
}

function readWikiLinks(markdown: string): string[] {
    return [...markdown.matchAll(/\[\[([^|\]]+)(?:\|[^\]]+)?\]\]/g)]
        .map((match) => match[1] ?? "");
}

function withoutMarkdownExtension(fixturePath: string): string {
    return fixturePath.replace(/\.md$/, "");
}

function collectPerformanceEdges(
    sources: Array<{ sourcePath: string; markdown: string }>,
    fixturePaths: string[],
): string[] {
    const performancePrefix = "retrieval-smoke/performance/";
    return sources.flatMap(({ sourcePath, markdown }) =>
        readFixtureLinks(sourcePath, markdown, fixturePaths).map((targetPath) => ({
            sourcePath,
            targetPath,
        })))
        .filter(({ sourcePath, targetPath }) =>
            sourcePath.startsWith(performancePrefix) || targetPath.startsWith(performancePrefix))
        .map(({ sourcePath, targetPath }) => `${sourcePath}->${targetPath}`)
        .sort();
}

function readFixtureLinks(sourcePath: string, markdown: string, fixturePaths: string[]): string[] {
    const wikiTargets = readWikiLinks(markdown);
    const markdownTargets = [...markdown.matchAll(/\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g)]
        .map((match) => match[1] ?? match[2] ?? "");
    return [...wikiTargets, ...markdownTargets]
        .map((target) => resolveFixtureTarget(sourcePath, target, fixturePaths))
        .filter((target): target is string => target !== null);
}

function resolveFixtureTarget(
    sourcePath: string,
    rawTarget: string,
    fixturePaths: string[],
): string | null {
    let target = rawTarget.trim();
    if (!target || target.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(target)) return null;
    try {
        target = decodeURIComponent(target);
    } catch {
        return null;
    }
    target = target.split("#", 1)[0]?.replace(/\\/g, "/").replace(/^\/+/, "") ?? "";
    if (!target) return null;
    const markdownTarget = target.endsWith(".md") ? target : `${target}.md`;
    const fixturePathSet = new Set(fixturePaths);
    const exactCandidates = [
        posix.normalize(markdownTarget),
        posix.normalize(posix.join(posix.dirname(sourcePath), markdownTarget)),
        posix.normalize(posix.join("retrieval-smoke", markdownTarget)),
    ];
    for (const candidate of exactCandidates) {
        if (fixturePathSet.has(candidate)) return candidate;
    }
    const suffixMatches = fixturePaths.filter((fixturePath) =>
        fixturePath.endsWith(`/${posix.normalize(markdownTarget)}`));
    if (suffixMatches.length === 1) return suffixMatches[0] ?? null;
    const basename = posix.basename(markdownTarget);
    const basenameMatches = fixturePaths.filter((fixturePath) => posix.basename(fixturePath) === basename);
    return basenameMatches.length === 1 ? basenameMatches[0] ?? null : null;
}

function countPromptSignals(markdown: string): number {
    return ["PFR-842", "琥珀罗盘", "完整根因", "换班后失败"]
        .reduce((count, signal) => count + markdown.split(signal).length - 1, 0);
}

function listFixtureFiles(directory: string): string[] {
    const paths: string[] = [];
    const visit = (current: string): void => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const entryPath = join(current, entry.name);
            if (entry.isDirectory()) visit(entryPath);
            else if (entry.isFile()) paths.push(relative(directory, entryPath).split(sep).join("/"));
        }
    };
    visit(directory);
    return paths.sort();
}

function sha256(value: Buffer): string {
    return createHash("sha256").update(value).digest("hex");
}

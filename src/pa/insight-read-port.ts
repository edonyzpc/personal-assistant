import type { VaultMetacognitionSnapshot } from "../ai-services/memory-extraction/type-c-analyzer";
import type { MemoryManagementEvidence } from "../ai-services/memory-management-evidence";
import { boundedMemoryFingerprint } from "../ai-services/memory-management-evidence";
import type { SavedInsight } from "./saved-insight-store";

export interface InsightSourceRevision {
    identity: object;
    mtime: number;
    ctime: number;
    size: number;
}

export interface InsightReadPortDependencies {
    isRuntimeCurrent(): boolean;
    getVaultInsights(): {
        status: "disabled" | "not_loaded" | "ready" | "stale_boundary" | "error";
        snapshot: VaultMetacognitionSnapshot | null;
        boundary: string;
        sourceIdentity?: object;
        isSourceCurrent(): boolean;
    };
    listSavedInsights(): SavedInsight[];
    getBoundary(): string;
    isPathAllowed(path: string): boolean;
    getSourceRevision(path: string): InsightSourceRevision | null;
}

export interface SavedInsightQuery {
    text?: string;
    itemId?: string;
    status?: "active" | "archived" | "promoted";
    limit: number;
}

export interface InsightReadPort {
    getVaultInsights(): InsightReadResult;
    querySavedInsights(input: SavedInsightQuery): InsightReadResult;
    prepareObservation(evidence: MemoryManagementEvidence): Promise<{
        ready: boolean;
        stateFingerprint?: string;
        aggregateCurrent?: boolean;
        validItemIndexes?: number[];
        projectedContent?: unknown;
        guard?: { assertCurrent(): void };
    }>;
}

export interface InsightReadResult {
    content: Record<string, unknown>;
    stateFingerprint: string;
}

export function createInsightReadPort(dependencies: InsightReadPortDependencies): InsightReadPort {
    const bounded = (value: string, limit = 160): string => value.length <= limit ? value : value.slice(0, limit);
    const visiblePath = (path: string): string => path.length <= 160 ? path : "[path omitted: too long]";
    const sourceIdentityIds = new WeakMap<object, number>();
    let nextSourceIdentityId = 0;
    const sourceIdentity = (value: object): number => {
        let id = sourceIdentityIds.get(value);
        if (!id) {
            id = ++nextSourceIdentityId;
            sourceIdentityIds.set(value, id);
        }
        return id;
    };
    const vault = (): InsightReadResult => {
        const current = dependencies.getVaultInsights();
        const ready = dependencies.isRuntimeCurrent() && current.status === "ready"
            && current.snapshot !== null && current.isSourceCurrent();
        const snapshot = ready ? current.snapshot : null;
        const content: Record<string, unknown> = {
            kind: "vault-insights",
            available: ready,
            status: ready ? "ready" : current.status === "ready" ? "stale_source" : current.status,
            ...(snapshot ? {
                generatedAt: snapshot.generatedAt,
                coverage: { fileCount: snapshot.fileCount, basis: "metadata_aggregate", presentation: "representative_top_three" },
                evidenceTypes: { folderThemes: "aggregate", tagTaxonomy: "aggregate", linkTopology: "aggregate", writingHabits: "aggregate", topicClusters: "inference", knowledgeGaps: "inference", trends: "aggregate" },
                snapshot: {
                    folderThemes: snapshot.folderThemes.slice(0, 3).map(value => ({ folder: visiblePath(value.folder), count: value.count })),
                    tagTaxonomy: snapshot.tagTaxonomy.slice(0, 3).map(value => ({ tag: bounded(value.tag), count: value.count })),
                    linkTopology: {
                        hubNotes: snapshot.linkTopology.hubNotes.slice(0, 3).map(value => ({ ...value, path: visiblePath(value.path) })),
                        unresolvedLinks: snapshot.linkTopology.unresolvedLinks.slice(0, 3).map(value => ({ target: bounded(value.target), count: value.count })),
                    },
                    writingHabits: {
                        busiestWeekdays: snapshot.writingHabits.busiestWeekdays.slice(0, 7),
                        averageWords: snapshot.writingHabits.averageWords,
                        recentlyActive: snapshot.writingHabits.recentlyActive.slice(0, 3).map(visiblePath),
                    },
                    topicClusters: snapshot.topicClusters.slice(0, 3).map(cluster => ({ label: bounded(cluster.label), paths: cluster.paths.slice(0, 2).map(visiblePath) })),
                    knowledgeGaps: snapshot.knowledgeGaps.slice(0, 3).map(value => ({ label: bounded(value.label), evidence: bounded(value.evidence, 240) })),
                    trends: snapshot.trends.slice(0, 3).map(value => ({ label: bounded(value.label), count: value.count })),
                },
                limitation: "This is a saved aggregate, not verified note text. Unresolved links alone do not prove a knowledge gap; use note tools to check examples.",
            } : {}),
        };
        return { content, stateFingerprint: boundedMemoryFingerprint({
            content, boundary: current.boundary,
            sourceIdentity: current.sourceIdentity ? sourceIdentity(current.sourceIdentity) : null,
        }) };
    };

    const saved = (input: SavedInsightQuery): InsightReadResult => {
        const runtimeCurrent = dependencies.isRuntimeCurrent();
        const boundary = dependencies.getBoundary();
        const all = dependencies.listSavedInsights();
        const filtered = all.filter(item => {
            if (input.itemId && item.id !== input.itemId) return false;
            if (input.status && item.status !== input.status) return false;
            if (input.text && !item.text.toLocaleLowerCase().includes(input.text.toLocaleLowerCase())) return false;
            return [...(item.scope.paths ?? []), ...item.sourceRefs.map(ref => ref.path)]
                .every(path => dependencies.isPathAllowed(path) && dependencies.getSourceRevision(path) !== null);
        });
        const textLimit = input.itemId ? 1000 : 200;
        const sourceLimit = input.itemId ? 8 : 3;
        const items = filtered.slice(0, input.limit).map(item => {
            const revisions = item.sourceRefs.map(ref => dependencies.getSourceRevision(ref.path));
            const sourcesCurrent = revisions.every(Boolean);
            return {
                id: item.id,
                type: item.type,
                origin: item.origin,
                status: item.status,
                influencePolicy: item.influencePolicy,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
                ...(sourcesCurrent || (item.origin === "user-authored" && item.sourceRefs.length === 0) ? {
                    text: bounded(item.text, textLimit),
                    textTruncated: item.text.length > textLimit,
                } : {}),
                sourceState: item.sourceRefs.length === 0 ? "no_source_user_authored"
                    : sourcesCurrent ? "path_present_content_unverified" : "source_missing",
                sourceRefs: item.sourceRefs.slice(0, sourceLimit).map(ref => ({
                    ...(ref.path.length <= 160 ? { path: ref.path } : { pathOmitted: true }),
                    ...(ref.heading ? { heading: bounded(ref.heading, 80) } : {}),
                    ...(ref.blockId ? { blockId: bounded(ref.blockId, 80) } : {}),
                })),
                sourceRefsOmittedCount: Math.max(0, item.sourceRefs.length - sourceLimit),
            };
        });
        const content: Record<string, unknown> = {
            kind: "saved-insights",
            available: runtimeCurrent,
            items: runtimeCurrent ? items : [],
            matchCount: runtimeCurrent ? filtered.length : 0,
            coverage: runtimeCurrent && filtered.length > items.length ? "partial" : "complete",
            limitation: "These are saved assets, not proof that their source notes still say the same thing. Check note text before presenting a current factual claim.",
        };
        while (JSON.stringify(content).length > 11_500 && items.length > 1) {
            items.pop();
            content.coverage = "partial";
        }
        const sourceRevisions = filtered.slice(0, items.length).flatMap(item => item.sourceRefs.map(ref => {
            const revision = dependencies.getSourceRevision(ref.path);
            return { path: ref.path, identity: revision ? sourceIdentity(revision.identity) : null, mtime: revision?.mtime, ctime: revision?.ctime, size: revision?.size };
        }));
        return { content, stateFingerprint: boundedMemoryFingerprint({ content, boundary, sourceRevisions }) };
    };

    return {
        getVaultInsights: vault,
        querySavedInsights: saved,
        async prepareObservation(evidence) {
            const request = evidence.request;
            const current = evidence.tool === "get_vault_insights" ? vault()
                : evidence.tool === "query_saved_insights" ? saved({
                    ...(request.text ? { text: request.text } : {}),
                    ...(request.itemId ? { itemId: request.itemId } : {}),
                    ...(request.status === "active" || request.status === "archived" || request.status === "promoted" ? { status: request.status } : {}),
                    limit: Number(request.limit) || 10,
                }) : null;
            if (!current) return { ready: false };
            const same = current.stateFingerprint === evidence.stateFingerprint
                && boundedMemoryFingerprint(current.content) === evidence.contentFingerprint;
            return {
                ready: same,
                stateFingerprint: current.stateFingerprint,
                aggregateCurrent: same,
                validItemIndexes: same ? evidence.items.map(item => item.index) : [],
                projectedContent: same ? current.content : undefined,
                guard: { assertCurrent() {
                    const latest = evidence.tool === "get_vault_insights" ? vault() : saved({
                        ...(request.text ? { text: request.text } : {}),
                        ...(request.itemId ? { itemId: request.itemId } : {}),
                        ...(request.status === "active" || request.status === "archived" || request.status === "promoted" ? { status: request.status } : {}),
                        limit: Number(request.limit) || 10,
                    });
                    if (latest.stateFingerprint !== evidence.stateFingerprint) throw new Error("Insight source changed before dispatch.");
                } },
            };
        },
    };
}

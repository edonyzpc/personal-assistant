import {
    hasForbiddenPersistedTextFields,
    validateSourceRefPathShape,
    type PersistedSourceRef,
    type ReviewQueueScope,
    type ReviewQueueStatus,
} from "./contracts";
import { normalizeVaultPath, stableHash, cloneSourceRef } from "./helpers";
import type {
    ReviewQueueCreateInput,
    ReviewQueueItem,
    ReviewQueueResult,
} from "./review-queue-store";

export const GRAPH_DISCOVERY_ITEM_TYPES = [
    "related_note",
    "theme_chain",
    "conflict_pair",
    "index_note_candidate",
] as const;

export type GraphDiscoveryItemType = typeof GRAPH_DISCOVERY_ITEM_TYPES[number];
export type GraphDiscoveryEdgeState = "suggested" | "accepted" | "source-backed" | "rejected" | "expired" | "uncertain";
export type GraphDiscoveryOutcomeStatus = "reviewable" | "source_backed" | "low_evidence" | "conflict" | "rejected";
export type GraphDiscoveryFeedback = "accept" | "dismiss" | "reject";

export interface GraphDiscoveryNote {
    path: string;
    title?: string;
    content?: string;
    tags?: readonly string[];
    links?: readonly string[];
    backlinks?: readonly string[];
    aliases?: readonly string[];
    folder?: string;
    modifiedAt?: string;
    sourceRefs?: readonly PersistedSourceRef[];
}

export interface GraphDiscoveryItem {
    id: string;
    type: GraphDiscoveryItemType;
    title: string;
    claim: string;
    scope: ReviewQueueScope;
    sourceRefs: PersistedSourceRef[];
    whyShown: string[];
    edgeState: GraphDiscoveryEdgeState;
    outcomeStatus: GraphDiscoveryOutcomeStatus;
    generatedAt: string;
    metadata: Record<string, string | number | boolean | null>;
}

export interface GraphDiscoveryRunResult {
    generatedAt: string;
    totalCount: number;
    items: GraphDiscoveryItem[];
    skippedSourceCount: number;
}

export interface GraphDiscoveryOptions {
    now?: Date | (() => Date);
    scope?: ReviewQueueScope;
    dataBoundarySnapshotId?: string;
    isPathAllowed?: (path: string) => boolean;
    maxItemsPerType?: number;
}

export interface GraphDiscoveryFeedbackRecord {
    itemId: string;
    type: GraphDiscoveryItemType;
    status: ReviewQueueStatus;
    edgeState: GraphDiscoveryEdgeState;
    updatedAt: string;
    localOnly: true;
    writes: {
        vault: false;
        memory: false;
        savedInsight: false;
        telemetry: false;
    };
}

export interface GraphDiscoveryFeedbackPorts {
    updateReviewQueueStatus?: (id: string, status: ReviewQueueStatus) => Promise<ReviewQueueResult<ReviewQueueItem>> | ReviewQueueResult<ReviewQueueItem>;
    writeVaultNote?: () => Promise<void> | void;
    createMemory?: () => Promise<void> | void;
    createSavedInsight?: () => Promise<void> | void;
    sendTelemetry?: () => Promise<void> | void;
}

const DEFAULT_MAX_ITEMS_PER_TYPE = 4;

function nowDate(now: GraphDiscoveryOptions["now"]): Date {
    const value = typeof now === "function" ? now() : now;
    return value ? new Date(value.getTime()) : new Date();
}

function basenameFromPath(path: string): string {
    const name = normalizeVaultPath(path).split("/").pop() ?? path;
    return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

function parentFolder(path: string): string {
    const normalized = normalizeVaultPath(path);
    const slash = normalized.lastIndexOf("/");
    return slash > 0 ? normalized.slice(0, slash) : "";
}

function noteTitle(note: GraphDiscoveryNote): string {
    return note.title?.trim() || basenameFromPath(note.path);
}

function normalizeTag(tag: string): string {
    return tag.trim().replace(/^#+/, "").toLowerCase();
}

function uniqueStrings(values: readonly string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function sourceRefsAreValid(refs: readonly PersistedSourceRef[]): boolean {
    return refs.length > 0
        && refs.every((ref) => validateSourceRefPathShape(ref).ok)
        && !hasForbiddenPersistedTextFields(refs);
}

function sourceRefForNote(note: GraphDiscoveryNote, generatedAt: string, whyShown: string): PersistedSourceRef {
    const ref = note.sourceRefs?.find((candidate) => validateSourceRefPathShape(candidate).ok);
    if (ref) {
        return {
            ...cloneSourceRef(ref),
            whyShown: uniqueStrings([...(ref.whyShown ?? []), whyShown]),
        };
    }
    const path = normalizeVaultPath(note.path);
    return {
        path,
        generatedAt,
        contentHash: stableHash(`${path}:${note.content?.length ?? 0}`),
        evidenceStrength: "medium",
        whyShown: [whyShown],
    };
}

function makeScope(notes: readonly GraphDiscoveryNote[], fallback?: ReviewQueueScope): ReviewQueueScope {
    if (fallback) {
        return {
            ...fallback,
            paths: fallback.paths ? [...fallback.paths] : undefined,
            tags: fallback.tags ? [...fallback.tags] : undefined,
        };
    }
    const paths = notes.map((note) => normalizeVaultPath(note.path)).filter(Boolean);
    return {
        kind: paths.length === 1 ? "current_note" : "selected_notes",
        paths,
    };
}

function normalizedNotes(notes: readonly GraphDiscoveryNote[], options: GraphDiscoveryOptions): {
    notes: GraphDiscoveryNote[];
    skippedSourceCount: number;
} {
    const result: GraphDiscoveryNote[] = [];
    let skippedSourceCount = 0;
    const seen = new Set<string>();
    for (const note of notes) {
        const path = normalizeVaultPath(note.path);
        if (!path || seen.has(path)) continue;
        if (options.isPathAllowed && !options.isPathAllowed(path)) {
            skippedSourceCount += 1;
            continue;
        }
        const candidate: GraphDiscoveryNote = {
            ...note,
            path,
            title: noteTitle(note),
            tags: uniqueStrings((note.tags ?? []).map(normalizeTag)),
            links: uniqueStrings((note.links ?? []).map(normalizeVaultPath)),
            backlinks: uniqueStrings((note.backlinks ?? []).map(normalizeVaultPath)),
            aliases: uniqueStrings(note.aliases ?? []),
            folder: normalizeVaultPath(note.folder ?? parentFolder(path)),
        };
        if (sourceRefsAreValid(note.sourceRefs ?? [])) {
            candidate.sourceRefs = note.sourceRefs?.map(cloneSourceRef);
        }
        result.push(candidate);
        seen.add(path);
    }
    return { notes: result, skippedSourceCount };
}

export function discoverLightweightGraphItems(
    inputNotes: readonly GraphDiscoveryNote[],
    options: GraphDiscoveryOptions = {},
): GraphDiscoveryRunResult {
    const generatedAt = nowDate(options.now).toISOString();
    const { notes, skippedSourceCount } = normalizedNotes(inputNotes, options);
    const maxItemsPerType = Math.max(1, options.maxItemsPerType ?? DEFAULT_MAX_ITEMS_PER_TYPE);
    const items = [
        ...buildRelatedNoteItems(notes, generatedAt, options).slice(0, maxItemsPerType),
        ...buildThemeChainItems(notes, generatedAt, options).slice(0, maxItemsPerType),
        ...buildConflictPairItems(notes, generatedAt, options).slice(0, maxItemsPerType),
        ...buildIndexNoteCandidateItems(notes, generatedAt, options).slice(0, maxItemsPerType),
    ].filter((item) => sourceRefsAreValid(item.sourceRefs));
    return {
        generatedAt,
        totalCount: items.length,
        items,
        skippedSourceCount,
    };
}

function buildRelatedNoteItems(
    notes: readonly GraphDiscoveryNote[],
    generatedAt: string,
    options: GraphDiscoveryOptions,
): GraphDiscoveryItem[] {
    const cap = Math.max(1, options.maxItemsPerType ?? DEFAULT_MAX_ITEMS_PER_TYPE);
    const items: GraphDiscoveryItem[] = [];
    for (let leftIndex = 0; leftIndex < notes.length && items.length < cap; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < notes.length && items.length < cap; rightIndex += 1) {
            const left = notes[leftIndex];
            const right = notes[rightIndex];
            const sharedTags = sharedValues(left.tags ?? [], right.tags ?? []);
            const linked = (left.links ?? []).includes(right.path) || (right.links ?? []).includes(left.path)
                || (left.backlinks ?? []).includes(right.path) || (right.backlinks ?? []).includes(left.path);
            const sameFolder = Boolean(left.folder && right.folder && left.folder === right.folder);
            if (!linked && sharedTags.length === 0 && !sameFolder) continue;
            const whyShown = uniqueStrings([
                linked ? "Linked or backlink relationship." : "",
                sameFolder ? "Same folder." : "",
                sharedTags.length > 0 ? `Shared tag #${sharedTags[0]}.` : "",
            ]);
            const sourceRefs = [
                sourceRefForNote(left, generatedAt, whyShown[0] ?? "Related note source."),
                sourceRefForNote(right, generatedAt, whyShown[0] ?? "Related note source."),
            ];
            items.push({
                id: `graph-related-${stableHash(`${left.path}|${right.path}`)}`,
                type: "related_note",
                title: `Related notes: ${noteTitle(left)} + ${noteTitle(right)}`,
                claim: `${noteTitle(left)} and ${noteTitle(right)} look related through local vault structure.`,
                scope: makeScope([left, right], options.scope),
                sourceRefs,
                whyShown,
                edgeState: linked ? "source-backed" : "suggested",
                outcomeStatus: linked ? "source_backed" : "reviewable",
                generatedAt,
                metadata: {
                    graphDiscoveryType: "related_note",
                    edgeState: linked ? "source-backed" : "suggested",
                    outcomeStatus: linked ? "source_backed" : "reviewable",
                    sourceCount: sourceRefs.length,
                    linked,
                },
            });
        }
    }
    return items.sort((left, right) => right.sourceRefs.length - left.sourceRefs.length || left.title.localeCompare(right.title));
}

function buildThemeChainItems(
    notes: readonly GraphDiscoveryNote[],
    generatedAt: string,
    options: GraphDiscoveryOptions,
): GraphDiscoveryItem[] {
    const byTag = new Map<string, GraphDiscoveryNote[]>();
    for (const note of notes) {
        for (const tag of note.tags ?? []) {
            const current = byTag.get(tag) ?? [];
            current.push(note);
            byTag.set(tag, current);
        }
    }
    return [...byTag.entries()]
        .filter(([, group]) => group.length >= 3)
        .map(([tag, group]): GraphDiscoveryItem => {
            const selected = group.slice(0, 6);
            const sourceRefs = selected.map((note) => sourceRefForNote(note, generatedAt, `Theme chain source for #${tag}.`));
            return {
                id: `graph-theme-${stableHash(tag)}`,
                type: "theme_chain",
                title: `Theme chain: #${tag}`,
                claim: `${selected.length} notes repeat #${tag}; review before turning it into an insight or index.`,
                scope: makeScope(selected, options.scope),
                sourceRefs,
                whyShown: [`#${tag} appears across several source notes.`],
                edgeState: "suggested",
                outcomeStatus: "reviewable",
                generatedAt,
                metadata: {
                    graphDiscoveryType: "theme_chain",
                    edgeState: "suggested",
                    outcomeStatus: "reviewable",
                    themeKey: `tag:${stableHash(tag)}`,
                    sourceCount: sourceRefs.length,
                    admittedToMemory: false,
                },
            };
        });
}

function buildConflictPairItems(
    notes: readonly GraphDiscoveryNote[],
    generatedAt: string,
    options: GraphDiscoveryOptions,
): GraphDiscoveryItem[] {
    const groups = new Map<string, Map<string, GraphDiscoveryNote[]>>();
    for (const note of notes) {
        for (const signal of extractConflictSignals(note.content ?? "")) {
            const byValue = groups.get(signal.key) ?? new Map<string, GraphDiscoveryNote[]>();
            const bucket = byValue.get(signal.value) ?? [];
            bucket.push(note);
            byValue.set(signal.value, bucket);
            groups.set(signal.key, byValue);
        }
    }
    const items: GraphDiscoveryItem[] = [];
    for (const [key, byValue] of groups.entries()) {
        if (byValue.size < 2) continue;
        const selected = [...byValue.values()].flat().slice(0, 6);
        const sourceRefs = selected.map((note) => sourceRefForNote(note, generatedAt, `Conflict source for ${key}.`));
        items.push({
            id: `graph-conflict-${stableHash(`${key}:${[...byValue.keys()].sort().join("|")}`)}`,
            type: "conflict_pair",
            title: `Possible conflict: ${key}`,
            claim: `Source notes disagree on ${key}; review before updating Memory or scope state.`,
            scope: makeScope(selected, options.scope),
            sourceRefs,
            whyShown: [`Different ${key} values appear in source notes.`],
            edgeState: "uncertain",
            outcomeStatus: "conflict",
            generatedAt,
            metadata: {
                graphDiscoveryType: "conflict_pair",
                edgeState: "uncertain",
                outcomeStatus: "conflict",
                conflictKey: key,
                sourceCount: sourceRefs.length,
            },
        });
    }
    return items;
}

function buildIndexNoteCandidateItems(
    notes: readonly GraphDiscoveryNote[],
    generatedAt: string,
    options: GraphDiscoveryOptions,
): GraphDiscoveryItem[] {
    const byFolder = new Map<string, GraphDiscoveryNote[]>();
    for (const note of notes) {
        const folder = note.folder ?? "";
        if (!folder) continue;
        const group = byFolder.get(folder) ?? [];
        group.push(note);
        byFolder.set(folder, group);
    }
    return [...byFolder.entries()]
        .filter(([, group]) => group.length >= 3)
        .map(([folder, group]): GraphDiscoveryItem => {
            const selected = group.slice(0, 8);
            const sourceRefs = selected.map((note) => sourceRefForNote(note, generatedAt, `Index candidate source for ${folder}.`));
            return {
                id: `graph-index-${stableHash(folder)}`,
                type: "index_note_candidate",
                title: `Index note candidate: ${folder}`,
                claim: `${selected.length} notes in ${folder} may deserve a reviewable index note.`,
                scope: makeScope(selected, options.scope),
                sourceRefs,
                whyShown: [`Several source notes cluster in ${folder}.`],
                edgeState: "suggested",
                outcomeStatus: "reviewable",
                generatedAt,
                metadata: {
                    graphDiscoveryType: "index_note_candidate",
                    edgeState: "suggested",
                    outcomeStatus: "reviewable",
                    folderKey: `folder:${stableHash(folder)}`,
                    sourceCount: sourceRefs.length,
                    createsNoteByDefault: false,
                },
            };
        });
}

function sharedValues(left: readonly string[], right: readonly string[]): string[] {
    const rightSet = new Set(right);
    return uniqueStrings(left.filter((value) => rightSet.has(value)));
}

function extractConflictSignals(content: string): Array<{ key: string; value: string }> {
    const signals: Array<{ key: string; value: string }> = [];
    const pattern = /(?:^|\n)\s*(status|decision|preference|constraint|task constraint|scope state)\s*[:：]\s*([^\n]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
        const key = match[1].toLowerCase().replace(/\s+/g, "_");
        const value = match[2].trim().toLowerCase().replace(/[.#*_`[\]]/g, "").slice(0, 80);
        if (value) signals.push({ key, value });
    }
    return signals;
}

export function graphDiscoveryItemToReviewQueueInput(
    item: GraphDiscoveryItem,
    options: {
        dataBoundarySnapshotId?: string;
        admissionReason: ReviewQueueCreateInput["admissionReason"];
    },
): ReviewQueueCreateInput {
    return {
        type: item.type,
        title: item.title,
        claim: item.claim,
        scope: item.scope,
        sourceRefs: item.sourceRefs.map(cloneSourceRef),
        originSurface: "pagelet",
        priority: item.type === "conflict_pair" ? "high" : "normal",
        whyShown: [...item.whyShown],
        dataBoundarySnapshotId: options.dataBoundarySnapshotId ?? "data_boundary:graph_discovery",
        admissionReason: options.admissionReason,
        metadata: { ...item.metadata },
    };
}

export async function applyGraphDiscoveryFeedback(
    item: GraphDiscoveryItem | ReviewQueueItem,
    feedback: GraphDiscoveryFeedback,
    ports: GraphDiscoveryFeedbackPorts = {},
    options: { now?: Date | (() => Date) } = {},
): Promise<GraphDiscoveryFeedbackRecord> {
    const status: ReviewQueueStatus = feedback === "accept" ? "accepted" : "dismissed";
    const edgeState: GraphDiscoveryEdgeState = feedback === "accept"
        ? "accepted"
        : feedback === "reject"
            ? "rejected"
            : "rejected";
    if ("id" in item) {
        await ports.updateReviewQueueStatus?.(item.id, status);
    }
    return {
        itemId: item.id,
        type: item.type as GraphDiscoveryItemType,
        status,
        edgeState,
        updatedAt: nowDate(options.now).toISOString(),
        localOnly: true,
        writes: {
            vault: false,
            memory: false,
            savedInsight: false,
            telemetry: false,
        },
    };
}

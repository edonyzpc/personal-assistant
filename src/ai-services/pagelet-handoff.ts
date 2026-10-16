import type { SourceRecord } from "./chat-types";
import { cloneInputLineage, unknownInputLineage, type InputLineage } from "./input-lineage";
import { cloneSourceRecord } from "./source-store";
import { parseVaultObservationEvidence, type VaultObservationEvidence } from "./vault-observation-evidence";
import { PAGELET_DEEP_DISCOVER_WEB_CACHE_TTL_MS } from "../pagelet/agent/types";

/** Host-owned ancestry captured at the actual authoring request, never citation inference. */
export interface PageletInputEvidence {
    readonly lineage: InputLineage;
    readonly sourceRecords: readonly SourceRecord[];
    readonly sourceSnapshots: readonly PageletChatHandoffSourceSnapshot[];
    readonly vaultObservations: readonly VaultObservationEvidence[];
}

export interface PageletChatHandoffAnchorSnapshot {
    readonly path: string;
    readonly mtime: number;
    readonly size: number;
    readonly contentHash: string;
}

export interface PageletChatHandoffSourceSnapshot {
    readonly path: string;
    readonly mtime: number;
    readonly size: number;
    readonly contentHash: string;
}

export interface PageletChatHandoffSourceRef {
    readonly path: string;
    readonly title?: string;
}

/**
 * Visible, source-backed Pagelet evidence that may be attached to one Chat turn.
 *
 * This envelope intentionally has no model transcript, prompt, metrics, tool
 * observations, or hidden reasoning fields. Callers should construct it through
 * {@link createPageletChatHandoffContext}, which also strips unexpected runtime
 * properties before the context reaches Chat or the configured AI provider.
 */
export interface PageletChatHandoffContext {
    readonly version: 1;
    readonly id: string;
    readonly body: string;
    readonly anchor: PageletChatHandoffAnchorSnapshot;
    readonly sources: readonly PageletChatHandoffSourceSnapshot[];
    readonly sourceRefs: readonly PageletChatHandoffSourceRef[];
    readonly webUrls: readonly string[];
    readonly whyNow: readonly string[];
    readonly triggerReason: string;
    readonly preparedAt: number;
    readonly pipelineVersion: string;
    /** SHA256 of the full original body, independent of Pagelet's normalized cache identity. */
    readonly bodyHash?: string;
    readonly inputEvidence?: PageletInputEvidence;
}

/** The existing web reuse lifetime applies until Chat first accepts this material. */
export function pageletChatHandoffSourceLifetimeIsCurrent(context: PageletChatHandoffContext, now = Date.now()): boolean {
    return !context.inputEvidence?.lineage.dependencies.some(dependency => dependency.kind === "web")
        || now - context.preparedAt < PAGELET_DEEP_DISCOVER_WEB_CACHE_TTL_MS;
}

export type PageletChatHandoffPreparationStatus =
    | "prepared"
    | "busy"
    | "draft-conflict"
    | "unavailable"
    | "invalid";

export interface PageletChatHandoffPreparationResult {
    status: PageletChatHandoffPreparationStatus;
}

export function createPageletChatHandoffContext(
    input: PageletChatHandoffContext,
): PageletChatHandoffContext {
    const context: PageletChatHandoffContext = {
        version: 1,
        id: requireString(input.id, "id"),
        body: requireString(input.body, "body"),
        anchor: freezeSnapshot(input.anchor, "anchor"),
        sources: Object.freeze(input.sources.map((source) => freezeSnapshot(source, "source"))),
        sourceRefs: Object.freeze(input.sourceRefs.map((sourceRef) => Object.freeze({
            path: requireString(sourceRef.path, "source reference path"),
            ...(typeof sourceRef.title === "string" && sourceRef.title.length > 0
                ? { title: sourceRef.title }
                : {}),
        }))),
        webUrls: Object.freeze(input.webUrls.map((url) => requireString(url, "web URL"))),
        whyNow: Object.freeze(input.whyNow.map((reason) => requireString(reason, "why-now reason"))),
        triggerReason: requireString(input.triggerReason, "trigger reason"),
        preparedAt: requireFiniteNumber(input.preparedAt, "prepared time"),
        pipelineVersion: requireString(input.pipelineVersion, "pipeline version"),
        ...(input.bodyHash ? { bodyHash: requireString(input.bodyHash, "body hash") } : {}),
        ...(input.inputEvidence ? { inputEvidence: clonePageletInputEvidence(input.inputEvidence) } : {}),
    };
    return Object.freeze(context);
}

/** Copy identity facts only; source snippets, tool logs and arbitrary metadata never cross this boundary. */
export function clonePageletInputEvidence(input: PageletInputEvidence): PageletInputEvidence {
    const sourceRecords = input.sourceRecords.map(record => {
        const safe = cloneSourceRecord(record);
        delete safe.snippet;
        delete safe.metadata;
        if (record.metadata?.sourceDependency === true) safe.metadata = { sourceDependency: true };
        return Object.freeze(safe);
    });
    const vaultObservations = input.vaultObservations.map(value => {
        const parsed = parseVaultObservationEvidence(value);
        if (!parsed.ok) throw new Error("Pagelet authoring observation is invalid.");
        return parsed.evidence;
    });
    return Object.freeze({
        lineage: cloneInputLineage(input.lineage) ?? unknownInputLineage(),
        sourceRecords: Object.freeze(sourceRecords),
        sourceSnapshots: Object.freeze(input.sourceSnapshots.map(source => freezeSnapshot(source, "input source"))),
        vaultObservations: Object.freeze(vaultObservations),
    });
}

function freezeSnapshot(
    input: PageletChatHandoffAnchorSnapshot | PageletChatHandoffSourceSnapshot,
    label: string,
): PageletChatHandoffSourceSnapshot {
    return Object.freeze({
        path: requireString(input.path, `${label} path`),
        mtime: requireFiniteNumber(input.mtime, `${label} mtime`),
        size: requireFiniteNumber(input.size, `${label} size`),
        contentHash: requireString(input.contentHash, `${label} content hash`),
    });
}

function requireString(value: unknown, label: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`Pagelet Chat handoff ${label} is required.`);
    }
    return value;
}

function requireFiniteNumber(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`Pagelet Chat handoff ${label} must be a finite number.`);
    }
    return value;
}

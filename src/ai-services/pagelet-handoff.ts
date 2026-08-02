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
    };
    return Object.freeze(context);
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

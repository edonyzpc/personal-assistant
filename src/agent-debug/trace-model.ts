import type { DebugEvent, DebugTracePage } from './types';

export interface TraceNode {
    id: string;
    event: DebugEvent;
    firstSeq: number;
    parentId?: string;
    children: string[];
    startMs?: number;
    endMs?: number;
    durationMs?: number;
    contentRoles: Map<string, DebugEvent['contentRole']>;
    searchMetadata: Set<string>;
    anomalies: { failed: number; retries: number; gaps: number };
    structureIssue: boolean;
}

export interface TraceModel {
    nodes: Map<string, TraceNode>;
    roots: string[];
    ordered: string[];
    extentMs?: number;
}

/** Persistent cursors never follow the live tail. Only a loaded canonical range replaces its overlay. */
export class TraceAccumulator {
    private persisted = new Map<number, DebugEvent>();
    private overlay = new Map<number, DebugEvent>();
    completedThrough = 0;

    apply(page: DebugTracePage, after: number): void {
        const loadedThrough = page.hasMore ? page.nextAfter : page.through;
        for (const event of page.events) this.persisted.set(event.seq, event);
        for (const [seq] of this.overlay) if (seq > after && seq <= loadedThrough) this.overlay.delete(seq);
        for (const event of page.liveEvents) {
            if (event.seq > loadedThrough && !this.persisted.has(event.seq)) this.overlay.set(event.seq, event);
        }
        if (!page.hasMore) this.completedThrough = page.through;
    }

    events(): DebugEvent[] {
        return [...this.persisted.values(), ...this.overlay.values()].sort((left, right) => left.seq - right.seq);
    }

    clear(): void { this.persisted.clear(); this.overlay.clear(); this.completedThrough = 0; }
}

export function projectDebugNodes(events: readonly DebugEvent[]): DebugEvent[] {
    const nodes = new Map<string, DebugEvent>();
    for (const event of events) {
        const earlier = nodes.get(event.nodeId);
        const defined = Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined));
        const node = earlier ? { ...earlier, ...defined,
            contentIds: [...new Set([...earlier.contentIds, ...event.contentIds])],
            details: { ...earlier.details, ...event.details },
        } as DebugEvent : { ...event, contentIds: [...event.contentIds] };
        const dispatch = node.details?.['timing.dispatch'];
        const consumerEnd = node.details?.['timing.consumer_end'];
        if (node.durationMs === undefined && finite(dispatch) && finite(consumerEnd) && consumerEnd >= dispatch) {
            node.durationMs = consumerEnd - dispatch;
        }
        nodes.set(event.nodeId, node);
    }
    return [...nodes.values()];
}

function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }

export function buildTraceModel(events: readonly DebugEvent[]): TraceModel {
    const merged = projectDebugNodes(events);
    const nodes = new Map<string, TraceNode>();
    for (const event of merged) nodes.set(event.nodeId, { id: event.nodeId, event, firstSeq: event.seq,
        parentId: event.parentId, children: [], contentRoles: new Map(), searchMetadata: new Set(),
        durationMs: finite(event.durationMs) ? event.durationMs : undefined,
        anomalies: { failed: 0, retries: 0, gaps: 0 }, structureIssue: false });
    let extentMs: number | undefined;
    for (const event of events) {
        const node = nodes.get(event.nodeId)!;
        node.firstSeq = Math.min(node.firstSeq, event.seq);
        // Later payloads may omit a tool name or change phase. Keep all names from the current factual event set.
        for (const value of [event.label, event.kind, event.nodeKind, event.errorSummary, event.details?.toolName, event.details?.purpose]) {
            if (typeof value === 'string' && value) node.searchMetadata.add(value);
        }
        for (const contentId of event.contentIds) if (event.contentRole) node.contentRoles.set(contentId, event.contentRole);
        if (finite(event.elapsedMs)) {
            extentMs = Math.max(extentMs ?? 0, event.elapsedMs);
            if (event.boundary === 'start' && node.startMs === undefined) node.startMs = event.elapsedMs;
            if (event.boundary === 'end') node.endMs = event.elapsedMs;
            if (event.boundary === 'instant') node.startMs = node.endMs = event.elapsedMs;
        }
    }
    const ordered = [...nodes.values()].sort((left, right) => left.firstSeq - right.firstSeq).map(node => node.id);
    const attached = new Set<string>();
    // Each parent chain is visited once. Corrupt cycles are cut without losing any observed node.
    for (const id of ordered) {
        const chain: string[] = [];
        const inChain = new Set<string>();
        let cursor: string | undefined = id;
        while (cursor && !attached.has(cursor)) {
            const node = nodes.get(cursor);
            if (!node) break;
            if (inChain.has(cursor)) {
                node.parentId = undefined;
                for (const member of chain) nodes.get(member)!.structureIssue = true;
                break;
            }
            chain.push(cursor); inChain.add(cursor);
            if (node.parentId && !nodes.has(node.parentId)) { node.structureIssue = true; node.parentId = undefined; }
            cursor = node.parentId;
        }
        for (const member of chain) attached.add(member);
    }
    const roots: string[] = [];
    for (const id of ordered) {
        const node = nodes.get(id)!;
        if (node.parentId) nodes.get(node.parentId)!.children.push(id); else roots.push(id);
        if (finite(node.startMs) && finite(node.endMs) && node.endMs >= node.startMs && node.durationMs === undefined) {
            node.durationMs = node.endMs - node.startMs;
        }
        if (node.endMs !== undefined && (node.startMs === undefined || node.endMs < node.startMs)) node.endMs = undefined;
        node.anomalies = {
            failed: node.event.status === 'failed' ? 1 : 0,
            retries: node.event.kind.includes('retry') || node.event.kind.includes('fallback') ? 1 : 0,
            gaps: node.structureIssue || ['capacity', 'unavailable', 'recovery_unverified'].includes(node.event.availability ?? '') ? 1 : 0,
        };
        // New captures store transport timing on the capture clock. Legacy timing remains observational only.
        if (node.event.elapsedMs !== undefined && (node.event.nodeKind === 'attempt' || node.event.attemptId)) {
            const dispatch = node.event.details?.['timing.dispatch'];
            const consumerEnd = node.event.details?.['timing.consumer_end'];
            if (finite(dispatch)) node.startMs = dispatch;
            if (finite(consumerEnd) && finite(node.startMs) && consumerEnd >= node.startMs) node.endMs = consumerEnd;
            if (finite(consumerEnd)) extentMs = Math.max(extentMs ?? 0, consumerEnd);
        }
    }
    for (const node of nodes.values()) {
        const attempts = node.children.filter(id => {
            const event = nodes.get(id)!.event;
            return event.nodeKind === 'attempt' || Boolean(event.attemptId);
        });
        for (const id of attempts.slice(1)) nodes.get(id)!.anomalies.retries = 1;
    }
    const postorder: string[] = [];
    const pending = [...roots];
    while (pending.length) { const id = pending.pop()!; postorder.push(id); pending.push(...nodes.get(id)!.children); }
    for (const id of postorder.reverse()) {
        const node = nodes.get(id)!;
        if (!node.parentId) continue;
        const parent = nodes.get(node.parentId)!;
        for (const key of ['failed', 'retries', 'gaps'] as const) parent.anomalies[key] += node.anomalies[key];
    }
    return { nodes, roots, ordered, extentMs };
}

export function traceAncestors(model: TraceModel, id?: string): string[] {
    const path: string[] = [];
    let cursor = id ? model.nodes.get(id) : undefined;
    while (cursor) { path.push(cursor.id); cursor = cursor.parentId ? model.nodes.get(cursor.parentId) : undefined; }
    return path;
}

export function focusNode(model: TraceModel): string | undefined {
    const running = model.ordered.filter(id => model.nodes.get(id)!.event.status === 'running');
    if (running.length) return running[running.length - 1];
    return model.ordered.find(id => model.nodes.get(id)!.event.status === 'failed' || model.nodes.get(id)!.structureIssue
        || ['capacity', 'unavailable', 'recovery_unverified'].includes(model.nodes.get(id)!.event.availability ?? ''))
        ?? model.ordered[model.ordered.length - 1];
}

export interface TraceRow { id: string; depth: number; match: boolean; expanded: boolean; }
export function visibleTraceRows(model: TraceModel, selectedId: string | undefined,
    overrides: ReadonlyMap<string, boolean>, query: string, displayTitle?: (event: DebugEvent) => string): { rows: TraceRow[]; matches: number } {
    const normalized = query.trim().toLocaleLowerCase();
    const matching = new Set<string>();
    const included = new Set<string>();
    if (normalized) for (const id of model.ordered) {
        const node = model.nodes.get(id)!;
        const metadata = [displayTitle?.(node.event), ...node.searchMetadata].filter(value => value !== undefined).join(' ').toLocaleLowerCase();
        if (metadata.includes(normalized)) {
            matching.add(id);
            for (const ancestor of traceAncestors(model, id)) included.add(ancestor);
        }
    }
    const focused = new Set(traceAncestors(model, selectedId ?? focusNode(model)));
    const rows: TraceRow[] = [];
    const pending = model.roots.map(id => ({ id, depth: 0 })).reverse();
    while (pending.length) {
        const item = pending.pop()!;
        if (normalized && !included.has(item.id)) continue;
        const node = model.nodes.get(item.id)!;
        const expanded = normalized ? true : overrides.get(item.id) ?? focused.has(item.id);
        rows.push({ ...item, expanded, match: matching.has(item.id) });
        if (expanded) for (const child of [...node.children].reverse()) pending.push({ id: child, depth: item.depth + 1 });
    }
    return { rows, matches: matching.size };
}

/** Unknown starts never become inferred intervals from a duration or wall clock. */
export function traceInterval(node: TraceNode, extentMs?: number): { left: number; width: number; running: boolean } | undefined {
    if (!finite(node.startMs) || !finite(extentMs) || extentMs === 0) return undefined;
    const running = node.endMs === undefined && node.event.status === 'running';
    const end = node.endMs ?? (running ? extentMs : undefined);
    if (end === undefined || end < node.startMs) return undefined;
    return { left: node.startMs / extentMs * 100, width: (end - node.startMs) / extentMs * 100, running };
}

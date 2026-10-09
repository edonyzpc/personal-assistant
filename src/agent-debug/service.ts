import type { AgentDebugNodeStatus, AgentDebugObservation, AgentDebugPort, AgentDebugRunRecorder, AgentDebugUsage } from '../ai-services/agent-debug-port';
import { agentDebugNow } from '../ai-services/agent-debug-observation';
import { getOptionalPlatformWindow, setPlatformTimeout, clearPlatformTimeout, type PlatformTimeoutHandle } from '../platform-dom';
import { AgentDebugCollector } from './collector';
import { AgentDebugStore, type AgentDebugStoreOptions } from './store';
import { cloneDebugLineage, debugBlockKey, filterDebugText, projectDebugAttachments, projectDebugRequest, projectDebugSession, splitDebugText, utf8Bytes } from './projection';
import { DEBUG_DOMAINS, DEFAULT_DEBUG_BUDGETS, type DebugBatch, type DebugBudgets, type DebugContent,
    type DebugDomain, type DebugEvent, type DebugEventQuery, type DebugGeneration, type DebugLineage, type DebugRun, type DebugRunQuery,
    type DebugSessionDetail, type DebugStoreStatus, type DebugTracePage, type DebugTraceQuery, type DebugUsage } from './types';

interface RunState {
    run: DebugRun;
    generation: DebugGeneration;
    seq: number;
    segment: number;
    contentAllowed: boolean;
    text: Map<string, string>;
    events: DebugEvent[];
    usage: Map<string, DebugUsage>;
    calls: Set<string>;
    dispatchedAt: Map<string, number>;
    unknownAttemptCost: boolean;
    startedMonotonic: number;
    discardedThrough: number;
    textCommitted: boolean;
    retired?: boolean;
    finished?: boolean;
}

export interface AgentDebugServiceOptions extends AgentDebugStoreOptions {
    enabled: () => boolean;
    store?: AgentDebugStore;
    /** Bootstrap adapters finish explicit deletion and Forget reconciliation before opening content. */
    recoveryReady?: boolean;
    /** Same monotonic clock as the observation/transport adapter. */
    monotonicNow?: () => number;
}

export class AgentDebugService implements AgentDebugPort {
    private readonly store: AgentDebugStore;
    private readonly budgets: DebugBudgets;
    private readonly collector: AgentDebugCollector;
    private readonly states = new Map<string, RunState>();
    private readonly volatileContents = new Map<string, DebugContent>();
    private volatileBytes = 0;
    private readonly volatileRunBytes = new Map<string, number>();
    private readonly listeners = new Set<(change?: { invalidated?: boolean }) => void>();
    private readonly blockedConversations = new Set<string>();
    private readonly pendingCleanups = new Set<string>();
    private visibilityEpoch = 0;
    private readonly now: () => number;
    private readonly monotonicNow: () => number;
    private generation: DebugGeneration = { generation: 0, domains: {}, quarantined: false };
    private recoveryReady: boolean;
    private available = false;
    private reason: string | undefined;
    private initialized: Promise<void> | undefined;
    private flushTimer: PlatformTimeoutHandle | undefined;
    private notificationTimer: PlatformTimeoutHandle | undefined;
    private flushTail: Promise<void> = Promise.resolve();
    private disposed = false;
    private enabledOverride: boolean | undefined;
    private lastEnabled: boolean;
    private idCounter = 0;
    private readonly ownerId = `debug-owner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    private channel: BroadcastChannel | undefined;
    private readonly liveOwners = new Set<string>();

    constructor(private readonly options: AgentDebugServiceOptions) {
        this.store = options.store ?? new AgentDebugStore(options);
        this.budgets = { ...DEFAULT_DEBUG_BUDGETS, ...options.budgets };
        this.collector = new AgentDebugCollector(this.budgets);
        this.now = options.now ?? Date.now;
        this.monotonicNow = options.monotonicNow ?? agentDebugNow;
        this.recoveryReady = options.recoveryReady ?? false;
        this.lastEnabled = options.enabled();
        const Channel = (getOptionalPlatformWindow() as (Window & { BroadcastChannel?: typeof BroadcastChannel }) | undefined)?.BroadcastChannel;
        if (Channel) {
            try {
                this.channel = new Channel('personal-assistant-agent-debug-control');
                this.channel.onmessage = (event: MessageEvent<unknown>) => {
                    if (!event.data || typeof event.data !== 'object') return;
                    const data = event.data as { type?: string; vaultKey?: string; ownerId?: string; pending?: boolean };
                    if (data.vaultKey !== this.options.vaultKey || data.ownerId === this.ownerId) return;
                    if (data.type === 'probe') this.channel?.postMessage({ type: 'alive', vaultKey: this.options.vaultKey, ownerId: this.ownerId });
                    if (data.type === 'alive' && typeof data.ownerId === 'string') this.liveOwners.add(data.ownerId);
                    if (data.type === 'changed') {
                        if (data.pending) this.pendingCleanups.add(`remote:${data.ownerId}`);
                        else this.pendingCleanups.delete(`remote:${data.ownerId}`);
                        this.invalidate(false);
                        void this.refreshGeneration().catch(() => undefined);
                    }
                };
            } catch { this.channel = undefined; }
        }
    }

    initialize(): Promise<void> {
        if (!this.initialized) this.initialized = (async () => {
            try {
                await this.store.initialize();
                const owners = await this.store.getOwners();
                if (owners.length && this.channel) {
                    this.liveOwners.clear(); this.channel.postMessage({ type: 'probe', vaultKey: this.options.vaultKey, ownerId: this.ownerId });
                    await new Promise<void>(resolve => setPlatformTimeout(resolve, 75));
                }
                await this.store.beginOwner(this.ownerId, [...this.liveOwners]);
                this.generation = await this.store.getGeneration();
                this.available = true; this.reason = undefined;
                await this.store.prune();
            } catch { this.available = false; this.reason = 'storage_unavailable'; }
            this.notify();
        })();
        return this.initialized;
    }

    enabled(): boolean {
        const enabled = !this.disposed && (this.enabledOverride ?? this.options.enabled());
        if (enabled !== this.lastEnabled) this.changeEnabled(enabled);
        return enabled;
    }

    setEnabled(enabled: boolean): void { this.enabledOverride = enabled; this.changeEnabled(enabled); }

    private changeEnabled(enabled: boolean): void {
        if (enabled === this.lastEnabled) return;
        this.lastEnabled = enabled;
        for (const state of this.states.values()) {
            if (state.finished) continue;
            state.segment++; state.text.clear(); state.run.collection = enabled ? 'partial' : 'stopped';
            state.run.status = enabled ? 'running' : 'unknown';
            state.run.endedAt = enabled ? undefined : this.now();
            state.run.expiresAt = this.now() + this.budgets.retentionMs;
            state.run.hasGap = true;
            if (!enabled && state.seq) this.collector.enqueueMetadata({ run: { ...state.run }, events: [], contents: [], generation: state.generation });
        }
        // Already admitted history may still flush after recording is turned off.
        this.notify(true);
        this.scheduleFlush();
    }

    setRecoveryReady(ready: boolean): void {
        if (!ready) this.visibilityEpoch++;
        this.recoveryReady = ready;
        this.notify(!ready);
    }

    startRun(input: { conversationId?: string; prompt: string; provider: string; model: string }): AgentDebugRunRecorder {
        const captureId = `debug-${this.now().toString(36)}-${(++this.idCounter).toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
        const startedAt = this.now();
            const state: RunState = {
            run: { vaultKey: this.options.vaultKey, captureId, ownerSessionId: this.ownerId, conversationId: input.conversationId,
                provider: input.provider, model: input.model, startedAt, updatedAt: startedAt,
                expiresAt: startedAt + this.budgets.retentionMs, status: 'running', collection: this.enabled() ? 'recording' : 'partial',
                eventCount: 0, accountedBytes: 0, lastCommittedSeq: 0, hasGap: !this.enabled(), contentVersion: 2 },
            generation: this.cloneGeneration(), seq: 0, segment: 0, contentAllowed: true,
            text: new Map(), events: [], usage: new Map(), calls: new Set(), dispatchedAt: new Map(), unknownAttemptCost: false,
            startedMonotonic: this.monotonicNow(),
            discardedThrough: 0, textCommitted: false,
        };
        if (this.states.size >= 128) {
            const oldest = [...this.states.entries()].find(([, candidate]) => candidate.finished);
            if (oldest) this.states.delete(oldest[0]);
            else return { captureId, enabled: () => false, bindRun: () => undefined, observe: () => undefined, finish: () => undefined };
        }
        this.states.set(captureId, state);
        // Lazy initialization is best effort and is never awaited by Agent execution.
        void this.initialize();
        if (this.enabled()) this.observe(state, { nodeId: captureId, kind: 'run', phase: 'received', boundary: 'start', status: 'queued',
            text: input.prompt, lineage: { domains: ['chat_history'], unknown: false } });
        return {
            captureId,
            enabled: () => !state.retired && this.enabled() && !this.blockedConversations.has(state.run.conversationId ?? ''),
            bindRun: (runtimeRunId) => { state.run.runtimeRunId = runtimeRunId; },
            observe: (event) => this.observe(state, event),
            finish: (status, error) => {
                if (state.retired) return;
                state.finished = true;
                if (!this.enabled()) { this.states.delete(captureId); this.notify(); return; }
                state.run.status = this.runStatus(status); state.run.endedAt = this.now();
                state.run.expiresAt = state.run.endedAt + this.budgets.retentionMs;
                state.run.collection = state.run.hasGap ? 'partial' : 'complete';
                this.observe(state, { nodeId: captureId, kind: 'run', phase: 'finished', boundary: 'end', status, error });
                this.collector.enqueueMetadata({ run: { ...state.run }, events: [], contents: [], generation: state.generation });
                void this.flush();
            },
        };
    }

    private cloneGeneration(): DebugGeneration {
        return { ...this.generation, domains: { ...this.generation.domains } };
    }

    private runStatus(status: AgentDebugNodeStatus): DebugRun['status'] {
        return ['completed', 'partial', 'failed', 'cancelled', 'interrupted', 'unknown'].includes(status)
            ? status as DebugRun['status'] : 'running';
    }

    private observe(state: RunState, observation: AgentDebugObservation): void {
        try {
            if (state.retired || !this.enabled() || this.blockedConversations.has(state.run.conversationId ?? '')) return;
            if (state.seq >= this.budgets.runEvents) { state.run.hasGap = true; return; }
            const timestamp = this.now();
            const elapsedMs = this.monotonicNow() - state.startedMonotonic;
            state.run.updatedAt = timestamp;
            if (observation.runtimeRunId) state.run.runtimeRunId = observation.runtimeRunId;
            if (observation.purpose === 'answer' && observation.provider) state.run.provider = observation.provider;
            if (observation.purpose === 'answer' && observation.model) state.run.model = observation.model;
            const event: DebugEvent = { vaultKey: this.options.vaultKey, captureId: state.run.captureId,
                seq: ++state.seq, segment: state.segment, nodeId: observation.nodeId, parentId: observation.parentId,
                turnId: observation.turnId, callId: observation.callId, attemptId: observation.attemptId,
                toolCallId: observation.toolCallId, timestamp, kind: observation.phase, status: observation.status,
                nodeKind: observation.kind, boundary: observation.boundary, contentRole: observation.contentRole,
                elapsedMs: Number.isFinite(elapsedMs) && elapsedMs >= 0 ? elapsedMs : undefined,
                label: filterDebugText(observation.toolName ?? observation.purpose ?? observation.phase).slice(0, 512), contentIds: [],
                durationMs: observation.durationMs };
            if (observation.error && state.contentAllowed && this.recoveryReady && !this.pendingCleanups.size) {
                event.errorSummary = filterDebugText([observation.error.name, observation.error.message]
                    .filter(value => typeof value === 'string').join(': ')).slice(0, 512) || undefined;
            }
            const details: NonNullable<DebugEvent['details']> = {};
            if (observation.purpose) details.purpose = observation.purpose;
            if (observation.provider) details.provider = filterDebugText(observation.provider).slice(0, 128);
            if (observation.model) details.model = filterDebugText(observation.model).slice(0, 128);
            if (observation.transport) details.transport = observation.transport;
            if (observation.outcome) details.outcome = filterDebugText(observation.outcome).slice(0, 256);
            if (observation.missingReason) details.missingReason = filterDebugText(observation.missingReason).slice(0, 256);
            if (observation.timing) {
                const relativeAt = observation.timing.at - state.startedMonotonic;
                details.timing = observation.timing.event;
                if (Number.isFinite(relativeAt) && relativeAt >= 0) {
                    details.at = relativeAt;
                    details[`timing.${observation.timing.event}`] = relativeAt;
                }
                if (observation.timing.event === 'dispatch') state.dispatchedAt.set(observation.nodeId, observation.timing.at);
                const dispatch = state.dispatchedAt.get(observation.nodeId);
                if (observation.timing.event === 'consumer_end' && dispatch !== undefined && observation.timing.at >= dispatch) {
                    event.durationMs = observation.timing.at - dispatch;
                }
            }
            if (Object.keys(details).length) event.details = details;
            if (observation.kind === 'llm') state.calls.add(observation.callId ?? observation.nodeId);
            if (observation.kind === 'attempt' && ['partial', 'failed', 'cancelled', 'unknown'].includes(observation.status ?? '')) {
                state.unknownAttemptCost = true;
            }
            if (observation.usage) {
                const callId = observation.callId ?? observation.nodeId;
                const purpose = observation.purpose ?? 'unknown';
                const usageKey = observation.attemptId
                    ? `physical:${purpose}:${callId}:${observation.attemptId}:${observation.usage.updateKey ?? 'usage'}`
                    : `logical:${purpose}:${callId}:${observation.usage.updateKey ?? 'usage'}`;
                const value = this.usage(observation.usage);
                const previous = state.usage.get(usageKey);
                const next = observation.usage.aggregation === 'delta' && previous ? this.sumUsage([previous, value]) : value;
                state.usage.set(usageKey, next); event.usage = next;
                const physical = [...state.usage].filter(([key]) => key.startsWith('physical:')).map(([, usage]) => usage);
                const logical = [...state.usage].filter(([key]) => key.startsWith('logical:')).map(([, usage]) => usage);
                state.run.physicalUsage = physical.length ? this.sumUsage(physical) : undefined;
                state.run.logicalUsage = logical.length ? this.sumUsage(logical) : undefined;
                // A logical total can overlap physical attempts; display one lane only.
                state.run.usage = state.run.physicalUsage ?? state.run.logicalUsage;
            }
            if (state.run.usage) state.run.usage.complete = state.run.usage.complete
                && !state.unknownAttemptCost
                && !(state.run.physicalUsage && state.run.logicalUsage)
                && [...state.calls].every(callId => [...state.usage.keys()]
                    .some(usageKey => usageKey.includes(`:${callId}:`)));
            const contents: DebugContent[] = [];
            let lineage: DebugLineage | undefined;
            const addContent = (kind: DebugContent['kind'], text: string, redactions: string[] = [], reusableSlot?: number): void => {
                if (!state.contentAllowed || !this.recoveryReady || this.pendingCleanups.size > 0) {
                    event.availability = this.recoveryReady ? 'capacity' : 'recovery_unverified'; state.run.hasGap = true; return;
                }
                // Only observations with admitted content need a lineage projection.
                // Ordinary path changes no longer revoke Debug history. Source facts stay in
                // actual input/tool text; only explicit Forget/deletion associations live here.
                lineage ??= cloneDebugLineage(observation.lineage ? {
                        claimIds: [...observation.lineage.claimIds ?? []],
                        legacyRecordIds: [...observation.lineage.legacyRecordIds ?? []], possibleDomains: [...observation.lineage.domains ?? DEBUG_DOMAINS],
                        completeness: observation.lineage.unknown === false ? 'known' : 'unknown',
                        conversationIds: state.run.conversationId ? [state.run.conversationId] : [],
                } : undefined);
                const contentLineage = lineage;
                splitDebugText(text, this.budgets.contentBytes).forEach((part, index) => {
                    const bytes = utf8Bytes(part) + 256;
                    const contentId = reusableSlot === undefined ? `${observation.nodeId}:${kind}:${state.segment}:${event.seq}:${index}`
                        : `prompt:${state.segment}:${reusableSlot}:${index}:${debugBlockKey(part)}`;
                    contents.push({ vaultKey: this.options.vaultKey, captureId: state.run.captureId, contentId,
                        kind, contentRole: kind === 'tool_output' ? observation.contentRole : undefined,
                        text: part, redactions, lineage: contentLineage, generation: state.generation.generation,
                        domainGenerations: { ...state.generation.domains }, accountedBytes: bytes });
                    event.contentIds.push(contentId); state.run.accountedBytes += bytes;
                });
            };
            if (state.contentAllowed && this.recoveryReady && observation.prompt !== undefined) {
                const projected = projectDebugRequest(observation.prompt, this.budgets.runBytes, false);
                if (projected.parts) projected.parts.forEach((part, index) => addContent('prompt', `${index ? '\n\n' : ''}${part}`, projected.redactions, index));
                else if (projected.text !== undefined) addContent('prompt', projected.text, projected.redactions, 0);
                else { event.availability = projected.reason === 'capacity' ? 'capacity' : 'unavailable'; state.run.hasGap = true; }
            }
            if (state.contentAllowed && this.recoveryReady && observation.text !== undefined) {
                // Delta chunks are immutable blocks; no ever-growing transcript is copied on each token.
                const projected = projectDebugSession(observation.text, this.budgets.runBytes);
                if (projected.text !== undefined) addContent(observation.kind === 'run' && observation.phase === 'received' ? 'input' : 'output', projected.text);
                else { event.availability = 'capacity'; state.run.hasGap = true; }
            }
            if (state.contentAllowed && this.recoveryReady && observation.error) {
                const projected = projectDebugSession({ name: observation.error.name, message: observation.error.message,
                    code: observation.error.code, stack: observation.error.stack }, this.budgets.runBytes);
                if (projected.text) addContent('error', projected.text, projected.redactions);
            }
            if (state.contentAllowed && this.recoveryReady && observation.attachments?.length) {
                const projected = projectDebugAttachments(observation.attachments);
                if (projected.text) addContent('attachment', projected.text, projected.redactions);
            }
            for (const [kind, value] of [['reasoning', observation.reasoning], ['tool_input', observation.toolInput], ['tool_output', observation.toolOutput]] as const) {
                if (value === undefined) continue;
                const projected = projectDebugSession(value, this.budgets.runBytes);
                if (projected.text !== undefined) addContent(kind, projected.text, projected.redactions);
                else { event.availability = projected.reason === 'capacity' ? 'capacity' : 'unavailable'; state.run.hasGap = true; }
            }
            state.events.push(event);
            if (state.events.length > 500) {
                const count = state.events.length - 500;
                state.discardedThrough = state.events[count - 1].seq;
                state.events.splice(0, count);
            }
            state.run.eventCount = state.seq;
            const batch: DebugBatch = { run: { ...state.run }, events: [event], contents, generation: state.generation };
            if (!this.collector.enqueue(batch)) {
                state.run.hasGap = true; state.run.collection = 'partial';
                event.contentIds = []; event.availability = 'capacity';
                this.collector.enqueueMetadata({ run: { ...state.run }, events: [], contents: [], generation: state.generation });
            } else {
                if (!this.available) contents.forEach(content => this.cacheContent(content));
                // Start the existing writer before a ready buffered response fills its pending budget.
                if (this.collector.pendingByteLength >= this.budgets.queueBytes / 2 || this.collector.pendingSize >= this.budgets.queueEvents / 2) void this.flush();
            }
            this.scheduleFlush(); this.notify();
        } catch { state.run.hasGap = true; }
    }

    private usage(value: AgentDebugUsage): DebugUsage {
        const valid = (number: number | undefined): number | undefined => typeof number === 'number' && Number.isFinite(number) && number >= 0 ? number : undefined;
        const input = valid(value.inputTokens), output = valid(value.outputTokens), total = valid(value.totalTokens);
        return { input, output, total, cachedInput: valid(value.cacheReadTokens), reasoning: valid(value.reasoningTokens),
            complete: value.complete ?? (total !== undefined || input !== undefined && output !== undefined) };
    }

    private cacheContent(content: DebugContent): void {
        const id = `${content.captureId}:${content.contentId}`;
        const previous = this.volatileContents.get(id);
        if (previous) {
            this.volatileBytes -= previous.accountedBytes;
            this.volatileRunBytes.set(content.captureId, (this.volatileRunBytes.get(content.captureId) ?? 0) - previous.accountedBytes);
        }
        this.volatileContents.set(id, content);
        this.volatileBytes += content.accountedBytes;
        this.volatileRunBytes.set(content.captureId, (this.volatileRunBytes.get(content.captureId) ?? 0) + content.accountedBytes);
        while (this.volatileBytes > this.budgets.sessionBytes || (this.volatileRunBytes.get(content.captureId) ?? 0) > this.budgets.sessionRunBytes) {
            const candidate = this.volatileBytes > this.budgets.sessionBytes ? this.volatileContents.entries().next().value
                : [...this.volatileContents.entries()].find(([, entry]) => entry.captureId === content.captureId);
            if (!candidate) break;
            const [id, entry] = candidate;
            this.volatileContents.delete(id); this.volatileBytes -= entry.accountedBytes;
            this.volatileRunBytes.set(entry.captureId, (this.volatileRunBytes.get(entry.captureId) ?? 0) - entry.accountedBytes);
        }
    }
    private sumUsage(values: DebugUsage[]): DebugUsage {
        const sum = (field: keyof DebugUsage): number | undefined => {
            const known = values.map(value => value[field]).filter((value): value is number => typeof value === 'number');
            return known.length ? known.reduce((total, value) => total + value, 0) : undefined;
        };
        return { input: sum('input'), output: sum('output'), total: sum('total'), cachedInput: sum('cachedInput'),
            reasoning: sum('reasoning'), complete: values.every(value => value.complete) };
    }

    recordTextCommitted(runtimeRunId: string): void {
        const state = [...this.states.values()].find(candidate => candidate.run.runtimeRunId === runtimeRunId);
        if (!state || state.textCommitted) return;
        const nodeId = `${state.run.captureId}:first-chat-text-committed`;
        this.observe(state, { nodeId, parentId: state.run.captureId, kind: 'phase', phase: 'first_chat_text_committed',
            boundary: 'instant', status: 'completed' });
        if (state.events.some(event => event.nodeId === nodeId)) state.textCommitted = true;
    }

    private scheduleFlush(): void {
        if (this.flushTimer !== undefined) return;
        this.flushTimer = setPlatformTimeout(() => { this.flushTimer = undefined; void this.flush(); }, this.budgets.flushMs);
    }

    flush(): Promise<void> {
        if (this.flushTimer !== undefined) { clearPlatformTimeout(this.flushTimer); this.flushTimer = undefined; }
        const batches = this.collector.drain();
        if (!batches.length) return this.flushTail;
        const task = this.flushTail.then(async () => {
            await this.initialize();
            if (!this.available) return;
            const grouped = new Map<string, DebugBatch>();
            for (const batch of batches) {
                const groupId = `${batch.run.captureId}:${batch.generation.generation}`;
                const previous = grouped.get(groupId);
                if (previous) { previous.run = batch.run; previous.events.push(...batch.events); previous.contents.push(...batch.contents); }
                else grouped.set(groupId, { ...batch, events: [...batch.events], contents: [...batch.contents] });
            }
            for (const batch of grouped.values()) {
                try {
                    const accepted = await this.store.writeBatch(batch);
                    if (!accepted) { const state = this.states.get(batch.run.captureId); if (state) state.run.hasGap = true; }
                    else {
                        const saved = await this.store.getRun(batch.run.captureId);
                        const current = this.states.get(batch.run.captureId);
                        if (saved && current) {
                            current.run.accountedBytes = saved.accountedBytes; current.run.lastCommittedSeq = saved.lastCommittedSeq;
                            current.run.hasGap ||= saved.hasGap;
                            if (current.run.hasGap && current.run.collection === 'complete') current.run.collection = 'partial';
                        }
                    }
                } catch { this.reason = 'storage_write_failed'; const state = this.states.get(batch.run.captureId); if (state) state.run.hasGap = true; }
            }
            this.notify();
        });
        this.flushTail = task.catch(() => undefined).finally(() => this.collector.release(batches));
        return this.flushTail;
    }

    async listRuns(query: DebugRunQuery = {}): Promise<DebugRun[]> {
        await this.initialize();
        const persisted = this.available ? await this.store.listRuns(query).catch(() => []) : [];
        const result = new Map(persisted.map(run => [run.captureId, run]));
        for (const state of this.states.values()) {
            const run = state.run;
            if (state.seq && run.expiresAt > this.now() && (!query.before || run.startedAt < query.before)
                && (!query.status || run.status === query.status) && (!query.conversationId || run.conversationId === query.conversationId)
                && !this.blockedConversations.has(run.conversationId ?? '')) result.set(run.captureId, { ...run });
        }
        return [...result.values()].sort((left, right) => right.startedAt - left.startedAt).slice(0, query.limit ?? 50);
    }

    async getEvents(captureId: string, query: DebugEventQuery = {}): Promise<DebugEvent[]> {
        const epoch = this.visibilityEpoch;
        await this.initialize();
        const state = this.states.get(captureId);
        if (state && this.blockedConversations.has(state.run.conversationId ?? '')) return [];
        const stored = this.available ? await this.store.getEvents(captureId, query).catch(() => []) : [];
        if (epoch !== this.visibilityEpoch || this.disposed || this.pendingCleanups.size
            || state && state.run.expiresAt <= this.now()) return [];
        const events = new Map(stored.map(event => [event.seq, event]));
        for (const event of state?.events ?? []) if (event.seq > (query.after ?? -1)) events.set(event.seq, event);
        return [...events.values()].sort((left, right) => left.seq - right.seq).slice(0, query.limit ?? 200);
    }

    async getTracePage(captureId: string, query: DebugTraceQuery = {}): Promise<DebugTracePage> {
        const empty = (availability: DebugTracePage['availability'], reason?: string): DebugTracePage => ({
            events: [], liveEvents: [], through: 0, nextAfter: 0, hasMore: false, run: null, availability, reason,
        });
        const epoch = this.visibilityEpoch;
        await this.initialize();
        if (this.disposed || epoch !== this.visibilityEpoch || this.pendingCleanups.size) return empty('cleared');
        if (!this.recoveryReady || this.generation.quarantined) return empty('unavailable', 'recovery_unverified');
        const state = this.states.get(captureId);
        if (state && (state.run.expiresAt <= this.now() || this.blockedConversations.has(state.run.conversationId ?? ''))) return empty('cleared');
        const visible = (): boolean => !this.disposed && epoch === this.visibilityEpoch && this.recoveryReady
            && !this.pendingCleanups.size && (!state || state.run.expiresAt > this.now()
                && !this.blockedConversations.has(state.run.conversationId ?? ''));
        let page: DebugTracePage;
        if (this.available) {
            try { page = await this.store.getTracePage(captureId, query); }
            catch { return visible() ? empty('unavailable', 'storage_read_failed') : empty('cleared'); }
            if (!visible() || page.run && page.run.expiresAt <= this.now()) return empty('cleared');
            // A missing previously committed run was deleted, expired or pruned. The
            // live tail cannot resurrect it. A not-yet-committed run has H=0.
            if (!page.run && (!state || state.run.lastCommittedSeq > 0)) return page;
        } else {
            if (!visible()) return empty('cleared');
            if (!state?.seq) return empty('unavailable', this.reason ?? 'storage_unavailable');
            page = empty('partial', state.events[0]?.seq > 1 ? 'session_tail_incomplete' : this.reason ?? 'storage_unavailable');
        }
        if (!state) return page;
        // This is an actual live-window eviction, not a gap inferred from
        // sparse persistent sequence numbers. A later commit fills this range.
        const persistencePending = this.available && state.discardedThrough > (page.run?.lastCommittedSeq ?? 0);
        return { ...page, liveEvents: [...state.events],
            run: { ...state.run, hasGap: state.run.hasGap || !!page.run?.hasGap,
                lastCommittedSeq: page.run?.lastCommittedSeq ?? 0 },
            availability: persistencePending ? 'partial' : page.availability === 'cleared' ? state.run.hasGap ? 'partial' : 'available'
                : page.availability === 'available' && state.run.hasGap ? 'partial' : page.availability,
            reason: persistencePending ? 'persistence_pending' : page.reason };
    }

    async getContents(captureId: string, nodeId?: string): Promise<DebugContent[]> {
        if (!this.recoveryReady || this.pendingCleanups.size > 0) return [];
        const epoch = this.visibilityEpoch;
        const state = this.states.get(captureId);
        if (state && this.blockedConversations.has(state.run.conversationId ?? '')) return [];
        await this.flush();
        if (this.available) {
            const visible = (): boolean => epoch === this.visibilityEpoch && !this.disposed && this.recoveryReady
                && !this.pendingCleanups.size && (!state || state.run.expiresAt > this.now());
            try {
                const result = await this.store.getContents(captureId, nodeId);
                return visible() ? result : [];
            } catch {
                if (!visible()) return [];
                throw new Error('storage_read_failed');
            }
        }
        if (epoch !== this.visibilityEpoch || this.disposed || !this.recoveryReady || this.pendingCleanups.size > 0
            || state && state.run.expiresAt <= this.now()) return [];
        const ids = nodeId ? new Set(state?.events.filter(event => event.nodeId === nodeId).flatMap(event => event.contentIds)) : undefined;
        return [...this.volatileContents.values()].filter(content => content.captureId === captureId
            && (!ids || ids.has(content.contentId))).map(content => ({ ...content }));
    }

    getSessionDetails(_captureId: string, _nodeId: string): DebugSessionDetail[] { return []; }

    async getStatus(): Promise<DebugStoreStatus> {
        await this.initialize();
        await this.refreshGeneration().catch(() => undefined);
        if (this.available) {
            const status = await this.store.status().catch(() => undefined);
            if (status) return { ...status, recoveryReady: this.recoveryReady && !this.pendingCleanups.size && status.recoveryReady, reason: this.reason };
        }
        return { available: false, recoveryReady: this.recoveryReady, bytes: 0, limit: this.budgets.persistentBytes, reason: this.reason };
    }

    subscribe(listener: (change?: { invalidated?: boolean }) => void): () => void {
        this.listeners.add(listener); return () => { this.listeners.delete(listener); };
    }
    private notify(invalidated = false, broadcast = true): void {
        if (this.disposed) return;
        if (invalidated) {
            if (broadcast) this.channel?.postMessage({ type: 'changed', vaultKey: this.options.vaultKey, ownerId: this.ownerId, pending: this.pendingCleanups.size > 0 });
            for (const listener of this.listeners) { try { listener({ invalidated: true }); } catch { /* Isolate view. */ } }
            return;
        }
        if (this.notificationTimer !== undefined || !this.listeners.size) return;
        this.notificationTimer = setPlatformTimeout(() => {
            this.notificationTimer = undefined;
            for (const listener of this.listeners) { try { listener(); } catch { /* Isolate view. */ } }
        }, 100);
    }

    private invalidate(broadcast = true): void {
        this.visibilityEpoch++;
        this.collector.clear(); this.volatileContents.clear(); this.volatileRunBytes.clear(); this.volatileBytes = 0;
        for (const state of this.states.values()) {
            state.contentAllowed = false; state.segment++; state.text.clear();
            state.events = state.events.map(event => ({ ...event, contentIds: [], label: undefined, details: undefined, errorSummary: undefined, availability: 'cleared' }));
            state.run.hasGap = true;
        }
        this.notify(true, broadcast);
    }

    blockConversation(conversationId: string): void {
        this.blockedConversations.add(conversationId); this.invalidate();
    }
    unblockConversation(conversationId: string): void { this.blockedConversations.delete(conversationId); this.notify(); }

    async invalidateConversation(conversationId: string, options: { runIds?: string[]; operationId?: string; before?: number; permanent?: boolean } = {}): Promise<void> {
        const cleanupId = `conversation:${conversationId}`;
        this.pendingCleanups.add(cleanupId);
        this.blockConversation(conversationId);
        await this.flushTail;
        await this.store.invalidateConversation(conversationId, options);
        for (const [id, state] of this.states) if (state.run.conversationId === conversationId
            && (options.runIds?.length ? options.runIds.includes(state.run.runtimeRunId ?? '') : options.permanent || state.run.startedAt <= (options.before ?? this.now()))) {
            state.retired = true; this.states.delete(id);
        }
        this.generation = await this.store.getGeneration();
        this.pendingCleanups.delete(cleanupId);
        this.blockedConversations.delete(conversationId);
        this.notify(true);
    }

    async clearHistory(): Promise<void> {
        this.pendingCleanups.add('clear');
        this.invalidate(); await this.flushTail; await this.store.clear();
        this.generation = await this.store.getGeneration();
        this.reason = undefined;
        this.pendingCleanups.delete('clear');
        this.resetLiveSegments(); this.notify(true);
    }
    clear(): Promise<void> { return this.clearHistory(); }
    async forgetClaim(claimId: string, options: { deviceWide?: boolean; domains?: readonly DebugDomain[] } = {}): Promise<void> {
        const cleanupId = `claim:${options.deviceWide ? '*' : this.options.vaultKey}:${claimId}`; this.pendingCleanups.add(cleanupId);
        this.invalidate(); await this.flushTail; await this.store.forgetClaim(claimId, options);
        this.generation = await this.store.getGeneration(); this.pendingCleanups.delete(cleanupId); this.notify(true);
    }
    async forgetLegacyRecord(recordId: string): Promise<void> {
        const cleanupId = `legacy:${recordId}`; this.pendingCleanups.add(cleanupId);
        this.invalidate(); await this.flushTail; await this.store.forgetLegacyRecord(recordId);
        this.generation = await this.store.getGeneration(); this.pendingCleanups.delete(cleanupId); this.notify(true);
    }
    async refreshGeneration(): Promise<void> {
        await this.initialize();
        if (!this.available) return;
        const current = await this.store.getGeneration();
        if (JSON.stringify(current) !== JSON.stringify(this.generation)) {
            const cleared = current.generation !== this.generation.generation;
            this.invalidate(false); this.generation = current;
            if (cleared) this.resetLiveSegments();
            for (const [id, state] of this.states) {
                if (!await this.store.isRunAllowed(state.run)) { state.retired = true; this.states.delete(id); }
                else state.generation = this.cloneGeneration();
            }
            this.notify(true, false);
        }
    }
    private resetLiveSegments(): void {
        for (const [id, state] of this.states) {
            if (state.finished) { state.retired = true; this.states.delete(id); continue; }
            state.events = []; state.usage.clear(); state.calls.clear(); state.dispatchedAt.clear(); state.unknownAttemptCost = false;
            state.discardedThrough = 0;
            state.seq = 0;
            state.generation = this.cloneGeneration(); state.contentAllowed = false;
            state.run = { ...state.run, usage: undefined, eventCount: 0, accountedBytes: 0, lastCommittedSeq: 0,
                collection: 'partial', hasGap: true, updatedAt: this.now() };
        }
    }
    async quarantineUnverified(): Promise<void> { this.setRecoveryReady(false); this.invalidate(); await this.store.setQuarantined(true); }
    async confirmRecovery(): Promise<void> { await this.store.setQuarantined(false); this.generation = await this.store.getGeneration(); this.notify(true); }

    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true; this.volatileContents.clear(); this.listeners.clear();
        if (this.notificationTimer !== undefined) clearPlatformTimeout(this.notificationTimer);
        if (this.flushTimer !== undefined) clearPlatformTimeout(this.flushTimer);
        let timer: PlatformTimeoutHandle | undefined;
        const clean = await Promise.race([this.flush().then(() => true), new Promise<boolean>(resolve => {
            timer = setPlatformTimeout(() => resolve(false), 500);
        })]);
        if (timer !== undefined) clearPlatformTimeout(timer);
        if (clean && this.available && this.recoveryReady && !this.generation.quarantined) await this.store.endOwner(this.ownerId).catch(() => undefined);
        this.states.clear(); this.store.close();
        this.channel?.close(); this.channel = undefined;
    }
}

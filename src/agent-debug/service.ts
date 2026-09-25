import type { AgentDebugNodeStatus, AgentDebugObservation, AgentDebugPort, AgentDebugRunRecorder, AgentDebugUsage } from '../ai-services/agent-debug-port';
import { getOptionalPlatformWindow, setPlatformTimeout, clearPlatformTimeout, type PlatformTimeoutHandle } from '../platform-dom';
import { AgentDebugCollector } from './collector';
import { AgentDebugStore, type AgentDebugStoreOptions } from './store';
import { cloneDebugLineage, debugBlockKey, filterDebugText, projectDebugAttachments, projectDebugRequest, projectDebugSession, utf8Bytes } from './projection';
import { DEBUG_DOMAINS, DEFAULT_DEBUG_BUDGETS, type DebugBatch, type DebugBudgets, type DebugContent,
    type DebugDomain, type DebugEvent, type DebugEventQuery, type DebugGeneration, type DebugRun, type DebugRunQuery,
    type DebugSessionDetail, type DebugStoreStatus, type DebugUsage } from './types';

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
    retired?: boolean;
    finished?: boolean;
}

export interface AgentDebugServiceOptions extends AgentDebugStoreOptions {
    enabled: () => boolean;
    store?: AgentDebugStore;
    /** Bootstrap adapters finish outbox and source/Memory reconciliation before opening content. */
    recoveryReady?: boolean;
}

export class AgentDebugService implements AgentDebugPort {
    private readonly store: AgentDebugStore;
    private readonly budgets: DebugBudgets;
    private readonly collector: AgentDebugCollector;
    private readonly states = new Map<string, RunState>();
    private readonly sessions = new Map<string, DebugSessionDetail>();
    private readonly volatileContents = new Map<string, DebugContent>();
    private volatileBytes = 0;
    private readonly volatileRunBytes = new Map<string, number>();
    private readonly listeners = new Set<(change?: { invalidated?: boolean }) => void>();
    private readonly blockedConversations = new Set<string>();
    private readonly pendingCleanups = new Set<string>();
    private visibilityEpoch = 0;
    private readonly now: () => number;
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
                const unverified = await this.store.beginOwner(this.ownerId, [...this.liveOwners]);
                this.generation = await this.store.getGeneration();
                this.available = true; this.reason = unverified ? 'recovery_unverified' : undefined;
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
        this.sessions.clear();
        for (const state of this.states.values()) {
            if (state.finished) continue;
            state.segment++; state.text.clear(); state.run.collection = enabled ? 'partial' : 'stopped';
            state.run.status = enabled ? 'running' : 'unknown';
            state.run.endedAt = enabled ? undefined : this.now();
            state.run.expiresAt = this.now() + this.budgets.retentionMs;
            state.run.hasGap = true;
            if (!enabled && state.seq) this.collector.enqueueMetadata({ run: { ...state.run }, events: [], contents: [], generation: state.generation });
        }
        // Already filtered, admitted history may still flush; transient detail never does.
        this.notify(true);
        this.scheduleFlush();
    }

    setRecoveryReady(ready: boolean): void {
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
                eventCount: 0, accountedBytes: 0, lastCommittedSeq: 0, hasGap: !this.enabled() },
            generation: this.cloneGeneration(), seq: 0, segment: 0, contentAllowed: true,
            text: new Map(), events: [], usage: new Map(), calls: new Set(), dispatchedAt: new Map(), unknownAttemptCost: false,
        };
        if (this.states.size >= 128) {
            const oldest = [...this.states.entries()].find(([, candidate]) => candidate.finished);
            if (oldest) this.states.delete(oldest[0]);
            else return { captureId, enabled: () => false, bindRun: () => undefined, observe: () => undefined, finish: () => undefined };
        }
        this.states.set(captureId, state);
        // Lazy initialization is best effort and is never awaited by Agent execution.
        void this.initialize();
        if (this.enabled()) this.observe(state, { nodeId: captureId, kind: 'run', phase: 'received', status: 'queued',
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
                this.observe(state, { nodeId: captureId, kind: 'run', phase: 'finished', status, error });
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
            state.run.updatedAt = timestamp;
            if (observation.runtimeRunId) state.run.runtimeRunId = observation.runtimeRunId;
            if (observation.purpose === 'answer' && observation.provider) state.run.provider = observation.provider;
            if (observation.purpose === 'answer' && observation.model) state.run.model = observation.model;
            const event: DebugEvent = { vaultKey: this.options.vaultKey, captureId: state.run.captureId,
                seq: ++state.seq, segment: state.segment, nodeId: observation.nodeId, parentId: observation.parentId,
                turnId: observation.turnId, callId: observation.callId, attemptId: observation.attemptId,
                toolCallId: observation.toolCallId, timestamp, kind: observation.phase, status: observation.status,
                label: observation.toolName ?? observation.purpose ?? observation.phase, contentIds: [] };
            const details: NonNullable<DebugEvent['details']> = {};
            if (observation.purpose) details.purpose = observation.purpose;
            if (observation.provider) details.provider = filterDebugText(observation.provider).slice(0, 128);
            if (observation.model) details.model = filterDebugText(observation.model).slice(0, 128);
            if (observation.transport) details.transport = observation.transport;
            if (observation.outcome) details.outcome = filterDebugText(observation.outcome).slice(0, 256);
            if (observation.missingReason) details.missingReason = filterDebugText(observation.missingReason).slice(0, 256);
            if (observation.timing) {
                details.timing = observation.timing.event; details.at = observation.timing.at;
                details[`timing.${observation.timing.event}`] = observation.timing.at;
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
            const lineage = cloneDebugLineage(observation.lineage ? {
                sourceRefs: [...observation.lineage.sourcePaths ?? []], claimIds: [...observation.lineage.claimIds ?? []],
                legacyRecordIds: [...observation.lineage.legacyRecordIds ?? []], possibleDomains: [...observation.lineage.domains ?? DEBUG_DOMAINS],
                completeness: observation.lineage.unknown === false ? 'known' : 'unknown',
                conversationIds: state.run.conversationId ? [state.run.conversationId] : [],
            } : undefined);
            const addContent = (kind: DebugContent['kind'], text: string, redactions: string[] = [], reusableSlot?: number): void => {
                const bytes = utf8Bytes(text) + 256;
                if (!state.contentAllowed || !this.recoveryReady || this.pendingCleanups.size > 0 || bytes > this.budgets.contentBytes
                    ) {
                    event.availability = this.recoveryReady ? 'capacity' : 'recovery_unverified'; state.run.hasGap = true; return;
                }
                const contentId = reusableSlot === undefined ? `${observation.nodeId}:${kind}:${state.segment}:${event.seq}`
                    : `prompt:${state.segment}:${reusableSlot}:${debugBlockKey(text + JSON.stringify(lineage))}`;
                contents.push({ vaultKey: this.options.vaultKey, captureId: state.run.captureId, contentId,
                    kind, text, redactions, lineage, generation: state.generation.generation,
                    domainGenerations: { ...state.generation.domains }, accountedBytes: bytes });
                event.contentIds.push(contentId); state.run.accountedBytes += bytes;
                this.cacheContent(contents[contents.length - 1]);
            };
            if (state.contentAllowed && this.recoveryReady && observation.prompt !== undefined) {
                const projected = projectDebugRequest(observation.prompt, this.budgets.requestBytes, false);
                if (projected.parts) projected.parts.forEach((part, index) => addContent('prompt', part, projected.redactions, index));
                else if (projected.text !== undefined) addContent('prompt', projected.text, projected.redactions, 0);
                else { event.availability = projected.reason === 'capacity' ? 'capacity' : 'unavailable'; state.run.hasGap = true; }
            }
            if (state.contentAllowed && this.recoveryReady && observation.text !== undefined) {
                // Delta chunks are immutable blocks; no ever-growing transcript is copied on each token.
                const projected = projectDebugSession(observation.text, this.budgets.contentBytes);
                if (projected.text !== undefined) addContent(observation.kind === 'run' && observation.phase === 'received' ? 'input' : 'output', projected.text);
                else { event.availability = 'capacity'; state.run.hasGap = true; }
            }
            if (state.contentAllowed && this.recoveryReady && observation.error) {
                const projected = projectDebugSession({ name: observation.error.name, message: observation.error.message,
                    code: observation.error.code, stack: observation.error.stack }, this.budgets.contentBytes);
                if (projected.text) addContent('error', projected.text, projected.redactions);
            }
            if (state.contentAllowed && this.recoveryReady && observation.attachments?.length) {
                const projected = projectDebugAttachments(observation.attachments);
                if (projected.text) addContent('attachment', projected.text, projected.redactions);
            }
            if (observation.reasoning !== undefined) this.addSession(state, observation.nodeId, 'reasoning', observation.reasoning, true);
            if (observation.toolInput !== undefined) this.addSession(state, observation.nodeId, 'tool_input', observation.toolInput);
            if (observation.toolOutput !== undefined) this.addSession(state, observation.nodeId, 'tool_output', observation.toolOutput);
            state.events.push(event);
            if (state.events.length > 500) state.events.splice(0, state.events.length - 500);
            state.run.eventCount = state.seq;
            const batch: DebugBatch = { run: { ...state.run }, events: [event], contents, generation: state.generation };
            if (!this.collector.enqueue(batch)) { state.run.hasGap = true; state.run.collection = 'partial'; }
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

    private addSession(state: RunState, nodeId: string, kind: DebugSessionDetail['kind'], value: unknown, append = false): void {
        if (!state.contentAllowed || !this.recoveryReady || this.pendingCleanups.size > 0 || this.generation.quarantined) return;
        const projected = projectDebugSession(value, this.budgets.sessionRunBytes);
        if (!projected.text) return;
        const id = `${state.run.captureId}:${nodeId}:${kind}`;
        const text = append ? (this.sessions.get(id)?.text ?? '') + projected.text : projected.text;
        if (utf8Bytes(text) > this.budgets.sessionRunBytes) return;
        this.sessions.delete(id);
        this.sessions.set(id, { captureId: state.run.captureId, nodeId, kind, text, timestamp: this.now() });
        let bytes = 0, runBytes = 0;
        for (const detail of [...this.sessions.values()].reverse()) {
            bytes += utf8Bytes(detail.text);
            if (detail.captureId === state.run.captureId) runBytes += utf8Bytes(detail.text);
            if (bytes > this.budgets.sessionBytes || runBytes > this.budgets.sessionRunBytes) this.sessions.delete(`${detail.captureId}:${detail.nodeId}:${detail.kind}`);
        }
    }

    recordTextCommitted(runtimeRunId: string): void {
        const state = [...this.states.values()].find(candidate => candidate.run.runtimeRunId === runtimeRunId);
        if (!state || state.events.some(event => event.kind === 'first_chat_text_committed')) return;
        this.observe(state, { nodeId: state.run.captureId, kind: 'phase', phase: 'first_chat_text_committed', status: 'completed' });
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
                        if (saved && current) { current.run.accountedBytes = saved.accountedBytes; current.run.lastCommittedSeq = saved.lastCommittedSeq; }
                    }
                } catch { this.reason = 'storage_write_failed'; const state = this.states.get(batch.run.captureId); if (state) state.run.hasGap = true; }
            }
            this.notify();
        });
        this.flushTail = task.catch(() => undefined);
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
        await this.initialize();
        const state = this.states.get(captureId);
        if (state && this.blockedConversations.has(state.run.conversationId ?? '')) return [];
        const stored = this.available ? await this.store.getEvents(captureId, query).catch(() => []) : [];
        const events = new Map(stored.map(event => [event.seq, event]));
        for (const event of state?.events ?? []) if (event.seq > (query.after ?? -1)) events.set(event.seq, event);
        return [...events.values()].sort((left, right) => left.seq - right.seq).slice(0, query.limit ?? 200);
    }

    async getContents(captureId: string, nodeId?: string): Promise<DebugContent[]> {
        if (!this.recoveryReady || this.pendingCleanups.size > 0) return [];
        const epoch = this.visibilityEpoch;
        const state = this.states.get(captureId);
        if (state && this.blockedConversations.has(state.run.conversationId ?? '')) return [];
        await this.flush();
        if (this.available) {
            const result = await this.store.getContents(captureId, nodeId).catch(() => []);
            return epoch === this.visibilityEpoch && this.recoveryReady && !this.pendingCleanups.size ? result : [];
        }
        if (epoch !== this.visibilityEpoch || !this.recoveryReady || this.pendingCleanups.size > 0) return [];
        const ids = nodeId ? new Set(state?.events.filter(event => event.nodeId === nodeId).flatMap(event => event.contentIds)) : undefined;
        return [...this.volatileContents.values()].filter(content => content.captureId === captureId
            && (!ids || ids.has(content.contentId))).map(content => ({ ...content }));
    }

    getSessionDetails(captureId: string, nodeId: string): DebugSessionDetail[] {
        if (!this.enabled() || !this.recoveryReady || this.pendingCleanups.size > 0 || this.generation.quarantined) return [];
        return [...this.sessions.values()].filter(detail => detail.captureId === captureId && detail.nodeId === nodeId).map(detail => ({ ...detail }));
    }

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
        this.collector.clear(); this.sessions.clear(); this.volatileContents.clear(); this.volatileRunBytes.clear(); this.volatileBytes = 0;
        for (const state of this.states.values()) {
            state.contentAllowed = false; state.segment++; state.text.clear();
            state.events = state.events.map(event => ({ ...event, contentIds: [], label: undefined, details: undefined, availability: 'cleared' }));
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
    async revokeDomains(domains: readonly DebugDomain[], options: { sourceToken?: string } = {}): Promise<void> {
        const cleanupId = `domains:${[...domains].sort().join(',')}`; this.pendingCleanups.add(cleanupId);
        this.invalidate(); await this.flushTail; await this.store.revokeDomains(domains, options);
        this.generation = await this.store.getGeneration(); this.pendingCleanups.delete(cleanupId); this.notify(true);
    }
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
    async applySourceToken(token: string): Promise<void> {
        await this.initialize();
        if (this.generation.sourceToken === token) return;
        this.pendingCleanups.add('source-token');
        this.invalidate(); await this.flushTail; await this.store.applySourceToken(token);
        this.generation = await this.store.getGeneration(); this.pendingCleanups.delete('source-token'); this.notify(true);
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
        this.disposed = true; this.sessions.clear(); this.volatileContents.clear(); this.listeners.clear();
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

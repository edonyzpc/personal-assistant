import { utf8Bytes } from './projection';
import { DEFAULT_DEBUG_BUDGETS, type DebugBatch, type DebugBudgets } from './types';

/** A bounded pending buffer. The caller owns scheduling and reports rejected batches as gaps. */
export class AgentDebugCollector {
    private batches: DebugBatch[] = [];
    private bytes = 0;
    private oversizedBytes = 0;
    private events = 0;
    private pendingBytes = 0;
    private pendingEvents = 0;
    private readonly charges = new Map<DebugBatch, { bytes: number; events: number; eventMetadataBytes?: number; oversized?: boolean }>();
    private readonly metadata = new Map<string, DebugBatch>();
    constructor(private readonly budgets: DebugBudgets = { ...DEFAULT_DEBUG_BUDGETS }) {}

    enqueue(batch: DebugBatch): boolean {
        const contentBytes = batch.contents.reduce((total, content) => total + content.accountedBytes, 0);
        const event = batch.events.length === 1 ? batch.events[0] : undefined;
        const delta = event?.kind === 'receiving' && batch.contents.length > 0
            && batch.contents.every(content => content.kind === 'output' || content.kind === 'reasoning');
        const eventMetadataBytes = delta ? utf8Bytes(JSON.stringify({ ...event, contentIds: [] })) + 256 : undefined;
        const last = this.batches[this.batches.length - 1];
        const charge = last && this.charges.get(last);
        if (delta && last && charge?.eventMetadataBytes !== undefined && last.run.captureId === batch.run.captureId
            && last.events[0].nodeId === event.nodeId && last.events[0].segment === event.segment) {
            const contentIds = last.events[0].contentIds;
            const addedBytes = contentBytes + utf8Bytes(JSON.stringify(event.contentIds)) - (contentIds.length ? 1 : 2)
                + eventMetadataBytes! - charge.eventMetadataBytes;
            if (this.bytes - this.oversizedBytes + addedBytes <= this.budgets.queueBytes) {
                // Coalesce only pending display events. Text blocks stay immutable and ordered.
                contentIds.push(...event.contentIds);
                last.events[0] = { ...event, contentIds };
                last.contents.push(...batch.contents); last.run = batch.run;
                charge.bytes += addedBytes; charge.eventMetadataBytes = eventMetadataBytes;
                this.bytes += addedBytes; this.pendingBytes += addedBytes;
                return true;
            }
        }
        const bytes = contentBytes + batch.events.reduce((total, item) => total + utf8Bytes(JSON.stringify(item)) + 256, 0);
        const oversizedObservation = bytes > this.budgets.queueBytes;
        // One large observation is charged separately until settlement. Normal events retain
        // their existing queue allowance, including start/finish beside a complete tool result.
        if (oversizedObservation && (bytes > this.budgets.runBytes || batch.events.length !== 1 || this.oversizedBytes > 0)) return false;
        if (this.events + batch.events.length > this.budgets.queueEvents
            || !oversizedObservation && this.bytes - this.oversizedBytes + bytes > this.budgets.queueBytes) return false;
        const admitted = delta ? { ...batch, events: [{ ...event, contentIds: [...event.contentIds] }] } : batch;
        this.batches.push(admitted);
        this.charges.set(admitted, { bytes, events: batch.events.length, eventMetadataBytes, oversized: oversizedObservation });
        if (oversizedObservation) this.oversizedBytes = bytes;
        this.bytes += bytes;
        this.events += batch.events.length;
        this.pendingBytes += bytes; this.pendingEvents += batch.events.length;
        return true;
    }

    /** One small latest snapshot per admitted run survives event/body budget exhaustion. */
    enqueueMetadata(batch: DebugBatch): void {
        if (this.metadata.size >= 128 && !this.metadata.has(batch.run.captureId)) return;
        this.metadata.set(batch.run.captureId, { ...batch, events: [], contents: [] });
    }

    drain(): DebugBatch[] {
        const batches = [...this.batches, ...this.metadata.values()];
        for (const batch of this.metadata.values()) this.charges.set(batch, { bytes: 0, events: 0 });
        this.metadata.clear();
        this.batches = [];
        this.pendingBytes = 0; this.pendingEvents = 0;
        return batches;
    }

    /** Drained batches still own their budget until the serialized writer settles. */
    release(batches: readonly DebugBatch[]): void {
        for (const batch of batches) {
            const charge = this.charges.get(batch);
            if (!charge) continue;
            this.bytes -= charge.bytes; this.events -= charge.events;
            if (charge.oversized) this.oversizedBytes = 0;
            this.charges.delete(batch);
        }
    }

    clear(): void { this.release(this.drain()); }
    get size(): number { return this.events; }
    get byteLength(): number { return this.bytes; }
    get pendingByteLength(): number { return this.pendingBytes; }
    get pendingSize(): number { return this.pendingEvents; }
}

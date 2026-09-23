import { utf8Bytes } from './projection';
import { DEFAULT_DEBUG_BUDGETS, type DebugBatch, type DebugBudgets } from './types';

/** A bounded pending buffer. The caller owns scheduling and reports rejected batches as gaps. */
export class AgentDebugCollector {
    private batches: DebugBatch[] = [];
    private bytes = 0;
    private events = 0;
    private readonly metadata = new Map<string, DebugBatch>();
    constructor(private readonly budgets: DebugBudgets = { ...DEFAULT_DEBUG_BUDGETS }) {}

    enqueue(batch: DebugBatch): boolean {
        const bytes = batch.contents.reduce((total, content) => total + content.accountedBytes, 0)
            + batch.events.reduce((total, event) => total + utf8Bytes(JSON.stringify(event)) + 256, 0);
        if (this.bytes + bytes > this.budgets.queueBytes || this.events + batch.events.length > this.budgets.queueEvents) return false;
        const last = this.batches[this.batches.length - 1];
        if (last && last.run.captureId === batch.run.captureId && last.events.length === 1 && batch.events.length === 1
            && last.events[0].nodeId === batch.events[0].nodeId && last.events[0].kind === 'receiving'
            && batch.events[0].kind === 'receiving' && last.events[0].segment === batch.events[0].segment
            && last.contents.length === 1 && batch.contents.length === 1
            && last.contents[0].kind === 'output' && batch.contents[0].kind === 'output') {
            last.contents[0].text += batch.contents[0].text;
            last.contents[0].accountedBytes += batch.contents[0].accountedBytes;
            last.events[0] = { ...batch.events[0], contentIds: [last.contents[0].contentId] };
            last.run = batch.run;
            this.bytes += bytes;
            return true;
        }
        this.batches.push(batch);
        this.bytes += bytes;
        this.events += batch.events.length;
        return true;
    }

    /** One small latest snapshot per admitted run survives event/body budget exhaustion. */
    enqueueMetadata(batch: DebugBatch): void {
        if (this.metadata.size >= 128 && !this.metadata.has(batch.run.captureId)) return;
        this.metadata.set(batch.run.captureId, { ...batch, events: [], contents: [] });
    }

    drain(): DebugBatch[] {
        const batches = [...this.batches, ...this.metadata.values()];
        this.metadata.clear();
        this.batches = []; this.bytes = 0; this.events = 0;
        return batches;
    }

    clear(): void { this.drain(); }
    get size(): number { return this.events; }
    get byteLength(): number { return this.bytes; }
}

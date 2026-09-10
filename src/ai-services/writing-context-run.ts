import type { ImageRef, MessageImage } from '../chat/image-types';
import { cloneImageRef, cloneMessageImages } from '../chat/image-types';
import { cloneWritingVersion, type WritingVersion } from '../chat/writing-types';
import type { WritingVersionService } from '../chat/writing-versions';
import type { WritingStyleService } from '../chat/writing-style-service';
import { normalizeWritingScene } from '../chat/writing-style-service';
import type { ChatWritingStylePreparation, ChatWritingStyleResult, PaAgentMessage } from './chat-types';
import { throwIfAborted } from './chat-utils';
import { cloneMessage } from './context/clone-utils';

export const GET_WRITING_CONTEXT = 'get_writing_context';

function selectionIdentity(selection: WritingContextSelection): string {
    const scene = selection.scene == null ? undefined : normalizeWritingScene(selection.scene);
    if (scene === null || typeof selection.currentInstructionConflicts !== 'boolean') throw new Error('Invalid writing selection');
    return JSON.stringify({ parentHandle: selection.parentHandle ?? null,
        scene: scene ?? null, currentInstructionConflicts: selection.currentInstructionConflicts,
        imageRefs: selection.imageRefs.map(cloneImageRef) });
}

export interface WritingContextSelection {
    parentHandle?: string;
    scene?: unknown;
    currentInstructionConflicts: boolean;
    imageRefs: readonly ImageRef[];
}

export interface PreparedWritingContext {
    handle: string;
    parent?: WritingVersion;
    images: MessageImage[];
    styleContext: string;
    styleRevisionIds: string[];
    scene?: import('../chat/writing-types').WritingScene;
}

/** Only values actually needed by the model; persistent version metadata stays host-owned. */
export function writingContextObservation(value: PreparedWritingContext) {
    return {
        contextHandle: value.handle,
        parent: value.parent ? { text: value.parent.text, textHash: value.parent.textHash } : null,
        images: cloneMessageImages(value.images),
        style: { context: value.styleContext, revisionIds: [...value.styleRevisionIds] },
    };
}

interface ContextReceipt {
    value: PreparedWritingContext;
    selectionIdentity: string;
    isMaterialCurrent(): boolean;
    isMaterialSourceCurrent?: () => boolean;
    style: ChatWritingStyleResult;
}

export interface WritingContextRunHost {
    runId: string;
    conversationId: string;
    /** Already authorized candidates, never an arbitrary vault/history inventory. */
    candidates: readonly WritingVersion[];
    /** Explicit UI choice, expressed as data for the main Agent rather than inferred from the prompt. */
    selectedParentVersionId?: string;
    versions: Pick<WritingVersionService, 'get'>;
    styles: Pick<WritingStyleService, 'prepare'>;
    isCurrent(): boolean;
    /** Synchronous live parent admission for physical SDK retries; an earlier get is insufficient. */
    isParentCurrent(parent: WritingVersion): boolean;
    /** Optional independent parent lifetime for persistence after request cleanup. */
    isParentSourceCurrent?(parent: WritingVersion): boolean;
    verifyImages(refs: readonly ImageRef[], signal?: AbortSignal): Promise<{
        images: MessageImage[];
        isCurrent(): boolean;
        /** Pure source lifetime, independent of run cleanup and the temporary read signal. */
        isSourceCurrent?(): boolean;
    }>;
}

/** Host preparation for get_writing_context; no model routing or persistent state. */
export class WritingContextRun {
    private readonly candidates = new Map<string, WritingVersion>();
    private receipt?: ContextReceipt;
    private sequence = 0;
    private preparation = 0;
    private disposed = false;

    constructor(private readonly host: WritingContextRunHost) {
        for (const candidate of host.candidates) {
            const version = cloneWritingVersion(candidate);
            if (version.conversationId !== host.conversationId) throw new Error('Writing candidate outside conversation');
            this.candidates.set(`${host.runId}:parent:${this.candidates.size + 1}`, version);
        }
    }

    candidateDirectory(): Array<{ handle: string; messageId: string; turnIndex: number; selected?: true }> {
        this.assertCurrent();
        return [...this.candidates].map(([handle, version]) => ({ handle, messageId: version.messageId, turnIndex: version.turnIndex,
            ...(version.id === this.host.selectedParentVersionId ? { selected: true as const } : {}) }));
    }

    /** A synchronous, cloned receipt for a physical request or output gate. */
    current(): PreparedWritingContext | undefined {
        this.assertCurrent();
        if (!this.receipt) return undefined;
        this.assertReceiptCurrent(this.receipt);
        return cloneContext(this.receipt.value);
    }

    /** Reuse only the last still-valid preparation, not every selection seen in this run. */
    matchesCurrentSelection(input: unknown): boolean {
        try {
            if (!input || typeof input !== 'object' || Array.isArray(input) || !this.receipt) return false;
            const selection = input as WritingContextSelection;
            this.assertReceiptCurrent(this.receipt);
            return this.receipt.selectionIdentity === selectionIdentity(selection);
        } catch { return false; }
    }

    async prepare(selection: WritingContextSelection, budget: Parameters<ChatWritingStylePreparation>[0]): Promise<PreparedWritingContext> {
        this.assertCurrent(budget.signal);
        const preparation = ++this.preparation;
        const parent = selection.parentHandle ? this.candidates.get(selection.parentHandle) : undefined;
        if (selection.parentHandle && !parent) throw new Error('Unknown writing parent handle');
        const scene = selection.scene === undefined ? undefined : normalizeWritingScene(selection.scene);
        if (scene === null) throw new Error('Invalid writing scene');
        const refs = selection.imageRefs.map(cloneImageRef);
        const conflicts = selection.currentInstructionConflicts;
        const requestBudget = { ...budget };
        if (parent) await this.assertParentCurrent(parent, requestBudget.signal);
        const materials = await this.host.verifyImages(refs, requestBudget.signal);
        this.assertCurrent(requestBudget.signal);
        // Verification cannot silently add or discard model-selected registered refs.
        const images = cloneMessageImages(materials.images);
        if (JSON.stringify(images.map(image => image.ref)) !== JSON.stringify(refs)) throw new Error('Writing materials changed');
        if (!materials.isCurrent()) throw new Error('Writing materials unavailable');
        const handle = `${this.host.runId}:writing:${++this.sequence}`;
        const base: PreparedWritingContext = { handle, ...(parent ? { parent: cloneWritingVersion(parent) } : {}),
            images, styleContext: '', styleRevisionIds: [], ...(scene ? { scene: { ...scene } } : {}) };
        const baseChars = JSON.stringify(writingContextObservation(base)).length;
        if (!Number.isFinite(requestBudget.remainingTextChars) || requestBudget.remainingTextChars < baseChars) {
            throw new Error('Writing context exceeds available budget');
        }
        const style = await this.host.styles.prepare(scene, { ...requestBudget,
            remainingTextChars: requestBudget.remainingTextChars - baseChars, currentInstructionConflicts: conflicts });
        this.assertCurrent(requestBudget.signal);
        if (parent) await this.assertParentCurrent(parent, requestBudget.signal);
        const value: PreparedWritingContext = {
            ...base, styleContext: style.context, styleRevisionIds: [...style.revisionIds],
        };
        if (JSON.stringify(writingContextObservation(value)).length > requestBudget.remainingTextChars) {
            throw new Error('Writing context exceeds available budget');
        }
        const receipt = { value, selectionIdentity: selectionIdentity({ parentHandle: selection.parentHandle,
            scene, currentInstructionConflicts: conflicts, imageRefs: refs }),
            isMaterialCurrent: materials.isCurrent.bind(materials),
            ...(materials.isSourceCurrent ? { isMaterialSourceCurrent: materials.isSourceCurrent } : {}), style };
        this.assertReceiptCurrent(receipt, requestBudget.signal);
        if (preparation !== this.preparation) throw new Error('Writing preparation superseded');
        this.receipt = receipt;
        return cloneContext(value);
    }

    async validate(handle: string, signal?: AbortSignal): Promise<PreparedWritingContext> {
        const receipt = this.receipt;
        if (!receipt || receipt.value.handle !== handle) throw new Error('Unknown writing context handle');
        this.assertReceiptCurrent(receipt, signal);
        if (receipt.value.parent) await this.assertParentCurrent(receipt.value.parent, signal);
        if (this.receipt !== receipt) throw new Error('Writing context replaced');
        this.assertReceiptCurrent(receipt, signal);
        return cloneContext(receipt.value);
    }

    /** Capture while the request is live; thereafter only real source changes invalidate it. */
    captureSourceValidity(): () => void {
        const receipt = this.receipt;
        if (!receipt) throw new Error('Writing context unavailable');
        this.assertReceiptCurrent(receipt);
        if (receipt.value.images.length && !receipt.isMaterialSourceCurrent) {
            throw new Error('Writing image source receipt unavailable');
        }
        const usesStyle = Boolean(receipt.value.styleContext || receipt.value.styleRevisionIds.length);
        if (usesStyle && !receipt.style.isSourceCurrent) throw new Error('Writing style source receipt unavailable');
        const parent = receipt.value.parent ? cloneWritingVersion(receipt.value.parent) : undefined;
        const checks: Array<() => boolean> = [];
        if (parent) {
            const isParentCurrent = this.host.isParentSourceCurrent ?? this.host.isParentCurrent;
            checks.push(() => isParentCurrent(cloneWritingVersion(parent)));
        }
        if (receipt.value.images.length) checks.push(receipt.isMaterialSourceCurrent!);
        if (usesStyle) checks.push(receipt.style.isSourceCurrent!);
        const assertSourcesCurrent = writingSourceValidityGuard(checks);
        assertSourcesCurrent();
        return assertSourcesCurrent;
    }

    async projectTranscript(transcript: readonly PaAgentMessage[], signal?: AbortSignal): Promise<PaAgentMessage[]> {
        const projected: PaAgentMessage[] = [];
        for (const original of transcript) {
            const message = cloneMessage(original);
            throwIfAborted(signal);
            if (message.role !== 'toolResult' || message.toolName !== GET_WRITING_CONTEXT
                || !message.content.includeInNextPrompt || message.isError) {
                projected.push(message);
                continue;
            }
            try {
                const receipt = this.receiptForMessage(message);
                await this.validate(receipt.value.handle, signal);
                projected.push(message);
            } catch {
                throwIfAborted(signal);
                projected.push({ ...message, content: {
                    promptText: 'Earlier writing context is unavailable. Prepare a current writing context before creating a work.',
                    includeInNextPrompt: true,
                    metadata: { outcome: 'source_unavailable', statusOnly: true },
                } });
            }
        }
        return projected;
    }

    /** Capture exactly the projected observations; the callback performs no asynchronous I/O. */
    captureTranscriptValidity(transcript: readonly PaAgentMessage[]): () => void {
        const receipts = transcript.flatMap(message => {
            if (message.role !== 'toolResult' || message.toolName !== GET_WRITING_CONTEXT
                || !message.content.includeInNextPrompt || message.isError
                || (message.content.metadata?.statusOnly === true && message.content.metadata?.outcome === 'source_unavailable'
                    && message.content.promptText === 'Earlier writing context is unavailable. Prepare a current writing context before creating a work.')) return [];
            return [this.receiptForMessage(message)];
        });
        return () => {
            this.assertCurrent();
            for (const receipt of receipts) {
                if (receipt !== this.receipt) throw new Error('Writing context replaced');
                this.assertReceiptCurrent(receipt);
            }
        };
    }

    dispose(): void {
        this.disposed = true;
        this.receipt = undefined;
        this.candidates.clear();
    }

    private assertCurrent(signal?: AbortSignal): void {
        throwIfAborted(signal);
        if (this.disposed || !this.host.isCurrent()) throw new Error('Writing context unavailable');
    }

    private assertReceiptCurrent(receipt: ContextReceipt, signal?: AbortSignal): void {
        this.assertCurrent(signal);
        if (receipt.value.parent && !this.host.isParentCurrent(cloneWritingVersion(receipt.value.parent))) {
            throw new Error('Writing parent changed');
        }
        const styleCurrent = receipt.style.isSourceCurrent ?? receipt.style.isCurrent;
        if (!receipt.isMaterialCurrent() || !styleCurrent.call(receipt.style)) throw new Error('Writing context sources changed');
        this.assertCurrent(signal);
    }

    private async assertParentCurrent(parent: WritingVersion, signal?: AbortSignal): Promise<void> {
        this.assertCurrent(signal);
        if (!this.host.isParentCurrent(cloneWritingVersion(parent))) throw new Error('Writing parent changed');
        const current = await this.host.versions.get(parent.id);
        this.assertCurrent(signal);
        if (!current || JSON.stringify(cloneWritingVersion(current)) !== JSON.stringify(parent)) throw new Error('Writing parent changed');
    }

    private receiptForMessage(message: Extract<PaAgentMessage, { role: 'toolResult' }>): ContextReceipt {
        const receipt = this.receipt;
        const payload: unknown = JSON.parse(message.content.promptText);
        if (!receipt || !payload || typeof payload !== 'object') throw new Error('Unknown writing context observation');
        const expected = { tool: GET_WRITING_CONTEXT, status: 'ok', input: 'Requested writing context',
            observation: writingContextObservation(receipt.value) };
        if (JSON.stringify(payload) !== JSON.stringify(expected)) {
            throw new Error('Writing context observation changed');
        }
        this.assertReceiptCurrent(receipt);
        return receipt;
    }
}

function writingSourceValidityGuard(checks: readonly (() => boolean)[]): () => void {
    const captured = [...checks];
    return () => {
        for (const check of captured) {
            let current = false;
            try { current = check(); } catch { /* An unavailable source cannot authorize persistence. */ }
            if (!current) throw new Error('Writing context sources changed');
        }
    };
}

function cloneContext(value: PreparedWritingContext): PreparedWritingContext {
    return { ...value, ...(value.parent ? { parent: cloneWritingVersion(value.parent) } : {}),
        ...(value.scene ? { scene: { ...value.scene } } : {}),
        images: cloneMessageImages(value.images), styleRevisionIds: [...value.styleRevisionIds] };
}

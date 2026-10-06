import { type ImageGenerationConnection } from '../ai-services/image-generation-connection';
import { WanImageProvider, WanImageProviderError, type WanImageTask } from '../ai-services/wan-image-provider';
import { inspectImage } from './image-format';
import { prepareWanImageInput } from './image-generation-input';
import { imageSourceHash } from './image-policy';
import { cloneInputLineage } from '../ai-services/input-lineage';
import type { ChatHistoryStore } from './chat-history-store';
import type { ImageAssetService } from './image-assets';
import { cloneImageRef, type ImageRef, type ImageSyncReceipt } from './image-types';
import type { GeneratedImageVersion, ImageGenerationPromptOrigin, ImageGenerationTask } from './image-generation-types';
import { ImagePreacceptError } from './image-generation-types';
import { normalizeFeaturedImageFolderPath } from '../ai-services/featured-image-path';
import { throwIfAborted } from '../ai-services/chat-utils';
import type { GetImageStatusInput, ImageStatusObservation, ImageStatusReadScope,
    ImageStatusBlockingReason, ImageStatusRefreshReason } from './image-generation-status';

const MAX_RESULT_BYTES = 20 * 1024 * 1024;
const POLL_DELAY_MS = 3_000;
const MAX_POLL_DELAY_MS = 30_000;
const RESULT_LIFETIME_MS = 24 * 60 * 60 * 1_000;

export interface ImageGenerationSubmitInput {
    conversationId: string;
    stableMessageId: string;
    operationId: string;
    userPrompt: string;
    submittedPrompt: string;
    operation: 'generate' | 'reference' | 'edit';
    count: number;
    totalCount?: number;
    inputRefs: ImageRef[];
    parentVersionId?: string;
    model?: string;
    promptOrigin?: ImageGenerationPromptOrigin;
    inputLineage?: import('./image-generation-types').ImageGenerationTask['request']['inputLineage'];
    attachmentPathHint?: string;
    /** A visible per-draft count selector is explicit user authorization for this request. */
    countExplicitlyAuthorized?: boolean;
    /** Never persisted; scoped PA Chat source admission for the derived prompt. */
    isSourceCurrent?: () => boolean;
}

interface ImageGenerationServiceOptions {
    store: ChatHistoryStore;
    assets: ImageAssetService;
    resolveConnection: () => ImageGenerationConnection | null;
    getToken: (mode: ImageGenerationConnection['mode']) => Promise<string | null>;
    log?: (message: string, error?: unknown) => void;
    now?: () => number;
    providerFactory?: (connection: ImageGenerationConnection, token: string) => WanImageProvider;
    download?: (url: string) => Promise<ArrayBuffer>;
    onSyncNotice?: (receipt: ImageSyncReceipt) => void;
}

export interface ImageGenerationConversationDeletionBoundary {
    confirmConversationDeleted(): void;
    abandonConversationDeletion(): void;
}

function identity(): string {
    return globalThis.crypto.randomUUID().replace(/-/g, '');
}

function sameStatusQueryTarget(previous: ImageGenerationTask, current: ImageGenerationTask): boolean {
    return previous.operationId === current.operationId && previous.conversationId === current.conversationId
        && previous.stableMessageId === current.stableMessageId && previous.providerTaskId === current.providerTaskId
        && previous.connection.mode === current.connection.mode
        && previous.connection.endpointIdentity === current.connection.endpointIdentity
        && previous.connection.credentialSlot === current.connection.credentialSlot
        && previous.connection.revision === current.connection.revision;
}

function knownImageProviderState(value: string | undefined): WanImageTask['status'] | undefined {
    return ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'UNKNOWN'].includes(value ?? '')
        ? value as WanImageTask['status'] : undefined;
}

function ownerBlockingReason(value: string | undefined): ImageStatusBlockingReason | undefined {
    return value === 'credential_unavailable' || value === 'connection_changed'
        || value === 'source_changed' || value === 'transparent_input_needs_confirmation'
            ? value : undefined;
}

function resultDestination(urlText: string): URL {
    let url: URL;
    try { url = new URL(urlText); } catch { throw new Error('image_generation:untrusted_result_url'); }
    // Provider results currently use Alibaba OSS. Do not let task JSON become an arbitrary URL fetch.
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash
        || !/(^|\.)oss-(?:cn-beijing|ap-southeast-1|accelerate|accelerate-overseas)\.aliyuncs\.com$/i.test(url.hostname)) {
        throw new Error('image_generation:untrusted_result_url');
    }
    return url;
}

async function downloadResult(urlText: string): Promise<ArrayBuffer> {
    const url = resultDestination(urlText);
    const response = await fetch(url.toString(), { method: 'GET', redirect: 'manual', credentials: 'omit' });
    // Obsidian requestUrl does not expose the final URL or redirect policy. A manual
    // fetch rejects redirects rather than letting a signed result locator fetch elsewhere.
    if (response.status !== 200 || response.redirected || response.url !== url.toString()
        || Number(response.headers.get('content-length') ?? 0) > MAX_RESULT_BYTES) {
        throw new Error('image_generation:result_download_failed');
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_RESULT_BYTES) throw new Error('image_generation:result_download_failed');
    return bytes;
}

/** Owns provider work beyond the lifetime of a Chat view; no remote result URL is persisted. */
export class ImageGenerationService {
    private readonly active = new Set<string>();
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly failures = new Map<string, number>();
    private readonly sourceReceipts = new Map<string, () => boolean>();
    private readonly deliverySuppressedTaskIds = new Set<string>();
    private readonly pendingConversationDeletions = new Map<string, number>();
    private readonly deletedConversations = new Set<string>();
    private readonly listeners = new Set<(task: ImageGenerationTask) => void>();
    private readonly contextPersistors = new Map<string, { conversationId: string; persist: (task: ImageGenerationTask) => Promise<void> }>();
    private disposed = false;

    constructor(private readonly options: ImageGenerationServiceOptions) {}

    subscribe(listener: (task: ImageGenerationTask) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    registerContextPersistence(taskId: string, persist: (task: ImageGenerationTask) => Promise<void>, conversationId: string): void {
        this.contextPersistors.set(taskId, { conversationId, persist });
    }

    clearContextPersistence(conversationId: string): void {
        for (const [taskId, entry] of this.contextPersistors) {
            if (entry.conversationId === conversationId) this.contextPersistors.delete(taskId);
        }
    }

    unregisterContextPersistence(taskId: string): void { this.contextPersistors.delete(taskId); }
    hasContextPersistence(taskId: string): boolean { return this.contextPersistors.has(taskId); }

    /** Keep late local delivery out of a conversation whose confirmed deletion is in progress. */
    beginConversationDeletionBoundary(conversationId: string): ImageGenerationConversationDeletionBoundary {
        this.pendingConversationDeletions.set(conversationId,
            (this.pendingConversationDeletions.get(conversationId) ?? 0) + 1);
        return {
            confirmConversationDeleted: () => {
                this.deletedConversations.add(conversationId);
                this.finishConversationDeletion(conversationId);
            },
            abandonConversationDeletion: () => this.finishConversationDeletion(conversationId),
        };
    }

    list(conversationId: string): Promise<ImageGenerationTask[]> {
        return this.options.store.listImageGenerationTasks(conversationId);
    }

    get(taskId: string): Promise<ImageGenerationTask | null> {
        return this.options.store.getImageGenerationTask(taskId);
    }

    /** Read existing task facts without entering the submission or delivery lifecycle. */
    async readStatus(input: GetImageStatusInput, scope: ImageStatusReadScope): Promise<ImageStatusObservation> {
        this.assertStatusScopeCurrent(scope);
        const task = input.taskId !== undefined ? await this.get(input.taskId)
            : await this.options.store.getImageGenerationTaskByOperationId(input.operationId);
        this.assertStatusScopeCurrent(scope);
        if (!this.isStatusTaskReadable(task, scope)) return { status: 'unavailable', reason: 'task_unavailable' };
        const queryReason = this.statusQueryReason(task, scope);
        if (!input.refresh || queryReason) return this.statusObservation(task, queryReason);

        try {
            const provider = await this.provider(task);
            this.assertStatusScopeCurrent(scope);
            const beforeQuery = await this.get(task.taskId);
            this.assertStatusScopeCurrent(scope);
            if (!this.isStatusTaskReadable(beforeQuery, scope)) return { status: 'unavailable', reason: 'task_unavailable' };
            const beforeReason = this.statusQueryReason(beforeQuery, scope)
                ?? (!sameStatusQueryTarget(task, beforeQuery) ? 'task_changed' : undefined);
            if (beforeReason) return this.statusObservation(beforeQuery, beforeReason);
            const result = await provider.query(task.providerTaskId!);
            this.assertStatusScopeCurrent(scope);
            const current = await this.get(task.taskId);
            this.assertStatusScopeCurrent(scope);
            if (!this.isStatusTaskReadable(current, scope)) return { status: 'unavailable', reason: 'task_unavailable' };
            const currentReason = this.statusQueryReason(current, scope)
                ?? (!sameStatusQueryTarget(task, current) ? 'task_changed' : undefined);
            if (currentReason) return this.statusObservation(current, currentReason);
            const observation = this.statusObservation(current);
            if (['FAILED', 'CANCELED', 'UNKNOWN'].includes(result.status) && current.state !== 'completed') {
                observation.nextAction = 'needs_user';
                delete observation.retryAfterMs;
            }
            return { ...observation, basis: 'provider_query',
                providerState: result.status, checkedAt: new Date(this.now()).toISOString() };
        } catch (error) {
            this.assertStatusScopeCurrent(scope);
            const current = await this.get(task.taskId);
            this.assertStatusScopeCurrent(scope);
            if (!this.isStatusTaskReadable(current, scope)) return { status: 'unavailable', reason: 'task_unavailable' };
            const reason = this.statusQueryReason(current, scope)
                ?? (!sameStatusQueryTarget(task, current) ? 'task_changed' : undefined)
                ?? (error instanceof Error && error.message === 'image_generation:credential_unavailable'
                    ? 'credential_unavailable' : 'provider_unavailable');
            return this.statusObservation(current, reason);
        }
    }

    private assertStatusScopeCurrent(scope: ImageStatusReadScope): void {
        throwIfAborted(scope.signal);
        if (this.disposed || !scope.isCurrent()) throw new Error('image_status:request_changed');
    }

    private isStatusTaskReadable(task: ImageGenerationTask | null, scope: ImageStatusReadScope): task is ImageGenerationTask {
        return task !== null && task.conversationId === scope.conversationId && !task.deliverySuppressed
            && scope.canReadTask({ taskId: task.taskId, operationId: task.operationId,
                conversationId: task.conversationId, stableMessageId: task.stableMessageId });
    }

    private statusQueryReason(task: ImageGenerationTask, scope: ImageStatusReadScope): ImageStatusRefreshReason | undefined {
        if (!task.providerTaskId) return 'no_provider_task';
        if (!scope.canQueryProvider()) return 'network_not_allowed';
        const connection = this.options.resolveConnection();
        if (!connection || connection.mode !== task.connection.mode
            || connection.baseURL !== task.connection.endpointIdentity
            || connection.credentialSlot !== task.connection.credentialSlot
            || connection.revision !== task.connection.revision) return 'connection_changed';
        return undefined;
    }

    private statusObservation(task: ImageGenerationTask,
        reason?: ImageStatusRefreshReason): Extract<ImageStatusObservation, { status: 'available' }> {
        const waiting = ['prepared', 'submitting', 'running', 'saving'].includes(task.state);
        const blockingReason = ownerBlockingReason(task.recoveryReason);
        const requiresUser = reason !== undefined
            && !['no_provider_task', 'provider_unavailable'].includes(reason);
        const nextAction = task.state === 'completed' ? 'none'
            : requiresUser || blockingReason !== undefined || !waiting ? 'needs_user' : 'wait';
        const providerState = knownImageProviderState(task.lastProviderState);
        return { status: 'available', taskId: task.taskId, operationId: task.operationId,
            localState: task.state, revision: task.revision, updatedAt: task.updatedAt,
            basis: 'local_snapshot', ...(providerState ? { providerState } : {}),
            remoteQueryAvailable: reason === undefined, ...(reason ? { remoteQueryReason: reason } : {}),
            ...(blockingReason ? { blockingReason } : {}),
            nextAction, ...(nextAction === 'wait'
                ? { retryAfterMs: Math.max(POLL_DELAY_MS, (task.nextPollAt ?? 0) - this.now()) } : {}) };
    }

    /** Return the still-live in-memory source receipt captured with an accepted task. */
    getSourceReceipt(taskId: string): (() => boolean) | undefined {
        return this.sourceReceipts.get(taskId);
    }

    async getVersion(versionId: string): Promise<GeneratedImageVersion | null> {
        const version = await this.options.store.getGeneratedImageVersion(versionId);
        if (!version) return null;
        const task = await this.get(version.taskId);
        return task && this.canDeliverTask(task) ? version : null;
    }

    async getVersionForOutput(taskId: string, outputId: string): Promise<GeneratedImageVersion | null> {
        const versionId = `version_${taskId}_${outputId}`;
        const existing = await this.getVersion(versionId);
        if (existing) return existing;
        const task = await this.get(taskId);
        if (task && !this.canDeliverTask(task)) return null;
        if (task?.outputs.some((output) => output.outputId === outputId && output.saveState === 'saved')) {
            await this.ensureVersion(task, outputId);
            return this.getVersion(versionId);
        }
        return null;
    }

    async submit(input: ImageGenerationSubmitInput): Promise<{ taskId: string }> {
        if (this.disposed) throw new ImagePreacceptError('source_changed', 'stale');
        if (input.isSourceCurrent?.() === false) throw new ImagePreacceptError('source_changed', 'stale');
        const existing = await this.options.store.getImageGenerationTaskByOperationId(input.operationId);
        if (existing) {
            if (existing.conversationId !== input.conversationId || existing.stableMessageId !== input.stableMessageId) {
                throw new Error('image_generation:operation_conflict');
            }
            return { taskId: existing.taskId };
        }
        const connection = this.options.resolveConnection();
        if (!connection) throw new ImagePreacceptError('connection_unavailable', 'needs_user');
        if (!await this.options.store.getConversation(input.conversationId)) {
            throw new ImagePreacceptError('source_changed', 'stale');
        }
        const model = input.model ?? 'wan2.7-image';
        if (model !== 'wan2.7-image' && model !== 'wan2.7-image-pro') {
            throw new ImagePreacceptError('invalid_request');
        }
        const count = input.count;
        if (!Number.isSafeInteger(count) || count < 1 || count > 4) {
            throw new ImagePreacceptError(count > 4 ? 'count_exceeds_provider_limit' : 'invalid_request');
        }
        if (input.totalCount !== undefined && (!Number.isSafeInteger(input.totalCount)
            || input.totalCount < count || input.totalCount > 4)) throw new ImagePreacceptError('plan_conflict');
        if (!input.userPrompt.trim() || !input.submittedPrompt.trim() || Array.from(input.submittedPrompt).length > 5000
            || input.inputRefs.length > 8) {
            throw new ImagePreacceptError('invalid_request');
        }
        if ((input.operation === 'generate' && input.inputRefs.length > 0)
            || (input.operation !== 'generate' && input.inputRefs.length === 0)) {
            throw new ImagePreacceptError('invalid_inputs');
        }
        if (input.parentVersionId) {
            const parent = await this.getVersion(input.parentVersionId);
            if (!parent || !input.inputRefs.some((ref) => ref.assetId === parent.assetRef.assetId
                && ref.contentHash === parent.assetRef.contentHash)) throw new ImagePreacceptError('invalid_inputs');
        }
        const now = new Date(this.now()).toISOString();
        const task: ImageGenerationTask = {
            schemaVersion: 1, taskId: identity(), operationId: input.operationId,
            conversationId: input.conversationId, stableMessageId: input.stableMessageId,
            createdAt: now, updatedAt: now, revision: 0,
            request: { userPrompt: input.userPrompt, submittedPrompt: input.submittedPrompt,
                operation: input.operation, model, count,
                ...(input.totalCount !== undefined ? { totalCount: input.totalCount } : {}),
                size: '2K', inputRefs: input.inputRefs.map(cloneImageRef),
                ...(input.parentVersionId ? { parentVersionId: input.parentVersionId } : {}),
                            ...(input.promptOrigin ? { promptOrigin: input.promptOrigin } : {}),
                            ...(input.inputLineage ? { inputLineage: cloneInputLineage(input.inputLineage) } : {}),
                ...(input.attachmentPathHint ? {
                    attachmentPathHint: normalizeFeaturedImageFolderPath(input.attachmentPathHint),
                } : {}) },
            connection: { mode: connection.mode, endpointIdentity: connection.baseURL,
                credentialSlot: connection.credentialSlot, revision: connection.revision },
            state: 'prepared', outputs: [],
            ...(input.isSourceCurrent ? { requiresSourceReceipt: true } : {}),
        };
        await this.options.store.putImageGenerationTask(task);
        if (input.isSourceCurrent) this.sourceReceipts.set(task.taskId, input.isSourceCurrent);
        this.emit(task);
        this.launch(task.taskId);
        return { taskId: task.taskId };
    }

    /** Startup cannot prove a prepared task was sent; only a claimed task may have reached Wan. */
    async recover(): Promise<void> {
        for (const task of await this.options.store.listImageGenerationTasks()) {
            if (task.state === 'prepared') {
                await this.update(task.taskId, (current) => current.state === 'prepared'
                    ? { ...current, state: 'not_submitted', recoveryReason: current.requiresSourceReceipt
                        ? 'source_changed_before_submit' : current.recoveryReason === 'transparent_input_needs_confirmation'
                            ? current.recoveryReason : 'ready_to_continue' } : null);
            } else if (task.state === 'submitting' && !task.providerTaskId) {
                await this.update(task.taskId, (current) => current.state === 'submitting' && !current.providerTaskId
                    ? { ...current, state: 'submission_unknown', recoveryReason: 'provider_acceptance_unknown' } : null);
            } else if (['running', 'saving', 'partial'].includes(task.state) && task.providerTaskId
                && !task.stopIntent && !task.deliverySuppressed) {
                this.launch(task.taskId);
            }
        }
    }

    async resume(taskId: string): Promise<void> {
        const task = await this.get(taskId);
        if (!task || task.stopIntent || task.deliverySuppressed) throw new Error('image_generation:task_unavailable');
        if (task.requiresSourceReceipt && !this.isSourceCurrent(task.taskId, task)) {
            throw new Error('image_generation:source_changed');
        }
        if (task.state === 'not_submitted') {
            if (task.recoveryReason === 'transparent_input_needs_confirmation') {
                throw new Error('image_generation:transparent_input_needs_confirmation');
            }
            await this.update(taskId, (current) => current.state === 'not_submitted'
                ? { ...current, state: 'prepared', recoveryReason: undefined } : null);
        } else if (task.state !== 'partial' && task.state !== 'running' && task.state !== 'saving') {
            throw new Error('image_generation:resume_unavailable');
        }
        this.launch(taskId);
    }

    async approveWhiteBackground(taskId: string): Promise<void> {
        const task = await this.update(taskId, (current) =>
            ['prepared', 'not_submitted'].includes(current.state) && !current.stopIntent
                && current.recoveryReason === 'transparent_input_needs_confirmation'
                ? { ...current, state: 'prepared', inputWhiteBackgroundApproved: true,
                    recoveryReason: undefined } : null);
        if (!task) throw new Error('image_generation:approval_unavailable');
        this.schedule(taskId, 0);
    }

    async stop(taskId: string): Promise<void> {
        await this.stopTask(taskId, false);
    }

    /** Removing a visible message must not leave a background task with an orphan card. */
    async suppress(taskId: string): Promise<void> {
        await this.stopTask(taskId, true);
    }

    /** Remove a deleted message's generation history while keeping any imported originals. */
    async forget(taskId: string): Promise<void> {
        const task = await this.get(taskId);
        if (!task) return;
        await this.suppress(taskId);
        for (const related of await this.list(task.conversationId)) {
            if (related.stableMessageId === task.stableMessageId) this.contextPersistors.delete(related.taskId);
        }
        await this.options.store.deleteImageGenerationTasks(task.conversationId, task.stableMessageId);
    }

    private async stopTask(taskId: string, suppressDelivery: boolean): Promise<void> {
        this.clearTimer(taskId);
        const previous = await this.get(taskId);
        if (!previous || (!suppressDelivery && ['completed', 'failed', 'stopped', 'expired'].includes(previous.state))) return;
        const stopped = await this.update(taskId, (current) =>
            current.deliverySuppressed || (!suppressDelivery && ['completed', 'failed', 'stopped', 'expired'].includes(current.state))
                ? null : { ...current,
                    state: ['completed', 'failed', 'stopped', 'expired'].includes(current.state) ? current.state : 'stopped',
                    stopIntent: true, deliverySuppressed: suppressDelivery || current.deliverySuppressed,
                    recoveryReason: suppressDelivery ? 'message_removed'
                        : ['prepared', 'not_submitted'].includes(current.state) ? 'stopped_before_submit'
                            : 'local_delivery_stopped' });
        if (!stopped || !previous.providerTaskId || previous.lastProviderState !== 'PENDING') return;
        try {
            const provider = await this.provider(previous);
            await provider.cancel(previous.providerTaskId, 'PENDING');
        } catch (error) { this.options.log?.('Image task remote cancellation was not confirmed', error); }
    }

    async readOutput(taskId: string, outputId: string): Promise<{ bytes: ArrayBuffer; mime: string; filename: string }> {
        const task = await this.get(taskId);
        const output = task?.outputs.find((item) => item.outputId === outputId);
        if (!task || !output || output.saveState !== 'saved' || !output.assetRef) {
            throw new Error('image_generation:output_unavailable');
        }
        if (!this.canDeliverTask(task)) throw new Error(task.requiresSourceReceipt
            ? 'image_generation:source_changed' : 'image_generation:output_unavailable');
        const original = await this.options.assets.readOriginal(output.assetRef, 'note');
        if (!this.canDeliverTask(task)) throw new Error(task.requiresSourceReceipt
            ? 'image_generation:source_changed' : 'image_generation:output_unavailable');
        const image = inspectImage(original.bytes);
        return { bytes: original.bytes, mime: image.mime,
            filename: `pa-image-${taskId}-${output.providerOrdinal + 1}.${image.format === 'jpeg' ? 'jpg' : image.format}` };
    }

    dispose(): void {
        this.disposed = true;
        for (const taskId of this.timers.keys()) this.clearTimer(taskId);
        this.sourceReceipts.clear();
        this.deliverySuppressedTaskIds.clear();
        this.pendingConversationDeletions.clear();
        this.deletedConversations.clear();
        this.listeners.clear();
        this.contextPersistors.clear();
    }

    private finishConversationDeletion(conversationId: string): void {
        const pending = this.pendingConversationDeletions.get(conversationId);
        if (pending === undefined) return;
        if (pending <= 1) this.pendingConversationDeletions.delete(conversationId);
        else this.pendingConversationDeletions.set(conversationId, pending - 1);
    }

    private now(): number { return this.options.now?.() ?? Date.now(); }

    private emit(task: ImageGenerationTask): void {
        if (this.disposed) return;
        for (const listener of this.listeners) listener(task);
        const entry = this.contextPersistors.get(task.taskId);
        if (entry) void entry.persist(task).then(() => {
            if (['completed', 'failed', 'stopped', 'expired'].includes(task.state)
                && this.contextPersistors.get(task.taskId) === entry) this.contextPersistors.delete(task.taskId);
        }).catch(error => this.options.log?.('Could not persist image context state', error));
    }

    private clearTimer(taskId: string): void {
        const timer = this.timers.get(taskId);
        if (timer) clearTimeout(timer);
        this.timers.delete(taskId);
    }

    private launch(taskId: string): void {
        if (this.disposed || this.active.has(taskId)) return;
        this.clearTimer(taskId);
        this.active.add(taskId);
        void this.drive(taskId).catch((error) => this.options.log?.('Image task paused', error))
            .finally(() => this.active.delete(taskId));
    }

    private schedule(taskId: string, delay = POLL_DELAY_MS): void {
        if (this.disposed) return;
        this.clearTimer(taskId);
        this.timers.set(taskId, setTimeout(() => { this.timers.delete(taskId); this.launch(taskId); }, delay));
    }

    private async update(taskId: string, change: (task: ImageGenerationTask) => ImageGenerationTask | null): Promise<ImageGenerationTask | null> {
        for (let attempt = 0; attempt < 3; attempt++) {
            const previous = await this.get(taskId);
            if (!previous) return null;
            const next = change(previous);
            if (!next) return null;
            const updated: ImageGenerationTask = { ...next, updatedAt: new Date(this.now()).toISOString(), revision: previous.revision + 1 };
            try {
                await this.options.store.putImageGenerationTask(updated, previous.revision);
                if (updated.deliverySuppressed) this.deliverySuppressedTaskIds.add(taskId);
                this.emit(updated);
                if (updated.deliverySuppressed) this.sourceReceipts.delete(taskId);
                return updated;
            } catch (error) {
                if (attempt === 2 || !(error instanceof Error) || !error.message.includes('revision')) throw error;
            }
        }
        return null;
    }

    private async provider(task: ImageGenerationTask): Promise<WanImageProvider> {
        const connection = this.options.resolveConnection();
        if (!connection || connection.mode !== task.connection.mode
            || connection.baseURL !== task.connection.endpointIdentity
            || connection.credentialSlot !== task.connection.credentialSlot
            || connection.revision !== task.connection.revision) {
            throw new Error('image_generation:connection_changed');
        }
        const token = await this.options.getToken(connection.mode);
        if (!token) throw new Error('image_generation:credential_unavailable');
        return this.options.providerFactory?.(connection, token)
            ?? new WanImageProvider({ baseURL: connection.baseURL, apiKey: token });
    }

    private async drive(taskId: string): Promise<void> {
        let task = await this.get(taskId);
        if (!task || this.disposed || task.stopIntent || task.deliverySuppressed) return;
        if (await this.stopIfSourceChanged(taskId, task)) return;
        try {
            if (['saving', 'partial'].includes(task.state)) {
                task = await this.repairSavedVersions(taskId);
                if (!task || task.state === 'completed') return;
            }
            if (task.state === 'prepared') {
                const receipts = [];
                const images: string[] = [];
                for (const ref of task.request.inputRefs) {
                    const receipt = await this.options.assets.verify(ref, 'provider');
                    const original = await this.options.assets.readOriginal(ref, 'provider');
                    const prepared = await prepareWanImageInput(original.bytes, receipt.isCurrent,
                        task.inputWhiteBackgroundApproved === true);
                    images.push(prepared.dataUrl);
                    if (prepared.whiteBackgroundApplied && !task.inputWhiteBackgroundApplied) {
                        task = await this.update(taskId, (current) => current.state === 'prepared' && !current.stopIntent
                            ? { ...current, inputWhiteBackgroundApplied: true } : null);
                        if (!task) return;
                    }
                    receipts.push(receipt);
                }
                if (receipts.some((receipt) => !receipt.isCurrent())) throw new Error('image_generation:source_changed');
                const provider = await this.provider(task);
                if (this.disposed) return;
                if (!this.isSourceCurrent(taskId, task)) {
                    await this.update(taskId, current => current.state === 'prepared'
                        ? { ...current, state: 'not_submitted', recoveryReason: 'source_changed_before_submit' } : null);
                    return;
                }
                if (receipts.some((receipt) => !receipt.isCurrent())) return;
                const claimed = await this.options.store.claimImageGenerationSubmission(taskId, task.revision,
                    new Date(this.now()).toISOString());
                if (!claimed) return;
                this.emit(claimed);
                task = claimed;
                const stillAdmitted = await this.get(taskId);
                if (!stillAdmitted || stillAdmitted.state !== 'submitting' || stillAdmitted.stopIntent || this.disposed) return;
                const currentConnection = this.options.resolveConnection();
                const sourceChanged = !this.isSourceCurrent(taskId, task) || receipts.some((receipt) => !receipt.isCurrent());
                const connectionChanged = !currentConnection || currentConnection.mode !== task.connection.mode
                    || currentConnection.baseURL !== task.connection.endpointIdentity
                    || currentConnection.credentialSlot !== task.connection.credentialSlot
                    || currentConnection.revision !== task.connection.revision;
                if (sourceChanged || connectionChanged) {
                    await this.update(taskId, (current) => current.state === 'submitting'
                        ? { ...current, state: 'failed', recoveryReason: sourceChanged
                            ? 'source_changed_before_submit' : 'connection_changed_before_submit' } : null);
                    return;
                }
                let submitted: WanImageTask;
                try {
                    if (!this.isSourceCurrent(taskId, task)) throw new Error('image_generation:source_changed');
                    if (task.request.model !== 'wan2.7-image' && task.request.model !== 'wan2.7-image-pro') {
                        throw new Error('image_generation:invalid_model');
                    }
                    submitted = await provider.submit({ model: task.request.model,
                        prompt: task.request.submittedPrompt,
                        count: task.request.count, size: '2K', referenceImages: images });
                } catch (error) {
                    const sourceChanged = error instanceof Error && error.message === 'image_generation:source_changed';
                    const uncertain = error instanceof WanImageProviderError && error.kind === 'submission_unknown';
                    await this.update(taskId, (current) => current.state === 'submitting'
                        ? { ...current, state: uncertain ? 'submission_unknown' : 'failed',
                            recoveryReason: sourceChanged ? 'source_changed_before_submit'
                                : uncertain ? 'provider_acceptance_unknown' : 'provider_rejected' } : null);
                    return;
                }
                task = await this.update(taskId, (current) => current.state === 'submitting'
                    ? { ...current, state: 'running', providerTaskId: submitted.taskId,
                        providerRequestId: submitted.requestId, lastProviderState: submitted.status } : null);
                if (!task) return;
                if (!this.isSourceCurrent(taskId, task)) {
                    await this.update(taskId, current => current.state === 'running'
                        ? { ...current, state: 'stopped', recoveryReason: 'source_changed' } : null);
                    return;
                }
            }
            if (!task.providerTaskId || !['running', 'saving', 'partial'].includes(task.state)) return;
            if (this.now() - Date.parse(task.createdAt) > RESULT_LIFETIME_MS) {
                if (task.state === 'running') await this.update(taskId, (current) => current.state === 'running'
                    ? { ...current, state: 'expired', recoveryReason: 'provider_result_expired' } : null);
                return;
            }
            const provider = await this.provider(task);
            const result = await provider.query(task.providerTaskId);
            this.failures.delete(taskId);
            if (this.disposed) return;
            if (await this.stopIfSourceChanged(taskId, task)) return;
            if (result.status === 'PENDING' || result.status === 'RUNNING') {
                await this.update(taskId, (current) => ['running', 'saving', 'partial'].includes(current.state)
                    ? { ...current, lastProviderState: result.status, nextPollAt: this.now() + POLL_DELAY_MS } : null);
                this.schedule(taskId);
                return;
            }
            if (result.status !== 'SUCCEEDED') {
                await this.update(taskId, (current) => current.state === 'running'
                    ? { ...current, state: 'failed', lastProviderState: result.status,
                        recoveryReason: 'provider_failed' } : null);
                return;
            }
            await this.saveResults(taskId, result.imageUrls);
        } catch (error) {
            const reason = error instanceof Error && error.message.startsWith('image_generation:')
                ? error.message.slice('image_generation:'.length) : 'provider_unavailable';
            const current = await this.get(taskId);
            if (current && ['running', 'saving', 'partial', 'prepared'].includes(current.state)
                && !current.stopIntent && !current.deliverySuppressed) {
                await this.update(taskId, (value) => ['running', 'saving', 'partial', 'prepared'].includes(value.state)
                    ? { ...value, recoveryReason: reason } : null);
                if (reason !== 'connection_changed' && reason !== 'credential_unavailable'
                    && reason !== 'source_changed' && reason !== 'transparent_input_needs_confirmation') {
                    const failures = (this.failures.get(taskId) ?? 0) + 1;
                    this.failures.set(taskId, failures);
                    this.schedule(taskId, Math.min(MAX_POLL_DELAY_MS, POLL_DELAY_MS * 2 ** Math.min(failures, 4)));
                }
            }
        }
    }

    private isSourceCurrent(taskId: string, task: ImageGenerationTask): boolean {
        if (!task.requiresSourceReceipt) return true;
        const receipt = this.sourceReceipts.get(taskId);
        if (!receipt) return false;
        try { return receipt() === true; } catch { return false; }
    }

    /** Completed local history remains deliverable when its transient receipt did not survive restart. */
    canDeliverTask(task: ImageGenerationTask): boolean {
        return !this.disposed && !this.pendingConversationDeletions.has(task.conversationId)
            && !this.deletedConversations.has(task.conversationId)
            && !this.deliverySuppressedTaskIds.has(task.taskId)
            && !task.deliverySuppressed && task.recoveryReason !== 'source_changed'
            && (task.state === 'completed' && !this.sourceReceipts.has(task.taskId)
                || this.isSourceCurrent(task.taskId, task));
    }

    private async stopIfSourceChanged(taskId: string, task: ImageGenerationTask): Promise<boolean> {
        if (this.isSourceCurrent(taskId, task)) return false;
        await this.update(taskId, current => current.requiresSourceReceipt && !current.deliverySuppressed
            && !current.stopIntent && ['prepared', 'running', 'saving', 'partial'].includes(current.state)
            ? { ...current, state: current.state === 'prepared' ? 'not_submitted' : 'stopped',
                recoveryReason: current.state === 'prepared' ? 'source_changed_before_submit' : 'source_changed' } : null);
        return true;
    }

    /** Local saved originals remain recoverable without a provider connection or result URL. */
    private async repairSavedVersions(taskId: string): Promise<ImageGenerationTask | null> {
        let task = await this.get(taskId);
        if (!task || task.stopIntent || task.deliverySuppressed) return null;
        if (await this.stopIfSourceChanged(taskId, task)) return null;
        if (task.outputs.some((output) => output.saveState !== 'saved' && output.expectedContentHash)) {
            const assets = await this.options.store.listImageAssets();
            for (const output of task.outputs) {
                if (output.saveState === 'saved' || !output.expectedContentHash) continue;
                const asset = assets.find((candidate) => candidate.source === 'imported'
                    && candidate.anchorPath === 'PA Chat.md' && candidate.anchorKind === 'logical_root'
                    && candidate.originalHash === output.expectedContentHash && candidate.state === 'available');
                if (!asset) continue;
                const ref = { assetId: asset.id, contentHash: asset.originalHash };
                let image;
                try { image = inspectImage((await this.options.assets.readOriginal(ref, 'note')).bytes); }
                catch { continue; }
                task = await this.update(taskId, (current) => ['saving', 'partial'].includes(current.state)
                    && !current.stopIntent ? { ...current, outputs: current.outputs.map((item) => item.outputId === output.outputId
                        && item.expectedContentHash === output.expectedContentHash && item.saveState !== 'saved'
                        ? { ...item, saveState: 'saved', assetRef: ref, mime: image.mime,
                            width: image.width, height: image.height, recoveryReason: undefined } : item) } : null);
                if (!task) return null;
            }
        }
        for (const output of task.outputs) {
            if (output.saveState !== 'saved') continue;
            if (await this.stopIfSourceChanged(taskId, task)) return null;
            await this.ensureVersion(task, output.outputId);
            if (output.recoveryReason === 'version_record_failed') {
                task = await this.update(taskId, (current) => ['saving', 'partial'].includes(current.state)
                    && !current.stopIntent ? { ...current, outputs: current.outputs.map((item) => item.outputId === output.outputId
                        ? { ...item, recoveryReason: undefined } : item) } : null);
                if (!task) return null;
            }
        }
        if (task.outputs.length === task.request.count && task.outputs.every((output) => output.saveState === 'saved')) {
            if (await this.stopIfSourceChanged(taskId, task)) return null;
            if (task.state === 'partial') {
                task = await this.update(taskId, (current) => current.state === 'partial' && !current.stopIntent
                    ? { ...current, state: 'saving' } : null);
                if (!task) return null;
            }
            task = await this.update(taskId, (current) => current.state === 'saving'
                && !current.stopIntent ? { ...current, state: 'completed', recoveryReason: undefined } : null);
        }
        return task;
    }

    private async saveResults(taskId: string, urls: string[]): Promise<void> {
        if (this.disposed) return;
        let task = await this.get(taskId);
        if (!task || task.stopIntent || task.deliverySuppressed || !['running', 'saving', 'partial'].includes(task.state)) return;
        if (await this.stopIfSourceChanged(taskId, task)) return;
        if (urls.length > task.request.count) throw new Error('image_generation:result_count_invalid');
        task = await this.update(taskId, (current) => !current.stopIntent && ['running', 'saving', 'partial'].includes(current.state)
            ? { ...current, state: 'saving', lastProviderState: 'SUCCEEDED',
                outputs: urls.map((_, index) => current.outputs.find((output) => output.providerOrdinal === index)
                    ?? { outputId: `output_${index}`, providerOrdinal: index, saveState: 'pending' }) } : null);
        if (!task) return;
        for (let index = 0; index < urls.length; index++) {
            if (this.disposed) return;
            if (!task) return;
            if (await this.stopIfSourceChanged(taskId, task)) return;
            const outputId = `output_${index}`;
            const previous = task.outputs.find((output) => output.outputId === outputId);
            if (previous?.saveState === 'saved') {
                try {
                    await this.ensureVersion(task, outputId);
                    if (previous.recoveryReason === 'version_record_failed') {
                        task = await this.update(taskId, (current) => current.state === 'saving'
                            ? { ...current, outputs: current.outputs.map((output) => output.outputId === outputId
                                ? { ...output, recoveryReason: undefined } : output) } : null);
                        if (!task) return;
                    }
                }
                catch { /* A saved original stays available; resume can repair its version record. */ }
                continue;
            }
            task = await this.update(taskId, (current) => current.state === 'saving' && !current.stopIntent
                ? { ...current, outputs: current.outputs.map((output) => output.outputId === outputId
                    ? { ...output, saveState: 'saving' } : output) } : null);
            if (!task) return;
            try {
                const bytes = await (this.options.download ?? downloadResult)(urls[index]);
                if (this.disposed) return;
                const beforeImport = await this.get(taskId);
                if (!beforeImport || beforeImport.stopIntent || beforeImport.deliverySuppressed
                    || beforeImport.state !== 'saving') return;
                if (await this.stopIfSourceChanged(taskId, beforeImport)) return;
                if (bytes.byteLength > MAX_RESULT_BYTES) throw new Error('image_generation:result_too_large');
                const image = inspectImage(bytes);
                if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.mime)) {
                    throw new Error('image_generation:unsupported_result_format');
                }
                const expectedContentHash = await imageSourceHash(bytes);
                if (previous?.expectedContentHash && previous.expectedContentHash !== expectedContentHash) {
                    throw new Error('image_generation:result_changed');
                }
                task = await this.update(taskId, (current) => current.state === 'saving' && !current.stopIntent
                    ? { ...current, outputs: current.outputs.map((output) => output.outputId === outputId
                        ? { ...output, expectedContentHash } : output) } : null);
                if (!task) return;
                if (await this.stopIfSourceChanged(taskId, task)) return;
                const filename = `pa-generated-${taskId}-${index}.${image.format === 'jpeg' ? 'jpg' : image.format}`;
                const imported = await this.options.assets.importFile({ name: filename, size: bytes.byteLength,
                    arrayBuffer: async () => bytes }, { anchorPath: 'PA Chat.md', anchorKind: 'logical_root',
                    acquisition: 'original_file', onSyncNotice: (receipt) => this.options.onSyncNotice?.(receipt) });
                // Import may finish after Stop. Once a file exists, retain its task provenance.
                task = await this.update(taskId, (current) => ['saving', 'stopped'].includes(current.state)
                    ? { ...current, outputs: current.outputs.map((output) => output.outputId === outputId
                        ? { ...output, saveState: 'saved', assetRef: imported.ref, mime: image.mime,
                            width: image.width, height: image.height, recoveryReason: undefined } : output) } : null);
                if (!task) return;
                if (await this.stopIfSourceChanged(taskId, task)) return;
                await this.ensureVersion(task, outputId);
            } catch (error) {
                const reason = error instanceof Error && error.message.startsWith('image_generation:')
                    ? error.message.slice('image_generation:'.length) : 'save_failed';
                task = await this.update(taskId, (current) => current.state === 'saving'
                    ? { ...current, outputs: current.outputs.map((output) => output.outputId === outputId
                        ? output.saveState === 'saved' ? { ...output, recoveryReason: 'version_record_failed' }
                            : { ...output, saveState: 'failed', recoveryReason: reason } : output) } : null);
                if (!task) return;
            }
        }
        if (!task) return;
        if (await this.stopIfSourceChanged(taskId, task)) return;
        let versionsReady = task.outputs.length === task.request.count;
        for (const output of task.outputs) {
            if (output.saveState !== 'saved' || !await this.getVersionForOutput(taskId, output.outputId)) {
                versionsReady = false;
            }
        }
        await this.update(taskId, (current) => current.state === 'saving'
            ? { ...current, state: versionsReady ? 'completed' : 'partial' } : null);
    }

    private async ensureVersion(task: ImageGenerationTask, outputId: string): Promise<void> {
        const output = task.outputs.find((item) => item.outputId === outputId);
        if (!output?.assetRef || output.saveState !== 'saved') throw new Error('image_generation:output_unavailable');
        if (!this.canDeliverTask(task)) throw new Error('image_generation:source_changed');
        const versionId = `version_${task.taskId}_${outputId}`;
        if (await this.getVersion(versionId)) return;
        if (!this.canDeliverTask(task)) throw new Error('image_generation:source_changed');
        const version: GeneratedImageVersion = { schemaVersion: 1, versionId, taskId: task.taskId,
            outputId, assetRef: output.assetRef, inputRefs: task.request.inputRefs,
            parentVersionId: task.request.parentVersionId, createdAt: new Date(this.now()).toISOString(),
            model: task.request.model, submittedPrompt: task.request.submittedPrompt };
        await this.options.store.putGeneratedImageVersion(version, () => {
            if (!this.canDeliverTask(task)) throw new Error('image_generation:source_changed');
        });
    }
}

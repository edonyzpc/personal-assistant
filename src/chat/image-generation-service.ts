import { type ImageGenerationConnection } from '../ai-services/image-generation-connection';
import { WanImageProvider, WanImageProviderError, type WanImageTask } from '../ai-services/wan-image-provider';
import { inspectImage } from './image-format';
import { prepareWanImageInput } from './image-generation-input';
import { imageSourceHash } from './image-policy';
import type { ChatHistoryStore } from './chat-history-store';
import type { ImageAssetService } from './image-assets';
import { cloneImageRef, type ImageRef, type ImageSyncReceipt } from './image-types';
import type { GeneratedImageVersion, ImageGenerationTask } from './image-generation-types';

const MAX_RESULT_BYTES = 20 * 1024 * 1024;
const POLL_DELAY_MS = 3_000;
const MAX_POLL_DELAY_MS = 30_000;
const RESULT_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const COUNT_WORDS = ['[二两]', '三', '四'];
const ENGLISH_COUNTS = ['two', 'three', 'four'];

export interface ImageGenerationSubmitInput {
    conversationId: string;
    stableMessageId: string;
    operationId: string;
    userPrompt: string;
    submittedPrompt: string;
    operation: 'generate' | 'reference' | 'edit';
    count: number;
    inputRefs: ImageRef[];
    parentVersionId?: string;
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

function identity(): string {
    return globalThis.crypto.randomUUID().replace(/-/g, '');
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
    private readonly listeners = new Set<(task: ImageGenerationTask) => void>();
    private disposed = false;

    constructor(private readonly options: ImageGenerationServiceOptions) {}

    subscribe(listener: (task: ImageGenerationTask) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    list(conversationId: string): Promise<ImageGenerationTask[]> {
        return this.options.store.listImageGenerationTasks(conversationId);
    }

    get(taskId: string): Promise<ImageGenerationTask | null> {
        return this.options.store.getImageGenerationTask(taskId);
    }

    getVersion(versionId: string): Promise<GeneratedImageVersion | null> {
        return this.options.store.getGeneratedImageVersion(versionId);
    }

    async getVersionForOutput(taskId: string, outputId: string): Promise<GeneratedImageVersion | null> {
        const versionId = `version_${taskId}_${outputId}`;
        const existing = await this.getVersion(versionId);
        if (existing) return existing;
        const task = await this.get(taskId);
        if (task?.outputs.some((output) => output.outputId === outputId && output.saveState === 'saved')) {
            await this.ensureVersion(task, outputId);
            return this.getVersion(versionId);
        }
        return null;
    }

    async submit(input: ImageGenerationSubmitInput): Promise<{ taskId: string }> {
        if (this.disposed) throw new Error('image_generation:unavailable');
        const existing = await this.options.store.getImageGenerationTaskByOperationId(input.operationId);
        if (existing) {
            if (existing.conversationId !== input.conversationId || existing.stableMessageId !== input.stableMessageId) {
                throw new Error('image_generation:operation_conflict');
            }
            return { taskId: existing.taskId };
        }
        const connection = this.options.resolveConnection();
        if (!connection) throw new Error('image_generation:connection_unavailable');
        if (!await this.options.store.getConversation(input.conversationId)) {
            throw new Error('image_generation:conversation_unavailable');
        }
        if (Number.isInteger(input.count) && input.count > 4) {
            throw new Error('image_generation:count_exceeds_provider_limit');
        }
        if (!input.userPrompt.trim() || !input.submittedPrompt.trim() || Array.from(input.submittedPrompt).length > 5000
            || !Number.isInteger(input.count) || input.count < 1 || input.inputRefs.length > 8) {
            throw new Error('image_generation:invalid_request');
        }
        if (input.count > 1) {
            const word = COUNT_WORDS[input.count - 2];
            const english = ENGLISH_COUNTS[input.count - 2];
            const explicit = new RegExp(`(?:${input.count}|${word})\\s*(?:张|幅|个|幅图|张图)|(?:${input.count}|${english})\\s*(?:images?|pictures?|photos?)`, 'i');
            const separateOnes = [...input.userPrompt.matchAll(/(?:一|1|one)\s*(?:张|幅|个(?:图|图片|照片)|images?|pictures?|photos?)/gi)].length;
            if (!explicit.test(input.userPrompt) && separateOnes !== input.count) {
                throw new Error('image_generation:count_needs_confirmation');
            }
        }
        if ((input.operation === 'generate' && input.inputRefs.length > 0)
            || (input.operation !== 'generate' && input.inputRefs.length === 0)) {
            throw new Error('image_generation:invalid_inputs');
        }
        if (input.parentVersionId) {
            const parent = await this.getVersion(input.parentVersionId);
            if (!parent || !input.inputRefs.some((ref) => ref.assetId === parent.assetRef.assetId
                && ref.contentHash === parent.assetRef.contentHash)) throw new Error('image_generation:parent_unavailable');
        }
        const now = new Date(this.now()).toISOString();
        const task: ImageGenerationTask = {
            schemaVersion: 1, taskId: identity(), operationId: input.operationId,
            conversationId: input.conversationId, stableMessageId: input.stableMessageId,
            createdAt: now, updatedAt: now, revision: 0,
            request: { userPrompt: input.userPrompt, submittedPrompt: input.submittedPrompt,
                operation: input.operation, model: 'wan2.7-image', count: input.count,
                size: '2K', inputRefs: input.inputRefs.map(cloneImageRef),
                ...(input.parentVersionId ? { parentVersionId: input.parentVersionId } : {}) },
            connection: { mode: connection.mode, endpointIdentity: connection.baseURL,
                credentialSlot: connection.credentialSlot, revision: connection.revision },
            state: 'prepared', outputs: [],
        };
        await this.options.store.putImageGenerationTask(task);
        this.emit(task);
        this.launch(task.taskId);
        return { taskId: task.taskId };
    }

    /** Startup cannot prove a prepared task was sent; only a claimed task may have reached Wan. */
    async recover(): Promise<void> {
        for (const task of await this.options.store.listImageGenerationTasks()) {
            if (task.state === 'prepared') {
                await this.update(task.taskId, (current) => current.state === 'prepared'
                    ? { ...current, state: 'not_submitted', recoveryReason: current.recoveryReason === 'transparent_input_needs_confirmation'
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
        if (!output || output.saveState !== 'saved' || !output.assetRef) throw new Error('image_generation:output_unavailable');
        const original = await this.options.assets.readOriginal(output.assetRef, 'note');
        const image = inspectImage(original.bytes);
        return { bytes: original.bytes, mime: image.mime,
            filename: `pa-image-${taskId}-${output.providerOrdinal + 1}.${image.format === 'jpeg' ? 'jpg' : image.format}` };
    }

    dispose(): void {
        this.disposed = true;
        for (const taskId of this.timers.keys()) this.clearTimer(taskId);
        this.listeners.clear();
    }

    private now(): number { return this.options.now?.() ?? Date.now(); }

    private emit(task: ImageGenerationTask): void {
        if (this.disposed) return;
        for (const listener of this.listeners) listener(task);
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
                this.emit(updated);
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
                if (this.disposed || receipts.some((receipt) => !receipt.isCurrent())) return;
                const claimed = await this.options.store.claimImageGenerationSubmission(taskId, task.revision,
                    new Date(this.now()).toISOString());
                if (!claimed) return;
                this.emit(claimed);
                task = claimed;
                const stillAdmitted = await this.get(taskId);
                if (!stillAdmitted || stillAdmitted.state !== 'submitting' || stillAdmitted.stopIntent || this.disposed) return;
                const currentConnection = this.options.resolveConnection();
                const sourceChanged = receipts.some((receipt) => !receipt.isCurrent());
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
                    submitted = await provider.submit({ model: 'wan2.7-image', prompt: task.request.submittedPrompt,
                        count: task.request.count, size: '2K', referenceImages: images });
                } catch (error) {
                    const uncertain = error instanceof WanImageProviderError && error.kind === 'submission_unknown';
                    await this.update(taskId, (current) => current.state === 'submitting'
                        ? { ...current, state: uncertain ? 'submission_unknown' : 'failed',
                            recoveryReason: uncertain ? 'provider_acceptance_unknown' : 'provider_rejected' } : null);
                    return;
                }
                task = await this.update(taskId, (current) => current.state === 'submitting'
                    ? { ...current, state: 'running', providerTaskId: submitted.taskId,
                        providerRequestId: submitted.requestId, lastProviderState: submitted.status } : null);
                if (!task) return;
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

    /** Local saved originals remain recoverable without a provider connection or result URL. */
    private async repairSavedVersions(taskId: string): Promise<ImageGenerationTask | null> {
        let task = await this.get(taskId);
        if (!task || task.stopIntent || task.deliverySuppressed) return null;
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
            await this.ensureVersion(task, output.outputId);
            if (output.recoveryReason === 'version_record_failed') {
                task = await this.update(taskId, (current) => ['saving', 'partial'].includes(current.state)
                    && !current.stopIntent ? { ...current, outputs: current.outputs.map((item) => item.outputId === output.outputId
                        ? { ...item, recoveryReason: undefined } : item) } : null);
                if (!task) return null;
            }
        }
        if (task.outputs.length === task.request.count && task.outputs.every((output) => output.saveState === 'saved')) {
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
        if (urls.length > task.request.count) throw new Error('image_generation:result_count_invalid');
        task = await this.update(taskId, (current) => !current.stopIntent && ['running', 'saving', 'partial'].includes(current.state)
            ? { ...current, state: 'saving', lastProviderState: 'SUCCEEDED',
                outputs: urls.map((_, index) => current.outputs.find((output) => output.providerOrdinal === index)
                    ?? { outputId: `output_${index}`, providerOrdinal: index, saveState: 'pending' }) } : null);
        if (!task) return;
        for (let index = 0; index < urls.length; index++) {
            if (this.disposed) return;
            if (!task) return;
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
        const versionId = `version_${task.taskId}_${outputId}`;
        if (await this.getVersion(versionId)) return;
        const version: GeneratedImageVersion = { schemaVersion: 1, versionId, taskId: task.taskId,
            outputId, assetRef: output.assetRef, inputRefs: task.request.inputRefs,
            parentVersionId: task.request.parentVersionId, createdAt: new Date(this.now()).toISOString(),
            model: task.request.model, submittedPrompt: task.request.submittedPrompt };
        await this.options.store.putGeneratedImageVersion(version);
    }
}

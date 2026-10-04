import { cloneImageRef, type ImageRef } from './image-types';
import { cloneInputLineage, type InputLineage } from '../ai-services/input-lineage';
import type { PaAgentToolExecutionFacts } from '../ai-services/pa-agent-types';

export type ImageGenerationState = 'prepared' | 'not_submitted' | 'submitting' | 'submission_unknown'
    | 'running' | 'saving' | 'completed' | 'partial' | 'failed' | 'stopped' | 'expired';

export interface ImageGenerationOutput {
    outputId: string;
    providerOrdinal: number;
    saveState: 'pending' | 'saving' | 'saved' | 'failed';
    /** Durable identity of downloaded bytes before vault import starts. */
    expectedContentHash?: string;
    mime?: string;
    width?: number;
    height?: number;
    assetRef?: ImageRef;
    recoveryReason?: string;
}

/** Body-free provenance for a prompt derived from an explicit text source. */
export interface ImageGenerationPromptOrigin {
    kind: 'note' | 'selection';
    displayName: string;
    path: string;
    selection?: { from: number; to: number };
    inputLineage: InputLineage;
    defaultUserPrompt?: boolean;
}

export interface ImageGenerationTask {
    schemaVersion: 1;
    taskId: string;
    operationId: string;
    conversationId: string;
    stableMessageId: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    /** This queued prompt used scoped material; only an ephemeral source receipt may dispatch it. */
    requiresSourceReceipt?: boolean;
    request: {
        userPrompt: string;
        submittedPrompt: string;
        operation: 'generate' | 'reference' | 'edit';
        model: string;
        count: number;
        totalCount?: number;
        size?: string;
        inputRefs: ImageRef[];
        parentVersionId?: string;
        promptOrigin?: ImageGenerationPromptOrigin;
        inputLineage?: InputLineage;
        attachmentPathHint?: string;
    };
    connection: {
        mode: 'inherit-chat' | 'dedicated-wan';
        endpointIdentity: string;
        credentialSlot: string;
        revision: number;
    };
    state: ImageGenerationState;
    providerTaskId?: string;
    providerRequestId?: string;
    lastProviderState?: string;
    nextPollAt?: number;
    stopIntent?: boolean;
    deliverySuppressed?: boolean;
    inputWhiteBackgroundApproved?: boolean;
    /** A white background was applied to an outbound input copy; originals are unchanged. */
    inputWhiteBackgroundApplied?: boolean;
    recoveryReason?: string;
    outputs: ImageGenerationOutput[];
}

const IMAGE_PREACCEPT_ACTIONS = {
    correct_input: ['correct_input'],
    needs_user: ['needs_user'],
    stale: ['none'],
} as const;

export const IMAGE_PREACCEPT_MESSAGES = {
    invalid_request: 'The structured image request is invalid. Correct it; no image task was accepted.',
    invalid_inputs: 'The selected image operation and references do not match. Correct the structured request; no image task was accepted.',
    count_exceeds_provider_limit: 'Wan supports up to 4 images in one request. Ask the user to choose 1–4 images.',
    plan_conflict: 'The structured image counts conflict with the frozen plan or actual options. Correct or clarify the plan; no new image task was accepted.',
    source_changed: 'The image request source is no longer current. Start from the current source; no new image task was accepted.',
    connection_unavailable: 'Image generation needs a compatible Wan connection in Settings. No image task was accepted.',
    cancelled: 'Image preparation was declined or cancelled. No image task was accepted.',
    preparation_failed: 'Image description preparation or admission failed. No image task was accepted; ask the user before continuing. Description model costs may already have been used.',
    operation_unresolved: 'This image part has not started. An earlier part of the original operation is unresolved. Verify that original part before continuing; do not start a replacement operation.',
} as const;
export const IMAGE_ACCEPTANCE_UNKNOWN_MESSAGE = 'Image task acceptance could not be confirmed. Verify the original operation if available; otherwise explain the verification limit. Do not resubmit.';

/** The same Host operation identity is used for dispatch and owner facts. */
export function imageSubrequestOperationId(operationId: string, index = 1): string {
    return index === 1 ? operationId : `${operationId}-sub${index}`;
}

/** A closed pre-acceptance fact; the durable image task is created only after this point. */
export class ImagePreacceptError extends Error {
    readonly cause?: unknown;
    constructor(readonly code: keyof typeof IMAGE_PREACCEPT_MESSAGES,
        readonly action: keyof typeof IMAGE_PREACCEPT_ACTIONS = 'correct_input', options?: { cause: unknown }) {
        super(`Image preacceptance: ${code}.`);
        this.cause = options?.cause;
        this.name = 'ImagePreacceptError';
    }

    get facts(): PaAgentToolExecutionFacts {
        return {
            executionState: 'not_started',
            recovery: { code: `image_${this.code}`, allowedActions: [...IMAGE_PREACCEPT_ACTIONS[this.action]] },
        };
    }
}

export interface GeneratedImageVersion {
    schemaVersion: 1;
    versionId: string;
    taskId: string;
    outputId: string;
    assetRef: ImageRef;
    parentVersionId?: string;
    inputRefs: ImageRef[];
    createdAt: string;
    model: string;
    submittedPrompt: string;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const MIME = /^image\/[a-z0-9.+-]+$/;
const HASH = /^[a-f0-9]{64}$/;
const STATES = new Set<ImageGenerationState>([
    'prepared', 'not_submitted', 'submitting', 'submission_unknown', 'running', 'saving',
    'completed', 'partial', 'failed', 'stopped', 'expired',
]);

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid image generation record.');
    return value as Record<string, unknown>;
}

function id(value: unknown): string {
    if (typeof value !== 'string' || !ID.test(value)) throw new Error('Invalid image generation identity.');
    return value;
}

function text(value: unknown, max: number): string {
    if (typeof value !== 'string' || value.length > max
        || Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
        throw new Error('Invalid image generation text.');
    }
    return value;
}

function prompt(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 12000 || value.includes('\u0000')) {
        throw new Error('Invalid image generation prompt.');
    }
    return value;
}

function promptOrigin(value: unknown): ImageGenerationPromptOrigin {
    const input = object(value);
    if (input.kind !== 'note' && input.kind !== 'selection') {
        throw new Error('Invalid image prompt origin.');
    }
    const displayName = text(input.displayName, 512);
    const path = text(input.path, 4096);
    const inputLineage = cloneInputLineage(input.inputLineage);
    if (!inputLineage) throw new Error('Invalid image prompt origin lineage.');
    const result: ImageGenerationPromptOrigin = { kind: input.kind, displayName, path, inputLineage };
    if (input.selection !== undefined) {
        const selection = object(input.selection);
        result.selection = { from: integer(selection.from, 0), to: integer(selection.to, 0) };
        if (result.selection.to < result.selection.from) throw new Error('Invalid image prompt selection.');
    }
    if (input.defaultUserPrompt !== undefined && typeof input.defaultUserPrompt !== 'boolean') {
        throw new Error('Invalid image prompt origin request marker.');
    }
    if (input.defaultUserPrompt === true) result.defaultUserPrompt = true;
    return result;
}

function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error('Invalid image generation number.');
    }
    return value;
}

function timestamp(value: unknown): string {
    const result = text(value, 64);
    if (!Number.isFinite(Date.parse(result))) throw new Error('Invalid image generation timestamp.');
    return result;
}

function refs(value: unknown): ImageRef[] {
    if (!Array.isArray(value) || value.length > 8) throw new Error('Invalid image generation inputs.');
    return value.map(cloneImageRef);
}

export function cloneImageGenerationTask(value: unknown): ImageGenerationTask {
    const input = object(value), request = object(input.request), connection = object(input.connection);
    if (input.schemaVersion !== 1 || !STATES.has(input.state as ImageGenerationState)
        || !['generate', 'reference', 'edit'].includes(String(request.operation))
        || !['inherit-chat', 'dedicated-wan'].includes(String(connection.mode))
        || !Array.isArray(input.outputs) || input.outputs.length > 16) {
        throw new Error('Unsupported image generation task.');
    }
    const outputs = input.outputs.map((raw): ImageGenerationOutput => {
        const output = object(raw);
        if (!['pending', 'saving', 'saved', 'failed'].includes(String(output.saveState))) {
            throw new Error('Invalid image generation output state.');
        }
        const result: ImageGenerationOutput = {
            outputId: id(output.outputId), providerOrdinal: integer(output.providerOrdinal, 0, 15),
            saveState: output.saveState as ImageGenerationOutput['saveState'],
        };
        if (output.expectedContentHash !== undefined) {
            if (typeof output.expectedContentHash !== 'string' || !HASH.test(output.expectedContentHash)) {
                throw new Error('Invalid image generation output hash.');
            }
            result.expectedContentHash = output.expectedContentHash;
        }
        if (output.mime !== undefined) {
            const mime = text(output.mime, 128);
            if (!MIME.test(mime)) throw new Error('Invalid image generation MIME.');
            result.mime = mime;
        }
        if (output.width !== undefined) result.width = integer(output.width, 1, 50000);
        if (output.height !== undefined) result.height = integer(output.height, 1, 50000);
        if (output.assetRef !== undefined) result.assetRef = cloneImageRef(output.assetRef);
        if (output.recoveryReason !== undefined) result.recoveryReason = text(output.recoveryReason, 512);
        return result;
    });
    if (new Set(outputs.map((output) => output.outputId)).size !== outputs.length
        || new Set(outputs.map((output) => output.providerOrdinal)).size !== outputs.length) {
        throw new Error('Duplicate image generation output.');
    }
    const result: ImageGenerationTask = {
        schemaVersion: 1, taskId: id(input.taskId), operationId: id(input.operationId),
        conversationId: id(input.conversationId), stableMessageId: id(input.stableMessageId),
        createdAt: timestamp(input.createdAt), updatedAt: timestamp(input.updatedAt),
        revision: integer(input.revision),
        request: {
            userPrompt: prompt(request.userPrompt), submittedPrompt: prompt(request.submittedPrompt),
            operation: request.operation as ImageGenerationTask['request']['operation'],
            model: text(request.model, 128), count: integer(request.count, 1, 16),
            ...(request.totalCount !== undefined ? { totalCount: integer(request.totalCount, 1, 4) } : {}),
            inputRefs: refs(request.inputRefs),
        },
        connection: {
            mode: connection.mode as ImageGenerationTask['connection']['mode'],
            endpointIdentity: text(connection.endpointIdentity, 512),
            credentialSlot: text(connection.credentialSlot, 256),
            revision: integer(connection.revision),
        },
        state: input.state as ImageGenerationState,
        outputs,
    };
    if (request.size !== undefined) result.request.size = text(request.size, 64);
    if (request.parentVersionId !== undefined) result.request.parentVersionId = id(request.parentVersionId);
    if (request.promptOrigin !== undefined) result.request.promptOrigin = promptOrigin(request.promptOrigin);
    if (request.inputLineage !== undefined) {
        const inputLineage = cloneInputLineage(request.inputLineage);
        if (!inputLineage) throw new Error('Invalid image request lineage.');
        result.request.inputLineage = inputLineage;
    }
    if (request.attachmentPathHint !== undefined) {
        result.request.attachmentPathHint = text(request.attachmentPathHint, 1024);
    }
    if (input.providerTaskId !== undefined) result.providerTaskId = text(input.providerTaskId, 256);
    if (input.providerRequestId !== undefined) result.providerRequestId = text(input.providerRequestId, 256);
    if (input.lastProviderState !== undefined) result.lastProviderState = text(input.lastProviderState, 128);
    if (input.nextPollAt !== undefined) result.nextPollAt = integer(input.nextPollAt);
    if (input.requiresSourceReceipt !== undefined) {
        if (typeof input.requiresSourceReceipt !== 'boolean') throw new Error('Invalid image source receipt marker.');
        result.requiresSourceReceipt = input.requiresSourceReceipt;
    }
    if (input.stopIntent !== undefined) {
        if (typeof input.stopIntent !== 'boolean') throw new Error('Invalid image generation stop intent.');
        result.stopIntent = input.stopIntent;
    }
    if (input.deliverySuppressed !== undefined) {
        if (typeof input.deliverySuppressed !== 'boolean') throw new Error('Invalid image generation delivery flag.');
        result.deliverySuppressed = input.deliverySuppressed;
    }
    if (input.inputWhiteBackgroundApplied !== undefined) {
        if (typeof input.inputWhiteBackgroundApplied !== 'boolean') throw new Error('Invalid image input adjustment.');
        result.inputWhiteBackgroundApplied = input.inputWhiteBackgroundApplied;
    }
    if (input.inputWhiteBackgroundApproved !== undefined) {
        if (typeof input.inputWhiteBackgroundApproved !== 'boolean') throw new Error('Invalid image input approval.');
        result.inputWhiteBackgroundApproved = input.inputWhiteBackgroundApproved;
    }
    if (input.recoveryReason !== undefined) result.recoveryReason = text(input.recoveryReason, 512);
    return result;
}

export function cloneGeneratedImageVersion(value: unknown): GeneratedImageVersion {
    const input = object(value);
    if (input.schemaVersion !== 1) throw new Error('Unsupported generated image version.');
    const result: GeneratedImageVersion = {
        schemaVersion: 1, versionId: id(input.versionId), taskId: id(input.taskId),
        outputId: id(input.outputId), assetRef: cloneImageRef(input.assetRef),
        inputRefs: refs(input.inputRefs), createdAt: timestamp(input.createdAt),
        model: text(input.model, 128), submittedPrompt: prompt(input.submittedPrompt),
    };
    if (input.parentVersionId !== undefined) result.parentVersionId = id(input.parentVersionId);
    return result;
}

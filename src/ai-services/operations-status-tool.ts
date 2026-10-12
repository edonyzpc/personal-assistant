import type { ChatToolDefinition } from './chat-tool-types';
import { throwIfAborted } from './chat-utils';
import type { OperationsExecutionResult, OperationExecutionStatus, OperationsFailureCategory,
    NoteImageRemovalEffectStatus } from './operations/types';

export const GET_OPERATIONS_STATUS = 'get_operations_status';

export interface GetOperationsStatusInput {
    intentId: string;
}

export interface OperationsStatusObservation {
    intentId: string;
    available: boolean;
    state?: string;
    effects?: Array<{ key: 'note' | 'attachment'; status: string }>;
    undoAvailable?: boolean;
    reason?: 'not_visible' | 'owner_unavailable';
    blockedReason?: 'shared_reference';
}

export interface OperationsStatusHost {
    read(input: GetOperationsStatusInput, signal?: AbortSignal): Promise<OperationsStatusObservation>;
}

/** A finite projection of the controller's result, independent of note bodies,
 * paths and recovery snapshots. The original call still retains its ancestry. */
export interface OperationsResultObservation {
    intentId: string;
    state: OperationsExecutionResult['state'];
    operations: Array<{
        operationId: string;
        toolCallId: string;
        status: OperationExecutionStatus;
        receiptId?: string;
        effects?: Array<{ key: 'note' | 'attachment'; status: NoteImageRemovalEffectStatus }>;
        failureCategory?: OperationsFailureCategory;
    }>;
    undoAvailable: boolean;
}

export function operationsResultObservation(execution: OperationsExecutionResult,
    toolCallId?: string): OperationsResultObservation {
    const operations = execution.operations.filter(operation => toolCallId === undefined || operation.toolCallId === toolCallId);
    return {
        intentId: execution.intentId,
        state: execution.state,
        operations: operations.map(operation => ({
            operationId: operation.operationId, toolCallId: operation.toolCallId, status: operation.status,
            ...(operation.receiptId ? { receiptId: operation.receiptId } : {}),
            ...(operation.effects ? { effects: operation.effects.map(effect => ({ key: effect.key, status: effect.status })) } : {}),
            ...(operation.failureCategory ? { failureCategory: operation.failureCategory } : {}),
        })),
        undoAvailable: operations.some(operation => operation.undoAvailable === true),
    };
}

const safeIdentity = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,256}$/.test(value);
const RESULT_STATES = new Set(['executing', 'completed', 'partial', 'failed', 'unknown']);
const OPERATION_STATUSES = new Set(['succeeded', 'unchanged', 'failed', 'stale', 'skipped', 'partial', 'unknown']);
const FAILURE_CATEGORIES = new Set(['schema_invalid', 'path_rejected', 'boundary_denied', 'target_missing',
    'target_collision', 'parent_missing', 'stale_target', 'transform_failed', 'expired', 'cancelled',
    'already_executed', 'fs_error', 'undo_unavailable', 'unknown']);

export function isOperationsResultObservation(value: unknown): value is OperationsResultObservation {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const observation = value as Record<string, unknown>;
    if (Object.keys(observation).some(key => !['intentId', 'state', 'operations', 'undoAvailable'].includes(key))
        || !safeIdentity(observation.intentId) || typeof observation.state !== 'string'
        || !RESULT_STATES.has(observation.state) || typeof observation.undoAvailable !== 'boolean'
        || !Array.isArray(observation.operations)) return false;
    const ids = new Set<string>();
    for (const candidate of observation.operations) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
        const operation = candidate as Record<string, unknown>;
        if (Object.keys(operation).some(key => !['operationId', 'toolCallId', 'status', 'receiptId', 'effects', 'failureCategory'].includes(key))
            || !safeIdentity(operation.operationId) || !safeIdentity(operation.toolCallId)
            || typeof operation.status !== 'string' || !OPERATION_STATUSES.has(operation.status)
            || ids.has(operation.operationId) || operation.receiptId !== undefined && !safeIdentity(operation.receiptId)
            || operation.failureCategory !== undefined && !FAILURE_CATEGORIES.has(operation.failureCategory as string)) return false;
        ids.add(operation.operationId);
        if (operation.effects !== undefined && (!Array.isArray(operation.effects)
            || operation.effects.some(effect => !isOperationsEffect(effect)))) return false;
    }
    return true;
}

const STATUS_VALUES = new Set([
    'pending', 'executing', 'completed', 'partial', 'failed', 'unknown',
    'expired', 'cancelled', 'undone', 'unavailable', 'lost', 'running', 'prepared', 'blocked',
]);
const EFFECT_KEYS = new Set(['note', 'attachment']);
const EFFECT_STATUSES = new Set([
    'not_started', 'applied', 'removed', 'failed', 'unknown', 'restored',
]);

function isOperationsEffect(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const effect = value as Record<string, unknown>;
    return Object.keys(effect).every(key => ['key', 'status'].includes(key))
        && typeof effect.key === 'string' && EFFECT_KEYS.has(effect.key)
        && typeof effect.status === 'string' && EFFECT_STATUSES.has(effect.status);
}

export function isOperationsStatusObservation(value: unknown): value is OperationsStatusObservation {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const observation = value as Record<string, unknown>;
    const intentId = observation.intentId;
    if (typeof intentId !== 'string'
        || !/^[A-Za-z0-9:_-]{1,256}$/.test(intentId)
        || typeof observation.available !== 'boolean'
        || Object.keys(observation).some(key => !['intentId', 'available', 'state', 'effects', 'undoAvailable', 'reason', 'blockedReason'].includes(key))) {
        return false;
    }
    if (observation.state !== undefined && typeof observation.state !== 'string') return false;
    if (observation.state !== undefined && !STATUS_VALUES.has(observation.state)) return false;
    if (observation.undoAvailable !== undefined && typeof observation.undoAvailable !== 'boolean') return false;
    const reason = observation.reason;
    if (reason !== undefined && reason !== 'not_visible' && reason !== 'owner_unavailable') return false;
    if (observation.state === 'blocked' || observation.blockedReason !== undefined) {
        if (observation.blockedReason !== 'shared_reference' || observation.available !== true
            || observation.state !== 'blocked' || observation.undoAvailable !== false
            || observation.effects !== undefined || reason !== undefined) return false;
    }
    const effects = observation.effects;
    if (effects !== undefined && (!Array.isArray(effects)
        || effects.some(effect => !effect || typeof effect !== 'object'
            || Object.keys(effect).some(key => !['key', 'status'].includes(key))
            || typeof (effect as { key?: unknown }).key !== 'string'
            || !EFFECT_KEYS.has((effect as { key?: unknown }).key as string)
            || typeof (effect as { status?: unknown }).status !== 'string'
            || !EFFECT_STATUSES.has((effect as { status?: unknown }).status as string)))) {
        return false;
    }
    return true;
}

export function createOperationsStatusTool(host: OperationsStatusHost): ChatToolDefinition<
    GetOperationsStatusInput,
    OperationsStatusObservation
> {
    return {
        name: GET_OPERATIONS_STATUS,
        description: 'Read the current owner-reported status of one visible Operations intent. This read-only check never confirms, retries, resumes, or undoes it.',
        plannerGuidance: [
            'Use this only for an intentId already visible in the current conversation history.',
            'A lost owner or missing intent is not proof that no effect occurred. Report the observation limit without retrying a write.',
            'Read the current status fresh each time; do not infer it from an earlier answer or tool result.',
        ],
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                intentId: { type: 'string', minLength: 1, maxLength: 256 },
            },
            required: ['intentId'],
        },
        permission: 'read-only',
        cost: 'free',
        outputBudgetChars: 1200,
        requiresConfirmation: false,
        failureBehavior: 'recoverable',
        statusMessageText: 'Checking operation status',
        sourceBoundary: 'read-only-tool',
        statusMessage: () => 'Checking operation status',
        validateInput: raw => {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                throw new Error('Operations status input must be an object.');
            }
            const value = raw as Record<string, unknown>;
            if (Object.keys(value).length !== 1 || typeof value.intentId !== 'string'
                || !/^[A-Za-z0-9:_-]{1,256}$/.test(value.intentId)) {
                throw new Error('Operations status requires one valid intentId.');
            }
            return { intentId: value.intentId };
        },
        execute: async (input, context) => {
            throwIfAborted(context.signal);
            const content = await host.read(input, context.signal);
            throwIfAborted(context.signal);
            return { ok: true, tool: GET_OPERATIONS_STATUS, inputSummary: `Operations status ${input.intentId}`, content, sources: [] };
        },
    };
}

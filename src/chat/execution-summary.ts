import type { ToolExecutionOutcome, TurnEndStatus } from '../ai-services/chat-types';
import type { ThinkingActivityRecord, UiTurn } from './types';

export type ThinkingExecutionStepKind =
    | 'preparation'
    | 'context'
    | 'model'
    | 'draft'
    | 'tool';

export interface ThinkingExecutionStep {
    key: string;
    order: number;
    kind: ThinkingExecutionStepKind;
    status: ThinkingActivityRecord['status'];
    runId?: string;
    turnId?: string;
    messageId?: string;
    toolCallId?: string;
    toolName?: string;
    sourceRecordKeys?: string[];
    operationId?: string;
    outcome?: ToolExecutionOutcome | TurnEndStatus | string;
}

export interface ThinkingDebugNodeRef {
    captureId: string;
    nodeId: string;
    turnId?: string;
    messageId?: string;
    toolCallId?: string;
    kind: 'reasoning' | 'tool';
}

export interface ThinkingExecutionSummary {
    version: 1;
    runtimeRunId?: string;
    elapsedMs?: number;
    steps: ThinkingExecutionStep[];
    debug?: {
        captureId: string;
        nodes: ThinkingDebugNodeRef[];
    };
}

function cloneNonemptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function cloneNonemptyStringList(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const ids = value.map(id => cloneNonemptyString(id)).filter((id): id is string => Boolean(id));
    return ids.length === value.length && ids.length > 0 ? [...new Set(ids)] : undefined;
}

function cloneStep(value: unknown, index: number): ThinkingExecutionStep | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    const key = cloneNonemptyString(record.key);
    const kind = record.kind;
    const status = record.status;
    if (!key
        || !['preparation', 'context', 'model', 'draft', 'tool'].includes(String(kind))
        || !['active', 'succeeded', 'reused', 'failed', 'stopped', 'skipped', 'unknown'].includes(String(status))) {
        return undefined;
    }
    const order = record.order;
    return {
        key,
        order: typeof order === 'number' && Number.isSafeInteger(order) && order >= 0 ? order : index,
        kind: kind as ThinkingExecutionStepKind,
        status: status as ThinkingExecutionStep['status'],
        ...(cloneNonemptyString(record.runId) ? { runId: cloneNonemptyString(record.runId) } : {}),
        ...(cloneNonemptyString(record.turnId) ? { turnId: cloneNonemptyString(record.turnId) } : {}),
        ...(cloneNonemptyString(record.messageId) ? { messageId: cloneNonemptyString(record.messageId) } : {}),
        ...(cloneNonemptyString(record.toolCallId) ? { toolCallId: cloneNonemptyString(record.toolCallId) } : {}),
        ...(cloneNonemptyString(record.toolName) ? { toolName: cloneNonemptyString(record.toolName) } : {}),
        ...(cloneNonemptyStringList(record.sourceRecordKeys)
            ? { sourceRecordKeys: cloneNonemptyStringList(record.sourceRecordKeys) }
            : {}),
        ...(cloneNonemptyString(record.operationId) ? { operationId: cloneNonemptyString(record.operationId) } : {}),
        ...(cloneNonemptyString(record.outcome) ? { outcome: cloneNonemptyString(record.outcome) } : {}),
    };
}

export function cloneThinkingExecutionSummary(value: unknown): ThinkingExecutionSummary | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    if (record.version !== 1) return undefined;
    const elapsedMs = record.elapsedMs;
    if (elapsedMs !== undefined
        && (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs < 0)) {
        return undefined;
    }
    if (!Array.isArray(record.steps)) return undefined;
    const steps = record.steps
        .map((step, index) => cloneStep(step, index))
        .filter((step): step is ThinkingExecutionStep => Boolean(step));
    if (steps.length !== record.steps.length || new Set(steps.map(step => step.key)).size !== steps.length) return undefined;

    const debugRecord = record.debug;
    let debug: ThinkingExecutionSummary['debug'];
    if (debugRecord && typeof debugRecord === 'object') {
        const capture = debugRecord as Record<string, unknown>;
        const captureId = cloneNonemptyString(capture.captureId);
        const nodes = Array.isArray(capture.nodes) ? capture.nodes : [];
        if (!captureId) return undefined;
        const clonedNodes: ThinkingDebugNodeRef[] = [];
        for (const nodeValue of nodes) {
            if (!nodeValue || typeof nodeValue !== 'object') return undefined;
            const node = nodeValue as Record<string, unknown>;
            const nodeId = cloneNonemptyString(node.nodeId);
            const nodeCaptureId: string | undefined = cloneNonemptyString(node.captureId) ?? captureId;
            const kind = node.kind;
            if (!nodeId || nodeCaptureId !== captureId || !['reasoning', 'tool'].includes(String(kind))) return undefined;
            clonedNodes.push({
                captureId: nodeCaptureId,
                nodeId,
                ...(cloneNonemptyString(node.turnId) ? { turnId: cloneNonemptyString(node.turnId) } : {}),
                ...(cloneNonemptyString(node.messageId) ? { messageId: cloneNonemptyString(node.messageId) } : {}),
                ...(cloneNonemptyString(node.toolCallId) ? { toolCallId: cloneNonemptyString(node.toolCallId) } : {}),
                kind: kind as ThinkingDebugNodeRef['kind'],
            });
        }
        debug = { captureId, nodes: clonedNodes };
    }

    return {
        version: 1,
        ...(cloneNonemptyString(record.runtimeRunId)
            ? { runtimeRunId: cloneNonemptyString(record.runtimeRunId) }
            : {}),
        ...(elapsedMs === undefined ? {} : { elapsedMs }),
        steps,
        ...(debug ? { debug } : {}),
    };
}

export function createThinkingExecutionSummary(turn: UiTurn): ThinkingExecutionSummary {
    const canonical = turn.canonicalLifecycle;
    const terminalStatus = canonical.terminalStatus;
    const phaseStatus = terminalStatus === 'error'
        ? 'failed'
        : terminalStatus === 'aborted'
            ? 'stopped'
                : terminalStatus === 'incomplete'
                    ? 'unknown'
                    : terminalStatus === undefined
                        ? (turn.chatDeliveredAt === undefined ? 'active' : 'succeeded')
                        : 'succeeded';
    const steps = canonical.thinkingActivityOrder
        .map((key, index) => {
            const activity = canonical.thinkingActivities.get(key);
            if (!activity?.executionKind) return undefined;
            const status = activity.executionKind !== 'tool' && activity.status === 'active'
                ? phaseStatus
                : activity.status;
            const step: ThinkingExecutionStep = {
                key: activity.key,
                order: index,
                kind: activity.executionKind,
                status,
                ...(activity.runId ? { runId: activity.runId } : {}),
                ...(activity.turnId ? { turnId: activity.turnId } : {}),
                ...(activity.messageId ? { messageId: activity.messageId } : {}),
                ...(activity.toolCallId ? { toolCallId: activity.toolCallId } : {}),
                    ...(activity.toolName ? { toolName: activity.toolName } : {}),
                    ...(activity.sourceRecordKeys ? { sourceRecordKeys: [...activity.sourceRecordKeys] } : {}),
                    ...(activity.operationId ? { operationId: activity.operationId } : {}),
                ...(activity.outcome ? { outcome: activity.outcome } : {}),
            };
            return step;
        })
        .filter((step): step is ThinkingExecutionStep => Boolean(step));
    const debugNodes = [...turn.debugNodeRefs.values()];
    return {
        version: 1,
        ...(canonical.runId ? { runtimeRunId: canonical.runId } : {}),
        ...(turn.chatDeliveredAt !== undefined
            ? { elapsedMs: Math.max(0, turn.chatDeliveredAt - turn.chatStartedAt) }
            : {}),
        steps,
        ...(turn.debugCaptureId
            ? { debug: { captureId: turn.debugCaptureId, nodes: debugNodes } }
            : {}),
    };
}

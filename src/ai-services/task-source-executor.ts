import type { PaAgentToolExecutor, PaAgentToolExecutionResult, ParsedBufferedToolCall } from './pa-agent-types';
import type { TaskMaterialRead, TaskSourceConstraint, TaskSourceConstraintState } from './task-source-constraint';
import type { NoteSearchScope } from '../vss/types';

const RETIRED_SOURCE_CONTROLS = new Set(['declare_source_scope', 'request_source_decision']);

export interface TaskSourceReadPlan {
    /** Actual host-resolved reads, never model-supplied permissions. */
    reads: readonly TaskMaterialRead[];
    /** New output targets whose existence may be checked, never their old body. */
    outputTargetPaths?: readonly string[];
}

interface TaskSourceExecutorHost {
    baseExecutor: PaAgentToolExecutor;
    state: TaskSourceConstraintState;
    resolveHostNoteId(path: string): string | undefined;
    isHostCurrent(): boolean;
    isWebAllowed?(): boolean;
    isMemoryAllowed?(): boolean;
    isInputCurrent?(calls: readonly ParsedBufferedToolCall[]): boolean;
    captureInputSourceValidity?(calls: readonly ParsedBufferedToolCall[]): (() => boolean) | undefined;
    resolveNoteSearchScope?(constraint: TaskSourceConstraint): NoteSearchScope;
}

/** Read-plan resolution must inspect only Host facts, without preparing or reading sources. */
export type TaskSourceExecutorOptions = TaskSourceExecutorHost & ({
    resolveReadPlan(call: ParsedBufferedToolCall): TaskSourceReadPlan | undefined;
    resolveReadPlans?: never;
} | {
    resolveReadPlans(calls: readonly ParsedBufferedToolCall[]): ReadonlyMap<string, TaskSourceReadPlan>
        | { rejectionReason: 'source_excluded' | 'source_read_plan_unavailable' } | undefined;
    resolveReadPlan?: never;
});

/** Atomically bind the complete model phase to live Host identities and settings. */
export function createTaskSourceConstrainedExecutor(options: TaskSourceExecutorOptions): PaAgentToolExecutor {
    const base = options.baseExecutor;
    return {
        execute: base.execute.bind(base),
        prepareBatch: base.prepareBatch?.bind(base),
        getCanonicalToolCallKey: base.getCanonicalToolCallKey?.bind(base),
        getExecutionMode: base.getExecutionMode?.bind(base),
        getTimeoutMs: base.getTimeoutMs?.bind(base),
        getRetrySafety: base.getRetrySafety?.bind(base),
        canReuseSuccessfulResult: base.canReuseSuccessfulResult?.bind(base),
        preflightBatch: input => {
            const isInputCurrent = () => options.isHostCurrent()
                && options.isInputCurrent?.(input.toolCalls) !== false;
            if (!options.state.matchesRun(input.runId, input.userInput) || !isInputCurrent()) {
                return rejectScope('source_run_changed');
            }
            if (input.toolCalls.some(call => call.parseError)
                || new Set(input.toolCalls.map(call => call.id)).size !== input.toolCalls.length) {
                return rejectScope('invalid_source_batch');
            }
            // A historical model call must never reactivate the retired protocol.
            if (input.toolCalls.some(call => RETIRED_SOURCE_CONTROLS.has(call.name))) {
                return rejectScope('source_control_unavailable');
            }
            const constraint = options.state.snapshot();
            const outputTargets = new Set<string>();
            const batchResult = options.resolveReadPlans?.(input.toolCalls);
            if (batchResult && 'rejectionReason' in batchResult) return rejectScope(batchResult.rejectionReason);
            const batchPlans = batchResult;
            if (options.resolveReadPlans && (!batchPlans || batchPlans.size !== input.toolCalls.length
                || input.toolCalls.some(call => !batchPlans.has(call.id)))) {
                return rejectScope('source_read_plan_unavailable');
            }
            for (const call of input.toolCalls) {
                const plan = batchPlans ? batchPlans.get(call.id) : options.resolveReadPlan?.(call);
                if (!plan || !Array.isArray(plan.reads)
                    || (plan.outputTargetPaths !== undefined && (!Array.isArray(plan.outputTargetPaths)
                        || plan.outputTargetPaths.some(path => typeof path !== 'string' || !path.trim())))) {
                    return rejectScope('source_read_plan_unavailable');
                }
                if (plan.reads.some(read => !options.state.allows(read, constraint))) {
                    return rejectScope('source_read_outside_scope');
                }
                for (const path of plan.outputTargetPaths ?? []) outputTargets.add(path);
            }
            const baseResult = base.preflightBatch?.(input);
            if (baseResult !== undefined) {
                return 'kind' in baseResult ? rejectScope('conflicting_source_admission') : baseResult;
            }
            if (!isInputCurrent() || !options.state.isCurrent(constraint)) {
                return rejectScope('source_run_changed');
            }
            const sourceValidity = options.captureInputSourceValidity?.(input.toolCalls);
            if (sourceValidity && !sourceValidity()) return rejectScope('source_run_changed');
            return { kind: 'admitted',
                taskSourceReadGuard: options.state.createReadGuard(
                    constraint, options.resolveHostNoteId, isInputCurrent,
                    path => outputTargets.has(path),
                    options.resolveNoteSearchScope ? () => options.resolveNoteSearchScope!(constraint) : undefined,
                    options.isWebAllowed,
                    options.isMemoryAllowed,
                    sourceValidity,
                ) };
        },
    };
}

function rejectScope(reason: string): PaAgentToolExecutionResult {
    return {
        outcome: 'policy_rejected',
        promptText: reason === 'source_excluded'
            ? 'The requested note is excluded by the Data Boundary settings. The Host did not provide its content. Supplying a path or reopening the note cannot override this setting. Explain the exclusion, and ask the user to change that setting only if they want this note used.'
            : reason === 'source_read_plan_unavailable'
            ? 'No source reads were admitted for this batch (source_read_plan_unavailable). The target may be unavailable, excluded by Data Boundary settings, or no longer the current note. Do not repeat unchanged calls or tell the user that supplying a path alone grants access to an excluded source. Use another actually available source or explain the missing evidence and the relevant setting to check.'
            : `No source reads were admitted for this batch (${reason}). Correct the tool calls within current Host settings and source availability.`,
        includeInNextPrompt: true,
        metadata: { reason, preflightOnly: true, batchPreflightRejected: true },
    };
}

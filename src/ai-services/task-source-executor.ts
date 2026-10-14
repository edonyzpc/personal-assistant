import type { PaAgentToolExecutor, PaAgentToolExecutionResult, ParsedBufferedToolCall } from './pa-agent-types';
import type { TaskMaterialRead, TaskSourceConstraint, TaskSourceConstraintState } from './task-source-constraint';
import type { NoteSearchScope } from '../vss/types';
import { throwIfAborted } from './chat-utils';
import type { TaskSourceReadGuard } from './task-source-read-guard';

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
    resolveHostNoteId(this: void, path: string): string | undefined;
    isHostCurrent(): boolean;
    isWebAllowed?(this: void): boolean;
    isMemoryAllowed?(this: void): boolean;
    isCreatedResourcePathAllowed?(this: void, path: string): boolean;
    isInputCurrent?(calls: readonly ParsedBufferedToolCall[]): boolean;
    captureInputSourceValidity?(calls: readonly ParsedBufferedToolCall[]): (() => boolean) | undefined;
    prepareInputSourceAdmission?(
        calls: readonly ParsedBufferedToolCall[],
        signal?: AbortSignal,
        inputLineage?: import('./input-lineage').InputLineage,
    ): Promise<{
        isCurrent(): boolean;
        sourceValidity(this: void): boolean;
        authorityValidity(this: void): boolean;
    }>;
    resolveNoteSearchScope?(constraint: TaskSourceConstraint): NoteSearchScope;
}

/** Read-plan resolution must inspect only Host facts, without preparing or reading sources. */
export type TaskSourceExecutorOptions = TaskSourceExecutorHost & ({
    resolveReadPlan(call: ParsedBufferedToolCall): TaskSourceReadPlan | undefined;
    resolveReadPlans?: never;
} | {
    resolveReadPlans(calls: readonly ParsedBufferedToolCall[]): ReadonlyMap<string, TaskSourceReadPlan>
        | { rejectionReason: 'source_excluded' | 'source_read_plan_unavailable' }
        | { rejectionReason: 'schema_invalid'; message: string } | undefined;
    resolveReadPlan?: never;
});

/** Atomically bind the complete model phase to live Host identities and settings. */
export function createTaskSourceConstrainedExecutor(options: TaskSourceExecutorOptions): PaAgentToolExecutor {
    const base = options.baseExecutor;
    return {
        execute: base.execute.bind(base),
        prepareBatch: base.prepareBatch?.bind(base),
        getAttemptObservation: base.getAttemptObservation?.bind(base),
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
            if (batchResult && 'rejectionReason' in batchResult) {
                if (batchResult.rejectionReason === 'schema_invalid') return {
                    outcome: 'schema_invalid', promptText: batchResult.message, includeInNextPrompt: true,
                    executionState: 'not_started',
                    metadata: { reason: 'schema_invalid', preflightOnly: true, batchPreflightRejected: true },
                };
                return rejectScope(batchResult.rejectionReason);
            }
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
            let preparedAdmission: {
                isCurrent(): boolean;
                sourceValidity(this: void): boolean;
                authorityValidity(this: void): boolean;
            } | undefined;
            const checkpoint = options.prepareInputSourceAdmission ? async (signal?: AbortSignal) => {
                throwIfAborted(signal);
                if (!isInputCurrent() || !options.state.isCurrent(constraint)) {
                    throw new Error('Task source admission is no longer current.');
                }
                // The strict authority epoch seals the whole lineage. A cooperative
                // yield only needs a new proof when that authority has changed.
                if (preparedAdmission?.isCurrent()) return;
                preparedAdmission = await options.prepareInputSourceAdmission!(
                    input.toolCalls,
                    signal,
                    input.inputLineage,
                );
                if (!isInputCurrent() || !options.state.isCurrent(constraint) || !preparedAdmission.isCurrent()) {
                    throw new Error('Task source admission changed during preparation.');
                }
            } : undefined;
            const guard = options.state.createReadGuard(
                    constraint, options.resolveHostNoteId, isInputCurrent,
                    path => outputTargets.has(path),
                    options.resolveNoteSearchScope ? () => options.resolveNoteSearchScope!(constraint) : undefined,
                    options.isWebAllowed,
                    options.isMemoryAllowed,
                    options.prepareInputSourceAdmission ? () => preparedAdmission?.isCurrent() === true : sourceValidity,
                    checkpoint,
                    options.prepareInputSourceAdmission ? () => preparedAdmission?.sourceValidity ?? (() => false) : undefined,
                    options.prepareInputSourceAdmission
                        ? () => preparedAdmission?.authorityValidity ?? (() => false)
                        : undefined,
                );
            const withCreatedOutputs = (bound: TaskSourceReadGuard): TaskSourceReadGuard => ({
                ...bound,
                isPathAllowed: (path, kind) => bound.isPathAllowed(path, kind)
                    || bound.isCurrent() && options.isCreatedResourcePathAllowed!(path),
                ...(bound.captureAuthorityGuard ? { captureAuthorityGuard: () => withCreatedOutputs(bound.captureAuthorityGuard!()) } : {}),
            });
            return { kind: 'admitted', taskSourceReadGuard: options.isCreatedResourcePathAllowed ? withCreatedOutputs(guard) : guard };
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

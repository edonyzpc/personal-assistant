import type { ChatToolProviderSchema } from './chat-tool-types';
import type { PaAgentToolExecutor, PaAgentToolExecutionResult, ParsedBufferedToolCall } from './pa-agent-types';
import type { TaskMaterialRead, TaskSourceConstraintState } from './task-source-constraint';
import { toolConstraintsFromAgentControlSnapshot } from './pa-agent-control-policy';
import type { TaskSourceConstraint } from './task-source-constraint';
import type { NoteSearchScope } from '../vss/types';

export const DECLARE_SOURCE_SCOPE = 'declare_source_scope';

/** Runtime control schema, not a registry capability or an executable source. */
export function createTaskSourceDeclarationSchema(): ChatToolProviderSchema {
    return {
        type: 'function',
        function: {
            name: DECLARE_SOURCE_SCOPE,
            description: 'State the current user request\'s task-material boundary before new source reads. May accompany the source calls in the same response. Personalization remains independently governed. This never authorizes writes.',
            parameters: {
                type: 'object', additionalProperties: false,
                properties: {
                    instructionQuote: { type: 'string', description: 'Exact, uniquely located quote from the current user message supporting your interpretation. For an unrestricted request, quote the request itself.' },
                    notes: { type: 'string', enum: ['current_note', 'selected', 'vault', 'none'] },
                    noteHandles: { type: 'array', items: { type: 'string' }, description: 'Required only for selected: host-provided note handles. Never invent handles or use paths as handles.' },
                    excludedNoteHandles: { type: 'array', items: { type: 'string' } },
                    webAllowed: { type: 'boolean' },
                },
                required: ['instructionQuote', 'notes', 'webAllowed'],
            },
        },
    };
}

export interface TaskSourceReadPlan {
    /** Actual host-resolved reads, not model-supplied permission or purpose labels. */
    reads: readonly TaskMaterialRead[];
    /** Exact proposed output targets whose existence may be inspected, never their old body. */
    outputTargetPaths?: readonly string[];
}

interface TaskSourceExecutorHost {
    baseExecutor: PaAgentToolExecutor;
    state: TaskSourceConstraintState;
    resolveHostNoteId(path: string): string | undefined;
    isHostCurrent(): boolean;
    resolveNoteSearchScope?(constraint: TaskSourceConstraint): NoteSearchScope;
}

/** Pure validation over raw arguments; neither resolver may prepare or read sources. */
export type TaskSourceExecutorOptions = TaskSourceExecutorHost & ({
    resolveReadPlan(call: ParsedBufferedToolCall): TaskSourceReadPlan | undefined;
    resolveReadPlans?: never;
} | {
    /** Receives the complete ordered batch without the scope declaration. */
    resolveReadPlans(calls: readonly ParsedBufferedToolCall[]): ReadonlyMap<string, TaskSourceReadPlan> | undefined;
    resolveReadPlan?: never;
});

/** One host admission over the complete model phase, including its optional scope declaration. */
export function createTaskSourceConstrainedExecutor(options: TaskSourceExecutorOptions): PaAgentToolExecutor {
    const base = options.baseExecutor;
    return {
        execute: base.execute.bind(base),
        prepareBatch: base.prepareBatch?.bind(base),
        getCanonicalToolCallKey: base.getCanonicalToolCallKey?.bind(base),
        getExecutionMode: base.getExecutionMode?.bind(base),
        preflightBatch: input => {
            if (!options.state.matchesRun(input.runId, input.userInput) || !options.isHostCurrent()) {
                return rejectScope('source_run_changed');
            }
            if (input.toolCalls.some(call => call.parseError)
                || new Set(input.toolCalls.map(call => call.id)).size !== input.toolCalls.length) {
                return rejectScope('invalid_source_batch');
            }
            const declarations = input.toolCalls.filter(call => call.name === DECLARE_SOURCE_SCOPE);
            if (declarations.length > 1) return rejectScope('multiple_source_declarations');
            const declaration = declarations[0];
            const controls = toolConstraintsFromAgentControlSnapshot(input.controlSnapshot);
            if (declaration && (controls?.blockedToolNames?.has(DECLARE_SOURCE_SCOPE)
                || (controls?.allowedToolNames !== undefined && !controls.allowedToolNames.has(DECLARE_SOURCE_SCOPE)))) {
                return rejectScope('source_declaration_disabled');
            }
            const prepared = declaration ? options.state.prepareDeclaration(declaration.input) : undefined;
            if (prepared && !prepared.ok) return rejectScope(prepared.reason);
            const constraint = prepared?.ok ? prepared.constraint : options.state.snapshot();
            const outputTargets = new Set<string>();
            const sourceCalls = input.toolCalls.filter(call => call !== declaration);
            const batchPlans = options.resolveReadPlans?.(sourceCalls);
            if (options.resolveReadPlans && (!batchPlans || batchPlans.size !== sourceCalls.length
                || sourceCalls.some(call => !batchPlans.has(call.id)))) {
                return rejectScope('source_read_plan_unavailable');
            }
            for (const call of sourceCalls) {
                const plan = batchPlans ? batchPlans.get(call.id) : options.resolveReadPlan?.(call);
                if (!plan || !Array.isArray(plan.reads)
                    || (plan.outputTargetPaths !== undefined && (!Array.isArray(plan.outputTargetPaths)
                        || plan.outputTargetPaths.some(path => typeof path !== 'string' || !path.trim())))) {
                    return rejectScope('source_read_plan_unavailable');
                }
                if (plan.reads.some(read => !options.state.allows(read, constraint))) {
                    return rejectScope(constraint ? 'source_read_outside_scope' : 'source_declaration_required');
                }
                for (const path of plan.outputTargetPaths ?? []) outputTargets.add(path);
            }
            // Existing host rejection gates run before the candidate is committed.
            // A second source-admission owner cannot silently replace this scope.
            const baseResult = base.preflightBatch?.(input);
            if (baseResult !== undefined) {
                return 'kind' in baseResult ? rejectScope('conflicting_source_admission') : baseResult;
            }
            if (!options.isHostCurrent()) return rejectScope('source_run_changed');
            if (prepared?.ok ? !options.state.commit(prepared.constraint)
                : constraint !== undefined && !options.state.isCurrent(constraint)) {
                return rejectScope('source_scope_changed');
            }
            return {
                kind: 'admitted',
                taskSourceReadGuard: constraint ? options.state.createReadGuard(
                    constraint, options.resolveHostNoteId, options.isHostCurrent, path => outputTargets.has(path),
                    options.resolveNoteSearchScope ? () => options.resolveNoteSearchScope!(constraint) : undefined,
                ) : {
                    isCurrent: options.isHostCurrent,
                    isPathAllowed: (path, kind) => options.isHostCurrent()
                        && kind === 'output_target_exists' && outputTargets.has(path),
                },
                controlResults: new Map(declaration ? [[declaration.id, {
                    outcome: 'control_applied',
                    promptText: 'Task-material scope accepted. Personalization, Memory controls, source exclusions and write confirmation remain independently enforced.',
                    metadata: { sourceScopeControl: true, preflightOnly: true, scopeRevision: constraint!.revision },
                }]] : []),
            };
        },
    };
}

function rejectScope(reason: string): PaAgentToolExecutionResult {
    return {
        outcome: 'policy_rejected',
        promptText: `No source reads were admitted for this batch (${reason}). Correct the scope declaration or source calls using the current user request and host-provided handles.`,
        metadata: { reason, sourceScopeControl: true, preflightOnly: true },
    };
}

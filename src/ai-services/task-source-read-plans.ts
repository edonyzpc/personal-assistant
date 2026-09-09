import { normalizeVaultPath } from '../pa/helpers';
import { validateVaultRelativeTargetPath } from './chat-tool-execution-helpers';
import {
    validateInspectObsidianNoteInput,
    validateReadCanvasSummaryInput,
    validateReadNoteOutlineInput,
} from './chat-tool-guards';
import { extractInputPath, readFirstString, toInputRecord } from './chat-tool-prepare-helpers';
import { isCoreWriteToolName, validateCoreWriteInput } from './operations/input-validation';
import { validateOperationsVaultPath } from './operations/vault-path';
import type { ParsedBufferedToolCall } from './pa-agent-types';
import type { TaskSourceReadPlan } from './task-source-executor';

export interface TaskSourceReadPlanHost {
    /** Only an already registered, still-live real file may resolve. */
    resolveNoteId(path: string): string | undefined;
    /** The note identity captured for this run, never a newly selected note. */
    currentNoteId(): string | undefined;
    /** The real current Markdown view's path; the caller verifies file identity. */
    actualCurrentNotePath(): string | undefined;
}

export type TaskSourceReadPlansResult =
    | { ok: true; plans: ReadonlyMap<string, TaskSourceReadPlan> }
    | { ok: false; toolCallId: string; reason: 'invalid_call' | 'source_identity_unavailable' | 'unplanned_tool' };

/**
 * Plan the whole raw tool batch without preparing capabilities or reading vault
 * content/metadata. The caller removes its source declaration first. These are
 * read requirements, not scope admission, schema validation or write permission.
 * Query/mode/limit validation remains with each tool; only fields changing the
 * source target are interpreted here.
 */
export function resolveTaskSourceReadPlans(
    calls: readonly ParsedBufferedToolCall[],
    host: TaskSourceReadPlanHost,
): TaskSourceReadPlansResult {
    const ids = new Set<string>();
    for (const call of calls) {
        if (!call.id?.trim() || call.parseError || ids.has(call.id)) {
            return { ok: false, toolCallId: call.id, reason: 'invalid_call' };
        }
        ids.add(call.id);
    }

    const plans = new Map<string, TaskSourceReadPlan>();
    // Operations stage all actions together. The first operation on each path
    // chooses its real baseline; later actions see only that virtual target.
    const operationBaselines = new Map<string, TaskSourceReadPlan>();
    for (const call of calls) {
        try {
            let plan: TaskSourceReadPlan;
            if (isCoreWriteToolName(call.name)) {
                const input = validateCoreWriteInput(call.name, call.input);
                const path = validateOperationsVaultPath(input.path);
                const baseline = operationBaselines.get(path);
                plan = baseline ?? (call.name === 'vault_create'
                    ? { reads: [], outputTargetPaths: [path] }
                    : planNote(path, host));
                operationBaselines.set(path, plan);
            } else {
                switch (call.name) {
                    case 'get_current_note_context':
                        plan = planCurrentNote(host);
                        break;
                    case 'read_note_outline': {
                        const path = extractInputPath(call.input, ['.md']);
                        const input = validateReadNoteOutlineInput(path ? { path } : call.input);
                        plan = planNote(normalizeReadPath(input.path), host);
                        break;
                    }
                    case 'inspect_obsidian_note': {
                        const path = extractInputPath(call.input, ['.md']);
                        const record = toInputRecord(call.input);
                        // Match the tool's existing empty-input/current-note
                        // fallback, including non-object and empty path inputs.
                        const prepared = path ? { path } : !record
                            || (typeof record.path === 'string' && !record.path.trim())
                            ? {} : call.input;
                        const input = validateInspectObsidianNoteInput(prepared);
                        plan = input.path ? planNote(normalizeReadPath(input.path), host) : planCurrentNote(host);
                        break;
                    }
                    case 'read_canvas_summary': {
                        const path = extractInputPath(call.input, ['.canvas']);
                        const input = validateReadCanvasSummaryInput(path ? { path } : call.input);
                        plan = planNote(normalizeReadPath(input.path), host);
                        break;
                    }
                    case 'search_vault_snippets': {
                        const record = toInputRecord(call.input);
                        const scope = record ? readFirstString(record, ['scope', 'path', 'folder', 'file']) : undefined;
                        const path = scope ? normalizeReadPath(validateVaultRelativeTargetPath(
                            scope, ['.md'], 'snippet scope', { allowFolder: true },
                        )) : undefined;
                        plan = path?.toLowerCase().endsWith('.md')
                            ? planNote(path, host) : scopedVaultPlan();
                        break;
                    }
                    case 'search_memory':
                    case 'search_vault_metadata':
                    case 'list_recent_notes':
                    case 'list_vault_tags':
                        // Their actual readers intersect enumeration/retrieval
                        // with the per-call guard. A query's path/tag/filename
                        // alias is search text, not permission for that source.
                        plan = scopedVaultPlan();
                        break;
                    case 'webSearch':
                        plan = { reads: [{ kind: 'web' }] };
                        break;
                    default:
                        // Meta, image and style tools require their own explicit
                        // host plan; capability labels never imply zero reads.
                        return { ok: false, toolCallId: call.id, reason: 'unplanned_tool' };
                }
            }
            plans.set(call.id, freezePlan(plan));
        } catch (error) {
            return { ok: false, toolCallId: call.id, reason: error instanceof SourceIdentityUnavailable
                ? 'source_identity_unavailable' : 'invalid_call' };
        }
    }
    return { ok: true, plans };
}

class SourceIdentityUnavailable extends Error { }

function resolveIdentity(path: string, host: TaskSourceReadPlanHost): string {
    let noteId: string | undefined;
    try { noteId = host.resolveNoteId(path); } catch { throw new SourceIdentityUnavailable(); }
    if (typeof noteId !== 'string' || !noteId.trim()) throw new SourceIdentityUnavailable();
    return noteId;
}

function planNote(path: string, host: TaskSourceReadPlanHost): TaskSourceReadPlan {
    return { reads: [{ kind: 'note', noteId: resolveIdentity(path, host) }] };
}

function planCurrentNote(host: TaskSourceReadPlanHost): TaskSourceReadPlan {
    let currentId: string | undefined;
    let path: string | undefined;
    try {
        currentId = host.currentNoteId();
        path = host.actualCurrentNotePath();
    } catch { throw new SourceIdentityUnavailable(); }
    if (!currentId || !path || resolveIdentity(path, host) !== currentId) throw new SourceIdentityUnavailable();
    return { reads: [{ kind: 'note', noteId: currentId }] };
}

function scopedVaultPlan(): TaskSourceReadPlan {
    return { reads: [{ kind: 'scoped_vault_search' }] };
}

function normalizeReadPath(path: string): string {
    // Match the read factories' boundary normalization. Their leading ./ rule
    // also accepts .//; remove it before reusing the shared vault normalizer.
    const normalized = normalizeVaultPath(path.trim().replace(/\\/g, '/').replace(/^\.\/+/, ''));
    if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)
        || normalized.split('/').some(segment => segment === '..' || segment === '')) {
        throw new Error('Invalid source path.');
    }
    return normalized;
}

function freezePlan(plan: TaskSourceReadPlan): TaskSourceReadPlan {
    return Object.freeze({
        reads: Object.freeze(plan.reads.map(read => Object.freeze({ ...read }))),
        ...(plan.outputTargetPaths ? { outputTargetPaths: Object.freeze([...plan.outputTargetPaths]) } : {}),
    });
}

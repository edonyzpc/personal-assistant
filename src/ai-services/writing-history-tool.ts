import { z } from 'zod';
import type { WritingVersion } from '../chat/writing-types';
import type { WritingVersionService } from '../chat/writing-versions';
import type { ChatToolDefinition, ChatToolInputSchema } from './chat-tool-types';
import type { InputLineage } from './input-lineage';
import { createChatToolCapability } from './capability-adapter';
import { ChatToolFailureError } from './chat-tool-execution-helpers';
import { throwIfAborted } from './chat-utils';

export const READ_WRITING_HISTORY = 'read_writing_history';
export const WRITING_HISTORY_OUTPUT_BUDGET_CHARS = 8000;
const PAGE_SIZE = 10;
const MAX_READ_CHARS = 4000;
const versionId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const inputSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('list'), cursor: versionId.optional() }).strict(),
    z.object({ action: z.literal('read'), versionId, offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().min(2).max(MAX_READ_CHARS).optional() }).strict(),
]);
export type WritingHistoryInput = z.infer<typeof inputSchema>;

export interface WritingHistoryAdmission {
    lineage: InputLineage;
    isCurrent(): boolean;
    isSourceCurrent(): boolean;
    /** Present only when this version is registered in the current Writing run. */
    parentHandle?: string;
}

export interface WritingHistoryEntry {
    versionId: string;
    textHash: string;
    turnIndex: number;
    createdAt: number;
    origin: WritingVersion['origin'];
    totalLength: number;
    parentHandle?: string;
}

export type WritingHistoryObservation =
    | { action: 'list'; versions: WritingHistoryEntry[]; nextCursor: string | null }
    | { action: 'read'; versionId: string; textHash: string; text: string; offset: number; endOffset: number;
        totalLength: number; nextOffset: number | null; complete: boolean; parentHandle?: string };

export interface WritingHistoryHost {
    conversationId: string;
    versions: Pick<WritingVersionService, 'get' | 'list'>;
    isCurrent(): boolean;
    /** Runtime owns sourceRun admission; storage membership alone never authorizes disclosure. */
    admitVersion(version: WritingVersion, signal?: AbortSignal): Promise<WritingHistoryAdmission | undefined>;
    /** Bind the exact observation to its physical projection lineage without model-visible authority fields. */
    onObservation?(observation: WritingHistoryObservation, admissions: readonly WritingHistoryAdmission[]): void;
}

const providerSchema: ChatToolInputSchema = {
    type: 'object', additionalProperties: false, required: ['action'],
    properties: {
        action: { type: 'string', enum: ['list', 'read'] },
        cursor: { type: 'string', description: 'The nextCursor returned by list; omit for the first page.' },
        versionId: { type: 'string', description: 'Required for read. Use a version identity returned by the host.' },
        offset: { type: 'integer', minimum: 0, description: 'UTF-16 text offset. Use nextOffset to continue reading.' },
        limit: { type: 'integer', minimum: 2, maximum: MAX_READ_CHARS,
            description: 'Maximum UTF-16 text units to read; output may be shorter to fit its serialized budget.' },
    },
};

export function createWritingHistoryCapability(host: WritingHistoryHost) {
    const capability = createChatToolCapability(createWritingHistoryTool(host), { providerId: 'writing-history' });
    capability.executionMode = 'sequential';
    return capability;
}

export function createWritingHistoryTool(host: WritingHistoryHost): ChatToolDefinition<WritingHistoryInput, WritingHistoryObservation> {
    const assertCurrent = (signal?: AbortSignal) => {
        throwIfAborted(signal);
        if (!host.isCurrent()) throw new ChatToolFailureError('source_changed', 'Writing history unavailable');
    };
    const assertAdmissions = (admissions: readonly WritingHistoryAdmission[], signal?: AbortSignal) => {
        assertCurrent(signal);
        if (admissions.some(admission => !admission.isCurrent() || !admission.isSourceCurrent())) {
            throw new ChatToolFailureError('source_changed', 'Writing history sources changed');
        }
    };
    const admit = async (version: WritingVersion, signal?: AbortSignal) => {
        assertCurrent(signal);
        if (version.conversationId !== host.conversationId) return undefined;
        const admission = await host.admitVersion(version, signal);
        assertCurrent(signal);
        if (admission) assertAdmissions([admission], signal);
        return admission;
    };
    return {
        name: READ_WRITING_HISTORY,
        description: 'List or read saved Writing versions from the current conversation. This only reads existing works; it does not select a parent or prepare a writing context.',
        inputSchema: providerSchema,
        plannerGuidance: [
            'Use list for available version identities and read for exact text. Continue with nextCursor or nextOffset when present.',
            'For a revision, pass a returned current parentHandle to get_writing_context and wait for its full validated parent before composing.',
        ],
        permission: 'read-only', cost: 'free', outputBudgetChars: WRITING_HISTORY_OUTPUT_BUDGET_CHARS,
        requiresConfirmation: false, failureBehavior: 'recoverable', sourceBoundary: 'read-only-tool',
        statusMessageText: 'Reading writing history', statusMessage: () => 'Reading writing history',
        prepareArguments: raw => inputSchema.parse(raw), validateInput: raw => inputSchema.parse(raw),
        execute: async (raw, context) => {
            const input = inputSchema.parse(raw);
            assertCurrent(context.signal);
            const admissions: WritingHistoryAdmission[] = [];
            let observation: WritingHistoryObservation;
            if (input.action === 'list') {
                const candidates = await host.versions.list(host.conversationId);
                assertCurrent(context.signal);
                let start = 0;
                if (input.cursor) {
                    const cursorIndex = candidates.findIndex(version => version.id === input.cursor);
                    if (cursorIndex < 0 || !await admit(candidates[cursorIndex], context.signal)) {
                        throw new ChatToolFailureError('not_found', 'Writing history cursor unavailable');
                    }
                    start = cursorIndex + 1;
                }
                const entries: WritingHistoryEntry[] = [];
                let hasMore = false;
                for (const version of candidates.slice(start)) {
                    const admission = await admit(version, context.signal);
                    if (!admission) continue;
                    if (entries.length === PAGE_SIZE) { hasMore = true; break; }
                    const entry: WritingHistoryEntry = { versionId: version.id, textHash: version.textHash,
                        turnIndex: version.turnIndex, createdAt: version.createdAt, origin: version.origin,
                        totalLength: version.text.length,
                        ...(admission.parentHandle ? { parentHandle: admission.parentHandle } : {}) };
                    const page = { action: 'list', versions: [...entries, entry], nextCursor: version.id };
                    if (JSON.stringify(page).length > WRITING_HISTORY_OUTPUT_BUDGET_CHARS) {
                        if (!entries.length) throw new Error('Writing history entry exceeds available budget');
                        hasMore = true; break;
                    }
                    entries.push(entry);
                    admissions.push(admission);
                }
                observation = { action: 'list', versions: entries,
                    nextCursor: hasMore ? entries[entries.length - 1].versionId : null };
            } else {
                const version = await host.versions.get(input.versionId);
                assertCurrent(context.signal);
                const admission = version ? await admit(version, context.signal) : undefined;
                if (!version || !admission) throw new ChatToolFailureError('not_found', 'Writing version unavailable');
                const offset = input.offset ?? 0;
                if (offset > version.text.length || splitsSurrogate(version.text, offset)) {
                    throw new Error('Invalid writing text offset');
                }
                let endOffset = Math.min(version.text.length, offset + (input.limit ?? MAX_READ_CHARS));
                if (splitsSurrogate(version.text, endOffset)) endOffset--;
                const read = (): Extract<WritingHistoryObservation, { action: 'read' }> => ({
                    action: 'read', versionId: version.id, textHash: version.textHash,
                    text: version.text.slice(offset, endOffset), offset, endOffset, totalLength: version.text.length,
                    nextOffset: endOffset < version.text.length ? endOffset : null, complete: endOffset === version.text.length,
                    ...(admission.parentHandle ? { parentHandle: admission.parentHandle } : {}),
                });
                observation = read();
                while (JSON.stringify(observation).length > WRITING_HISTORY_OUTPUT_BUDGET_CHARS && endOffset > offset) {
                    endOffset = offset + Math.floor((endOffset - offset) / 2);
                    if (splitsSurrogate(version.text, endOffset)) endOffset--;
                    observation = read();
                }
                if (endOffset === offset && offset < version.text.length) throw new Error('Writing history cannot fit available budget');
                admissions.push(admission);
            }
            if (JSON.stringify(observation).length > WRITING_HISTORY_OUTPUT_BUDGET_CHARS) {
                throw new Error('Writing history exceeds available budget');
            }
            assertAdmissions(admissions, context.signal);
            host.onObservation?.(observation, admissions);
            return { ok: true, tool: READ_WRITING_HISTORY, inputSummary: `Requested writing history ${input.action}`,
                content: observation, sources: [] };
        },
    };
}

function splitsSurrogate(text: string, offset: number): boolean {
    return offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]);
}

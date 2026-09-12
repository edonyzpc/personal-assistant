import { z } from 'zod';
import type { ChatToolDefinition, ChatToolInputSchema } from './chat-tool-types';
import type { ChatWritingStylePreparation } from './chat-types';
import { writingStyleSceneSchema } from '../pa/writing-style';
import { cloneImageRef } from '../chat/image-types';
import { GET_WRITING_CONTEXT, WritingContextRun, writingContextObservation, type PreparedWritingContext } from './writing-context-run';
import { createChatToolCapability } from './capability-adapter';

export { GET_WRITING_CONTEXT } from './writing-context-run';

const selectionSchema = z.object({
    parentHandle: z.string().min(1).nullable(),
    scene: writingStyleSceneSchema.nullable().optional(),
    currentInstructionConflicts: z.boolean(),
    imageRefs: z.array(z.object({ assetId: z.string(), contentHash: z.string() }).strict()),
}).strict();
type Selection = z.infer<typeof selectionSchema>;
type Observation = ReturnType<typeof writingContextObservation>;

const sceneProperties = Object.fromEntries(['writingTask', 'purpose', 'audience', 'domain']
    .map(name => [name, { type: 'string' as const, minLength: 1, maxLength: 64 }]));
const schema: ChatToolInputSchema = {
    type: 'object', additionalProperties: false,
    properties: {
        parentHandle: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        scene: { type: 'object', description: 'A scene object with four short fields. Omit scene when unknown; never encode the object as a string.',
            properties: sceneProperties, required: Object.keys(sceneProperties), additionalProperties: false },
        currentInstructionConflicts: { type: 'boolean' },
        imageRefs: { type: 'array', items: { type: 'object', properties: {
            assetId: { type: 'string' }, contentHash: { type: 'string' },
        }, required: ['assetId', 'contentHash'], additionalProperties: false } },
    }, required: ['parentHandle', 'currentInstructionConflicts', 'imageRefs'],
};

/** A run-owned tool. Runtime must register this exact instance with its source admission. */
interface WritingContextToolHost {
    outputBudgetChars: number;
    getBudget(): Omit<Parameters<ChatWritingStylePreparation>[0], 'signal'>;
    onPrepared?(context: PreparedWritingContext): void;
}

export function createWritingContextCapability(run: WritingContextRun, host: WritingContextToolHost) {
    const capability = createChatToolCapability(createWritingContextTool(run, host), { providerId: 'writing-context' });
    capability.executionMode = 'sequential';
    return capability;
}

export function createWritingContextTool(run: WritingContextRun, host: WritingContextToolHost): ChatToolDefinition<Selection, Observation> {
    const outputBudgetChars = host.outputBudgetChars;
    if (!Number.isFinite(outputBudgetChars) || outputBudgetChars <= 0) throw new Error('Invalid writing tool budget');
    const validateInput = (raw: unknown): Selection => {
        const input = selectionSchema.parse(raw);
        // Legacy null and omitted unknown scenes share the same host selection.
        return { ...input, scene: input.scene ?? null, imageRefs: input.imageRefs.map(cloneImageRef) };
    };
    return {
        name: GET_WRITING_CONTEXT,
        description: 'Prepare a writing context before composing or revising. Select an offered parent handle, or null for a new topic. Use only registered image identities. The host validates all sources.',
        inputSchema: schema,
        plannerGuidance: [
            'Interpret the requested scene and current style conflicts semantically; omit scene when it is unknown.',
            'When known, scene is an object with writingTask, purpose, audience and domain (each 1–64 characters), never a JSON-encoded string.',
            'imageRefs is the complete material selection, including retained parent images; an empty list means no images.',
            'Wait for the context result before generating a work. Do not present a work in the same batch or invent a context handle.',
            'Use an already prepared valid context directly. Rewording the same scene does not require another preparation. Prepare again for a user correction, new evidence changing the selected parent, scene, conflicts or materials, or a host-reported unavailable context.',
        ],
        prepareArguments: validateInput,
        permission: 'read-only', cost: 'free', outputBudgetChars, requiresConfirmation: false,
        failureBehavior: 'recoverable', statusMessageText: 'Preparing writing context',
        sourceBoundary: 'read-only-tool', statusMessage: () => 'Preparing writing context', validateInput,
        execute: async (raw, context) => {
            const input = validateInput(raw);
            const budget = host.getBudget();
            const prepared = await run.prepare({
                ...(input.parentHandle === null ? {} : { parentHandle: input.parentHandle }),
                ...(input.scene === null ? {} : { scene: input.scene }),
                currentInstructionConflicts: input.currentInstructionConflicts, imageRefs: input.imageRefs,
            }, { ...budget, remainingTextChars: Math.min(budget.remainingTextChars, outputBudgetChars), signal: context.signal });
            host.onPrepared?.(prepared);
            return { ok: true, tool: GET_WRITING_CONTEXT, inputSummary: 'Requested writing context',
                content: writingContextObservation(prepared), sources: [] };
        },
    };
}

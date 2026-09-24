import type { ChatToolProviderSchema } from './chat-tool-types';

export const REPORT_TASK_INCOMPLETE = 'report_task_incomplete';
const MAX_INCOMPLETE_ANSWER_CHARS = 16_000;

/** Optional pure output: the Agent reports an unmet task, without a Host text classifier. */
export function taskIncompleteOutputSchema(): ChatToolProviderSchema {
    return {
        type: 'function',
        function: {
            name: REPORT_TASK_INCOMPLETE,
            description: 'When you cannot complete the user task, call this function alone through native tool calling. Put the user-facing explanation in answer. Do not write the function name, tags, or JSON as ordinary text. This does not request permission or execute an action.',
            parameters: { type: 'object', additionalProperties: false,
                properties: { answer: { type: 'string', description: 'User-facing explanation of the unfinished task and any useful next step.' } },
                required: ['answer'] },
        },
    };
}

export function parseTaskIncompleteOutput(input: unknown): string | undefined {
    let value = input;
    if (typeof value === 'string') {
        try { value = JSON.parse(value) as unknown; } catch { return undefined; }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const fields = value as Record<string, unknown>;
    if (Object.keys(fields).some(key => key !== 'answer') || typeof fields.answer !== 'string') return undefined;
    const answer = fields.answer.trim();
    return answer.length > 0 && answer.length <= MAX_INCOMPLETE_ANSWER_CHARS ? answer : undefined;
}

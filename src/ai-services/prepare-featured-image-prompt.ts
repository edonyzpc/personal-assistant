import { HumanMessage, SystemMessage } from '@langchain/core/messages';

import { AIUtils, resolvePaAgentModelBudgetFacts, type AIUtilsHost } from './ai-utils';
import { resolvePaAgentInputTokenLimit } from './context/PaAgentContextBudget';
import { getFeaturedImagePrompt } from './featured-image-prompt';
import { estimateApproximateTokens } from '../token-estimate';
import { clearPlatformTimeout, setPlatformTimeout, type PlatformTimeoutHandle } from '../platform-dom';
import {
    agentDebugError, createAgentDebugCall, observeAgentDebugCall, observeAgentDebugResponse,
} from './agent-debug-observation';
import type { AgentDebugRunRecorder } from './agent-debug-port';
import type { PaAgentRunUsageLedger } from './agent-usage-ledger';

const PREPARATION_TIMEOUT_MS = 300_000;
const UNKNOWN_MODEL_PROMPT_CHAR_FALLBACK = 120_000;
const MAX_WAN_PROMPT_CHARS = 5_000;

export class FeaturedImagePromptPreparationError extends Error {
    constructor(readonly code:
        | 'source_changed' | 'connection_changed' | 'cancelled' | 'input_too_large'
        | 'empty_result' | 'nontext_result' | 'result_too_large') {
        super(`featured_image_prompt:${code}`);
        this.name = 'FeaturedImagePromptPreparationError';
    }
}

export interface PrepareFeaturedImagePromptInput {
    sourceText: string;
    userRequest: string;
    /** Host-owned ordinal for explicitly distinct requested images. */
    imageOrdinal?: number;
    imageTotal?: number;
    signal: AbortSignal;
    isSourceCurrent: () => boolean;
    isConnectionCurrent?: () => boolean;
}

export interface PrepareFeaturedImagePromptRuntime {
    recorder?: AgentDebugRunRecorder;
    usageLedger?: PaAgentRunUsageLedger;
    parentId: string;
    turnId?: string;
}

export type FeaturedImagePromptHost = Pick<AIUtilsHost, 'settings' | 'getAPIToken' | 'log'>;

function modelText(content: unknown): string | null {
    if (typeof content === 'string') return content.trim();
    if (!Array.isArray(content)) return null;
    if (!content.length) return null;
    const texts: string[] = [];
    for (const part of content) {
        if (typeof part === 'string') {
            texts.push(part);
            continue;
        }
        if (!part || typeof part !== 'object') return null;
        const type = Object.getOwnPropertyDescriptor(part, 'type')?.value;
        const text = Object.getOwnPropertyDescriptor(part, 'text')?.value;
        const refusal = Object.getOwnPropertyDescriptor(part, 'refusal')?.value;
        if (refusal !== undefined && refusal !== null) return null;
        if (type !== 'text' || typeof text !== 'string') return null;
        texts.push(text);
    }
    return texts.join('\n').trim();
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timeoutId: PlatformTimeoutHandle | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timeoutId = setPlatformTimeout(() => reject(
                    new Error('featured_image_prompt:timeout'),
                ), PREPARATION_TIMEOUT_MS);
            }),
        ]);
    } finally {
        if (timeoutId !== null) clearPlatformTimeout(timeoutId);
    }
}

/** One physical text-model call for the exact selected source; never widens the material itself. */
export async function prepareFeaturedImagePrompt(
    host: FeaturedImagePromptHost,
    input: PrepareFeaturedImagePromptInput,
    runtime?: PrepareFeaturedImagePromptRuntime,
): Promise<string> {
    const settings = host.settings;
    const connection = {
        aiProvider: settings.aiProvider,
        baseURL: settings.baseURL,
        chatModelName: settings.chatModelName,
    };
    const assertCurrent = () => {
        if (input.signal.aborted) throw new FeaturedImagePromptPreparationError('cancelled');
        if (!input.isSourceCurrent()) throw new FeaturedImagePromptPreparationError('source_changed');
        if (input.isConnectionCurrent?.() === false) throw new FeaturedImagePromptPreparationError('connection_changed');
        if (settings.aiProvider !== connection.aiProvider
            || settings.baseURL !== connection.baseURL
            || settings.chatModelName !== connection.chatModelName) {
            throw new FeaturedImagePromptPreparationError('connection_changed');
        }
    };

    assertCurrent();
    const systemPrompt = getFeaturedImagePrompt();
    const userMessage = [
        '**用户本轮要求：**',
        input.userRequest.trim() || '根据所选文字内容构思一张合适的特色图片。',
        ...(input.imageOrdinal !== undefined || input.imageTotal !== undefined ? [
            `**本次子请求：**第 ${input.imageOrdinal ?? 1} / ${input.imageTotal ?? 1} 张；只为用户原始要求中对应这一序号的主体构思。`,
        ] : []),
        '',
        '**文字内容：**',
        input.sourceText,
    ].join('\n');
    const messages = [new SystemMessage(systemPrompt), new HumanMessage(userMessage)];
    const envelope = `${systemPrompt}\n${userMessage}`;
    const facts = resolvePaAgentModelBudgetFacts({
        provider: settings.aiProvider, model: settings.chatModelName, baseURL: settings.baseURL,
    });
    const maxInputTokens = resolvePaAgentInputTokenLimit(facts);
    const estimatedTokens = estimateApproximateTokens(envelope);
    if (maxInputTokens !== undefined
        ? estimatedTokens > maxInputTokens
        : Array.from(envelope).length > UNKNOWN_MODEL_PROMPT_CHAR_FALLBACK) {
        throw new FeaturedImagePromptPreparationError('input_too_large');
    }
    const debugCall = createAgentDebugCall(runtime?.recorder, {
        parentId: runtime?.parentId ?? 'image-preparation',
        turnId: runtime?.turnId,
        purpose: 'image_preparation',
        provider: connection.aiProvider,
        model: connection.chatModelName,
        lineage: { domains: ['vault_notes'] },
        promptEstimate: { tokens: estimatedTokens, method: 'cjk_text_and_serialized_schema' },
    }, runtime?.usageLedger);
    const aiUtils = new AIUtils({
        settings: { ...settings, ...connection },
        getAPIToken: async () => {
            assertCurrent();
            const token = await host.getAPIToken();
            assertCurrent();
            return token;
        },
        log: host.log,
    });
    const model = await aiUtils.createChatModel(0.8, {
        onProviderRequestStart: assertCurrent,
        agentDebugCall: debugCall,
    });
    assertCurrent();
    host.log('Featured image prompt preparation requested', {
        sourceLength: Array.from(input.sourceText).length,
        userRequestLength: Array.from(input.userRequest).length,
        estimatedTokens,
        maxInputTokens,
    });
    observeAgentDebugCall(debugCall, { phase: 'dispatch', status: 'running', prompt: { messages: [
        { role: 'system', text: systemPrompt },
        { role: 'user', text: userMessage },
    ] } });
    let result: { content: unknown };
    try {
        result = await withTimeout(model.invoke(messages, { signal: input.signal }));
        assertCurrent();
    } catch (error) {
        assertCurrent();
        observeAgentDebugCall(debugCall, {
            phase: 'error', status: input.signal.aborted ? 'cancelled' : 'failed',
            error: agentDebugError(error),
        });
        throw error;
    }
    observeAgentDebugResponse(debugCall, result, 'replace', 'provider-usage', 'all');
    const prepared = modelText(result.content);
    if (prepared === null) throw new FeaturedImagePromptPreparationError('nontext_result');
    if (!prepared) throw new FeaturedImagePromptPreparationError('empty_result');
    if (Array.from(prepared).length > MAX_WAN_PROMPT_CHARS) {
        throw new FeaturedImagePromptPreparationError('result_too_large');
    }
    observeAgentDebugCall(debugCall, { phase: 'consumer_end', status: 'completed', outcome: 'image_prompt_prepared' });
    host.log('Featured image prompt preparation received', { preparedLength: prepared.length });
    return prepared;
}

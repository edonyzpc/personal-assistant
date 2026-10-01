import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { estimateApproximateTokens } from "../token-estimate";
import { clearPlatformTimeout, setPlatformTimeout, type PlatformTimeoutHandle } from "../platform-dom";
import { AIUtils, resolvePaAgentModelBudgetFacts, type AIUtilsHost } from "./ai-utils";
import { resolvePaAgentInputTokenLimit } from "./context/PaAgentContextBudget";
import { isValidGhostSlug } from "../ghost-publishing/slug";

const PREPARATION_TIMEOUT_MS = 300_000;
const UNKNOWN_MODEL_PROMPT_CHAR_FALLBACK = 120_000;
export const GHOST_METADATA_CUSTOM_EXCERPT_MAX = 300;
export const GHOST_METADATA_META_DESCRIPTION_MAX = 500;

export class GhostMetadataPreparationError extends Error {
    constructor(readonly code:
        | "source_changed" | "connection_changed" | "cancelled" | "input_too_large"
        | "invalid_result" | "provider_failure") {
        super(`ghost_metadata:${code}`);
        this.name = "GhostMetadataPreparationError";
    }
}

export interface PrepareGhostMetadataInput {
    title: string;
    articleText: string;
    needed: { customExcerpt: boolean; metaDescription: boolean; slug: boolean };
    signal: AbortSignal;
    isSourceCurrent(): boolean;
    isConnectionCurrent?(): boolean;
}

export type GhostMetadataHost = {
    getSettings(): AIUtilsHost["settings"];
} & Pick<AIUtilsHost, "getAPIToken" | "log">;

function modelText(content: unknown): string | null {
    if (typeof content === "string") return content.trim();
    if (!Array.isArray(content)) return null;
    const texts: string[] = [];
    for (const part of content) {
        if (typeof part === "string") {
            texts.push(part);
            continue;
        }
        if (!part || typeof part !== "object") return null;
        const type = Object.getOwnPropertyDescriptor(part, "type")?.value;
        const text = Object.getOwnPropertyDescriptor(part, "text")?.value;
        const refusal = Object.getOwnPropertyDescriptor(part, "refusal")?.value;
        if (refusal !== undefined && refusal !== null) return null;
        if (type !== "text" || typeof text !== "string") return null;
        texts.push(text);
    }
    return texts.join("\n").trim();
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timeoutId: PlatformTimeoutHandle | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timeoutId = setPlatformTimeout(() => reject(new Error("ghost_metadata:timeout")), PREPARATION_TIMEOUT_MS);
            }),
        ]);
    } finally {
        if (timeoutId !== null) clearPlatformTimeout(timeoutId);
    }
}

function parseResult(raw: string, needed: PrepareGhostMetadataInput["needed"]): {
    customExcerpt?: string;
    metaDescription?: string;
    slug?: string;
} {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        throw new GhostMetadataPreparationError("invalid_result");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new GhostMetadataPreparationError("invalid_result");
    const record = value as Record<string, unknown>;
    const expected = Object.keys(needed).filter((key) => needed[key as keyof typeof needed]);
    if (Object.keys(record).length !== expected.length) throw new GhostMetadataPreparationError("invalid_result");
    const result: { customExcerpt?: string; metaDescription?: string; slug?: string } = {};
    const bounds: Record<string, number> = {
        customExcerpt: GHOST_METADATA_CUSTOM_EXCERPT_MAX,
        metaDescription: GHOST_METADATA_META_DESCRIPTION_MAX,
    };
    for (const key of expected) {
        if (!["customExcerpt", "metaDescription", "slug"].includes(key) || typeof record[key] !== "string") {
            throw new GhostMetadataPreparationError("invalid_result");
        }
        const text = record[key] as string;
        if (key === "slug") {
            if (!isValidGhostSlug(text)) throw new GhostMetadataPreparationError("invalid_result");
            result.slug = text;
            continue;
        }
        if (!text.trim() || Array.from(text).length > bounds[key]) throw new GhostMetadataPreparationError("invalid_result");
        result[key as "customExcerpt" | "metaDescription"] = text;
    }
    return result;
}

/** One Host-owned configured-text-provider call for exact admitted article material only. */
export async function prepareGhostMetadata(
    host: GhostMetadataHost,
    input: PrepareGhostMetadataInput,
): Promise<{ customExcerpt?: string; metaDescription?: string; slug?: string }> {
    const initialSettings = host.getSettings();
    const connection = {
        aiProvider: initialSettings.aiProvider,
        baseURL: initialSettings.baseURL,
        chatModelName: initialSettings.chatModelName,
    };
    const assertCurrent = () => {
        if (input.signal.aborted) throw new GhostMetadataPreparationError("cancelled");
        if (!input.isSourceCurrent()) throw new GhostMetadataPreparationError("source_changed");
        if (input.isConnectionCurrent?.() === false) throw new GhostMetadataPreparationError("connection_changed");
        const settings = host.getSettings();
        if (settings.aiProvider !== connection.aiProvider
            || settings.baseURL !== connection.baseURL
            || settings.chatModelName !== connection.chatModelName) {
            throw new GhostMetadataPreparationError("connection_changed");
        }
    };
    assertCurrent();
    const requested = [
        ...(input.needed.customExcerpt ? ["\"customExcerpt\""] : []),
        ...(input.needed.metaDescription ? ["\"metaDescription\""] : []),
        ...(input.needed.slug ? ["\"slug\""] : []),
    ].join(", ");
    const systemPrompt = [
        "You generate metadata for the exact supplied article.",
        "Use the article's primary language.",
        "Return only one valid JSON object with exactly these keys:",
        requested,
        "customExcerpt concisely summarizes the article's main argument.",
        "metaDescription independently and naturally mentions the main topic and a concrete reader benefit.",
        "slug is a concise English URL slug of lowercase ASCII words separated by single hyphens.",
        "Do not copy one value into the other, invent facts, add web addresses, or stuff keywords.",
        "Do not claim a fixed search-snippet length or rewrite the article.",
        `customExcerpt has at most ${GHOST_METADATA_CUSTOM_EXCERPT_MAX} characters.`,
        `metaDescription has at most ${GHOST_METADATA_META_DESCRIPTION_MAX} characters.`,
    ].join(" ");
    const userMessage = `Title: ${input.title}\n\nArticle:\n${input.articleText}`;
    const envelope = `${systemPrompt}\n${userMessage}`;
    const facts = resolvePaAgentModelBudgetFacts({
        provider: initialSettings.aiProvider, model: initialSettings.chatModelName, baseURL: initialSettings.baseURL,
    });
    const maxInputTokens = resolvePaAgentInputTokenLimit(facts);
    const estimatedTokens = estimateApproximateTokens(envelope);
    if (maxInputTokens !== undefined
        ? estimatedTokens > maxInputTokens
        : Array.from(envelope).length > UNKNOWN_MODEL_PROMPT_CHAR_FALLBACK) {
        throw new GhostMetadataPreparationError("input_too_large");
    }
    const aiUtils = new AIUtils({
        settings: { ...initialSettings, ...connection },
        getAPIToken: async () => {
            assertCurrent();
            const token = await host.getAPIToken();
            assertCurrent();
            return token;
        },
        log: host.log,
    } as AIUtilsHost);
    let model: Awaited<ReturnType<AIUtils["createChatModel"]>>;
    try {
        model = await aiUtils.createChatModel(0.2, {
            maxTokens: 1_000,
            expectedModelIdentity: {
                provider: connection.aiProvider,
                model: connection.chatModelName,
                baseURL: connection.baseURL,
            },
            onProviderRequestStart: assertCurrent,
        });
    } catch (error) {
        if (error instanceof GhostMetadataPreparationError) throw error;
        assertCurrent();
        throw new GhostMetadataPreparationError("provider_failure");
    }
    assertCurrent();
    host.log("Ghost metadata preparation requested", {
        titleLength: Array.from(input.title).length,
        articleLength: Array.from(input.articleText).length,
        estimatedTokens,
        maxInputTokens,
    });
    let result: { content: unknown };
    try {
        result = await withTimeout(model.invoke([
            new SystemMessage(systemPrompt),
            new HumanMessage(userMessage),
        ], { signal: input.signal }));
        assertCurrent();
    } catch {
        assertCurrent();
        throw new GhostMetadataPreparationError("provider_failure");
    }
    const raw = modelText(result.content);
    if (!raw) throw new GhostMetadataPreparationError("invalid_result");
    return parseResult(raw, input.needed);
}

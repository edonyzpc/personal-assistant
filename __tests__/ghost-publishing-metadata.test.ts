import { beforeEach, describe, expect, it, jest } from "@jest/globals";

type PreparedModelInvoke = (
    messages: Array<{ content: unknown }>,
    options?: { signal?: AbortSignal },
) => Promise<{ content: unknown }>;
const createChatModel = jest.fn<(temperature?: unknown, options?: unknown) => Promise<{ invoke: PreparedModelInvoke }>>();
jest.mock("../src/ai-services/ai-utils", () => {
    const actual = jest.requireActual("../src/ai-services/ai-utils") as Record<string, unknown>;
    return { ...actual, AIUtils: jest.fn().mockImplementation(() => ({ createChatModel })) };
});

import { AIUtils } from "../src/ai-services/ai-utils";
import {
    GhostMetadataPreparationError,
    prepareGhostMetadata,
} from "../src/ai-services/ghost-metadata";

const baseSettings = {
    debug: false,
    aiProvider: "openai",
    baseURL: "https://provider.example",
    chatModelName: "text-model",
    embeddingModelName: "embedding-model",
};
let currentSettings = { ...baseSettings };
const host = {
    getSettings: () => currentSettings,
    getAPIToken: jest.fn(async () => "token"),
    log: jest.fn(),
};
const input = (overrides: Partial<Parameters<typeof prepareGhostMetadata>[1]> = {}) => ({
    title: "Synthetic article",
    articleText: "EXACT-ARTICLE sentinel\n\nSecond paragraph.",
    needed: { customExcerpt: true, metaDescription: true, slug: false },
    signal: new AbortController().signal,
    isSourceCurrent: () => true,
    ...overrides,
});

beforeEach(() => {
    createChatModel.mockReset();
    currentSettings = { ...baseSettings };
    host.getAPIToken.mockClear();
    host.log.mockClear();
    (AIUtils as unknown as jest.Mock).mockClear();
});

describe("prepareGhostMetadata", () => {
    it("makes one configured-text-model call with only the cleaned article", async () => {
        const invoke = jest.fn<PreparedModelInvoke>(async () => ({
            content: JSON.stringify({
                customExcerpt: "准确摘要",
                metaDescription: "Independent search description",
                slug: "synthetic-article",
            }),
        }));
        createChatModel.mockResolvedValueOnce({ invoke });

        await expect(prepareGhostMetadata(host, input({
            needed: { customExcerpt: true, metaDescription: true, slug: true },
        }))).resolves.toEqual({
            customExcerpt: "准确摘要",
            metaDescription: "Independent search description",
            slug: "synthetic-article",
        });
        expect(createChatModel).toHaveBeenCalledTimes(1);
        expect(invoke).toHaveBeenCalledTimes(1);
        const messages = invoke.mock.calls[0]![0];
        expect(String(messages[0].content)).toContain("exactly these keys");
        expect(String(messages[0].content)).toContain("summarizes the article's main argument");
        expect(String(messages[0].content)).toContain("main topic and a concrete reader benefit");
        expect(String(messages[0].content)).toContain("lowercase ASCII");
        expect(String(messages[0].content)).not.toContain("Google");
        expect(String(messages[0].content)).toContain("English URL slug");
        expect(String(messages[1].content)).toContain("EXACT-ARTICLE sentinel");
        expect(String(messages[1].content)).not.toContain("OUTSIDE-ARTICLE sentinel");
        expect(JSON.stringify(invoke.mock.calls[0])).not.toContain("ghost-admin-key");
    });

    it("rejects before a physical model request when the live settings object is replaced during initialization", async () => {
        const invoke = jest.fn<PreparedModelInvoke>(async () => ({
            content: JSON.stringify({ customExcerpt: "late", metaDescription: "late" }),
        }));
        createChatModel.mockImplementationOnce(async () => {
            currentSettings = { ...currentSettings, chatModelName: "replacement-model" };
            return { invoke };
        });
        await expect(prepareGhostMetadata(host, input())).rejects.toMatchObject({
            code: "connection_changed",
        });
        expect(invoke).not.toHaveBeenCalled();
    });

    it.each([
        ["invalid JSON", "not-json"],
        ["wrong keys", JSON.stringify({ customExcerpt: "x" })],
        ["extra keys", JSON.stringify({ customExcerpt: "x", metaDescription: "y", secret: "z" })],
        ["oversized excerpt", JSON.stringify({ customExcerpt: "x".repeat(301), metaDescription: "y" })],
        ["oversized SEO", JSON.stringify({ customExcerpt: "x", metaDescription: "y".repeat(501) })],
        ["invalid slug", JSON.stringify({ customExcerpt: "x", metaDescription: "y", slug: "Not_A_Valid_Slug" })],
    ] as const)("rejects %s without accepting unreliable output", async (_name, content) => {
        createChatModel.mockResolvedValueOnce({ invoke: async () => ({ content }) });
        await expect(prepareGhostMetadata(host, input())).rejects.toMatchObject({
            code: "invalid_result",
        });
    });

    it("rejects an invalid generated slug without accepting the result", async () => {
        createChatModel.mockResolvedValueOnce({ invoke: async () => ({
            content: JSON.stringify({ slug: "https://ghost.example/not-a-slug" }),
        }) });
        await expect(prepareGhostMetadata(host, input({
            needed: { customExcerpt: false, metaDescription: false, slug: true },
        }))).rejects.toMatchObject({ code: "invalid_result" });
    });

    it("rejects oversized complete input before a model call", async () => {
        await expect(prepareGhostMetadata(host, input({
            articleText: "x".repeat(120_001),
        }))).rejects.toBeInstanceOf(GhostMetadataPreparationError);
        expect(createChatModel).not.toHaveBeenCalled();
    });

    it("checks cancellation, source, provider identity, and provider failure", async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(prepareGhostMetadata(host, input({ signal: controller.signal })))
            .rejects.toMatchObject({ code: "cancelled" });
        await expect(prepareGhostMetadata(host, input({ isSourceCurrent: () => false })))
            .rejects.toMatchObject({ code: "source_changed" });
        let finishRequest!: (value: { content: string }) => void;
        const request = new Promise<{ content: string }>(resolve => { finishRequest = resolve; });
        createChatModel.mockResolvedValueOnce({ invoke: async () => request });
        const preparation = prepareGhostMetadata(host, input());
        await flushPromises();
        currentSettings = { ...currentSettings, chatModelName: "changed-model" };
        finishRequest({ content: JSON.stringify({ customExcerpt: "late", metaDescription: "late" }) });
        await expect(preparation).rejects.toMatchObject({ code: "connection_changed" });
        currentSettings = { ...baseSettings };
        await expect(prepareGhostMetadata(host, input({ articleText: "x".repeat(120_001) })))
            .rejects.toBeInstanceOf(GhostMetadataPreparationError);
        createChatModel.mockResolvedValueOnce({ invoke: async () => { throw new Error("transport"); } });
        await expect(prepareGhostMetadata(host, input())).rejects.toMatchObject({ code: "provider_failure" });
    });
});

function flushPromises(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
}

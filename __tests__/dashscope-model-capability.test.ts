import { describe, expect, it, jest } from "@jest/globals";

import { probeDashScopeFunctionCalling } from "../src/pagelet/agent/dashscope-model-capability";

jest.mock("obsidian");

const input = {
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "deepseek-v4.1-flash",
    apiKey: "test-key",
};

describe("DashScope model Function Calling capability", () => {
    it("uses the configured DashScope origin and exact model ID", async () => {
        const request = jest.fn(async (_params: unknown) => ({
            status: 200,
            json: {
                success: true,
                output: { models: [{ model: input.model, features: ["function-calling"] }] },
            },
        }));

        await expect(probeDashScopeFunctionCalling({ ...input, request }))
            .resolves.toBe("supported");
        expect(request).toHaveBeenCalledWith({
            url: "https://dashscope.aliyuncs.com/api/v1/models?model=deepseek-v4.1-flash",
            method: "GET",
            headers: { Authorization: "Bearer test-key" },
            throw: false,
        });
    });

    it("reports unsupported only for an exact model with a known feature list", async () => {
        const request = jest.fn(async () => ({
            status: 200,
            json: {
                success: true,
                output: { models: [{ model: input.model, features: ["cache"] }] },
            },
        }));
        await expect(probeDashScopeFunctionCalling({ ...input, request }))
            .resolves.toBe("unsupported");
        await expect(probeDashScopeFunctionCalling({ ...input, model: "other", request }))
            .resolves.toBe("unknown");
    });

    it("does not turn network failures or other origins into an unsupported verdict", async () => {
        const request = jest.fn(async () => ({ status: 401, json: {} }));
        await expect(probeDashScopeFunctionCalling({ ...input, request }))
            .resolves.toBe("unknown");
        await expect(probeDashScopeFunctionCalling({
            ...input,
            baseURL: "https://other.example/compatible-mode/v1",
            request,
        })).resolves.toBe("unknown");
        expect(request).toHaveBeenCalledTimes(1);
    });
});

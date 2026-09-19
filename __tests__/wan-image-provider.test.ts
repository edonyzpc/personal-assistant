import { describe, expect, it, jest } from "@jest/globals";
import type { RequestUrlParam } from "obsidian";

import { WanImageProvider, WanImageProviderError } from "../src/ai-services/wan-image-provider";

jest.mock("obsidian");

const publicBaseURL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const workspaceBaseURL = "https://ws-123.ap-southeast-1.maas.aliyuncs.com/api/v1";

describe("Wan image provider", () => {
    it("submits one async task with ordered reference images and no implicit retry", async () => {
        const request = jest.fn(async (_params: RequestUrlParam) => ({
            status: 200,
            json: { request_id: "request-1", output: { task_id: "task-1", task_status: "PENDING" } },
        }));
        const provider = new WanImageProvider({ baseURL: workspaceBaseURL, apiKey: "test-key", request });

        await expect(provider.submit({
            model: "wan2.7-image-pro",
            prompt: "Keep the first subject, use the second image's lighting",
            count: 2,
            referenceImages: ["data:image/png;base64,AA==", "data:image/jpeg;base64,AA=="],
        })).resolves.toEqual({
            taskId: "task-1", status: "PENDING", requestId: "request-1", providerCode: undefined, imageUrls: [],
        });
        expect(request).toHaveBeenCalledTimes(1);
        const params = request.mock.calls[0][0] as {
            url: string; method: string; headers: Record<string, string>; body: string;
        };
        expect(params.url).toBe("https://ws-123.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/image-generation/generation");
        expect(params.method).toBe("POST");
        expect(params.headers).toEqual({ Authorization: "Bearer test-key", "X-DashScope-Async": "enable" });
        expect(JSON.parse(params.body)).toEqual({
            model: "wan2.7-image-pro",
            input: { messages: [{ role: "user", content: [
                { image: "data:image/png;base64,AA==" },
                { image: "data:image/jpeg;base64,AA==" },
                { text: "Keep the first subject, use the second image's lighting" },
            ] }] },
            parameters: { size: "2K", n: 2, watermark: false },
        });
    });

    it("keeps uncertain submission distinct from a definite provider rejection", async () => {
        const unknown = new WanImageProvider({
            baseURL: publicBaseURL,
            apiKey: "test-key",
            request: jest.fn(async () => { throw new Error("transport disconnected"); }),
        });
        await expect(unknown.submit({ model: "wan2.7-image", prompt: "a tree", count: 1 }))
            .rejects.toMatchObject({ kind: "submission_unknown" });

        const rejected = new WanImageProvider({
            baseURL: publicBaseURL,
            apiKey: "test-key",
            request: jest.fn(async () => ({ status: 400, json: { code: "InvalidParameter" } })),
        });
        await expect(rejected.submit({ model: "wan2.7-image", prompt: "a tree", count: 1 }))
            .rejects.toMatchObject({ kind: "rejected", httpStatus: 400, providerCode: "InvalidParameter" });
    });

    it("queries original task and requires complete successful output before exposing URLs", async () => {
        const request = jest.fn(async (_params: RequestUrlParam) => ({ status: 200, json: {
            request_id: "request-2",
            output: {
                task_id: "task-1", task_status: "SUCCEEDED", finished: true,
                choices: [{ finish_reason: "stop", message: { content: [
                    { type: "image", image: "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/1.png?Expires=123" },
                ] } }],
            },
        } }));
        const provider = new WanImageProvider({ baseURL: publicBaseURL, apiKey: "test-key", request });

        await expect(provider.query("task-1")).resolves.toEqual({
            taskId: "task-1", status: "SUCCEEDED", requestId: "request-2", providerCode: undefined,
            imageUrls: ["https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/1.png?Expires=123"],
        });
        expect(request.mock.calls[0][0]).toMatchObject({
            url: "https://dashscope.aliyuncs.com/api/v1/tasks/task-1", method: "GET",
        });

        const incomplete = new WanImageProvider({
            baseURL: publicBaseURL, apiKey: "test-key",
            request: jest.fn(async () => ({ status: 200, json: {
                output: { task_id: "task-1", task_status: "SUCCEEDED", finished: false, choices: [] },
            } })),
        });
        await expect(incomplete.query("task-1")).rejects.toMatchObject({ kind: "invalid_response" });
    });

    it("only sends remote cancellation for a known pending task", async () => {
        const request = jest.fn(async (_params: RequestUrlParam) => ({ status: 200, json: "request-3" }));
        const provider = new WanImageProvider({ baseURL: publicBaseURL, apiKey: "test-key", request });

        await expect(provider.cancel("task-1", "RUNNING")).resolves.toEqual({
            cancellationAccepted: false, reason: "not_pending",
        });
        expect(request).not.toHaveBeenCalled();
        await expect(provider.cancel("task-1", "PENDING")).resolves.toEqual({ cancellationAccepted: true });
        expect(request.mock.calls[0][0]).toMatchObject({
            url: "https://dashscope.aliyuncs.com/api/v1/tasks/task-1/cancel", method: "POST",
        });
    });

    it("retains successful images when another choice has no usable output", async () => {
        const provider = new WanImageProvider({ baseURL: publicBaseURL, apiKey: "test-key",
            request: jest.fn(async () => ({ status: 200, json: { output: {
                task_id: "task-1", task_status: "SUCCEEDED", finished: true,
                choices: [
                    { finish_reason: "content_filter", message: { content: [] } },
                    { finish_reason: "stop", message: { content: [
                        { type: "image", image: "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/ok.png" },
                    ] } },
                ],
            } } })) });
        await expect(provider.query("task-1")).resolves.toMatchObject({
            imageUrls: ["https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/ok.png"],
        });
    });

    it("rejects arbitrary credential origins and invalid paid request counts locally", async () => {
        expect(() => new WanImageProvider({
            baseURL: "https://ws-123.ap-southeast-1.maas.aliyuncs.com.evil.test/api/v1",
            apiKey: "test-key",
        })).toThrow(WanImageProviderError);
        const request = jest.fn(async () => ({ status: 200, json: {} }));
        const provider = new WanImageProvider({ baseURL: publicBaseURL, apiKey: "test-key", request });
        await expect(provider.submit({ model: "wan2.7-image", prompt: "a tree", count: 5 }))
            .rejects.toMatchObject({ kind: "invalid_input" });
        expect(request).not.toHaveBeenCalled();
    });
});

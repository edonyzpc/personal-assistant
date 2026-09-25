import { describe, expect, it, jest } from "@jest/globals";
import { createChatToolCapability } from "../src/ai-services/capability-adapter";
import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import { createCreateImageTool, type ChatToolContext, type CreateImageToolInput } from "../src/ai-services/chat-tools";
import { PolicyEngine } from "../src/ai-services/policy-engine";

const request: CreateImageToolInput = {
    prompt: "A warm watercolor bookstore",
    operation: "generate",
    count: 1,
    referenceImageRefs: [],
};

describe("B-133 create_image host binding", () => {
    it("exposes only semantic arguments under a fixed image permission", () => {
        const tool = createCreateImageTool({
            conversationId: "conversation-1",
            stableMessageId: "message-1",
            operationId: "operation-1",
            submit: async () => ({ taskId: "task-1" }),
        });
        const registry = new CapabilityRegistry();
        const capability = createChatToolCapability(tool, { providerId: "chat-image-generation" });
        expect(registry.register(capability)).toBe(true);
        expect(registry.listDefinitions().map(definition => definition.name)).toContain("create_image");
        expect(registry.exportProviderSchemas()[0].function.parameters.properties).toEqual(tool.inputSchema.properties);
        for (const secretOrHostKey of ["conversationId", "stableMessageId", "operationId", "endpoint", "credential", "path"]) {
            expect(tool.inputSchema.properties).not.toHaveProperty(secretOrHostKey);
        }
        expect(new PolicyEngine().canExport({ ...capability, name: "query_notes" })).toMatchObject({ allowed: false });
    });

    it("submits once for repeated model calls with the same host request identity", async () => {
        const submit = jest.fn(async (_input: CreateImageToolInput) => ({ taskId: "task-1" }));
        const tool = createCreateImageTool({
            conversationId: "conversation-1",
            stableMessageId: "message-1",
            operationId: "operation-1",
            submit,
        });
        expect(submit).not.toHaveBeenCalled();
        const first = await tool.execute(tool.validateInput(request), {} as ChatToolContext);
        const second = await tool.execute(tool.validateInput({ ...request, prompt: "Try a different scene" }), {} as ChatToolContext);
        expect(submit).toHaveBeenCalledTimes(1);
        expect(submit).toHaveBeenCalledWith(request);
        expect(first.content).toEqual({ status: "accepted", taskId: "task-1" });
        expect(second.content).toEqual({
            status: "already_accepted", taskId: "task-1",
            message: "This user request already has an image task. Changes require a new user request.",
        });
        expect(second.inputSummary).toBe("generate; count:1");
        expect(JSON.stringify(first)).not.toContain(request.prompt);
    });

    it("passes a source-only receipt to queued image submission", async () => {
        let sourceCurrent = true;
        let receipt: (() => boolean) | undefined;
        const submit = jest.fn(async (_input: CreateImageToolInput, isSourceCurrent?: () => boolean) => {
            receipt = isSourceCurrent;
            return { taskId: "task-scoped" };
        });
        const tool = createCreateImageTool({ conversationId: "conversation-1", stableMessageId: "message-1",
            operationId: "operation-1", submit });
        const context = { host: {} as ChatToolContext['host'], taskSourceReadGuard: {
            isCurrent: () => true,
            isPathAllowed: () => true,
            captureSourceValidity: () => () => sourceCurrent,
        } } as ChatToolContext;

        const result = await tool.execute(tool.validateInput(request), context);
        expect(result.ok).toBe(true);
        expect(submit).toHaveBeenCalledWith(request, expect.any(Function));
        expect(receipt?.()).toBe(true);
        sourceCurrent = false;
        expect(receipt?.()).toBe(false);
    });

    it("keeps separate explicit subrequests distinct while deduplicating each slot", async () => {
        const submit = jest.fn(async (input: CreateImageToolInput) => ({ taskId: `task-${input.subrequestIndex ?? 1}` }));
        const tool = createCreateImageTool({ conversationId: "conversation-1", stableMessageId: "message-1",
            operationId: "operation-1", submit });
        const first = await tool.execute(tool.validateInput({ ...request, subrequestIndex: 1 }), {} as ChatToolContext);
        const second = await tool.execute(tool.validateInput({ ...request, prompt: "A blue bird", subrequestIndex: 2 }), {} as ChatToolContext);
        const repeated = await tool.execute(tool.validateInput({ ...request, prompt: "Changed", subrequestIndex: 2 }), {} as ChatToolContext);
        expect(first.content).toMatchObject({ status: "accepted", taskId: "task-1" });
        expect(second.content).toMatchObject({ status: "accepted", taskId: "task-2" });
        expect(repeated.content).toMatchObject({ status: "already_accepted", taskId: "task-2" });
        expect(submit).toHaveBeenCalledTimes(2);
    });

    it("rejects model-supplied authority and malformed refs before dispatch", () => {
        const submit = jest.fn(async () => ({ taskId: "task-1" }));
        const tool = createCreateImageTool({
            conversationId: "conversation-1", stableMessageId: "message-1", operationId: "operation-1", submit,
        });
        expect(() => tool.validateInput({ ...request, operationId: "second-paid-request" })).toThrow();
        expect(() => tool.validateInput({ ...request, referenceImageRefs: ["https://example.com/private.png"] })).toThrow();
        expect(() => tool.validateInput({ ...request, count: 0 })).toThrow();
        expect(() => tool.validateInput({ ...request, prompt: " " })).toThrow();
        expect(submit).not.toHaveBeenCalled();
    });

    it("does not retry a submission whose acceptance is uncertain", async () => {
        const submit = jest.fn(async (_input: CreateImageToolInput): Promise<{ taskId: string }> => {
            throw new Error("provider response lost after POST");
        });
        const tool = createCreateImageTool({
            conversationId: "conversation-1", stableMessageId: "message-1", operationId: "operation-1", submit,
        });
        const first = await tool.execute(tool.validateInput(request), {} as ChatToolContext);
        const second = await tool.execute(tool.validateInput(request), {} as ChatToolContext);
        expect(submit).toHaveBeenCalledTimes(1);
        expect(first.ok).toBe(false);
        expect(second.ok).toBe(false);
        expect(first.error).toMatch(/Could not confirm/);
    });

    it("explains an unavailable image connection without implying an uncertain paid submission", async () => {
        const tool = createCreateImageTool({ conversationId: "conversation-1", stableMessageId: "message-1",
            operationId: "operation-1", submit: async () => { throw new Error("image_generation:connection_unavailable"); } });
        const result = await tool.execute(tool.validateInput(request), {} as ChatToolContext);
        expect(result.error).toMatch(/compatible Wan connection/);
        expect(result.error).not.toMatch(/Check its card/);
    });

    it("asks the user to choose a supported count instead of silently making fewer images", async () => {
        const tool = createCreateImageTool({ conversationId: "conversation-1", stableMessageId: "message-1",
            operationId: "operation-1", submit: async () => { throw new Error("image_generation:count_exceeds_provider_limit"); } });
        const result = await tool.execute(tool.validateInput({ ...request, count: 5 }), {} as ChatToolContext);
        expect(result.error).toMatch(/choose 1–4 images/);
    });
});

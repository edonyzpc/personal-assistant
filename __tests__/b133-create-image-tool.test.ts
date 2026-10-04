import { describe, expect, it, jest } from "@jest/globals";
import { createChatToolCapability } from "../src/ai-services/capability-adapter";
import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import { createCreateImageTool, type ChatToolContext, type CreateImageToolInput } from "../src/ai-services/chat-tools";
import { PolicyEngine } from "../src/ai-services/policy-engine";
import { ImagePreacceptError, IMAGE_ACCEPTANCE_UNKNOWN_MESSAGE } from "../src/chat/image-generation-types";

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
        expect(tool.inputSchema.required).toEqual(["prompt", "operation"]);
        expect(tool.inputSchema.properties.count).toMatchObject({ minimum: 1, maximum: 4 });
        expect(tool.inputSchema.properties.totalCount).toMatchObject({ type: "integer", minimum: 1, maximum: 4 });
        for (const secretOrHostKey of ["conversationId", "stableMessageId", "operationId", "endpoint", "credential", "path", "confirmed", "countExplicitlyAuthorized"]) {
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
        expect((submit.mock.calls[0] as unknown[])[0]).toEqual(request);
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
        expect((submit.mock.calls[0] as unknown[])[0]).toEqual(request);
        expect((submit.mock.calls[0] as unknown[])[1]).toEqual(expect.any(Function));
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
        expect(() => tool.validateInput({ ...request, count: 5 })).toThrow();
        expect(() => tool.validateInput({ ...request, operation: undefined })).toThrow();
        expect(() => tool.validateInput({ ...request, confirmed: true })).toThrow();
        expect(() => tool.validateInput({ ...request, totalCount: 0 })).toThrow();
        expect(() => tool.validateInput({ ...request, totalCount: 5 })).toThrow();
        expect(() => tool.validateInput({ ...request, totalCount: 1.5 })).toThrow();
        expect(tool.validateInput({ ...request, totalCount: 2 })).toEqual({ ...request, totalCount: 2 });
        expect(() => tool.validateInput({ ...request, prompt: " " })).toThrow();
        expect(submit).not.toHaveBeenCalled();
    });

    it("retains the actual second slot identity when unknown submission is replayed with changed text", async () => {
        const context = { host: {} as ChatToolContext['host'] };
        const submit = jest.fn(async () => { throw new Error('acknowledgement lost'); });
        const tool = createCreateImageTool({ conversationId: 'conversation-1', stableMessageId: 'message-1',
            operationId: 'host-plan', submit });
        const input = { ...request, subrequestIndex: 2, totalCount: 2 };
        const first = await tool.execute(input, context);
        const replay = await tool.execute({ ...input, prompt: 'Changed description' }, context);
        expect(first.resultFact).toEqual({ kind: 'unknown', operationId: 'host-plan-sub2' });
        expect(replay.resultFact).toEqual(first.resultFact);
        expect(submit).toHaveBeenCalledTimes(1);
    });

    it("does not retry a submission whose acceptance is uncertain", async () => {
        const submit = jest.fn(async (_input: CreateImageToolInput): Promise<{ taskId: string }> => {
            throw new Error("provider response lost after POST");
        });
        const tool = createCreateImageTool({
            conversationId: "conversation-1", stableMessageId: "message-1", operationId: "operation-1", submit,
        });
        const first = await tool.execute(tool.validateInput(request), {} as ChatToolContext);
        const second = await tool.execute(tool.validateInput({ ...request, prompt: "A changed description" }), {} as ChatToolContext);
        expect(submit).toHaveBeenCalledTimes(1);
        expect(first.ok).toBe(false);
        expect(second.ok).toBe(false);
        for (const result of [first, second]) {
            expect(result).toMatchObject({ error: IMAGE_ACCEPTANCE_UNKNOWN_MESSAGE,
                executionState: "acceptance_unknown",
                recovery: { code: "image_acceptance_unknown", allowedActions: ["query_operation", "needs_user"] } });
            expect(result.error).not.toMatch(/card|no image task was accepted/i);
        }
    });

    it("explains an unavailable image connection without implying an uncertain paid submission", async () => {
        const tool = createCreateImageTool({ conversationId: "conversation-1", stableMessageId: "message-1",
            operationId: "operation-1", submit: async () => { throw new ImagePreacceptError("connection_unavailable", "needs_user"); } });
        const result = await tool.execute(tool.validateInput(request), {} as ChatToolContext);
        expect(result.error).toMatch(/compatible Wan connection/);
        expect(result.error).not.toMatch(/Check its card/);
        expect(result).toMatchObject({ executionState: "not_started",
            recovery: { code: "image_connection_unavailable", allowedActions: ["needs_user"] } });
    });

    it("explains unusable description preparation without implying Wan acceptance", async () => {
        const tool = createCreateImageTool({ conversationId: "conversation-1", stableMessageId: "message-1",
            operationId: "operation-1", submit: async () => {
                throw new ImagePreacceptError("preparation_failed", "needs_user");
            } });
        const result = await tool.execute(tool.validateInput(request), {} as ChatToolContext);
        expect(result.error).toMatch(/No image task was accepted/);
        expect(result.error).toMatch(/Description model costs may already have been used/);
        expect(result.error).not.toMatch(/Check its card|unknown/i);
        expect(result).toMatchObject({ executionState: "not_started",
            recovery: { code: "image_preparation_failed", allowedActions: ["needs_user"] } });
    });

    it("asks the user to choose a supported count instead of silently making fewer images", async () => {
        const tool = createCreateImageTool({ conversationId: "conversation-1", stableMessageId: "message-1",
            operationId: "operation-1", submit: async () => { throw new ImagePreacceptError("count_exceeds_provider_limit"); } });
        const result = await tool.execute(tool.validateInput(request), {} as ChatToolContext);
        expect(result.error).toMatch(/choose 1–4 images/);
        expect(result.executionState).toBe("not_started");
    });

    it("releases only the correctable slot and preserves an already accepted sibling", async () => {
        let rejectedFirstSlot = false;
        const submit = jest.fn(async (value: CreateImageToolInput) => {
            const index = value.subrequestIndex ?? 1;
            if (index === 1 && !rejectedFirstSlot) {
                rejectedFirstSlot = true;
                throw new ImagePreacceptError("invalid_inputs");
            }
            return { taskId: `task-${index}` };
        });
        const tool = createCreateImageTool({ conversationId: "conversation-1", stableMessageId: "message-1",
            operationId: "operation-1", submit });
        const first = await tool.execute(tool.validateInput({ ...request, totalCount: 2, subrequestIndex: 1 }), {} as ChatToolContext);
        const sibling = await tool.execute(tool.validateInput({ ...request, totalCount: 2, subrequestIndex: 2 }), {} as ChatToolContext);
        const corrected = await tool.execute(tool.validateInput({ ...request, prompt: "Corrected image", totalCount: 2,
            subrequestIndex: 1 }), {} as ChatToolContext);
        const repeatedSibling = await tool.execute(tool.validateInput({ ...request, prompt: "Do not replay this image",
            totalCount: 2, subrequestIndex: 2 }), {} as ChatToolContext);
        expect(first).toMatchObject({ ok: false, executionState: "not_started",
            recovery: { code: "image_invalid_inputs", allowedActions: ["correct_input"] } });
        expect(sibling.content).toMatchObject({ status: "accepted", taskId: "task-2" });
        expect(corrected.content).toMatchObject({ status: "accepted", taskId: "task-1" });
        expect(repeatedSibling.content).toMatchObject({ status: "already_accepted", taskId: "task-2" });
        expect(submit).toHaveBeenCalledTimes(3);
        expect(submit.mock.calls[2][0]).toMatchObject({ prompt: "Corrected image", subrequestIndex: 1 });
    });

    it.each(["needs_user", "stale"] as const)("retains a typed %s refusal after changed arguments", async action => {
        const submit = jest.fn(async () => { throw new ImagePreacceptError("source_changed", action); });
        const tool = createCreateImageTool({ conversationId: "conversation-1", stableMessageId: "message-1",
            operationId: "operation-1", submit });
        const first = await tool.execute(tool.validateInput(request), {} as ChatToolContext);
        const changed = await tool.execute(tool.validateInput({ ...request, prompt: "A replacement image" }), {} as ChatToolContext);
        expect(submit).toHaveBeenCalledTimes(1);
        for (const result of [first, changed]) {
            expect(result).toMatchObject({ ok: false, executionState: "not_started",
                recovery: { code: "image_source_changed", allowedActions: action === "stale" ? ["none"] : ["needs_user"] } });
        }
    });
});

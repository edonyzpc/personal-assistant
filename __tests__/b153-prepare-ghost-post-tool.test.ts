import { describe, expect, it, jest } from "@jest/globals";
import { createChatToolCapability } from "../src/ai-services/capability-adapter";
import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import { chatToolResultToPaAgentToolExecutionResult, createPaAgentCapabilityToolExecutor } from "../src/ai-services/pa-agent-host-tools";
import { PolicyEngine } from "../src/ai-services/policy-engine";
import { createPrepareGhostPostTool, isChatToolName, type ChatToolContext,
    type GhostHostBinding, type GhostPostToolReceipt } from "../src/ai-services/chat-tools";
import { GhostHostAdmissionError } from "../src/ghost-publishing/types";
import { GHOST_METADATA_FAILURE_MESSAGES, type GhostMetadataFailureReason } from "../src/ai-services/ghost-tool-receipt";

function fixture(submit: GhostHostBinding["submit"] = async () => ({ status: "prepared", operationId: "opaque-operation", executionState: "succeeded" })) {
    let current = true;
    let inherited = true;
    const signal = new AbortController();
    const guard = { isCurrent: () => current, isNoteDomainAllowed: () => true, isPathAllowed: () => current,
        captureSourceValidity: () => () => inherited };
    const binding: GhostHostBinding = { conversationId: "conversation", stableMessageId: "message", submit };
    const tool = createPrepareGhostPostTool(binding);
    const context = { host: { log: () => undefined }, taskSourceReadGuard: guard, signal: signal.signal } as unknown as ChatToolContext;
    const capability = createChatToolCapability(tool, { providerId: "chat-ghost-publishing", platform: "desktop" });
    capability.executionMode = "sequential";
    return { tool, context, capability, guard, signal,
        revoke: () => { current = false; }, revokeInherited: () => { inherited = false; } };
}

describe("B-153 fixed Ghost preparation capability", () => {
    it("exports only a desktop sequential Host capability and treats it as a side effect", () => {
        const { capability, tool, context } = fixture();
        const registry = new CapabilityRegistry();
        expect(registry.register(capability)).toBe(true);
        expect(registry.exportProviderSchemas().map(schema => schema.function.name)).toContain("prepare_ghost_post");
        expect(Object.keys(tool.inputSchema.properties)).toEqual(["intent", "path", "name"]);
        expect(isChatToolName("prepare_ghost_post")).toBe(true);
        const executor = createPaAgentCapabilityToolExecutor({ registry, host: context.host });
        expect(executor.getExecutionMode?.("prepare_ghost_post")).toBe("sequential");
        expect(executor.getRetrySafety?.("prepare_ghost_post")).toBe("side_effect");
        expect(new PolicyEngine({ platform: "mobile" }).canExport(capability).allowed).toBe(false);
        for (const patch of [{ name: "query_notes" }, { permission: "read-only" }, { permission: "network-read" },
            { providerId: "third-party" }, { origin: "skill" }, { platform: "both" }, { executionMode: "parallel" }]) {
            expect(new PolicyEngine().canExecute({ ...capability, ...patch } as typeof capability).allowed).toBe(false);
        }
    });

    it.each([
        { intent: "prepare", confirmed: true }, { intent: "restore" }, { intent: "restore", postId: "article" },
        { intent: "prepare", body: "private body" }, { intent: "prepare", url: "https://other.invalid/" },
        { intent: "prepare", injection: "script" }, { intent: "publish" },
        { intent: "prepare", path: "A.md", name: "B" }, { intent: "prepare", path: "../A.md" },
    ])("rejects unsupported or privileged inputs %#", input => {
        expect(() => fixture().tool.validateInput(input)).toThrow();
    });

    it("preserves the three locator forms without expanding an absent target", () => {
        const { tool } = fixture();
        for (const input of [{ intent: "prepare" }, { intent: "prepare", path: "folder/A.md" }, { intent: "prepare", name: "A" }]) {
            expect(tool.validateInput(input)).toEqual(input);
        }
    });

    it("submits once with live boundaries and only returns a safe preparation fact", async () => {
        const submit = jest.fn<GhostHostBinding["submit"]>(async () => ({ status: "prepared", operationId: "opaque-operation", executionState: "succeeded",
            payload: "PRIVATE_BODY", previewUrl: "https://private.invalid/secret", message: "UNTRUSTED_MESSAGE" }));
        const app = fixture(submit);
        const input = app.tool.validateInput({ intent: "prepare", path: "private/note.md" });
        const first = await app.tool.execute(input, app.context);
        const repeated = await app.tool.execute(input, app.context);
        const changed = await app.tool.execute({ intent: "prepare", name: "different" }, app.context);
        expect(submit).toHaveBeenCalledTimes(1);
        expect(submit.mock.calls[0][1]).toBe(app.guard);
        expect(submit.mock.calls[0][2]()).toBe(true);
        expect(submit.mock.calls[0][3]).toBe(app.signal.signal);
        expect(first.resultFact).toEqual({ kind: "approval_pending", intentId: "opaque-operation" });
        expect(repeated).toEqual(first);
        expect(changed.ok).toBe(false);
        expect(JSON.stringify(first)).not.toMatch(/PRIVATE_BODY|private\/note|private.invalid|UNTRUSTED_MESSAGE/);
        app.revokeInherited();
        expect(submit.mock.calls[0][2]()).toBe(false);
        expect((await app.tool.execute(input, app.context)).ok).toBe(false);
    });

    it.each(["missing", "revoked", "web-only", "aborted"])("refuses %s admission before Host submission", async state => {
        const submit = jest.fn<GhostHostBinding["submit"]>(async () => ({ status: "prepared", operationId: "opaque-operation", executionState: "succeeded" }));
        const app = fixture(submit);
        if (state === "missing") delete app.context.taskSourceReadGuard;
        if (state === "revoked") app.revoke();
        if (state === "web-only") app.guard.isNoteDomainAllowed = () => false;
        if (state === "aborted") app.signal.abort();
        expect((await app.tool.execute({ intent: "prepare" }, app.context)).ok).toBe(false);
        expect(submit).not.toHaveBeenCalled();
    });

    it("accepts a pure user-text guard with no inherited source while preserving current scope", async () => {
        const app = fixture();
        delete app.context.taskSourceReadGuard!.captureSourceValidity;
        expect((await app.tool.execute({ intent: "prepare" }, app.context)).ok).toBe(true);
    });

    it("keeps unknown results non-published and does not automatically retry", async () => {
        const submit = jest.fn<GhostHostBinding["submit"]>(async () => ({ status: "outcome_unknown", operationId: "pending-operation", executionState: "acceptance_unknown" }));
        const app = fixture(submit);
        const result = await app.tool.execute({ intent: "prepare" }, app.context);
        expect(result.resultFact).toEqual({ kind: "unknown", operationId: "pending-operation" });
        expect(result.executionState).toBe("acceptance_unknown");
        expect(result.recovery).toMatchObject({ allowedActions: ["query_operation", "needs_user"] });
        await app.tool.execute({ intent: "prepare" }, app.context);
        expect(submit).toHaveBeenCalledTimes(1);
    });

    it("reports a known preparation failure without inventing an unknown write or resubmitting", async () => {
        const submit = jest.fn<GhostHostBinding["submit"]>(async () => ({ status: "needs_attention", operationId: "attention-operation", executionState: "failed" }));
        const app = fixture(submit);
        const result = await app.tool.execute({ intent: "prepare" }, app.context);
        expect(result.ok).toBe(true);
        expect(result.resultFact).toEqual({ kind: "unavailable", capability: "prepare_ghost_post", reason: "ghost_attention_required" });
        expect(result.executionState).toBe("failed");
        expect(result.content).toMatchObject({ status: "needs_attention", operationId: "attention-operation" });
        expect(JSON.stringify(result)).not.toContain('"status":"prepared"');
        expect(JSON.stringify(result)).not.toContain('"status":"published"');
        expect(await app.tool.execute({ intent: "prepare" }, app.context)).toEqual(result);
        expect(submit).toHaveBeenCalledTimes(1);
    });

    it("does not invent an operation identity when attention is required before ownership exists", async () => {
        const app = fixture(async () => ({ status: "needs_attention", executionState: "not_started" }));
        const result = await app.tool.execute({ intent: "prepare" }, app.context);
        expect(result.ok).toBe(true);
        expect(result.resultFact).toEqual({ kind: "unavailable", capability: "prepare_ghost_post", reason: "ghost_attention_required" });
        expect(result.content).not.toHaveProperty('operationId');
    });
    it.each(Object.keys(GHOST_METADATA_FAILURE_MESSAGES) as GhostMetadataFailureReason[])("reports the exact safe %s metadata failure without repeating preparation", async failureReason => {
        const submit = jest.fn<GhostHostBinding["submit"]>(async () => ({ status: "needs_attention", executionState: "not_started", failureReason,
            operationId: "metadata-operation", message: "PRIVATE_PROVIDER_DETAIL", payload: "PRIVATE_BODY" }));
        const app = fixture(submit);
        const result = await app.tool.execute({ intent: "prepare" }, app.context);
        expect(result.content).toEqual({ status: "needs_attention", operationId: "metadata-operation", failureReason,
            message: GHOST_METADATA_FAILURE_MESSAGES[failureReason] });
        expect(result.executionState).toBe("not_started");
        expect(result.recovery).toMatchObject({ code: "ghost_attention_required", allowedActions: ["needs_user"] });
        expect(JSON.stringify(result)).not.toMatch(/PRIVATE_PROVIDER_DETAIL|PRIVATE_BODY/);
        expect(await app.tool.execute({ intent: "prepare" }, app.context)).toEqual(result);
        expect(submit).toHaveBeenCalledTimes(1);
    });
    it.each([
        { status: "needs_attention", executionState: "not_started", failureReason: "PRIVATE_CODE" },
        { status: "needs_attention", executionState: "succeeded", failureReason: "provider_failure" },
    ])("rejects an invalid metadata failure receipt %#", async receipt => {
        const app = fixture(async () => ({ ...receipt, operationId: "metadata-operation" }) as GhostPostToolReceipt);
        const result = await app.tool.execute({ intent: "prepare" }, app.context);
        expect(result.ok).toBe(false);
        expect(JSON.stringify(result)).not.toContain("PRIVATE_CODE");
        expect(JSON.stringify(result)).not.toContain("No Ghost post or image writes were started");
    });

    it("retains a known remote save even if source authority changes after its response", async () => {
        let revoke = () => {};
        const app = fixture(async () => {
            revoke();
            return { status: "needs_attention", operationId: "attention-operation", executionState: "succeeded" };
        });
        revoke = app.revokeInherited;
        const result = await app.tool.execute({ intent: "prepare" }, app.context);
        expect(result.ok).toBe(true);
        expect(result.executionState).toBe("succeeded");
        expect(result.resultFact).toEqual({ kind: "approval_pending", intentId: "attention-operation" });
        expect(result.content).toMatchObject({ status: "needs_attention", operationId: "attention-operation" });
    });

    it("rejects a receipt containing a URL as its opaque identity", async () => {
        const app = fixture(async () => ({ status: "prepared", operationId: "https://private.invalid/token", executionState: "succeeded" }));
        const result = await app.tool.execute({ intent: "prepare" }, app.context);
        expect(result.ok).toBe(false);
        expect(JSON.stringify(result)).not.toContain("private.invalid");
    });

    it("allows one target correction after a typed not-started admission failure", async () => {
        const submit = jest.fn<GhostHostBinding["submit"]>(async () => {
            throw new GhostHostAdmissionError("target", {
                executionState: "not_started",
                recovery: { code: "ghost_target_ambiguous", allowedActions: ["correct_input"] },
            });
        });
        const app = fixture(submit);
        const rejected = await app.tool.execute({ intent: "prepare", name: "Missing" }, app.context);
        expect(rejected).toMatchObject({ ok: false, executionState: "not_started",
            recovery: { code: "ghost_target_ambiguous", allowedActions: ["correct_input"] } });
        expect(rejected.error).toContain("no preparation was started");
        const corrected = await app.tool.execute({ intent: "prepare", path: "A.md" }, app.context);
        expect(corrected.ok).toBe(false);
        expect(submit).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(rejected)).not.toMatch(/PRIVATE_BODY|private.invalid/);
        expect(JSON.stringify(corrected)).not.toMatch(/PRIVATE_BODY|private.invalid/);
    });

    it("projects the closed Ghost admission protocol through the Runtime execution bridge", async () => {
        const submit = jest.fn<GhostHostBinding["submit"]>(async () => {
            throw new Error("entered controller before failure");
        });
        const app = fixture(submit);
        const targetApp = fixture(async () => {
            throw new GhostHostAdmissionError("target", {
                executionState: "not_started",
                recovery: { code: "ghost_target_missing", allowedActions: ["correct_input"] },
            });
        });
        const target = await targetApp.tool.execute({ intent: "prepare" }, targetApp.context);
        await app.tool.execute({ intent: "prepare" }, app.context);
        const bridge = (result: Awaited<ReturnType<typeof app.tool.execute>>) => chatToolResultToPaAgentToolExecutionResult(
            { type: "toolCall", id: "call", index: 0, name: "prepare_ghost_post", input: {} },
            result,
        );
        expect(bridge(target)).toMatchObject({ executionState: "not_started",
            recovery: { code: "ghost_target_missing", allowedActions: ["correct_input"] } });
        expect(bridge(await app.tool.execute({ intent: "prepare" }, app.context))).toMatchObject({
            executionState: "acceptance_unknown",
            recovery: { code: "ghost_preparation_acceptance_unknown", allowedActions: ["query_operation", "needs_user"] },
        });
    });

    it.each(["source", "stale"] as const)("preserves the failed submission after a non-correctable %s rejection", async reason => {
        const submit = jest.fn<GhostHostBinding["submit"]>(async () => {
            throw new GhostHostAdmissionError(reason, {
                executionState: "not_started",
                recovery: { code: `ghost_${reason}`, allowedActions: reason === "source" ? ["needs_user"] : ["none"] },
            });
        });
        const app = fixture(submit);
        const rejected = await app.tool.execute({ intent: "prepare", name: "Denied" }, app.context);
        expect(rejected).toMatchObject({ ok: false, executionState: "not_started",
            recovery: { allowedActions: reason === "source" ? ["needs_user"] : ["none"] } });
        const changed = await app.tool.execute({ intent: "prepare", path: "A.md" }, app.context);
        expect(changed.ok).toBe(false);
        expect(changed.error).toContain(reason === "source"
            ? "The Ghost source is unavailable or not authorized for this request"
            : "The Ghost request or its source guard is no longer current");
        expect(changed).toMatchObject({ executionState: "not_started",
            recovery: { code: `ghost_${reason}`, allowedActions: reason === "source" ? ["needs_user"] : ["none"] } });
        expect(submit).toHaveBeenCalledTimes(1);
    });

    it("treats an exception after entry into the domain controller as outcome-unknown and blocks changed arguments", async () => {
        const submit = jest.fn<GhostHostBinding["submit"]>(async () => {
            throw new Error("controller wrote local frontmatter then failed before operationId");
        });
        const app = fixture(submit);
        const first = await app.tool.execute({ intent: "prepare", path: "A.md" }, app.context);
        expect(first).toMatchObject({ ok: false, executionState: "acceptance_unknown",
            recovery: { code: "ghost_preparation_acceptance_unknown", allowedActions: ["query_operation", "needs_user"] } });
        const same = await app.tool.execute({ intent: "prepare", path: "A.md" }, app.context);
        const changed = await app.tool.execute({ intent: "prepare", name: "Different" }, app.context);
        expect(same.ok).toBe(false);
        expect(changed.ok).toBe(false);
        expect(submit).toHaveBeenCalledTimes(1);
        expect(changed.error).toContain("The preparation result is unknown.");
    });

    it.each(["published", "applied"])("does not accept a %s receipt as a preparation", async status => {
        const app = fixture(async () => ({ status, operationId: "opaque-operation" } as unknown as GhostPostToolReceipt));
        expect((await app.tool.execute({ intent: "prepare" }, app.context)).ok).toBe(false);
    });
});

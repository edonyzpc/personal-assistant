import { describe, expect, it, jest } from "@jest/globals";
import { createChatToolCapability } from "../src/ai-services/capability-adapter";
import { CapabilityRegistry } from "../src/ai-services/capability-registry";
import { createPaAgentCapabilityToolExecutor } from "../src/ai-services/pa-agent-host-tools";
import { PolicyEngine } from "../src/ai-services/policy-engine";
import { createPrepareGhostPostTool, isChatToolName, type ChatToolContext,
    type GhostHostBinding, type GhostPostToolReceipt } from "../src/ai-services/chat-tools";

function fixture(submit: GhostHostBinding["submit"] = async () => ({ status: "prepared", operationId: "opaque-operation" })) {
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
        { intent: "prepare", confirmed: true }, { intent: "restore", postId: "article" },
        { intent: "prepare", body: "private body" }, { intent: "prepare", url: "https://other.invalid/" },
        { intent: "prepare", injection: "script" }, { intent: "publish" },
        { intent: "prepare", path: "A.md", name: "B" }, { intent: "prepare", path: "../A.md" },
    ])("rejects unsupported or privileged inputs %#", input => {
        expect(() => fixture().tool.validateInput(input)).toThrow();
    });

    it("preserves the three locator forms without expanding an absent target", () => {
        const { tool } = fixture();
        for (const input of [{ intent: "prepare" }, { intent: "prepare", path: "folder/A.md" }, { intent: "restore", name: "A" }]) {
            expect(tool.validateInput(input)).toEqual(input);
        }
    });

    it("submits once with live boundaries and only returns a safe preparation fact", async () => {
        const submit = jest.fn<GhostHostBinding["submit"]>(async () => ({ status: "prepared", operationId: "opaque-operation",
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
        const submit = jest.fn<GhostHostBinding["submit"]>(async () => ({ status: "prepared", operationId: "opaque-operation" }));
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
        const submit = jest.fn<GhostHostBinding["submit"]>(async () => ({ status: "outcome_unknown", operationId: "pending-operation" }));
        const app = fixture(submit);
        const result = await app.tool.execute({ intent: "prepare" }, app.context);
        expect(result.resultFact).toEqual({ kind: "unknown", operationId: "pending-operation" });
        await app.tool.execute({ intent: "prepare" }, app.context);
        expect(submit).toHaveBeenCalledTimes(1);
    });

    it("rejects a receipt containing a URL as its opaque identity", async () => {
        const app = fixture(async () => ({ status: "prepared", operationId: "https://private.invalid/token" }));
        const result = await app.tool.execute({ intent: "prepare" }, app.context);
        expect(result.ok).toBe(false);
        expect(JSON.stringify(result)).not.toContain("private.invalid");
    });

    it("maps an ambiguous target to fixed guidance and never forwards raw errors", async () => {
        const submit = jest.fn<GhostHostBinding["submit"]>(async () => {
            throw Object.assign(new Error("PRIVATE_BODY https://private.invalid/key"), { code: "target-ambiguous" });
        });
        const app = fixture(submit);
        const result = await app.tool.execute({ intent: "prepare" }, app.context);
        expect(result.error).toContain("exact vault-relative note path");
        expect(JSON.stringify(result)).not.toMatch(/PRIVATE_BODY|private.invalid/);
        await app.tool.execute({ intent: "prepare" }, app.context);
        expect(submit).toHaveBeenCalledTimes(1);
    });

    it.each(["published", "applied"])("does not accept a %s receipt as a preparation", async status => {
        const app = fixture(async () => ({ status, operationId: "opaque-operation" } as unknown as GhostPostToolReceipt));
        expect((await app.tool.execute({ intent: "prepare" }, app.context)).ok).toBe(false);
    });
});

import { describe, expect, it } from "@jest/globals";

import type {
    AgentCapability,
    AgentPermission,
    AgentPermissionFuture,
} from "../src/ai-services/capability-types";
import { PolicyEngine } from "../src/ai-services/policy-engine";

/**
 * Builds a minimal `AgentCapability` for PolicyEngine unit tests. Only fields
 * that PolicyEngine.evaluate inspects (kind, permission, requiresConfirmation,
 * failureBehavior, platform) are exercised here; the rest are inert stubs so
 * tests stay focused on the decision matrix in framework SDD §4.
 */
function buildCapability(overrides: Partial<AgentCapability>): AgentCapability {
    const base: AgentCapability = {
        name: "search_vault_metadata",
        description: "test capability",
        inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
        plannerGuidance: [],
        kind: "tool",
        origin: "core",
        providerId: "test-provider",
        permission: "read-only",
        sourceBoundary: "read-only-tool",
        cost: "free",
        platform: "both",
        outputBudgetChars: 6000,
        timeoutMs: 30_000,
        requiresConfirmation: false,
        failureBehavior: "recoverable",
        statusMessageText: "running",
        sourceRecordKind: "context-used",
        toProviderSchema: () => ({
            type: "function",
            function: {
                name: "search_vault_metadata",
                description: "test capability",
                parameters: {
                    type: "object",
                    properties: {},
                    required: [],
                    additionalProperties: false,
                },
            },
        }),
        toRegistryDefinition: () => ({
            name: "search_vault_metadata",
            description: "test capability",
            inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
            plannerGuidance: [],
            permission: "read-only",
            cost: "free",
            outputBudgetChars: 6000,
            requiresConfirmation: false,
            failureBehavior: "recoverable",
            statusMessage: "running",
            sourceBoundary: "read-only-tool",
        }),
        execute: async () => ({
            status: "ok",
            observation: null,
            sourceRecords: [],
            inputSummary: "",
            sources: [],
        }),
    };
    return { ...base, ...overrides };
}

describe("PolicyEngine decision matrix (framework SDD §4.2)", () => {
    // Row 1: tool + read-only on chat runtime → allowed
    it("row 1: tool/read-only on chat runtime → allowed", () => {
        const engine = new PolicyEngine();
        const capability = buildCapability({ kind: "tool", permission: "read-only" });
        expect(engine.canExport(capability)).toEqual({ allowed: true });
    });

    // Row 2: tool + network-read on chat runtime → allowed
    it("row 2: tool/network-read on chat runtime → allowed", () => {
        const engine = new PolicyEngine();
        const capability = buildCapability({ kind: "tool", permission: "network-read" });
        expect(engine.canExport(capability)).toEqual({ allowed: true });
    });

    // Row 3: tool + write on chat runtime → denied (non-action write permission rejected)
    it("row 3: tool/write on chat runtime → denied (permission not in chat allowlist)", () => {
        const engine = new PolicyEngine();
        const capability = buildCapability({
            kind: "tool",
            permission: "write" as AgentPermission,
        });
        const decision = engine.canExport(capability);
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toMatch(/permission write is not allowed/);
    });

    // Row 4: action + write on chat runtime (allowWrite=false) → denied
    it("row 4: action/write on chat runtime (allowWrite=false) → denied", () => {
        const engine = new PolicyEngine();
        const capability = buildCapability({
            kind: "action",
            permission: "write" as AgentPermission,
            requiresConfirmation: true,
        });
        const decision = engine.canExport(capability);
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toMatch(/action capabilities require/);
    });

    // Row 5: action + write + review + allowWrite=true + allowlist=[write] → allowed
    it('row 5: action/write on review runtime with allowlist=["write"] → allowed', () => {
        const engine = new PolicyEngine({
            runKind: "review",
            allowWrite: true,
            allowedActionPermissions: ["write"],
        });
        const capability = buildCapability({
            kind: "action",
            permission: "write" as AgentPermission,
            requiresConfirmation: true,
        });
        expect(engine.canExport(capability)).toEqual({ allowed: true });
    });

    // Row 6: action + write + review + allowWrite=true + allowlist=[] → denied (allowlist rejects)
    it("row 6: action/write on review runtime with empty allowlist → denied", () => {
        const engine = new PolicyEngine({
            runKind: "review",
            allowWrite: true,
            allowedActionPermissions: [],
        });
        const capability = buildCapability({
            kind: "action",
            permission: "write" as AgentPermission,
            requiresConfirmation: true,
        });
        const decision = engine.canExport(capability);
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toMatch(/not in allowlist/);
    });

    // Row 7: action + local-filesystem-write + review + allowWrite=true + allowlist=[write] → denied
    it('row 7: action/local-filesystem-write on review runtime with allowlist=["write"] → denied', () => {
        const engine = new PolicyEngine({
            runKind: "review",
            allowWrite: true,
            allowedActionPermissions: ["write"],
        });
        const capability = buildCapability({
            kind: "action",
            permission: "local-filesystem-write" as AgentPermission,
            requiresConfirmation: true,
        });
        const decision = engine.canExport(capability);
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toMatch(/local-filesystem-write.*not in allowlist/);
    });

    // Row 8: action + local-filesystem-write + review + allowWrite=true + allowlist=[write, local-filesystem-write] → allowed
    it("row 8: action/local-filesystem-write on review runtime with matching allowlist → allowed", () => {
        const engine = new PolicyEngine({
            runKind: "review",
            allowWrite: true,
            allowedActionPermissions: ["write", "local-filesystem-write"],
        });
        const capability = buildCapability({
            kind: "action",
            permission: "local-filesystem-write" as AgentPermission,
            requiresConfirmation: true,
        });
        expect(engine.canExport(capability)).toEqual({ allowed: true });
    });

    // Row 9: action + shell + review + allowWrite=true + allowlist=[write] → denied (v1 framework rejects shell)
    it('row 9: action/shell on review runtime with allowlist=["write"] → denied', () => {
        const engine = new PolicyEngine({
            runKind: "review",
            allowWrite: true,
            allowedActionPermissions: ["write"],
        });
        const capability = buildCapability({
            kind: "action",
            permission: "shell" as AgentPermission,
            requiresConfirmation: true,
        });
        const decision = engine.canExport(capability);
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toMatch(/shell.*not in allowlist/);
    });
});

describe("PolicyEngine chat runtime backward-compat smoke (framework SDD §4.3)", () => {
    it("default constructor (no options) keeps PA v1 chat-runtime behavior intact", () => {
        // Pa-agent-runtime.ts:488 calls `new PolicyEngine({ platform: runtimePlatform })`
        // without runKind/allowWrite/allowedActionPermissions. Behavior MUST equal pre-A1.
        const engine = new PolicyEngine();

        // PA v1 chat tools: read-only + recoverable + no confirmation + tool → allowed
        expect(engine.canExport(buildCapability({
            kind: "tool",
            permission: "read-only",
            requiresConfirmation: false,
            failureBehavior: "recoverable",
        }))).toEqual({ allowed: true });

        // network-read also OK
        expect(engine.canExport(buildCapability({
            kind: "tool",
            permission: "network-read",
        }))).toEqual({ allowed: true });

        // action capability rejected (kind=action gate)
        expect(engine.canExport(buildCapability({
            kind: "action",
            permission: "write" as AgentPermission,
            requiresConfirmation: true,
        })).allowed).toBe(false);

        // Non-action write rejected (permission gate)
        expect(engine.canExport(buildCapability({
            kind: "tool",
            permission: "write" as AgentPermission,
        })).allowed).toBe(false);

        // requiresConfirmation=true on a non-action capability → rejected
        expect(engine.canExport(buildCapability({
            kind: "tool",
            permission: "read-only",
            requiresConfirmation: true,
        })).allowed).toBe(false);

        // Platform mismatch is still enforced (defaults to desktop)
        expect(engine.canExport(buildCapability({
            kind: "tool",
            permission: "read-only",
            platform: "mobile",
        })).allowed).toBe(false);
    });

    it("review runtime with allowWrite=false equals chat strict mode (action rejected)", () => {
        const engine = new PolicyEngine({ runKind: "review", allowWrite: false });
        const capability = buildCapability({
            kind: "action",
            permission: "write" as AgentPermission,
            requiresConfirmation: true,
        });
        const decision = engine.canExport(capability);
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toMatch(/require runKind="review" AND allowWrite=true/);
    });

    it("chat runtime with allowWrite=true still rejects action (runKind gate)", () => {
        // Guards against accidental misconfiguration: even if a future caller passes
        // allowWrite=true while leaving runKind defaulted to "chat", action must stay denied.
        const engine = new PolicyEngine({ allowWrite: true, allowedActionPermissions: ["write"] });
        const capability = buildCapability({
            kind: "action",
            permission: "write" as AgentPermission,
            requiresConfirmation: true,
        });
        const decision = engine.canExport(capability);
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toMatch(/require runKind="review"/);
    });

    it("review runtime preserves non-action chat constraints (no confirmation, no write permission)", () => {
        const engine = new PolicyEngine({
            runKind: "review",
            allowWrite: true,
            allowedActionPermissions: ["write", "local-filesystem-write"],
        });

        // tool+write still rejected (allowlist only applies to action capabilities)
        expect(engine.canExport(buildCapability({
            kind: "tool",
            permission: "write" as AgentPermission,
        })).allowed).toBe(false);

        // tool+read-only with requiresConfirmation=true still rejected
        expect(engine.canExport(buildCapability({
            kind: "tool",
            permission: "read-only",
            requiresConfirmation: true,
        })).allowed).toBe(false);
    });

    it("allowedActionPermissions accepts readonly AgentPermissionFuture[] input", () => {
        // Type-level smoke test: ensures Set<AgentPermission> internal can be seeded from
        // a readonly AgentPermissionFuture[] without compile errors.
        const allowlist: readonly AgentPermissionFuture[] = ["write", "local-filesystem-write"] as const;
        const engine = new PolicyEngine({
            runKind: "review",
            allowWrite: true,
            allowedActionPermissions: allowlist,
        });
        expect(engine.canExport(buildCapability({
            kind: "action",
            permission: "write" as AgentPermission,
            requiresConfirmation: true,
        }))).toEqual({ allowed: true });
    });
});

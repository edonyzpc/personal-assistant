import type {
    AgentCapability,
    AgentPermissionFuture,
    AgentRuntimePlatform,
} from "./capability-types";

export interface CapabilityPolicyDecision {
    allowed: boolean;
    reason?: string;
}

/** Runtime context discriminator for Write Action Framework v1. Chat runtime defaults to strict read-only. */
export type PolicyRunKind = "chat" | "review";

export interface PolicyEngineOptions {
    platform?: AgentRuntimePlatform;
    /**
     * Write Action Framework v1 parameters (Step 0 type skeleton).
     *
     * When omitted (legacy chat runtime), PolicyEngine behavior is 100% unchanged:
     * kind="action" rejected, permission must be "read-only"|"network-read",
     * requiresConfirmation must be false, failureBehavior must be "recoverable".
     *
     * When runKind="review" AND allowWrite=true, kind="action" capabilities whose permission
     * is in `allowedActionPermissions` are permitted. The behavior matrix is implemented in
     * Track A · A1 (see docs/sdd-rollout-plan.md §3.2 and framework SDD §4).
     */
    runKind?: PolicyRunKind;
    allowWrite?: boolean;
    allowedActionPermissions?: readonly AgentPermissionFuture[];
}

export class PolicyEngine {
    private readonly platform: AgentRuntimePlatform;
    private readonly runKind: PolicyRunKind;
    private readonly allowWrite: boolean;
    private readonly allowedActionPermissions: readonly AgentPermissionFuture[];

    constructor(options: PolicyEngineOptions = {}) {
        this.platform = options.platform ?? "desktop";
        this.runKind = options.runKind ?? "chat";
        this.allowWrite = options.allowWrite ?? false;
        this.allowedActionPermissions = options.allowedActionPermissions ?? [];
    }

    canExport(capability: AgentCapability): CapabilityPolicyDecision {
        return this.evaluate(capability);
    }

    canExecute(capability: AgentCapability): CapabilityPolicyDecision {
        return this.evaluate(capability);
    }

    filterExportable(capabilities: readonly AgentCapability[]): AgentCapability[] {
        return capabilities.filter((capability) => this.canExport(capability).allowed);
    }

    private evaluate(capability: AgentCapability): CapabilityPolicyDecision {
        if (capability.kind === "action") {
            return { allowed: false, reason: "action capabilities are reserved for future action mode" };
        }
        if (capability.permission !== "read-only" && capability.permission !== "network-read") {
            return { allowed: false, reason: `permission ${capability.permission} is not allowed in PA Agent v1` };
        }
        if (capability.requiresConfirmation !== false) {
            return { allowed: false, reason: "v1 capabilities must not require confirmation" };
        }
        if (capability.failureBehavior !== "recoverable") {
            return { allowed: false, reason: "v1 capabilities must be recoverable" };
        }
        if (!isPlatformSupported(capability.platform, this.platform)) {
            return { allowed: false, reason: `capability is not supported on ${this.platform}` };
        }
        return { allowed: true };
    }
}

function isPlatformSupported(support: AgentCapability["platform"], platform: AgentRuntimePlatform): boolean {
    return support === "both" || support === platform;
}

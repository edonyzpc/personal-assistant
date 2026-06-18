import {
    MOCK_LICENSE_TIER,
    normalizeAgentCapabilityTier,
    type AgentCapabilityTier,
    type AgentCapability,
    type AgentPermission,
    type AgentPermissionFuture,
    type AgentRuntimePlatform,
} from "./capability-types";

export interface CapabilityPolicyDecision {
    allowed: boolean;
    reason?: string;
}

/** Runtime context discriminator for Write Action Framework v1. Chat runtime defaults to strict read-only. */
export type PolicyRunKind = "chat" | "review" | "chat-with-actions";

export interface PolicyEngineOptions {
    platform?: AgentRuntimePlatform;
    licenseTier?: AgentCapabilityTier;
    /**
     * Write Action Framework v1 parameters (see framework SDD §4).
     *
     * When omitted, licenseTier defaults to the temporary mock paid entitlement
     * while the rest of the chat runtime policy stays read-only by default:
     * - kind="action" rejected (defaults: runKind="chat", allowWrite=false)
     * - non-action permission must be "read-only" | "network-read"
     * - non-action requiresConfirmation must be false
     * - failureBehavior must be "recoverable"
     *
     * When `runKind="review"` or `runKind="chat-with-actions"` AND `allowWrite=true`
     * (review runtime / Operations Agent mode), kind="action" capabilities whose
     * permission is listed in `allowedActionPermissions` are permitted. Any other
     * combination (runKind="chat" with any allowWrite, or review/chat-with-actions
     * with allowWrite=false) keeps the strict chat-runtime behavior.
     *
     * Non-action capabilities retain the v1 chat constraints regardless of runKind/allowWrite.
     */
    runKind?: PolicyRunKind;
    allowWrite?: boolean;
    allowedActionPermissions?: readonly AgentPermissionFuture[];
}

export class PolicyEngine {
    private readonly platform: AgentRuntimePlatform;
    private readonly licenseTier: AgentCapabilityTier;
    private readonly runKind: PolicyRunKind;
    private readonly allowWrite: boolean;
    private readonly allowedActionPermissions: ReadonlySet<AgentPermission>;

    constructor(options: PolicyEngineOptions = {}) {
        this.platform = options.platform ?? "desktop";
        this.licenseTier = normalizeAgentCapabilityTier(options.licenseTier, MOCK_LICENSE_TIER);
        this.runKind = options.runKind ?? "chat";
        this.allowWrite = options.allowWrite ?? false;
        this.allowedActionPermissions = new Set<AgentPermission>(options.allowedActionPermissions ?? []);
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
        const capabilityTier = capability.tier ?? "free";
        if (capabilityTier === "paid" && this.licenseTier === "free") {
            return { allowed: false, reason: "premium-required" };
        }

        if (capability.kind === "action") {
            if ((this.runKind !== "review" && this.runKind !== "chat-with-actions") || !this.allowWrite) {
                return {
                    allowed: false,
                    reason: `action capabilities require runKind="review" or "chat-with-actions" AND allowWrite=true`,
                };
            }
            if (!this.allowedActionPermissions.has(capability.permission)) {
                return {
                    allowed: false,
                    reason: `action permission "${capability.permission}" not in allowlist`,
                };
            }
            // Action capabilities are required to have requiresConfirmation=true at the
            // type layer (see write-action-framework/types.ts WriteActionCapability).
            // PolicyEngine does not re-validate that flag here; framework gates enforce it
            // at execution time via the Preview-Confirmation Lifecycle.
        } else {
            // Non-action capability: retain PA v1 chat constraints (read-only/network-read,
            // no confirmation, recoverable). These limits hold regardless of allowWrite.
            if (capability.permission !== "read-only" && capability.permission !== "network-read") {
                return {
                    allowed: false,
                    reason: `permission ${capability.permission} is not allowed for non-action capabilities`,
                };
            }
            if (capability.requiresConfirmation !== false) {
                return { allowed: false, reason: "non-action capabilities must not require confirmation" };
            }
        }
        if (capability.failureBehavior !== "recoverable") {
            return { allowed: false, reason: "capabilities must be recoverable" };
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

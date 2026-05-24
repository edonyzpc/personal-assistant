import type {
    AgentCapability,
    AgentRuntimePlatform,
} from "./capability-types";

export interface CapabilityPolicyDecision {
    allowed: boolean;
    reason?: string;
}

export interface PolicyEngineOptions {
    platform?: AgentRuntimePlatform;
}

export class PolicyEngine {
    private readonly platform: AgentRuntimePlatform;

    constructor(options: PolicyEngineOptions = {}) {
        this.platform = options.platform ?? "desktop";
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

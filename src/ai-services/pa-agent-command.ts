import type { AgentCapability } from "./capability-types";

/** Reusable command declaration. The owning Product Spec remains authoritative. */
export interface PaAgentCommandDefinition {
    readonly id: string;
    readonly agentGuidance: readonly string[];
    /** Declared needs never grant execution by themselves. */
    readonly capabilityNames: readonly string[];
}

export type PaAgentCommandActivation =
    | { readonly kind: "typed-token"; readonly token: string }
    | { readonly kind: "composer-action"; readonly action: string };

/** One Host-bound request, created only after Chat has real message identity. */
export interface PaAgentCommandInvocation {
    readonly definition: PaAgentCommandDefinition;
    readonly conversationId: string;
    readonly stableMessageId: string;
    readonly activation: PaAgentCommandActivation;
}

interface CommandCapabilityRegistry {
    register(capability: AgentCapability): boolean;
    unregister(capability: AgentCapability): boolean;
}

export interface PaAgentCommandCapabilityScope {
    register(capability: AgentCapability): boolean;
    dispose(): void;
}

class OwnedCapabilityScope implements PaAgentCommandCapabilityScope {
    private readonly registered: AgentCapability[] = [];

    constructor(private readonly registry: CommandCapabilityRegistry) {}

    register(capability: AgentCapability): boolean {
        if (!this.registry.register(capability)) return false;
        this.registered.push(capability);
        return true;
    }

    dispose(): void {
        for (const capability of this.registered.reverse()) {
            this.registry.unregister(capability);
        }
        this.registered.length = 0;
    }
}

export function createPaAgentCommandCapabilityScope(
    registry: CommandCapabilityRegistry,
): PaAgentCommandCapabilityScope {
    return new OwnedCapabilityScope(registry);
}

/**
 * Render one invocation's declaration against capabilities actually exportable
 * in this run. A declaration is descriptive; it never registers or grants a tool.
 */
export function formatPaAgentCommandInvocationGuidance(
    invocation: PaAgentCommandInvocation,
    availableCapabilityNames: ReadonlySet<string>,
): string {
    const lines = [...invocation.definition.agentGuidance];
    for (const capabilityName of invocation.definition.capabilityNames) {
        lines.push(availableCapabilityNames.has(capabilityName)
            ? `Declared capability ${capabilityName} is currently admitted and exportable for this run.`
            : `Declared capability ${capabilityName} is not currently admitted or exportable; do not call it or claim its effect.`);
    }
    return lines.join("\n");
}

export const paAgentWritingCommandDefinition: PaAgentCommandDefinition = Object.freeze({
    id: "writing",
    agentGuidance: Object.freeze([
        "A Writing selection can be discussion, clarification, or delivery; it does not force a domain tool call.",
        "The Host authorizes candidate versions, registered images, source boundaries, and the reserved present_writing protocol. Select parentHandle=null, a candidate parent, scene, and materials from the actual user request.",
    ]),
    capabilityNames: Object.freeze([]),
});

export const paAgentCreateImageCommandDefinition: PaAgentCommandDefinition = Object.freeze({
    id: "create-image",
    agentGuidance: Object.freeze([
        "A CreateImage selection can be image discussion, prompt writing, or an actual generation/edit request.",
        "The host alone validates authorized refs, source lineage, cost, operation identity, and cancellation.",
    ]),
    capabilityNames: Object.freeze(["create_image"]),
});

export const paAgentGhostCommandDefinition: PaAgentCommandDefinition = Object.freeze({
    id: "blog2ghost",
    agentGuidance: Object.freeze([
        "A blog2ghost selection permits only the host-bound preparation request and never publication itself.",
        "Interpret the target from the user request. Correct a Host-reported not-started target error when the intended vault note is identifiable; ask only for unresolved ambiguity.",
        "Use the actual publishing card for human preview and confirmation. There are no automated preview checks, restore, or interrupted-operation continuation. Never invent a card or replay an unknown preparation.",
    ]),
    capabilityNames: Object.freeze(["prepare_ghost_post"]),
});

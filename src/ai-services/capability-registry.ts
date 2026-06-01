import {
    agentResultToChatToolResult,
    type AgentCapability,
    type AgentCapabilityContext,
    type AgentPlatformSupport,
    type CapabilityDiagnostic,
    type CapabilityProvider,
    type CapabilityUsageEvent,
    type PrepareCapabilityArgumentsContext,
    type PrepareCapabilityArgumentsResult,
    type ProviderLoadContext,
    type ProviderLoadResult,
} from "./capability-types";
import type {
    ChatToolName,
    ChatToolProviderSchema,
    ChatToolProviderSchemaExportResult,
    ChatToolRegistryDefinition,
    ChatToolResult,
} from "./chat-tools";
import {
    OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS,
    isObsidianOperationsV1AToolName,
} from "./chat-tools";
import { PolicyEngine } from "./policy-engine";
import { getErrorType } from "./agent-utils";

export interface CapabilityRegistryOptions {
    policyEngine?: PolicyEngine;
    telemetryEnabled?: boolean;
    onCapabilityEvent?: (event: CapabilityUsageEvent) => void;
}

export class CapabilityRegistry {
    private readonly capabilities = new Map<string, AgentCapability>();
    private readonly diagnostics: CapabilityDiagnostic[] = [];
    private readonly policyEngine: PolicyEngine;
    private telemetryEnabled: boolean;
    private onCapabilityEvent?: (event: CapabilityUsageEvent) => void;

    constructor(options: CapabilityRegistryOptions = {}) {
        this.policyEngine = options.policyEngine ?? new PolicyEngine();
        this.telemetryEnabled = options.telemetryEnabled ?? false;
        this.onCapabilityEvent = options.onCapabilityEvent;
    }

    setTelemetryEnabled(enabled: boolean): void {
        this.telemetryEnabled = enabled;
    }

    setCapabilityEventHandler(handler: ((event: CapabilityUsageEvent) => void) | undefined): void {
        this.onCapabilityEvent = handler;
    }

    register(capability: AgentCapability): boolean {
        if (this.capabilities.has(capability.name)) {
            this.diagnostics.push({
                type: "duplicate",
                capabilityName: capability.name,
                providerId: capability.providerId,
                reason: "duplicate capability name rejected; earlier registration kept",
            });
            return false;
        }
        const v1aPolicyError = getObsidianOperationsV1ACapabilityPolicyError(capability);
        if (v1aPolicyError) {
            this.diagnostics.push({
                type: "policy",
                capabilityName: capability.name,
                providerId: capability.providerId,
                reason: v1aPolicyError,
            });
            return false;
        }
        const decision = this.policyEngine.canExport(capability);
        if (!decision.allowed) {
            this.diagnostics.push({
                type: "policy",
                capabilityName: capability.name,
                providerId: capability.providerId,
                reason: decision.reason ?? "capability rejected by policy",
            });
        }
        this.capabilities.set(capability.name, capability);
        return true;
    }

    registerMany(capabilities: readonly AgentCapability[]): void {
        for (const capability of capabilities) {
            this.register(capability);
        }
    }

    async registerProvider(
        provider: CapabilityProvider,
        context: ProviderLoadContext,
    ): Promise<ProviderLoadResult> {
        if (!isPlatformSupported(provider.platform, context.platform)) {
            return {
                status: "unavailable",
                capabilities: [],
                unavailableReason: `provider is not supported on ${context.platform}`,
            };
        }

        let result: ProviderLoadResult;
        try {
            result = await provider.load(context);
        } catch (error) {
            return {
                status: "unavailable",
                capabilities: [],
                unavailableReason: error instanceof Error ? error.message : String(error),
                diagnostics: { errorType: getErrorType(error) },
            };
        }

        if (result.status !== "available") {
            return { ...result, capabilities: [] };
        }

        const registeredCapabilities: AgentCapability[] = [];
        for (const capability of result.capabilities) {
            const decision = this.policyEngine.canExport(capability);
            if (!decision.allowed) {
                this.diagnostics.push({
                    type: "policy",
                    capabilityName: capability.name,
                    providerId: capability.providerId,
                    reason: decision.reason ?? "capability rejected by policy",
                });
                continue;
            }
            if (this.register(capability)) {
                registeredCapabilities.push(capability);
            }
        }

        return { ...result, capabilities: registeredCapabilities };
    }

    get(name: string): AgentCapability | undefined {
        return this.capabilities.get(name);
    }

    getDefinition(name: string): ChatToolRegistryDefinition | undefined {
        return this.get(name)?.toRegistryDefinition();
    }

    listDefinitions(): ChatToolRegistryDefinition[] {
        return this.listCapabilitiesForExport().map((capability) => capability.toRegistryDefinition());
    }

    listCapabilities(): AgentCapability[] {
        return [...this.capabilities.values()];
    }

    listDiagnostics(): CapabilityDiagnostic[] {
        return this.diagnostics.map((diagnostic) => ({ ...diagnostic }));
    }

    exportProviderSchemas(): ChatToolProviderSchema[] {
        return this.listCapabilitiesForExport().map((capability) => capability.toProviderSchema());
    }

    exportProviderSchemasSafe(): ChatToolProviderSchemaExportResult {
        try {
            return { ok: true, schemas: this.exportProviderSchemas() };
        } catch (error) {
            return {
                ok: false,
                schemas: [],
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    has(name: string): boolean {
        return Boolean(this.get(name));
    }

    /**
     * Pre-validation pipeline for PA executor.
     * Delegates to capability.prepareAndValidate when defined; otherwise passes through.
     * PA executor converts { ok: false } to schema_invalid outcome BEFORE registry.execute,
     * bypassing the recoverable_error flattening in chatToolResultToPaAgentToolExecutionResult.
     */
    prepareAndValidate(
        name: string,
        raw: unknown,
        ctx: PrepareCapabilityArgumentsContext,
    ): PrepareCapabilityArgumentsResult {
        const capability = this.get(name);
        if (!capability) {
            return { ok: false, error: new Error(`Capability ${name} is not registered.`) };
        }
        if (!capability.prepareAndValidate) {
            return { ok: true, input: raw };
        }
        // Phase 4 preflight metadata: capability.prepareAndValidate returns repaired info
        // when prepareArguments mutated raw input. We pass it through verbatim.
        return capability.prepareAndValidate(raw, ctx);
    }

    async execute(
        name: string,
        input: unknown,
        context: AgentCapabilityContext,
    ): Promise<ChatToolResult<unknown>> {
        const started = Date.now();
        const capability = this.get(name);
        if (!capability) {
            this.emitCapabilityEvent({
                capabilityName: normalizeCapabilityEventName(name),
                providerId: "unknown",
                status: "unavailable",
                durationMs: elapsedMs(started),
            });
            context.plugin.log("Capability is not registered", { capability: name });
            return createCapabilityFailureResult(name, "unregistered capability", "Skipped an unavailable read-only tool.");
        }

        const decision = this.policyEngine.canExecute(capability);
        if (!decision.allowed) {
            this.emitCapabilityEvent({
                capabilityName: capability.name,
                providerId: capability.providerId,
                status: "skipped",
                durationMs: elapsedMs(started),
            });
            context.plugin.log("Capability rejected by policy", {
                capability: capability.name,
                reason: decision.reason,
            });
            return createCapabilityFailureResult(
                capability.name,
                "policy rejected",
                "Skipped a capability that is unavailable in this mode.",
            );
        }

        try {
            const result = await capability.execute(input, context);
            this.emitCapabilityEvent({
                capabilityName: capability.name,
                providerId: capability.providerId,
                status: result.status === "ok" ? "invoked" : "unavailable",
                durationMs: elapsedMs(started),
            });
            return agentResultToChatToolResult(capability.name, result);
        } catch (error) {
            this.emitCapabilityEvent({
                capabilityName: capability.name,
                providerId: capability.providerId,
                status: "failed",
                durationMs: elapsedMs(started),
            });
            throw error;
        }
    }

    private listCapabilitiesForExport(): AgentCapability[] {
        return this.policyEngine.filterExportable(this.listCapabilities())
            .filter((capability) => capability.kind === "tool");
    }

    private emitCapabilityEvent(event: CapabilityUsageEvent): void {
        if (!this.telemetryEnabled) return;
        this.onCapabilityEvent?.({ ...event });
    }
}

function getObsidianOperationsV1ACapabilityPolicyError(capability: AgentCapability): string | null {
    if (!isObsidianOperationsV1AToolName(capability.name)) return null;
    const errors: string[] = [];
    if (capability.kind !== "tool") errors.push("kind must be tool");
    if (capability.permission !== "read-only") errors.push("permission must be read-only");
    if (capability.cost !== "free") errors.push("cost must be free");
    if (!Number.isFinite(capability.outputBudgetChars) || capability.outputBudgetChars <= 0) {
        errors.push("outputBudgetChars must be positive");
    } else if (capability.outputBudgetChars > OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS) {
        errors.push(`outputBudgetChars must be <= ${OBSIDIAN_OPERATIONS_V1A_MAX_OUTPUT_BUDGET_CHARS}`);
    }
    if (capability.requiresConfirmation !== false) errors.push("requiresConfirmation must be false");
    if (capability.failureBehavior !== "recoverable") errors.push("failureBehavior must be recoverable");
    if (capability.sourceBoundary !== "read-only-tool") errors.push("sourceBoundary must be read-only-tool");
    return errors.length > 0
        ? `invalid Obsidian Operations v1A capability policy: ${errors.join("; ")}`
        : null;
}

function createCapabilityFailureResult(
    tool: string,
    inputSummary: string,
    error: string,
): ChatToolResult<unknown> {
    return {
        ok: false,
        tool,
        inputSummary,
        content: null,
        sources: [],
        error,
    };
}

function elapsedMs(started: number): number {
    return Math.max(0, Date.now() - started);
}

function normalizeCapabilityEventName(name: string): ChatToolName {
    return name as ChatToolName;
}

function isPlatformSupported(support: AgentPlatformSupport, platform: ProviderLoadContext["platform"]): boolean {
    return support === "both" || support === platform;
}

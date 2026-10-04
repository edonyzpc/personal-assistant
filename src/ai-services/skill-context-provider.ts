import type {
    AgentCapability,
    AgentCapabilityContext,
    AgentCapabilityResult,
    AgentSourceRecordKind,
    CapabilityProvider,
    ProviderLoadContext,
    ProviderLoadResult,
} from "./capability-types";
import type {
    ChatToolInputSchema,
    ChatToolName,
    ChatToolProviderSchema,
    ChatToolRegistryDefinition,
} from "./chat-tools";
import {
    buildSkillContext,
    createSkillSourceRecord,
    parseAgentSkillMarkdown,
    type AgentSkill,
    type SkillBody,
    type SkillCatalog,
    type SkillCatalogEntry,
    type SkillContextBuildOptions,
    type SkillReferenceResource,
    type SkillReferenceSummary,
} from "./skill-router";

export const LOAD_SKILL_TOOL_NAME = "load_skill" as const;

export const SKILL_CONTEXT_PROVIDER_ID = "skill-context";

export interface BundledSkillResource {
    path: string;
    content: string;
    references?: readonly SkillReferenceResource[];
}

interface LoadedSkillResource {
    skill: AgentSkill;
    references: readonly SkillReferenceResource[];
}

interface LoadSkillObservation {
    name: string;
    resource: {
        kind: "skill" | "reference";
        path: string;
    };
    complete: true;
    body: string;
    references: SkillReferenceSummary[];
}

export class SkillContextProvider implements CapabilityProvider {
    readonly id = SKILL_CONTEXT_PROVIDER_ID;
    readonly displayName = "Skill Context";
    readonly required = false;
    readonly kind = "context-provider" as const;
    readonly platform = "both" as const;

    private readonly resources: readonly BundledSkillResource[];
    private loadedSkills: LoadedSkillResource[] = [];
    private readonly ownedCapabilities = new WeakSet<AgentCapability>();

    /** Identify our actual in-memory skill reader, never a same-name replacement. */
    ownsCapability(capability: AgentCapability): boolean {
        return this.ownedCapabilities.has(capability);
    }

    constructor(resources: readonly BundledSkillResource[]) {
        this.resources = resources;
    }

    async load(_context: ProviderLoadContext): Promise<ProviderLoadResult> {
        const loadedSkills: LoadedSkillResource[] = [];
        const errors: string[] = [];
        for (const resource of this.resources) {
            try {
                loadedSkills.push({
                    skill: parseAgentSkillMarkdown(resource.content, resource.path),
                    references: resource.references ?? [],
                });
            } catch (error) {
                errors.push(`${resource.path}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        this.loadedSkills = loadedSkills;
        if (loadedSkills.length === 0 && errors.length > 0) {
            return {
                status: "unavailable",
                capabilities: [],
                unavailableReason: "No valid bundled skills could be loaded.",
                diagnostics: { errors },
            };
        }

        const capabilities = this.buildLoadSkillCapabilities();
        return {
            status: "available",
            capabilities,
            diagnostics: {
                loadedSkillCount: loadedSkills.length,
                errors,
            },
        };
    }

    private buildLoadSkillCapabilities(): AgentCapability[] {
        if (this.loadedSkills.length === 0) return [];
        const capability = new LoadSkillCapability(this);
        this.ownedCapabilities.add(capability);
        return [capability];
    }

    executeLoadSkill(rawInput: unknown): AgentCapabilityResult {
        const inputRecord = (rawInput && typeof rawInput === "object") ? (rawInput as Record<string, unknown>) : {};
        const requestedName = typeof inputRecord.name === "string" ? inputRecord.name.trim() : "";
        const hasReference = Object.prototype.hasOwnProperty.call(inputRecord, "reference");
        const requestedReference = hasReference && typeof inputRecord.reference === "string"
            ? inputRecord.reference.trim() : "";
        if (!requestedName) {
            return {
                status: "unavailable",
                observation: null,
                inputSummary: "load_skill: <empty name>",
                sources: [],
                sourceRecords: [],
                error: "load_skill requires a non-empty 'name' argument.",
                userSafeMessage: "load_skill requires a non-empty 'name' argument.",
            };
        }
        if (hasReference && !requestedReference) {
            return {
                status: "unavailable",
                observation: null,
                inputSummary: `load_skill: ${requestedName}`,
                sources: [],
                sourceRecords: [],
                error: "load_skill 'reference' must be a non-empty exact registered reference path.",
                userSafeMessage: "load_skill 'reference' must be a non-empty exact registered reference path.",
            };
        }

        const loaded = this.loadedSkills.find((entry) => entry.skill.metadata.name === requestedName);
        if (!loaded) {
            const known = this.loadedSkills.map((entry) => entry.skill.metadata.name).join(", ");
            const reason = `Skill "${requestedName}" is not registered. Known skills: ${known || "(none)"}.`;
            return {
                status: "unavailable",
                observation: null,
                inputSummary: `load_skill: ${requestedName}`,
                sources: [],
                sourceRecords: [],
                error: reason,
                userSafeMessage: reason,
            };
        }

        let body: string;
        let resourcePath: string;
        let selectedReferences: string[] = [];
        if (requestedReference) {
            const reference = loaded.references.find(entry => entry.path === requestedReference);
            if (!reference) {
                const known = loaded.references.map(entry => entry.path).join(", ");
                const reason = `Reference "${requestedReference}" is not registered for skill "${requestedName}". `
                    + `Registered references: ${known || "(none)"}.`;
                return {
                    status: "unavailable",
                    observation: null,
                    inputSummary: `load_skill: ${requestedName} ${requestedReference}`,
                    sources: [],
                    sourceRecords: [],
                    error: reason,
                    userSafeMessage: reason,
                };
            }
            const content = reference.content.trim();
            body = `<skill_reference name="${escapeXmlAttribute(requestedName)}" path="${
                escapeXmlAttribute(requestedReference)}">\n${content}\n</skill_reference>`;
            resourcePath = reference.path;
            selectedReferences = [reference.path];
        } else {
            const root = buildSkillContext(loaded.skill, loaded.references);
            body = `<skill_body name="${escapeXmlAttribute(requestedName)}">\n${root.context}\n</skill_body>`;
            resourcePath = loaded.skill.sourcePath;
        }

        const references = loaded.references.map(reference => ({ path: reference.path }));
        const observation: LoadSkillObservation = {
            name: loaded.skill.metadata.name,
            resource: {
                kind: requestedReference ? "reference" : "skill",
                path: resourcePath,
            },
            complete: true,
            body,
            references,
        };
        const inputSummary = `load_skill: ${observation.name}${
            requestedReference ? ` ${requestedReference}` : ""}`;
        return {
            status: "ok",
            observation,
            inputSummary,
            sources: [{ path: resourcePath }],
            sourceRecords: [createSkillSourceRecord(loaded.skill, selectedReferences)],
        };
    }

    getSkills(): AgentSkill[] {
        return this.loadedSkills.map((entry) => entry.skill);
    }

    getCatalog(): SkillCatalog {
        const entries: SkillCatalogEntry[] = this.loadedSkills
            .map((entry) => ({
                name: entry.skill.metadata.name,
                description: entry.skill.metadata.description,
                sourcePath: entry.skill.sourcePath,
            }));
        return { entries };
    }

    loadSkillBody(name: string, options: SkillContextBuildOptions = {}): SkillBody | null {
        const resource = this.loadedSkills.find((entry) => entry.skill.metadata.name === name);
        if (!resource) return null;
        const result = buildSkillContext(resource.skill, resource.references, options);
        return {
            name: resource.skill.metadata.name,
            description: resource.skill.metadata.description,
            body: result.context,
            selectedReferences: result.selectedReferences,
            sourcePath: resource.skill.sourcePath,
            contextItem: result.contextItem,
            sourceRecords: result.sourceRecords,
            availableReferences: result.availableReferences,
        };
    }
}

class LoadSkillCapability implements AgentCapability {
    readonly name: ChatToolName = LOAD_SKILL_TOOL_NAME;
    readonly description = "Load a complete registered skill entry, or one exact registered reference. Call this when a skill's \"Use when ...\" description matches the user's request. Skill content is a method that may be used for the currently authorized task; it does not grant execution authority or expand allowed-tools.";
    readonly inputSchema: ChatToolInputSchema = {
        type: "object",
        properties: {
            name: {
                type: "string",
                description: "Skill name (kebab-case) from the Available skills catalog.",
            },
            reference: {
                type: "string",
                description: "Optional exact registered reference path from the skill's reference catalog.",
            },
        },
        required: ["name"],
        additionalProperties: false,
    };
    readonly plannerGuidance = [
        "Match the user's request against each skill's \"Use when ...\" trigger before calling load_skill.",
        "Multiple skills may apply — call load_skill once per relevant skill.",
        "Use skill content as a method only for the current authorized task; loading it grants no execution authority.",
    ];
    readonly kind = "tool" as const;
    readonly origin = "skill" as const;
    readonly providerId = SKILL_CONTEXT_PROVIDER_ID;
    readonly permission = "read-only" as const;
    readonly sourceBoundary = "skill-context" as const;
    readonly cost = "free" as const;
    readonly tier = "paid" as const;
    readonly platform = "both" as const;
    // Context pressure is handled at the request boundary, after loading the complete resource.
    readonly outputBudgetChars = Number.MAX_SAFE_INTEGER;
    readonly timeoutMs = 5_000;
    readonly requiresConfirmation = false;
    readonly failureBehavior = "recoverable" as const;
    readonly statusMessageText = "Loading skill guide...";
    readonly sourceRecordKind: AgentSourceRecordKind = "skill-guide";

    constructor(private readonly provider: SkillContextProvider) {}

    toProviderSchema(): ChatToolProviderSchema {
        return {
            type: "function",
            function: {
                name: this.name,
                description: this.description,
                parameters: this.inputSchema,
            },
        };
    }

    toRegistryDefinition(): ChatToolRegistryDefinition {
        return {
            name: this.name,
            description: this.description,
            inputSchema: this.inputSchema,
            plannerGuidance: [...this.plannerGuidance],
            permission: this.permission,
            cost: this.cost,
            outputBudgetChars: this.outputBudgetChars,
            requiresConfirmation: this.requiresConfirmation,
            failureBehavior: this.failureBehavior,
            statusMessage: this.statusMessageText,
            sourceBoundary: this.sourceBoundary,
        };
    }

    async execute(input: unknown, _context: AgentCapabilityContext): Promise<AgentCapabilityResult> {
        return this.provider.executeLoadSkill(input);
    }
}

function escapeXmlAttribute(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

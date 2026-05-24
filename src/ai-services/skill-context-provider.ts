import type {
    CapabilityProvider,
    ProviderLoadContext,
    ProviderLoadResult,
} from "./capability-types";
import {
    buildSkillContext,
    parseAgentSkillMarkdown,
    SkillRouter,
    type AgentSkill,
    type SkillContextBuildOptions,
    type SkillContextResult,
    type SkillReferenceResource,
} from "./skill-router";

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

export class SkillContextProvider implements CapabilityProvider {
    readonly id = SKILL_CONTEXT_PROVIDER_ID;
    readonly displayName = "Skill Context";
    readonly required = false;
    readonly kind = "context-provider" as const;
    readonly platform = "both" as const;

    private readonly resources: readonly BundledSkillResource[];
    private readonly router: SkillRouter;
    private loadedSkills: LoadedSkillResource[] = [];

    constructor(resources: readonly BundledSkillResource[], router = new SkillRouter()) {
        this.resources = resources;
        this.router = router;
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
        return {
            status: "available",
            capabilities: [],
            diagnostics: {
                loadedSkillCount: loadedSkills.length,
                errors,
            },
        };
    }

    getSkills(): AgentSkill[] {
        return this.loadedSkills.map((entry) => entry.skill);
    }

    selectContext(
        prompt: string,
        options: SkillContextBuildOptions & { enabledSkillIds?: readonly string[] } = {},
    ): SkillContextResult | null {
        const enabledSkillIds = options.enabledSkillIds ? new Set(options.enabledSkillIds) : null;
        const candidateSkills = this.loadedSkills
            .map((entry) => entry.skill)
            .filter((skill) => !enabledSkillIds || enabledSkillIds.has(skill.metadata.name));
        const selected = this.router.selectSkill(prompt, candidateSkills);
        if (!selected) return null;
        const resource = this.loadedSkills.find((entry) => entry.skill.metadata.name === selected.metadata.name);
        if (!resource) return null;
        return buildSkillContext(resource.skill, resource.references, options);
    }
}

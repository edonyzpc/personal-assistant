import type { BundledSkillResource } from "./skill-context-provider";
import { BUNDLED_SKILL_IDS } from "./bundled-skill-catalog";

import obsidianMarkdown from "../../skills/obsidian-markdown/SKILL.md";
import obsidianBases from "../../skills/obsidian-bases/SKILL.md";
import jsonCanvas from "../../skills/json-canvas/SKILL.md";
import paFrontmatterAudit from "../../skills/pa-frontmatter-audit/SKILL.md";
import paCalloutCleanup from "../../skills/pa-callout-cleanup/SKILL.md";
import paVaultLinkHealth from "../../skills/pa-vault-link-health/SKILL.md";
import paPluginConfigReview from "../../skills/pa-plugin-config-review/SKILL.md";
import obsidianDataview from "../../skills/obsidian-dataview/SKILL.md";
import obsidianDataviewRef from "../../skills/obsidian-dataview/references/dataviewjs-api.md";

export const BUNDLED_SKILL_RESOURCES: readonly BundledSkillResource[] = [
    {
        path: "skills/obsidian-markdown/SKILL.md",
        content: obsidianMarkdown,
    },
    {
        path: "skills/obsidian-bases/SKILL.md",
        content: obsidianBases,
    },
    {
        path: "skills/json-canvas/SKILL.md",
        content: jsonCanvas,
    },
    {
        path: "skills/pa-frontmatter-audit/SKILL.md",
        content: paFrontmatterAudit,
    },
    {
        path: "skills/pa-callout-cleanup/SKILL.md",
        content: paCalloutCleanup,
    },
    {
        path: "skills/pa-vault-link-health/SKILL.md",
        content: paVaultLinkHealth,
    },
    {
        path: "skills/pa-plugin-config-review/SKILL.md",
        content: paPluginConfigReview,
    },
    {
        path: "skills/obsidian-dataview/SKILL.md",
        content: obsidianDataview,
        references: [
            {
                path: "skills/obsidian-dataview/references/dataviewjs-api.md",
                content: obsidianDataviewRef,
            },
        ],
    },
];

export { BUNDLED_SKILL_IDS };

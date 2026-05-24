export interface BundledSkillCatalogEntry {
    id: string;
    label: string;
    description: string;
}

export const BUNDLED_SKILL_CATALOG: readonly BundledSkillCatalogEntry[] = [
    {
        id: "obsidian-markdown",
        label: "Obsidian Markdown",
        description: "Wikilinks, callouts, embeds, properties, tags, and block references.",
    },
    {
        id: "obsidian-bases",
        label: "Obsidian Bases",
        description: "Bases files, formulas, filters, views, and properties.",
    },
    {
        id: "json-canvas",
        label: "JSON Canvas",
        description: "Canvas nodes, edges, groups, cards, links, and layout structure.",
    },
    {
        id: "pa-frontmatter-audit",
        label: "Frontmatter Audit",
        description: "Frontmatter consistency, missing properties, tag spelling, and metadata drift.",
    },
    {
        id: "pa-callout-cleanup",
        label: "Callout Cleanup",
        description: "Callout types, malformed callouts, nested callouts, and taxonomy.",
    },
    {
        id: "pa-vault-link-health",
        label: "Vault Link Health",
        description: "Unresolved wikilinks, backlinks, outgoing links, orphan notes, and embeds.",
    },
    {
        id: "pa-plugin-config-review",
        label: "Plugin Config Review",
        description: "Plugin lists, plugin settings, disabled plugins, and config folders.",
    },
];

export const BUNDLED_SKILL_IDS = BUNDLED_SKILL_CATALOG.map((entry) => entry.id);

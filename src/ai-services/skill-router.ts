import type { ChatContextItem, SourceRecord } from "./chat-types";
import { createSourceDedupKey } from "./source-store";

export const MAX_SKILL_NAME_CHARS = 64;

export interface AgentSkillMetadata {
    name: string;
    description: string;
    version?: string;
    author?: string;
    allowedTools: string[];
}

export interface AgentSkill {
    metadata: AgentSkillMetadata;
    body: string;
    sourcePath: string;
}

export interface SkillReferenceResource {
    path: string;
    content: string;
}

export interface SkillReferenceSummary {
    path: string;
}

export interface SkillContextBuildOptions {
    /** Optional caller limits; by default the complete registered resource is returned. */
    maxContextChars?: number;
    metadataBudgetChars?: number;
    bodyBudgetChars?: number;
    referenceBudgetChars?: number;
}

export interface SkillContextResult {
    skill: AgentSkill;
    context: string;
    /** Compatibility field: a root load no longer inlines reference contents. */
    selectedReferences: string[];
    availableReferences: SkillReferenceSummary[];
    layerCharCounts: {
        metadata: number;
        body: number;
        references: number;
        total: number;
    };
    contextItem: ChatContextItem;
    sourceRecords: SourceRecord[];
}

export interface SkillCatalogEntry {
    name: string;
    description: string;
    sourcePath: string;
}

export interface SkillCatalog {
    entries: SkillCatalogEntry[];
}

export interface SkillBody {
    name: string;
    description: string;
    body: string;
    selectedReferences: string[];
    availableReferences: SkillReferenceSummary[];
    sourcePath: string;
    contextItem: ChatContextItem;
    sourceRecords: SourceRecord[];
}

export class SkillParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SkillParseError";
    }
}

export class SkillTooLargeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SkillTooLargeError";
    }
}

export function parseAgentSkillMarkdown(markdown: string, sourcePath = "SKILL.md"): AgentSkill {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown);
    if (!match) {
        throw new SkillParseError("SKILL.md must start with YAML frontmatter.");
    }
    const rawMetadata = parseSimpleYaml(match[1]);
    const metadata = normalizeSkillMetadata(rawMetadata);
    return {
        metadata,
        body: match[2].trim(),
        sourcePath,
    };
}

export function buildSkillContext(
    skill: AgentSkill,
    references: readonly SkillReferenceResource[] = [],
    options: SkillContextBuildOptions = {},
): SkillContextResult {
    const metadataBlock = formatSkillMetadata(skill.metadata);
    const bodyBlock = skill.body;
    const availableReferences = references.map(reference => ({ path: reference.path }));
    const referenceCatalog = buildReferenceCatalog(availableReferences.map(reference => reference.path));
    const context = [
        metadataBlock,
        bodyBlock ? `Skill guide:\n${bodyBlock}` : "",
        referenceCatalog.text,
    ].filter(Boolean).join("\n\n");

    if ((options.metadataBudgetChars !== undefined && metadataBlock.length > options.metadataBudgetChars)
        || (options.bodyBudgetChars !== undefined && bodyBlock.length > options.bodyBudgetChars)
        || (options.referenceBudgetChars !== undefined && referenceCatalog.length > options.referenceBudgetChars)
        || (options.maxContextChars !== undefined && context.length > options.maxContextChars)) {
        throw new SkillTooLargeError(
            `Skill ${skill.metadata.name} cannot be returned completely within its configured budgets.`,
        );
    }

    const layerCharCounts = {
        metadata: metadataBlock.length,
        body: bodyBlock.length,
        references: referenceCatalog.length,
        total: context.length,
    };

    return {
        skill,
        context,
        selectedReferences: [],
        availableReferences,
        layerCharCounts,
        contextItem: {
            kind: "skill-guide",
            tool: skill.metadata.name,
            content: context,
            sources: [{ path: skill.sourcePath }],
            metadata: {
                selectedReferences: [],
                availableReferences: availableReferences.map(reference => reference.path),
            },
        },
        sourceRecords: [createSkillSourceRecord(skill, [])],
    };
}

function normalizeSkillMetadata(rawMetadata: Record<string, string | string[]>): AgentSkillMetadata {
    const name = getRequiredScalar(rawMetadata, "name");
    if (name.length > MAX_SKILL_NAME_CHARS) {
        throw new SkillParseError(`Skill name must be ${MAX_SKILL_NAME_CHARS} characters or fewer.`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
        throw new SkillParseError("Skill name must be kebab-case.");
    }

    const description = getRequiredScalar(rawMetadata, "description");
    if (!/\buse when\b/i.test(description)) {
        throw new SkillParseError('Skill description must include "Use when".');
    }

    return {
        name,
        description,
        version: getOptionalScalar(rawMetadata, "version"),
        author: getOptionalScalar(rawMetadata, "author"),
        allowedTools: getOptionalList(rawMetadata, "allowed-tools"),
    };
}

function parseSimpleYaml(yaml: string): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};
    let currentListKey: string | null = null;
    for (const rawLine of yaml.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const listItem = /^-\s+(.+)$/.exec(line);
        if (listItem && currentListKey) {
            const current = result[currentListKey];
            result[currentListKey] = [...(Array.isArray(current) ? current : []), parseScalar(listItem[1])];
            continue;
        }
        const match = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
        if (!match) {
            throw new SkillParseError(`Unsupported frontmatter line: ${rawLine}`);
        }
        const key = match[1];
        const rawValue = match[2] ?? "";
        if (!rawValue) {
            result[key] = [];
            currentListKey = key;
            continue;
        }
        result[key] = rawValue.startsWith("[") && rawValue.endsWith("]")
            ? parseInlineList(rawValue)
            : parseScalar(rawValue);
        currentListKey = null;
    }
    return result;
}

function parseInlineList(value: string): string[] {
    return value.slice(1, -1)
        .split(",")
        .map((item) => parseScalar(item.trim()))
        .filter(Boolean);
}

function parseScalar(value: string): string {
    return value.replace(/^['"]|['"]$/g, "").trim();
}

function getRequiredScalar(metadata: Record<string, string | string[]>, key: string): string {
    const value = metadata[key];
    if (typeof value !== "string" || !value.trim()) {
        throw new SkillParseError(`Skill frontmatter requires ${key}.`);
    }
    return value.trim();
}

function getOptionalScalar(metadata: Record<string, string | string[]>, key: string): string | undefined {
    const value = metadata[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getOptionalList(metadata: Record<string, string | string[]>, key: string): string[] {
    const value = metadata[key];
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === "string" && value.trim()) return [value.trim()];
    return [];
}

function formatSkillMetadata(metadata: AgentSkillMetadata): string {
    return [
        "Skill metadata:",
        `name: ${metadata.name}`,
        `description: ${metadata.description}`,
        metadata.version ? `version: ${metadata.version}` : "",
        metadata.author ? `author: ${metadata.author}` : "",
        metadata.allowedTools.length > 0 ? `allowed-tools: ${metadata.allowedTools.join(", ")}` : "",
    ].filter(Boolean).join("\n");
}

function buildReferenceCatalog(paths: readonly string[]): { text: string; length: number } {
    if (paths.length === 0) return { text: "", length: 0 };
    const text = `Skill references (load one exact path with load_skill):\n${
        paths.map(path => `- ${path}`).join("\n")}`;
    return { text, length: text.length };
}

export function createSkillSourceRecord(skill: AgentSkill, selectedReferences: string[]): SourceRecord {
    return {
        kind: "skill-guide",
        dedupKey: createSourceDedupKey(`skill:${skill.metadata.name}`),
        providerId: "skill-context",
        capabilityName: "skill-context",
        sourceBoundary: "skill-context",
        title: skill.metadata.name,
        snippet: skill.metadata.description,
        citationEligible: false,
        statusOnly: true,
        metadata: {
            sourcePath: skill.sourcePath,
            selectedReferences,
        },
    };
}

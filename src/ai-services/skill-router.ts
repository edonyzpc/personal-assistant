import type { ChatContextItem, SourceRecord } from "./chat-types";
import { createSourceDedupKey } from "./source-store";

export const MAX_SKILL_NAME_CHARS = 64;
export const MAX_SKILL_METADATA_CHARS = 2_000;
export const MAX_SKILL_BODY_CHARS = 6_000;
export const MAX_SKILL_REFERENCE_CHARS = 4_000;
export const MAX_SKILL_CONTEXT_CHARS =
    MAX_SKILL_METADATA_CHARS + MAX_SKILL_BODY_CHARS + MAX_SKILL_REFERENCE_CHARS;

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

export interface SkillContextBuildOptions {
    maxContextChars?: number;
    metadataBudgetChars?: number;
    bodyBudgetChars?: number;
    referenceBudgetChars?: number;
}

export interface SkillContextResult {
    skill: AgentSkill;
    context: string;
    selectedReferences: string[];
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
    const maxContextChars = options.maxContextChars ?? MAX_SKILL_CONTEXT_CHARS;
    const metadataBudget = Math.min(options.metadataBudgetChars ?? MAX_SKILL_METADATA_CHARS, maxContextChars);
    const bodyBudget = Math.min(options.bodyBudgetChars ?? MAX_SKILL_BODY_CHARS, Math.max(0, maxContextChars - metadataBudget));
    const referenceBudget = Math.min(
        options.referenceBudgetChars ?? MAX_SKILL_REFERENCE_CHARS,
        Math.max(0, maxContextChars - metadataBudget - bodyBudget),
    );

    const metadataBlock = truncateText(formatSkillMetadata(skill.metadata), metadataBudget);
    const bodyBlock = truncateText(skill.body, bodyBudget);
    const referenceBlock = buildReferenceBlock(skill.body, references, referenceBudget);
    const context = truncateText([
        metadataBlock,
        bodyBlock ? `Skill guide:\n${bodyBlock}` : "",
        referenceBlock.text,
    ].filter(Boolean).join("\n\n"), maxContextChars);

    const layerCharCounts = {
        metadata: metadataBlock.length,
        body: bodyBlock.length,
        references: referenceBlock.text.length,
        total: context.length,
    };

    return {
        skill,
        context,
        selectedReferences: referenceBlock.selectedReferences,
        layerCharCounts,
        contextItem: {
            kind: "skill-guide",
            tool: skill.metadata.name,
            content: context,
            sources: [{ path: skill.sourcePath }],
            metadata: {
                selectedReferences: referenceBlock.selectedReferences,
            },
        },
        sourceRecords: [createSkillSourceRecord(skill, referenceBlock.selectedReferences)],
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

function buildReferenceBlock(
    body: string,
    references: readonly SkillReferenceResource[],
    budget: number,
): { text: string; selectedReferences: string[] } {
    if (budget <= 0 || references.length === 0) {
        return { text: "", selectedReferences: [] };
    }
    const referencedPaths = new Set(findReferencedPaths(body));
    const blocks: string[] = [];
    const selectedReferences: string[] = [];
    let remaining = budget;
    for (const reference of references) {
        if (!referencedPaths.has(reference.path)) continue;
        const header = `Reference: ${reference.path}\n`;
        const contentBudget = Math.max(0, remaining - header.length);
        if (contentBudget <= 0) break;
        const content = truncateText(reference.content.trim(), contentBudget);
        const block = `${header}${content}`;
        blocks.push(block);
        selectedReferences.push(reference.path);
        remaining -= block.length + 2;
        if (remaining <= 0) break;
    }
    return {
        text: blocks.length > 0 ? `Skill references:\n${blocks.join("\n\n")}` : "",
        selectedReferences,
    };
}

function findReferencedPaths(body: string): string[] {
    const paths = new Set<string>();
    const pattern = /(?:^|[\s(["'])((?:\.\/)?references\/[A-Za-z0-9._/-]+\.md)\b/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
        paths.add(match[1].replace(/^\.\//, ""));
    }
    return [...paths];
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

function truncateText(value: string, maxChars: number): string {
    if (maxChars <= 0) return "";
    if (value.length <= maxChars) return value;
    if (maxChars <= 3) return ".".repeat(maxChars);
    return `${value.slice(0, maxChars - 3)}...`;
}

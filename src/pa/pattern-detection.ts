import type { PersistedSourceRef } from "./contracts";
import { normalizeVaultPath, stableHash } from "./helpers";

export type PatternType = "recurring_tag" | "repeated_question" | "orphan_cluster";

export interface PatternDetectionInput {
    path: string;
    title?: string;
    content?: string;
    tags?: readonly string[];
    links?: readonly string[];
    backlinks?: readonly string[];
    folder?: string;
    modifiedAt?: string;
}

export interface CrossNotePattern {
    id: string;
    patternType: PatternType;
    title: string;
    summary: string;
    sourceRefs: PersistedSourceRef[];
    whyShown: string[];
}

export interface PatternDetectionResult {
    generatedAt: string;
    totalCount: number;
    patterns: CrossNotePattern[];
}

export interface PatternDetectionOptions {
    now?: Date | (() => Date);
    minActiveNotes?: number;
    maxPatterns?: number;
}

const DEFAULT_MIN_ACTIVE_NOTES = 5;
const DEFAULT_MAX_PATTERNS = 6;

function nowDate(now: PatternDetectionOptions["now"]): Date {
    const value = typeof now === "function" ? now() : now;
    return value ? new Date(value.getTime()) : new Date();
}

function normalizedTag(tag: string): string {
    const trimmed = tag.trim();
    if (!trimmed) return "";
    return trimmed.startsWith("#") ? trimmed.toLowerCase() : `#${trimmed.toLowerCase()}`;
}

function noteFolder(note: PatternDetectionInput): string {
    if (note.folder?.trim()) return normalizeVaultPath(note.folder);
    const path = normalizeVaultPath(note.path);
    const slash = path.lastIndexOf("/");
    return slash > 0 ? path.slice(0, slash) : "";
}

function sourceRefForNote(note: PatternDetectionInput, generatedAt: string, whyShown: string): PersistedSourceRef {
    return {
        path: normalizeVaultPath(note.path),
        generatedAt,
        evidenceStrength: "medium",
        whyShown: [whyShown],
    };
}

function patternId(type: PatternType, parts: readonly string[]): string {
    return `pattern-${type}-${stableHash(parts.join("\0"))}`;
}

function hasQuestion(content: string | undefined): boolean {
    if (!content) return false;
    return /(?:\?|？)/.test(content);
}

function isOrphan(note: PatternDetectionInput): boolean {
    return (note.links?.length ?? 0) === 0 && (note.backlinks?.length ?? 0) === 0;
}

function recurringTagPatterns(notes: readonly PatternDetectionInput[], generatedAt: string): CrossNotePattern[] {
    const groups = new Map<string, PatternDetectionInput[]>();
    for (const note of notes) {
        const uniqueTags = new Set((note.tags ?? []).map(normalizedTag).filter(Boolean));
        for (const tag of uniqueTags) {
            const group = groups.get(tag) ?? [];
            group.push(note);
            groups.set(tag, group);
        }
    }
    return [...groups.entries()]
        .filter(([, group]) => group.length >= 3)
        .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))
        .map(([tag, group]) => {
            const sourceRefs = group.slice(0, 6).map((note) =>
                sourceRefForNote(note, generatedAt, `Shares recurring tag ${tag}.`));
            return {
                id: patternId("recurring_tag", [tag, ...sourceRefs.map((ref) => ref.path)]),
                patternType: "recurring_tag" as const,
                title: `Recurring tag: ${tag}`,
                summary: `${group.length} recent notes share ${tag}.`,
                sourceRefs,
                whyShown: [`At least 3 recent notes share ${tag}.`],
            };
        });
}

function repeatedQuestionPatterns(notes: readonly PatternDetectionInput[], generatedAt: string): CrossNotePattern[] {
    const questionNotes = notes.filter((note) => hasQuestion(note.content));
    if (questionNotes.length < 2) return [];
    const sourceRefs = questionNotes.slice(0, 6).map((note) =>
        sourceRefForNote(note, generatedAt, "Contains an open question."));
    return [{
        id: patternId("repeated_question", sourceRefs.map((ref) => ref.path)),
        patternType: "repeated_question",
        title: "Repeated open questions",
        summary: `${questionNotes.length} recent notes contain open questions.`,
        sourceRefs,
        whyShown: ["At least 2 recent notes contain question marks."],
    }];
}

function orphanClusterPatterns(notes: readonly PatternDetectionInput[], generatedAt: string): CrossNotePattern[] {
    const groups = new Map<string, PatternDetectionInput[]>();
    for (const note of notes.filter(isOrphan)) {
        const folder = noteFolder(note) || "Vault root";
        const group = groups.get(folder) ?? [];
        group.push(note);
        groups.set(folder, group);
    }
    return [...groups.entries()]
        .filter(([, group]) => group.length >= 3)
        .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))
        .map(([folder, group]) => {
            const sourceRefs = group.slice(0, 6).map((note) =>
                sourceRefForNote(note, generatedAt, `Unlinked note in ${folder}.`));
            return {
                id: patternId("orphan_cluster", [folder, ...sourceRefs.map((ref) => ref.path)]),
                patternType: "orphan_cluster" as const,
                title: `Unlinked cluster: ${folder}`,
                summary: `${group.length} recent notes in ${folder} have no note links yet.`,
                sourceRefs,
                whyShown: ["Several recent notes in the same area have no links or backlinks."],
            };
        });
}

export function detectCrossNotePatterns(
    notes: readonly PatternDetectionInput[],
    options: PatternDetectionOptions = {},
): PatternDetectionResult {
    const generatedAt = nowDate(options.now).toISOString();
    const minActiveNotes = options.minActiveNotes ?? DEFAULT_MIN_ACTIVE_NOTES;
    const maxPatterns = options.maxPatterns ?? DEFAULT_MAX_PATTERNS;
    const normalizedNotes = notes
        .map((note) => ({
            ...note,
            path: normalizeVaultPath(note.path),
            tags: (note.tags ?? []).map(normalizedTag).filter(Boolean),
            links: (note.links ?? []).map(normalizeVaultPath).filter(Boolean),
            backlinks: (note.backlinks ?? []).map(normalizeVaultPath).filter(Boolean),
        }))
        .filter((note) => note.path);
    if (normalizedNotes.length < minActiveNotes) {
        return { generatedAt, totalCount: 0, patterns: [] };
    }
    const patterns = [
        ...recurringTagPatterns(normalizedNotes, generatedAt),
        ...repeatedQuestionPatterns(normalizedNotes, generatedAt),
        ...orphanClusterPatterns(normalizedNotes, generatedAt),
    ].slice(0, maxPatterns);
    return {
        generatedAt,
        totalCount: patterns.length,
        patterns,
    };
}

/**
 * Type guards for ChatToolResult content payloads + validators for tool inputs
 * + `isChatToolName` discriminator.
 *
 * Moved here from the original chat-tools.ts monolith as part of Phase 3.1
 * (sdd-chat-tools-split.md). Depends on Module A (types), Module B (constants),
 * and Module E (limitInputText / normalizeLimit / validateVaultRelativeTargetPath).
 */

import type {
    ChatToolName,
    CurrentNoteContextInput,
    CurrentNoteContextOutput,
    InspectObsidianNoteInput,
    InspectObsidianNoteOutput,
    ListRecentNotesInput,
    ListRecentNotesOutput,
    ListVaultTagsInput,
    MemorySearchResult,
    ReadCanvasSummaryInput,
    ReadCanvasSummaryOutput,
    ReadNoteOutlineInput,
    ReadNoteOutlineOutput,
    SearchMemoryInput,
    SearchVaultMetadataInput,
    SearchVaultMetadataOutput,
    SearchVaultSnippetsInput,
    VaultSnippetSearchOutput,
    VaultTagsOutput,
} from "./chat-tool-types";
import { isObsidianOperationsV1AToolName } from "./chat-tool-types";
import {
    NOTE_OUTLINE_DEFAULT_HEADINGS,
    NOTE_OUTLINE_MAX_HEADINGS,
    NOTE_OUTLINE_PATH_MAX_CHARS,
    RECENT_NOTES_DEFAULT_LIMIT,
    RECENT_NOTES_MAX_LIMIT,
    SNIPPET_DEFAULT_LIMIT,
    SNIPPET_MAX_LIMIT,
    SNIPPET_QUERY_MAX_CHARS,
    TAGS_DEFAULT_LIMIT,
    TAGS_MAX_LIMIT,
    VAULT_METADATA_DEFAULT_LIMIT,
    VAULT_METADATA_MAX_LIMIT,
    VAULT_METADATA_QUERY_MAX_CHARS,
} from "./chat-tool-constants";
import {
    limitInputText,
    normalizeLimit,
    validateVaultRelativeTargetPath,
} from "./chat-tool-execution-helpers";

export function isSearchMemoryResult(content: unknown): content is MemorySearchResult {
    return Boolean(
        content
        && typeof content === "object"
        && "query" in content
        && "documents" in content
        && "sources" in content,
    );
}

export function isCurrentNoteContextResult(content: unknown): content is CurrentNoteContextOutput {
    const mode = content && typeof content === "object"
        ? (content as Record<string, unknown>).mode
        : undefined;
    return Boolean(
        content
        && typeof content === "object"
        && "path" in content
        && typeof (content as Record<string, unknown>).path === "string"
        && "title" in content
        && typeof (content as Record<string, unknown>).title === "string"
        && (mode === "selection-or-nearby" || mode === "outline" || mode === "metadata" || mode === "full"),
    );
}

export function isSearchVaultMetadataResult(content: unknown): content is SearchVaultMetadataOutput {
    return Boolean(
        content
        && typeof content === "object"
        && "query" in content
        && "matches" in content
        && Array.isArray((content as Record<string, unknown>).matches),
    );
}

export function isListRecentNotesResult(content: unknown): content is ListRecentNotesOutput {
    return Boolean(
        content
        && typeof content === "object"
        && "notes" in content
        && Array.isArray((content as Record<string, unknown>).notes),
    );
}

export function isReadNoteOutlineResult(content: unknown): content is ReadNoteOutlineOutput {
    return Boolean(
        content
        && typeof content === "object"
        && "path" in content
        && "headings" in content
        && Array.isArray((content as Record<string, unknown>).headings),
    );
}

export function isInspectObsidianNoteResult(content: unknown): content is InspectObsidianNoteOutput {
    return Boolean(
        content
        && typeof content === "object"
        && (content as Record<string, unknown>).kind === "note-structure"
        && typeof (content as Record<string, unknown>).path === "string",
    );
}

export function isReadCanvasSummaryResult(content: unknown): content is ReadCanvasSummaryOutput {
    return Boolean(
        content
        && typeof content === "object"
        && (content as Record<string, unknown>).kind === "canvas-structure"
        && typeof (content as Record<string, unknown>).path === "string"
        && typeof (content as Record<string, unknown>).nodeCount === "number"
        && typeof (content as Record<string, unknown>).edgeCount === "number",
    );
}

export function isVaultSnippetSearchResult(content: unknown): content is VaultSnippetSearchOutput {
    return Boolean(
        content
        && typeof content === "object"
        && (content as Record<string, unknown>).kind === "vault-snippets"
        && typeof (content as Record<string, unknown>).query === "string"
        && Array.isArray((content as Record<string, unknown>).matches),
    );
}

export function isVaultTagsResult(content: unknown): content is VaultTagsOutput {
    return Boolean(
        content
        && typeof content === "object"
        && (content as Record<string, unknown>).kind === "vault-tags"
        && Array.isArray((content as Record<string, unknown>).tags),
    );
}

export function isChatToolName(name: string): name is ChatToolName {
    return name === "search_memory"
        || name === "get_current_note_context"
        || name === "search_vault_metadata"
        || name === "list_recent_notes"
        || name === "read_note_outline"
        || name === "webSearch"
        || isObsidianOperationsV1AToolName(name);
}

export function validateSearchMemoryInput(input: unknown): SearchMemoryInput {
    if (!input || typeof input !== "object") {
        throw new Error("search_memory input must be an object.");
    }
    const value = input as Record<string, unknown>;
    const query = typeof value.query === "string" ? value.query.trim() : "";
    if (!query) {
        throw new Error("search_memory input.query must be a non-empty string.");
    }
    return { query };
}

export function validateCurrentNoteContextInput(input: unknown): CurrentNoteContextInput {
    if (!input || typeof input !== "object") {
        throw new Error("get_current_note_context input must be an object.");
    }
    const mode = (input as Record<string, unknown>).mode;
    if (mode === "selection-or-nearby" || mode === "outline" || mode === "metadata" || mode === "full") {
        return { mode };
    }
    throw new Error("get_current_note_context input.mode is invalid.");
}

export function validateSearchVaultMetadataInput(input: unknown): SearchVaultMetadataInput {
    if (!input || typeof input !== "object") {
        throw new Error("search_vault_metadata input must be an object.");
    }
    const value = input as Record<string, unknown>;
    const query = typeof value.query === "string" ? value.query.trim() : "";
    if (!query) {
        throw new Error("search_vault_metadata input.query must be a non-empty string.");
    }
    return {
        query: limitInputText(query, VAULT_METADATA_QUERY_MAX_CHARS),
        limit: normalizeLimit(value.limit, VAULT_METADATA_DEFAULT_LIMIT, VAULT_METADATA_MAX_LIMIT),
    };
}

export function validateListRecentNotesInput(input: unknown): ListRecentNotesInput {
    if (!input || typeof input !== "object") {
        throw new Error("list_recent_notes input must be an object.");
    }
    const value = input as Record<string, unknown>;
    const order = value.order === "created" ? "created" : "modified";
    return {
        order,
        limit: normalizeLimit(value.limit, RECENT_NOTES_DEFAULT_LIMIT, RECENT_NOTES_MAX_LIMIT),
    };
}

export function validateReadNoteOutlineInput(input: unknown): ReadNoteOutlineInput {
    if (!input || typeof input !== "object") {
        throw new Error("read_note_outline input must be an object.");
    }
    const value = input as Record<string, unknown>;
    const path = typeof value.path === "string" ? value.path.trim() : "";
    if (!path) {
        throw new Error("read_note_outline input.path must be a non-empty string.");
    }
    if (path.length > NOTE_OUTLINE_PATH_MAX_CHARS) {
        throw new Error("read_note_outline input.path is too long.");
    }
    return {
        path,
        maxHeadings: normalizeLimit(value.max_headings ?? value.maxHeadings, NOTE_OUTLINE_DEFAULT_HEADINGS, NOTE_OUTLINE_MAX_HEADINGS),
    };
}

export function validateInspectObsidianNoteInput(input: unknown): InspectObsidianNoteInput {
    if (!input || typeof input !== "object") {
        throw new Error("note structure input must be an object.");
    }
    const value = input as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(value, "path")) {
        return {};
    }
    if (typeof value.path !== "string" || !value.path.trim()) {
        throw new Error("note path must be a non-empty string when supplied.");
    }
    return { path: validateVaultRelativeTargetPath(value.path.trim(), [".md"], "note path") };
}

export function validateReadCanvasSummaryInput(input: unknown): ReadCanvasSummaryInput {
    if (!input || typeof input !== "object") {
        throw new Error("canvas summary input must be an object.");
    }
    const value = input as Record<string, unknown>;
    const path = typeof value.path === "string" ? value.path.trim() : "";
    if (!path) {
        throw new Error("canvas path must be a non-empty string.");
    }
    return {
        path: validateVaultRelativeTargetPath(path, [".canvas"], "canvas path"),
    };
}

export function validateSearchVaultSnippetsInput(input: unknown): SearchVaultSnippetsInput {
    if (!input || typeof input !== "object") {
        throw new Error("snippet search input must be an object.");
    }
    const value = input as Record<string, unknown>;
    const query = typeof value.query === "string" ? value.query.trim() : "";
    if (!query) {
        throw new Error("snippet query must be a non-empty string.");
    }
    const rawScope = typeof value.scope === "string" ? value.scope.trim() : "";
    const scope = rawScope
        ? validateVaultRelativeTargetPath(rawScope, [".md"], "snippet scope", { allowFolder: true })
        : undefined;
    return {
        query: limitInputText(query, SNIPPET_QUERY_MAX_CHARS),
        limit: normalizeLimit(value.limit, SNIPPET_DEFAULT_LIMIT, SNIPPET_MAX_LIMIT),
        scope,
    };
}

export function validateListVaultTagsInput(input: unknown): ListVaultTagsInput {
    if (!input || typeof input !== "object") {
        return { limit: TAGS_DEFAULT_LIMIT };
    }
    const value = input as Record<string, unknown>;
    return {
        limit: normalizeLimit(value.limit, TAGS_DEFAULT_LIMIT, TAGS_MAX_LIMIT),
    };
}

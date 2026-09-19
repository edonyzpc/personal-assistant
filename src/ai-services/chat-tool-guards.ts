/**
 * Type guards for ChatToolResult content payloads + validators for tool inputs
 * + `isChatToolName` discriminator.
 *
 * Moved here from the original chat-tools.ts monolith as part of Phase 3.1
 * (docs/archive/sdd-chat-tools-split.md). Depends on Module A (types), Module B (constants),
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
    ReadNoteInput,
    ReadNoteOutlineInput,
    ReadNoteOutlineOutput,
    ReadNoteOutput,
    QueryNotesDateFilter,
    QueryNotesInput,
    QueryNotesOutput,
    QueryNotesPropertyCondition,
    QueryNotesPropertyValue,
    QueryNotesSort,
    SearchMemoryInput,
    SearchVaultMetadataInput,
    SearchVaultMetadataOutput,
    SearchVaultSnippetPart,
    SearchVaultSnippetsInput,
    VaultSnippetSearchOutput,
    VaultTagsOutput,
} from "./chat-tool-types";
import { isObsidianOperationsV1AToolName } from "./chat-tool-types";
import {
    NOTE_OUTLINE_DEFAULT_HEADINGS,
    NOTE_OUTLINE_MAX_HEADINGS,
    NOTE_OUTLINE_PATH_MAX_CHARS,
    QUERY_NOTES_CANONICAL_QUERY_MAX_CHARS,
    QUERY_NOTES_CURSOR_MAX_CHARS,
    QUERY_NOTES_DEFAULT_LIMIT,
    QUERY_NOTES_MAX_LIMIT,
    QUERY_NOTES_MAX_PROPERTY_CONDITIONS,
    QUERY_NOTES_MAX_TAGS,
    QUERY_NOTES_PATH_MAX_CHARS,
    QUERY_NOTES_PROPERTY_KEY_MAX_CHARS,
    QUERY_NOTES_PROPERTY_VALUE_MAX_CHARS,
    QUERY_NOTES_TAG_MAX_CHARS,
    READ_NOTE_DEFAULT_MAX_CHARS,
    READ_NOTE_MAX_CHARS,
    RECENT_NOTES_DEFAULT_LIMIT,
    RECENT_NOTES_MAX_LIMIT,
    SNIPPET_CURSOR_MAX_CHARS,
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
    if (!content || typeof content !== "object" || Array.isArray(content)) return false;
    const record = content as Record<string, unknown>;
    if (
        typeof record.query !== "string"
        || !Array.isArray(record.documents)
        || !Array.isArray(record.sources)
    ) return false;
    if (
        record.memoryEvidenceState !== undefined
        && record.memoryEvidenceState !== "evidence"
        && record.memoryEvidenceState !== "partial"
        && record.memoryEvidenceState !== "none"
        && record.memoryEvidenceState !== "unavailable"
    ) return false;
    if (
        record.rerankVerdict !== undefined
        && record.rerankVerdict !== "relevant"
        && record.rerankVerdict !== "partially_relevant"
        && record.rerankVerdict !== "none_relevant"
    ) return false;
    return true;
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

export function isReadNoteResult(content: unknown): content is ReadNoteOutput {
    if (!content || typeof content !== "object" || Array.isArray(content)) return false;
    const record = content as Record<string, unknown>;
    const hasValidPart = record.part === "body" || record.part === "properties";
    return Boolean(
        hasValidPart
            && typeof record.path === "string"
            && typeof record.text === "string"
            && typeof record.sourceVersion === "string"
            && typeof record.truncated === "boolean"
            && typeof record.complete === "boolean"
            && typeof record.endOfPart === "boolean",
    );
}

export function isQueryNotesResult(content: unknown): content is QueryNotesOutput {
    if (!content || typeof content !== "object" || Array.isArray(content)) return false;
    const record = content as Record<string, unknown>;
    const coverage = record.coverage as { state?: unknown } | undefined;
    return Boolean(
        record.query
            && typeof record.query === "object"
            && Array.isArray(record.matches)
            && typeof record.matchCount === "number"
            && (record.matchCountKind === "exact" || record.matchCountKind === "lower-bound")
            && record.sort
            && typeof record.sort === "object"
            && coverage
            && typeof coverage === "object"
            && (coverage.state === "complete" || coverage.state === "partial"),
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
    if (name === "get_writing_context") return true;
    return name === "search_memory"
        || name === "get_memory_status"
        || name === "query_memories"
        || name === "get_memory_usage"
        || name === "get_vault_insights"
        || name === "query_saved_insights"
        || name === "manage_saved_insight"
        || name === "resolve_chat_images"
        || name === "create_image"
        || name === "get_current_note_context"
        || name === "search_vault_metadata"
        || name === "list_recent_notes"
        || name === "read_note_outline"
        || name === "read_note"
        || name === "query_notes"
        || name === "webSearch"
        || isObsidianOperationsV1AToolName(name);
}

export function validateQueryNotesInput(input: unknown): QueryNotesInput {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("query_notes input must be an object.");
    }
    const value = input as Record<string, unknown>;
    rejectUnknownKeys(value, new Set([
        "path", "folder", "tags", "properties", "date", "sort", "limit", "cursor",
    ]), "query_notes");

    const path = value.path === undefined ? undefined : normalizeQueryPath(value.path, "path");
    if (path !== undefined && !path.toLowerCase().endsWith(".md")) {
        throw new Error("query_notes path must target a Markdown note.");
    }
    const folder = value.folder === undefined ? undefined : normalizeQueryFolder(value.folder);
    const tags = validateQueryTags(value.tags);
    const properties = validateQueryProperties(value.properties);
    const date = validateQueryDate(value.date);
    const sort = validateQuerySort(value.sort);
    const limit = normalizeLimit(value.limit, QUERY_NOTES_DEFAULT_LIMIT, QUERY_NOTES_MAX_LIMIT);

    let cursor: string | undefined;
    if (Object.prototype.hasOwnProperty.call(value, "cursor")) {
        if (typeof value.cursor !== "string" || !value.cursor.trim()
            || value.cursor.length > QUERY_NOTES_CURSOR_MAX_CHARS) {
            throw new Error("query_notes cursor is invalid.");
        }
        cursor = value.cursor;
    }

    const canonicalQuery = canonicalizeQueryNotesInput({
        ...(path === undefined ? {} : { path }),
        ...(folder === undefined ? {} : { folder }),
        ...(tags === undefined ? {} : { tags }),
        ...(properties === undefined ? {} : { properties }),
        ...(date === undefined ? {} : { date }),
        sort,
    });
    if (canonicalQuery.length > QUERY_NOTES_CANONICAL_QUERY_MAX_CHARS) {
        throw new Error("query_notes query exceeds its input size limit.");
    }

    return {
        ...(path === undefined ? {} : { path }),
        ...(folder === undefined ? {} : { folder }),
        ...(tags === undefined ? {} : { tags }),
        ...(properties === undefined ? {} : { properties }),
        ...(date === undefined ? {} : { date }),
        sort,
        limit,
        ...(cursor === undefined ? {} : { cursor }),
    };
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, tool: string): void {
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) throw new Error(`${tool} input has an unknown field: ${key}.`);
    }
}

function normalizeQueryPath(value: unknown, field: "path" | "folder"): string {
    if (typeof value !== "string") throw new Error(`query_notes ${field} must be a string.`);
    const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\/+/, "")
        .replace(/\/+/g, "/").replace(/\/$/, "");
    if (!normalized || normalized.startsWith("/") || normalized.startsWith("~")
        || /^[A-Za-z]:\//.test(normalized) || normalized.includes("\0")
        || normalized.split("/").some(segment => segment === "" || segment === "." || segment === "..")) {
        throw new Error(`query_notes ${field} must be a vault-relative path.`);
    }
    if (normalized.length > QUERY_NOTES_PATH_MAX_CHARS) {
        throw new Error(`query_notes ${field} is too long.`);
    }
    return normalized;
}

function normalizeQueryFolder(value: unknown): string {
    if (value === "") return "";
    return normalizeQueryPath(value, "folder");
}

function validateQueryTags(value: unknown): string[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length === 0 || value.length > QUERY_NOTES_MAX_TAGS) {
        throw new Error(`query_notes tags must contain between 1 and ${QUERY_NOTES_MAX_TAGS} entries.`);
    }
    return value.map(tag => {
        if (typeof tag !== "string") throw new Error("query_notes tags must be strings.");
        const normalized = tag.trim().replace(/^#/, "");
        if (!normalized || normalized.length > QUERY_NOTES_TAG_MAX_CHARS) {
            throw new Error("query_notes tags must be non-empty and bounded.");
        }
        return normalized;
    });
}

function validateQueryProperties(value: unknown): QueryNotesPropertyCondition[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length === 0
        || value.length > QUERY_NOTES_MAX_PROPERTY_CONDITIONS) {
        throw new Error(`query_notes properties must contain between 1 and ${QUERY_NOTES_MAX_PROPERTY_CONDITIONS} conditions.`);
    }
    return value.map(condition => {
        if (!condition || typeof condition !== "object" || Array.isArray(condition)) {
            throw new Error("query_notes property conditions must be objects.");
        }
        const record = condition as Record<string, unknown>;
        rejectUnknownKeys(record, new Set(["key", "operator", "value"]), "query_notes property");
        if (typeof record.key !== "string" || !record.key.trim()
            || record.key.trim().length > QUERY_NOTES_PROPERTY_KEY_MAX_CHARS) {
            throw new Error("query_notes property key is invalid.");
        }
        const operator = record.operator;
        if (operator !== "exists" && operator !== "equals" && operator !== "contains") {
            throw new Error("query_notes property operator is invalid.");
        }
        const hasValue = Object.prototype.hasOwnProperty.call(record, "value");
        if (operator === "exists" && hasValue) {
            throw new Error("query_notes exists condition must not supply a value.");
        }
        if (operator !== "exists" && !hasValue) {
            throw new Error(`query_notes ${operator} condition requires a value.`);
        }
        const conditionValue = record.value;
        if (operator !== "exists" && !isQueryNotesScalar(conditionValue)) {
            throw new Error(`query_notes ${operator} value must be a JSON scalar.`);
        }
        const scalarValue = conditionValue as QueryNotesPropertyValue | undefined;
        if (typeof conditionValue === "string"
            && conditionValue.length > QUERY_NOTES_PROPERTY_VALUE_MAX_CHARS) {
            throw new Error("query_notes property value is too long.");
        }
        return {
            key: record.key.trim(),
            operator,
            ...(operator === "exists" ? {} : { value: scalarValue }),
        };
    });
}

function isQueryNotesScalar(value: unknown): value is QueryNotesPropertyValue {
    return value === null
        || typeof value === "string"
        || (typeof value === "number" && Number.isFinite(value))
        || typeof value === "boolean";
}

function validateQueryDate(value: unknown): QueryNotesDateFilter | undefined {
    if (value === undefined) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("query_notes date must be an object.");
    }
    const record = value as Record<string, unknown>;
    rejectUnknownKeys(record, new Set(["field", "property", "kind", "from", "to"]), "query_notes date");
    if (record.field !== "ctime" && record.field !== "mtime" && record.field !== "property") {
        throw new Error("query_notes date.field is invalid.");
    }
    if (record.kind !== "timestamp" && record.kind !== "calendar-date") {
        throw new Error("query_notes date.kind is invalid.");
    }
    if (record.field === "property") {
        if (typeof record.property !== "string" || !record.property.trim()
            || record.property.trim().length > QUERY_NOTES_PROPERTY_KEY_MAX_CHARS) {
            throw new Error("query_notes property date requires a valid property key.");
        }
    } else if (Object.prototype.hasOwnProperty.call(record, "property")) {
        throw new Error("query_notes ctime/mtime date must not supply a property key.");
    }
    if (record.field !== "property" && record.kind !== "timestamp") {
        throw new Error("query_notes ctime/mtime dates must use timestamp semantics.");
    }
    if (typeof record.from !== "string" || typeof record.to !== "string") {
        throw new Error("query_notes date boundaries must be strings.");
    }
    const from = record.from.trim();
    const to = record.to.trim();
    const field = record.field as QueryNotesDateFilter["field"];
    const kind = record.kind as QueryNotesDateFilter["kind"];
    const property = record.property as string | undefined;
    const normalized = {
        field,
        ...(field === "property" ? { property: property!.trim() } : {}),
        kind,
        from,
        to,
    };
    const fromMs = kind === "timestamp"
        ? parseQueryTimestamp(from, "from")
        : parseQueryCalendarDate(from, "from");
    const toMs = kind === "timestamp"
        ? parseQueryTimestamp(to, "to")
        : parseQueryCalendarDate(to, "to");
    if (fromMs >= toMs) throw new Error("query_notes date.from must be earlier than date.to.");
    return normalized;
}

function validateQuerySort(value: unknown): QueryNotesSort {
    if (value === undefined) return { field: "path", direction: "asc" };
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("query_notes sort must be an object.");
    }
    const record = value as Record<string, unknown>;
    rejectUnknownKeys(record, new Set(["field", "direction"]), "query_notes sort");
    if (record.field !== "path" && record.field !== "ctime" && record.field !== "mtime") {
        throw new Error("query_notes sort.field is invalid.");
    }
    if (record.direction !== "asc" && record.direction !== "desc") {
        throw new Error("query_notes sort.direction is invalid.");
    }
    return { field: record.field, direction: record.direction };
}

function parseQueryTimestamp(value: string, field: "from" | "to"): number {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/
        .exec(value);
    if (!match) throw new Error(`query_notes timestamp ${field} must include a UTC offset.`);
    const [, year, month, day, hour, minute, second, offset] = match;
    if (!isValidCalendarDate(Number(year), Number(month), Number(day))
        || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59
        || (offset !== "Z" && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59))) {
        throw new Error(`query_notes timestamp ${field} is not a real ISO timestamp.`);
    }
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
        throw new Error(`query_notes timestamp ${field} is not a real ISO timestamp.`);
    }
    return parsed;
}

function parseQueryCalendarDate(value: string, field: "from" | "to"): number {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match || !isValidCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
        throw new Error(`query_notes calendar-date ${field} must be a real YYYY-MM-DD date.`);
    }
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
    if (month < 1 || month > 12 || day < 1) return false;
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
    return day <= daysInMonth;
}

export function canonicalizeQueryNotesInput(input: Omit<QueryNotesInput, "limit" | "cursor">): string {
    return JSON.stringify({
        ...(input.path === undefined ? {} : { path: input.path }),
        ...(input.folder === undefined ? {} : { folder: input.folder }),
        ...(input.tags === undefined ? {} : { tags: input.tags }),
        ...(input.properties === undefined ? {} : { properties: input.properties }),
        ...(input.date === undefined ? {} : { date: input.date }),
        sort: input.sort,
    });
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

export function validateReadNoteInput(input: unknown): ReadNoteInput {
    if (!input || typeof input !== "object") {
        throw new Error("read_note input must be an object.");
    }
    const value = input as Record<string, unknown>;
    const path = typeof value.path === "string" ? value.path.trim() : "";
    if (!path) throw new Error("read_note input.path must be a non-empty string.");
    const validatedPath = validateVaultRelativeTargetPath(path, [".md"], "note path");

    const hasPart = Object.prototype.hasOwnProperty.call(value, "part");
    const hasCursor = Object.prototype.hasOwnProperty.call(value, "cursor");
    const part = hasPart ? value.part : hasCursor ? undefined : "body";
    if (part !== undefined && part !== "body" && part !== "properties") {
        throw new Error("read_note input.part must be body or properties.");
    }

    const hasStart = Object.prototype.hasOwnProperty.call(value, "startLine");
    const hasEnd = Object.prototype.hasOwnProperty.call(value, "endLine");
    if (part === "properties" && (hasStart || hasEnd)) {
        throw new Error("read_note properties do not support a line range.");
    }
    if (hasStart !== hasEnd) {
        throw new Error("read_note startLine and endLine must be supplied together.");
    }
    let startLine: number | undefined;
    let endLine: number | undefined;
    if (hasStart) {
        startLine = readNoteLine(value.startLine, "startLine");
        endLine = readNoteLine(value.endLine, "endLine");
        if (endLine < startLine) {
            throw new Error("read_note endLine must be greater than or equal to startLine.");
        }
        if (typeof value.cursor === "string") {
            throw new Error("read_note cursor cannot be combined with a new line range.");
        }
    }

    let maxChars = READ_NOTE_DEFAULT_MAX_CHARS;
    if (Object.prototype.hasOwnProperty.call(value, "maxChars")) {
        const rawMaxChars = value.maxChars;
        if (typeof rawMaxChars !== "number" || !Number.isInteger(rawMaxChars)
            || rawMaxChars <= 0 || rawMaxChars > READ_NOTE_MAX_CHARS) {
            throw new Error(`read_note maxChars must be an integer between 1 and ${READ_NOTE_MAX_CHARS}.`);
        }
        maxChars = rawMaxChars;
    }

    let cursor: string | undefined;
    if (Object.prototype.hasOwnProperty.call(value, "cursor")) {
        if (typeof value.cursor !== "string" || !value.cursor.trim() || value.cursor.length > 4096) {
            throw new Error("read_note cursor is invalid.");
        }
        cursor = value.cursor;
    }

    return {
        path: validatedPath,
        ...(part === undefined ? {} : { part }),
        ...(hasStart ? { startLine, endLine } : {}),
        maxChars,
        ...(cursor === undefined ? {} : { cursor }),
    };
}

function readNoteLine(value: unknown, field: "startLine" | "endLine"): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
        throw new Error(`read_note ${field} must be a positive integer.`);
    }
    return value;
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
    const query = typeof value.query === "string" ? value.query : "";
    if (!query.trim()) {
        throw new Error("snippet query must be a non-empty string.");
    }
    if (query.length > SNIPPET_QUERY_MAX_CHARS) {
        throw new Error(`snippet query must be at most ${SNIPPET_QUERY_MAX_CHARS} characters.`);
    }
    let part: SearchVaultSnippetPart | undefined;
    if (value.part !== undefined) {
        if (value.part !== "body" && value.part !== "properties" && value.part !== "all") {
            throw new Error("snippet search input.part must be body, properties, or all.");
        }
        part = value.part;
    }
    let caseSensitive: boolean | undefined;
    if (value.caseSensitive !== undefined) {
        if (typeof value.caseSensitive !== "boolean") {
            throw new Error("snippet search input.caseSensitive must be a boolean.");
        }
        caseSensitive = value.caseSensitive;
    }
    let cursor: string | undefined;
    if (value.cursor !== undefined) {
        if (typeof value.cursor !== "string" || !value.cursor) {
            throw new Error("snippet search input.cursor must be a non-empty string.");
        }
        if (value.cursor.length > SNIPPET_CURSOR_MAX_CHARS) {
            throw new Error(`snippet search input.cursor must be at most ${SNIPPET_CURSOR_MAX_CHARS} characters.`);
        }
        cursor = value.cursor;
    }
    const rawScope = typeof value.scope === "string" ? value.scope.trim() : "";
    const scope = rawScope
        ? validateVaultRelativeTargetPath(rawScope, [".md"], "snippet scope", { allowFolder: true })
        : undefined;
    return {
        query,
        limit: normalizeLimit(value.limit, SNIPPET_DEFAULT_LIMIT, SNIPPET_MAX_LIMIT),
        scope,
        ...(part === undefined ? {} : { part }),
        ...(caseSensitive === undefined ? {} : { caseSensitive }),
        ...(cursor === undefined ? {} : { cursor }),
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

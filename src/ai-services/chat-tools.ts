import { MarkdownView } from "obsidian";

import type { PluginManager } from "../plugin";
import type {
    ChatAgentSource,
    ChatToolName,
    ChatToolResult,
    MemorySearchResult,
} from "./chat-types";
import { createAbortError, isAbortError, throwIfAborted } from "./chat-utils";

export type { ChatToolName, ChatToolResult } from "./chat-types";

export interface ChatToolContext {
    plugin: PluginManager;
    signal?: AbortSignal;
    onBeforeVssSearch?: () => void;
    onToolRunning?: (tool: string, message: string) => void;
}

export interface ChatToolDefinition<Input, Output> {
    name: ChatToolName;
    description: string;
    permission: "read-only";
    cost: "free" | "ai-calls";
    outputBudgetChars: number;
    statusMessage(input: Input): string;
    validateInput(input: unknown): Input;
    execute(input: Input, context: ChatToolContext): Promise<ChatToolResult<Output>>;
}

interface RegisteredChatTool {
    name: ChatToolName;
    validateInput(input: unknown): unknown;
    statusMessage(input: unknown): string;
    execute(input: unknown, context: ChatToolContext): Promise<ChatToolResult<unknown>>;
}

export interface SearchMemoryInput {
    query: string;
}

export type CurrentNoteContextMode = "selection-or-nearby" | "outline" | "metadata";

export interface CurrentNoteContextInput {
    mode: CurrentNoteContextMode;
}

export interface CurrentNoteContextOutput {
    path: string;
    title: string;
    mode: CurrentNoteContextMode;
    selection?: string;
    nearbyText?: string;
    headings?: string[];
    outlineTruncated?: boolean;
    scannedLineLimit?: number;
    totalLines?: number;
    maxHeadings?: number;
}

interface EditorLike {
    getSelection?: () => string;
    getValue?: () => string;
    getCursor?: () => { line: number; ch: number };
    lineCount?: () => number;
    getLine?: (line: number) => string;
}

const CURRENT_NOTE_CONTENT_BUDGET_CHARS = 3000;
const CURRENT_NOTE_MAX_HEADINGS = 30;
const CURRENT_NOTE_NEARBY_RADIUS_LINES = 12;
const CURRENT_NOTE_HEADING_SCAN_LINES = 200;
const CURRENT_NOTE_OUTLINE_SCAN_LINES = 5000;

export class ToolRegistry {
    private readonly tools = new Map<ChatToolName, RegisteredChatTool>();

    register<Input, Output>(definition: ChatToolDefinition<Input, Output>): void {
        this.tools.set(definition.name, definition as unknown as RegisteredChatTool);
    }

    get(name: string): RegisteredChatTool | undefined {
        if (!isChatToolName(name)) return undefined;
        return this.tools.get(name);
    }

    has(name: string): boolean {
        return Boolean(this.get(name));
    }

    async execute(name: string, input: unknown, context: ChatToolContext): Promise<ChatToolResult<unknown>> {
        throwIfAborted(context.signal);
        const tool = this.get(name);
        if (!tool) {
            context.plugin.log("Chat tool is not registered", { tool: name });
            return createToolFailureResult(name, describeToolInput(input), "Skipped an unavailable read-only tool.");
        }

        let validatedInput: unknown;
        try {
            validatedInput = tool.validateInput(input);
        } catch (error) {
            context.plugin.log("Chat tool input validation failed", { tool: name, error: getErrorMessage(error) });
            return createToolFailureResult(name, describeToolInput(input), "Skipped a read-only tool because its input was invalid.");
        }

        throwIfAborted(context.signal);
        context.onToolRunning?.(name, tool.statusMessage(validatedInput));
        try {
            const result = await tool.execute(validatedInput, context);
            throwIfAborted(context.signal);
            return result;
        } catch (error) {
            if (isAbortError(error, context.signal)) {
                throw context.signal?.aborted ? createAbortError() : error;
            }
            context.plugin.log("Chat tool execution failed", { tool: name, error: getErrorMessage(error) });
            return createToolFailureResult(name, tool.statusMessage(validatedInput), "Read-only tool was unavailable.");
        }
    }
}

export function createSearchMemoryTool(
    executeSearch: (input: SearchMemoryInput, context: ChatToolContext) => Promise<MemorySearchResult>,
): ChatToolDefinition<SearchMemoryInput, MemorySearchResult> {
    return {
        name: "search_memory",
        description: "Search Memory prepared from the user's notes.",
        permission: "read-only",
        cost: "ai-calls",
        outputBudgetChars: 8000,
        statusMessage: (input) => `Searching memory: ${input.query}`,
        validateInput: validateSearchMemoryInput,
        execute: async (input, context) => {
            const result = await executeSearch(input, context);
            return {
                ok: true,
                tool: "search_memory",
                inputSummary: input.query,
                content: result,
                sources: result.sources,
            };
        },
    };
}

export function createCurrentNoteContextTool(): ChatToolDefinition<CurrentNoteContextInput, CurrentNoteContextOutput> {
    return {
        name: "get_current_note_context",
        description: "Read the active Markdown note title, path, selection, nearby text, or outline.",
        permission: "read-only",
        cost: "free",
        outputBudgetChars: CURRENT_NOTE_CONTENT_BUDGET_CHARS,
        statusMessage: () => "Reading current note",
        validateInput: validateCurrentNoteContextInput,
        execute: async (input, context) => {
            throwIfAborted(context.signal);
            const view = context.plugin.app.workspace.getActiveViewOfType(MarkdownView);
            if (!view?.file?.path) {
                return createToolFailureResult(
                    "get_current_note_context",
                    input.mode,
                    "No active Markdown note was available.",
                );
            }

            const file = view.file;
            const editor = view.editor as EditorLike | undefined;
            const output: CurrentNoteContextOutput = {
                path: file.path,
                title: getFileTitle(file),
                mode: input.mode,
            };
            const source = [{ path: file.path }];

            if (input.mode === "metadata" || !editor) {
                return createCurrentNoteResult(input.mode, output, source);
            }

            if (input.mode === "outline") {
                applyOutline(output, extractHeadingsFromEditor(editor));
                return createCurrentNoteResult(input.mode, output, source);
            }

            const selection = editor.getSelection?.().trim();
            if (selection) {
                output.selection = truncate(selection, CURRENT_NOTE_CONTENT_BUDGET_CHARS);
                return createCurrentNoteResult("selection", output, source);
            }

            const nearbyText = getHeadingSectionOrNearbyText(editor);
            if (nearbyText) {
                output.nearbyText = truncate(nearbyText, CURRENT_NOTE_CONTENT_BUDGET_CHARS);
            }
            applyOutline(output, extractHeadingsFromEditor(editor));
            return createCurrentNoteResult("nearby", output, source);
        },
    };
}

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
    return Boolean(
        content
        && typeof content === "object"
        && "path" in content
        && typeof (content as Record<string, unknown>).path === "string"
        && "title" in content
        && typeof (content as Record<string, unknown>).title === "string",
    );
}

function validateSearchMemoryInput(input: unknown): SearchMemoryInput {
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

function validateCurrentNoteContextInput(input: unknown): CurrentNoteContextInput {
    if (!input || typeof input !== "object") {
        throw new Error("get_current_note_context input must be an object.");
    }
    const mode = (input as Record<string, unknown>).mode;
    if (mode === "selection-or-nearby" || mode === "outline" || mode === "metadata") {
        return { mode };
    }
    throw new Error("get_current_note_context input.mode is invalid.");
}

function isChatToolName(name: string): name is ChatToolName {
    return name === "search_memory" || name === "get_current_note_context";
}

function createToolFailureResult<Output = unknown>(tool: string, inputSummary: string, error: string): ChatToolResult<Output> {
    return {
        ok: false,
        tool,
        inputSummary,
        content: null,
        sources: [],
        error,
    };
}

function createCurrentNoteResult(
    inputSummary: string,
    content: CurrentNoteContextOutput,
    sources: ChatAgentSource[],
): ChatToolResult<CurrentNoteContextOutput> {
    return {
        ok: true,
        tool: "get_current_note_context",
        inputSummary,
        content,
        sources,
    };
}

function getFileTitle(file: { basename?: string; name?: string; path: string }): string {
    if (file.basename) return file.basename;
    if (file.name) return file.name.replace(/\.md$/i, "");
    const lastSegment = file.path.split("/").pop() ?? file.path;
    return lastSegment.replace(/\.md$/i, "");
}

interface CurrentNoteOutline {
    headings: string[];
    outlineTruncated: boolean;
    scannedLineLimit: number;
    totalLines: number;
    maxHeadings: number;
}

function applyOutline(output: CurrentNoteContextOutput, outline: CurrentNoteOutline): void {
    output.headings = outline.headings;
    output.outlineTruncated = outline.outlineTruncated;
    output.scannedLineLimit = outline.scannedLineLimit;
    output.totalLines = outline.totalLines;
    output.maxHeadings = outline.maxHeadings;
}

function extractHeadingsFromEditor(editor: EditorLike): CurrentNoteOutline {
    const lineCount = getLineCount(editor);
    if (lineCount === undefined || !editor.getLine) {
        return {
            headings: [],
            outlineTruncated: false,
            scannedLineLimit: 0,
            totalLines: 0,
            maxHeadings: CURRENT_NOTE_MAX_HEADINGS,
        };
    }
    const headings: string[] = [];
    const maxScanLine = Math.min(lineCount, CURRENT_NOTE_OUTLINE_SCAN_LINES);
    for (let index = 0; index < maxScanLine && headings.length < CURRENT_NOTE_MAX_HEADINGS; index++) {
        const heading = parseHeading(editor.getLine(index));
        if (heading) {
            headings.push(heading.text);
        }
    }
    return {
        headings,
        outlineTruncated: lineCount > maxScanLine || headings.length >= CURRENT_NOTE_MAX_HEADINGS,
        scannedLineLimit: maxScanLine,
        totalLines: lineCount,
        maxHeadings: CURRENT_NOTE_MAX_HEADINGS,
    };
}

function getHeadingSectionOrNearbyText(editor: EditorLike): string {
    const lineCount = getLineCount(editor);
    if (lineCount === undefined || !editor.getLine) return "";
    if (lineCount === 0) return "";
    const cursor = editor.getCursor?.();
    const currentLine = clampLine(cursor?.line ?? 0, lineCount);
    const section = getCurrentHeadingSection(editor, currentLine, lineCount);
    if (section) return section;

    const start = Math.max(0, currentLine - CURRENT_NOTE_NEARBY_RADIUS_LINES);
    const end = Math.min(lineCount, currentLine + CURRENT_NOTE_NEARBY_RADIUS_LINES + 1);
    return collectLinesWithinBudget(editor, start, end).trim();
}

function getCurrentHeadingSection(editor: EditorLike, cursorLine: number, lineCount: number): string | null {
    if (!editor.getLine) return null;
    let start = -1;
    let level = 0;
    const minScanLine = Math.max(0, cursorLine - CURRENT_NOTE_HEADING_SCAN_LINES);
    for (let index = cursorLine; index >= minScanLine; index--) {
        const heading = parseHeading(editor.getLine(index));
        if (heading) {
            start = index;
            level = heading.level;
            break;
        }
    }
    if (start < 0) return null;

    let end = lineCount;
    const maxScanLine = Math.min(lineCount, start + CURRENT_NOTE_HEADING_SCAN_LINES + 1);
    for (let index = start + 1; index < maxScanLine; index++) {
        const heading = parseHeading(editor.getLine(index));
        if (heading && heading.level <= level) {
            end = index;
            break;
        }
    }
    return collectLinesWithinBudget(editor, start, end).trim();
}

function collectLinesWithinBudget(editor: EditorLike, start: number, end: number): string {
    if (!editor.getLine) return "";
    const lines: string[] = [];
    let used = 0;
    for (let index = start; index < end; index++) {
        const line = editor.getLine(index);
        const nextUsed = used + line.length + (lines.length > 0 ? 1 : 0);
        if (nextUsed > CURRENT_NOTE_CONTENT_BUDGET_CHARS) {
            const remaining = CURRENT_NOTE_CONTENT_BUDGET_CHARS - used;
            if (remaining > 0) {
                lines.push(line.slice(0, remaining));
            }
            break;
        }
        lines.push(line);
        used = nextUsed;
    }
    return lines.join("\n");
}

function parseHeading(line: string): { level: number; text: string } | null {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (!match) return null;
    return {
        level: match[1].length,
        text: `${match[1]} ${match[2].trim()}`,
    };
}

function getLineCount(editor: EditorLike): number | undefined {
    const lineCount = editor.lineCount?.();
    return typeof lineCount === "number" && Number.isFinite(lineCount)
        ? Math.max(0, Math.floor(lineCount))
        : undefined;
}

function clampLine(line: number, lineCount: number): number {
    if (!Number.isFinite(line)) return 0;
    return Math.min(Math.max(Math.floor(line), 0), Math.max(lineCount - 1, 0));
}

function describeToolInput(input: unknown): string {
    if (typeof input === "string") return input;
    if (!input || typeof input !== "object") return String(input);
    try {
        return JSON.stringify(input);
    } catch {
        return "[unserializable input]";
    }
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength)}...`;
}

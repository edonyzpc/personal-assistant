import type { ChatToolInputSchema } from "../chat-tools";
import type { ResourceTarget } from "../independent-computation/obsidian-resource-sdk";
import { RESOURCE_OPERATION_TOOL_NAMES, type ResourceOperationToolName, type ResourceOperationInput } from "./types";
import { validateResourceVaultPath } from "./vault-path";

export function isResourceOperationToolName(name: string): name is ResourceOperationToolName {
    return (RESOURCE_OPERATION_TOOL_NAMES as readonly string[]).includes(name);
}
export function resourceAction(name: ResourceOperationToolName): "create" | "replace" | "mkdir" | "move" | "trash" | "open" | "editor" | "undo" {
    switch (name) {
        case "obsidian.vault.createText": return "create";
        case "obsidian.vault.replaceText": return "replace";
        case "obsidian.vault.mkdir": case "vault_create_folder": return "mkdir";
        case "obsidian.vault.move": return "move";
        case "obsidian.vault.trash": case "vault_trash": return "trash";
        case "obsidian.workspace.open": return "open";
        case "obsidian.workspace.applyEdits": return "editor";
        case "obsidian.operations.undo": return "undo";
    }
}
function object(raw: unknown): Record<string, unknown> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Expected an object.");
    return raw as Record<string, unknown>;
}
function exact(raw: Record<string, unknown>, keys: string[]): void {
    if (Object.keys(raw).some(key => !keys.includes(key))) throw new Error("Unsupported input property.");
}
function text(raw: unknown, label: string): string {
    if (typeof raw !== "string") throw new Error(`${label} must be a string.`);
    return raw;
}
function id(raw: unknown, label: string): string {
    const value = text(raw, label);
    if (!value.trim() || value.length > 256) throw new Error(`${label} must be a nonempty opaque identity.`);
    return value;
}
function target(raw: unknown): ResourceTarget {
    const value = object(raw);
    exact(value, ["path", "resourceRef"]);
    if (typeof value.path === "string" && value.resourceRef === undefined) return { path: validateResourceVaultPath(value.path) };
    if (typeof value.resourceRef === "string" && value.path === undefined) return { resourceRef: id(value.resourceRef, "resourceRef") };
    throw new Error("target must supply exactly one of path or resourceRef.");
}
export function validateResourceOperationInput(name: ResourceOperationToolName, raw: unknown): ResourceOperationInput {
    const input = object(raw);
    const mode = input.mode === undefined ? "apply" : input.mode;
    if (mode !== "apply" && mode !== "preview") throw new Error("mode must be apply or preview.");
    const action = resourceAction(name);
    switch (action) {
        case "create":
            exact(input, ["mode", "path", "text"]);
            return { mode, path: validateResourceVaultPath(input.path), text: text(input.text, "text") };
        case "replace":
            exact(input, ["mode", "target", "expectedVersion", "text"]);
            return { mode, target: target(input.target), expectedVersion: id(input.expectedVersion, "expectedVersion"), text: text(input.text, "text") };
        case "mkdir":
            exact(input, ["mode", "path", "parents"]);
            if (input.parents !== undefined && typeof input.parents !== "boolean") throw new Error("parents must be boolean.");
            return { mode, path: validateResourceVaultPath(input.path), parents: input.parents === true };
        case "move":
            exact(input, ["mode", "source", "to"]);
            return { mode, source: target(input.source), to: validateResourceVaultPath(input.to) };
        case "trash":
            exact(input, ["mode", "target", "recursive"]);
            if (input.recursive !== undefined && typeof input.recursive !== "boolean") throw new Error("recursive must be boolean.");
            return { mode, target: target(input.target), recursive: input.recursive === true };
        case "open": {
            exact(input, ["mode", "target", "position"]);
            let position: { line: number; ch: number } | undefined;
            if (input.position !== undefined) {
                const p = object(input.position); exact(p, ["line", "ch"]);
                if (![p.line, p.ch].every(n => Number.isSafeInteger(n) && (n as number) >= 0)) throw new Error("position must use nonnegative line/ch.");
                position = { line: p.line as number, ch: p.ch as number };
            }
            return { mode, target: target(input.target), ...(position ? { position } : {}) };
        }
        case "editor": {
            exact(input, ["mode", "snapshotId", "edits"]);
            if (!Array.isArray(input.edits) || input.edits.length === 0) throw new Error("edits must be a nonempty array.");
            const edits = input.edits.map(rawEdit => {
                const edit = object(rawEdit); exact(edit, ["from", "to", "text"]);
                if (![edit.from, edit.to].every(n => Number.isSafeInteger(n) && (n as number) >= 0)
                    || (edit.from as number) > (edit.to as number)) throw new Error("edits require ordered nonnegative UTF-16 offsets.");
                return { from: edit.from as number, to: edit.to as number, text: text(edit.text, "edit.text") };
            });
            return { mode, snapshotId: id(input.snapshotId, "snapshotId"), edits };
        }
        case "undo":
            exact(input, ["mode", "receiptId"]);
            return { mode, receiptId: id(input.receiptId, "receiptId") };
    }
}
export function resourceOperationSchema(name: ResourceOperationToolName): ChatToolInputSchema {
    const action = resourceAction(name);
    const string = { type: "string" as const };
    const targetSchema = { type: "object" as const, properties: { path: string, resourceRef: string }, additionalProperties: false };
    const properties: ChatToolInputSchema["properties"] = { mode: { type: "string", enum: ["apply", "preview"] } };
    const required: string[] = [];
    const add = (key: string, schema: unknown, mandatory = true) => { properties[key] = schema as ChatToolInputSchema["properties"][string]; if (mandatory) required.push(key); };
    if (action === "create" || action === "mkdir") add("path", string);
    if (action === "create" || action === "replace") add("text", string);
    if (["replace", "trash", "open"].includes(action)) add("target", targetSchema);
    if (action === "replace") add("expectedVersion", string);
    if (action === "mkdir") add("parents", { type: "boolean" }, false);
    if (action === "trash") add("recursive", { type: "boolean" }, false);
    if (action === "move") { add("source", targetSchema); add("to", string); }
    if (action === "open") add("position", { type: "object", properties: { line: { type: "integer", minimum: 0 }, ch: { type: "integer", minimum: 0 } }, required: ["line", "ch"], additionalProperties: false }, false);
    if (action === "editor") { add("snapshotId", string); add("edits", { type: "array", minItems: 1, items: { type: "object", properties: { from: { type: "integer", minimum: 0 }, to: { type: "integer", minimum: 0 }, text: string }, required: ["from", "to", "text"], additionalProperties: false } }); }
    if (action === "undo") add("receiptId", string);
    return { type: "object", properties, required, additionalProperties: false };
}

import {
    CORE_WRITE_TOOL_NAMES,
    type CoreWriteInputMap,
    type CoreWriteToolName,
    type FrontmatterUpdateInput,
    type JsonLikeValue,
    type RemoveNoteImageInput,
    type VaultAppendInput,
    type VaultCreateInput,
    type VaultProcessInput,
} from "./types";
import { validateOperationsVaultPath } from "./vault-path";
import { isRecord } from "../../pa/helpers";

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const MAX_JSON_DEPTH = 20;

export class OperationsValidationError extends Error {
    readonly code = "schema_invalid";

    constructor(message: string) {
        super(message);
        this.name = "OperationsValidationError";
    }
}

export function isCoreWriteToolName(value: string): value is CoreWriteToolName {
    return (CORE_WRITE_TOOL_NAMES as readonly string[]).includes(value);
}

export function validateCoreWriteInput<Name extends CoreWriteToolName>(
    name: Name,
    raw: unknown,
): CoreWriteInputMap[Name] {
    switch (name) {
        case "vault_create":
            return validateVaultCreateInput(raw) as CoreWriteInputMap[Name];
        case "vault_append":
            return validateVaultAppendInput(raw) as CoreWriteInputMap[Name];
        case "vault_process":
            return validateVaultProcessInput(raw) as CoreWriteInputMap[Name];
        case "frontmatter_update":
            return validateFrontmatterUpdateInput(raw) as CoreWriteInputMap[Name];
        case "remove_note_image":
            return validateRemoveNoteImageInput(raw) as CoreWriteInputMap[Name];
    }
}

export function validateExecuteOperationsInput(raw: unknown): { intentId: string } {
    const input = expectObject(raw, "execute_operations");
    expectExactKeys(input, ["intentId"], ["intentId"], "execute_operations");
    const intentId = expectString(input.intentId, "execute_operations.intentId");
    if (intentId.length === 0) {
        throw new OperationsValidationError("execute_operations.intentId must not be empty.");
    }
    return Object.freeze({ intentId });
}

/** Non-generic runtime alias for provider and dispatcher adapters. */
export function validateCoreWriteToolInput(name: CoreWriteToolName, raw: unknown): CoreWriteInputMap[CoreWriteToolName] {
    return validateCoreWriteInput(name, raw);
}

export function validateRemoveNoteImageInput(raw: unknown): RemoveNoteImageInput {
    const input = expectObject(raw, "remove_note_image");
    expectExactKeys(
        input,
        ["notePath", "imageReference", "attachmentAction"],
        ["notePath", "imageReference", "attachmentAction"],
        "remove_note_image",
    );
    const notePath = validateOperationsVaultPath(input.notePath);
    const imageReference = expectContentString(
        input.imageReference,
        "remove_note_image.imageReference",
        false,
    );
    if (imageReference.trim() !== imageReference) {
        throw new OperationsValidationError(
            "remove_note_image.imageReference must be the exact selected reference without surrounding whitespace.",
        );
    }
    const attachmentAction = expectEnum(
        input.attachmentAction,
        ["keep", "delete"] as const,
        "remove_note_image.attachmentAction",
    );
    return Object.freeze({ notePath, imageReference, attachmentAction });
}

export function validateVaultCreateInput(raw: unknown): VaultCreateInput {
    const input = expectObject(raw, "vault_create");
    expectExactKeys(input, ["path", "content"], ["path", "content"], "vault_create");
    return {
        path: expectString(input.path, "vault_create.path"),
        content: expectContentString(input.content, "vault_create.content", true),
    };
}

export function validateVaultAppendInput(raw: unknown): VaultAppendInput {
    const input = expectObject(raw, "vault_append");
    expectExactKeys(input, ["path", "content"], ["path", "content"], "vault_append");
    return {
        path: expectString(input.path, "vault_append.path"),
        content: expectContentString(input.content, "vault_append.content", false),
    };
}

export function validateVaultProcessInput(raw: unknown): VaultProcessInput {
    const input = expectObject(raw, "vault_process");
    expectExactKeys(input, ["path", "operation", "params"], ["path", "operation", "params"], "vault_process");
    const path = expectString(input.path, "vault_process.path");
    const operation = expectString(input.operation, "vault_process.operation");
    const params = expectObject(input.params, "vault_process.params");

    if (operation === "replace") {
        expectExactKeys(params, ["search", "replace", "occurrence"], ["search", "replace"], "vault_process.params");
        const search = expectContentString(params.search, "vault_process.params.search", false);
        const replace = expectContentString(params.replace, "vault_process.params.replace", true);
        const occurrence = params.occurrence === undefined
            ? undefined
            : expectEnum(params.occurrence, ["first", "all"] as const, "vault_process.params.occurrence");
        return { path, operation, params: { search, replace, ...(occurrence ? { occurrence } : {}) } };
    }

    if (operation === "insert") {
        expectExactKeys(params, ["anchor", "position", "content"], ["anchor", "position", "content"], "vault_process.params");
        const anchor = expectObject(params.anchor, "vault_process.params.anchor");
        const anchorKeys = Object.keys(anchor);
        if (anchorKeys.length !== 1 || (anchorKeys[0] !== "heading" && anchorKeys[0] !== "line")) {
            throw new OperationsValidationError("vault_process.params.anchor must contain exactly one of heading or line.");
        }
        const validatedAnchor = anchorKeys[0] === "heading"
            ? { heading: expectHeading(anchor.heading, "vault_process.params.anchor.heading") }
            : { line: expectPositiveInteger(anchor.line, "vault_process.params.anchor.line") };
        return {
            path,
            operation,
            params: {
                anchor: validatedAnchor,
                position: expectEnum(params.position, ["before", "after"] as const, "vault_process.params.position"),
                content: expectContentString(params.content, "vault_process.params.content", false),
            },
        };
    }

    if (operation === "delete") {
        const keys = Object.keys(params);
        if (keys.length === 1 && keys[0] === "section") {
            return { path, operation, params: { section: expectHeading(params.section, "vault_process.params.section") } };
        }
        if (keys.length === 2 && keys.includes("from") && keys.includes("to")) {
            const from = expectPositiveInteger(params.from, "vault_process.params.from");
            const to = expectPositiveInteger(params.to, "vault_process.params.to");
            if (from > to) throw new OperationsValidationError("vault_process.params.from must be less than or equal to to.");
            return { path, operation, params: { from, to } };
        }
        throw new OperationsValidationError("vault_process delete params must be exactly {section} or {from,to}.");
    }

    throw new OperationsValidationError("vault_process.operation must be replace, insert, or delete.");
}

export function validateFrontmatterUpdateInput(raw: unknown): FrontmatterUpdateInput {
    const input = expectObject(raw, "frontmatter_update");
    expectExactKeys(input, ["path", "set", "delete"], ["path"], "frontmatter_update");
    const path = expectString(input.path, "frontmatter_update.path");
    let rawSet: Record<string, unknown> | undefined;
    let set: Record<string, JsonLikeValue> | undefined;
    let deleteKeys: string[] | undefined;

    if (input.set !== undefined) {
        rawSet = expectObject(input.set, "frontmatter_update.set");
    }

    if (input.delete !== undefined) {
        if (!Array.isArray(input.delete)) {
            throw new OperationsValidationError("frontmatter_update.delete must be an array.");
        }
        deleteKeys = [];
        for (let index = 0; index < input.delete.length; index += 1) {
            const value = input.delete[index];
            const key = expectString(value, `frontmatter_update.delete[${index}]`);
            assertSafeFrontmatterKey(key, `frontmatter_update.delete[${index}]`);
            deleteKeys.push(key);
        }
        if (new Set(deleteKeys).size !== deleteKeys.length) {
            throw new OperationsValidationError("frontmatter_update.delete must not contain duplicate keys.");
        }
    }

    if (rawSet) set = validateJsonLike(rawSet, "frontmatter_update.set", 0, new Set()) as Record<string, JsonLikeValue>;

    if ((!set || Object.keys(set).length === 0) && (!deleteKeys || deleteKeys.length === 0)) {
        throw new OperationsValidationError("frontmatter_update requires a non-empty set or delete change.");
    }
    if (set && deleteKeys?.some((key) => Object.prototype.hasOwnProperty.call(set, key))) {
        throw new OperationsValidationError("frontmatter_update cannot set and delete the same key.");
    }

    return {
        path,
        ...(set && Object.keys(set).length > 0 ? { set } : {}),
        ...(deleteKeys && deleteKeys.length > 0 ? { delete: deleteKeys } : {}),
    };
}

function validateJsonLike(
    value: unknown,
    path: string,
    depth: number,
    ancestors: Set<object>,
): JsonLikeValue {
    if (depth > MAX_JSON_DEPTH) throw new OperationsValidationError(`${path} exceeds the maximum nesting depth.`);
    if (value === null) {
        return null;
    }
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new OperationsValidationError(`${path} must contain only finite numbers.`);
        return value;
    }
    if (Array.isArray(value)) {
        if (ancestors.has(value)) throw new OperationsValidationError(`${path} must not contain cycles.`);
        ancestors.add(value);
        const items = value.map((item, index) => validateJsonLike(item, `${path}[${index}]`, depth + 1, ancestors));
        ancestors.delete(value);
        return items;
    }
    if (!isRecord(value)) throw new OperationsValidationError(`${path} must be JSON-compatible.`);
    if (ancestors.has(value)) throw new OperationsValidationError(`${path} must not contain cycles.`);
    ancestors.add(value);
    const output = Object.create(null) as Record<string, JsonLikeValue>;
    for (const key of Object.keys(value)) {
        assertSafeFrontmatterKey(key, path);
        output[key] = validateJsonLike(value[key], `${path}.${key}`, depth + 1, ancestors);
    }
    ancestors.delete(value);
    return output;
}

function assertSafeFrontmatterKey(key: string, path: string): void {
    if (key.length === 0) throw new OperationsValidationError(`${path} must not contain an empty key.`);
    if (DANGEROUS_KEYS.has(key)) {
        throw new OperationsValidationError(`${path} contains forbidden key ${key}.`);
    }
}

function expectObject(value: unknown, path: string): Record<string, unknown> {
    if (!isRecord(value)) throw new OperationsValidationError(`${path} must be an object.`);
    return value;
}


function expectExactKeys(
    value: Record<string, unknown>,
    allowed: readonly string[],
    required: readonly string[],
    path: string,
): void {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) throw new OperationsValidationError(`${path} contains unsupported property ${key}.`);
    }
    for (const key of required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
            throw new OperationsValidationError(`${path} is missing required property ${key}.`);
        }
    }
}

function expectString(value: unknown, path: string): string {
    if (typeof value !== "string") throw new OperationsValidationError(`${path} must be a string.`);
    return value;
}

function expectContentString(value: unknown, path: string, allowEmpty: boolean): string {
    const string = expectString(value, path);
    if (!allowEmpty && string.length === 0) throw new OperationsValidationError(`${path} must not be empty.`);
    return string;
}

function expectPositiveInteger(value: unknown, path: string): number {
    if (!Number.isInteger(value) || (value as number) < 1) {
        throw new OperationsValidationError(`${path} must be a 1-based positive integer.`);
    }
    return value as number;
}

function expectHeading(value: unknown, path: string): string {
    const heading = expectString(value, path);
    if (heading.length === 0 || heading.trim() !== heading) {
        throw new OperationsValidationError(`${path} must be non-empty visible heading text without surrounding whitespace.`);
    }
    if (heading.startsWith("#")) throw new OperationsValidationError(`${path} must not include a # prefix.`);
    return heading;
}

function expectEnum<const Values extends readonly string[]>(
    value: unknown,
    values: Values,
    path: string,
): Values[number] {
    if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
        throw new OperationsValidationError(`${path} must be one of ${values.join(", ")}.`);
    }
    return value;
}

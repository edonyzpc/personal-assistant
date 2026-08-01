import {
    CORE_WRITE_TOOL_NAMES,
    type CoreWriteInputMap,
    type CoreWriteToolName,
    type FrontmatterUpdateInput,
    type JsonLikeValue,
    type VaultAppendInput,
    type VaultCreateInput,
    type VaultProcessInput,
} from "./types";

export const MAX_OPERATION_CONTENT_CHARS = 50_000;
export const MAX_INTENT_OPERATIONS = 16;
export const MAX_INTENT_GENERATED_CHARS = 200_000;
/** Maximum positive growth of one frozen expected-after snapshot. */
export const MAX_OPERATION_RESULT_GROWTH_CHARS = 200_000;
/** Bound the number of literal replacements before allocating the transformed note. */
export const MAX_LITERAL_REPLACE_MATCHES = 50_000;
/** Bound provider-controlled heading and section selectors. */
export const MAX_OPERATION_SELECTOR_CHARS = 1_000;
/** Bound one frontmatter mapping or explicit delete list. */
export const MAX_FRONTMATTER_KEYS = 256;
/** Bound provider-controlled frontmatter property names at every nesting level. */
export const MAX_FRONTMATTER_KEY_CHARS = 256;
/** Bound traversal work before cloning a provider-controlled JSON value. */
export const MAX_FRONTMATTER_JSON_NODES = 10_000;

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
    }
}

/** Non-generic runtime alias for provider and dispatcher adapters. */
export function validateCoreWriteToolInput(name: CoreWriteToolName, raw: unknown): CoreWriteInputMap[CoreWriteToolName] {
    return validateCoreWriteInput(name, raw);
}

export function validateVaultCreateInput(raw: unknown): VaultCreateInput {
    const input = expectObject(raw, "vault_create");
    expectExactKeys(input, ["path", "content"], ["path", "content"], "vault_create");
    return {
        path: expectString(input.path, "vault_create.path"),
        content: expectCappedString(input.content, "vault_create.content", true),
    };
}

export function validateVaultAppendInput(raw: unknown): VaultAppendInput {
    const input = expectObject(raw, "vault_append");
    expectExactKeys(input, ["path", "content"], ["path", "content"], "vault_append");
    return {
        path: expectString(input.path, "vault_append.path"),
        content: expectCappedString(input.content, "vault_append.content", false),
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
        const search = expectCappedString(params.search, "vault_process.params.search", false);
        const replace = expectCappedString(params.replace, "vault_process.params.replace", true);
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
                content: expectCappedString(params.content, "vault_process.params.content", false),
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
    let suppliedContentChars = 0;

    if (input.set !== undefined) {
        rawSet = expectObject(input.set, "frontmatter_update.set");
        suppliedContentChars += preflightJsonLike(rawSet, "frontmatter_update.set");
    }

    if (input.delete !== undefined) {
        if (!Array.isArray(input.delete)) {
            throw new OperationsValidationError("frontmatter_update.delete must be an array.");
        }
        if (input.delete.length > MAX_FRONTMATTER_KEYS) {
            throw new OperationsValidationError(`frontmatter_update.delete must contain at most ${MAX_FRONTMATTER_KEYS} keys.`);
        }
        deleteKeys = [];
        let deleteChars = 2;
        for (let index = 0; index < input.delete.length; index += 1) {
            const value = input.delete[index];
            const key = expectString(value, `frontmatter_update.delete[${index}]`);
            assertSafeFrontmatterKey(key, `frontmatter_update.delete[${index}]`);
            deleteChars += (index > 0 ? 1 : 0) + jsonEncodedStringLength(key);
            if (deleteChars > MAX_OPERATION_CONTENT_CHARS) {
                throw new OperationsValidationError(`frontmatter_update supplied content exceeds ${MAX_OPERATION_CONTENT_CHARS} characters.`);
            }
            deleteKeys.push(key);
        }
        suppliedContentChars += deleteChars;
        if (new Set(deleteKeys).size !== deleteKeys.length) {
            throw new OperationsValidationError("frontmatter_update.delete must not contain duplicate keys.");
        }
    }

    if (suppliedContentChars > MAX_OPERATION_CONTENT_CHARS) {
        throw new OperationsValidationError(`frontmatter_update supplied content exceeds ${MAX_OPERATION_CONTENT_CHARS} characters.`);
    }
    if (rawSet) set = cloneValidatedJsonLike(rawSet) as Record<string, JsonLikeValue>;

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

interface JsonPreflightBudget {
    nodes: number;
    serializedChars: number;
    ancestors: Set<object>;
}

function preflightJsonLike(value: unknown, path: string): number {
    const budget: JsonPreflightBudget = {
        nodes: 0,
        serializedChars: 0,
        ancestors: new Set(),
    };
    inspectJsonLike(value, path, 0, budget);
    return budget.serializedChars;
}

function inspectJsonLike(value: unknown, path: string, depth: number, budget: JsonPreflightBudget): void {
    if (depth > MAX_JSON_DEPTH) throw new OperationsValidationError(`${path} exceeds the maximum nesting depth.`);
    budget.nodes += 1;
    if (budget.nodes > MAX_FRONTMATTER_JSON_NODES) {
        throw new OperationsValidationError(`frontmatter_update.set exceeds ${MAX_FRONTMATTER_JSON_NODES} JSON nodes.`);
    }

    if (value === null) {
        consumeJsonChars(budget, 4);
        return;
    }
    if (typeof value === "string") {
        if (value.length > MAX_OPERATION_CONTENT_CHARS) {
            throw new OperationsValidationError(`frontmatter_update.set exceeds ${MAX_OPERATION_CONTENT_CHARS} characters.`);
        }
        consumeJsonChars(budget, jsonEncodedStringLength(value));
        return;
    }
    if (typeof value === "boolean") {
        consumeJsonChars(budget, value ? 4 : 5);
        return;
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new OperationsValidationError(`${path} must contain only finite numbers.`);
        consumeJsonChars(budget, Object.is(value, -0) ? 1 : String(value).length);
        return;
    }
    if (Array.isArray(value)) {
        if (value.length > MAX_FRONTMATTER_JSON_NODES) {
            throw new OperationsValidationError(`frontmatter_update.set exceeds ${MAX_FRONTMATTER_JSON_NODES} JSON nodes.`);
        }
        if (budget.ancestors.has(value)) throw new OperationsValidationError(`${path} must not contain cycles.`);
        budget.ancestors.add(value);
        consumeJsonChars(budget, 2 + Math.max(0, value.length - 1));
        for (let index = 0; index < value.length; index += 1) {
            inspectJsonLike(value[index], `${path}[${index}]`, depth + 1, budget);
        }
        budget.ancestors.delete(value);
        return;
    }
    if (!isRecord(value)) throw new OperationsValidationError(`${path} must be JSON-compatible.`);
    if (budget.ancestors.has(value)) throw new OperationsValidationError(`${path} must not contain cycles.`);
    budget.ancestors.add(value);
    consumeJsonChars(budget, 2);
    let propertyCount = 0;
    for (const key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        propertyCount += 1;
        if (propertyCount > MAX_FRONTMATTER_KEYS) {
            throw new OperationsValidationError(`${path} must contain at most ${MAX_FRONTMATTER_KEYS} keys.`);
        }
        assertSafeFrontmatterKey(key, path);
        consumeJsonChars(budget, (propertyCount > 1 ? 1 : 0) + jsonEncodedStringLength(key) + 1);
        inspectJsonLike(value[key], `${path}.${key}`, depth + 1, budget);
    }
    budget.ancestors.delete(value);
}

function consumeJsonChars(budget: JsonPreflightBudget, chars: number): void {
    budget.serializedChars += chars;
    if (budget.serializedChars > MAX_OPERATION_CONTENT_CHARS) {
        throw new OperationsValidationError(`frontmatter_update.set exceeds ${MAX_OPERATION_CONTENT_CHARS} characters.`);
    }
}

function jsonEncodedStringLength(value: string): number {
    let length = 2;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09
            || code === 0x0a || code === 0x0c || code === 0x0d) {
            length += 2;
        } else if (code <= 0x1f) {
            length += 6;
        } else if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                length += 2;
                index += 1;
            } else {
                length += 6;
            }
        } else if (code >= 0xdc00 && code <= 0xdfff) {
            length += 6;
        } else {
            length += 1;
        }
    }
    return length;
}

function cloneValidatedJsonLike(value: unknown): JsonLikeValue {
    if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
        return value as JsonLikeValue;
    }
    if (Array.isArray(value)) return value.map((item) => cloneValidatedJsonLike(item));
    const output = Object.create(null) as Record<string, JsonLikeValue>;
    for (const key of Object.keys(value as Record<string, unknown>)) {
        output[key] = cloneValidatedJsonLike((value as Record<string, unknown>)[key]);
    }
    return output;
}

function assertSafeFrontmatterKey(key: string, path: string): void {
    if (key.length === 0) throw new OperationsValidationError(`${path} must not contain an empty key.`);
    if (key.length > MAX_FRONTMATTER_KEY_CHARS) {
        throw new OperationsValidationError(`${path} contains a key longer than ${MAX_FRONTMATTER_KEY_CHARS} characters.`);
    }
    if (DANGEROUS_KEYS.has(key)) {
        throw new OperationsValidationError(`${path} contains forbidden key ${key}.`);
    }
}

function expectObject(value: unknown, path: string): Record<string, unknown> {
    if (!isRecord(value)) throw new OperationsValidationError(`${path} must be an object.`);
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
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

function expectCappedString(value: unknown, path: string, allowEmpty: boolean): string {
    const string = expectString(value, path);
    if (!allowEmpty && string.length === 0) throw new OperationsValidationError(`${path} must not be empty.`);
    if (string.length > MAX_OPERATION_CONTENT_CHARS) {
        throw new OperationsValidationError(`${path} exceeds ${MAX_OPERATION_CONTENT_CHARS} characters.`);
    }
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
    if (heading.length > MAX_OPERATION_SELECTOR_CHARS) {
        throw new OperationsValidationError(`${path} exceeds ${MAX_OPERATION_SELECTOR_CHARS} characters.`);
    }
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
    return value as Values[number];
}

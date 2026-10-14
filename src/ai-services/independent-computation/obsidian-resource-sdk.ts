import { View, parseLinktext } from "obsidian";
import type { Editor, EditorPosition } from "obsidian";
import type { AiServiceHost } from "../AiServiceHost";
import type { TaskSourceRun } from "../task-source-run";
import type { TaskSourceReadPlan } from "../task-source-executor";
import type { TaskSourceReadGuard } from "../task-source-read-guard";
import { checkpointTaskSourceRead, isTaskSourcePathAllowed } from "../task-source-read-guard";
import { throwIfAborted } from "../chat-utils";
import { validateResourceVaultPath } from "../operations/vault-path";
import { isResourceOperationToolName, validateResourceOperationInput } from "../operations/resource-input-validation";
export type ResourceTarget = {
    path: string;
    resourceRef?: never;
} | {
    resourceRef: string;
    path?: never;
};
export interface SdkError {
    code: string;
    message: string;
    executionState?: "not_started" | "running" | "succeeded" | "failed" | "partially_succeeded" | "acceptance_unknown";
    recovery?: {
        code: string;
        allowedActions: string[];
    };
}
export type SdkResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    value?: T;
    error: SdkError;
};
export interface ObsidianSdkHost {
    readonly host: AiServiceHost;
    readonly sourceRun: TaskSourceRun;
    readonly guard?: TaskSourceReadGuard;
    readonly signal?: AbortSignal;
    readonly onReadAdmitted?: (path: string) => void;
    readonly operationsSession?: {
        getUndoTargetPaths(receiptId: string): readonly string[] | undefined;
    };
}
export interface SdkResource {
    path: string;
    name?: string;
    extension?: string;
    children?: SdkResource[];
    stat?: {
        ctime?: number;
        mtime?: number;
        size: number;
    };
}
export interface ResolvedObsidianResource {
    file: SdkResource;
    path: string;
    resourceRef: string;
    kind: "file" | "folder";
}
export interface ReadSnapshotBinding extends ResolvedObsidianResource {
    sourceVersion: string;
    readRef: string;
    before: string;
}
export interface SnapshotEdit {
    from: number;
    to: number;
    text: string;
}
interface SdkView {
    file?: SdkResource;
    editor?: Editor;
    getViewType(): string;
}
interface SdkLeaf {
    view: SdkView;
    openFile(file: unknown): Promise<unknown>;
}
export interface WorkspaceSnapshotBinding {
    readonly snapshotId: string;
    readonly viewId: string;
    readonly file: SdkResource;
    readonly leaf: SdkLeaf;
    readonly view: SdkView;
    readonly editor: Editor;
    readonly path: string;
    readonly before: string;
    readonly selection: {
        from: number;
        to: number;
    };
    isLive(): boolean;
    readBuffer(): string;
    transact(edits: readonly SnapshotEdit[]): void;
}
export interface OpenFacts {
    opened: true;
    path: string;
    viewId: string;
    viewType: string;
    position?: {
        requested: EditorPosition;
        applied: boolean;
        actual?: EditorPosition;
        reason?: string;
    };
}
export const OBSIDIAN_SDK_METHODS = [
    "obsidian.vault.list", "obsidian.vault.readText", "obsidian.vault.readBinary",
    "obsidian.metadata.inspect", "obsidian.metadata.links", "obsidian.metadata.resolveLink",
    "obsidian.vault.createText", "obsidian.vault.replaceText", "obsidian.vault.mkdir",
    "obsidian.vault.move", "obsidian.vault.trash", "obsidian.workspace.getContext",
    "obsidian.workspace.open", "obsidian.workspace.applyEdits", "obsidian.operations.getStatus", "obsidian.operations.undo",
] as const;
export type ObsidianSdkMethodName = typeof OBSIDIAN_SDK_METHODS[number];
export function isObsidianSdkMethodName(name: string): name is ObsidianSdkMethodName {
    return (OBSIDIAN_SDK_METHODS as readonly string[]).includes(name);
}
export function obsidianSdkMethodDescription(name: ObsidianSdkMethodName): string { return `Obsidian Resource SDK method ${name}.`; }
export const SDK_TEXT_PAGE_CHARS = 100000;
export const SDK_BINARY_PAGE_BYTES = 512 * 1024;
export const SDK_ITEMS_PER_PAGE = 200;
// Retained read credentials are run-local observations, not another cache or Undo store.
export const SDK_SNAPSHOT_BYTES = 64 * 1024 * 1024;
const SINGLE_READ_BYTES = SDK_SNAPSHOT_BYTES / 4;
const CACHE_FIELDS = ["frontmatter", "headings", "tags", "sections", "blocks", "links", "embeds"] as const;
const BINARY_EXTENSIONS = new Set("png jpg jpeg gif webp avif heic bmp ico tif tiff psd pdf mp3 mp4 m4a mov wav ogg flac webm woff woff2 ttf otf zip gz tar 7z rar doc docx xls xlsx ppt pptx epub db sqlite sqlite3 wasm bin exe dll dylib so dmg apk".split(" "));
export function isObsidianTextPath(path: string): boolean {
    return !BINARY_EXTENSIONS.has(path.split(".").pop()!.toLowerCase());
}
class SdkFailure extends Error {
    constructor(readonly code: string, message: string) { super(message); }
}
function fail<T = never>(code: string, message: string): SdkResult<T> { return { ok: false, error: { code, message } }; }
function object(raw: unknown): Record<string, unknown> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new SdkFailure("schema_invalid", "Expected an object.");
    return raw as Record<string, unknown>;
}
function string(raw: unknown, label: string): string {
    if (typeof raw !== "string" || !raw.length)
        throw new SdkFailure("schema_invalid", `${label} must be a non-empty string.`);
    return raw;
}
function pathValue(raw: unknown, root = false): string {
    if (root && raw === "")
        return "";
    try {
        return validateResourceVaultPath(raw);
    }
    catch (error) {
        throw new SdkFailure("schema_invalid", error instanceof Error ? error.message : "Expected a vault-relative path.");
    }
}
function targetValue(raw: unknown): ResourceTarget {
    const value = object(raw);
    if (Object.keys(value).some(key => key !== "path" && key !== "resourceRef"))
        throw new SdkFailure("schema_invalid", "Unknown target property.");
    if (typeof value.path === "string" && value.resourceRef === undefined)
        return { path: pathValue(value.path, true) };
    if (value.path === undefined && typeof value.resourceRef === "string")
        return { resourceRef: string(value.resourceRef, "resourceRef") };
    throw new SdkFailure("schema_invalid", "target must contain exactly one of path or resourceRef.");
}
export function validateObsidianSdkInput(name: string, raw: unknown): Record<string, unknown> {
    if (isResourceOperationToolName(name)) {
        try {
            return validateResourceOperationInput(name, raw);
        }
        catch (error) {
            throw new SdkFailure("schema_invalid", error instanceof Error ? error.message : "Invalid resource operation input.");
        }
    }
    const supplied = object(raw);
    const method = name === "list_vault_entries" ? "obsidian.vault.list" : name;
    const keys: Record<string, string[]> = {
        "obsidian.vault.list": ["target", "recursive", "cursor"], "obsidian.vault.readText": ["target", "cursor"],
        "obsidian.vault.readBinary": ["target", "cursor"], "obsidian.metadata.inspect": ["target", "fields", "cursor"],
        "obsidian.metadata.links": ["target", "direction", "cursor"], "obsidian.metadata.resolveLink": ["source", "link"],
        "obsidian.workspace.getContext": ["viewId", "includeText", "cursor"], "obsidian.operations.getStatus": ["intentId"],
    };
    if (!keys[method] || Object.keys(supplied).some(key => !keys[method].includes(key)))
        throw new SdkFailure("schema_invalid", "Unknown method or input property.");
    const input = { ...supplied };
    if (keys[method].includes("target"))
        input.target = targetValue(input.target);
    if (keys[method].includes("source"))
        input.source = targetValue(input.source);
    for (const key of ["recursive", "includeText"])
        if (input[key] !== undefined && typeof input[key] !== "boolean")
            throw new SdkFailure("schema_invalid", `${key} must be boolean.`);
    for (const key of ["cursor", "viewId"])
        if (input[key] !== undefined)
            input[key] = string(input[key], key);
    for (const key of ["intentId", "link"])
        if (keys[method].includes(key))
            input[key] = string(input[key], key);
    if (method === "obsidian.metadata.links" && input.direction !== "incoming" && input.direction !== "outgoing")
        throw new SdkFailure("schema_invalid", "direction must be incoming or outgoing.");
    if (input.fields !== undefined && (!Array.isArray(input.fields) || input.fields.some(field => !(CACHE_FIELDS as readonly unknown[]).includes(field))))
        throw new SdkFailure("schema_invalid", "Unknown metadata field.");
    return input;
}
function isFolder(file: SdkResource): boolean { return Array.isArray(file.children); }
function resource(raw: unknown): SdkResource | undefined { return raw && typeof raw === "object" && typeof (raw as SdkResource).path === "string" ? raw as SdkResource : undefined; }
function allowed(host: ObsidianSdkHost, path: string): boolean {
    return host.sourceRun.isResourcePathAllowed(path) && isTaskSourcePathAllowed(host.guard, path);
}
function check(host: ObsidianSdkHost, path: string): void {
    throwIfAborted(host.signal);
    if (!allowed(host, path))
        throw new SdkFailure("source_excluded", "The resource is outside the current source boundary.");
}
async function checkpoint(host: ObsidianSdkHost, path: string): Promise<void> {
    await checkpointTaskSourceRead(host.guard, host.signal);
    check(host, path);
}
export function resolveObsidianResource(host: ObsidianSdkHost, target: ResourceTarget): ResolvedObsidianResource | undefined {
    throwIfAborted(host.signal);
    const identity = host.sourceRun.resolveResourceIdentity(target);
    if (!identity || !allowed(host, identity.path))
        return undefined;
    const file = resource(host.sourceRun.resourceObject(identity.resourceRef));
    if (!file || !allowed(host, file.path))
        return undefined;
    return { file, path: file.path, resourceRef: identity.resourceRef, kind: identity.kind };
}
function resolve(host: ObsidianSdkHost, target: ResourceTarget): ResolvedObsidianResource {
    if (typeof target.path === 'string')
        check(host, target.path);
    const found = resolveObsidianResource(host, target);
    if (!found)
        throw new SdkFailure("stale_target", "The target is missing, excluded, or no longer the same object.");
    return found;
}
function live(host: ObsidianSdkHost, bound: ResolvedObsidianResource): void {
    check(host, bound.file.path);
    if (host.sourceRun.resourceObject(bound.resourceRef) !== bound.file)
        throw new SdkFailure("stale_target", "The resource changed during the call.");
}
type Observation = {
    kind: "text";
    bound: ReadSnapshotBinding;
} | {
    kind: "binary";
    bound: ResolvedObsidianResource;
    bytes: Uint8Array;
    readRef: string;
} | {
    kind: "workspace";
    bound: WorkspaceSnapshotBinding;
} | {
    kind: "items";
    bound: ResolvedObsidianResource;
    query: string;
    fingerprint: string;
    rows: Record<string, unknown>[];
    restricted: boolean;
    source: Record<string, unknown>;
};
interface Page {
    method: string;
    observation: string;
    offset: number;
    query: string;
}
interface State {
    observations: Map<string, {
        value: Observation;
        cost: number;
    }>;
    cursors: Map<string, Page>;
    viewIds: WeakMap<object, string>;
    views: Map<string, SdkLeaf>;
    retained: number;
}
const states = new WeakMap<TaskSourceRun, State>();
function state(host: ObsidianSdkHost): State {
    let found = states.get(host.sourceRun);
    if (!found) {
        found = { observations: new Map(), cursors: new Map(), viewIds: new WeakMap(), views: new Map(), retained: 0 };
        states.set(host.sourceRun, found);
    }
    return found;
}
function id(prefix: string): string { return `${prefix}_${[...crypto.getRandomValues(new Uint32Array(4))].map(value => value.toString(16)).join("")}`; }
function remember(host: ObsidianSdkHost, value: Observation, cost: number, key = id("snapshot")): string {
    const owner = state(host);
    cost += 256;
    if (cost > SDK_SNAPSHOT_BYTES)
        throw new SdkFailure("resource_limit", "The resource exceeds the available snapshot memory.");
    while (owner.retained + cost > SDK_SNAPSHOT_BYTES) {
        const oldest = owner.observations.entries().next().value as [
            string,
            {
                cost: number;
            }
        ] | undefined;
        if (!oldest)
            break;
        owner.observations.delete(oldest[0]);
        owner.retained -= oldest[1].cost;
        for (const [cursor, page] of owner.cursors)
            if (page.observation === oldest[0])
                owner.cursors.delete(cursor);
    }
    owner.observations.set(key, { value, cost });
    owner.retained += cost;
    return key;
}
function page(host: ObsidianSdkHost, method: string, cursor: unknown, query: string): Page | undefined {
    if (cursor === undefined)
        return undefined;
    const found = state(host).cursors.get(String(cursor));
    if (!found || found.method !== method || found.query !== query || !state(host).observations.has(found.observation))
        throw new SdkFailure("stale_target", "The continuation is expired or belongs to another query.");
    return found;
}
function next(host: ObsidianSdkHost, method: string, observation: string, offset: number, query: string): string {
    const cursor = id("cursor");
    state(host).cursors.set(cursor, { method, observation, offset, query });
    return cursor;
}
function queryTarget(bound: ResolvedObsidianResource): string { return bound.resourceRef; }
function observation(host: ObsidianSdkHost, key: string): Observation {
    const found = state(host).observations.get(key)?.value;
    if (!found)
        throw new SdkFailure("stale_target", "The requested snapshot has expired.");
    return found;
}
function preflightSize(file: SdkResource): void {
    if (!file.stat || !Number.isFinite(file.stat.size) || file.stat.size > SINGLE_READ_BYTES)
        throw new SdkFailure("resource_limit", "The full native read cannot be admitted within the available memory budget.");
}
async function savedText(host: ObsidianSdkHost, bound: ResolvedObsidianResource): Promise<string> {
    if (bound.kind !== "file" || !isObsidianTextPath(bound.path))
        throw new SdkFailure("schema_invalid", "The target is not a text file.");
    preflightSize(bound.file);
    await checkpoint(host, bound.file.path);
    host.onReadAdmitted?.(bound.file.path);
    const vault = host.host.app.vault;
    // Decode the actual saved bytes strictly: Vault.read's replacement decoding
    // alone cannot distinguish an unfamiliar binary resource from UTF-8 text.
    const bytes = new Uint8Array(await vault.readBinary(bound.file as never));
    live(host, bound);
    await checkpoint(host, bound.file.path);
    if (bytes.length > SINGLE_READ_BYTES)
        throw new SdkFailure("resource_limit", "The native text read exceeds the available memory.");
    let text: string;
    try {
        text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    }
    catch {
        throw new SdkFailure("unsupported_encoding", "The saved resource is not UTF-8 text; use readBinary.");
    }
    if (text.includes("\u0000"))
        throw new SdkFailure("unsupported_encoding", "The saved resource contains binary NUL data; use readBinary.");
    if (host.sourceRun.runSourceSelection?.scope === "web"
        && host.sourceRun.createdResourceText(bound.file.path) !== text)
        throw new SdkFailure("stale_target", "The created output was edited outside this request.");
    if (text.length * 4 > SDK_SNAPSHOT_BYTES)
        throw new SdkFailure("resource_limit", "The text cannot be safely retained within the resource budget.");
    const verified = new Uint8Array(await vault.readBinary(bound.file as never));
    if (!sameBytes(bytes, verified))
        throw new SdkFailure("stale_target", "The saved text changed during its read.");
    live(host, bound);
    await checkpoint(host, bound.file.path);
    return text;
}
function safeOffset(text: string, offset: number): boolean {
    if (offset < 0 || offset > text.length)
        return false;
    if (!offset || offset === text.length)
        return true;
    const a = text.charCodeAt(offset - 1), b = text.charCodeAt(offset);
    return !(a >= 0xd800 && a <= 0xdbff && b >= 0xdc00 && b <= 0xdfff) && !(text[offset - 1] === "\r" && text[offset] === "\n");
}
function textEnd(text: string, start: number): number { let end = Math.min(text.length, start + SDK_TEXT_PAGE_CHARS); if (!safeOffset(text, end))
    end--; return end; }
export function getReadSnapshot(host: ObsidianSdkHost, version: string, target: ResourceTarget): ReadSnapshotBinding | undefined {
    throwIfAborted(host.signal);
    const known = state(host).observations.get(version)?.value;
    if (known?.kind !== "text")
        return undefined;
    const current = resolveObsidianResource(host, target);
    if (!current || current.file !== known.bound.file || current.resourceRef !== known.bound.resourceRef)
        return undefined;
    return { ...known.bound, path: current.path };
}
async function readText(host: ObsidianSdkHost, input: Record<string, unknown>): Promise<SdkResult<unknown>> {
    const bound = resolve(host, input.target as ResourceTarget), query = queryTarget(bound);
    const continuation = page(host, "readText", input.cursor, query);
    const current = await savedText(host, bound);
    let snapshot: ReadSnapshotBinding;
    let version: string;
    const start = continuation?.offset ?? 0;
    if (continuation) {
        const previous = observation(host, continuation.observation);
        if (previous.kind !== "text" || previous.bound.file !== bound.file || previous.bound.before !== current)
            throw new SdkFailure("stale_target", "The saved text changed between pages.");
        snapshot = previous.bound;
        version = continuation.observation;
    }
    else {
        version = id("version");
        snapshot = { ...bound, sourceVersion: version, readRef: id("read"), before: current };
        remember(host, { kind: "text", bound: snapshot }, current.length * 2, version);
    }
    const end = textEnd(current, start);
    return { ok: true, value: { path: bound.file.path, resourceRef: bound.resourceRef, readRef: snapshot.readRef,
            sourceVersion: version, text: current.slice(start, end), encoding: "utf-8", range: { start, end, total: current.length },
            coverage: start === 0 && end === current.length ? "complete" : "partial",
            ...(end < current.length ? { nextCursor: next(host, "readText", version, end, query) } : {}) } };
}
function encodeBytes(bytes: Uint8Array): string {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(binary);
}
function sameBytes(a: Uint8Array, b: Uint8Array): boolean { return a.length === b.length && a.every((byte, index) => byte === b[index]); }
async function readBinary(host: ObsidianSdkHost, input: Record<string, unknown>): Promise<SdkResult<unknown>> {
    const bound = resolve(host, input.target as ResourceTarget);
    if (bound.kind !== "file")
        throw new SdkFailure("schema_invalid", "The target is not a file.");
    preflightSize(bound.file);
    const query = queryTarget(bound), continuation = page(host, "readBinary", input.cursor, query);
    await checkpoint(host, bound.path);
    host.onReadAdmitted?.(bound.path);
    const bytes = new Uint8Array(await host.host.app.vault.readBinary(bound.file as never));
    live(host, bound);
    await checkpoint(host, bound.file.path);
    if (bytes.length > SINGLE_READ_BYTES)
        throw new SdkFailure("resource_limit", "The native byte read exceeds the available memory.");
    const verified = new Uint8Array(await host.host.app.vault.readBinary(bound.file as never));
    if (!sameBytes(bytes, verified))
        throw new SdkFailure("stale_target", "The bytes changed during their read.");
    if (host.sourceRun.runSourceSelection?.scope === "web") {
        const text = host.sourceRun.createdResourceText(bound.file.path);
        if (text === undefined || !sameBytes(bytes, new TextEncoder().encode(text)))
            throw new SdkFailure("stale_target", "The created output was edited outside this request.");
    }
    live(host, bound);
    await checkpoint(host, bound.file.path);
    let version = continuation?.observation;
    let readRef: string;
    if (version) {
        const old = observation(host, version);
        if (old.kind !== "binary" || old.bound.file !== bound.file || !sameBytes(old.bytes, bytes))
            throw new SdkFailure("stale_target", "The bytes changed between pages.");
        readRef = old.readRef;
    }
    else {
        version = id("version");
        readRef = id("read");
        remember(host, { kind: "binary", bound, bytes, readRef }, bytes.length, version);
    }
    const offset = continuation?.offset ?? 0, end = Math.min(offset + SDK_BINARY_PAGE_BYTES, bytes.length);
    return { ok: true, value: { path: bound.file.path, resourceRef: bound.resourceRef, readRef, sourceVersion: version,
            bytes: { __bytesBase64: encodeBytes(bytes.subarray(offset, end)) }, offset, length: end - offset, total: bytes.length,
            coverage: offset === 0 && end === bytes.length ? "complete" : "partial",
            ...(end < bytes.length ? { nextCursor: next(host, "readBinary", version, end, query) } : {}) } };
}
export function collectObsidianResourceTree(host: ObsidianSdkHost, target: ResourceTarget, recursive = true, requireEntireScope = false): ResolvedObsidianResource[] {
    const root = resolve(host, target), result = [root];
    const walk = (parent: SdkResource): void => {
        for (const child of parent.children ?? []) {
            if (!allowed(host, child.path)) {
                if (requireEntireScope)
                    throw new SdkFailure("source_excluded", "An affected resource is outside the current boundary.");
                continue;
            }
            const bound = resolveObsidianResource(host, { path: child.path });
            if (!bound || bound.file !== child)
                throw new SdkFailure("stale_target", "The resource tree changed.");
            result.push(bound);
            if (recursive && isFolder(child))
                walk(child);
        }
    };
    if (root.kind === "folder")
        walk(root.file);
    return result;
}
function entry(bound: ResolvedObsidianResource): Record<string, unknown> {
    return { path: bound.file.path, name: bound.file.name ?? bound.file.path.split("/").pop() ?? "", kind: bound.kind,
        ...(bound.kind === "file" ? { extension: bound.file.extension ?? bound.file.path.split(".").pop(), stat: bound.file.stat ? { ...bound.file.stat } : undefined } : {}), resourceRef: bound.resourceRef };
}
function items(host: ObsidianSdkHost, method: string, input: Record<string, unknown>, bound: ResolvedObsidianResource, query: string, rows: Record<string, unknown>[], restricted: boolean, source: Record<string, unknown>): SdkResult<unknown> {
    const fingerprint = JSON.stringify(rows), continuation = page(host, method, input.cursor, query);
    const capturedRows = JSON.parse(fingerprint) as Record<string, unknown>[];
    let version = continuation?.observation;
    if (version) {
        const previous = observation(host, version);
        if (previous.kind !== "items" || previous.bound.file !== bound.file || previous.fingerprint !== fingerprint || previous.restricted !== restricted)
            throw new SdkFailure("stale_target", "The query changed between pages.");
    }
    else {
        version = remember(host, { kind: "items", bound, query, fingerprint, rows: capturedRows, restricted, source }, fingerprint.length * 2);
    }
    const start = continuation?.offset ?? 0, end = Math.min(start + SDK_ITEMS_PER_PAGE, rows.length);
    return { ok: true, value: { path: bound.path, resourceRef: bound.resourceRef, source, entries: capturedRows.slice(start, end),
            range: { start, end, total: rows.length }, coverage: restricted ? "restricted" : start === 0 && end === rows.length ? "complete" : "partial",
            ...(end < rows.length ? { nextCursor: next(host, method, version, end, query) } : {}) } };
}
async function list(host: ObsidianSdkHost, input: Record<string, unknown>): Promise<SdkResult<unknown>> {
    const bound = resolve(host, input.target as ResourceTarget);
    await checkpoint(host, bound.path);
    host.onReadAdmitted?.(bound.path);
    const resources = collectObsidianResourceTree(host, input.target as ResourceTarget, input.recursive === true);
    let restricted = false;
    for (const item of resources) {
        host.onReadAdmitted?.(item.path);
        if ((item.file.children ?? []).some(child => !allowed(host, child.path)))
            restricted = true;
    }
    const rows = (bound.kind === "folder" ? resources.slice(1) : resources).map(entry);
    await checkpoint(host, bound.path);
    live(host, bound);
    const again = collectObsidianResourceTree(host, input.target as ResourceTarget, input.recursive === true).map(entry);
    if (JSON.stringify(resources.map(entry)) !== JSON.stringify(again))
        throw new SdkFailure("stale_target", "The tree changed while it was observed.");
    return items(host, "list", input, bound, `${bound.resourceRef}:${input.recursive === true}`, rows, restricted, { kind: "vault-tree", sourceVersion: "unknown" });
}
function cache(host: ObsidianSdkHost, bound: ResolvedObsidianResource): Record<string, unknown> | null {
    check(host, bound.path);
    host.onReadAdmitted?.(bound.path);
    return host.host.app.metadataCache.getFileCache(bound.file as never) as unknown as Record<string, unknown> | null;
}
async function inspect(host: ObsidianSdkHost, input: Record<string, unknown>): Promise<SdkResult<unknown>> {
    const bound = resolve(host, input.target as ResourceTarget);
    await checkpoint(host, bound.path);
    if (bound.kind !== "file" || !/\.md$/i.test(bound.path))
        return { ok: true, value: { path: bound.path, resourceRef: bound.resourceRef, source: { kind: "metadata-cache", cacheState: "not_applicable", sourceVersion: "unknown" } } };
    const cached = cache(host, bound);
    live(host, bound);
    // Cache objects can be updated in place by Obsidian while this call yields.
    // Capture their cached facts, without treating them as saved-file versions.
    const data = cached ? JSON.parse(JSON.stringify(cached)) as Record<string, unknown> : null;
    if (!data)
        return { ok: true, value: { path: bound.path, resourceRef: bound.resourceRef, source: { kind: "metadata-cache", cacheState: "unknown", sourceVersion: "unknown" }, coverage: "restricted" } };
    const fields = input.fields as string[] | undefined ?? [...CACHE_FIELDS], rows: Record<string, unknown>[] = [];
    for (const field of fields) {
        const value = data[field];
        if (Array.isArray(value))
            for (const item of value)
                rows.push({ field, value: item });
        else if (value && typeof value === "object")
            for (const [key, item] of Object.entries(value))
                rows.push({ field, key, value: item });
    }
    await checkpoint(host, bound.path);
    live(host, bound);
    return items(host, "inspect", input, bound, `${bound.resourceRef}:${JSON.stringify(fields)}`, rows, false, { kind: "metadata-cache", cacheState: "available", sourceVersion: "unknown" });
}
function linkParts(link: string): {
    path: string;
    subpath: string;
    alias?: string;
    link: string;
} {
    const raw = link.startsWith("[[") && link.endsWith("]]") ? link.slice(2, -2) : link;
    const separator = raw.indexOf("|"), target = separator < 0 ? raw : raw.slice(0, separator);
    return { ...parseLinktext(target), ...(separator < 0 ? {} : { alias: raw.slice(separator + 1) }), link };
}
async function resolveLink(host: ObsidianSdkHost, input: Record<string, unknown>): Promise<SdkResult<unknown>> {
    const bound = resolve(host, input.source as ResourceTarget);
    await checkpoint(host, bound.path);
    host.onReadAdmitted?.(bound.path);
    const parsed = linkParts(String(input.link)), destination = resource(host.host.app.metadataCache.getFirstLinkpathDest(parsed.path, bound.path));
    live(host, bound);
    await checkpoint(host, bound.path);
    if (destination && !allowed(host, destination.path))
        return { ok: false, value: { source: bound.path, link: parsed.link, state: "restricted" }, error: { code: "source_excluded", message: "The resolved target is outside the source boundary.", executionState: "not_started" } };
    const resolved = destination ? resolve(host, { path: destination.path }) : undefined;
    if (resolved && resolved.file !== destination)
        throw new SdkFailure('stale_target', 'The resolved link target changed.');
    if (resolved)
        host.onReadAdmitted?.(resolved.path);
    return { ok: true, value: { source: bound.path, link: parsed.link, subpath: parsed.subpath, alias: parsed.alias, state: destination ? "resolved" : "unresolved", ...(resolved ? { target: entry(resolved) } : {}) } };
}
async function links(host: ObsidianSdkHost, input: Record<string, unknown>): Promise<SdkResult<unknown>> {
    const bound = resolve(host, input.target as ResourceTarget);
    await checkpoint(host, bound.path);
    if (bound.kind !== "file" || input.direction === "outgoing" && !/\.md$/i.test(bound.path))
        return { ok: true, value: { path: bound.path, source: { kind: "metadata-cache", cacheState: "not_applicable", sourceVersion: "unknown" } } };
    const metadata = host.host.app.metadataCache, rows: Record<string, unknown>[] = [];
    const endpoints: ResolvedObsidianResource[] = [];
    let restricted = false;
    if (input.direction === "outgoing") {
        const cached = cache(host, bound);
        if (!cached)
            return { ok: true, value: { path: bound.path, source: { kind: "metadata-cache", cacheState: "unknown", sourceVersion: "unknown" }, coverage: "restricted" } };
        const data = JSON.parse(JSON.stringify(cached)) as Record<string, unknown>;
        for (const raw of [...(data.links as {
                link: string;
            }[] ?? []), ...(data.embeds as {
                link: string;
            }[] ?? [])]) {
            const parsed = linkParts(raw.link), destination = resource(metadata.getFirstLinkpathDest(parsed.path, bound.path));
            if (destination && !allowed(host, destination.path)) {
                restricted = true;
                rows.push({ link: raw.link, state: "restricted" });
            }
            else {
                if (destination) {
                    const resolved = resolve(host, { path: destination.path });
                    if (resolved.file !== destination)
                        throw new SdkFailure('stale_target', 'The resolved link target changed.');
                    endpoints.push(resolved);
                    host.onReadAdmitted?.(destination.path);
                }
                rows.push({ ...raw, subpath: parsed.subpath, state: destination ? "resolved" : "unresolved", ...(destination ? { target: destination.path } : {}) });
            }
        }
    }
    else {
        host.onReadAdmitted?.(bound.path);
        let count = 0;
        for (const source of Object.keys(metadata.resolvedLinks ?? {})) {
            if (!allowed(host, source)) {
                restricted = true;
                continue;
            }
            const amount = metadata.resolvedLinks[source]?.[bound.path];
            if (amount) {
                endpoints.push(resolve(host, { path: source }));
                host.onReadAdmitted?.(source);
                rows.push({ source, target: bound.path, count: amount, state: "resolved" });
            }
            if (++count % SDK_ITEMS_PER_PAGE === 0)
                await checkpoint(host, bound.path);
        }
    }
    live(host, bound);
    await checkpoint(host, bound.path);
    for (const endpoint of endpoints)
        live(host, endpoint);
    for (const row of rows) {
        for (const key of ['source', 'target'])
            if (typeof row[key] === 'string' && !allowed(host, row[key] as string)) {
                throw new SdkFailure('source_excluded', 'A disclosed link endpoint was withdrawn during the observation.');
            }
    }
    return items(host, "links", input, bound, `${bound.resourceRef}:${input.direction}`, rows, restricted, { kind: "metadata-cache", cacheState: "available", sourceVersion: "unknown", direction: input.direction });
}
function leaves(host: ObsidianSdkHost): SdkLeaf[] {
    const result: SdkLeaf[] = [];
    host.host.app.workspace.iterateAllLeaves(leaf => {
        result.push(leaf as unknown as SdkLeaf);
    });
    return result;
}
function viewId(host: ObsidianSdkHost, leaf: SdkLeaf): string {
    const owner = state(host);
    let found = owner.viewIds.get(leaf);
    if (!found) {
        found = id("view");
        owner.viewIds.set(leaf, found);
        owner.views.set(found, leaf);
    }
    return found;
}
function findLeaf(host: ObsidianSdkHost, wanted?: string): SdkLeaf | undefined {
    const all = leaves(host);
    if (wanted) {
        const found = state(host).views.get(wanted);
        return found && all.includes(found) ? found : undefined;
    }
    const active = host.host.app.workspace.getActiveViewOfType(View);
    return all.find(leaf => leaf.view === active as unknown as SdkView);
}
export function captureWorkspaceSnapshot(host: ObsidianSdkHost, wanted?: string): WorkspaceSnapshotBinding | undefined {
    const leaf = findLeaf(host, wanted), view = leaf?.view, file = view?.file, editor = view?.editor;
    if (!leaf || !view || !file || !editor)
        return undefined;
    check(host, file.path);
    host.onReadAdmitted?.(file.path);
    const bound = resolve(host, { path: file.path });
    if (bound.file !== file)
        throw new SdkFailure("stale_target", "The view no longer owns this file.");
    const before = editor.getValue(), selection = { from: editor.posToOffset(editor.getCursor("from")), to: editor.posToOffset(editor.getCursor("to")) };
    if (host.sourceRun.runSourceSelection?.scope === "web" && host.sourceRun.createdResourceText(file.path) !== before)
        throw new SdkFailure("stale_target", "The created output's editor was changed outside this request.");
    if (before.length * 2 > SINGLE_READ_BYTES)
        throw new SdkFailure("resource_limit", "The editor buffer exceeds the snapshot memory budget.");
    const binding: WorkspaceSnapshotBinding = {
        snapshotId: id("editor"), viewId: viewId(host, leaf), file, leaf, view, editor,
        get path() { return file.path; }, before, selection,
        isLive: () => leaves(host).includes(leaf) && leaf.view === view && view.editor === editor && view.file === file
            && host.host.app.vault.getAbstractFileByPath(file.path) === file as unknown,
        readBuffer: () => editor.getValue(),
        transact: edits => {
            if (!binding.isLive())
                throw new SdkFailure("stale_target", "The original editor is no longer live.");
            const text = editor.getValue(), ordered = [...edits].sort((a, b) => a.from - b.from || a.to - b.to);
            for (let index = 0; index < ordered.length; index++) {
                const edit = ordered[index], previous = ordered[index - 1];
                if (!Number.isSafeInteger(edit.from) || !Number.isSafeInteger(edit.to) || edit.from > edit.to || typeof edit.text !== "string"
                    || !safeOffset(text, edit.from) || !safeOffset(text, edit.to)
                    || previous && (edit.from < previous.to || edit.from === previous.to && (edit.from === edit.to || previous.from === previous.to)))
                    throw new SdkFailure("schema_invalid", "Edits overlap or split a UTF-16/CRLF boundary.");
            }
            editor.transaction({ changes: ordered.map(edit => ({ from: editor.offsetToPos(edit.from), to: editor.offsetToPos(edit.to), text: edit.text })) });
        },
    };
    if (!binding.isLive() || editor.getValue() !== before)
        throw new SdkFailure("stale_target", "The editor changed while its snapshot was captured.");
    check(host, file.path);
    remember(host, { kind: "workspace", bound: binding }, before.length * 2, binding.snapshotId);
    return binding;
}
export function resolveWorkspaceSnapshot(host: ObsidianSdkHost, snapshotId: string): WorkspaceSnapshotBinding | undefined {
    throwIfAborted(host.signal);
    const found = state(host).observations.get(snapshotId)?.value;
    if (found?.kind !== "workspace" || !allowed(host, found.bound.path) || !found.bound.isLive())
        return undefined;
    return found.bound.readBuffer() === found.bound.before ? found.bound : undefined;
}
async function workspaceContext(host: ObsidianSdkHost, input: Record<string, unknown>): Promise<SdkResult<unknown>> {
    let binding: WorkspaceSnapshotBinding | undefined;
    let start = 0;
    if (input.cursor !== undefined) {
        const owner = state(host), saved = owner.cursors.get(String(input.cursor));
        if (!saved || saved.method !== "workspace" || input.viewId !== undefined && saved.query !== input.viewId)
            throw new SdkFailure("stale_target", "The editor continuation belongs to another view.");
        binding = resolveWorkspaceSnapshot(host, saved.observation);
        start = saved.offset;
        if (!binding)
            throw new SdkFailure("stale_target", "The original editor snapshot changed.");
    }
    else {
        const leaf = findLeaf(host, input.viewId as string | undefined);
        if (!leaf)
            throw new SdkFailure("view_unavailable", "The requested view is unavailable.");
        const view = leaf.view, file = view.file;
        if (file)
            await checkpoint(host, file.path);
        if (!view.editor || !file) {
            if (!leaves(host).includes(leaf) || leaf.view !== view || view.file !== file)
                throw new SdkFailure("stale_target", "The requested view changed while its context was read.");
            const bound = file ? resolve(host, { path: file.path }) : undefined;
            if (bound && bound.file !== file)
                throw new SdkFailure("stale_target", "The view no longer owns this file.");
            if (bound)
                host.onReadAdmitted?.(bound.path);
            return { ok: true, value: { viewId: viewId(host, leaf), viewType: view.getViewType(),
                    ...(bound ? { resourceRef: bound.resourceRef, file: { path: bound.path, resourceRef: bound.resourceRef } } : {}),
                    editor: { applicable: false } } };
        }
        binding = captureWorkspaceSnapshot(host, input.viewId as string | undefined);
    }
    if (!binding)
        throw new SdkFailure("view_unavailable", "The requested editor is unavailable.");
    await checkpoint(host, binding.path);
    if (!binding.isLive() || binding.readBuffer() !== binding.before)
        throw new SdkFailure("stale_target", "The editor changed while its context was read.");
    const end = textEnd(binding.before, start), bound = resolve(host, { path: binding.path });
    return { ok: true, value: { viewId: binding.viewId, viewType: binding.view.getViewType(), resourceRef: bound.resourceRef,
            file: { path: binding.path, resourceRef: bound.resourceRef }, source: "editor-buffer", editor: { applicable: true }, snapshotId: binding.snapshotId,
            sourceVersion: binding.snapshotId, selection: binding.selection,
            ...(input.includeText === false ? {} : { text: binding.before.slice(start, end), range: { start, end, total: binding.before.length },
                coverage: start === 0 && end === binding.before.length ? "complete" : "partial",
                ...(end < binding.before.length ? { nextCursor: next(host, "workspace", binding.snapshotId, end, binding.viewId) } : {}) }) } };
}
/** Called only by the already-admitted Operations owner; it records actual UI facts. */
export async function nativeOpenObsidianResource(host: ObsidianSdkHost, target: ResourceTarget, position?: EditorPosition): Promise<SdkResult<OpenFacts>> {
    let facts: OpenFacts | undefined;
    let attempted = false;
    let openedLeaf: SdkLeaf | undefined;
    let openedTarget: ResolvedObsidianResource | undefined;
    try {
        const bound = resolve(host, target);
        if (bound.kind !== "file")
            throw new SdkFailure("schema_invalid", "Only files can be opened.");
        if (host.sourceRun.runSourceSelection?.scope === "web") await savedText(host, bound);
        await checkpoint(host, bound.path);
        host.onReadAdmitted?.(bound.path);
        live(host, bound);
        const leaf = host.host.app.workspace.getLeaf(false) as unknown as SdkLeaf;
        openedLeaf = leaf;
        openedTarget = bound;
        attempted = true;
        await leaf.openFile(bound.file);
        facts = { opened: true, path: bound.file.path, viewId: viewId(host, leaf), viewType: leaf.view.getViewType() };
        live(host, bound);
        await checkpoint(host, bound.file.path);
        if (leaf.view.file !== bound.file)
            throw new SdkFailure('stale_target', 'The opened view no longer owns the target object.');
        if (position) {
            facts.position = { requested: position, applied: false };
            const editor = leaf.view.editor;
            if (!editor) {
                facts.position.reason = "not_applicable";
                return { ok: true, value: facts };
            }
            live(host, bound);
            await checkpoint(host, bound.file.path);
            const text = editor.getValue(), lines = text.split("\n");
            if (leaf.view.file !== bound.file || leaf.view.editor !== editor)
                throw new SdkFailure("stale_target", "The opened editor changed before positioning.");
            if (position.line >= lines.length || position.ch > lines[position.line].replace(/\r$/, "").length
                || !safeOffset(text, editor.posToOffset(position)))
                throw new SdkFailure("schema_invalid", "The requested position is not valid in the opened editor.");
            editor.setCursor(position);
            const actual = editor.getCursor();
            facts.position.actual = actual;
            facts.position.applied = actual.line === position.line && actual.ch === position.ch;
            if (!facts.position.applied)
                throw new SdkFailure("view_unavailable", "The host did not apply the requested position.");
        }
        return { ok: true, value: facts };
    }
    catch (error) {
        if (!facts && openedLeaf && openedTarget && openedLeaf.view.file === openedTarget.file) {
            facts = { opened: true, path: openedTarget.path, viewId: viewId(host, openedLeaf), viewType: openedLeaf.view.getViewType() };
        }
        if (facts && position && !facts.position) {
            facts.position = { requested: position, applied: false };
        }
        return { ok: false, ...(facts ? { value: facts } : {}), error: { code: error instanceof SdkFailure ? error.code : "view_unavailable", message: error instanceof Error ? error.message : String(error), executionState: facts ? "partially_succeeded" : attempted ? 'acceptance_unknown' : "not_started" } };
    }
}
export function resolveObsidianSdkReadPlan(host: ObsidianSdkHost, name: string, raw: unknown): TaskSourceReadPlan | undefined {
    // Invalid arguments are correctable input errors, not missing source authority.
    const input = validateObsidianSdkInput(name, raw);
    try {
        // A cache entry has no proof that it came from this request's output.
        if (host.sourceRun.runSourceSelection?.scope === "web" && name.startsWith("obsidian.metadata.")) return undefined;
        if (name === "obsidian.operations.getStatus")
            return { reads: [] };
        if (name === "obsidian.operations.undo") {
            const paths = host.operationsSession?.getUndoTargetPaths(String(input.receiptId));
            if (host.sourceRun.runSourceSelection?.scope === "web") {
                return paths && host.sourceRun.isCreatedResourceUndoAllowed(String(input.receiptId), paths)
                    ? { reads: [], outputTargetPaths: [...paths] } : undefined;
            }
            if (!paths || paths.some(path => !host.sourceRun.isResourceOutputPathAllowed(path)))
                return undefined;
            return { reads: paths.flatMap(path => {
                    const noteId = host.sourceRun.resolveNoteId(path);
                    return noteId ? [{ kind: "note" as const, noteId }] : [];
                }), outputTargetPaths: [...paths] };
        }
        const targets: ResourceTarget[] = [];
        if (input.target)
            targets.push(input.target as ResourceTarget);
        if (input.source)
            targets.push(input.source as ResourceTarget);
        if (name === "obsidian.workspace.getContext") {
            const saved = input.cursor ? state(host).cursors.get(String(input.cursor)) : undefined;
            const known = saved ? state(host).observations.get(saved.observation)?.value : undefined;
            const file = known?.kind === "workspace" ? known.bound.file : findLeaf(host, input.viewId as string | undefined)?.view.file;
            if (file)
                targets.push({ path: file.path });
        }
        if (name === "obsidian.workspace.applyEdits") {
            const known = state(host).observations.get(String(input.snapshotId))?.value;
            if (known?.kind !== "workspace" || !known.bound.isLive())
                return undefined;
            targets.push({ path: known.bound.path });
        }
        const paths = new Set<string>();
        for (const target of targets) {
            const found = resolve(host, target);
            paths.add(found.path);
            if ((name === "obsidian.vault.list" || name === "list_vault_entries") && input.recursive === true
                || name === "obsidian.vault.move" || name === "obsidian.vault.trash" || name === "vault_trash") {
                const strict = name !== "obsidian.vault.list" && name !== "list_vault_entries";
                for (const bound of collectObsidianResourceTree(host, target, true, strict))
                    paths.add(bound.path);
            }
        }
        const ownOutputs = host.sourceRun.runSourceSelection?.scope === "web" ? [...paths].filter(path =>
            host.sourceRun.isCreatedResourcePathAllowed(path)) : [];
        const reads: TaskSourceReadPlan["reads"] = [...paths].filter(path => !ownOutputs.includes(path))
            .map(path => ({ kind: "note" as const, noteId: host.sourceRun.resolveNoteId(path)! }));
        if (reads.some(read => read.kind === "note" && !read.noteId))
            return undefined;
        let outputTargetPaths: string[] | undefined;
        if (typeof input.path === "string") {
            outputTargetPaths = name === "obsidian.vault.mkdir" || name === "vault_create_folder"
                ? input.path.split("/").map((_, index, segments) => segments.slice(0, index + 1).join("/"))
                : [input.path];
        }
        else if (typeof input.to === "string") {
            const source = resolve(host, input.source as ResourceTarget);
            // Native folder moves affect every descendant, including attachments.
            // Admit the corresponding future paths before the original guard exists.
            outputTargetPaths = [...paths].map(path => input.to + path.slice(source.path.length));
        }
        const newOutput = name === "obsidian.vault.createText" || name === "obsidian.vault.mkdir" || name === "vault_create_folder";
        if (outputTargetPaths?.some(path => !host.sourceRun.isResourceOutputPathAllowed(path, newOutput)))
            return undefined;
        if (ownOutputs.length) outputTargetPaths = [...new Set([...(outputTargetPaths ?? []), ...ownOutputs])];
        return { reads, ...(outputTargetPaths ? { outputTargetPaths } : {}) };
    }
    catch {
        return undefined;
    }
}
export async function executeObsidianSdkMethod(host: ObsidianSdkHost, name: ObsidianSdkMethodName, raw: unknown): Promise<SdkResult<unknown>> {
    try {
        const input = validateObsidianSdkInput(name, raw);
        if (host.sourceRun.runSourceSelection?.scope === "web" && name.startsWith("obsidian.metadata."))
            return fail("source_excluded", "Metadata cache is not a verified observation of this request's output.");
        switch (name) {
            case "obsidian.vault.list": return await list(host, input);
            case "obsidian.vault.readText": return await readText(host, input);
            case "obsidian.vault.readBinary": return await readBinary(host, input);
            case "obsidian.metadata.inspect": return await inspect(host, input);
            case "obsidian.metadata.links": return await links(host, input);
            case "obsidian.metadata.resolveLink": return await resolveLink(host, input);
            case "obsidian.workspace.getContext": return await workspaceContext(host, input);
            default: return fail("capability_unavailable", "This effect must be executed by the bound Operations owner.");
        }
    }
    catch (error) {
        if (host.signal?.aborted)
            throw error;
        return fail(error instanceof SdkFailure ? error.code : "fs_error", error instanceof Error ? error.message : String(error));
    }
}

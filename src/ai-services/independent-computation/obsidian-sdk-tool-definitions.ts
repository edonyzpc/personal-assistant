import type { AgentCapability } from "../capability-types";
import type { CapabilityRegistry } from "../capability-registry";
import type { ChatToolDefinition, ChatToolInputSchemaProperty } from "../chat-tool-types";
import type { ChatToolName, SourceRecord } from "../chat-types";
import { createChatToolCapability } from "../capability-adapter";
import { completeInputLineage, sourceRecordsInputLineage } from "../input-lineage";
import { createOperationsStatusTool, type OperationsStatusHost } from "../operations-status-tool";
import {
    CACHE_FIELDS,
    executeObsidianSdkMethod,
    validateObsidianSdkInput,
    type ObsidianSdkMethodName,
    type SdkResult,
} from "./obsidian-resource-sdk";

const target: ChatToolInputSchemaProperty = {
    type: "object",
    oneOf: [
        { properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
        { properties: { resourceRef: { type: "string" } }, required: ["resourceRef"], additionalProperties: false },
    ],
    description: "Exactly one vault-relative path or a live resourceRef returned in this run.",
};
const cursor: ChatToolInputSchemaProperty = { type: "string", description: "The unchanged nextCursor from the same query and snapshot." };
const sdkResultGuidance = [
    "Obsidian SDK results are SdkResult: success is `{ok:true,value}`; failure is ",
    "`{ok:false,value?,error:{code,message,executionState?,recovery?}}`. Inspect `ok` before using `value`.",
].join("");
const metadataLinksReturnGuidance = [
    "Read `error.code` and `error.message` when `ok:false`; optional `value` does not turn the failure into proof that no links exist.",
    "An available result contains `path`, `resourceRef`, `source`, `entries`, `range`, and `coverage`; rows are `value.entries`, not `value.links` or `value.unresolved`.",
    "Outgoing rows contain `link` and `state`: resolved rows use `target`; unresolved and restricted rows do not promise `target`; non-restricted rows retain actual subpath/cache fields.",
    "A resolved outgoing row has direction `value.path → entry.target`; an incoming row has direction `entry.source → value.path`, where `entry.target` is the queried note.",
    "A's outgoing row to B and B's incoming row with source A can be two views of the same A → B edge; neither proves B → A, and `resolved` means the target was resolved, not that the notes link to each other.",
    "Incoming rows are native resolved counters with `source`, `target`, `count`, and `state: resolved`; they do not enumerate all unresolved incoming links.",
    "`source.cacheState` unknown or not_applicable may omit entries; unknown, not_applicable, or absent entries are not confirmed no-links observations.",
    "A complete empty cache observation requires source.cacheState available, coverage complete, and entries []; restricted or partial empty pages remain incomplete observations.",
    "`coverage` `restricted` may still return entries, while `partial` denotes a page boundary;",
    "`range.start` and `range.end` are the current page bounds, `range.total` is the size of this query's row collection (not a whole-vault relationship total), and `nextCursor` indicates another page that may be read only if the task needs it with the same query's existing cursor; absence of `nextCursor` alone does not prove complete coverage.",
    "`source.sourceVersion: unknown` only means the cache version cannot be proven; it does not imply `cacheState` unknown and is not a text-write version.",
].join(" ");
const metadataInspectReturnGuidance = [
    "`fields` selects cached fields: omitted selects every supported field, while an explicit empty array selects zero fields.",
    "`tags` contains body TagCache rows and is not merged with `frontmatter` tags; document properties remain under `frontmatter`.",
    "An available result places rows in `value.entries`; array cache fields produce `{field,value}` rows, and object cache fields produce `{field,key,value}` rows.",
    "A `frontmatter.tags` value is returned as `{field:\"frontmatter\",key:\"tags\",value}` with its original value and type.",
    "Available, complete coverage, and `entries: []` means only the selected fields produced no rows in this cache observation; it does not prove unselected fields, saved text, or the vault have no metadata.",
    "`range.total` counts rows produced by the selected fields; `partial` and `nextCursor` retain the existing page contract.",
    "`source.cacheState` unknown or not_applicable, or absent entries, is not a confirmed empty observation.",
    "`source.sourceVersion: unknown` only means the cache version cannot be proven; it does not imply cacheState unknown and is not a text-write version.",
].join(" ");

interface ReadDefinition {
    name: ObsidianSdkMethodName;
    description: string;
    properties: Record<string, ChatToolInputSchemaProperty>;
    required: string[];
    plannerGuidance?: string;
}

const reads: ReadDefinition[] = [
    { name: "obsidian.vault.list", description: "List actual files and folders, including empty folders, within the admitted scope.",
        properties: { target, recursive: { type: "boolean" }, cursor }, required: ["target"] },
    { name: "obsidian.vault.readText", description: "Read exact saved text, with object-bound sourceVersion, readRef and UTF-16 page range. A page can be partial.",
        properties: { target, cursor }, required: ["target"] },
    { name: "obsidian.vault.readBinary", description: "Read actual bytes as Uint8Array, with object-bound version and byte offset/length/total.",
        properties: { target, cursor }, required: ["target"] },
    { name: "obsidian.metadata.inspect", description: "Inspect supported cached metadata; unknown cache or version is distinct from empty metadata.",
        properties: { target, fields: { type: "array", items: { type: "string", enum: [...CACHE_FIELDS] } }, cursor }, required: ["target"],
        plannerGuidance: metadataInspectReturnGuidance },
    { name: "obsidian.metadata.links", description: "Inspect outgoing or incoming links, their admitted destinations, unresolved items and cache coverage.",
        properties: { target, direction: { type: "string", enum: ["outgoing", "incoming"] }, cursor }, required: ["target", "direction"],
        plannerGuidance: metadataLinksReturnGuidance },
    { name: "obsidian.metadata.resolveLink", description: "Resolve a link in its source file context through Obsidian, retaining subpath and alias when applicable.",
        properties: { source: target, link: { type: "string" } }, required: ["source", "link"] },
    { name: "obsidian.workspace.getContext", description: "Capture one actual view/editor/file and exact buffer/selection snapshot. Saved text and editor text are different sources.",
        properties: { viewId: { type: "string" }, includeText: { type: "boolean" }, cursor }, required: [] },
];

function readTool(definition: ReadDefinition, facadeName?: Extract<ChatToolName, "list_vault_entries">): ChatToolDefinition<unknown, SdkResult<unknown>> {
    const name = facadeName ?? definition.name;
    return {
        name,
        ...(facadeName ? {} : { sdkOnly: true }),
        ...(definition.name === "obsidian.vault.readBinary" ? { binaryResult: true } : {}),
        description: definition.description,
        inputSchema: { type: "object", properties: definition.properties, required: definition.required, additionalProperties: false },
        plannerGuidance: [sdkResultGuidance,
            "A cursor or reference does not grant access.",
            "Use sourceVersion directly as replaceText.expectedVersion; cache metadata is not a write version.",
            ...(definition.plannerGuidance ? [definition.plannerGuidance] : [])],
        permission: "read-only", cost: "free", outputBudgetChars: 2_000_000,
        requiresConfirmation: false, failureBehavior: "recoverable", retrySafety: "read_only",
        statusMessageText: "Reading vault resources", sourceBoundary: "vault",
        statusMessage: () => "Reading vault resources",
        validateInput: raw => validateObsidianSdkInput(definition.name, raw),
        execute: async (input, context) => {
            const admittedPaths = new Set<string>();
            const admittedIdentities = new Map<string, string>();
            const sdkHost = context.obsidianSdkHost;
            if (!sdkHost) {
                return { ok: false, tool: name, inputSummary: name, content: null, sources: [],
                    error: "The current request has no Obsidian SDK binding.", executionState: "not_started" };
            }
            const sourceEpoch = sdkHost.sourceRun.currentNotesObservationEpoch();
            const result = await executeObsidianSdkMethod({
                ...sdkHost, guard: context.taskSourceReadGuard, signal: context.signal,
                onReadAdmitted: path => {
                    // A verified output carries its original request ancestry;
                    // reading it back does not introduce a private Vault source.
                    if (sdkHost.sourceRun.runSourceSelection?.scope === "web"
                        && sdkHost.sourceRun.isCreatedResourcePathAllowed(path)) return;
                    admittedPaths.add(path);
                    const identity = sdkHost.sourceRun.resolveResourceIdentity({ path });
                    if (identity) admittedIdentities.set(path, identity.resourceRef);
                },
            }, definition.name, input);
            const sourceRecords: SourceRecord[] = [...admittedPaths].filter(Boolean).map(path => ({
                kind: "context-used", sourceBoundary: "vault", path,
                resourceRef: admittedIdentities.get(path),
                dedupKey: `sdk:${name}:${admittedIdentities.get(path) ?? path}`, citationEligible: true,
            }));
            return {
                // SDK transport delivers the admitted SdkResult, including method
                // failures. The direct tool facade keeps its original failure status.
                ok: facadeName ? result.ok : true, tool: name, inputSummary: name, content: result,
                sources: [...admittedPaths].filter(Boolean).map(path => ({ path })), sourceRecords,
                inputLineage: sourceRecords.length ? sourceRecordsInputLineage(sourceRecords)
                    : admittedPaths.has("") ? sdkHost.sourceRun.captureRunNotesObservationLineage("vault", sourceEpoch)
                        : completeInputLineage(),
                ...(result.ok ? {} : { error: result.error.message,
                    executionState: result.error.executionState ?? "not_started" }),
            };
        },
    };
}

export function createObsidianSdkReadCapabilities(): AgentCapability[] {
    return [...reads.map(definition => readTool(definition)), readTool(reads[0], "list_vault_entries")]
        .map(definition => createChatToolCapability(definition, { providerId: "core-tools" }));
}

export function createObsidianSdkStatusCapability(host: OperationsStatusHost): AgentCapability {
    const original = createOperationsStatusTool(host);
    return createChatToolCapability({
        ...original, name: "obsidian.operations.getStatus", sdkOnly: true,
        execute: async (input, context) => {
            const result = await original.execute(input, context);
            return { ...result, tool: "obsidian.operations.getStatus", content: result.ok
                ? { ok: true, value: result.content }
                : { ok: false, value: result.content, error: { code: "owner_unavailable", message: result.error ?? "Operation status unavailable." } } };
        },
    }, { providerId: "operations-status" });
}

/** Disclosure is derived from the exact currently bound registry instances. */
export function attachObsidianSdkGuidance(capability: AgentCapability, registry: CapabilityRegistry): void {
    const original = capability.toRegistryDefinition.bind(capability);
    capability.toRegistryDefinition = () => {
        const definition = original();
        return {
            ...definition,
            plannerGuidance: [...definition.plannerGuidance,
                "obsidian.* and tools.* are parallel top-level roots. The Host admits both dynamic call paths: bound obsidian methods return Promise<SdkResult<T>>, while tools.* preserves each existing tool's own result. Parent preview forces child effects to preview.",
                sdkResultGuidance,
                "Fixed pure libraries in this VM: markdownit (markdown-it 15.0.3), jsyaml (js-yaml 3.15.2; safeLoad/safeDump). No arbitrary import or host object access.",
                ...registry.listCapabilities().filter(candidate => candidate.sdkOnly && registry.canExecute(candidate.name).allowed)
                    .map(candidate => {
                        const method = candidate.toRegistryDefinition();
                        const methodGuidance = method.plannerGuidance.filter(guidance => guidance !== sdkResultGuidance);
                        return `${candidate.name}: ${method.description} Input: ${JSON.stringify(method.inputSchema)}`
                            + `${methodGuidance.length ? ` Guidance: ${methodGuidance.join(" ")}` : ""}`;
                    })],
        };
    };
}

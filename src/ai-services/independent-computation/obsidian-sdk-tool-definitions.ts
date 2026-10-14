import type { AgentCapability } from "../capability-types";
import type { CapabilityRegistry } from "../capability-registry";
import type { ChatToolDefinition, ChatToolInputSchemaProperty } from "../chat-tool-types";
import type { ChatToolName, SourceRecord } from "../chat-types";
import { createChatToolCapability } from "../capability-adapter";
import { completeInputLineage, sourceRecordsInputLineage } from "../input-lineage";
import { createOperationsStatusTool, type OperationsStatusHost } from "../operations-status-tool";
import {
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

interface ReadDefinition {
    name: ObsidianSdkMethodName;
    description: string;
    properties: Record<string, ChatToolInputSchemaProperty>;
    required: string[];
}

const reads: ReadDefinition[] = [
    { name: "obsidian.vault.list", description: "List actual files and folders, including empty folders, within the admitted scope.",
        properties: { target, recursive: { type: "boolean" }, cursor }, required: ["target"] },
    { name: "obsidian.vault.readText", description: "Read exact saved text, with object-bound sourceVersion, readRef and UTF-16 page range. A page can be partial.",
        properties: { target, cursor }, required: ["target"] },
    { name: "obsidian.vault.readBinary", description: "Read actual bytes as Uint8Array, with object-bound version and byte offset/length/total.",
        properties: { target, cursor }, required: ["target"] },
    { name: "obsidian.metadata.inspect", description: "Inspect supported cached metadata; unknown cache or version is distinct from empty metadata.",
        properties: { target, fields: { type: "array", items: { type: "string" } }, cursor }, required: ["target"] },
    { name: "obsidian.metadata.links", description: "Inspect outgoing or incoming links, their admitted destinations, unresolved items and cache coverage.",
        properties: { target, direction: { type: "string", enum: ["outgoing", "incoming"] }, cursor }, required: ["target", "direction"] },
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
        plannerGuidance: ["Every result is SdkResult: inspect ok before using value. A cursor or reference does not grant access.",
            "Use sourceVersion directly as replaceText.expectedVersion; cache metadata is not a write version."],
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
                "Bound obsidian methods return Promise<SdkResult<T>>. tools.* preserves each existing tool's own result. Parent preview forces child effects to preview.",
                "Fixed pure libraries in this VM: markdownit (markdown-it 15.0.2), jsyaml (js-yaml 3.15.2; safeLoad/safeDump). No arbitrary import or host object access.",
                ...registry.listCapabilities().filter(candidate => candidate.sdkOnly && registry.canExecute(candidate.name).allowed)
                    .map(candidate => {
                        const method = candidate.toRegistryDefinition();
                        return `${candidate.name}: ${method.description} Input: ${JSON.stringify(method.inputSchema)}`;
                    })],
        };
    };
}

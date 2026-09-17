import type { ChatMessage, PaAgentMessage } from "./chat-types";
import type { MemoryManagementOperation } from "./memory-management-types";

export const MEMORY_MANAGEMENT_CONTRACT_VERSION = 1 as const;

export interface MemoryManagementEvidenceItem {
    index: number;
    identity: string;
    outputDigest: string;
}

export interface MemoryManagementEvidence {
    schemaVersion: 1;
    purpose: "memory_management";
    observationId: string;
    tool: "get_memory_status" | "query_memories" | "get_memory_usage" | "manage_memory" | "get_vault_insights" | "query_saved_insights";
    operation: MemoryManagementOperation;
    stateFingerprint: string;
    contentFingerprint: string;
    aggregateFingerprint: string;
    request: Record<string, string>;
    items: MemoryManagementEvidenceItem[];
}

export type MemoryManagementEvidenceParseResult =
    | { ok: true; evidence: MemoryManagementEvidence }
    | { ok: false; reason: string };

export interface MemoryManagementPhysicalBinding {
    prepare(signal?: AbortSignal | null): Promise<void>;
    assertCurrent(): void;
}

export interface MemoryManagementProjection {
    transcript: PaAgentMessage[];
    history: ChatMessage[];
    hasContractMaterial: boolean;
    binding: MemoryManagementPhysicalBinding;
}

const FINGERPRINT_MAX_CHARS = 128;
const IDENTITY_MAX_CHARS = 256;
const MAX_EVIDENCE_ITEMS = 20;

export function stableMemoryJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableMemoryJson).join(",")}]`;
    if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
        .filter(key => record[key] !== undefined)
        .sort()
        .map(key => `${JSON.stringify(key)}:${stableMemoryJson(record[key])}`)
        .join(",")}}`;
}

export function boundedMemoryFingerprint(value: unknown): string {
    let hash = 2166136261;
    const text = stableMemoryJson(value);
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

function itemIdentity(item: Record<string, unknown>): string {
    return stableMemoryJson({
        id: item.id,
        entityType: item.entityType,
        claimId: item.claimId,
        revisionId: item.revisionId,
        legacyFingerprint: item.legacyFingerprint,
        conversationId: item.conversationId,
        turnId: item.turnId,
        turnIndex: item.turnIndex,
        evidenceLevel: item.evidenceLevel,
        disclosure: item.disclosure,
        writingVersionId: item.writingVersionId,
    });
}

export function memoryManagementItems(content: unknown): MemoryManagementEvidenceItem[] {
    if (!content || typeof content !== "object" || Array.isArray(content)) {
        return [{ index: 0, identity: "invalid-content", outputDigest: boundedMemoryFingerprint(content) }];
    }
    const record = content as Record<string, unknown>;
    const collection = record.kind === "memory-usage"
        ? record.records
        : record.kind === "memory-query"
            ? record.items
            : undefined;
    if (!Array.isArray(collection)) {
        return [{
            index: 0,
            identity: record.kind === "memory-status" ? "memory-status" : "memory-management",
            outputDigest: boundedMemoryFingerprint(content),
        }];
    }
    return collection.slice(0, MAX_EVIDENCE_ITEMS).map((value, index) => {
        const item = value && typeof value === "object" && !Array.isArray(value)
            ? value as Record<string, unknown>
            : { value };
        return {
            index,
            identity: itemIdentity(item).slice(0, IDENTITY_MAX_CHARS),
            outputDigest: boundedMemoryFingerprint(value),
        };
    });
}

export function memoryManagementAggregateFingerprint(content: unknown): string {
    if (!content || typeof content !== "object" || Array.isArray(content)) return boundedMemoryFingerprint(content);
    const record = content as Record<string, unknown>;
    if (record.kind === "memory-query") {
        return boundedMemoryFingerprint({
            matchCount: record.matchCount,
            matchCountKind: record.matchCountKind,
            coverage: record.coverage,
            nextCursor: record.nextCursor,
        });
    }
    if (record.kind === "memory-usage") {
        return boundedMemoryFingerprint({
            evidenceLevel: record.evidenceLevel,
            records: record.records,
        });
    }
    if (record.kind === "memory-action") {
        return boundedMemoryFingerprint({
            action: record.action,
            status: record.status,
            reason: record.reason,
            claimId: record.claimId,
            revisionId: record.revisionId,
            eventId: record.eventId,
            queueItemId: record.queueItemId,
            effectiveUse: record.effectiveUse,
        });
    }
    return boundedMemoryFingerprint({
        contentAvailable: record.contentAvailable,
        recordCount: record.recordCount,
        recordCountKind: record.recordCountKind,
        coverage: record.coverage,
    });
}

export function buildMemoryManagementEvidence(input: {
    tool: MemoryManagementEvidence["tool"];
    operation: MemoryManagementOperation;
    stateFingerprint: string;
    request?: Record<string, string>;
    content: unknown;
}): MemoryManagementEvidence {
    const contentFingerprint = boundedMemoryFingerprint(input.content);
    const items = memoryManagementItems(input.content);
    return {
        schemaVersion: 1,
        purpose: "memory_management",
        observationId: `${input.tool}:${input.stateFingerprint}:${contentFingerprint}`,
        tool: input.tool,
        operation: input.operation,
        stateFingerprint: input.stateFingerprint,
        contentFingerprint,
        aggregateFingerprint: memoryManagementAggregateFingerprint(input.content),
        request: Object.fromEntries(Object.entries(input.request ?? {}).map(([key, value]) => [key, String(value)])),
        items,
    };
}

export function parseMemoryManagementEvidence(value: unknown): MemoryManagementEvidenceParseResult {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { ok: false, reason: "Management evidence must be an object." };
    }
    const record = value as Record<string, unknown>;
    const expectedKeys = new Set([
        "schemaVersion", "purpose", "observationId", "tool", "operation", "stateFingerprint",
        "contentFingerprint", "aggregateFingerprint", "request", "items",
    ]);
    if (Object.keys(record).some(key => !expectedKeys.has(key))) {
        return { ok: false, reason: "Management evidence contains unknown fields." };
    }
    const tools = new Set<MemoryManagementEvidence["tool"]>([
        "get_memory_status", "query_memories", "get_memory_usage", "manage_memory", "get_vault_insights", "query_saved_insights",
    ]);
    const operations = new Set<MemoryManagementOperation>(["status", "query", "usage", "action", "vault_insights", "saved_insights"]);
    if (record.schemaVersion !== 1 || record.purpose !== "memory_management") {
        return { ok: false, reason: "Invalid management evidence contract." };
    }
    if (!tools.has(record.tool as MemoryManagementEvidence["tool"])) {
        return { ok: false, reason: "Invalid management evidence tool." };
    }
    if (!operations.has(record.operation as MemoryManagementOperation)) {
        return { ok: false, reason: "Invalid management evidence operation." };
    }
    if (!record.request || typeof record.request !== "object" || Array.isArray(record.request)) {
        return { ok: false, reason: "Management evidence request is missing." };
    }
    if (Object.entries(record.request).some(([, value]) => typeof value !== "string")) {
        return { ok: false, reason: "Management evidence request is invalid." };
    }
    for (const key of ["observationId", "stateFingerprint", "contentFingerprint", "aggregateFingerprint"] as const) {
        if (typeof record[key] !== "string" || !record[key]) {
            return { ok: false, reason: `Management evidence ${key} is missing.` };
        }
    }
    const fingerprints = [record.stateFingerprint, record.contentFingerprint, record.aggregateFingerprint];
    if (fingerprints.some(fingerprint => (
        typeof fingerprint !== "string"
        || fingerprint.length === 0
        || fingerprint.length > FINGERPRINT_MAX_CHARS
    ))) {
        return { ok: false, reason: "Management evidence fingerprint is invalid." };
    }
    if (typeof record.observationId !== "string" || record.observationId.length > 512) {
        return { ok: false, reason: "Management evidence observation id is invalid." };
    }
    if (!Array.isArray(record.items) || record.items.length > MAX_EVIDENCE_ITEMS) {
        return { ok: false, reason: "Management evidence items are invalid." };
    }
    const seen = new Set<number>();
    const items: MemoryManagementEvidenceItem[] = [];
    for (const raw of record.items) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            return { ok: false, reason: "Management evidence item is invalid." };
        }
        const item = raw as Record<string, unknown>;
        if (Object.keys(item).some(key => !["index", "identity", "outputDigest"].includes(key))
            || !Number.isSafeInteger(item.index) || (item.index as number) < 0
            || (item.index as number) >= record.items.length
            || typeof item.identity !== "string" || !item.identity || item.identity.length > IDENTITY_MAX_CHARS
            || typeof item.outputDigest !== "string" || !/^[0-9a-f]{8}$/.test(item.outputDigest)) {
            return { ok: false, reason: "Management evidence item is invalid." };
        }
        if (seen.has(item.index as number)) return { ok: false, reason: "Duplicate management evidence item." };
        seen.add(item.index as number);
        items.push({
            index: item.index as number,
            identity: item.identity,
            outputDigest: item.outputDigest,
        });
    }
    return {
        ok: true,
        evidence: {
            schemaVersion: 1,
            purpose: "memory_management",
            observationId: record.observationId as string,
            tool: record.tool as MemoryManagementEvidence["tool"],
            operation: record.operation as MemoryManagementOperation,
            stateFingerprint: record.stateFingerprint as string,
            contentFingerprint: record.contentFingerprint as string,
            aggregateFingerprint: record.aggregateFingerprint as string,
            request: record.request as Record<string, string>,
            items,
        },
    };
}

export function cloneMemoryManagementEvidence(
    value: MemoryManagementEvidence,
): MemoryManagementEvidence {
    const parsed = parseMemoryManagementEvidence(value);
    if (!parsed.ok) throw new Error(parsed.reason);
    return {
        ...parsed.evidence,
        request: { ...parsed.evidence.request },
        items: parsed.evidence.items.map(item => ({ ...item })),
    };
}

interface ObservationLike {
    ready: boolean;
    stateFingerprint?: string;
    validItemIndexes?: number[];
    aggregateCurrent?: boolean;
    projectedContent?: unknown;
}

interface ManagementFact {
    evidence: MemoryManagementEvidence;
    observation: Record<string, unknown>;
    stateFingerprint?: string;
    hostProjection: boolean;
}

export async function projectMemoryManagementObservations(options: {
    transcript: readonly PaAgentMessage[];
    prepareObservation: (evidence: MemoryManagementEvidence) => Promise<ObservationLike>;
}): Promise<PaAgentMessage[]> {
    const projection = await prepareMemoryManagementProjection({
        transcript: options.transcript,
        prepareObservation: options.prepareObservation,
    });
    return projection.transcript;
}

export async function prepareMemoryManagementProjection(options: {
    transcript?: readonly PaAgentMessage[];
    history?: readonly ChatMessage[];
    prepareObservation: (evidence: MemoryManagementEvidence) => Promise<ObservationLike & { guard?: { assertCurrent(): void } }>;
    portAvailable?: boolean;
}): Promise<MemoryManagementProjection> {
    const transcript = (options.transcript ?? []).map(cloneProjectionMessage);
    const history = (options.history ?? []).map(cloneProjectionHistoryMessage);
    const toolContracts = transcript.filter((message): message is Extract<PaAgentMessage, { role: "toolResult" }> =>
        message.role === "toolResult" && message.content.metadata?.memoryManagementContractVersion === 1);
    const assistantContracts = transcript.filter(message => (
        message.role === "assistant" && managementAssistantState(message).contract
    ));
    const hasHistoryContracts = history.some(message => historyManagementState(message).contract);
    const hasContractMaterial = toolContracts.length > 0 || assistantContracts.length > 0 || hasHistoryContracts;
    if (hasContractMaterial && options.portAvailable === false) {
        throw new Error("Memory management revalidation is unavailable.");
    }
    const guards = new Set<{ assertCurrent(): void }>();
    await projectTranscriptContracts(toolContracts, assistantContracts, options.prepareObservation, guards);
    await projectHistoryContracts(history, options.prepareObservation, guards);
    const fixedPayload = stableMemoryJson({ transcript, history });
    return {
        transcript,
        history,
        hasContractMaterial,
        binding: {
            async prepare(signal) {
                if (signal?.aborted) throw new Error("Aborted");
                const nextGuards = new Set<{ assertCurrent(): void }>();
                const nextTranscript = transcript.map(cloneProjectionMessage);
                const nextHistory = [...history];
                const nextToolContracts = nextTranscript.filter((message): message is Extract<PaAgentMessage, { role: "toolResult" }> =>
                    message.role === "toolResult" && message.content.metadata?.memoryManagementContractVersion === 1);
                const nextAssistantContracts = nextTranscript.filter(message => (
                    message.role === "assistant" && managementAssistantState(message).contract
                ));
                await projectTranscriptContracts(nextToolContracts, nextAssistantContracts, options.prepareObservation, nextGuards);
                await projectHistoryContracts(nextHistory, options.prepareObservation, nextGuards);
                if (stableMemoryJson({ transcript: nextTranscript, history: nextHistory }) !== fixedPayload) {
                    throw new Error("Memory management projection changed before dispatch.");
                }
                guards.clear();
                for (const guard of nextGuards) guards.add(guard);
            },
            assertCurrent() {
                for (const guard of guards) guard.assertCurrent();
            },
        },
    };
}

async function projectTranscriptContracts(
    tools: Array<Extract<PaAgentMessage, { role: "toolResult" }>>,
    assistants: PaAgentMessage[],
    prepareObservation: (evidence: MemoryManagementEvidence) => Promise<ObservationLike & { guard?: { assertCurrent(): void } }>,
    guards: Set<{ assertCurrent(): void }>,
): Promise<void> {
    for (const message of tools) {
        const metadata = message.content.metadata ?? {};
        const parsed = parseMemoryManagementEvidence(metadata.memoryManagementEvidence);
        if (!parsed.ok || parsed.evidence.tool !== message.toolName) {
            revokeToolObservation(message);
            continue;
        }
        const observation = await prepareObservation(parsed.evidence);
        if (observation.guard) guards.add(observation.guard);
        if (!projectStructuredObservation(message, parsed.evidence, observation)) {
            revokeToolObservation(message);
        }
    }
    for (const message of assistants) {
        const state = managementAssistantState(message);
        const material = await projectAssistantMaterial(state, prepareObservation, guards);
        if (material.mode === "invalid") {
            revokeAssistantObservation(message);
            continue;
        }
        if (material.mode === "partial") {
            const record = message as unknown as Record<string, unknown>;
            record.content = [{ type: "text", text: structuredFactsText(material.facts) }];
        }
    }
}

async function projectHistoryContracts(
    history: ChatMessage[],
    prepareObservation: (evidence: MemoryManagementEvidence) => Promise<ObservationLike & { guard?: { assertCurrent(): void } }>,
    guards: Set<{ assertCurrent(): void }>,
): Promise<void> {
    for (let index = history.length - 1; index >= 0; index -= 1) {
        const message = history[index];
        if (message.role !== "assistant") continue;
        const state = historyManagementState(message);
        if (!state.contract) continue;
        const material = await projectAssistantMaterial(
            state,
            prepareObservation,
            guards,
            evidence => canonicalObservationFor(message, evidence),
        );
        if (material.mode === "invalid") {
            history.splice(index, 1);
            continue;
        }
        if (material.mode !== "partial") continue;
        message.content = structuredFactsText(material.facts);
        // The old assistant prose and canonical tool transcript cannot be
        // separated by claim. Keep current host-rendered facts only; the
        // adjacent user turn preserves the original request.
        if (message.canonicalTurn) {
            message.canonicalTurn = {
                ...message.canonicalTurn,
                committedFinalText: undefined,
                messages: [],
            };
        }
        for (const fact of material.facts) {
            narrowHistoryEvidence(message, fact);
        }
    }
}

function projectStructuredObservation(
    message: Extract<PaAgentMessage, { role: "toolResult" }>,
    evidence: MemoryManagementEvidence,
    observation: ObservationLike,
): boolean {
    if (!observation.ready) return false;
    const retainedItems = retainedEvidenceItems(evidence, observation);
    if (retainedItems.length === 0 && !(evidence.items.length === 0 && observation.aggregateCurrent === true)) return false;
    const allItemsCurrent = retainedItems.length === evidence.items.length;
    if (allItemsCurrent && observation.aggregateCurrent !== false) return true;
    let envelope: { tool?: unknown; status?: unknown; input?: unknown; observation?: Record<string, unknown> };
    try {
        envelope = JSON.parse(message.content.promptText) as typeof envelope;
    } catch {
        return false;
    }
    if (envelope.tool !== evidence.tool || envelope.status !== "ok" || !envelope.observation) return false;
    const projectedObservation = structuredObservationFact(
        evidence,
        observation,
        retainedItems,
        envelope.observation,
    );
    if (!projectedObservation) return false;
    const replacementEvidence = narrowedEvidence(evidence, observation, projectedObservation);
    envelope.observation = projectedObservation;
    message.content.promptText = JSON.stringify({
        tool: evidence.tool,
        status: "ok",
        input: envelope.input,
        observation: projectedObservation,
    });
    message.content.metadata = {
        ...message.content.metadata,
        ...(replacementEvidence ? { memoryManagementEvidence: replacementEvidence } : {}),
        memoryManagementEvidencePartial: true,
    };
    return true;
}

function retainedEvidenceItems(
    evidence: MemoryManagementEvidence,
    observation: ObservationLike,
): MemoryManagementEvidenceItem[] {
    const retained = new Set(observation.validItemIndexes ?? evidence.items.map(item => item.index));
    return evidence.items.filter(item => retained.has(item.index));
}

async function projectAssistantMaterial(
    state: { invalid: boolean; hasEvidenceArray: boolean; evidence: unknown[] },
    prepareObservation: (evidence: MemoryManagementEvidence) => Promise<ObservationLike & { guard?: { assertCurrent(): void } }>,
    guards: Set<{ assertCurrent(): void }>,
    fallbackForEvidence?: (evidence: MemoryManagementEvidence) => Record<string, unknown> | undefined,
): Promise<{ mode: "original" } | { mode: "invalid" } | { mode: "partial"; facts: ManagementFact[] }> {
    const parsed = state.evidence.map(value => parseMemoryManagementEvidence(value));
    if (state.invalid || !state.hasEvidenceArray || parsed.length === 0 || parsed.some(item => !item.ok)) {
        return { mode: "invalid" };
    }
    const facts: ManagementFact[] = [];
    let validEvidence = 0;
    let completeEvidence = 0;
    for (const item of parsed) {
        if (!item.ok) continue;
        let observation: ObservationLike & { guard?: { assertCurrent(): void } };
        try {
            observation = await prepareObservation(item.evidence);
        } catch {
            continue;
        }
        if (observation.guard) guards.add(observation.guard);
        const retained = retainedEvidenceItems(item.evidence, observation);
        const hasValidFact = retained.length > 0
            || (item.evidence.items.length === 0 && observation.aggregateCurrent === true);
        if (!observation.ready || !hasValidFact) continue;
        validEvidence += 1;
        const complete = retained.length === item.evidence.items.length
            && observation.aggregateCurrent === true;
        if (complete) {
            completeEvidence += 1;
        }
        const fact = complete
            ? completeObservationFact(observation, fallbackForEvidence?.(item.evidence))
            : structuredObservationFact(
                item.evidence,
                observation,
                retained,
                fallbackForEvidence?.(item.evidence),
            );
        if (fact === undefined) continue;
        facts.push({
            evidence: item.evidence,
            observation: fact,
            stateFingerprint: observation.stateFingerprint,
            hostProjection: observation.projectedContent !== undefined,
        });
    }
    if (validEvidence === 0) return { mode: "invalid" };
    if (validEvidence === parsed.length && completeEvidence === parsed.length) return { mode: "original" };
    return facts.length > 0 ? { mode: "partial", facts } : { mode: "invalid" };
}

function completeObservationFact(
    observation: ObservationLike,
    fallbackObservation?: Record<string, unknown>,
): Record<string, unknown> | undefined {
    return objectObservation(observation.projectedContent) ?? fallbackObservation;
}

function structuredObservationFact(
    evidence: MemoryManagementEvidence,
    observation: ObservationLike,
    retainedItems: MemoryManagementEvidenceItem[],
    fallbackObservation?: Record<string, unknown>,
): Record<string, unknown> | undefined {
    if (evidence.operation === "query") {
        return queryObservationFact(evidence, observation, retainedItems, fallbackObservation);
    }
    if (evidence.operation === "usage") {
        return usageObservationFact(evidence, observation, retainedItems, fallbackObservation);
    }
    return undefined;
}

function queryObservationFact(
    _evidence: MemoryManagementEvidence,
    observation: ObservationLike,
    retainedItems: MemoryManagementEvidenceItem[],
    fallbackObservation?: Record<string, unknown>,
): Record<string, unknown> | undefined {
    const currentContent = objectObservation(observation.projectedContent);
    const collection = Array.isArray(currentContent?.items) ? currentContent.items : undefined;
    const currentItems = collection === undefined
        ? []
        : memoryManagementItems({ kind: "memory-query", items: collection });
    const fallbackItems = Array.isArray(fallbackObservation?.items) ? fallbackObservation.items : undefined;
    const fallbackIdentities = fallbackItems === undefined
        ? []
        : memoryManagementItems({ kind: "memory-query", items: fallbackItems });
    const projectedItems = retainedItems.flatMap(item => {
        const current = collection === undefined
            ? undefined
            : collection[currentItems.findIndex(candidate => candidate.identity === item.identity)];
        const identityFallback = fallbackItems?.[fallbackIdentities.findIndex(
            candidate => candidate.identity === item.identity,
        )];
        const fallback = current ?? identityFallback;
        return fallback === undefined ? [] : [fallback];
    });
    if (projectedItems.length !== retainedItems.length) return undefined;
    const base = { ...(currentContent ?? fallbackObservation ?? {}) };
    delete base.matchCount;
    delete base.matchCountKind;
    delete base.nextCursor;
    return {
        ...base,
        items: projectedItems,
        coverage: {
            state: "partial",
            explanation: "Some Memory records changed; only still-valid records are retained.",
        },
    };
}

function usageObservationFact(
    _evidence: MemoryManagementEvidence,
    observation: ObservationLike,
    retainedItems: MemoryManagementEvidenceItem[],
    fallbackObservation?: Record<string, unknown>,
): Record<string, unknown> | undefined {
    const currentContent = objectObservation(observation.projectedContent);
    const collection = Array.isArray(currentContent?.records) ? currentContent.records : undefined;
    const currentItems = collection === undefined
        ? []
        : memoryManagementItems({ kind: "memory-usage", records: collection });
    const fallbackRecords = Array.isArray(fallbackObservation?.records) ? fallbackObservation.records : undefined;
    const fallbackIdentities = fallbackRecords === undefined
        ? []
        : memoryManagementItems({ kind: "memory-usage", records: fallbackRecords });
    const projectedRecords = retainedItems.flatMap(item => {
        const current = collection === undefined
            ? undefined
            : collection[currentItems.findIndex(candidate => candidate.identity === item.identity)];
        const identityFallback = fallbackRecords?.[fallbackIdentities.findIndex(
            candidate => candidate.identity === item.identity,
        )];
        const fallback = current ?? identityFallback;
        return fallback === undefined ? [] : [fallback];
    });
    if (projectedRecords.length !== retainedItems.length) return undefined;
    return {
        ...(currentContent ?? fallbackObservation ?? {}),
        records: projectedRecords,
    };
}

function objectObservation(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function structuredFactsText(facts: ManagementFact[]): string {
    return JSON.stringify({
        type: "memory_management_facts",
        facts: facts.map(fact => ({
            tool: fact.evidence.tool,
            operation: fact.evidence.operation,
            observation: fact.observation,
        })),
    });
}

function narrowedEvidence(
    evidence: MemoryManagementEvidence,
    observation: ObservationLike,
    projectedObservation: Record<string, unknown>,
): MemoryManagementEvidence | undefined {
    if (!observation.projectedContent || typeof observation.stateFingerprint !== "string") return undefined;
    try {
        return cloneMemoryManagementEvidence(buildMemoryManagementEvidence({
            tool: evidence.tool,
            operation: evidence.operation,
            stateFingerprint: observation.stateFingerprint,
            request: evidence.request,
            content: projectedObservation,
        }));
    } catch {
        return undefined;
    }
}

function narrowHistoryEvidence(message: ChatMessage, fact: ManagementFact): void {
    const replacement = fact.hostProjection && fact.stateFingerprint !== undefined
        ? narrowedEvidence(fact.evidence, {
            ready: true,
            stateFingerprint: fact.stateFingerprint,
            projectedContent: fact.observation,
        }, fact.observation)
        : undefined;
    if (!replacement) return;
    if (message.memoryMetadata?.memoryManagementEvidence) {
        message.memoryMetadata.memoryManagementEvidence = message
            .memoryMetadata.memoryManagementEvidence
            .map(value => value.observationId === fact.evidence.observationId ? replacement : value);
    }
    if (message.canonicalTurn?.memoryManagementEvidence) {
        message.canonicalTurn.memoryManagementEvidence = message
            .canonicalTurn.memoryManagementEvidence
            .map(value => value.observationId === fact.evidence.observationId ? replacement : value);
    }
}

function managementAssistantState(message: PaAgentMessage): {
    contract: boolean;
    hasEvidenceArray: boolean;
    invalid: boolean;
    evidence: unknown[];
} {
    if (message.role !== "assistant") return { contract: false, hasEvidenceArray: false, invalid: false, evidence: [] };
    const record = message as unknown as Record<string, unknown>;
    return evidenceStateRecord(record);
}

function historyManagementState(message: ChatMessage): {
    contract: boolean;
    hasEvidenceArray: boolean;
    invalid: boolean;
    evidence: unknown[];
} {
    const metadata = (message.memoryMetadata ?? message.canonicalTurn) as Record<string, unknown> | undefined;
    return evidenceStateRecord(metadata ?? {});
}

function evidenceStateRecord(record: Record<string, unknown>): {
    contract: boolean;
    hasEvidenceArray: boolean;
    invalid: boolean;
    evidence: unknown[];
} {
    return {
        contract: record.memoryManagementContractVersion === 1 || record.memoryManagementEvidenceInvalid === true,
        hasEvidenceArray: Array.isArray(record.memoryManagementEvidence),
        invalid: record.memoryManagementEvidenceInvalid === true,
        evidence: Array.isArray(record.memoryManagementEvidence) ? record.memoryManagementEvidence : [],
    };
}

function canonicalObservationFor(
    message: ChatMessage,
    evidence: MemoryManagementEvidence,
): Record<string, unknown> | undefined {
    const toolMessage = message.canonicalTurn?.messages.find(candidate =>
        candidate.role === "toolResult" && candidate.toolName === evidence.tool);
    if (toolMessage?.role !== "toolResult") return undefined;
    try {
        const envelope = JSON.parse(toolMessage.content.promptText) as {
            tool?: unknown;
            status?: unknown;
            observation?: Record<string, unknown>;
        };
        return envelope.tool === evidence.tool && envelope.status === "ok"
            ? envelope.observation
            : undefined;
    } catch {
        return undefined;
    }
}

function cloneProjectionMessage(message: PaAgentMessage): PaAgentMessage {
    if (message.role === "toolResult") {
        return {
            ...message,
            content: {
                ...message.content,
                sourceRecords: message.content.sourceRecords?.map(record => ({ ...record })),
                contextUsed: message.content.contextUsed?.map(item => ({ ...item })),
                metadata: message.content.metadata ? { ...message.content.metadata } : undefined,
            },
        };
    }
    if (message.role === "assistant") {
        return {
            ...message,
            content: message.content.map(part => ({ ...part })),
        } as PaAgentMessage;
    }
    return {
        ...message,
        ...(Array.isArray(message.content) ? { content: message.content.map(part => ({ ...part })) } : {}),
    } as PaAgentMessage;
}

function cloneProjectionHistoryMessage(message: ChatMessage): ChatMessage {
    return {
        ...message,
        ...(message.memoryMetadata ? { memoryMetadata: cloneHistoryMetadata(message.memoryMetadata) } : {}),
        ...(message.canonicalTurn ? {
            canonicalTurn: {
                ...message.canonicalTurn,
                memoryManagementEvidence: message.canonicalTurn.memoryManagementEvidence
                    ?.map(cloneParsedEvidence),
                messages: message.canonicalTurn.messages.map(cloneProjectionMessage),
            },
        } : {}),
    };
}

function cloneHistoryMetadata(metadata: ChatMessage["memoryMetadata"]): ChatMessage["memoryMetadata"] {
    if (!metadata) return metadata;
    return {
        ...metadata,
        memoryManagementEvidence: metadata.memoryManagementEvidence?.map(cloneParsedEvidence),
    };
}

function cloneParsedEvidence(value: MemoryManagementEvidence): MemoryManagementEvidence {
    const parsed = parseMemoryManagementEvidence(value);
    return parsed.ok ? cloneMemoryManagementEvidence(parsed.evidence) : value;
}

function revokeToolObservation(message: Extract<PaAgentMessage, { role: "toolResult" }>): void {
    message.content.promptText = JSON.stringify({
        tool: message.toolName,
        status: "unavailable",
        observation: "Memory management evidence is no longer current.",
    });
    message.content.sourceRecords = [];
    message.content.contextUsed = message.content.contextUsed?.map(item => ({
        ...item,
        sources: [],
        citationEligible: false,
        statusOnly: true,
    }));
    message.content.metadata = {
        ...message.content.metadata,
        memoryManagementEvidenceInvalid: true,
        memoryManagementContractVersion: 1,
    };
    delete message.content.metadata.memoryManagementEvidence;
}

function revokeAssistantObservation(message: PaAgentMessage): void {
    if (message.role !== "assistant") return;
    const record = message as unknown as Record<string, unknown>;
    record.content = [{
        type: "text",
        text: "Memory management evidence is no longer current.",
    }];
    record.memoryManagementEvidence = [];
    record.memoryManagementEvidenceInvalid = true;
}

/** Host-owned domain receipts. A tool outcome still records execution, while a
 * fact records what that execution established for the current request. */
export type PaAgentResultFact =
    | { kind: "evidence"; sourceRefs: string[] }
    | { kind: "no_match"; search: "memory" | "metadata" | "snippet" | "web"; observationId?: string }
    | { kind: "unavailable"; capability: string; reason: string }
    | { kind: "transient_failure"; capability: string; recoveryCode: string }
    | { kind: "artifact_ready"; requestId: string; receiptId: string }
    | { kind: "approval_pending"; intentId: string }
    | { kind: "applied"; action: "saved_insight" | "operations" | "writing_save"; receiptId: string }
    | { kind: "partial"; completedRefs: string[]; remainingRefs: string[] }
    | { kind: "unknown"; operationId: string };

export function memoryResultFact(
    observation: Pick<import("./chat-types").MemorySearchObservation, "memoryEvidenceState" | "sources">,
): PaAgentResultFact {
    switch (observation.memoryEvidenceState) {
        case "none": return { kind: "no_match", search: "memory" };
        case "unavailable": return { kind: "unavailable", capability: "search_memory", reason: "memory_evidence_unavailable" };
        case "evidence":
        case "partial": return { kind: "evidence", sourceRefs: observation.sources.map(source => source.path) };
    }
}

export function cloneResultFact(fact: PaAgentResultFact | undefined): PaAgentResultFact | undefined {
    if (!fact) return undefined;
    if (fact.kind === "evidence") return { ...fact, sourceRefs: [...fact.sourceRefs] };
    if (fact.kind === "partial") return { ...fact,
        completedRefs: [...fact.completedRefs], remainingRefs: [...fact.remainingRefs] };
    return { ...fact };
}

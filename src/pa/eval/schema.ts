import { EVAL_CASE_CATEGORIES, type EvalAssertion, type EvalCase } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isCategory(value: unknown): boolean {
    return typeof value === "string" && (EVAL_CASE_CATEGORIES as readonly string[]).includes(value);
}

function parseAssertion(value: unknown): EvalAssertion {
    if (!isRecord(value) || typeof value.type !== "string") {
        throw new Error("Eval assertion must be an object with type");
    }
    if (
        value.type === "must_include_source"
        || value.type === "must_not_include_source"
        || value.type === "source_ref_exists"
    ) {
        if (typeof value.path !== "string" || value.path.length === 0) {
            throw new Error(`${value.type} assertion requires path`);
        }
        return { type: value.type, path: value.path };
    }
    if (value.type === "replay_ref_has_no_excerpt") {
        if (value.path !== undefined && typeof value.path !== "string") {
            throw new Error("replay_ref_has_no_excerpt path must be a string when provided");
        }
        return value.path ? { type: value.type, path: value.path } : { type: value.type };
    }
    if (value.type === "queue_type_allowed" || value.type === "queue_type_rejected") {
        if (typeof value.itemType !== "string" || value.itemType.length === 0) {
            throw new Error(`${value.type} assertion requires itemType`);
        }
        return { type: value.type, itemType: value.itemType };
    }
    if (value.type === "queue_required_fields_present") {
        if (typeof value.itemId !== "string" || value.itemId.length === 0) {
            throw new Error("queue_required_fields_present assertion requires itemId");
        }
        return { type: value.type, itemId: value.itemId };
    }
    if (value.type === "context_counts_match") {
        const fields = ["usedSources", "skippedSources", "usedMemories", "droppedMemories", "skippedScopes"] as const;
        for (const field of fields) {
            if (typeof value[field] !== "number" || !Number.isFinite(value[field])) {
                throw new Error(`context_counts_match assertion requires ${field}`);
            }
        }
        return {
            type: value.type,
            usedSources: value.usedSources as number,
            skippedSources: value.skippedSources as number,
            usedMemories: value.usedMemories as number,
            droppedMemories: value.droppedMemories as number,
            skippedScopes: value.skippedScopes as number,
        };
    }
    if (value.type === "context_trace_has_no_private_text") {
        return { type: value.type };
    }
    if (value.type === "capture_raw_text_unchanged"
        || value.type === "no_confirmed_memory_without_confirmation"
        || value.type === "no_task_written_without_confirmation") {
        return { type: value.type };
    }
    if (value.type === "queue_item_has_source_capture_id" || value.type === "generated_content_distinguished") {
        if (typeof value.itemId !== "string" || value.itemId.length === 0) {
            throw new Error(`${value.type} assertion requires itemId`);
        }
        return { type: value.type, itemId: value.itemId };
    }
    if (value.type === "saved_insight_has_source_refs" || value.type === "saved_insight_weak_influence_only") {
        if (typeof value.itemId !== "string" || value.itemId.length === 0) {
            throw new Error(`${value.type} assertion requires itemId`);
        }
        return { type: value.type, itemId: value.itemId };
    }
    if (value.type === "confirmed_memory_source_backed" || value.type === "memory_tombstone_has_no_text") {
        if (typeof value.memoryId !== "string" || value.memoryId.length === 0) {
            throw new Error(`${value.type} assertion requires memoryId`);
        }
        return { type: value.type, memoryId: value.memoryId };
    }
    if (value.type === "context_firewall_decision") {
        if (typeof value.memoryId !== "string" || value.memoryId.length === 0) {
            throw new Error("context_firewall_decision assertion requires memoryId");
        }
        if (typeof value.decision !== "string" || value.decision.length === 0) {
            throw new Error("context_firewall_decision assertion requires decision");
        }
        if (typeof value.reason !== "string" || value.reason.length === 0) {
            throw new Error("context_firewall_decision assertion requires reason");
        }
        return {
            type: value.type,
            memoryId: value.memoryId,
            decision: value.decision,
            reason: value.reason,
        };
    }
    if (
        value.type === "maintenance_proposal_has_preview"
        || value.type === "maintenance_affected_paths_listed"
        || value.type === "maintenance_hard_delete_forbidden"
        || value.type === "maintenance_merge_creates_new_note"
        || value.type === "maintenance_apply_selected_only"
    ) {
        if (typeof value.itemId !== "string" || value.itemId.length === 0) {
            throw new Error(`${value.type} assertion requires itemId`);
        }
        return { type: value.type, itemId: value.itemId };
    }
    if (value.type === "maintenance_rollback_restores") {
        if (typeof value.actionId !== "string" || value.actionId.length === 0) {
            throw new Error("maintenance_rollback_restores assertion requires actionId");
        }
        return { type: value.type, actionId: value.actionId };
    }
    if (value.type === "maintenance_no_source_write") {
        return { type: value.type };
    }
    throw new Error(`Unknown eval assertion type: ${value.type}`);
}

export function parseEvalCase(input: unknown): EvalCase {
    if (!isRecord(input)) throw new Error("Eval case must be an object");
    if (typeof input.id !== "string" || input.id.length === 0) throw new Error("Eval case requires id");
    if (typeof input.title !== "string" || input.title.length === 0) throw new Error("Eval case requires title");
    if (!isCategory(input.category)) throw new Error("Eval case requires valid category");
    if (!isRecord(input.expected) || !Array.isArray(input.expected.assertions) || input.expected.assertions.length === 0) {
        throw new Error("Eval case requires expected.assertions");
    }
    const actual = isRecord(input.actual) ? input.actual : {};
    return {
        id: input.id,
        title: input.title,
        category: input.category as EvalCase["category"],
        actual: {
            sourceRefs: Array.isArray(actual.sourceRefs)
                ? actual.sourceRefs.filter(isRecord).map((ref) => ({ path: String(ref.path ?? "") }))
                : undefined,
            replaySourceRefs: Array.isArray(actual.replaySourceRefs) ? actual.replaySourceRefs : undefined,
            queueItems: Array.isArray(actual.queueItems) ? actual.queueItems : undefined,
            contextTrace: actual.contextTrace,
            capture: isRecord(actual.capture)
                ? {
                    originalText: typeof actual.capture.originalText === "string" ? actual.capture.originalText : undefined,
                    savedText: typeof actual.capture.savedText === "string" ? actual.capture.savedText : undefined,
                }
                : undefined,
            confirmedMemories: Array.isArray(actual.confirmedMemories) ? actual.confirmedMemories : undefined,
            savedInsights: Array.isArray(actual.savedInsights) ? actual.savedInsights : undefined,
            memoryCandidates: Array.isArray(actual.memoryCandidates) ? actual.memoryCandidates : undefined,
            contextFirewallDecisions: Array.isArray(actual.contextFirewallDecisions)
                ? actual.contextFirewallDecisions
                : undefined,
            writtenTasks: Array.isArray(actual.writtenTasks) ? actual.writtenTasks : undefined,
            maintenanceProposals: Array.isArray(actual.maintenanceProposals)
                ? actual.maintenanceProposals
                : undefined,
            maintenanceActions: Array.isArray(actual.maintenanceActions)
                ? actual.maintenanceActions
                : undefined,
            sourceWrites: Array.isArray(actual.sourceWrites) ? actual.sourceWrites : undefined,
        },
        expected: {
            assertions: input.expected.assertions.map(parseAssertion),
        },
    };
}

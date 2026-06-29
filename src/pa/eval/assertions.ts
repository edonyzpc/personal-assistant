import { isReviewQueueItemType, validateReviewQueueItemBase } from "../contracts";
import { hasForbiddenPersistedTextFields } from "../contracts/source-ref";
import type { EvalAssertion, EvalAssertionFailure, EvalCase, EvalRunnerOptions } from "./types";

function sourcePaths(evalCase: EvalCase): string[] {
    const refs = [
        ...(evalCase.actual.sourceRefs ?? []),
        ...(evalCase.actual.replaySourceRefs ?? []),
    ];
    return refs
        .filter((ref): ref is { path: string } => typeof ref === "object" && ref !== null && "path" in ref)
        .map((ref) => ref.path);
}

function queueItemTypeAllowed(assertion: Extract<EvalAssertion, { type: "queue_type_allowed" }>): EvalAssertionFailure | null {
    if (isReviewQueueItemType(assertion.itemType)) return null;
    return { assertion, message: `Expected queue type "${assertion.itemType}" to be canonical` };
}

function queueItemTypeRejected(assertion: Extract<EvalAssertion, { type: "queue_type_rejected" }>): EvalAssertionFailure | null {
    if (!isReviewQueueItemType(assertion.itemType)) return null;
    return { assertion, message: `Expected queue type "${assertion.itemType}" to be rejected` };
}

function queueRequiredFieldsPresent(
    evalCase: EvalCase,
    assertion: Extract<EvalAssertion, { type: "queue_required_fields_present" }>,
): EvalAssertionFailure | null {
    const item = (evalCase.actual.queueItems ?? []).find((candidate) => {
        return typeof candidate === "object" && candidate !== null && "id" in candidate && candidate.id === assertion.itemId;
    });
    const result = validateReviewQueueItemBase(item);
    if (result.ok) return null;
    return { assertion, message: `Queue item "${assertion.itemId}" failed required fields: ${result.reason}` };
}

function contextCountsMatch(
    evalCase: EvalCase,
    assertion: Extract<EvalAssertion, { type: "context_counts_match" }>,
): EvalAssertionFailure | null {
    const trace = evalCase.actual.contextTrace;
    if (typeof trace !== "object" || trace === null) {
        return { assertion, message: "Expected contextTrace to be present" };
    }
    const record = trace as Record<string, unknown>;
    const checks: Array<[string, number, unknown]> = [
        ["usedSourceCount", assertion.usedSources, record.usedSourceCount],
        ["skippedSourceCount", assertion.skippedSources, record.skippedSourceCount],
        ["usedMemoryCount", assertion.usedMemories, record.usedMemoryCount],
        ["droppedMemoryCount", assertion.droppedMemories, record.droppedMemoryCount],
        ["skippedScopeCount", assertion.skippedScopes, record.skippedScopeCount],
    ];
    const mismatch = checks.find(([, expected, actual]) => actual !== expected);
    if (!mismatch) return null;
    const [field, expected, actual] = mismatch;
    return { assertion, message: `Context trace ${field} expected ${expected}, got ${String(actual)}` };
}

function queueItemById(evalCase: EvalCase, itemId: string): Record<string, unknown> | null {
    const item = (evalCase.actual.queueItems ?? []).find((candidate) => {
        return typeof candidate === "object" && candidate !== null && "id" in candidate && candidate.id === itemId;
    });
    return typeof item === "object" && item !== null ? item as Record<string, unknown> : null;
}

function recordById(records: unknown[] | undefined, idKey: "id" | "memoryId", id: string): Record<string, unknown> | null {
    const item = (records ?? []).find((candidate) => {
        if (typeof candidate !== "object" || candidate === null) return false;
        const record = candidate as Record<string, unknown>;
        return record[idKey] === id;
    });
    return typeof item === "object" && item !== null ? item as Record<string, unknown> : null;
}

function captureRawTextUnchanged(
    evalCase: EvalCase,
    assertion: Extract<EvalAssertion, { type: "capture_raw_text_unchanged" }>,
): EvalAssertionFailure | null {
    const capture = evalCase.actual.capture;
    if (!capture || typeof capture.originalText !== "string" || typeof capture.savedText !== "string") {
        return { assertion, message: "Expected capture originalText and savedText to be present" };
    }
    return capture.savedText.includes(capture.originalText)
        ? null
        : { assertion, message: "Expected saved capture text to preserve original text unchanged" };
}

function queueItemHasSourceCaptureId(
    evalCase: EvalCase,
    assertion: Extract<EvalAssertion, { type: "queue_item_has_source_capture_id" }>,
): EvalAssertionFailure | null {
    const item = queueItemById(evalCase, assertion.itemId);
    if (!item) return { assertion, message: `Expected queue item "${assertion.itemId}" to be present` };
    const metadata = typeof item.metadata === "object" && item.metadata !== null
        ? item.metadata as Record<string, unknown>
        : {};
    return typeof metadata.captureId === "string" && metadata.captureId.length > 0
        ? null
        : { assertion, message: `Queue item "${assertion.itemId}" is missing source capture id` };
}

function generatedContentDistinguished(
    evalCase: EvalCase,
    assertion: Extract<EvalAssertion, { type: "generated_content_distinguished" }>,
): EvalAssertionFailure | null {
    const item = queueItemById(evalCase, assertion.itemId);
    if (!item) return { assertion, message: `Expected queue item "${assertion.itemId}" to be present` };
    const metadata = typeof item.metadata === "object" && item.metadata !== null
        ? item.metadata as Record<string, unknown>
        : {};
    return metadata.aiGenerated === true || metadata.renderStyle === "ai_callout"
        ? null
        : { assertion, message: `Queue item "${assertion.itemId}" does not distinguish generated content` };
}

function savedInsightHasSourceRefs(
    evalCase: EvalCase,
    assertion: Extract<EvalAssertion, { type: "saved_insight_has_source_refs" }>,
): EvalAssertionFailure | null {
    const item = recordById(evalCase.actual.savedInsights, "id", assertion.itemId);
    if (!item) return { assertion, message: `Expected saved insight "${assertion.itemId}" to be present` };
    const sourceRefs = Array.isArray(item.sourceRefs) ? item.sourceRefs : [];
    return sourceRefs.length > 0
        ? null
        : { assertion, message: `Saved insight "${assertion.itemId}" is missing source refs` };
}

function savedInsightWeakInfluenceOnly(
    evalCase: EvalCase,
    assertion: Extract<EvalAssertion, { type: "saved_insight_weak_influence_only" }>,
): EvalAssertionFailure | null {
    const item = recordById(evalCase.actual.savedInsights, "id", assertion.itemId);
    if (!item) return { assertion, message: `Expected saved insight "${assertion.itemId}" to be present` };
    return item.influencePolicy === "weak-only"
        ? null
        : { assertion, message: `Saved insight "${assertion.itemId}" must stay recall-only` };
}

function confirmedMemorySourceBacked(
    evalCase: EvalCase,
    assertion: Extract<EvalAssertion, { type: "confirmed_memory_source_backed" }>,
): EvalAssertionFailure | null {
    const memory = recordById(evalCase.actual.confirmedMemories, "id", assertion.memoryId);
    if (!memory) return { assertion, message: `Expected memory "${assertion.memoryId}" to be present` };
    const sourceRefs = Array.isArray(memory.sourceRefs) ? memory.sourceRefs : [];
    return sourceRefs.length > 0
        ? null
        : { assertion, message: `Confirmed Memory "${assertion.memoryId}" is missing source refs` };
}

function memoryTombstoneHasNoText(
    evalCase: EvalCase,
    assertion: Extract<EvalAssertion, { type: "memory_tombstone_has_no_text" }>,
): EvalAssertionFailure | null {
    const memory = recordById(evalCase.actual.confirmedMemories, "id", assertion.memoryId);
    if (!memory) return { assertion, message: `Expected memory tombstone "${assertion.memoryId}" to be present` };
    if (memory.lifecycle !== "forgotten_tombstone") {
        return { assertion, message: `Memory "${assertion.memoryId}" is not a forgotten tombstone` };
    }
    const sourceRefs = Array.isArray(memory.sourceRefs) ? memory.sourceRefs : [];
    const summary = typeof memory.summary === "string" ? memory.summary.trim() : "";
    if (summary.length === 0 && sourceRefs.length === 0 && !hasForbiddenPersistedTextFields(memory)) return null;
    return { assertion, message: `Forgotten Memory "${assertion.memoryId}" retained source refs or raw text` };
}

function contextFirewallDecision(
    evalCase: EvalCase,
    assertion: Extract<EvalAssertion, { type: "context_firewall_decision" }>,
): EvalAssertionFailure | null {
    const decision = recordById(evalCase.actual.contextFirewallDecisions, "memoryId", assertion.memoryId);
    if (!decision) return { assertion, message: `Expected Context Firewall decision for "${assertion.memoryId}"` };
    if (decision.decision === assertion.decision && decision.reason === assertion.reason) return null;
    return {
        assertion,
        message: `Context Firewall decision for "${assertion.memoryId}" expected ${assertion.decision}/${assertion.reason}, got ${String(decision.decision)}/${String(decision.reason)}`,
    };
}

function maintenanceProposalById(evalCase: EvalCase, itemId: string): Record<string, unknown> | null {
    return recordById(evalCase.actual.maintenanceProposals, "id", itemId);
}

function maintenanceActionById(evalCase: EvalCase, actionId: string): Record<string, unknown> | null {
    return recordById(evalCase.actual.maintenanceActions, "id", actionId);
}

function maintenanceProposalHasPreview(
    evalCase: EvalCase,
    assertion: Extract<EvalAssertion, { type: "maintenance_proposal_has_preview" }>,
): EvalAssertionFailure | null {
    const proposal = maintenanceProposalById(evalCase, assertion.itemId);
    if (!proposal) return { assertion, message: `Expected maintenance proposal "${assertion.itemId}" to be present` };
    const preview = typeof proposal.preview === "object" && proposal.preview !== null
        ? proposal.preview as Record<string, unknown>
        : null;
    const actionPlan = typeof proposal.actionPlan === "object" && proposal.actionPlan !== null
        ? proposal.actionPlan as Record<string, unknown>
        : null;
    return preview
        && Array.isArray(preview.affectedPaths)
        && preview.affectedPaths.length > 0
        && actionPlan?.previewOnly === true
        ? null
        : { assertion, message: `Maintenance proposal "${assertion.itemId}" is missing preview metadata` };
}

function maintenanceAffectedPathsListed(
    evalCase: EvalCase,
    assertion: Extract<EvalAssertion, { type: "maintenance_affected_paths_listed" }>,
): EvalAssertionFailure | null {
    const proposal = maintenanceProposalById(evalCase, assertion.itemId);
    if (!proposal) return { assertion, message: `Expected maintenance proposal "${assertion.itemId}" to be present` };
    const preview = typeof proposal.preview === "object" && proposal.preview !== null
        ? proposal.preview as Record<string, unknown>
        : null;
    const affectedPaths = Array.isArray(preview?.affectedPaths) ? preview.affectedPaths : [];
    return affectedPaths.length > 0 && affectedPaths.every((path) => typeof path === "string" && path.length > 0)
        ? null
        : { assertion, message: `Maintenance proposal "${assertion.itemId}" is missing affected paths` };
}

function maintenanceHardDeleteForbidden(
    evalCase: EvalCase,
    assertion: Extract<EvalAssertion, { type: "maintenance_hard_delete_forbidden" }>,
): EvalAssertionFailure | null {
    const proposal = maintenanceProposalById(evalCase, assertion.itemId);
    if (!proposal) return { assertion, message: `Expected maintenance proposal "${assertion.itemId}" to be present` };
    const actionPlan = typeof proposal.actionPlan === "object" && proposal.actionPlan !== null
        ? proposal.actionPlan as Record<string, unknown>
        : {};
    return actionPlan.permanentDelete === true
        ? { assertion, message: `Maintenance proposal "${assertion.itemId}" attempts permanent delete` }
        : null;
}

function maintenanceMergeCreatesNewNote(
    evalCase: EvalCase,
    assertion: Extract<EvalAssertion, { type: "maintenance_merge_creates_new_note" }>,
): EvalAssertionFailure | null {
    const proposal = maintenanceProposalById(evalCase, assertion.itemId);
    if (!proposal) return { assertion, message: `Expected maintenance proposal "${assertion.itemId}" to be present` };
    if (proposal.actionType !== "merge") return null;
    const actionPlan = typeof proposal.actionPlan === "object" && proposal.actionPlan !== null
        ? proposal.actionPlan as Record<string, unknown>
        : {};
    return actionPlan.mergeStrategy === "create_new_note"
        ? null
        : { assertion, message: `Maintenance merge "${assertion.itemId}" must create a new note` };
}

function maintenanceApplySelectedOnly(
    evalCase: EvalCase,
    assertion: Extract<EvalAssertion, { type: "maintenance_apply_selected_only" }>,
): EvalAssertionFailure | null {
    const actions = (evalCase.actual.maintenanceActions ?? [])
        .filter((candidate): candidate is Record<string, unknown> => typeof candidate === "object" && candidate !== null);
    const selectedActions = actions.filter((action) => action.proposalId === assertion.itemId);
    if (selectedActions.length === 0) {
        return { assertion, message: `Expected selected maintenance proposal "${assertion.itemId}" to be applied` };
    }
    const nonMove = selectedActions.find((action) => action.actionType !== "move");
    if (nonMove) {
        return { assertion, message: `Maintenance apply "${String(nonMove.id ?? "")}" is not move-only` };
    }
    const leakedText = selectedActions.find((action) => hasForbiddenPersistedTextFields(action));
    if (leakedText) {
        return { assertion, message: `Maintenance action "${String(leakedText.id ?? "")}" persisted raw text` };
    }
    const strayAction = actions.find((action) => action.proposalId !== assertion.itemId);
    if (strayAction) {
        return {
            assertion,
            message: `Maintenance action "${String(strayAction.id ?? "")}" applied unselected proposal "${String(strayAction.proposalId ?? "")}"`,
        };
    }
    return null;
}

function maintenanceRollbackRestores(
    evalCase: EvalCase,
    assertion: Extract<EvalAssertion, { type: "maintenance_rollback_restores" }>,
): EvalAssertionFailure | null {
    const action = maintenanceActionById(evalCase, assertion.actionId);
    if (!action) return { assertion, message: `Expected maintenance action "${assertion.actionId}" to be present` };
    const oldPath = typeof action.oldPath === "string" ? action.oldPath : "";
    const newPath = typeof action.newPath === "string" ? action.newPath : "";
    const restored = action.status === "undone"
        && action.rollbackRestored === true
        && oldPath.length > 0
        && newPath.length > 0
        && action.undoStrategy === "move_back";
    return restored
        ? null
        : { assertion, message: `Maintenance action "${assertion.actionId}" did not restore the original path` };
}

export function runAssertion(
    evalCase: EvalCase,
    assertion: EvalAssertion,
    options: EvalRunnerOptions,
): EvalAssertionFailure | null {
    const paths = sourcePaths(evalCase);
    if (assertion.type === "must_include_source") {
        return paths.includes(assertion.path)
            ? null
            : { assertion, message: `Expected source "${assertion.path}" to be included` };
    }
    if (assertion.type === "must_not_include_source") {
        return paths.includes(assertion.path)
            ? { assertion, message: `Expected source "${assertion.path}" to be absent` }
            : null;
    }
    if (assertion.type === "source_ref_exists") {
        return options.sourceExists(assertion.path)
            ? null
            : { assertion, message: `Expected source ref "${assertion.path}" to exist in fixture vault` };
    }
    if (assertion.type === "replay_ref_has_no_excerpt") {
        const refs = assertion.path
            ? (evalCase.actual.replaySourceRefs ?? []).filter((ref) => {
                return typeof ref === "object" && ref !== null && "path" in ref && ref.path === assertion.path;
            })
            : (evalCase.actual.replaySourceRefs ?? []);
        return refs.some((ref) => hasForbiddenPersistedTextFields(ref))
            ? { assertion, message: "Replay source ref persisted raw excerpt/provider/prompt text" }
            : null;
    }
    if (assertion.type === "queue_type_allowed") return queueItemTypeAllowed(assertion);
    if (assertion.type === "queue_type_rejected") return queueItemTypeRejected(assertion);
    if (assertion.type === "queue_required_fields_present") return queueRequiredFieldsPresent(evalCase, assertion);
    if (assertion.type === "context_counts_match") return contextCountsMatch(evalCase, assertion);
    if (assertion.type === "context_trace_has_no_private_text") {
        return hasForbiddenPersistedTextFields(evalCase.actual.contextTrace)
            ? { assertion, message: "Context trace persisted raw excerpt/provider/prompt text" }
            : null;
    }
    if (assertion.type === "capture_raw_text_unchanged") return captureRawTextUnchanged(evalCase, assertion);
    if (assertion.type === "queue_item_has_source_capture_id") return queueItemHasSourceCaptureId(evalCase, assertion);
    if (assertion.type === "generated_content_distinguished") return generatedContentDistinguished(evalCase, assertion);
    if (assertion.type === "no_confirmed_memory_without_confirmation") {
        return (evalCase.actual.confirmedMemories ?? []).length === 0
            ? null
            : { assertion, message: "Expected no Confirmed Memory without user confirmation" };
    }
    if (assertion.type === "no_task_written_without_confirmation") {
        return (evalCase.actual.writtenTasks ?? []).length === 0
            ? null
            : { assertion, message: "Expected no Markdown task write without user confirmation" };
    }
    if (assertion.type === "saved_insight_has_source_refs") return savedInsightHasSourceRefs(evalCase, assertion);
    if (assertion.type === "saved_insight_weak_influence_only") return savedInsightWeakInfluenceOnly(evalCase, assertion);
    if (assertion.type === "confirmed_memory_source_backed") return confirmedMemorySourceBacked(evalCase, assertion);
    if (assertion.type === "memory_tombstone_has_no_text") return memoryTombstoneHasNoText(evalCase, assertion);
    if (assertion.type === "context_firewall_decision") return contextFirewallDecision(evalCase, assertion);
    if (assertion.type === "maintenance_proposal_has_preview") return maintenanceProposalHasPreview(evalCase, assertion);
    if (assertion.type === "maintenance_affected_paths_listed") return maintenanceAffectedPathsListed(evalCase, assertion);
    if (assertion.type === "maintenance_hard_delete_forbidden") return maintenanceHardDeleteForbidden(evalCase, assertion);
    if (assertion.type === "maintenance_merge_creates_new_note") return maintenanceMergeCreatesNewNote(evalCase, assertion);
    if (assertion.type === "maintenance_apply_selected_only") return maintenanceApplySelectedOnly(evalCase, assertion);
    if (assertion.type === "maintenance_rollback_restores") return maintenanceRollbackRestores(evalCase, assertion);
    return (evalCase.actual.sourceWrites ?? []).length === 0
        ? null
        : { assertion, message: "Expected Maintenance Review preview to avoid source note writes" };
}

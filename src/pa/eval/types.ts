export const EVAL_CASE_CATEGORIES = [
    "retrieval",
    "review_queue",
    "data_boundary",
    "context_pager",
    "quick_capture",
    "memory_governance",
    "maintenance_review",
] as const;
export type EvalCaseCategory = typeof EVAL_CASE_CATEGORIES[number];

export type EvalAssertion =
    | { type: "must_include_source"; path: string }
    | { type: "must_not_include_source"; path: string }
    | { type: "source_ref_exists"; path: string }
    | { type: "replay_ref_has_no_excerpt"; path?: string }
    | { type: "queue_type_allowed"; itemType: string }
    | { type: "queue_type_rejected"; itemType: string }
    | { type: "queue_required_fields_present"; itemId: string }
    | {
        type: "context_counts_match";
        usedSources: number;
        skippedSources: number;
        usedMemories: number;
        droppedMemories: number;
        skippedScopes: number;
    }
    | { type: "context_trace_has_no_private_text" }
    | { type: "capture_raw_text_unchanged" }
    | { type: "queue_item_has_source_capture_id"; itemId: string }
    | { type: "generated_content_distinguished"; itemId: string }
    | { type: "no_confirmed_memory_without_confirmation" }
    | { type: "no_task_written_without_confirmation" }
    | { type: "saved_insight_has_source_refs"; itemId: string }
    | { type: "saved_insight_weak_influence_only"; itemId: string }
    | { type: "confirmed_memory_source_backed"; memoryId: string }
    | { type: "memory_tombstone_has_no_text"; memoryId: string }
    | { type: "context_firewall_decision"; memoryId: string; decision: string; reason: string }
    | { type: "maintenance_proposal_has_preview"; itemId: string }
    | { type: "maintenance_affected_paths_listed"; itemId: string }
    | { type: "maintenance_hard_delete_forbidden"; itemId: string }
    | { type: "maintenance_merge_creates_new_note"; itemId: string }
    | { type: "maintenance_apply_selected_only"; itemId: string }
    | { type: "maintenance_rollback_restores"; actionId: string }
    | { type: "maintenance_no_source_write" };

export interface EvalCaseActual {
    sourceRefs?: Array<{ path: string }>;
    replaySourceRefs?: unknown[];
    queueItems?: unknown[];
    contextTrace?: unknown;
    capture?: {
        originalText?: string;
        savedText?: string;
    };
    confirmedMemories?: unknown[];
    savedInsights?: unknown[];
    memoryCandidates?: unknown[];
    contextFirewallDecisions?: unknown[];
    writtenTasks?: unknown[];
    maintenanceProposals?: unknown[];
    maintenanceActions?: unknown[];
    sourceWrites?: unknown[];
}

export interface EvalCaseExpected {
    assertions: EvalAssertion[];
}

export interface EvalCase {
    id: string;
    title: string;
    category: EvalCaseCategory;
    actual: EvalCaseActual;
    expected: EvalCaseExpected;
}

export interface EvalAssertionFailure {
    assertion: EvalAssertion;
    message: string;
}

export interface EvalCaseResult {
    caseId: string;
    ok: boolean;
    failures: EvalAssertionFailure[];
}

export interface EvalRunResult {
    ok: boolean;
    results: EvalCaseResult[];
}

export interface EvalRunnerOptions {
    sourceExists(path: string): boolean;
}

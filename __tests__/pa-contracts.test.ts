import {
    ACTIVE_REVIEW_QUEUE_PRODUCER_TYPES,
    DATA_CLEANUP_GROUPS,
    DEFAULT_DATA_BOUNDARY_POLICY,
    MEMORY_TYPES,
    NON_V1_DEFAULT_MEMORY_TYPES,
    REVIEW_QUEUE_ITEM_TYPES,
    canAutoConfirmMemoryCandidate,
    decideDataBoundaryForSource,
    formatContextTraceSummary,
    getProviderDisclosureReason,
    hasForbiddenPersistedTextFields,
    isActiveReviewQueueProducerType,
    isContextDropReason,
    isMemoryType,
    isReviewQueueItemType,
    persistedContextTraceHasPrivateText,
    toPersistedContextTrace,
    toReplaySourceRef,
    validateMemoryCandidate,
    validateMemoryLifecycleRecord,
    validateRetrievalOutcome,
    validateReviewQueueItemBase,
    validateSourceRefPathShape,
    type ContextTrace,
    type MemoryCandidateContract,
    type PersistedSourceRef,
    type ReviewQueueItemBase,
    type UISourceRef,
} from "../src/pa";

const persistedSourceRef: PersistedSourceRef = {
    path: "projects/pa-agent/source.md",
    heading: "Decision",
    blockId: "^abc123",
    contentHash: "content-1",
    excerptHash: "excerpt-1",
    whyShown: ["direct evidence"],
    evidenceStrength: "strong",
};

describe("PA shared contracts", () => {
    it("defines the canonical Review Queue item types and rejects non-canonical aliases", () => {
        expect(REVIEW_QUEUE_ITEM_TYPES).toEqual([
            "evidence_insight",
            "memory_candidate",
            "memory_conflict",
            "maintenance_proposal",
            "capture_enrichment",
            "task_suggestion",
            "recall_suggestion",
            "related_note",
            "theme_chain",
            "conflict_pair",
            "index_note_candidate",
            "review_summary",
            "broad_scan_plan",
            "action_log",
        ]);

        expect(isReviewQueueItemType("memory_candidate")).toBe(true);
        expect(isReviewQueueItemType("scope_state")).toBe(false);
        expect(isReviewQueueItemType("profile_fact")).toBe(false);
        expect(isReviewQueueItemType("insight_candidate")).toBe(false);
        expect(isReviewQueueItemType("saved_insight_candidate")).toBe(false);
    });

    it("activates only source-backed Review Queue producers for current milestones", () => {
        expect(ACTIVE_REVIEW_QUEUE_PRODUCER_TYPES).toEqual([
            "evidence_insight",
            "capture_enrichment",
            "task_suggestion",
            "memory_candidate",
            "related_note",
            "theme_chain",
            "conflict_pair",
            "index_note_candidate",
            "maintenance_proposal",
        ]);
        expect(isActiveReviewQueueProducerType("evidence_insight")).toBe(true);
        expect(isReviewQueueItemType("memory_candidate")).toBe(true);
        expect(isActiveReviewQueueProducerType("memory_candidate")).toBe(true);
        expect(isReviewQueueItemType("maintenance_proposal")).toBe(true);
        expect(isActiveReviewQueueProducerType("maintenance_proposal")).toBe(true);
        expect(isActiveReviewQueueProducerType("theme_chain")).toBe(true);
        expect(isActiveReviewQueueProducerType("conflict_pair")).toBe(true);
        expect(isActiveReviewQueueProducerType("index_note_candidate")).toBe(true);

        const item: ReviewQueueItemBase = {
            id: "rq-1",
            type: "maintenance_proposal",
            scope: { kind: "current_note", paths: ["projects/pa-agent/source.md"] },
            sourceRefs: [persistedSourceRef],
            originSurface: "pagelet",
            priority: "normal",
            status: "suggested",
            createdAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z",
            whyShown: ["Potentially durable user preference"],
            dataBoundarySnapshotId: "boundary-1",
        };

        expect(validateReviewQueueItemBase(item)).toEqual({ ok: true });
        expect(validateReviewQueueItemBase(item, { requireActiveProducer: true })).toEqual({ ok: true });
    });

    it("strips UI excerpts from replay source refs and validates path shapes", () => {
        const uiRef: UISourceRef = {
            path: "projects/pa-agent/source.md",
            heading: "Decision",
            blockId: "^abc123",
            excerpt: "private note excerpt",
            generatedAt: "2026-06-28T00:00:00.000Z",
            contentHash: "content-1",
            whyShown: ["direct evidence"],
            evidenceStrength: "strong",
        };

        const replayRef = toReplaySourceRef(uiRef);

        expect(replayRef).toMatchObject({
            path: uiRef.path,
            heading: uiRef.heading,
            blockId: uiRef.blockId,
            generatedAt: uiRef.generatedAt,
            contentHash: uiRef.contentHash,
            whyShown: uiRef.whyShown,
            evidenceStrength: uiRef.evidenceStrength,
        });
        expect("excerpt" in replayRef).toBe(false);
        expect(replayRef.excerptHash).toMatch(/^[0-9a-f]{8}$/);
        expect(hasForbiddenPersistedTextFields(replayRef)).toBe(false);
        expect(validateSourceRefPathShape(uiRef)).toEqual({ ok: true });
        expect(validateSourceRefPathShape({ path: "../private.md" })).toEqual({
            ok: false,
            reason: "parent_traversal",
        });
    });

    it("validates RetrievalOutcome no-answer, privacy, and conflict invariants", () => {
        expect(validateRetrievalOutcome({
            id: "outcome-1",
            status: "no_evidence",
            sources: [persistedSourceRef],
            skippedSources: [],
        })).toEqual({ ok: false, reason: "no_evidence_has_sources" });

        expect(validateRetrievalOutcome({
            id: "outcome-2",
            status: "blocked_by_privacy",
            sources: [],
            skippedSources: [{ ...persistedSourceRef, skippedReason: "privacy excluded" }],
        })).toEqual({ ok: false, reason: "privacy_block_without_boundary_reason" });

        expect(validateRetrievalOutcome({
            id: "outcome-3",
            status: "conflict",
            sources: [],
            skippedSources: [],
            conflictingSources: [persistedSourceRef],
        })).toEqual({ ok: false, reason: "conflict_without_evidence" });

        expect(validateRetrievalOutcome({
            id: "outcome-4",
            status: "conflict",
            sources: [],
            skippedSources: [],
            conflictingSources: [persistedSourceRef, { ...persistedSourceRef, path: "projects/pa-agent/other.md" }],
        })).toEqual({ ok: true });
    });

    it("defines Data Boundary defaults, cleanup groups, one-run overrides, and disclosure reasons", () => {
        expect(decideDataBoundaryForSource(
            { path: "private/source.md" },
            { ...DEFAULT_DATA_BOUNDARY_POLICY, excludedFolders: ["private"] },
        )).toEqual({
            decision: "deny",
            reason: "excluded_folder",
            sourcePath: "private/source.md",
        });

        expect(decideDataBoundaryForSource(
            { path: "notes/source.md", tags: ["private"] },
            { ...DEFAULT_DATA_BOUNDARY_POLICY, excludedTags: ["private"] },
        )).toEqual({
            decision: "deny",
            reason: "excluded_tag",
            sourcePath: "notes/source.md",
        });

        expect(decideDataBoundaryForSource({ path: ".pagelet/generated.md" })).toEqual({
            decision: "deny",
            reason: "generated_note",
            sourcePath: ".pagelet/generated.md",
        });

        expect(decideDataBoundaryForSource(
            { path: "private/source.md" },
            { ...DEFAULT_DATA_BOUNDARY_POLICY, excludedFolders: ["private"] },
            { scope: "one-run", sourcePath: "private/source.md", reason: "excluded_override" },
        )).toMatchObject({
            decision: "allow",
            reason: "one_run_override",
        });

        expect(DATA_CLEANUP_GROUPS).toEqual([
            "cache",
            "queue",
            "replay",
            "candidates",
            "confirmed_memory",
            "tombstones",
        ]);
        expect(getProviderDisclosureReason({ broadScope: true })).toBe("broad_scope");
        expect(getProviderDisclosureReason({})).toBeNull();
    });

    it("keeps the v1 Memory taxonomy narrow and validates candidate lifecycle rules", () => {
        expect(MEMORY_TYPES).toEqual([
            "preference",
            "decision",
            "project_context",
            "task_constraint",
            "open_question",
        ]);
        for (const type of NON_V1_DEFAULT_MEMORY_TYPES) {
            expect(isMemoryType(type)).toBe(false);
        }

        const candidate: MemoryCandidateContract = {
            id: "mem-1",
            type: "task_constraint",
            lifecycle: "candidate",
            sensitivity: "low",
            scope: "projects/pa-agent",
            sourceRefs: [persistedSourceRef],
            createdAt: "2026-06-28T00:00:00.000Z",
            summary: "Prefer source-backed answers.",
        };

        expect(validateMemoryCandidate(candidate)).toEqual({ ok: true });
        expect(canAutoConfirmMemoryCandidate(candidate)).toBe(false);
        expect(validateMemoryCandidate({ ...candidate, sourceRefs: [] })).toEqual({
            ok: false,
            reason: "missing_source_refs",
        });
        expect(validateMemoryLifecycleRecord({
            id: "mem-2",
            type: "decision",
            lifecycle: "forgotten_tombstone",
            sensitivity: "low",
            rawMemoryText: "private memory text",
        })).toEqual({ ok: false, reason: "raw_memory_text_not_allowed" });
        expect(validateMemoryLifecycleRecord({
            id: "mem-3",
            type: "decision",
            lifecycle: "active",
            sensitivity: "low",
            rawMemoryText: "private memory text",
        })).toEqual({ ok: false, reason: "raw_memory_text_not_allowed" });
    });

    it("rejects ConfirmedMemoryRecord with corrupted sensitivity (context firewall bypass guard)", () => {
        expect(validateMemoryLifecycleRecord({
            id: "mem-corrupt-1",
            type: "decision",
            lifecycle: "active",
            sensitivity: "HIGH" as any,
        })).toEqual({ ok: false, reason: "invalid_sensitivity" });

        expect(validateMemoryLifecycleRecord({
            id: "mem-corrupt-2",
            type: "decision",
            lifecycle: "active",
            sensitivity: "critical" as any,
        })).toEqual({ ok: false, reason: "invalid_sensitivity" });

        expect(validateMemoryLifecycleRecord({
            id: "mem-corrupt-3",
            type: "decision",
            lifecycle: "active",
            sensitivity: "" as any,
        })).toEqual({ ok: false, reason: "invalid_sensitivity" });

        expect(validateMemoryLifecycleRecord({
            id: "mem-valid",
            type: "decision",
            lifecycle: "active",
            sensitivity: "high",
        })).toEqual({ ok: true });
    });

    it("formats Context Pager summaries and persists trace metadata without private text", () => {
        const trace: ContextTrace = {
            runId: "run-1",
            retrievalOutcomeId: "outcome-1",
            usedSources: [{
                path: "projects/pa-agent/source.md",
                excerpt: "private source excerpt",
                contentHash: "content-1",
            }],
            skippedSources: [{
                path: "private/source.md",
                reason: "privacy excluded",
                privateTitle: "Private Source Title",
            }],
            usedMemories: [{
                id: "mem-1",
                type: "preference",
                text: "private memory text",
            }],
            droppedMemories: [{
                id: "mem-2",
                reason: "budget limit",
                text: "dropped memory text",
            }],
            skippedScopes: ["private"],
            compressionSummary: "compressed prompt chunks",
        };

        expect(isContextDropReason("privacy excluded")).toBe(true);
        expect(isContextDropReason("raw prompt omitted")).toBe(false);
        expect(formatContextTraceSummary(trace)).toBe(
            "Sources used: 1; sources skipped: 1; memories used: 1; memories dropped: 1; scopes skipped: 1",
        );

        const persisted = toPersistedContextTrace(trace);

        expect(persisted.usedSourceRefs[0]).toMatchObject({
            path: "projects/pa-agent/source.md",
            contentHash: "content-1",
        });
        expect(persisted.usedSourceRefs[0].excerptHash).toMatch(/^[0-9a-f]{8}$/);
        expect(persisted.skippedSourceRefs[0]).toEqual({
            path: "private/source.md",
            reason: "privacy excluded",
        });
        expect(persisted.usedMemoryRefs[0].contentHash).toMatch(/^[0-9a-f]{8}$/);
        expect(persisted.droppedMemoryRefs[0]).toMatchObject({
            id: "mem-2",
            reason: "budget limit",
        });
        expect(persisted.compressionSummaryHash).toMatch(/^[0-9a-f]{8}$/);
        expect(persistedContextTraceHasPrivateText(persisted)).toBe(false);
        expect(JSON.stringify(persisted)).not.toContain("Private Source Title");
        expect(JSON.stringify(persisted)).not.toContain("private memory text");
        expect(JSON.stringify(persisted)).not.toContain("compressed prompt chunks");
    });
});

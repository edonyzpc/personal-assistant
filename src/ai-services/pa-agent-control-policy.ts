/** Determines whether the agent may call arbitrary tools or only produce a final answer. */
export type PaAgentControlToolMode = "normal" | "final_answer_only";

/** Classifies which category of tools the agent currently sees in its tool list. */
export type PaAgentToolExposureMode =
    | "semantic-first"
    | "source-scoped"
    | "narrowed-required"
    | "answer-ready"
    | "follow-up"
    | "final-only"
    | "blocked-unavailable";

/** Describes where the agent's knowledge originates: vault notes, web, current note, or a mix. */
export type PaAgentSourceScope =
    | "none"
    | "notes"
    | "current_note"
    | "web"
    | "mixed";

/** Tracks budget consumption across semantic rounds, follow-ups, and tool calls. */
export interface PaAgentControlBudgetState {
    semanticRoundCount: number;
    followUpRoundCount: number;
    realToolCallCount: number;
    avoidedDuplicateCallCount: number;
    wallClockExceeded: boolean;
    exhaustedReason?: "tool_calls" | "semantic_rounds" | "follow_up_rounds" | "wall_clock";
}

/** A single diagnostic entry recording a control-policy decision for debugging. */
export interface PaAgentControlDiagnostic {
    type: string;
    message: string;
    metadata?: Record<string, unknown>;
}

/** Allowlist/blocklist pair controlling which tools the agent may invoke this turn. */
export interface AgentControlToolConstraints {
    allowedToolNames?: ReadonlySet<string>;
    blockedToolNames?: ReadonlySet<string>;
}

/** Immutable snapshot of the agent's tool-exposure, source-scope, budget, and constraint state at a point in time. */
export interface AgentControlSnapshot {
    exposureMode: PaAgentToolExposureMode;
    sourceScope: PaAgentSourceScope;
    allowedToolNames?: ReadonlySet<string>;
    blockedToolNames?: ReadonlySet<string>;
    blockedReasons: Record<string, string>;
    runtimeInstruction?: string;
    toolMode?: PaAgentControlToolMode;
    budgetState: PaAgentControlBudgetState;
    diagnostics: PaAgentControlDiagnostic[];
}

/** Options for constructing a control snapshot with explicit overrides. */
export interface CreateAgentControlSnapshotOptions extends AgentControlToolConstraints {
    exposureMode?: PaAgentToolExposureMode;
    sourceScope?: PaAgentSourceScope;
    blockedReasons?: Record<string, string>;
    runtimeInstruction?: string;
    toolMode?: PaAgentControlToolMode;
    budgetState?: Partial<PaAgentControlBudgetState>;
    diagnostics?: PaAgentControlDiagnostic[];
}

/** Options for building the very first control snapshot from the full set of available tools. */
export interface CreateInitialAgentControlSnapshotOptions {
    constraints?: AgentControlToolConstraints;
    availableSemanticToolNames: ReadonlySet<string>;
    availableMetaToolNames?: ReadonlySet<string>;
    requiredToolNames?: ReadonlySet<string>;
    initialRuntimeInstruction?: string;
}

const DEFAULT_BUDGET_STATE: PaAgentControlBudgetState = {
    semanticRoundCount: 0,
    followUpRoundCount: 0,
    realToolCallCount: 0,
    avoidedDuplicateCallCount: 0,
    wallClockExceeded: false,
};

const NOTES_FOLLOW_UP_TOOL_NAMES = new Set([
    "search_vault_snippets",
]);

/** Builds a control snapshot from explicit option overrides, inferring exposure and scope when omitted. */
export function createAgentControlSnapshot(
    options: CreateAgentControlSnapshotOptions = {},
): AgentControlSnapshot {
    return {
        exposureMode: options.toolMode === "final_answer_only"
            ? "final-only"
            : options.exposureMode ?? inferExposureMode(options),
        sourceScope: options.sourceScope ?? inferSourceScope(options.allowedToolNames),
        ...(options.allowedToolNames ? { allowedToolNames: new Set(options.allowedToolNames) } : {}),
        ...(options.blockedToolNames ? { blockedToolNames: new Set(options.blockedToolNames) } : {}),
        blockedReasons: { ...(options.blockedReasons ?? {}) },
        ...(options.runtimeInstruction ? { runtimeInstruction: options.runtimeInstruction } : {}),
        ...(options.toolMode ? { toolMode: options.toolMode } : {}),
        budgetState: {
            ...DEFAULT_BUDGET_STATE,
            ...(options.budgetState ?? {}),
        },
        diagnostics: (options.diagnostics ?? []).map((d) => ({
            ...d,
            ...(d.metadata ? { metadata: { ...d.metadata } } : {}),
        })),
    };
}

/** Wraps pre-existing PA Agent tool constraints into the new control-snapshot shape for backward compatibility. */
export function createLegacyAgentControlSnapshot(options: {
    constraints?: AgentControlToolConstraints;
    initialRuntimeInstruction?: string;
}): AgentControlSnapshot {
    return createAgentControlSnapshot({
        ...(options.constraints?.allowedToolNames
            ? { allowedToolNames: options.constraints.allowedToolNames }
            : {}),
        ...(options.constraints?.blockedToolNames
            ? { blockedToolNames: options.constraints.blockedToolNames }
            : {}),
        ...(options.initialRuntimeInstruction
            ? { runtimeInstruction: options.initialRuntimeInstruction }
            : {}),
        diagnostics: [{
            type: "legacy_tool_constraints",
            message: "Control snapshot mirrors pre-existing PA Agent tool constraints for SPEC-01 plumbing.",
        }],
    });
}

/** Computes the initial control snapshot by intersecting available tools with user constraints and required capabilities. */
export function createInitialAgentControlSnapshot(
    options: CreateInitialAgentControlSnapshotOptions,
): AgentControlSnapshot {
    const blockedToolNames = new Set(options.constraints?.blockedToolNames ?? []);
    const availableSemanticToolNames = subtractTools(options.availableSemanticToolNames, blockedToolNames);
    const availableMetaToolNames = subtractTools(options.availableMetaToolNames ?? new Set(), blockedToolNames);
    if (options.constraints?.allowedToolNames) {
        const allowedToolNames = unionTools(
            intersectTools(options.constraints.allowedToolNames, availableSemanticToolNames),
            availableMetaToolNames,
        );
        return createAgentControlSnapshot({
            exposureMode: "source-scoped",
            sourceScope: inferSourceScope(allowedToolNames),
            allowedToolNames,
            ...(blockedToolNames.size > 0 ? { blockedToolNames } : {}),
            ...(options.initialRuntimeInstruction ? { runtimeInstruction: options.initialRuntimeInstruction } : {}),
            diagnostics: [{
                type: "explicit_tool_constraints",
                message: "Initial control snapshot applies explicit user source constraints.",
            }],
        });
    }

    const requiredSourceToolNames = options.requiredToolNames
        ? intersectTools(options.requiredToolNames, availableSemanticToolNames)
        : new Set<string>();
    if (requiredSourceToolNames.size > 0) {
        const requiredToolNames = unionTools(requiredSourceToolNames, availableMetaToolNames);
        return createAgentControlSnapshot({
            exposureMode: "narrowed-required",
            sourceScope: inferSourceScope(requiredToolNames),
            allowedToolNames: requiredToolNames,
            ...(blockedToolNames.size > 0 ? { blockedToolNames } : {}),
            ...(options.initialRuntimeInstruction ? { runtimeInstruction: options.initialRuntimeInstruction } : {}),
            diagnostics: [{
                type: "high_confidence_required_capability",
                message: "Initial control snapshot narrows tools to high-confidence required semantic sources.",
            }],
        });
    }

    return createAgentControlSnapshot({
        exposureMode: "semantic-first",
        sourceScope: inferSourceScope(availableSemanticToolNames),
        allowedToolNames: unionTools(availableSemanticToolNames, availableMetaToolNames),
        ...(blockedToolNames.size > 0 ? { blockedToolNames } : {}),
        ...(options.initialRuntimeInstruction ? { runtimeInstruction: options.initialRuntimeInstruction } : {}),
        diagnostics: [{
            type: "semantic_first_tool_exposure",
            message: "Initial control snapshot exposes semantic source tools and hides low-level follow-up tools.",
        }],
    });
}

/** Derives the next snapshot from a previous one, optionally injecting a new instruction or switching to final-answer mode. */
export function deriveContinuedAgentControlSnapshot(
    previous: AgentControlSnapshot | undefined,
    options: {
        runtimeInstruction?: string;
        toolMode?: PaAgentControlToolMode;
        diagnostics?: PaAgentControlDiagnostic[];
    },
): AgentControlSnapshot | undefined {
    if (!previous && !options.runtimeInstruction && !options.toolMode) {
        return undefined;
    }
    const base = previous ?? createAgentControlSnapshot();
    const runtimeInstruction = options.runtimeInstruction ?? base.runtimeInstruction;
    const toolMode = options.toolMode ?? base.toolMode;
    const isFinalOnly = options.toolMode === "final_answer_only";
    return createAgentControlSnapshot({
        exposureMode: isFinalOnly ? "final-only" : base.exposureMode,
        sourceScope: isFinalOnly ? "none" : base.sourceScope,
        ...(base.allowedToolNames && !isFinalOnly ? { allowedToolNames: base.allowedToolNames } : {}),
        ...(base.blockedToolNames ? { blockedToolNames: base.blockedToolNames } : {}),
        blockedReasons: base.blockedReasons,
        ...(runtimeInstruction ? { runtimeInstruction } : {}),
        ...(toolMode ? { toolMode } : {}),
        budgetState: base.budgetState,
        diagnostics: [
            ...base.diagnostics,
            ...(options.diagnostics ?? []),
        ],
    });
}

/** Derives a snapshot indicating the agent has enough observations and may answer or request one more targeted tool call. */
export function deriveAnswerReadyAgentControlSnapshot(
    previous: AgentControlSnapshot | undefined,
    options: {
        runtimeInstruction: string;
        diagnostics?: PaAgentControlDiagnostic[];
    },
): AgentControlSnapshot {
    const base = previous ?? createAgentControlSnapshot();
    return createAgentControlSnapshot({
        exposureMode: "answer-ready",
        sourceScope: base.sourceScope,
        ...(base.allowedToolNames ? { allowedToolNames: base.allowedToolNames } : {}),
        ...(base.blockedToolNames ? { blockedToolNames: base.blockedToolNames } : {}),
        blockedReasons: base.blockedReasons,
        runtimeInstruction: options.runtimeInstruction,
        budgetState: {
            ...base.budgetState,
            semanticRoundCount: base.budgetState.semanticRoundCount + 1,
        },
        diagnostics: [
            ...base.diagnostics,
            {
                type: "answer_ready_after_observation",
                message: "Useful observations are available; the model may answer or choose another allowed tool for a specific missing fact.",
            },
            ...(options.diagnostics ?? []),
        ],
    });
}

/** Derives a snapshot enabling only follow-up tools scoped to the same source type. */
export function deriveSameSourceFollowUpAgentControlSnapshot(
    previous: AgentControlSnapshot | undefined,
    options: {
        sourceScope: PaAgentSourceScope;
        runtimeInstruction: string;
        diagnostics?: PaAgentControlDiagnostic[];
    },
): AgentControlSnapshot {
    const base = previous ?? createAgentControlSnapshot();
    const allowedToolNames = options.sourceScope === "notes"
        ? NOTES_FOLLOW_UP_TOOL_NAMES
        : new Set<string>();
    return createAgentControlSnapshot({
        exposureMode: "follow-up",
        sourceScope: options.sourceScope,
        allowedToolNames,
        ...(base.blockedToolNames ? { blockedToolNames: base.blockedToolNames } : {}),
        blockedReasons: base.blockedReasons,
        runtimeInstruction: options.runtimeInstruction,
        budgetState: {
            ...base.budgetState,
            followUpRoundCount: base.budgetState.followUpRoundCount + 1,
        },
        diagnostics: [
            ...base.diagnostics,
            {
                type: "same_source_follow_up",
                message: "A tool result requested same-source follow-up, so targeted lower-level tools are available for the next turn.",
            },
            ...(options.diagnostics ?? []),
        ],
    });
}

/** Extracts the allowed/blocked tool-name sets from a snapshot, returning undefined if unconstrained. */
export function toolConstraintsFromAgentControlSnapshot(
    snapshot: AgentControlSnapshot | undefined,
): AgentControlToolConstraints | undefined {
    if (!snapshot) return undefined;
    if (snapshot.exposureMode === "final-only" || snapshot.toolMode === "final_answer_only") {
        return {
            allowedToolNames: new Set(),
            ...(snapshot.blockedToolNames ? { blockedToolNames: snapshot.blockedToolNames } : {}),
        };
    }
    if (!snapshot.allowedToolNames && !snapshot.blockedToolNames) {
        return undefined;
    }
    return {
        ...(snapshot.allowedToolNames ? { allowedToolNames: new Set(snapshot.allowedToolNames) } : {}),
        ...(snapshot.blockedToolNames ? { blockedToolNames: new Set(snapshot.blockedToolNames) } : {}),
    };
}

/** Produces a JSON-serializable summary of a snapshot for logging and diagnostics. */
export function summarizeAgentControlSnapshot(
    snapshot: AgentControlSnapshot,
): Record<string, unknown> {
    return {
        exposureMode: snapshot.exposureMode,
        sourceScope: snapshot.sourceScope,
        ...(snapshot.allowedToolNames ? { allowedToolNames: [...snapshot.allowedToolNames].sort() } : {}),
        ...(snapshot.blockedToolNames ? { blockedToolNames: [...snapshot.blockedToolNames].sort() } : {}),
        ...(Object.keys(snapshot.blockedReasons).length > 0 ? { blockedReasons: snapshot.blockedReasons } : {}),
        ...(snapshot.toolMode ? { toolMode: snapshot.toolMode } : {}),
        budgetState: snapshot.budgetState,
        diagnosticTypes: snapshot.diagnostics.map((diagnostic) => diagnostic.type),
    };
}

function inferExposureMode(options: CreateAgentControlSnapshotOptions): PaAgentToolExposureMode {
    if (options.allowedToolNames) return "source-scoped";
    return "semantic-first";
}

function inferSourceScope(allowedToolNames: ReadonlySet<string> | undefined): PaAgentSourceScope {
    const sourceToolNames = allowedToolNames ? [...allowedToolNames].filter(isSourceToolName) : [];
    if (sourceToolNames.length === 0) return "none";
    if (sourceToolNames.length > 1) return "mixed";
    if (sourceToolNames.includes("search_memory")) return "notes";
    if (sourceToolNames.includes("get_current_note_context")) return "current_note";
    if (sourceToolNames.includes("webSearch")) return "web";
    return "mixed";
}

function isSourceToolName(toolName: string): boolean {
    return toolName === "search_memory"
        || toolName === "get_current_note_context"
        || toolName === "webSearch";
}

function subtractTools(
    tools: ReadonlySet<string>,
    blockedToolNames: ReadonlySet<string>,
): Set<string> {
    return new Set([...tools].filter((toolName) => !blockedToolNames.has(toolName)));
}

function intersectTools(
    left: ReadonlySet<string>,
    right: ReadonlySet<string>,
): Set<string> {
    return new Set([...left].filter((toolName) => right.has(toolName)));
}

function unionTools(...sets: ReadonlySet<string>[]): Set<string> {
    const result = new Set<string>();
    for (const set of sets) {
        for (const toolName of set) {
            result.add(toolName);
        }
    }
    return result;
}

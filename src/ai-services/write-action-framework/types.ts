import type {
    AgentCapability,
    AgentCapabilityContext,
    AgentCapabilityResult,
} from "../capability-types";

/**
 * Write Action Framework v1 — type skeleton (Step 0).
 *
 * v1 仅支持一种 action family（create-file）；扩展到 append / replace / multi-file / command
 * 推迟到 Operations Agent mode (v2+)。详见 docs/write-action-framework-sdd.md §1.4。
 */
export type WriteActionFamily = "create-file";

/**
 * 5 区块 preview spec (framework SDD §2.1 + §7.1)。Preview modal 渲染 + LLM 不可绕开。
 */
export interface PreviewSpec {
    target: { path: string; category: string };
    contentMarkdown: string;
    impact: string;
    risk: string;
    action: string;
}

/**
 * Preview-confirmation lifecycle 的 4 个 outcome (framework SDD §2.1)。
 * - confirmed: 用户点 "采纳"
 * - cancelled: 用户点 "取消"
 * - closed:    modal 被关闭（X 按钮 / ESC）
 * - aborted:   abort signal（turn timeout / runtime abort）
 */
export type ConfirmationOutcome = "confirmed" | "cancelled" | "closed" | "aborted";

/**
 * Framework 在调用 executeWrite 时提供的辅助 hooks。
 */
export interface WriteActionExecuteHooks {
    /**
     * 标记 self-write，防止 capability 自身的 modify event listener 被自家 write 触发形成循环。
     * Framework 维护一个 5s TTL 的 Set；capability MUST 在调 vault.adapter.write 之前调用。
     */
    markSelfWrite(path: string): void;
}

/**
 * Per-capability target confinement rule (framework SDD §2.2 / §3.1).
 *
 * Declared on each WriteActionCapability so Gate 1 can validate target paths
 * before buildPreview/executeWrite. ConfinementConfig is the runtime-facing alias.
 */
export interface ConfinementConfig {
    /** Allowed vault-relative path prefixes (e.g., [".pagelet/"]). Required, non-empty. */
    allowedRoots: string[];
    /** Allowed file extensions (e.g., [".md"]). Required, non-empty. */
    allowedExtensions: string[];
    /** Max normalized path length. Default 200 (framework SDD §2.2). */
    maxPathLength?: number;
    /** Optional caller-supplied additional reject patterns; runs after built-in categorized checks. */
    rejectPatterns?: readonly RegExp[];
}

/**
 * Stale-reread target snapshot (framework SDD §2.3 mode A).
 *
 * Captured at Gate 2 (preview shown) and re-validated at Gate 3 (before execute).
 * Drift on folderExists / targetExists → reject + emit `gate.stale-reread.drift`.
 */
export interface TargetSnapshot {
    targetPath: string;
    folderExists: boolean;
    targetExists: boolean;
    /** Date.now() at capture time. Useful for debug emit aging analysis. */
    capturedAt: number;
}

/**
 * Write Action Capability — MUST be invoked via framework ActionExecutor.
 *
 * Framework 4-gate 流程：
 *   target-confinement → preview-confirmation → stale-reread → executeWrite
 *
 * **重要**：继承自 AgentCapability 的 `execute()` 方法 MUST throw（标准实现见 framework SDD §3.2），
 * 防止任何代码绕过 framework 直接调用 capability.execute() 导致写入未经 4 gates 校验。
 */
export interface WriteActionCapability extends AgentCapability {
    kind: "action";
    requiresConfirmation: true;
    executionMode: "sequential";
    actionFamily: WriteActionFamily;
    /** Debug emit 分类标签（如 "pagelet-review-note"）。用于 debug observer 聚合分析 */
    targetCategory: string;
    /** Per-capability path allowlist + extension + rejectPatterns (framework SDD §2.2). */
    targetConfinement: ConfinementConfig;

    /**
     * 由 framework Gate 2 (preview-confirmation lifecycle) 调用。
     * 返回 5 区块 PreviewSpec 供 modal 渲染。MUST 是纯函数（无副作用）。
     *
     * 同时被 Gate 1 用来提取 target 候选路径（spec.target.path）。
     */
    buildPreview(input: unknown, context: AgentCapabilityContext): Promise<PreviewSpec>;

    /**
     * 由 framework Execute 阶段调用（所有 gates 通过后）。
     * Capability 拥有真实 vault API，framework 不直接写文件；framework 提供 markSelfWrite hook。
     */
    executeWrite(
        input: unknown,
        context: AgentCapabilityContext,
        hooks: WriteActionExecuteHooks,
    ): Promise<AgentCapabilityResult>;

    /**
     * 可选 rollback：当 executeWrite 失败且 capability 已部分写入时由 framework 调用清理。
     * 失败时 framework debug emit "rollback.fail"；成功时 emit "rollback.ok"。
     */
    rollback?(input: unknown, context: AgentCapabilityContext): Promise<void>;
}

/**
 * Debug observability hook events (framework SDD §2.4)。
 * 10 种 event type 覆盖 4 gates + execute + rollback 的成功/失败路径。
 * **非 production audit**——不持久化、不写文件，仅 emit 到 DebugObserver。
 */
export type DebugEventType =
    | "gate.target-confinement.ok"
    | "gate.target-confinement.reject"
    | "gate.preview.shown"
    | "gate.confirmation.received"
    | "gate.stale-reread.ok"
    | "gate.stale-reread.drift"
    | "execute.ok"
    | "execute.fail"
    | "rollback.ok"
    | "rollback.fail";

export type DebugErrorCategory =
    | "rejected_at_confinement"
    | "fs_error"
    | "policy_violation"
    | "stale_drift"
    | "unknown";

export interface DebugEvent {
    type: DebugEventType;
    capabilityId: string;
    runId: string;
    turnId: string;
    /** 仅 execute / rollback 事件携带；其他 gate 事件可省略 */
    durationMs?: number;
    /** 仅失败类事件携带 */
    errorCategory?: DebugErrorCategory;
    /** 自由 payload；framework 内部模块按 event type 约定结构 */
    extra?: Record<string, unknown>;
}

/**
 * Debug observer 接口。Framework 内置两个实现：
 * - NoopDebugObserver: production 默认，零开销
 * - ConsoleDebugObserver: 开发默认，console.debug 输出
 *
 * 未来 production audit 接入时（见 framework SDD §10 升级触发），可注入 PersistentAuditObserver
 * 实现而无需改 framework 内核。
 */
export interface DebugObserver {
    emit(event: DebugEvent): void;
}

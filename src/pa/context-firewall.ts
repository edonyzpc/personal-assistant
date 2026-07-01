import { normalizeVaultPath } from "./helpers";
import type { ConfirmedMemoryRecord } from "./memory-governance-store";

export const CONTEXT_FIREWALL_DECISIONS = ["auto_include", "ask_user", "drop"] as const;
export type ContextFirewallDecisionKind = typeof CONTEXT_FIREWALL_DECISIONS[number];

export const CONTEXT_FIREWALL_REASONS = [
    "in_scope_low_risk",
    "scope_mismatch",
    "archived",
    "forgotten",
    "stale",
    "medium_sensitivity",
    "high_sensitivity",
    "task_constraint",
] as const;
export type ContextFirewallReason = typeof CONTEXT_FIREWALL_REASONS[number];

export interface ContextFirewallDecision {
    decision: ContextFirewallDecisionKind;
    reason: ContextFirewallReason;
    memoryId: string;
}

function memoryMatchesScope(memory: ConfirmedMemoryRecord, scopePaths: readonly string[] = []): boolean {
    if (scopePaths.length === 0) return true;
    const requested = new Set(scopePaths.map(normalizeVaultPath));
    const memoryPaths = (memory.scope.paths ?? []).map(normalizeVaultPath);
    if (memoryPaths.length === 0) return true;
    return memoryPaths.some((path) => requested.has(path));
}

export function decideContextFirewall(
    memory: ConfirmedMemoryRecord,
    options: { scopePaths?: readonly string[] } = {},
): ContextFirewallDecision {
    if (memory.lifecycle === "forgotten_tombstone") {
        return { decision: "drop", reason: "forgotten", memoryId: memory.id };
    }
    if (memory.lifecycle === "archived" || memory.lifecycle === "exported") {
        return { decision: "drop", reason: "archived", memoryId: memory.id };
    }
    if (!memoryMatchesScope(memory, options.scopePaths)) {
        return { decision: "drop", reason: "scope_mismatch", memoryId: memory.id };
    }
    if (memory.sensitivity === "high") {
        return { decision: "drop", reason: "high_sensitivity", memoryId: memory.id };
    }
    if (memory.lifecycle === "stale") {
        return { decision: "ask_user", reason: "stale", memoryId: memory.id };
    }
    if (memory.type === "task_constraint") {
        return { decision: "ask_user", reason: "task_constraint", memoryId: memory.id };
    }
    if (memory.sensitivity === "medium") {
        return { decision: "ask_user", reason: "medium_sensitivity", memoryId: memory.id };
    }
    return { decision: "auto_include", reason: "in_scope_low_risk", memoryId: memory.id };
}

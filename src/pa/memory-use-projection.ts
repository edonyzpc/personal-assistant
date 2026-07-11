import { sanitizeUserProfileMarkdownForPrompt } from "../ai-services/memory-extraction/type-a-extractor";
import { MEMORY_TYPES, type ReviewQueueScope } from "./contracts";
import { normalizeVaultPath } from "./helpers";
import type { VaultInsightsReadSnapshot } from "./memory-control-center";
import type {
    GovernedMemoryClaim,
    MemoryClaimRevision,
    MemoryPartitionKey,
    MemoryPendingOperation,
    MemorySuppressionMarker,
} from "./memory-governance-persistence";

export const MAX_GOVERNED_MEMORY_CONTEXT_CHARS = 6_000;

const MAX_CLAIM_SUMMARY_CHARS = 480;
const MAX_VAULT_INSIGHTS_LINE_CHARS = 2_500;
const MAX_VAULT_INSIGHT_ROWS = 4;
const MAX_VAULT_INSIGHT_PATHS = 3;
const CONTEXT_OPEN = '<governed_memory_context context_only="true" grants_tool_authority="false" grants_write_authority="false" grants_network_authority="false" grants_external_action_authority="false">';
const CONTEXT_CLOSE = "</governed_memory_context>";
const SUPPORTED_EFFECTS = new Set<GovernedMemoryClaim["effect"]>([
    "future_answers",
    "collaboration_default",
]);
const ALLOWED_MEMORY_TYPES = new Set<string>(MEMORY_TYPES);
// eslint-disable-next-line no-control-regex
const CLAIM_CONTROL_CHARS_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
// eslint-disable-next-line no-control-regex
const SCALAR_CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/g;

const ACTION_AUTHORITY_PATTERNS: readonly RegExp[] = [
    /\b(?:shell|terminal|tools?|tool calls?|command execution|run commands?|execute commands?)\b/i,
    /\b(?:call|invoke|access)\b.{0,20}\b(?:api|service|endpoint|tool)\b/i,
    /\b(?:delete|edit|rewrite|rename|move|create|write)\b.{0,35}\b(?:notes?|files?|vault)\b/i,
    /\b(?:create|update|delete|complete|reschedule|cancel)\b.{0,25}\b(?:tasks?|events?|reminders?|calendar)\b/i,
    /\b(?:send|publish|post|email|pay|purchase|buy)\b/i,
    /\b(?:web search|browse the web|internet access|network access|go online)\b/i,
    /\b(?:ignore|override|disregard)\b.{0,40}\b(?:instructions?|system|developer|prompt)\b|\byou are now\b/i,
    /(?:终端|工具调用|调用工具|使用工具|调用\s*API|访问\s*API|执行命令|运行命令|shell)/iu,
    /(?:删除|修改|改写|重命名|移动|创建|写入).{0,18}(?:笔记|文件|vault)/iu,
    /(?:创建|更新|删除|完成|改期|取消).{0,15}(?:任务|事件|提醒|日历)/u,
    /(?:发送|发布|发邮件|支付|付款|购买|联网|上网|网络搜索|网页搜索)/u,
    /(?:忽略|覆盖|无视).{0,24}(?:指令|系统|开发者|提示词)|你现在是/u,
];

export interface MemorySuppressionFingerprintRef {
    sourceFingerprintId: string;
    ruleFingerprint: string;
}

export interface GovernedMemoryUseInput {
    vaultScopeKey: string;
    currentScope: {
        notePath?: string;
        folderPath?: string;
        tags: string[];
    };
    claims: readonly GovernedMemoryClaim[];
    revisions: readonly MemoryClaimRevision[];
    suppressionMarkers: readonly MemorySuppressionMarker[];
    pendingOperations: readonly MemoryPendingOperation[];
    /**
     * Exact lineage output from projection/admission persistence. Callers must
     * never derive these fingerprints from claim text or semantic similarity.
     * A missing entry is unknown, not a suppression match.
     */
    claimSuppressionFingerprints: Readonly<Record<string, MemorySuppressionFingerprintRef | undefined>>;
    includeVaultInsights: boolean;
    vaultInsights: VaultInsightsReadSnapshot | null;
    currentDataBoundaryFingerprint: string;
    dataBoundaryAllowed: (revision: MemoryClaimRevision) => boolean;
}

export interface GovernedMemoryUseResult {
    boundedContext: string;
    usedClaimIds: string[];
}

export interface MemoryContextCompatibilityPort {
    getMode(vaultScopeKey: string): "legacy" | "governed";
    readLegacyContext(): { userProfile?: string; vaultInsights?: string };
    readGovernedContext(input: GovernedMemoryUseInput): GovernedMemoryUseResult;
}

export type MemoryContextCompatibilityResult =
    | {
        mode: "legacy";
        legacyContext: { userProfile?: string; vaultInsights?: string };
        governedContext?: never;
    }
    | {
        mode: "governed";
        governedContext: GovernedMemoryUseResult;
        legacyContext?: never;
    };

interface SelectedClaim {
    claim: GovernedMemoryClaim;
    revision: MemoryClaimRevision;
    summary: string;
}

/**
 * Selects only currently eligible governed Memory as context-only prompt data.
 * The result has no tool definitions, capabilities, or action authorization.
 */
export function selectGovernedMemoryUse(
    input: GovernedMemoryUseInput,
): GovernedMemoryUseResult {
    const revisions = indexUniqueRevisions(input.revisions);
    const claimCounts = countClaimIds(input.claims);
    const selected = [...input.claims]
        .sort(compareClaims)
        .map((claim) => selectClaim(claim, input, revisions, claimCounts))
        .filter((value): value is SelectedClaim => value !== null);
    const vaultInsightsLine = buildVaultInsightsLine(input);
    const availableChars = MAX_GOVERNED_MEMORY_CONTEXT_CHARS
        - CONTEXT_OPEN.length
        - CONTEXT_CLOSE.length
        - 2;
    const reservedForVaultInsights = vaultInsightsLine ? vaultInsightsLine.length + 1 : 0;
    const claimBudget = Math.max(0, availableChars - reservedForVaultInsights);
    const lines: string[] = [];
    const usedClaimIds: string[] = [];
    let claimChars = 0;

    for (const selection of selected) {
        const line = encodeContextJson({
            kind: "governed_claim",
            claimId: selection.claim.id,
            effect: selection.claim.effect,
            authority: selection.revision.authority,
            content: selection.summary,
        });
        const separatorChars = lines.length > 0 ? 1 : 0;
        if (claimChars + separatorChars + line.length > claimBudget) break;
        lines.push(line);
        claimChars += separatorChars + line.length;
        usedClaimIds.push(selection.claim.id);
    }

    if (vaultInsightsLine && totalLineChars(lines) + (lines.length > 0 ? 1 : 0)
        + vaultInsightsLine.length <= availableChars) {
        lines.push(vaultInsightsLine);
    }
    if (lines.length === 0) return { boundedContext: "", usedClaimIds: [] };

    return {
        boundedContext: `${CONTEXT_OPEN}\n${lines.join("\n")}\n${CONTEXT_CLOSE}`,
        usedClaimIds,
    };
}

/**
 * Reads one compatibility path after one mode snapshot. The helper never reads
 * or concatenates both legacy and governed contexts in the same call.
 */
export function readCompatibleMemoryContext(
    port: MemoryContextCompatibilityPort,
    input: GovernedMemoryUseInput,
): MemoryContextCompatibilityResult {
    const mode = port.getMode(input.vaultScopeKey);
    if (mode === "legacy") {
        const legacy = port.readLegacyContext();
        return {
            mode,
            legacyContext: {
                ...(typeof legacy.userProfile === "string" ? { userProfile: legacy.userProfile } : {}),
                ...(typeof legacy.vaultInsights === "string" ? { vaultInsights: legacy.vaultInsights } : {}),
            },
        };
    }
    const governed = port.readGovernedContext(input);
    return {
        mode: "governed",
        governedContext: {
            boundedContext: governed.boundedContext,
            usedClaimIds: [...governed.usedClaimIds],
        },
    };
}

function selectClaim(
    claim: GovernedMemoryClaim,
    input: GovernedMemoryUseInput,
    revisions: ReadonlyMap<string, MemoryClaimRevision | null>,
    claimCounts: ReadonlyMap<string, number>,
): SelectedClaim | null {
    if (!claim || typeof claim.id !== "string" || claimCounts.get(claim.id) !== 1) return null;
    if (claim.lifecycle !== "active") return null;
    if (!ALLOWED_MEMORY_TYPES.has(claim.memoryType)) return null;
    if (claim.sensitivity !== "low") return null;
    if (!SUPPORTED_EFFECTS.has(claim.effect)) return null;
    if (!claim.activeRevisionId) return null;

    const revision = revisions.get(claim.activeRevisionId);
    if (!revision || revision.claimId !== claim.id || revision.provenance.length === 0) return null;
    if (!partitionAllowsUse(claim, revision, input.vaultScopeKey)) return null;
    if (!scopeApplies(claim.applicability, input.currentScope)) return null;
    if (hasPendingOperation(claim.id, input.pendingOperations)) return null;
    const suppressionState = exactSuppressionState(claim, input);
    if (suppressionState !== "clear") return null;
    if (!isDataBoundaryAllowed(revision, input.dataBoundaryAllowed)) return null;

    const summary = sanitizeClaimSummary(revision.summary);
    if (!summary) return null;
    return { claim, revision, summary };
}

function partitionAllowsUse(
    claim: GovernedMemoryClaim,
    revision: MemoryClaimRevision,
    vaultScopeKey: string,
): boolean {
    if (claim.partition.kind === "vault") {
        if (!vaultScopeKey.trim() || claim.partition.key !== vaultScopeKey) return false;
        if (claim.effect === "collaboration_default") {
            return revision.authority === "explicit_user" || revision.authority === "user_correction";
        }
        return true;
    }
    return claim.partition.kind === "device_collaboration"
        && claim.partition.key === "device"
        && claim.effect === "collaboration_default"
        && claim.applicability.kind === "whole_vault"
        && (revision.authority === "explicit_user" || revision.authority === "user_correction");
}

function scopeApplies(
    applicability: ReviewQueueScope,
    currentScope: GovernedMemoryUseInput["currentScope"],
): boolean {
    switch (applicability.kind) {
        case "whole_vault":
            return true;
        case "current_note":
        case "selected_notes": {
            const notePath = normalizedPathOrNull(currentScope.notePath);
            return Boolean(notePath && applicability.paths?.some((path) => normalizeVaultPath(path) === notePath));
        }
        case "folder": {
            const folderPath = normalizedPathOrNull(currentScope.folderPath);
            return Boolean(folderPath && applicability.paths?.some((path) => normalizeVaultPath(path) === folderPath));
        }
        case "tag": {
            const currentTags = new Set(currentScope.tags.map(normalizeTag).filter(Boolean));
            return Boolean(applicability.tags?.some((tag) => currentTags.has(normalizeTag(tag))));
        }
        case "custom":
            return false;
    }
}

function hasPendingOperation(
    claimId: string,
    operations: readonly MemoryPendingOperation[],
): boolean {
    return operations.some((operation) => operation.claimId === claimId
        && (operation.kind === "forget" || operation.state === "pending"));
}

function exactSuppressionState(
    claim: GovernedMemoryClaim,
    input: GovernedMemoryUseInput,
): "clear" | "matched" | "unknown" {
    const fingerprint = input.claimSuppressionFingerprints[claim.id];
    if (!fingerprint?.sourceFingerprintId || !fingerprint.ruleFingerprint) return "unknown";
    return input.suppressionMarkers.some((marker) => partitionsEqual(marker.partition, claim.partition)
        && marker.sourceFingerprintId === fingerprint.sourceFingerprintId
        && marker.ruleFingerprint === fingerprint.ruleFingerprint)
        ? "matched"
        : "clear";
}

function isDataBoundaryAllowed(
    revision: MemoryClaimRevision,
    predicate: GovernedMemoryUseInput["dataBoundaryAllowed"],
): boolean {
    try {
        return predicate(revision) === true;
    } catch {
        return false;
    }
}

function sanitizeClaimSummary(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const withoutControls = value.replace(CLAIM_CONTROL_CHARS_RE, " ").trim();
    if (!withoutControls || ACTION_AUTHORITY_PATTERNS.some((pattern) => pattern.test(withoutControls))) {
        return null;
    }
    const sanitized = sanitizeUserProfileMarkdownForPrompt(withoutControls)
        .replace(/\s+/g, " ")
        .trim();
    if (!sanitized) return null;
    return sanitized.slice(0, MAX_CLAIM_SUMMARY_CHARS).trimEnd();
}

function buildVaultInsightsLine(input: GovernedMemoryUseInput): string | null {
    if (!input.includeVaultInsights || !input.vaultInsights) return null;
    if (!input.currentDataBoundaryFingerprint.trim()
        || input.vaultInsights.dataBoundaryFingerprint !== input.currentDataBoundaryFingerprint) return null;

    try {
        const snapshot = input.vaultInsights.snapshot;
        const core = {
            kind: "vault_insights",
            generatedAt: sanitizeScalar(snapshot.generatedAt),
            fileCount: finiteCount(snapshot.fileCount),
        };
        const payload = {
            ...core,
            folderThemes: sortCountRows(snapshot.folderThemes, "folder"),
            tagTaxonomy: sortCountRows(snapshot.tagTaxonomy, "tag"),
            hubNotes: [...snapshot.linkTopology.hubNotes]
                .map((entry) => ({
                    path: sanitizeScalar(entry.path),
                    inbound: finiteCount(entry.inbound),
                    outbound: finiteCount(entry.outbound),
                }))
                .filter((entry) => entry.path)
                .sort((left, right) => right.inbound - left.inbound || compareText(left.path, right.path))
                .slice(0, MAX_VAULT_INSIGHT_ROWS),
            unresolvedLinks: sortCountRows(snapshot.linkTopology.unresolvedLinks, "target"),
            writingHabits: {
                averageWords: finiteCount(snapshot.writingHabits.averageWords),
                busiestWeekdays: sortCountRows(snapshot.writingHabits.busiestWeekdays, "weekday"),
                recentlyActive: snapshot.writingHabits.recentlyActive
                    .map(sanitizeScalar)
                    .filter(Boolean)
                    .sort(compareText)
                    .slice(0, MAX_VAULT_INSIGHT_PATHS),
            },
            topicClusters: [...snapshot.topicClusters]
                .map((entry) => ({
                    label: sanitizeScalar(entry.label),
                    paths: entry.paths.map(sanitizeScalar).filter(Boolean)
                        .sort(compareText)
                        .slice(0, MAX_VAULT_INSIGHT_PATHS),
                }))
                .filter((entry) => entry.label)
                .sort((left, right) => compareText(left.label, right.label))
                .slice(0, MAX_VAULT_INSIGHT_ROWS),
            knowledgeGaps: [...snapshot.knowledgeGaps]
                .map((entry) => ({
                    label: sanitizeScalar(entry.label),
                    evidence: sanitizeScalar(entry.evidence),
                }))
                .filter((entry) => entry.label && entry.evidence)
                .sort((left, right) => compareText(left.label, right.label))
                .slice(0, MAX_VAULT_INSIGHT_ROWS),
            trends: sortCountRows(snapshot.trends, "label"),
        };
        const encoded = encodeContextJson(payload);
        if (encoded.length <= MAX_VAULT_INSIGHTS_LINE_CHARS) return encoded;
        return encodeContextJson({
            ...core,
            folderThemes: payload.folderThemes.slice(0, 2),
            tagTaxonomy: payload.tagTaxonomy.slice(0, 2),
            topicClusters: payload.topicClusters.slice(0, 2),
            trends: payload.trends.slice(0, 2),
        });
    } catch {
        return null;
    }
}

function sortCountRows<T extends Record<K, string> & { count: number }, K extends keyof T>(
    rows: readonly T[],
    key: K,
): Array<{ label: string; count: number }> {
    return [...rows]
        .map((row) => ({ label: sanitizeScalar(row[key]), count: finiteCount(row.count) }))
        .filter((row) => row.label)
        .sort((left, right) => right.count - left.count || compareText(left.label, right.label))
        .slice(0, MAX_VAULT_INSIGHT_ROWS);
}

function encodeContextJson(value: unknown): string {
    return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => {
        return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
    });
}

function sanitizeScalar(value: unknown): string {
    if (typeof value !== "string") return "";
    return value
        .replace(SCALAR_CONTROL_CHARS_RE, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160);
}

function finiteCount(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : 0;
}

function indexUniqueRevisions(
    revisions: readonly MemoryClaimRevision[],
): Map<string, MemoryClaimRevision | null> {
    const indexed = new Map<string, MemoryClaimRevision | null>();
    for (const revision of revisions) {
        if (!revision || typeof revision.id !== "string" || !revision.id) continue;
        indexed.set(revision.id, indexed.has(revision.id) ? null : revision);
    }
    return indexed;
}

function countClaimIds(claims: readonly GovernedMemoryClaim[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const claim of claims) {
        if (!claim || typeof claim.id !== "string" || !claim.id) continue;
        counts.set(claim.id, (counts.get(claim.id) ?? 0) + 1);
    }
    return counts;
}

function compareClaims(left: GovernedMemoryClaim, right: GovernedMemoryClaim): number {
    return compareText(right.updatedAt, left.updatedAt) || compareText(left.id, right.id);
}

function partitionsEqual(left: MemoryPartitionKey, right: MemoryPartitionKey): boolean {
    return left.kind === right.kind && left.key === right.key;
}

function normalizedPathOrNull(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const normalized = normalizeVaultPath(value);
    return normalized || null;
}

function normalizeTag(value: unknown): string {
    if (typeof value !== "string") return "";
    return value.trim().replace(/^#/, "").toLowerCase();
}

function compareText(left: string, right: string): number {
    if (left === right) return 0;
    return left < right ? -1 : 1;
}

function totalLineChars(lines: readonly string[]): number {
    if (lines.length === 0) return 0;
    return lines.reduce((total, line) => total + line.length, 0) + lines.length - 1;
}

export const GENERATED_NOTE_POLICIES = ["exclude-generated", "include-generated", "ask"] as const;
export type GeneratedNotePolicy = typeof GENERATED_NOTE_POLICIES[number];

export const DATA_BOUNDARY_DECISIONS = ["allow", "deny", "ask"] as const;
export type DataBoundaryDecisionKind = typeof DATA_BOUNDARY_DECISIONS[number];

export const DATA_BOUNDARY_REASONS = [
    "allowed_by_policy",
    "excluded_folder",
    "excluded_tag",
    "generated_note",
    "provider_disclosure_required",
    "sensitive_scope",
    "broad_scope",
    "costly_run",
    "memory_preparation",
    "broad_pagelet_review",
    "maintenance_scan",
    "weekly_scan",
    "excluded_override",
    "one_run_override",
    "unsupported_scope",
] as const;

export type DataBoundaryReason = typeof DATA_BOUNDARY_REASONS[number];

export const PROVIDER_DISCLOSURE_REASONS = [
    "first_use",
    "broad_scope",
    "sensitive_scope",
    "costly_run",
    "memory_preparation",
    "broad_pagelet_review",
    "weekly_scan",
    "maintenance_scan",
    "excluded_override",
] as const;

export type ProviderDisclosureReason = typeof PROVIDER_DISCLOSURE_REASONS[number];

export const DATA_CLEANUP_GROUPS = [
    "cache",
    "queue",
    "replay",
    "candidates",
    "confirmed_memory",
    "tombstones",
] as const;

export type DataCleanupGroup = typeof DATA_CLEANUP_GROUPS[number];

export interface DataBoundaryPolicy {
    excludedFolders: string[];
    excludedTags: string[];
    generatedNotePolicy: GeneratedNotePolicy;
}

export interface DataBoundarySourceInput {
    path: string;
    tags?: string[];
    isGenerated?: boolean;
}

export interface DataBoundaryOverride {
    scope: "one-run";
    sourcePath?: string;
    reason: "excluded_override";
}

export interface DataBoundaryDecision {
    decision: DataBoundaryDecisionKind;
    reason: DataBoundaryReason;
    sourcePath?: string;
    policySnapshotId?: string;
    override?: DataBoundaryOverride;
}

export const DEFAULT_DATA_BOUNDARY_POLICY: Readonly<DataBoundaryPolicy> = Object.freeze({
    excludedFolders: [],
    excludedTags: [],
    generatedNotePolicy: "exclude-generated",
});

function normalizeVaultPath(path: string): string {
    return path.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
}

function normalizeTag(tag: string): string {
    return tag.trim().replace(/^#+/, "").toLowerCase();
}

function isInsideFolder(path: string, folder: string): boolean {
    const normalizedPath = normalizeVaultPath(path);
    const normalizedFolder = normalizeVaultPath(folder).replace(/\/$/, "");
    if (!normalizedFolder) return false;
    return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}

function isGeneratedPath(path: string): boolean {
    const normalized = normalizeVaultPath(path);
    return normalized.startsWith(".pagelet/") || normalized.startsWith("pagelet-generated/");
}

export function decideDataBoundaryForSource(
    source: DataBoundarySourceInput,
    policy: DataBoundaryPolicy = DEFAULT_DATA_BOUNDARY_POLICY,
    override?: DataBoundaryOverride,
): DataBoundaryDecision {
    const path = normalizeVaultPath(source.path);
    const excludedTags = new Set(policy.excludedTags.map(normalizeTag).filter(Boolean));
    if (override?.scope === "one-run" && (!override.sourcePath || normalizeVaultPath(override.sourcePath) === path)) {
        return { decision: "allow", reason: "one_run_override", sourcePath: path, override };
    }
    if (policy.excludedFolders.some((folder) => isInsideFolder(path, folder))) {
        return { decision: "deny", reason: "excluded_folder", sourcePath: path };
    }
    const tags = source.tags?.map(normalizeTag).filter(Boolean) ?? [];
    if (tags.some((tag) => excludedTags.has(tag))) {
        return { decision: "deny", reason: "excluded_tag", sourcePath: path };
    }
    if ((source.isGenerated || isGeneratedPath(path)) && policy.generatedNotePolicy === "exclude-generated") {
        return { decision: "deny", reason: "generated_note", sourcePath: path };
    }
    if ((source.isGenerated || isGeneratedPath(path)) && policy.generatedNotePolicy === "ask") {
        return { decision: "ask", reason: "generated_note", sourcePath: path };
    }
    return { decision: "allow", reason: "allowed_by_policy", sourcePath: path };
}

export function getProviderDisclosureReason(input: {
    firstUse?: boolean;
    broadScope?: boolean;
    sensitiveScope?: boolean;
    costlyRun?: boolean;
    memoryPreparation?: boolean;
    broadPageletReview?: boolean;
    weeklyScan?: boolean;
    maintenanceScan?: boolean;
    excludedOverride?: boolean;
}): ProviderDisclosureReason | null {
    if (input.firstUse) return "first_use";
    if (input.broadScope) return "broad_scope";
    if (input.sensitiveScope) return "sensitive_scope";
    if (input.costlyRun) return "costly_run";
    if (input.memoryPreparation) return "memory_preparation";
    if (input.broadPageletReview) return "broad_pagelet_review";
    if (input.weeklyScan) return "weekly_scan";
    if (input.maintenanceScan) return "maintenance_scan";
    if (input.excludedOverride) return "excluded_override";
    return null;
}

import {
    hasForbiddenPersistedTextFields,
    validateSourceRefPathShape,
    type PersistedSourceRef,
    type ReviewQueueScope,
} from "./contracts";
import type { ReviewQueueCreateInput } from "./review-queue-store";

export const MAINTENANCE_PROPOSAL_ACTION_TYPES = [
    "rename",
    "move",
    "archive",
    "add_link",
    "remove_link",
    "frontmatter_status",
    "minor_patch",
    "merge",
    "index_note",
    "delete_candidate",
] as const;

export type MaintenanceProposalActionType = typeof MAINTENANCE_PROPOSAL_ACTION_TYPES[number];

export const MAINTENANCE_REVIEW_CATEGORIES = [
    "inbox_cleanup",
    "better_titles",
    "weak_links",
] as const;

export type MaintenanceReviewCategory = typeof MAINTENANCE_REVIEW_CATEGORIES[number];
export type MaintenanceProposalConfidence = "low" | "medium" | "high";

export interface MaintenanceReviewNote {
    path: string;
    content: string;
    basename?: string;
    dataBoundarySnapshotId?: string;
}

export interface MaintenanceReviewScanOptions {
    now?: Date | (() => Date);
    inboxFolders?: readonly string[];
    unsortedFolders?: readonly string[];
    scopePaths?: readonly string[];
    maxProposalsPerCategory?: number;
    weeklyScanEnabled?: boolean;
}

export interface MaintenanceProposalPreview {
    summary: string;
    sourcePath: string;
    affectedPaths: string[];
    oldPath?: string;
    newPath?: string;
    oldTitle?: string;
    newTitle?: string;
    targetPath?: string;
    linkText?: string;
}

export interface MaintenanceUndoMetadata {
    strategy: "rename_back" | "move_back" | "remove_inserted_link" | "restore_from_snapshot" | "no_write";
    affectedPaths: string[];
    oldPath?: string;
    newPath?: string;
    reversible: boolean;
    note?: string;
}

export interface MaintenanceActionPlan {
    actionType: MaintenanceProposalActionType;
    previewOnly: true;
    applyBoundary: "blocked_until_user_approval";
    permanentDelete?: boolean;
    mergeStrategy?: "create_new_note" | "overwrite_existing";
}

export interface MaintenanceProposal {
    id: string;
    category: MaintenanceReviewCategory;
    actionType: MaintenanceProposalActionType;
    title: string;
    claim: string;
    confidence: MaintenanceProposalConfidence;
    scope: ReviewQueueScope;
    sourceRefs: PersistedSourceRef[];
    preview: MaintenanceProposalPreview;
    undoMetadata: MaintenanceUndoMetadata;
    actionPlan: MaintenanceActionPlan;
    whyShown: string[];
    dataBoundarySnapshotId: string;
    generatedAt: string;
}

export interface MaintenanceReviewCategorySummary {
    category: MaintenanceReviewCategory;
    label: string;
    count: number;
}

export interface MaintenanceReviewRunResult {
    generatedAt: string;
    previewOnly: true;
    weeklyScanEnabled: false;
    totalCount: number;
    categories: MaintenanceReviewCategorySummary[];
    proposals: MaintenanceProposal[];
}

export type MaintenanceProposalValidationResult =
    | { ok: true }
    | { ok: false; reason: string };

const DEFAULT_INBOX_FOLDERS = ["Inbox", "Quick Capture", "0.unsorted", "unsorted", "Unsorted"] as const;
// eslint-disable-next-line no-control-regex
const INVALID_FILE_STEM_CHARS_RE = /[<>:"/\\|?*\x00-\x1f]/g;
const STOPWORDS = new Set([
    "about", "after", "again", "also", "because", "before", "between", "could", "from",
    "have", "into", "note", "notes", "only", "over", "plan", "should", "that", "their",
    "there", "these", "this", "with", "would", "your", "当前", "这个", "一个", "我们",
]);

function normalizeVaultPath(path: string): string {
    return String(path ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/").replace(/\/$/g, "");
}

function basenameFromPath(path: string): string {
    const fileName = normalizeVaultPath(path).split("/").pop() ?? path;
    return fileName.toLowerCase().endsWith(".md") ? fileName.slice(0, -3) : fileName;
}

function fileNameFromPath(path: string): string {
    return normalizeVaultPath(path).split("/").pop() ?? path;
}

function parentFolder(path: string): string {
    const normalized = normalizeVaultPath(path);
    const slash = normalized.lastIndexOf("/");
    return slash > 0 ? normalized.slice(0, slash) : "";
}

function ensureMarkdownExtension(path: string): string {
    return path.toLowerCase().endsWith(".md") ? path : `${path}.md`;
}

function stableHash(text: string): string {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36).padStart(7, "0");
}

function nowIso(now: MaintenanceReviewScanOptions["now"]): string {
    const value = typeof now === "function" ? now() : now;
    return (value ?? new Date()).toISOString();
}

function folderMatches(path: string, folders: readonly string[]): boolean {
    const normalized = normalizeVaultPath(path).toLowerCase();
    return folders
        .map((folder) => normalizeVaultPath(folder).toLowerCase())
        .filter(Boolean)
        .some((folder) => normalized === folder || normalized.startsWith(`${folder}/`));
}

function sanitizeTitle(title: string): string {
    return title
        .replace(/[#*_`[\]]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
}

function sanitizeFileStem(title: string): string {
    const sanitized = sanitizeTitle(title);
    const stem = sanitized
        .replace(INVALID_FILE_STEM_CHARS_RE, "")
        .replace(/\s+/g, " ")
        .trim();
    return stem.length > 0 ? stem : "Organized note";
}

function firstHeading(content: string): string | null {
    const match = content.match(/^\s{0,3}#{1,6}\s+(.+)$/m);
    if (!match) return null;
    const title = sanitizeTitle(match[1]);
    return title.length > 0 ? title : null;
}

function firstMeaningfulLine(content: string): string | null {
    const lines = content.split(/\r?\n/);
    let inFrontmatter = false;
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line === "---") {
            inFrontmatter = !inFrontmatter;
            continue;
        }
        if (inFrontmatter || line.length === 0 || line.startsWith("#") || line.startsWith(">")) continue;
        const title = sanitizeTitle(line.replace(/^[-*]\s+/, ""));
        if (title.length > 0) return title;
    }
    return null;
}

function titleFromNote(note: MaintenanceReviewNote): string {
    return firstHeading(note.content)
        ?? firstMeaningfulLine(note.content)
        ?? "Organized note";
}

function isWeakTitle(basename: string): boolean {
    const normalized = basename
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (normalized.length <= 3) return true;
    if (/^(untitled|new note|quick capture|draft|temp|note)(\s+\d+)?$/.test(normalized)) return true;
    return /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}($|\s)/.test(normalized)
        || /^\d{8}$/.test(normalized);
}

function sourceRef(path: string, generatedAt: string, whyShown: string): PersistedSourceRef {
    return {
        path: normalizeVaultPath(path),
        generatedAt,
        contentHash: stableHash(path),
        whyShown: [whyShown],
        evidenceStrength: "medium",
    };
}

function makeScope(kind: ReviewQueueScope["kind"], paths: readonly string[], label?: string): ReviewQueueScope {
    const scope: ReviewQueueScope = {
        kind,
        paths: paths.map(normalizeVaultPath),
    };
    if (label) scope.label = label;
    return scope;
}

function proposalId(
    category: MaintenanceReviewCategory,
    actionType: MaintenanceProposalActionType,
    parts: readonly string[],
): string {
    return `maint-${category}-${actionType}-${stableHash(parts.map(normalizeVaultPath).join("|"))}`;
}

function createInboxProposal(note: MaintenanceReviewNote, generatedAt: string): MaintenanceProposal {
    const path = normalizeVaultPath(note.path);
    const basename = note.basename ?? basenameFromPath(path);
    const fileName = fileNameFromPath(path);
    const newPath = normalizeVaultPath(`Notes/${fileName}`);
    const whyShown = ["This note is still in an inbox or unsorted capture area."];
    return {
        id: proposalId("inbox_cleanup", "move", [path, newPath]),
        category: "inbox_cleanup",
        actionType: "move",
        title: "Review inbox note destination",
        claim: `${path} appears to be in an inbox or unsorted folder and may need a clearer home.`,
        confidence: "medium",
        scope: makeScope("current_note", [path], basename),
        sourceRefs: [sourceRef(path, generatedAt, whyShown[0])],
        preview: {
            summary: `Preview move from ${path} to ${newPath}.`,
            sourcePath: path,
            affectedPaths: [path, newPath],
            oldPath: path,
            newPath,
        },
        undoMetadata: {
            strategy: "move_back",
            affectedPaths: [path, newPath],
            oldPath: path,
            newPath,
            reversible: true,
        },
        actionPlan: {
            actionType: "move",
            previewOnly: true,
            applyBoundary: "blocked_until_user_approval",
        },
        whyShown,
        dataBoundarySnapshotId: note.dataBoundarySnapshotId ?? "maintenance_scan_local_allow",
        generatedAt,
    };
}

function createTitleProposal(note: MaintenanceReviewNote, generatedAt: string): MaintenanceProposal {
    const path = normalizeVaultPath(note.path);
    const oldTitle = note.basename ?? basenameFromPath(path);
    const newTitle = titleFromNote(note);
    const folder = parentFolder(path);
    const newPath = normalizeVaultPath(`${folder ? `${folder}/` : ""}${ensureMarkdownExtension(sanitizeFileStem(newTitle))}`);
    const whyShown = ["The filename looks temporary or too generic for long-term review."];
    return {
        id: proposalId("better_titles", "rename", [path, newPath]),
        category: "better_titles",
        actionType: "rename",
        title: "Preview clearer note title",
        claim: `${path} has a weak title. Preview a rename from "${oldTitle}" to "${newTitle}".`,
        confidence: firstHeading(note.content) ? "high" : "medium",
        scope: makeScope("current_note", [path], oldTitle),
        sourceRefs: [sourceRef(path, generatedAt, whyShown[0])],
        preview: {
            summary: `Preview rename from ${path} to ${newPath}.`,
            sourcePath: path,
            affectedPaths: [path, newPath],
            oldPath: path,
            newPath,
            oldTitle,
            newTitle,
        },
        undoMetadata: {
            strategy: "rename_back",
            affectedPaths: [path, newPath],
            oldPath: path,
            newPath,
            reversible: true,
        },
        actionPlan: {
            actionType: "rename",
            previewOnly: true,
            applyBoundary: "blocked_until_user_approval",
        },
        whyShown,
        dataBoundarySnapshotId: note.dataBoundarySnapshotId ?? "maintenance_scan_local_allow",
        generatedAt,
    };
}

function extractKeywords(content: string, basename: string): Set<string> {
    const text = `${basename} ${content}`
        .toLowerCase()
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`[^`]*`/g, " ");
    const words = text.match(/[a-z0-9\u4e00-\u9fff]{3,}/g) ?? [];
    return new Set(words.filter((word) => !STOPWORDS.has(word)));
}

function hasWikiLinks(content: string): boolean {
    return /\[\[[^\]]+\]\]/.test(content);
}

function bestLinkTarget(
    source: { path: string; keywords: Set<string> },
    candidates: Array<{ path: string; keywords: Set<string> }>,
): { path: string; shared: string[] } | null {
    let best: { path: string; shared: string[] } | null = null;
    for (const candidate of candidates) {
        if (candidate.path === source.path) continue;
        const shared = [...source.keywords].filter((word) => candidate.keywords.has(word)).slice(0, 5);
        if (shared.length === 0) continue;
        if (!best || shared.length > best.shared.length || (shared.length === best.shared.length && candidate.path < best.path)) {
            best = { path: candidate.path, shared };
        }
    }
    return best;
}

function createLinkProposal(note: MaintenanceReviewNote, targetPath: string, shared: readonly string[], generatedAt: string): MaintenanceProposal {
    const path = normalizeVaultPath(note.path);
    const target = normalizeVaultPath(targetPath);
    const targetTitle = basenameFromPath(target);
    const linkText = `[[${targetTitle}]]`;
    const whyShown = ["This note has few or no links and shares concepts with another note."];
    return {
        id: proposalId("weak_links", "add_link", [path, target]),
        category: "weak_links",
        actionType: "add_link",
        title: "Preview a source-backed link",
        claim: `${path} appears weakly linked and shares ${shared.length} concept${shared.length === 1 ? "" : "s"} with ${target}.`,
        confidence: shared.length >= 2 ? "medium" : "low",
        scope: makeScope("selected_notes", [path, target], "Weak link review"),
        sourceRefs: [
            sourceRef(path, generatedAt, whyShown[0]),
            sourceRef(target, generatedAt, "Potential target note for a maintenance link proposal."),
        ],
        preview: {
            summary: `Preview adding ${linkText} to ${path}.`,
            sourcePath: path,
            affectedPaths: [path],
            targetPath: target,
            linkText,
        },
        undoMetadata: {
            strategy: "remove_inserted_link",
            affectedPaths: [path],
            reversible: true,
            note: "No source note is modified by the preview shell.",
        },
        actionPlan: {
            actionType: "add_link",
            previewOnly: true,
            applyBoundary: "blocked_until_user_approval",
        },
        whyShown,
        dataBoundarySnapshotId: note.dataBoundarySnapshotId ?? "maintenance_scan_local_allow",
        generatedAt,
    };
}

function pushLimited(
    groups: Record<MaintenanceReviewCategory, MaintenanceProposal[]>,
    category: MaintenanceReviewCategory,
    proposal: MaintenanceProposal,
    max: number,
): void {
    if (groups[category].length >= max) return;
    groups[category].push(proposal);
}

export function validateMaintenanceProposal(proposal: MaintenanceProposal): MaintenanceProposalValidationResult {
    if (!MAINTENANCE_PROPOSAL_ACTION_TYPES.includes(proposal.actionType)) {
        return { ok: false, reason: "invalid_action_type" };
    }
    if (!MAINTENANCE_REVIEW_CATEGORIES.includes(proposal.category)) {
        return { ok: false, reason: "invalid_category" };
    }
    if (proposal.actionPlan.previewOnly !== true) return { ok: false, reason: "not_preview_only" };
    if (proposal.actionPlan.applyBoundary !== "blocked_until_user_approval") {
        return { ok: false, reason: "missing_apply_boundary" };
    }
    if (proposal.actionPlan.permanentDelete === true) return { ok: false, reason: "permanent_delete_forbidden" };
    if (proposal.actionType === "merge" && proposal.actionPlan.mergeStrategy !== "create_new_note") {
        return { ok: false, reason: "merge_must_create_new_note" };
    }
    if (!Array.isArray(proposal.preview.affectedPaths) || proposal.preview.affectedPaths.length === 0) {
        return { ok: false, reason: "missing_affected_paths" };
    }
    if (!Array.isArray(proposal.sourceRefs) || proposal.sourceRefs.length === 0) {
        return { ok: false, reason: "missing_source_refs" };
    }
    for (const ref of proposal.sourceRefs) {
        const validation = validateSourceRefPathShape(ref);
        if (!validation.ok) return { ok: false, reason: `invalid_source_ref_${validation.reason}` };
    }
    if (hasForbiddenPersistedTextFields(proposal.sourceRefs)) return { ok: false, reason: "forbidden_source_text" };
    if (hasForbiddenPersistedTextFields(proposal)) return { ok: false, reason: "forbidden_persisted_text" };
    return { ok: true };
}

export function scanMaintenanceReview(
    notes: readonly MaintenanceReviewNote[],
    options: MaintenanceReviewScanOptions = {},
): MaintenanceReviewRunResult {
    const generatedAt = nowIso(options.now);
    const maxProposalsPerCategory = Math.max(1, options.maxProposalsPerCategory ?? 20);
    const inboxFolders = [
        ...DEFAULT_INBOX_FOLDERS,
        ...(options.inboxFolders ?? []),
        ...(options.unsortedFolders ?? []),
    ];
    const scopePaths = options.scopePaths
        ? new Set(options.scopePaths.map(normalizeVaultPath))
        : null;
    const normalizedNotes = notes
        .map((note) => ({
            ...note,
            path: normalizeVaultPath(note.path),
            basename: note.basename ?? basenameFromPath(note.path),
        }))
        .filter((note) => note.path.endsWith(".md"))
        .filter((note) => !scopePaths || scopePaths.has(note.path));

    const proposalsByCategory: Record<MaintenanceReviewCategory, MaintenanceProposal[]> = {
        inbox_cleanup: [],
        better_titles: [],
        weak_links: [],
    };

    for (const note of normalizedNotes) {
        if (folderMatches(note.path, inboxFolders)) {
            pushLimited(proposalsByCategory, "inbox_cleanup", createInboxProposal(note, generatedAt), maxProposalsPerCategory);
        }
        if (isWeakTitle(note.basename ?? basenameFromPath(note.path))) {
            pushLimited(proposalsByCategory, "better_titles", createTitleProposal(note, generatedAt), maxProposalsPerCategory);
        }
    }

    const keywordIndex = normalizedNotes.map((note) => ({
        path: note.path,
        note,
        keywords: extractKeywords(note.content, note.basename ?? basenameFromPath(note.path)),
    }));
    for (const entry of keywordIndex) {
        if (proposalsByCategory.weak_links.length >= maxProposalsPerCategory) break;
        if (hasWikiLinks(entry.note.content) || entry.keywords.size === 0) continue;
        const target = bestLinkTarget(entry, keywordIndex);
        if (!target) continue;
        pushLimited(
            proposalsByCategory,
            "weak_links",
            createLinkProposal(entry.note, target.path, target.shared, generatedAt),
            maxProposalsPerCategory,
        );
    }

    const proposals = MAINTENANCE_REVIEW_CATEGORIES
        .flatMap((category) => proposalsByCategory[category])
        .filter((proposal) => validateMaintenanceProposal(proposal).ok);

    return {
        generatedAt,
        previewOnly: true,
        weeklyScanEnabled: false,
        totalCount: proposals.length,
        categories: MAINTENANCE_REVIEW_CATEGORIES.map((category) => ({
            category,
            label: category,
            count: proposalsByCategory[category].filter((proposal) => validateMaintenanceProposal(proposal).ok).length,
        })),
        proposals,
    };
}

export function maintenanceProposalToReviewQueueInput(
    proposal: MaintenanceProposal,
    options: { admissionReason: ReviewQueueCreateInput["admissionReason"] },
): ReviewQueueCreateInput {
    const validation = validateMaintenanceProposal(proposal);
    if (!validation.ok) {
        throw new Error(`Invalid maintenance proposal: ${validation.reason}`);
    }
    return {
        type: "maintenance_proposal",
        title: proposal.title,
        claim: proposal.claim,
        scope: proposal.scope,
        sourceRefs: proposal.sourceRefs,
        originSurface: "maintenance",
        priority: proposal.confidence === "high" ? "high" : "normal",
        whyShown: proposal.whyShown,
        dataBoundarySnapshotId: proposal.dataBoundarySnapshotId,
        admissionReason: options.admissionReason,
        replayRef: `maintenance:${proposal.id}`,
        metadata: {
            maintenanceProposalId: proposal.id,
            maintenanceCategory: proposal.category,
            maintenanceActionType: proposal.actionType,
            maintenanceConfidence: proposal.confidence,
            previewOnly: true,
            applyBoundary: proposal.actionPlan.applyBoundary,
            sourcePath: proposal.preview.sourcePath,
            oldPath: proposal.preview.oldPath ?? null,
            newPath: proposal.preview.newPath ?? null,
            targetPath: proposal.preview.targetPath ?? null,
            affectedPathCount: proposal.preview.affectedPaths.length,
            undoStrategy: proposal.undoMetadata.strategy,
        },
    };
}

import {
    hasForbiddenPersistedTextFields,
    validateSourceRefPathShape,
    type GeneratedReviewNote,
    type PersistedSourceRef,
} from "./contracts";
import { normalizeVaultPath, cloneSourceRef } from "./helpers";
import type { ConfirmedMemoryRecord } from "./memory-governance-store";
import type { MaintenanceReviewRunResult } from "./maintenance-review";
import type { QuietRecallRunResult } from "./quiet-recall";
import type { ReviewQueueItem } from "./review-queue-store";
import type { SavedInsight } from "./saved-insight-store";
import { isReviewQueueWeeklyCarryoverEligible } from "./review-artifact-lifecycle";

export const WEEKLY_REVIEW_SECTION_TYPES = [
    "noteworthy_notes",
    "saved_insights",
    "memory_candidates",
    "maintenance_proposals",
    "quiet_recall_candidates",
] as const;

export type WeeklyReviewSectionType = typeof WEEKLY_REVIEW_SECTION_TYPES[number];
export type WeeklyReviewItemStatus = "candidate" | "accepted" | "dismissed";

export interface WeeklyReviewRange {
    startDate: string;
    endDate: string;
    days: number;
    label: string;
}

export interface WeeklyReviewSourceNote {
    path: string;
    title?: string;
    modifiedAt: string;
    createdAt?: string;
    sourceRefs?: PersistedSourceRef[];
}

export interface WeeklyReviewItem {
    id: string;
    section: WeeklyReviewSectionType;
    title: string;
    summary: string;
    status: WeeklyReviewItemStatus;
    sourceRefs: PersistedSourceRef[];
    whyShown: string[];
    generatedAt: string;
    sourcePath?: string;
    queueItemId?: string;
    savedInsightId?: string;
    memoryId?: string;
    maintenanceProposalId?: string;
    recallCandidateId?: string;
}

export interface WeeklyReviewSection {
    type: WeeklyReviewSectionType;
    title: string;
    summary: string;
    items: WeeklyReviewItem[];
}

export interface WeeklyReviewRunResult {
    generatedAt: string;
    range: WeeklyReviewRange;
    totalCount: number;
    sections: WeeklyReviewSection[];
}

export interface WeeklyReviewBuildInput {
    now?: Date | (() => Date);
    days?: number;
    notes?: readonly WeeklyReviewSourceNote[];
    reviewQueueItems?: readonly ReviewQueueItem[];
    savedInsights?: readonly SavedInsight[];
    confirmedMemories?: readonly ConfirmedMemoryRecord[];
    maintenanceReview?: MaintenanceReviewRunResult | null;
    quietRecall?: QuietRecallRunResult | null;
    maxItemsPerSection?: number;
}

const DEFAULT_DAYS = 7;
const DEFAULT_MAX_ITEMS_PER_SECTION = 8;

const SECTION_TITLES: Record<WeeklyReviewSectionType, string> = {
    noteworthy_notes: "Noteworthy notes",
    saved_insights: "Saved insights",
    memory_candidates: "Memory candidates",
    maintenance_proposals: "Maintenance proposals",
    quiet_recall_candidates: "Quiet recall candidates",
};

function nowDate(now: WeeklyReviewBuildInput["now"]): Date {
    const value = typeof now === "function" ? now() : now;
    return value ? new Date(value.getTime()) : new Date();
}

function dateKey(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function addUtcDays(date: Date, days: number): Date {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + days);
    return next;
}

function fileStem(path: string): string {
    const name = normalizeVaultPath(path).split("/").pop() ?? path;
    return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

function sourceRefsAreValid(sourceRefs: readonly PersistedSourceRef[]): boolean {
    return sourceRefs.length > 0
        && sourceRefs.every((ref) => validateSourceRefPathShape(ref).ok)
        && !hasForbiddenPersistedTextFields(sourceRefs);
}

function sourceRefForPath(path: string, generatedAt: string): PersistedSourceRef {
    return {
        path: normalizeVaultPath(path),
        generatedAt,
        evidenceStrength: "weak",
        whyShown: ["Modified in weekly review range."],
    };
}

function itemInRange(iso: string, range: WeeklyReviewRange): boolean {
    const timestamp = Date.parse(iso);
    if (!Number.isFinite(timestamp)) return false;
    const key = dateKey(new Date(timestamp));
    return key >= range.startDate && key <= range.endDate;
}

function allowedQueueStatus(item: ReviewQueueItem): boolean {
    return isReviewQueueWeeklyCarryoverEligible(item);
}

function section(type: WeeklyReviewSectionType, items: WeeklyReviewItem[]): WeeklyReviewSection {
    return {
        type,
        title: SECTION_TITLES[type],
        summary: `${items.length} item${items.length === 1 ? "" : "s"}`,
        items,
    };
}

function noteItems(input: WeeklyReviewBuildInput, range: WeeklyReviewRange, generatedAt: string): WeeklyReviewItem[] {
    return (input.notes ?? [])
        .filter((note) => itemInRange(note.modifiedAt, range))
        .filter((note) => normalizeVaultPath(note.path).length > 0)
        .map((note): WeeklyReviewItem => {
            const sourceRefs = note.sourceRefs && sourceRefsAreValid(note.sourceRefs)
                ? note.sourceRefs.map(cloneSourceRef)
                : [sourceRefForPath(note.path, generatedAt)];
            return {
                id: `weekly-note-${normalizeVaultPath(note.path)}`,
                section: "noteworthy_notes",
                title: note.title?.trim() || fileStem(note.path),
                summary: `Modified ${dateKey(new Date(Date.parse(note.modifiedAt)))}.`,
                status: "candidate",
                sourceRefs,
                whyShown: ["Changed during this weekly review range."],
                generatedAt,
                sourcePath: normalizeVaultPath(note.path),
            };
        });
}

function savedInsightItems(input: WeeklyReviewBuildInput, generatedAt: string): WeeklyReviewItem[] {
    return (input.savedInsights ?? [])
        .filter((insight) => insight.status === "active")
        .filter((insight) => sourceRefsAreValid(insight.sourceRefs))
        .map((insight): WeeklyReviewItem => ({
            id: `weekly-insight-${insight.id}`,
            section: "saved_insights",
            title: insight.type,
            summary: insight.text,
            status: "candidate",
            sourceRefs: insight.sourceRefs.map(cloneSourceRef),
            whyShown: insight.whyShown.length > 0 ? [...insight.whyShown] : ["Saved insight is active."],
            generatedAt,
            savedInsightId: insight.id,
            sourcePath: insight.sourceRefs[0]?.path,
        }));
}

function memoryQueueItems(input: WeeklyReviewBuildInput, generatedAt: string): WeeklyReviewItem[] {
    return (input.reviewQueueItems ?? [])
        .filter((item) => (item.type === "memory_candidate" || item.type === "memory_conflict") && allowedQueueStatus(item))
        .filter((item) => sourceRefsAreValid(item.sourceRefs))
        .map((item): WeeklyReviewItem => ({
            id: `weekly-memory-${item.id}`,
            section: "memory_candidates",
            title: item.title,
            summary: item.claim,
            status: "candidate",
            sourceRefs: item.sourceRefs.map(cloneSourceRef),
            whyShown: item.whyShown.length > 0 ? [...item.whyShown] : ["Memory item still needs review."],
            generatedAt,
            queueItemId: item.id,
            sourcePath: item.sourceRefs[0]?.path,
        }));
}

function maintenanceItems(input: WeeklyReviewBuildInput, generatedAt: string): WeeklyReviewItem[] {
    if (input.maintenanceReview?.proposals.length) {
        return input.maintenanceReview.proposals
            .filter((proposal) => sourceRefsAreValid(proposal.sourceRefs))
            .map((proposal): WeeklyReviewItem => ({
                id: `weekly-maintenance-${proposal.id}`,
                section: "maintenance_proposals",
                title: proposal.title,
                summary: proposal.claim,
                status: "candidate",
                sourceRefs: proposal.sourceRefs.map(cloneSourceRef),
                whyShown: proposal.whyShown.length > 0 ? [...proposal.whyShown] : ["Maintenance proposal is preview-only."],
                generatedAt,
                maintenanceProposalId: proposal.id,
                sourcePath: proposal.preview.sourcePath,
            }));
    }
    return (input.reviewQueueItems ?? [])
        .filter((item) => item.type === "maintenance_proposal" && allowedQueueStatus(item))
        .filter((item) => sourceRefsAreValid(item.sourceRefs))
        .map((item): WeeklyReviewItem => ({
            id: `weekly-maintenance-${item.id}`,
            section: "maintenance_proposals",
            title: item.title,
            summary: item.claim,
            status: "candidate",
            sourceRefs: item.sourceRefs.map(cloneSourceRef),
            whyShown: item.whyShown.length > 0 ? [...item.whyShown] : ["Maintenance proposal is ready for review."],
            generatedAt,
            queueItemId: item.id,
            sourcePath: item.sourceRefs[0]?.path,
        }));
}

function quietRecallItems(input: WeeklyReviewBuildInput, generatedAt: string): WeeklyReviewItem[] {
    return (input.quietRecall?.candidates ?? [])
        .filter((candidate) => sourceRefsAreValid(candidate.sourceRefs))
        .map((candidate): WeeklyReviewItem => ({
            id: `weekly-recall-${candidate.id}`,
            section: "quiet_recall_candidates",
            title: candidate.title,
            summary: candidate.summary,
            status: "candidate",
            sourceRefs: candidate.sourceRefs.map(cloneSourceRef),
            whyShown: candidate.whyNow.length > 0 ? [...candidate.whyNow] : ["Quiet recall candidate."],
            generatedAt,
            recallCandidateId: candidate.id,
            savedInsightId: candidate.sourceInsightId,
            sourcePath: candidate.sourceRefs[0]?.path,
        }));
}

export function calculateWeeklyReviewRange(now: Date = new Date(), days = DEFAULT_DAYS): WeeklyReviewRange {
    const normalizedDays = Math.max(1, Math.floor(days));
    const endDate = dateKey(now);
    const startDate = dateKey(addUtcDays(now, -(normalizedDays - 1)));
    return {
        startDate,
        endDate,
        days: normalizedDays,
        label: `${startDate} to ${endDate}`,
    };
}

export function buildWeeklyReview(input: WeeklyReviewBuildInput = {}): WeeklyReviewRunResult {
    const now = nowDate(input.now);
    const generatedAt = now.toISOString();
    const range = calculateWeeklyReviewRange(now, input.days ?? DEFAULT_DAYS);
    const maxItems = input.maxItemsPerSection ?? DEFAULT_MAX_ITEMS_PER_SECTION;
    const sections = [
        section("noteworthy_notes", noteItems(input, range, generatedAt).slice(0, maxItems)),
        section("saved_insights", savedInsightItems(input, generatedAt).slice(0, maxItems)),
        section("memory_candidates", memoryQueueItems(input, generatedAt).slice(0, maxItems)),
        section("maintenance_proposals", maintenanceItems(input, generatedAt).slice(0, maxItems)),
        section("quiet_recall_candidates", quietRecallItems(input, generatedAt).slice(0, maxItems)),
    ];
    return {
        generatedAt,
        range,
        totalCount: sections.reduce((sum, entry) => sum + entry.items.length, 0),
        sections,
    };
}

export function buildWeeklyReviewMarkdown(
    review: WeeklyReviewRunResult,
    acceptedItemIds: readonly string[],
): string {
    const accepted = new Set(filterWeeklyReviewAcceptedItemIds(review, acceptedItemIds));
    const includedSections = review.sections
        .map((entry) => ({
            ...entry,
            items: entry.items.filter((item) => accepted.has(item.id)),
        }))
        .filter((entry) => entry.items.length > 0);
    const itemCount = includedSections.reduce((sum, entry) => sum + entry.items.length, 0);
    const lines: string[] = [
        "---",
        "pagelet: true",
        "pa_type: weekly_review",
        `generatedAt: ${review.generatedAt}`,
        `range: ${review.range.label}`,
        `acceptedItems: ${itemCount}`,
        "---",
        "",
        "# Weekly Review",
        "",
        `Generated: ${review.generatedAt}`,
        `Range: ${review.range.label}`,
        "",
    ];

    if (itemCount === 0) {
        lines.push("No accepted items.");
        return lines.join("\n");
    }

    for (const entry of includedSections) {
        lines.push(`## ${entry.title}`, "");
        for (const item of entry.items) {
            const sourcePaths = [...new Set(item.sourceRefs.map((ref) => normalizeVaultPath(ref.path)).filter(Boolean))];
            lines.push(`- ${item.title}`);
            lines.push(`  - Summary: ${item.summary}`);
            lines.push(`  - Sources: ${sourcePaths.map((path) => `[[${path.replace(/\.md$/i, "")}]]`).join(", ")}`);
            if (item.whyShown.length > 0) {
                lines.push(`  - Why now: ${item.whyShown.slice(0, 3).join("; ")}`);
            }
        }
        lines.push("");
    }

    return lines.join("\n").trimEnd() + "\n";
}

export function filterWeeklyReviewAcceptedItemIds(
    review: WeeklyReviewRunResult,
    acceptedItemIds: readonly string[],
): string[] {
    const reviewItemIds = new Set(review.sections.flatMap((section) => section.items.map((item) => item.id)));
    return [...new Set(acceptedItemIds)].filter((id) => reviewItemIds.has(id));
}

export function buildWeeklyReviewGeneratedNote(
    review: WeeklyReviewRunResult,
    acceptedItemIds: readonly string[],
    targetFolder = ".pagelet",
): GeneratedReviewNote {
    const filteredAcceptedItemIds = filterWeeklyReviewAcceptedItemIds(review, acceptedItemIds);
    const markdown = buildWeeklyReviewMarkdown(review, filteredAcceptedItemIds);
    const fileName = `pagelet-weekly-review-${review.range.endDate}.md`;
    const targetPath = `${targetFolder.replace(/\/$/g, "")}/${fileName}`;
    const accepted = new Set(filteredAcceptedItemIds);
    const sources = [...new Set(
        review.sections
            .flatMap((entry) => entry.items)
            .filter((item) => accepted.has(item.id))
            .flatMap((item) => item.sourceRefs.map((ref) => ref.path)),
    )].map((path) => `[[${path.replace(/\.md$/i, "")}]]`);
    return {
        markdown,
        fileName,
        targetFolder,
        targetPath,
        sources,
        tokenCost: { input: 0, output: 0 },
    };
}

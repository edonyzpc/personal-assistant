import {
    hasForbiddenPersistedTextFields,
    MEMORY_SENSITIVITIES,
    MEMORY_TYPES,
    toReplaySourceRef,
    type MemorySensitivity,
    type MemoryType,
    type PersistedSourceRef,
    type ReviewQueueItem,
    type ReviewQueueItemType,
    type ReviewQueuePriority,
    type ReviewQueueResult,
    type ReviewQueueCreateInput,
} from "./pa";
import type { QuickCapturePostProcessInput } from "./quick-capture";
import { getPluginUiLanguage, pluginT } from "./locales/plugin";

export const QUICK_CAPTURE_ENRICHMENT_SUGGESTION_TYPES = [
    "title",
    "tag",
    "related_note",
    "memory_candidate",
    "task_suggestion",
    "expansion",
] as const;

export type QuickCaptureEnrichmentSuggestionType = typeof QUICK_CAPTURE_ENRICHMENT_SUGGESTION_TYPES[number];

export interface QuickCaptureEnrichmentSuggestion {
    type: QuickCaptureEnrichmentSuggestionType;
    title: string;
    claim: string;
    whyShown: string[];
    priority?: ReviewQueuePriority;
    memoryType?: MemoryType;
    sensitivity?: MemorySensitivity;
}

export interface QuickCaptureEnrichmentRunOptions {
    disclosureAccepted: boolean;
    dataBoundarySnapshotId: string;
    provider?: string;
    model?: string;
    requestDisclosure(input: QuickCapturePostProcessInput): Promise<boolean>;
    markDisclosureAccepted(): Promise<void> | void;
    invokeModel(prompt: string): Promise<string | null>;
    createReviewQueueItem(input: ReviewQueueCreateInput): Promise<ReviewQueueResult<ReviewQueueItem>>;
    now(): Date;
    log?(message: string, ...args: unknown[]): void;
}

export type QuickCaptureEnrichmentRunResult =
    | { status: "cancelled"; queuedCount: 0 }
    | { status: "no_model"; queuedCount: 0 }
    | { status: "empty"; queuedCount: 0 }
    | { status: "queued"; queuedCount: number };

const QUICK_CAPTURE_QUEUEABLE_SUGGESTION_TYPES = [
    "memory_candidate",
    "task_suggestion",
] as const;

type QuickCaptureQueueableSuggestionType = typeof QUICK_CAPTURE_QUEUEABLE_SUGGESTION_TYPES[number];

const QUEUE_TYPE_BY_SUGGESTION_TYPE: Record<QuickCaptureQueueableSuggestionType, ReviewQueueItemType> = {
    memory_candidate: "memory_candidate",
    task_suggestion: "task_suggestion",
};

const ENRICHMENT_TITLE_KEY_MAP: Record<QuickCaptureEnrichmentSuggestionType, string> = {
    title: "plugin.quickCapture.enrichment.title.title",
    tag: "plugin.quickCapture.enrichment.title.tag",
    related_note: "plugin.quickCapture.enrichment.title.relatedNote",
    memory_candidate: "plugin.quickCapture.enrichment.title.memoryCandidate",
    task_suggestion: "plugin.quickCapture.enrichment.title.taskSuggestion",
    expansion: "plugin.quickCapture.enrichment.title.expansion",
};

function getDefaultTitle(type: QuickCaptureEnrichmentSuggestionType): string {
    return pluginT(ENRICHMENT_TITLE_KEY_MAP[type], getPluginUiLanguage());
}

const MAX_SUGGESTIONS = 6;
const MAX_TITLE_CHARS = 120;
const MAX_CLAIM_CHARS = 700;
const MAX_WHY_CHARS = 160;

function cleanInline(value: unknown, maxChars: number): string {
    if (typeof value !== "string") return "";
    const cleaned = value.replace(/\s+/g, " ").trim();
    return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars - 1).trimEnd()}...` : cleaned;
}

function isSuggestionType(value: unknown): value is QuickCaptureEnrichmentSuggestionType {
    return typeof value === "string"
        && (QUICK_CAPTURE_ENRICHMENT_SUGGESTION_TYPES as readonly string[]).includes(value);
}

function isQueueableSuggestion(
    suggestion: QuickCaptureEnrichmentSuggestion,
): suggestion is QuickCaptureEnrichmentSuggestion & { type: QuickCaptureQueueableSuggestionType } {
    return (QUICK_CAPTURE_QUEUEABLE_SUGGESTION_TYPES as readonly string[]).includes(suggestion.type);
}

function isPriority(value: unknown): value is ReviewQueuePriority {
    return value === "low" || value === "normal" || value === "high" || value === "urgent";
}

function isMemoryType(value: unknown): value is MemoryType {
    return typeof value === "string" && (MEMORY_TYPES as readonly string[]).includes(value);
}

function isMemorySensitivity(value: unknown): value is MemorySensitivity {
    return typeof value === "string" && (MEMORY_SENSITIVITIES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function normalizeWhyShown(value: unknown, fallback: string): string[] {
    if (!Array.isArray(value)) return [fallback];
    const reasons = value
        .map((entry) => cleanInline(entry, MAX_WHY_CHARS))
        .filter(Boolean);
    return reasons.length > 0 ? reasons.slice(0, 3) : [fallback];
}

function extractJsonPayload(text: string): string | null {
    const trimmed = text.trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
    const objectStart = trimmed.indexOf("{");
    const objectEnd = trimmed.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) return trimmed.slice(objectStart, objectEnd + 1);
    const arrayStart = trimmed.indexOf("[");
    const arrayEnd = trimmed.lastIndexOf("]");
    if (arrayStart >= 0 && arrayEnd > arrayStart) return trimmed.slice(arrayStart, arrayEnd + 1);
    return null;
}

function normalizeSuggestion(value: unknown): QuickCaptureEnrichmentSuggestion | null {
    if (!isRecord(value) || !isSuggestionType(value.type)) return null;
    const fallbackTitle = getDefaultTitle(value.type);
    const claim = cleanInline(value.claim ?? value.suggestedText ?? value.text, MAX_CLAIM_CHARS);
    if (!claim) return null;
    const suggestion: QuickCaptureEnrichmentSuggestion = {
        type: value.type,
        title: cleanInline(value.title, MAX_TITLE_CHARS) || fallbackTitle,
        claim,
        whyShown: normalizeWhyShown(value.whyShown ?? value.why, pluginT("plugin.quickCapture.enrichment.whyShown", getPluginUiLanguage())),
        priority: isPriority(value.priority) ? value.priority : undefined,
    };
    if (suggestion.type === "memory_candidate") {
        suggestion.memoryType = isMemoryType(value.memoryType) ? value.memoryType : "open_question";
        suggestion.sensitivity = isMemorySensitivity(value.sensitivity) ? value.sensitivity : "low";
    }
    return suggestion;
}

export function parseQuickCaptureEnrichmentResponse(text: string): QuickCaptureEnrichmentSuggestion[] {
    const payload = extractJsonPayload(text);
    if (!payload) return [];
    try {
        const parsed = JSON.parse(payload) as unknown;
        const rawSuggestions = Array.isArray(parsed)
            ? parsed
            : isRecord(parsed) && Array.isArray(parsed.suggestions)
                ? parsed.suggestions
                : [];
        return rawSuggestions
            .map(normalizeSuggestion)
            .filter((suggestion): suggestion is QuickCaptureEnrichmentSuggestion => suggestion !== null)
            .slice(0, MAX_SUGGESTIONS);
    } catch {
        return [];
    }
}

export function buildQuickCaptureEnrichmentPrompt(input: QuickCapturePostProcessInput): string {
    return [
        "You are helping with PA Quick Capture post-processing.",
        "The original capture is already saved. Do not rewrite it and do not create tasks or memory directly.",
        "Return JSON only with a suggestions array. In the current implementation, include only durable suggestions that need later confirmation: memory_candidate or task_suggestion.",
        "Do not include title, tag, related_note, or expansion suggestions yet; those need an explicit Keep UI before they can create review work.",
        "For memory_candidate, include memoryType (preference, decision, project_context, task_constraint, open_question) and sensitivity (low, medium, high). Do not infer sensitive profile facts.",
        "Keep claims short.",
        "Use conservative judgment. Omit weak suggestions.",
        "",
        "JSON shape:",
        "{\"suggestions\":[{\"type\":\"task_suggestion\",\"title\":\"Possible task\",\"claim\":\"...\",\"whyShown\":[\"...\"]}]}",
        "",
        `Capture id: ${input.captureId}`,
        `Saved path: ${input.path}`,
        "Original capture:",
        input.rawText,
    ].join("\n");
}

export function buildQuickCaptureEnrichmentQueueInputs(
    input: QuickCapturePostProcessInput,
    suggestions: readonly QuickCaptureEnrichmentSuggestion[],
    options: {
        dataBoundarySnapshotId: string;
        provider?: string;
        model?: string;
        generatedAt: string;
    },
): ReviewQueueCreateInput[] {
    const sourceRef: PersistedSourceRef = {
        ...toReplaySourceRef({
            path: input.path,
            excerpt: input.rawText,
            generatedAt: input.capturedAt,
            whyShown: ["Original Quick Capture"],
            evidenceStrength: "strong",
        }),
        sourceId: input.captureId,
    };
    return suggestions.filter(isQueueableSuggestion).map((suggestion) => {
        const metadata: Record<string, string | number | boolean | null> = {
            captureId: input.captureId,
            capturePath: input.path,
            suggestionType: suggestion.type,
            aiGenerated: true,
            generatedAt: options.generatedAt,
        };
        if (options.provider) metadata.provider = options.provider;
        if (options.model) metadata.model = options.model;
        if (suggestion.type === "memory_candidate") {
            metadata.memoryType = suggestion.memoryType ?? "open_question";
            metadata.sensitivity = suggestion.sensitivity ?? "low";
        }
        const queueInput: ReviewQueueCreateInput = {
            type: QUEUE_TYPE_BY_SUGGESTION_TYPE[suggestion.type],
            title: suggestion.title,
            claim: suggestion.claim,
            scope: { kind: "current_note", paths: [input.path] },
            sourceRefs: [sourceRef],
            originSurface: "quick_capture",
            priority: suggestion.priority ?? "normal",
            whyShown: suggestion.whyShown,
            dataBoundarySnapshotId: options.dataBoundarySnapshotId,
            admissionReason: suggestion.type === "memory_candidate"
                ? "memory_confirmation_required"
                : "task_confirmation_required",
            metadata,
        };
        return queueInput;
    }).filter((queueInput) => !hasForbiddenPersistedTextFields(queueInput));
}

export async function runQuickCaptureEnrichment(
    input: QuickCapturePostProcessInput,
    options: QuickCaptureEnrichmentRunOptions,
): Promise<QuickCaptureEnrichmentRunResult> {
    if (!options.disclosureAccepted) {
        const confirmed = await options.requestDisclosure(input);
        if (!confirmed) return { status: "cancelled", queuedCount: 0 };
        await options.markDisclosureAccepted();
    }

    const response = await options.invokeModel(buildQuickCaptureEnrichmentPrompt(input));
    if (!response) return { status: "no_model", queuedCount: 0 };

    const suggestions = parseQuickCaptureEnrichmentResponse(response);
    if (suggestions.length === 0) return { status: "empty", queuedCount: 0 };

    const queueInputs = buildQuickCaptureEnrichmentQueueInputs(input, suggestions, {
        dataBoundarySnapshotId: options.dataBoundarySnapshotId,
        provider: options.provider,
        model: options.model,
        generatedAt: options.now().toISOString(),
    });
    let queuedCount = 0;
    for (const queueInput of queueInputs) {
        const result = await options.createReviewQueueItem(queueInput);
        if (result.ok) {
            queuedCount += 1;
        } else {
            options.log?.("Quick Capture enrichment queue item rejected", result.reason);
        }
    }
    return queuedCount > 0
        ? { status: "queued", queuedCount }
        : { status: "empty", queuedCount: 0 };
}

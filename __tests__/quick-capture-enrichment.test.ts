import { describe, expect, it, jest } from "@jest/globals";

import {
    buildQuickCaptureEnrichmentPrompt,
    buildQuickCaptureEnrichmentQueueInputs,
    parseQuickCaptureEnrichmentResponse,
    runQuickCaptureEnrichment,
} from "../src/quick-capture-enrichment";
import { hasForbiddenPersistedTextFields, type ReviewQueueCreateInput, type ReviewQueueItem } from "../src/pa";
import type { QuickCapturePostProcessInput } from "../src/quick-capture";

const captureInput: QuickCapturePostProcessInput = {
    captureId: "qc-test-1",
    rawText: "Need to follow up with Alex about pricing.",
    entry: "- 09:07 Need to follow up with Alex about pricing.",
    destination: "daily",
    path: "2026-06-28.md",
    capturedAt: "2026-06-28T01:07:00.000Z",
};

function okItem(input: ReviewQueueCreateInput): ReviewQueueItem {
    return {
        id: `rq-${input.type}`,
        type: input.type,
        title: input.title,
        claim: input.claim,
        scope: input.scope,
        sourceRefs: input.sourceRefs,
        originSurface: input.originSurface,
        priority: input.priority ?? "normal",
        status: "suggested",
        createdAt: "2026-06-28T01:08:00.000Z",
        updatedAt: "2026-06-28T01:08:00.000Z",
        whyShown: input.whyShown ?? [],
        dataBoundarySnapshotId: input.dataBoundarySnapshotId,
        metadata: input.metadata,
    };
}

describe("Quick Capture enrichment", () => {
    it("parses bounded suggestions but queues only durable review actions", () => {
        const suggestions = parseQuickCaptureEnrichmentResponse(`{
  "suggestions": [
    {"type": "title", "title": "Follow up on pricing", "claim": "Possible title: Follow up on pricing", "whyShown": ["Names a concrete follow-up"]},
    {"type": "task_suggestion", "title": "Possible task", "claim": "Follow up with Alex about pricing.", "whyShown": ["This reads like a task"]},
    {"type": "expansion", "title": "AI expansion", "claim": "This capture points to a pending pricing conversation.", "whyShown": ["Could help when reviewing later"]}
  ]
}`);

        expect(suggestions.map((suggestion) => suggestion.type)).toEqual([
            "title",
            "task_suggestion",
            "expansion",
        ]);

        const queueInputs = buildQuickCaptureEnrichmentQueueInputs(captureInput, suggestions, {
            dataBoundarySnapshotId: "allowed_by_policy",
            provider: "qwen",
            model: "qwen3.6-plus",
            generatedAt: "2026-06-28T01:08:00.000Z",
        });

        expect(queueInputs.map((input) => input.type)).toEqual(["task_suggestion"]);
        expect(queueInputs[0].sourceRefs[0]).toMatchObject({
            path: "2026-06-28.md",
            sourceId: "qc-test-1",
            evidenceStrength: "strong",
        });
        expect(queueInputs[0].sourceRefs[0]).toHaveProperty("excerptHash");
        expect(queueInputs[0].metadata).toMatchObject({
            suggestionType: "task_suggestion",
            aiGenerated: true,
        });
        expect(hasForbiddenPersistedTextFields(queueInputs)).toBe(false);
    });

    it("asks for disclosure before provider work and exits cleanly when cancelled", async () => {
        const requestDisclosure = jest.fn(async () => false);
        const invokeModel = jest.fn(async () => "[]");
        const createReviewQueueItem = jest.fn(async (input: ReviewQueueCreateInput) => ({
            ok: true as const,
            value: okItem(input),
        }));

        const result = await runQuickCaptureEnrichment(captureInput, {
            disclosureAccepted: false,
            dataBoundarySnapshotId: "allowed_by_policy",
            requestDisclosure,
            markDisclosureAccepted: jest.fn(async () => undefined),
            invokeModel,
            createReviewQueueItem,
            now: () => new Date("2026-06-28T01:08:00.000Z"),
        });

        expect(result).toEqual({ status: "cancelled", queuedCount: 0 });
        expect(requestDisclosure).toHaveBeenCalledTimes(1);
        expect(invokeModel).not.toHaveBeenCalled();
        expect(createReviewQueueItem).not.toHaveBeenCalled();
    });

    it("queues only durable suggestions after disclosure without writing tasks or memory directly", async () => {
        const markDisclosureAccepted = jest.fn(async () => undefined);
        const created: ReviewQueueCreateInput[] = [];
        const createReviewQueueItem = jest.fn(async (input: ReviewQueueCreateInput) => {
            created.push(input);
            return { ok: true as const, value: okItem(input) };
        });

        const result = await runQuickCaptureEnrichment(captureInput, {
            disclosureAccepted: false,
            dataBoundarySnapshotId: "allowed_by_policy",
            provider: "qwen",
            model: "qwen3.6-plus",
            requestDisclosure: jest.fn(async () => true),
            markDisclosureAccepted,
            invokeModel: jest.fn(async () => JSON.stringify({
                suggestions: [
                    {
                        type: "title",
                        title: "Follow up on pricing",
                        claim: "Possible title: Follow up on pricing",
                        whyShown: ["Names a concrete follow-up"],
                    },
                    {
                        type: "task_suggestion",
                        title: "Possible task",
                        claim: "Follow up with Alex about pricing.",
                        whyShown: ["The capture asks for a follow-up"],
                    },
                    {
                        type: "memory_candidate",
                        title: "Memory candidate",
                        claim: "Pricing follow-up with Alex may matter later.",
                        whyShown: ["May be useful context later"],
                        memoryType: "preference",
                        sensitivity: "low",
                    },
                    {
                        type: "expansion",
                        title: "AI expansion",
                        claim: "This capture points to a pending pricing conversation.",
                        whyShown: ["Could help when reviewing later"],
                    },
                ],
            })),
            createReviewQueueItem,
            now: () => new Date("2026-06-28T01:08:00.000Z"),
        });

        expect(result).toEqual({ status: "queued", queuedCount: 2 });
        expect(markDisclosureAccepted).toHaveBeenCalledTimes(1);
        expect(created.map((input) => input.type)).toEqual(["task_suggestion", "memory_candidate"]);
        expect(created.every((input) => input.originSurface === "quick_capture")).toBe(true);
        expect(created.every((input) => input.metadata?.captureId === "qc-test-1")).toBe(true);
        expect(created[1].metadata).toMatchObject({
            memoryType: "preference",
            sensitivity: "low",
        });
        expect(hasForbiddenPersistedTextFields(created)).toBe(false);
    });

    it("does not create review debt for lightweight suggestions without an explicit keep action", async () => {
        const createReviewQueueItem = jest.fn(async (input: ReviewQueueCreateInput) => ({
            ok: true as const,
            value: okItem(input),
        }));

        const result = await runQuickCaptureEnrichment(captureInput, {
            disclosureAccepted: true,
            dataBoundarySnapshotId: "allowed_by_policy",
            invokeModel: jest.fn(async () => JSON.stringify({
                suggestions: [
                    {
                        type: "title",
                        title: "Follow up on pricing",
                        claim: "Possible title: Follow up on pricing",
                        whyShown: ["Names a concrete follow-up"],
                    },
                    {
                        type: "tag",
                        title: "Suggested tag",
                        claim: "#pricing",
                        whyShown: ["Names the topic"],
                    },
                    {
                        type: "related_note",
                        title: "Related note",
                        claim: "Pricing notes may be related.",
                        whyShown: ["Same topic"],
                    },
                    {
                        type: "expansion",
                        title: "AI expansion",
                        claim: "This capture points to a pending pricing conversation.",
                        whyShown: ["Could help when reviewing later"],
                    },
                ],
            })),
            requestDisclosure: jest.fn(async () => true),
            markDisclosureAccepted: jest.fn(async () => undefined),
            createReviewQueueItem,
            now: () => new Date("2026-06-28T01:08:00.000Z"),
        });

        expect(result).toEqual({ status: "empty", queuedCount: 0 });
        expect(createReviewQueueItem).not.toHaveBeenCalled();
    });

    it("builds a prompt that keeps generated content review-only", () => {
        const prompt = buildQuickCaptureEnrichmentPrompt(captureInput);

        expect(prompt).toContain("The original capture is already saved");
        expect(prompt).toContain("Do not rewrite it and do not create tasks or memory directly");
        expect(prompt).toContain("memory_candidate or task_suggestion");
        expect(prompt).toContain("Do not include title, tag, related_note, or expansion suggestions yet");
        expect(prompt).toContain(captureInput.rawText);
    });
});

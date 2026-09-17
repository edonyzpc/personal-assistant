import { computeContentHash } from "../vss-helpers";
import type { MemoryActionHostBinding } from "../ai-services/memory-action-types";
import type { PersistedSourceRef } from "./contracts";
import type { SavedInsight, SavedInsightStore, SavedInsightType } from "./saved-insight-store";
import type { ReviewQueueStore } from "./review-queue-store";

export type InsightActionName = "save" | "later" | "archive" | "restore";

export interface InsightActionInput {
    action: InsightActionName;
    userExpression: string;
    text?: string;
    type?: SavedInsightType;
    origin?: "user-authored" | "pa-generated";
    sources?: Array<{ path: string; sourceVersion: string }>;
    targetId?: string;
    expectedUpdatedAt?: string;
    binding: MemoryActionHostBinding;
}

export interface InsightActionResult {
    kind: "insight-action";
    action: InsightActionName;
    status: "applied" | "failed";
    reason?: string;
    insightId?: string;
    reviewItemId?: string;
    updatedAt?: string;
    insightStatus?: "active" | "archived" | "promoted";
    influencePolicy?: "weak-only";
}

export interface ValidatedInsightSource {
    ref: PersistedSourceRef;
    isCurrent(): boolean;
}

export interface InsightActionPortDependencies {
    getSavedStore(): SavedInsightStore;
    getReviewStore(): ReviewQueueStore | null;
    getBoundary(): string;
    isRuntimeCurrent(): boolean;
    isItemAllowed(item: SavedInsight): boolean;
    validateSource(path: string, sourceVersion: string): Promise<ValidatedInsightSource | null>;
}

export interface InsightActionPort {
    execute(input: InsightActionInput): Promise<InsightActionResult>;
}

export function createInsightActionPort(dependencies: InsightActionPortDependencies): InsightActionPort {
    const completed = new Map<string, { fingerprint: string; result: InsightActionResult; isCurrent: () => boolean }>();
    let tail: Promise<void> = Promise.resolve();
    const failed = (action: InsightActionName, reason: string): InsightActionResult => ({
        kind: "insight-action", action, status: "failed", reason,
    });

    const perform = async (input: InsightActionInput): Promise<InsightActionResult> => {
        const { action, binding } = input;
        if (!dependencies.isRuntimeCurrent() || !binding.isCurrent()) return failed(action, "request_not_current");
        if (!binding.userPrompt.includes(input.userExpression)) return failed(action, "user_expression_not_from_current_prompt");
        const boundary = dependencies.getBoundary();
        const paths = (input.sources ?? []).map(source => source.path).sort();
        const identity = await computeContentHash(JSON.stringify([
            "insight-action-v1", binding.runId, binding.userMessageId, binding.conversationId ?? "",
            binding.userPromptHash, action, input.targetId ?? "", paths,
        ]));
        const fingerprint = await computeContentHash(JSON.stringify([
            input.userExpression, input.text ?? "", input.type ?? "", input.origin ?? "",
            input.sources ?? [], input.targetId ?? "", input.expectedUpdatedAt ?? "",
        ]));
        const previous = completed.get(identity);
        if (previous) {
            if (previous.fingerprint !== fingerprint) return failed(action, "replay_conflict");
            if (!previous.isCurrent()) return failed(action, "source_changed_or_forbidden");
            if (action === "save" && previous.result.insightId
                && !dependencies.getSavedStore().list().some(item => item.id === previous.result.insightId
                    && item.replayRef === `insight-action:${identity}`
                    && item.status === previous.result.insightStatus
                    && item.updatedAt === previous.result.updatedAt)) {
                return failed(action, "saved_item_not_current");
            }
            if (action === "later" && previous.result.reviewItemId
                && !dependencies.getReviewStore()?.list().some(item => item.id === previous.result.reviewItemId
                    && item.replayRef === `insight-action:${identity}`
                    && ["suggested", "accepted", "edited", "snoozed"].includes(item.status))) {
                return failed(action, "review_item_not_current");
            }
            if (previous.result.insightId && (action === "archive" || action === "restore")) {
                const item = dependencies.getSavedStore().list().find(candidate => candidate.id === previous.result.insightId);
                if (!item || item.updatedAt !== previous.result.updatedAt || item.status !== previous.result.insightStatus) {
                    return failed(action, "stale_target");
                }
            }
            return previous.result;
        }
        const requestCurrent = () => dependencies.isRuntimeCurrent() && binding.isCurrent()
            && dependencies.getBoundary() === boundary;
        if (!requestCurrent()) return failed(action, "request_not_current");

        if (action === "archive" || action === "restore") {
            if (!input.targetId || !input.expectedUpdatedAt) return failed(action, "target_version_required");
            const store = dependencies.getSavedStore();
            const target = store.list().find(item => item.id === input.targetId);
            if (!target || !dependencies.isItemAllowed(target)) return failed(action, "target_unavailable");
            const sourceChecks = action === "restore"
                ? await Promise.all(target.sourceRefs.map(ref => ref.contentHash
                    ? dependencies.validateSource(ref.path, ref.contentHash) : Promise.resolve(null)))
                : [];
            if (sourceChecks.some(source => !source)) return failed(action, "source_changed_or_forbidden");
            const targetCurrent = () => requestCurrent() && dependencies.isItemAllowed(target)
                && sourceChecks.every(source => source?.isCurrent());
            if (!targetCurrent()) return failed(action, "source_changed_or_forbidden");
            const result = action === "archive"
                ? await store.archive(input.targetId, input.expectedUpdatedAt, targetCurrent)
                : await store.restore(input.targetId, input.expectedUpdatedAt, targetCurrent);
            if (!result.ok) return failed(action, result.reason);
            const applied: InsightActionResult = {
                kind: "insight-action", action, status: "applied", insightId: result.value.id,
                updatedAt: result.value.updatedAt, insightStatus: result.value.status,
                influencePolicy: result.value.influencePolicy,
            };
            completed.set(identity, { fingerprint, result: applied, isCurrent: targetCurrent });
            return applied;
        }

        if (!input.text || input.text.length > 1400) return failed(action, "text_required_or_too_long");
        if (action === "save" && (!input.type || !input.origin)) return failed(action, "type_and_origin_required");
        if (action === "later" && (!input.sources || input.sources.length === 0)) return failed(action, "source_required");
        if (input.origin === "pa-generated" && (!input.sources || input.sources.length === 0)) {
            return failed(action, "source_required");
        }
        const validated: ValidatedInsightSource[] = [];
        for (const source of input.sources ?? []) {
            const current = await dependencies.validateSource(source.path, source.sourceVersion);
            if (!current) return failed(action, "source_changed_or_forbidden");
            validated.push(current);
        }
        const sourcesCurrent = () => requestCurrent() && validated.every(source => source.isCurrent());
        if (!sourcesCurrent()) return failed(action, "source_changed_or_forbidden");
        const sourceRefs = validated.map(source => source.ref);
        const scope = sourceRefs.length > 0
            ? { kind: "selected_notes" as const, paths: sourceRefs.map(ref => ref.path) }
            : { kind: "custom" as const, label: "User-authored insight" };
        const replayRef = `insight-action:${identity}`;
        if (action === "save") {
            const result = await dependencies.getSavedStore().create({
                type: input.type!, text: input.text, origin: input.origin!, sourceRefs,
                scope, dataBoundarySnapshotId: boundary, replayRef,
            }, sourcesCurrent);
            if (!result.ok) return failed(action, result.reason);
            if (result.value.status !== "active") return failed(action, "saved_item_not_current");
            const applied: InsightActionResult = {
                kind: "insight-action", action, status: "applied", insightId: result.value.id,
                updatedAt: result.value.updatedAt, insightStatus: result.value.status,
                influencePolicy: result.value.influencePolicy,
            };
            completed.set(identity, { fingerprint, result: applied, isCurrent: sourcesCurrent });
            return applied;
        }
        const review = dependencies.getReviewStore();
        if (!review) return failed(action, "review_unavailable");
        const result = await review.create({
            type: "evidence_insight", title: input.text.slice(0, 80), claim: input.text,
            scope, sourceRefs, originSurface: "chat", dataBoundarySnapshotId: boundary,
            admissionReason: "user_kept_for_later", replayRef,
        }, sourcesCurrent);
        if (!result.ok) return failed(action, result.reason);
        if (result.value.replayRef !== replayRef) return failed(action, "existing_review_item");
        if (!["suggested", "accepted", "edited", "snoozed"].includes(result.value.status)) {
            return failed(action, "review_item_not_current");
        }
        const applied: InsightActionResult = {
            kind: "insight-action", action, status: "applied", reviewItemId: result.value.id,
        };
        completed.set(identity, { fingerprint, result: applied, isCurrent: sourcesCurrent });
        return applied;
    };

    return {
        execute(input) {
            const result = tail.then(() => perform(input), () => perform(input));
            tail = result.then(() => undefined, () => undefined);
            return result.catch(() => failed(input.action, "persistence_failed"));
        },
    };
}

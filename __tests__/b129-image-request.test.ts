import { describe, expect, it, jest } from "@jest/globals";
import { ChatImageRequestScope, createResolveChatImagesTool } from "../src/ai-services/image-request";
import { ChatImageCapabilityRegistry, isStructuredImageUnsupportedError } from "../src/ai-services/image-capability";
import { IMAGE_POLICY } from "../src/chat/image-policy";
import type { ImageAssetService } from "../src/chat/image-assets";
import type { MessageImage } from "../src/chat/image-types";
import { PaAgentContextSummarizer } from "../src/ai-services/context/PaAgentContextSummarizer";
import { isCurrentHistorySummary } from "../src/ai-services/context/PaAgentContextSummaryTypes";
import { formatHistoryMessages } from "../src/ai-services/context/PaAgentHistoryContextPlan";
import type { ChatMessage } from "../src/ai-services/chat-types";

const image = (index: number): MessageImage => ({ ref: { assetId: `image-${index}`, contentHash: index.toString(16).repeat(64).slice(0, 64) }, ordinal: index, label: `Image ${index}` });
function assets(bytes = 3) {
    const release = jest.fn();
    let current = true;
    const service = {
        resolveVariant: jest.fn(async (..._args: unknown[]) => ({ blob: new Blob([new Uint8Array(bytes)]), mime: "image/jpeg", width: 1, height: 1, persistent: true, release })),
        verify: jest.fn(async () => ({ asset: {}, isCurrent: () => current })),
    };
    return { service: service as unknown as ImageAssetService, mocks: service, release, invalidate: () => { current = false; } };
}

describe("B-129 run-scoped image requests", () => {
    it('keeps a source-only receipt after request cleanup without retaining excluded pixels', async () => {
        const first = image(1), second = image(2);
        const source = assets();
        const valid = new Set([first.ref.assetId, second.ref.assetId]);
        source.mocks.verify.mockImplementation(async (...args: unknown[]) => {
            const ref = args[0] as MessageImage['ref'];
            return { asset: {}, isCurrent: () => valid.has(ref.assetId) };
        });
        let current = true;
        const controller = new AbortController();
        const scope = new ChatImageRequestScope({ prompt: 'Compare', images: [first, second],
            service: source.service, isCurrent: () => current });
        await scope.prepare(controller.signal);
        scope.selectWritingMaterials([second.ref]);
        const guard = scope.captureSourceValidity();
        controller.abort(); current = false; scope.dispose();
        expect(source.release).toHaveBeenCalledTimes(2);
        expect(scope.diagnostics().encodedImageBytes).toBe(0);
        expect(() => guard()).not.toThrow();
        valid.delete(first.ref.assetId);
        expect(() => guard()).not.toThrow();
        valid.delete(second.ref.assetId);
        expect(() => guard()).toThrow('request_changed');
        expect(() => scope.captureSourceValidity()).toThrow();
    });

    it('separates linked material source validity from temporary request validity', async () => {
        const source = assets();
        const scope = new ChatImageRequestScope({ prompt: 'Use', images: [image(1)], service: source.service });
        const controller = new AbortController();
        const receipt = await scope.verifyWritingMaterials([image(1).ref], controller.signal);
        controller.abort(); scope.dispose();
        expect(receipt.isCurrent()).toBe(false);
        expect(receipt.isSourceCurrent()).toBe(true);
        expect(source.mocks.resolveVariant).not.toHaveBeenCalled();
        source.invalidate();
        expect(receipt.isSourceCurrent()).toBe(false);
    });

    it('narrows ready pixels and rejects reintroducing an excluded image before any read', async () => {
        const source = assets();
        const first = image(1), second = image(2);
        const scope = new ChatImageRequestScope({ prompt: 'compare', images: [first, second], service: source.service });
        await scope.prepare();
        scope.selectWritingMaterials([second.ref]);
        expect(() => scope.assertReady()).not.toThrow();
        expect(scope.writingMaterials).toEqual([second]);
        expect(source.release).toHaveBeenCalledTimes(1);
        const reads = source.mocks.verify.mock.calls.length;
        await expect(scope.resolve([first.ref])).rejects.toThrow();
        expect(source.mocks.verify).toHaveBeenCalledTimes(reads);
        expect(() => scope.selectWritingMaterials([image(3).ref])).toThrow();
        expect(scope.writingMaterials).toEqual([second]);
        scope.selectWritingMaterials([]);
        expect(() => scope.assertReady()).not.toThrow();
        expect(scope.hasSelectedImages).toBe(false);
        expect(scope.writingMaterials).toEqual([]);
        expect(source.release).toHaveBeenCalledTimes(2);
        scope.dispose();
        expect(source.release).toHaveBeenCalledTimes(2);
    });

    it('verifies complete linked writing material independently of selected provider pixels', async () => {
        const source = assets();
        const materials = Array.from({ length: 10 }, (_, i) => image(i + 1));
        const scope = new ChatImageRequestScope({ prompt: 'continue', service: source.service,
            history: [{ role: 'user', content: 'Registered photos', images: materials }] });
        const selected = [materials[9], materials[0], ...materials.slice(1, 9)];
        const receipt = await scope.verifyWritingMaterials(selected.map(value => value.ref));
        expect(receipt.images).toEqual(selected);
        expect(source.mocks.verify).toHaveBeenCalledTimes(10);
        expect(source.mocks.resolveVariant).not.toHaveBeenCalled();
        expect(scope.writingMaterials).toEqual([]);
        expect(scope.hasSelectedImages).toBe(false);
        expect(receipt.isCurrent()).toBe(true);
        source.invalidate();
        expect(receipt.isCurrent()).toBe(false);
        scope.dispose();
    });

    it.each(['unknown', 'replaced', 'duplicate'] as const)('rejects invalid writing material %s before source reads', async kind => {
        const source = assets();
        const scope = new ChatImageRequestScope({ prompt: 'write', images: [image(1)], service: source.service });
        const refs = kind === 'unknown' ? [image(2).ref] : kind === 'replaced'
            ? [{ ...image(1).ref, contentHash: 'f'.repeat(64) }] : [image(1).ref, image(1).ref];
        await expect(scope.verifyWritingMaterials(refs)).rejects.toThrow('source_unavailable');
        expect(source.mocks.verify).not.toHaveBeenCalled();
        scope.dispose();
    });

    it('stops material verification after cancellation without revoking an earlier successful source receipt', async () => {
        const source = assets();
        const scope = new ChatImageRequestScope({ prompt: 'write', images: [image(1), image(2)], service: source.service });
        const controller = new AbortController();
        const completed = await scope.verifyWritingMaterials([image(1).ref], controller.signal);
        source.mocks.verify.mockImplementationOnce(async () => {
            controller.abort(); return { asset: {}, isCurrent: () => true };
        });
        await expect(scope.verifyWritingMaterials([image(1).ref, image(2).ref], controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(source.mocks.verify).toHaveBeenCalledTimes(2);
        expect(completed.isCurrent()).toBe(true);
        scope.dispose();
        expect(completed.isCurrent()).toBe(false);
    });
    it.each([{ materials: [] }, { materials: [image(2)] }])("uses the failed task material snapshot without restoring parent images: %j", async ({ materials }) => {
        const source = assets();
        const scope = new ChatImageRequestScope({
            prompt: "continue writing", service: source.service,
            writingContext: { parentVersionId: "parent", text: "Keep parent prose", textHash: "a".repeat(64), associatedImages: [image(1), image(2)] },
            writingMaterialContext: { requestId: "failed", associatedImages: materials },
        });
        await scope.prepare();
        expect(scope.writingMaterials).toEqual(materials);
        expect(source.mocks.resolveVariant).toHaveBeenCalledTimes(materials.length);
        scope.dispose();
    });
    it("materializes only current pixels, resolves exact same-conversation old refs, and reuses immutable leases across retries", async () => {
        const source = assets();
        const old = image(1), current = image(2);
        const scope = new ChatImageRequestScope({ images: [current], history: [{ role: "user", content: "old image", images: [old] }], prompt: "compare", service: source.service });
        await scope.prepare();
        expect(source.mocks.resolveVariant).toHaveBeenCalledTimes(1);
        expect(scope.message("text").content).toEqual([{ type: "text", text: "text" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } }]);
        const result = await scope.resolve([old.ref]);
        expect(result).toEqual([{ ref: old.ref, availability: "registered_for_request" }]);
        expect(JSON.stringify(result)).not.toMatch(/base64|data:image/);
        await scope.prepare(); await scope.prepare();
        expect(source.mocks.resolveVariant).toHaveBeenCalledTimes(2);
        expect(scope.message("text").content).toHaveLength(3);
        expect(scope.contextText().indexOf('"assetId":"image-2"')).toBeLessThan(scope.contextText().lastIndexOf('"assetId":"image-1"'));
        scope.dispose(); scope.dispose();
        expect(source.release).toHaveBeenCalledTimes(2);
    });

    it("rejects unregistered IDs, versions and arbitrary paths before source IO", async () => {
        const source = assets();
        const scope = new ChatImageRequestScope({ images: [image(1)], prompt: "hi", service: source.service });
        await expect(scope.resolve([image(2).ref])).rejects.toThrow("source_unavailable");
        await expect(scope.resolve([{ ...image(1).ref, contentHash: "f".repeat(64) }])).rejects.toThrow("source_unavailable");
        const tool = createResolveChatImagesTool(scope);
        expect(() => tool.validateInput({ refs: [image(1).ref], path: "private.png" })).toThrow();
        expect(() => tool.validateInput({ refs: [{ ...image(1).ref, url: "https://example.invalid/a.png" }] })).toThrow();
        expect(source.mocks.verify).not.toHaveBeenCalled();
    });

    it("rechecks source receipts, boundary changes, request mutation and cancellation at final dispatch", async () => {
        for (const change of ["source", "ref", "epoch", "abort"] as const) {
            const source = assets(); const images = [image(1)]; const controller = new AbortController(); let current = true;
            const scope = new ChatImageRequestScope({ images, prompt: "hi", service: source.service, isCurrent: () => current });
            await scope.prepare();
            if (change === "source") source.invalidate();
            if (change === "ref") images[0].ref.contentHash = "f".repeat(64);
            if (change === "epoch") current = false;
            if (change === "abort") controller.abort();
            expect(() => scope.message("must not dispatch", controller.signal)).toThrow();
            if (change !== "abort") expect(scope.isUsable()).toBe(false);
            scope.dispose(); expect(source.release).toHaveBeenCalledTimes(1);
        }
    });

    it("does not freeze an earlier source receipt while the later source is being verified", async () => {
        const source = assets(); let calls = 0;
        source.mocks.verify.mockImplementation(async () => { if (++calls === 2) source.invalidate(); return { asset: {}, isCurrent: () => calls < 2 }; });
        const scope = new ChatImageRequestScope({ images: [image(1), image(2)], prompt: "hi", service: source.service });
        await expect(scope.prepare()).rejects.toThrow("request_changed"); scope.dispose();
        expect(source.release).toHaveBeenCalledTimes(2);
    });

    it("enforces count independently, including additional historical selections", async () => {
        const images = Array.from({ length: 9 }, (_, index) => image(index + 1)); const source = assets();
        expect(() => new ChatImageRequestScope({ images, prompt: "hi", service: source.service })).toThrow("image_budget");
        const scope = new ChatImageRequestScope({ images: images.slice(0, 8), history: [{ role: "user", content: "old", images: [images[8]] }], prompt: "hi", service: source.service });
        expect(await scope.resolve([images[8].ref])).toEqual([{ ref: images[8].ref, availability: "budget_exceeded" }]);
        await scope.prepare(); expect(scope.message("hi").content).toHaveLength(9); expect(scope.isUsable()).toBe(false); scope.dispose();
    });

    it("honors the 4 MiB per-image and 24 MiB total boundaries without dropping required images", async () => {
        const tooLarge = assets(IMAGE_POLICY.maxVariantBytes + 1);
        const rejected = new ChatImageRequestScope({ images: [image(1)], prompt: "hi", service: tooLarge.service });
        await expect(rejected.prepare()).rejects.toThrow("image_budget"); expect(tooLarge.release).toHaveBeenCalledTimes(1); rejected.dispose();
        const boundary = assets(IMAGE_POLICY.maxVariantBytes);
        const scope = new ChatImageRequestScope({ images: Array.from({ length: 6 }, (_, i) => image(i + 1)),
            history: [{ role: "user", content: "old", images: [image(7)] }], prompt: "hi", service: boundary.service });
        await scope.prepare(); expect(scope.diagnostics()).toMatchObject({ count: 6, encodedImageBytes: IMAGE_POLICY.maxRequestImageBytes });
        await scope.resolve([image(7).ref]); await expect(scope.prepare()).rejects.toThrow("image_budget");
        scope.dispose(); expect(boundary.release).toHaveBeenCalledTimes(7);
    });

    it("inherits all material while selecting only explicit pixels and tracks parent text currentness", async () => {
        const parent = { parentVersionId: "v1", text: "User edited version", textHash: "a".repeat(64), associatedImages: [image(1), image(2)] };
        const source = assets(); const scope = new ChatImageRequestScope({ writingContext: parent, prompt: "只用第二张，改短一点", service: source.service });
        await scope.prepare(); expect(source.mocks.resolveVariant).toHaveBeenCalledWith(image(2).ref, "provider", expect.anything());
        expect(scope.contextText()).toContain('"assetId":"image-1"');
        parent.text = "changed"; expect(scope.isUsable()).toBe(false); scope.dispose();
        const many = new ChatImageRequestScope({ writingContext: { ...parent, associatedImages: Array.from({ length: 9 }, (_, i) => image(i + 1)) }, prompt: "继续这版", service: source.service });
        await many.prepare(); expect(many.isUsable()).toBe(false);
        await many.resolve([image(2).ref]); await many.prepare(); expect(many.isUsable()).toBe(true); many.dispose();
    });

    it("keeps full frozen failed-task material apart from its pixel subset and unselected history", async () => {
        const source = assets();
        const context = { requestId: 'failed-task', associatedImages: [image(1), image(2)] };
        const scope = new ChatImageRequestScope({ writingMaterialContext: context, prompt: '只用第二张', service: source.service,
            history: [{ role: 'user', content: 'old sources', images: [image(3), image(4)] },
                { role: 'assistant', content: 'old recovery', images: [{ ...image(3), ordinal: 1 }] }] });
        await scope.prepare();
        expect(scope.message('shorter').content).toHaveLength(2);
        expect(scope.writingMaterials).toEqual([image(1), image(2)]);
        await scope.resolve([image(3).ref]); await scope.prepare();
        expect(scope.writingMaterials).toEqual([image(1), image(2), image(3)]);
        const receipt = scope.writingMaterials;
        receipt[0].ref.assetId = 'outside-mutation';
        context.associatedImages[0].label = 'changed after snapshot';
        expect(scope.isUsable()).toBe(false);
        expect(scope.writingMaterials).toEqual([image(1), image(2), image(3)]);
        scope.dispose();
    });

    it.each(['abort', 'stale', 'source'] as const)('does not attach a historical ref resolved after %s invalidation', async (change) => {
        const source = assets(); const controller = new AbortController(); let current = true;
        let finish!: () => void;
        source.mocks.verify.mockImplementation(async () => { await new Promise<void>((resolve) => { finish = resolve; });
            return { asset: {}, isCurrent: () => change !== 'source' }; });
        const scope = new ChatImageRequestScope({ images: [image(1)], history: [{ role: 'user', content: 'old', images: [image(2)] }],
            prompt: 'compare', service: source.service, isCurrent: () => current });
        const resolving = scope.resolve([image(2).ref], controller.signal);
        if (change === 'abort') controller.abort();
        if (change === 'stale') current = false;
        finish();
        if (change === 'abort') await expect(resolving).rejects.toThrow();
        else expect(await resolving).toEqual([{ ref: image(2).ref, availability: 'unavailable' }]);
        expect(scope.writingMaterials).toEqual([image(1)]);
        scope.dispose();
    });
});

describe("B-129 capability evidence", () => {
    const identity = { aiProvider: "qwen", baseURL: "https://fixture.invalid", chatModelName: "unknown-model" };
    const unsupported = { status: 400, error: { code: "image_input_not_supported" } };
    it("binds evidence to the current exact configuration and ignores stale completion", () => {
        const registry = new ChatImageCapabilityRegistry();
        expect(registry.get(identity)).toBe("unknown"); registry.recordError(identity, unsupported); expect(registry.get(identity)).toBe("unsupported");
        const changed = { ...identity, chatModelName: "new" };
        expect(registry.get(changed)).toBe("unknown"); registry.recordSupported(identity); expect(registry.get(changed)).toBe("unknown");
        registry.recordSupported(changed); expect(registry.get(changed)).toBe("supported"); expect(registry.get(identity)).toBe("unknown");
    });
    it.each([401, 403, 408, 429, 500, undefined])("never interprets status %s as model image incompatibility", (status) => {
        expect(isStructuredImageUnsupportedError({ ...unsupported, status })).toBe(false);
    });
    it("requires structured evidence and does not mislabel invalid image bytes", () => {
        expect(isStructuredImageUnsupportedError(new Error("image input unsupported"))).toBe(false);
        expect(isStructuredImageUnsupportedError({ status: 400, error: { code: "invalid_image" } })).toBe(false);
        expect(isStructuredImageUnsupportedError({ status: 400, error: { code: "invalid_value", param: "messages[0].content[1].type", message: "image_url is only supported by certain models" } })).toBe(true);
    });
});

describe("B-129 B-128 image identity continuity", () => {
    it("preserves metadata in serialized history and invalidates a source summary for ID/hash/order changes", () => {
        const history: ChatMessage[] = [{ role: "user", content: "look", images: [image(1), image(2)] }];
        expect(formatHistoryMessages(history)).toContain(image(1).ref.contentHash);
        const snapshot = JSON.parse(JSON.stringify(history));
        expect(isCurrentHistorySummary({ text: "summary", sourceMessages: snapshot }, history)).toBe(true);
        history[0].images!.reverse(); expect(isCurrentHistorySummary({ text: "summary", sourceMessages: snapshot }, history)).toBe(false);
        history[0].images!.reverse(); history[0].images![0].ref.contentHash = "f".repeat(64);
        expect(isCurrentHistorySummary({ text: "summary", sourceMessages: snapshot }, history)).toBe(false);
    });
    it("passes only image references to summaries and rejects a late changed snapshot", async () => {
        const history: ChatMessage[] = [{ role: "user", content: Array.from({ length: 400 }, (_, i) => `unique-${i} `).join(""), images: [image(1)] }, { role: "assistant", content: "understood" }];
        const seen: string[] = []; const summarizer = new PaAgentContextSummarizer();
        const result = await summarizer.prepareHistory({ history, historyBudgetChars: 1500, invoke: async (payload) => {
            seen.push(JSON.stringify(payload)); history[0].images![0].ref.contentHash = "f".repeat(64);
            return JSON.stringify({ goals: [], constraints: [], decisions: [], completed: [], open_questions: [], facts: [{ text: "Image ref", sourceMessages: [1] }] });
        } });
        expect(result).toBeUndefined(); expect(seen.join("")).toContain("reference_only_not_pixels"); expect(seen.join("")).not.toMatch(/data:image|base64/); summarizer.dispose();
    });
});

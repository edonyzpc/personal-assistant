import { ComposerDraft } from "../src/chat/composer-draft";

describe("image composer ownership", () => {
    test("image-only, pending and failed imports protect handoff but only ready inputs can send", () => {
        const draft = new ComposerDraft<string>();
        const empty = draft.snapshot("");
        const handle = draft.beginImport("photo.heic");
        expect(draft.hasDraft("")).toBe(true);
        expect(draft.canSend("")).toBe(false);
        expect(draft.isUnchanged(empty)).toBe(false);
        draft.failImport(handle, "Provide JPEG", "preserved-original-ref");
        expect(draft.hasDraft("")).toBe(true);
        expect(draft.take("caption")).toBeNull();
        expect(draft.snapshot("").images[0].value).toBe("preserved-original-ref");
        draft.removeImage(handle.entryId);
        const ready = draft.beginImport("photo.jpg");
        draft.completeImport(ready, "original-ref");
        expect(draft.canSend("")).toBe(true);
    });

    test.each(["remove", "new-conversation", "close"])("late import cannot reappear after %s", async (action) => {
        const draft = new ComposerDraft<string>();
        const handle = draft.beginImport("old.jpg");
        const delivered = Promise.resolve().then(() => draft.completeImport(handle, "old-original"));
        if (action === "remove") draft.removeImage(handle.entryId);
        if (action === "new-conversation") draft.clear();
        if (action === "close") draft.dispose();
        expect(await delivered).toBe(false);
        expect(handle.signal.aborted).toBe(true);
        expect(draft.snapshot("").images).toEqual([]);
    });

    test("failure restores exactly the sent selection into an untouched next draft", () => {
        const draft = new ComposerDraft<string>();
        const handle = draft.beginImport("first.jpg");
        draft.completeImport(handle, "ref1");
        const sent = draft.take("caption")!;
        expect(draft.hasDraft("")).toBe(false);
        expect(draft.restore(sent, "")).toBe("caption");
        expect(draft.snapshot("caption").images.map((entry) => entry.value)).toEqual(["ref1"]);
        expect(draft.restore(sent, "")).toBeNull();
    });

    test("a newer image or text edit prevents automatic mixing with a failed send", () => {
        const draft = new ComposerDraft<string>();
        const sent = draft.take("first")!;
        draft.touchText(); // typed and deleted again
        expect(draft.restore(sent, "")).toBeNull();
        const second = draft.take("second")!;
        const newImage = draft.beginImport("next.jpg");
        expect(draft.restore(second, "")).toBeNull();
        expect(draft.completeImport(newImage, "next-ref")).toBe(true);
        expect(draft.snapshot("").images[0].value).toBe("next-ref");
    });

    test("count guard does not silently drop pending or failed selections", () => {
        const draft = new ComposerDraft<string>(2);
        const first = draft.beginImport("one.jpg");
        draft.failImport(first, "error");
        draft.beginImport("two.jpg");
        expect(() => draft.beginImport("three.jpg")).toThrow("Image count limit");
        expect(draft.snapshot("").images).toHaveLength(2);
    });
});

import { TaskSourceConstraintState } from "../src/ai-services/task-source-constraint";
import type { TaskSourceReadGuard } from "../src/ai-services/task-source-read-guard";
import {
    NoteImageRemovalPreparationError,
    prepareNoteImageRemoval,
    type NoteImageRemovalHost,
    type NoteImageRemovalSourceFile,
} from "../src/ai-services/operations/note-image-removal";

const NOTE_PATH = "notes/b160-selected.md";
const OTHER_NOTE_PATH = "notes/b160-other.md";
const CANVAS_PATH = "boards/b160-board.canvas";
const ATTACHMENT_PATH = "assets/b160-original.png";
const OTHER_ATTACHMENT_PATH = "assets/b160-other.png";

function source(path: string, extension: "md" | "canvas", file: object): NoteImageRemovalSourceFile {
    return {
        path,
        extension,
        file,
        version: { mtime: 123, size: extension === "canvas" ? 256 : 512 },
    };
}

function fixture(options: {
    note?: string;
    other?: string;
    canvas?: string;
    excludedPaths?: string[];
    allowedPaths?: string[] | null;
    deniedPaths?: string[];
    deniedAttachmentPaths?: string[];
    onSourceRead?: (file: NoteImageRemovalSourceFile) => void | Promise<void>;
} = {}) {
    const noteFile = { path: NOTE_PATH };
    const otherFile = { path: OTHER_NOTE_PATH };
    const canvasFile = { path: CANVAS_PATH };
    const attachmentFile = { path: ATTACHMENT_PATH };
    const otherAttachmentFile = { path: OTHER_ATTACHMENT_PATH };
    const otherVersion = { mtime: 123, size: 512 };
    const noteIdentity = source(NOTE_PATH, "md", noteFile);
    const otherIdentity = { path: OTHER_NOTE_PATH, extension: "md" as const, file: otherFile, version: otherVersion };
    const canvasIdentity = source(CANVAS_PATH, "canvas", canvasFile);
    const attachmentIdentity = {
        path: ATTACHMENT_PATH,
        extension: "png",
        file: attachmentFile,
        version: { mtime: 123, size: 16 },
    };
    const otherAttachmentIdentity = {
        path: OTHER_ATTACHMENT_PATH,
        extension: "png",
        file: otherAttachmentFile,
        version: { mtime: 123, size: 12 },
    };
    const contents = new Map([
        [NOTE_PATH, options.note ?? [
            "> [!featured-image]",
            "> Caption stays.",
            "> ![[assets/b160-original.png]]",
            "> Unrelated callout text stays.",
            "",
            "Body stays.",
        ].join("\r\n")],
        [OTHER_NOTE_PATH, options.other ?? "No image here."],
        [CANVAS_PATH, options.canvas ?? JSON.stringify({
            nodes: [{ type: "file", file: OTHER_NOTE_PATH }],
        })],
    ]);
    const denied = new Set(options.deniedPaths ?? []);
    let sourceValid = true;
    let hostCurrent = true;
    let currentNoteFile: object = noteFile;
    let currentOtherFile: object = otherFile;
    let currentOtherVersion = otherVersion;
    let currentAttachmentFile: object = attachmentFile;
    let extraSource: NoteImageRemovalSourceFile | undefined;
    const host: NoteImageRemovalHost = {
        getSourceFile: jest.fn((path: string) => (
            path === NOTE_PATH
                ? { ...noteIdentity, file: currentNoteFile }
                : path === OTHER_NOTE_PATH
                    ? { ...otherIdentity, file: currentOtherFile, version: currentOtherVersion }
                : path === CANVAS_PATH ? canvasIdentity
                : path === extraSource?.path ? extraSource
                : undefined
        )),
        listSourceFiles: jest.fn(() => [
            noteIdentity,
            { ...otherIdentity, file: currentOtherFile, version: currentOtherVersion },
            canvasIdentity,
            ...(extraSource ? [extraSource] : []),
        ]),
        readSourceFile: jest.fn(async (file: NoteImageRemovalSourceFile) => {
            const content = contents.get(file.path);
            if (content === undefined) throw new Error("missing source");
            await options.onSourceRead?.(file);
            return content;
        }),
        parseLinktext: jest.fn((linktext: string) => {
            const hashIndex = linktext.indexOf("#");
            return hashIndex < 0
                ? { path: linktext, subpath: "" }
                : { path: linktext.slice(0, hashIndex), subpath: linktext.slice(hashIndex + 1) };
        }),
        resolveImageDestination: jest.fn((linkpath: string, sourcePath: string) => {
            if (linkpath === ATTACHMENT_PATH || (sourcePath === NOTE_PATH && linkpath === "b160-original.png")) {
                return { ...attachmentIdentity, file: currentAttachmentFile };
            }
            if (linkpath === OTHER_ATTACHMENT_PATH) return otherAttachmentIdentity;
            return undefined;
        }),
        isPathAllowed: jest.fn((path: string) => !denied.has(path)),
        isAttachmentPathAllowed: jest.fn((path: string) => (
            !(options.deniedAttachmentPaths ?? []).includes(path)
        )),
        readAttachmentFile: jest.fn(async () => new Uint8Array([1, 2, 3])),
    };
    const state = new TaskSourceConstraintState({
        runId: "run-b160",
        userMessageId: "user-b160",
        userText: "Remove this image.",
        noteHandles: new Map([["current", "note-current"], ["other", "note-other"], ["canvas", "note-canvas"]]),
    });
    const constraint = state.snapshot();
    const noteIds = new Map([
        [NOTE_PATH, "note-current"],
        [OTHER_NOTE_PATH, "note-other"],
        [CANVAS_PATH, "note-canvas"],
    ]);
    const guard: TaskSourceReadGuard = state.createReadGuard(
        constraint,
        path => noteIds.get(path),
        () => hostCurrent,
        undefined,
        () => ({
            allowedPaths: options.allowedPaths === undefined ? null : options.allowedPaths,
            excludedPaths: options.excludedPaths ?? [],
        }),
        undefined,
        undefined,
        () => sourceValid,
    );
    return {
        host,
        guard,
        contents,
        attachmentIdentity,
        setSourceValid: (value: boolean) => { sourceValid = value; },
        endRun: () => { hostCurrent = false; },
        replaceNote: () => { currentNoteFile = { path: NOTE_PATH }; },
        replaceAttachment: () => { currentAttachmentFile = { path: ATTACHMENT_PATH }; },
        replaceOther: () => { currentOtherFile = { path: OTHER_NOTE_PATH }; },
        mutateOtherVersion: () => {
            currentOtherVersion.mtime = 124;
            currentOtherVersion.size = 513;
        },
        denySource: (path: string) => { denied.add(path); },
        addSource: () => {
            const file = { path: "notes/b160-added.md" };
            extraSource = source("notes/b160-added.md", "md", file);
            contents.set("notes/b160-added.md", "Added source.");
        },
    };
}

interface PreparationFixture {
    host: NoteImageRemovalHost;
    guard: TaskSourceReadGuard;
    contents: Map<string, string>;
    attachmentIdentity: { path: string };
    setSourceValid(value: boolean): void;
    endRun(): void;
    replaceNote(): void;
    replaceAttachment(): void;
    replaceOther(): void;
    mutateOtherVersion(): void;
    denySource(path: string): void;
    addSource(): void;
}

function prepare(
    fixture: PreparationFixture,
    input: Partial<Parameters<typeof prepareNoteImageRemoval>[0]["input"]> = {},
) {
    return prepareNoteImageRemoval({
        runId: "run-b160",
        turnId: "turn-b160",
        toolCallId: "call-b160",
        taskSourceReadGuard: fixture.guard,
        host: fixture.host,
        createId: () => "prepared-b160",
        input: {
            notePath: NOTE_PATH,
            imageReference: "![[assets/b160-original.png]]",
            attachmentAction: "delete",
            ...input,
        },
    });
}

async function prepareError(
    fixture: PreparationFixture,
    input: Partial<Parameters<typeof prepareNoteImageRemoval>[0]["input"]> = {},
): Promise<NoteImageRemovalPreparationError> {
    try {
        await prepare(fixture, input);
    } catch (error) {
        if (error instanceof NoteImageRemovalPreparationError) return error;
        throw error;
    }
    throw new Error("Expected note-image preparation to fail.");
}

describe("B-160 P1 note-image preparation", () => {
    it("prepares a Featured Image removal with CRLF, callout text, and the actual attachment identity", async () => {
        const h = fixture();
        const result = await prepare(h, { attachmentAction: "delete" });

        expect(result.operation).toMatchObject({
            kind: "note_image_removal",
            path: NOTE_PATH,
            expectedAfter: [
                "> [!featured-image]",
                "> Caption stays.",
                "> Unrelated callout text stays.",
                "",
                "Body stays.",
            ].join("\r\n"),
            effects: {
                note: { path: NOTE_PATH, status: "not_started" },
                attachment: { path: ATTACHMENT_PATH, plannedAction: "remove", status: "not_started" },
            },
            coverage: {
                kind: "scoped_vault_search",
                complete: true,
                candidateCount: 3,
                readCount: 3,
                canvasCount: 1,
            },
            undoLimitation: "temporary-attachment-and-note",
        });
        expect(result.privatePreparation.attachment.path).toBe(ATTACHMENT_PATH);
        expect(h.host.readSourceFile).toHaveBeenCalledTimes(3);
        expect(h.host.readAttachmentFile).not.toHaveBeenCalled();
        expect(Object.keys(result.operation)).not.toContain("privatePreparation");
        expect(JSON.stringify(result.operation)).not.toContain("sourceValidity");
    });

    it("keeps an ordinary Markdown image link without a scoped search, binary read, or attachment deletion", async () => {
        const h = fixture({
            note: [
                "Before ![Selected image](assets/b160-original.png) after.",
                "Next line keeps its newline.",
            ].join("\n"),
        });
        const result = await prepare(h, {
            imageReference: "![Selected image](assets/b160-original.png)",
            attachmentAction: "keep",
        });

        expect(result.operation.expectedAfter).toBe([
            "Before  after.",
            "Next line keeps its newline.",
        ].join("\n"));
        expect(result.operation.effects.attachment).toMatchObject({
            path: ATTACHMENT_PATH,
            action: "keep",
            plannedAction: "retain",
        });
        expect(result.operation.coverage).toEqual({ kind: "current_note", complete: true });
        expect(result.operation.undoLimitation).toBe("markdown-only");
        expect(h.host.listSourceFiles).not.toHaveBeenCalled();
        expect(h.host.readSourceFile).toHaveBeenCalledTimes(1);
        expect(h.host.readSourceFile).not.toHaveBeenCalledWith(expect.objectContaining({ path: OTHER_NOTE_PATH }));
        expect(h.host.readAttachmentFile).not.toHaveBeenCalled();
    });

    it("blocks delete for another readable reference with only finite conflict facts", async () => {
        const h = fixture({
            other: `SECRET other body.\n![Other copy](assets/b160-original.png)\n`,
        });

        const prepared = await prepare(h);

        expect(prepared.operation.block?.reason).toBe("shared_reference");
        expect(prepared.operation.block?.conflicts).toEqual([
            { sourcePath: OTHER_NOTE_PATH, syntax: "markdown-image", remainsInSelectedNote: false },
        ]);
        expect(prepared.operation.coverage).toMatchObject({ complete: true, candidateCount: 3, readCount: 3 });
        expect(JSON.stringify(prepared.operation.block)).not.toContain("SECRET other body");
        expect(Object.isFrozen(prepared.operation.block)).toBe(true);
        expect(Object.isFrozen(prepared.operation.block?.conflicts)).toBe(true);
        expect(h.host.readAttachmentFile).not.toHaveBeenCalled();
    });

    it("blocks delete when the selected note would still contain another reference to the same attachment", async () => {
        const h = fixture({
            note: [
                "> [!featured-image]",
                "> Caption stays.",
                "> ![[assets/b160-original.png]]",
                "> [Same attachment](assets/b160-original.png)",
            ].join("\r\n"),
        });

        const prepared = await prepare(h);

        expect(prepared.operation.block?.reason).toBe("shared_reference");
        expect(prepared.operation.block?.conflicts).toEqual([
            { sourcePath: NOTE_PATH, syntax: "markdown-link", remainsInSelectedNote: true },
        ]);
    });

    it("treats excluded, denied, missing inventory, and unsupported syntax as incomplete rather than no reference", async () => {
        const excluded = fixture({ excludedPaths: [OTHER_NOTE_PATH] });
        const excludedError = await prepareError(excluded);
        expect(excludedError.category).toBe("coverage_incomplete");
        expect(excludedError.details.coverage).toEqual({
            kind: "scoped_vault_search",
            complete: false,
            reason: "sources_excluded",
        });
        expect(JSON.stringify(excludedError)).not.toContain(OTHER_NOTE_PATH);
        expect(JSON.stringify(excludedError.details.coverage)).not.toMatch(/\d/);
        expect(excluded.host.readSourceFile).not.toHaveBeenCalledWith(expect.objectContaining({ path: OTHER_NOTE_PATH }));
        expect(excluded.host.getSourceFile).not.toHaveBeenCalledWith(OTHER_NOTE_PATH);

        const denied = fixture({ deniedPaths: [OTHER_NOTE_PATH] });
        const deniedError = await prepareError(denied);
        expect(deniedError.category).toBe("coverage_incomplete");
        expect(deniedError.details.coverage).toEqual({
            kind: "scoped_vault_search",
            complete: false,
            reason: "source_permission_unavailable",
        });
        expect(JSON.stringify(deniedError)).not.toContain(OTHER_NOTE_PATH);
        expect(JSON.stringify(deniedError.details.coverage)).not.toMatch(/\d/);
        expect(denied.host.readSourceFile).not.toHaveBeenCalledWith(expect.objectContaining({ path: OTHER_NOTE_PATH }));
        expect(denied.host.getSourceFile).not.toHaveBeenCalledWith(OTHER_NOTE_PATH);

        const missingInventory = fixture();
        missingInventory.host.listSourceFiles = jest.fn(() => undefined);
        await expect(prepare(missingInventory)).rejects.toMatchObject({
            category: "coverage_incomplete",
            details: { coverage: { reason: "source_inventory_unavailable" } },
        });

        const unsupported = fixture({
            other: '<img src="assets/b160-original.png" alt="legacy">',
        });
        await expect(prepare(unsupported)).rejects.toMatchObject({
            category: "coverage_incomplete",
            details: { coverage: { complete: false } },
        });
    });

    it("blocks finite-scope delete when a necessary inventory source is outside allowedPaths without leaking it", async () => {
        const finite = fixture({ allowedPaths: [NOTE_PATH] });
        const error = await prepareError(finite);

        expect(error.category).toBe("coverage_incomplete");
        expect(error.details.coverage).toEqual({
            kind: "scoped_vault_search",
            complete: false,
            reason: "necessary_source_outside_allowed_scope",
        });
        expect(JSON.stringify(error)).not.toContain(OTHER_NOTE_PATH);
        expect(JSON.stringify(error)).not.toContain(CANVAS_PATH);
        expect(JSON.stringify(error.details.coverage)).not.toMatch(/\d/);
        expect(finite.host.readSourceFile).toHaveBeenCalledTimes(1);
        expect(finite.host.readSourceFile).not.toHaveBeenCalledWith(expect.objectContaining({ path: OTHER_NOTE_PATH }));
        expect(finite.host.readSourceFile).not.toHaveBeenCalledWith(expect.objectContaining({ path: CANVAS_PATH }));
    });

    it("refuses a code-only wiki selector for both keep and delete while normal callout references remain preparable", async () => {
        const codeOnly = "`![[assets/b160-original.png]]`";
        const keep = fixture({ note: codeOnly });
        await expect(prepare(keep, { attachmentAction: "keep" })).rejects.toMatchObject({
            category: "target_missing",
        });
        expect(keep.host.listSourceFiles).not.toHaveBeenCalled();
        expect(keep.host.readAttachmentFile).not.toHaveBeenCalled();

        const deleteProposal = fixture({ note: codeOnly });
        await expect(prepare(deleteProposal, { attachmentAction: "delete" })).rejects.toMatchObject({
            category: "target_missing",
        });
        expect(deleteProposal.host.listSourceFiles).not.toHaveBeenCalled();
        expect(deleteProposal.host.readAttachmentFile).not.toHaveBeenCalled();
    });

    it("refuses selectors inside inline and multiline HTML comments instead of editing raw examples", async () => {
        const inline = fixture({
            note: "Before <!-- ![[assets/b160-original.png]] --> after",
        });
        await expect(prepare(inline, { attachmentAction: "keep" })).rejects.toMatchObject({
            category: "target_missing",
        });
        expect(inline.host.listSourceFiles).not.toHaveBeenCalled();

        const multiline = fixture({
            note: [
                "Before",
                "<!--",
                "![[assets/b160-original.png]]",
                "-->",
                "After",
            ].join("\n"),
        });
        await expect(prepare(multiline, { attachmentAction: "keep" })).rejects.toMatchObject({
            category: "target_missing",
        });
        expect(multiline.host.listSourceFiles).not.toHaveBeenCalled();
        expect(multiline.contents.get(NOTE_PATH)).toContain("-->");
    });

    it("supports reference-style image and image-link forms from MarkdownIt definitions", async () => {
        const selected = fixture({
            note: [
                "![Selected][b160-image]",
                "",
                "[b160-image]: assets/b160-original.png",
            ].join("\n"),
        });
        const kept = await prepare(selected, {
            imageReference: "![Selected][b160-image]",
            attachmentAction: "keep",
        });
        expect(kept.operation.expectedAfter).toBe("\n[b160-image]: assets/b160-original.png");

        const shared = fixture({
            other: [
                "[Canvas copy][b160-image]",
                "",
                "[b160-image]: assets/b160-original.png",
            ].join("\n"),
        });
        const prepared = await prepare(shared);
        expect(prepared.operation.block?.reason).toBe("shared_reference");
        expect(prepared.operation.block?.conflicts).toEqual([
            { sourcePath: OTHER_NOTE_PATH, syntax: "markdown-reference-link", remainsInSelectedNote: false },
        ]);
    });

    it("resolves image links through the Host after preserving subpaths, while nonimage and external links do not conflict", async () => {
        const shared = fixture({
            other: "[Shared copy](assets/b160-original.png#section)",
        });
        const sharedPrepared = await prepare(shared);
        expect(sharedPrepared.operation.block?.reason).toBe("shared_reference");
        expect(sharedPrepared.operation.block?.conflicts).toEqual([
            { sourcePath: OTHER_NOTE_PATH, syntax: "markdown-link", remainsInSelectedNote: false },
        ]);
        expect(shared.host.readAttachmentFile).not.toHaveBeenCalled();

        const referenceSubpath = fixture({
            other: [
                "[Shared copy][b160-image]",
                "",
                "[b160-image]: assets/b160-original.png#section",
            ].join("\n"),
        });
        const referencePrepared = await prepare(referenceSubpath);
        expect(referencePrepared.operation.block?.reason).toBe("shared_reference");
        expect(referencePrepared.operation.block?.conflicts).toEqual([
            { sourcePath: OTHER_NOTE_PATH, syntax: "markdown-reference-link", remainsInSelectedNote: false },
        ]);

        const nonImage = fixture({
            other: "[Local note](notes/b160-other.md#heading) [External](https://example.test/a.png)",
        });
        const result = await prepare(nonImage);
        expect(result.operation.coverage).toMatchObject({ complete: true, candidateCount: 3 });
        expect(nonImage.host.resolveImageDestination)
            .toHaveBeenCalledWith("notes/b160-other.md", expect.any(String));
    });

    it("detects nested inline HTML images and excludes references inside a fenced code block in a callout", async () => {
        const inlineHtml = fixture({
            other: 'Before <img src="assets/b160-original.png"> after',
        });
        await expect(prepare(inlineHtml)).rejects.toMatchObject({
            category: "coverage_incomplete",
        });

        const calloutCode = fixture({
            note: [
                "> [!featured-image]",
                "> Caption stays.",
                "> ![[assets/b160-original.png]]",
                "> ```text",
                "> ![[assets/b160-original.png]]",
                "> ```",
            ].join("\r\n"),
        });
        const result = await prepare(calloutCode, { attachmentAction: "keep" });
        expect(result.operation.expectedAfter).toBe([
            "> [!featured-image]",
            "> Caption stays.",
            "> ```text",
            "> ![[assets/b160-original.png]]",
            "> ```",
        ].join("\r\n"));
    });

    it("treats a wiki image sharing an uncertain inline-code paragraph as incomplete coverage", async () => {
        const h = fixture({
            other: "A `inline code` and ![[assets/b160-original.png]]",
        });
        const error = await prepareError(h);

        expect(error.category).toBe("coverage_incomplete");
        expect(error.details.coverage).toMatchObject({
            complete: false,
            reason: "reference_check_incomplete",
        });
        expect(error.details.conflicts).toBeUndefined();
        expect(h.host.readAttachmentFile).not.toHaveBeenCalled();
    });

    it("reads Markdown references inside Canvas text nodes while retaining file-node coverage", async () => {
        const h = fixture({
            canvas: JSON.stringify({
                nodes: [
                    { type: "text", text: "![Canvas copy](assets/b160-original.png)" },
                    { type: "file", file: OTHER_NOTE_PATH },
                ],
            }),
        });
        const prepared = await prepare(h);

        expect(prepared.operation.block?.reason).toBe("shared_reference");
        expect(prepared.operation.block?.conflicts).toEqual([
            { sourcePath: CANVAS_PATH, syntax: "markdown-image", remainsInSelectedNote: false },
        ]);
        expect(h.host.readSourceFile).toHaveBeenCalledWith(expect.objectContaining({ path: CANVAS_PATH }));
    });

    it("does not expose accumulated shared-reference paths when later coverage is incomplete", async () => {
        const h = fixture({ other: `SECRET ![[${ATTACHMENT_PATH}]]`, canvas: "not valid Canvas JSON" });
        const error = await prepareError(h);
        expect(error.category).toBe("coverage_incomplete");
        expect(error.details.conflicts).toBeUndefined();
        expect(JSON.stringify(error.details)).not.toContain(OTHER_NOTE_PATH);
        expect(JSON.stringify(error.details)).not.toContain("SECRET");
        expect(h.host.readAttachmentFile).not.toHaveBeenCalled();
    });

    it("rejects target-note drift across its own awaited read", async () => {
        const h = fixture({
            onSourceRead: file => {
                if (file.path === NOTE_PATH) h.replaceNote();
            },
        });
        await expect(prepare(h, { attachmentAction: "keep" })).rejects.toMatchObject({
            category: "target_missing",
        });
    });

    it("rejects a scan when an already-read source or the inventory changes during a later Canvas read", async () => {
        const changedSource = fixture({
            onSourceRead: file => {
                if (file.path === CANVAS_PATH) changedSource.replaceOther();
            },
        });
        await expect(prepare(changedSource)).rejects.toMatchObject({
            category: "coverage_incomplete",
            details: { coverage: { reason: "source_inventory_changed_after_scan" } },
        });

        const changedInventory = fixture({
            onSourceRead: file => {
                if (file.path === CANVAS_PATH) changedInventory.addSource();
            },
        });
        await expect(prepare(changedInventory)).rejects.toMatchObject({
            category: "coverage_incomplete",
            details: { coverage: { reason: "source_inventory_changed_after_scan" } },
        });

        const changedVersion = fixture({
            onSourceRead: file => {
                if (file.path === CANVAS_PATH) changedVersion.mutateOtherVersion();
            },
        });
        await expect(prepare(changedVersion)).rejects.toMatchObject({
            category: "coverage_incomplete",
            details: { coverage: { reason: "source_inventory_changed_after_scan" } },
        });
    });

    it("requires a unique active source occurrence and ignores code copies", async () => {
        const duplicate = fixture({
            note: [
                "![[assets/b160-original.png]]",
                "![[assets/b160-original.png]]",
            ].join("\n"),
        });
        await expect(prepare(duplicate, { attachmentAction: "keep" })).rejects.toMatchObject({
            category: "ambiguous_target",
        });
        expect(duplicate.host.listSourceFiles).not.toHaveBeenCalled();

        const coded = fixture({
            note: [
                "Active ![[assets/b160-original.png]] reference.",
                "```text",
                "![[assets/b160-original.png]]",
                "```",
            ].join("\n"),
        });
        const result = await prepare(coded, { attachmentAction: "keep" });
        expect(result.operation.expectedAfter).toBe([
            "Active  reference.",
            "```text",
            "![[assets/b160-original.png]]",
            "```",
        ].join("\n"));
    });

    it("keeps a private source receipt that survives run end but rejects revocation or replacement", async () => {
        const h = fixture();
        const result = await prepare(h, { attachmentAction: "keep" });

        h.endRun();
        expect(result.privatePreparation.revalidate()).toBe(true);

        h.setSourceValid(false);
        expect(result.privatePreparation.revalidate()).toBe(false);

        const replacedNote = fixture();
        const replacedNoteResult = await prepare(replacedNote, { attachmentAction: "keep" });
        replacedNote.replaceNote();
        expect(replacedNoteResult.privatePreparation.revalidate()).toBe(false);

        const replacedOther = fixture();
        const replacedOtherResult = await prepare(replacedOther, { attachmentAction: "delete" });
        replacedOther.replaceOther();
        expect(replacedOtherResult.privatePreparation.revalidate()).toBe(false);

        const addedSource = fixture();
        const addedSourceResult = await prepare(addedSource, { attachmentAction: "delete" });
        addedSource.addSource();
        expect(addedSourceResult.privatePreparation.revalidate()).toBe(false);

        h.setSourceValid(true);
        h.replaceAttachment();
        expect(result.privatePreparation.revalidate()).toBe(true);
    });

    it("checks scanned-source permission before metadata identity during retained revalidation", async () => {
        const h = fixture();
        const result = await prepare(h, { attachmentAction: "delete" });
        expect(result.privatePreparation.revalidate()).toBe(true);

        const getSourceFile = h.host.getSourceFile as jest.Mock;
        getSourceFile.mockClear();
        h.denySource(OTHER_NOTE_PATH);
        expect(result.privatePreparation.revalidate()).toBe(false);
        expect(getSourceFile).not.toHaveBeenCalledWith(OTHER_NOTE_PATH);
    });

    it("checks the independent attachment boundary for delete but not for keep", async () => {
        const deleteBlocked = fixture({ deniedAttachmentPaths: [ATTACHMENT_PATH] });
        await expect(prepare(deleteBlocked)).rejects.toMatchObject({ category: "source_denied" });
        expect(deleteBlocked.host.listSourceFiles).not.toHaveBeenCalled();
        expect(deleteBlocked.host.readAttachmentFile).not.toHaveBeenCalled();

        const keepAllowed = fixture({ deniedAttachmentPaths: [ATTACHMENT_PATH] });
        const keep = await prepare(keepAllowed, { attachmentAction: "keep" });
        expect(keep.privatePreparation.revalidate()).toBe(true);
        keepAllowed.replaceAttachment();
        expect(keep.privatePreparation.revalidate()).toBe(true);

        const deleteChanged = fixture();
        const deleteProposal = await prepare(deleteChanged, { attachmentAction: "delete" });
        expect(deleteProposal.privatePreparation.revalidate()).toBe(true);
        deleteChanged.replaceAttachment();
        expect(deleteProposal.privatePreparation.revalidate()).toBe(false);
    });
});

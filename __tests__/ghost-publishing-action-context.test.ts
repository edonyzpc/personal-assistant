import { describe, expect, it, jest } from "@jest/globals";
import { createPrepareGhostPostTool, type ChatToolContext } from "../src/ai-services/chat-tools";
import { TaskSourceRun } from "../src/ai-services/task-source-run";
import { createGhostActionContext, type GhostActionContextOptions, type GhostActionHost } from "../src/ghost-publishing/action-context";
import type { GhostPost, GhostRequestGate } from "../src/ghost-publishing/client";
import { acceptGhostFormatting, materializeGhostSnapshot } from "../src/ghost-publishing/snapshot";
import { sealCompletedRecord, sealLocalOperation, type GhostLocalOperation, type GhostSnapshot } from "../src/ghost-publishing/state-schema";
import type { GhostActionContext } from "../src/ghost-publishing/service";
import type { GhostPublishingSourceFile, SitePublishingProfile } from "../src/ghost-publishing/types";

const SITE = "https://ghost.example/";
const UID = "note-one";
const POST = "a".repeat(24);
const NOW = "2026-09-29T08:00:00.000Z";
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1]);
interface File extends GhostPublishingSourceFile { text: string; bytes: Uint8Array; revision: number; stat: { mtime: number; size: number } }

function info(markdown: string) {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
    return match ? { exists: true, frontmatter: match[1], contentStart: match[0].length }
        : { exists: false, frontmatter: "", contentStart: 0 };
}
function properties(file: File): Record<string, unknown> { return info(file.text).exists ? JSON.parse(info(file.text).frontmatter) : {}; }
function body(file: File): string { return file.text.slice(info(file.text).contentStart); }
function text(content: string, fields: Record<string, unknown> = {}): string { return `---\n${JSON.stringify(fields)}\n---\n${content}`; }

function fixture(content = "Current paragraph.") {
    const files: File[] = [
        { path: "Article.md", extension: "md", text: text(content), bytes: new Uint8Array(), revision: 1, stat: { mtime: 1, size: 100 } },
        { path: "Embed.md", extension: "md", text: text("Embedded paragraph."), bytes: new Uint8Array(), revision: 1, stat: { mtime: 1, size: 100 } },
        { path: "cover.png", extension: "png", text: "", bytes: bytes.slice(), revision: 1, stat: { mtime: 1, size: bytes.length } },
    ];
    const state = { receipt: true, current: true, desktop: true, web: true, denied: "", connection: "config-1-key-ref-revision-1",
        profile: { siteId: "site-a" } as SitePublishingProfile, readHook: undefined as undefined | (() => Promise<void>) };
    const controller = new AbortController();
    const replace = (file: File, content: string, fields = properties(file)) => {
        file.text = text(content, fields);
        file.revision++;
        // Deliberately preserve mtime/size: generation and actual content are distinct evidence.
    };
    const read = jest.fn(async (source: GhostPublishingSourceFile) => {
        await state.readHook?.();
        return (source as File).text;
    });
    const readBinary = jest.fn(async (source: GhostPublishingSourceFile) => {
        await state.readHook?.();
        return (source as File).bytes.slice().buffer;
    });
    const processFrontMatter = jest.fn(async (source: GhostPublishingSourceFile, mutate: (fields: Record<string, unknown>) => void) => {
        const file = source as File;
        const fields = properties(file);
        mutate(fields);
        replace(file, body(file), fields);
    });
    const host: GhostActionHost = {
        vault: { getAbstractFileByPath: (path) => files.find((file) => file.path === path) ?? null,
            getMarkdownFiles: () => files.filter((file) => file.extension === "md"), read, readBinary },
        metadataCache: {
            getFileCache: (source) => ({ frontmatter: properties(source as File) }),
            getFirstLinkpathDest: (link) => files.find((file) => file.path === link || file.path === `${link}.md`) ?? null,
        },
        fileManager: { processFrontMatter }, getFrontMatterInfo: info, parseYaml: (yaml) => JSON.parse(yaml),
    };
    const downloadImage = jest.fn(async (_url: string, gate: GhostRequestGate) => {
        await gate.beforeSend();
        gate.assertCurrent();
        return { bytes, mimeType: "image/png" };
    });
    const options: GhostActionContextOptions = {
        selection: { path: "Article.md" }, host, client: { downloadImage }, isDesktop: () => state.desktop,
        guard: { isCurrent: () => state.current, isPathAllowed: (path) => path !== state.denied,
            isNoteDomainAllowed: () => true, isWebAllowed: () => state.web, captureSourceValidity: () => () => state.receipt },
        sourceValidity: () => state.receipt, siteId: "site-a", siteUrl: SITE,
        getConnectionIdentity: () => state.connection, getProfile: () => state.profile,
        getSourceRevision: (path) => files.find((file) => file.path === path)?.revision ?? "missing",
        defaultVisibility: "public", signal: controller.signal, createNoteUid: () => UID,
    };
    return { files, state, controller, replace, read, readBinary, processFrontMatter, downloadImage, options };
}

type Prepared = Awaited<ReturnType<GhostActionContext["prepare"]>>;
function operation(prepared: Prepared, kind: GhostLocalOperation["kind"] = "create"): GhostLocalOperation {
    return sealLocalOperation({ schemaVersion: 1, revision: 1, operationId: "op-one", siteId: "site-a", site: SITE,
        noteUid: UID, kind, state: "prepared", candidate: prepared.candidate, currentSource: prepared.currentSource,
        currentIntentHash: prepared.currentIntentHash, baselineRevision: null, target: {}, confirmation: null, updatedAt: NOW });
}
function post(candidate: GhostSnapshot): GhostPost {
    return { ...candidate.content, id: POST, uuid: "11111111-1111-1111-1111-111111111111", status: "published", updated_at: NOW,
        url: `${SITE}article/`, slug: "article" };
}
function completed(baseline: GhostSnapshot, lastUndo?: GhostSnapshot) {
    return sealCompletedRecord({ schemaVersion: 1, revision: 1,
        binding: { noteUid: UID, siteId: "site-a", site: SITE, postId: POST, postUrl: `${SITE}article/` },
        completed: { postId: POST, postUrl: `${SITE}article/`, updatedAt: NOW, status: "published", verifiedAt: NOW }, baseline, lastUndo });
}

describe("Ghost Host action context", () => {
    async function linkedFixture(content = "[[Embed|Read article]]") {
        const f = fixture(content);
        const seed = fixture("Target body");
        const baseline = (await (await createGhostActionContext(seed.options)).context.prepare(null, null, "create")).candidate;
        const targetUid = "linked-note-uid";
        f.replace(f.files[1], "Target body", { pa_ghost: { note_uid: targetUid, site: SITE, post_id: POST, post_url: `${SITE}article/` } });
        const record = sealCompletedRecord({ ...completed(baseline), binding: { ...completed(baseline).binding, noteUid: targetUid } });
        let revision = 1;
        const readRecord = jest.fn(async (_siteId: string, _noteUid: string) => record);
        f.options.readCompletedRecord = readRecord;
        f.options.getCompletedRecordRevision = () => revision;
        return { ...f, record, readRecord, changeRecord: () => { revision++; } };
    }

    async function initialChatUpdateFixture(resourceAllowed: boolean) {
        const f = fixture("Published paragraph.\n\n[[Embed|Read article]]\n\n![cover](cover.png)");
        const seeded = await (await createGhostActionContext(f.options)).context.prepare(null, null, "create");
        const baseline = materializeGhostSnapshot(seeded.candidate,
            seeded.candidate.resources.map((resource) => ({ ...resource, url: `${SITE}content/images/${resource.id}.png` })));
        const record = completed(baseline);
        const sourceRun = new TaskSourceRun({
            runId: "chat-run", userMessageId: "chat-message",
            runSourceSelection: { schemaVersion: 1, scope: "combined", selectionId: "selection-1", userMessageId: "chat-message" },
            userText: "@blog2ghost prepare Article.md", requestText: "@blog2ghost prepare Article.md",
            workspace: { getActiveViewOfType: () => null, getMostRecentLeaf: () => null, getLeavesOfType: () => [] } as never,
            getFileByPath: path => f.files.find(file => file.path === path) ?? null,
            isCurrent: () => f.state.current, areSourcesCurrent: () => f.state.current,
            isWebAllowed: () => f.state.web, isMemoryAllowed: () => true,
        });
        const initialGuard = sourceRun.state.createReadGuard(sourceRun.state.snapshot(), sourceRun.resolveNoteId,
            () => f.state.current, undefined, undefined, () => f.state.web, () => true, () => f.state.receipt);
        f.options.guard = initialGuard;
        f.options.sourceValidity = () => initialGuard.isCurrent();
        f.options.isResourcePathAllowed = (resourcePath, ownerPath) => resourceAllowed
            && resourcePath === "cover.png" && ownerPath === "Article.md";
        const binding = {
            conversationId: "conversation", stableMessageId: "chat-message",
            submit: async () => {
                const action = await createGhostActionContext(f.options);
                createdAction = action;
                try { await action.context.prepare(post(baseline), record, "update"); }
                catch (error) { prepareFailure = error; throw error; }
                return { status: "prepared" as const, operationId: baseline.resources[0].id };
            },
        };
        let createdAction!: Awaited<ReturnType<typeof createGhostActionContext>>;
        let prepareFailure: unknown;
        const tool = createPrepareGhostPostTool(binding as never);
        const context = { host: { log: () => undefined }, taskSourceReadGuard: initialGuard } as unknown as ChatToolContext;
        f.readBinary.mockClear();
        const result = await tool.execute({ intent: "prepare", path: "Article.md" }, context);
        return { f, result, baseline, action: createdAction, prepareFailure };
    }

    it("resolves the allowed linked note from a published record and gates later binding or record changes", async () => {
        const f = await linkedFixture("[[Embed#Section|Read article]] and `[[Not a link]]`");
        const action = await createGhostActionContext(f.options);
        const prepared = await action.context.prepare(null, null, "create");
        expect(prepared.candidate.content.lexical).toContain(`${SITE}article/`);
        expect(prepared.candidate.warnings).toContainEqual({ code: "wiki-link-anchor-fallback", path: "Article.md", line: 4 });
        expect(f.readRecord).toHaveBeenCalledWith("site-a", "linked-note-uid");
        expect(f.readRecord).toHaveBeenCalledTimes(1);
        expect(f.read.mock.calls.every(([file]) => ["Article.md", "Embed.md"].includes(file.path))).toBe(true);
        await action.context.validate(operation(prepared));
        await action.context.bind({ id: POST, url: `${SITE}article/` });
        expect(() => action.context.gate.assertCurrent()).not.toThrow();
        f.changeRecord();
        expect(() => action.context.gate.assertCurrent()).toThrow("source-changed");
        const again = await createGhostActionContext(f.options);
        await again.context.prepare(null, null, "create");
        f.replace(f.files[1], body(f.files[1]), { pa_ghost: { note_uid: "changed", site: SITE } });
        expect(() => again.context.gate.assertCurrent()).toThrow("source-changed");
    });

    it("keeps visible text without reading denied or ambiguous targets and never trusts an unverified record", async () => {
        const denied = await linkedFixture();
        denied.state.denied = "Embed.md";
        const action = await createGhostActionContext(denied.options);
        const prepared = await action.context.prepare(null, null, "create");
        expect(prepared.candidate.content.lexical).toContain("Read article");
        expect(prepared.candidate.content.lexical).not.toContain(`${SITE}article/`);
        expect(denied.readRecord).not.toHaveBeenCalled();
        expect(denied.read.mock.calls.some(([file]) => file.path === "Embed.md")).toBe(false);
        const ambiguous = await linkedFixture();
        ambiguous.files.push({ ...ambiguous.files[1], path: "other/Embed.md" });
        const multiple = await (await createGhostActionContext(ambiguous.options)).context.prepare(null, null, "create");
        expect(multiple.candidate.warnings?.[0].code).toBe("ambiguous-wiki-link");
        expect(ambiguous.readRecord).not.toHaveBeenCalled();
        const invalid = await linkedFixture();
        invalid.readRecord.mockResolvedValue({ ...invalid.record, checksum: "00000000" });
        const unverified = await (await createGhostActionContext(invalid.options)).context.prepare(null, null, "create");
        expect(unverified.candidate.warnings?.[0].code).toBe("unpublished-wiki-link");
    });

    it("rejects permission or completed-record changes while a linked record read is pending", async () => {
        const revoked = await linkedFixture();
        revoked.readRecord.mockImplementation(async () => { await Promise.resolve(); revoked.state.denied = "Embed.md"; return revoked.record; });
        const action = await createGhostActionContext(revoked.options);
        await expect(action.context.prepare(null, null, "create")).rejects.toThrow("source-revoked");
        const changed = await linkedFixture();
        changed.readRecord.mockImplementation(async () => { await Promise.resolve(); changed.changeRecord(); return changed.record; });
        await expect((await createGhostActionContext(changed.options)).context.prepare(null, null, "create")).rejects.toThrow("source-changed");
    });

    it("retains text when one raw link target resolves differently inside two embedded notes", async () => {
        const f = await linkedFixture("![[one/Embed.md]]\n\n![[two/Embed.md]]");
        const records = new Map<string, typeof f.record>();
        for (const folder of ["one", "two"]) {
            f.files.push({ ...f.files[1], path: `${folder}/Embed.md`, text: text(`[[./Target|${folder} link]]`) });
            f.files.push({ ...f.files[1], path: `${folder}/Target.md`, text: text("Target body", {
                pa_ghost: { note_uid: folder, site: SITE, post_id: POST, post_url: `${SITE}${folder}/` },
            }) });
            records.set(folder, sealCompletedRecord({ ...f.record,
                binding: { ...f.record.binding, noteUid: folder, postUrl: `${SITE}${folder}/` },
                completed: { ...f.record.completed, postUrl: `${SITE}${folder}/` },
            }));
        }
        f.readRecord.mockImplementation(async (_siteId, uid) => records.get(uid)!);
        f.options.host.metadataCache.getFirstLinkpathDest = (target, sourcePath) => {
            const relative = target === "./Target" ? `${sourcePath.split("/")[0]}/Target.md` : target;
            return f.files.find((file) => file.path === relative) ?? null;
        };
        const prepared = await (await createGhostActionContext(f.options)).context.prepare(null, null, "create");
        expect(prepared.candidate.content.lexical).toContain("one link");
        expect(prepared.candidate.content.lexical).toContain("two link");
        expect(prepared.candidate.content.lexical).not.toContain(`${SITE}article/`);
        expect(prepared.candidate.warnings).toEqual([
            { code: "ambiguous-wiki-link", path: "one/Embed.md", line: 4 },
            { code: "ambiguous-wiki-link", path: "two/Embed.md", line: 4 },
        ]);
    });

    it("rejects an existing or newly copied target UID without reading unrelated note bodies", async () => {
        const f = await linkedFixture();
        const copy = { ...f.files[1], path: "Renamed copy.md" };
        f.files.push(copy);
        const ambiguous = await (await createGhostActionContext(f.options)).context.prepare(null, null, "create");
        expect(ambiguous.candidate.warnings?.[0].code).toBe("ambiguous-wiki-link");
        expect(f.readRecord).not.toHaveBeenCalled();
        expect(f.read.mock.calls.some(([file]) => file.path === copy.path)).toBe(false);
        f.files.pop();
        const action = await createGhostActionContext(f.options);
        await action.context.prepare(null, null, "create");
        f.files.push(copy);
        expect(() => action.context.gate.assertCurrent()).toThrow("source-changed");
    });

    it("exports real source, validates effective frontmatter, and permits only pa_ghost changes during binding", async () => {
        const f = fixture("Current paragraph.\n\n![[Embed.md]]");
        const action = await createGhostActionContext(f.options);
        expect(action.noteUid).toBe(UID);
        expect(properties(f.files[0]).pa_ghost).toEqual({ note_uid: UID, site: SITE });
        expect(f.processFrontMatter).toHaveBeenCalledTimes(1);
        const prepared = await action.context.prepare(null, null, "create");
        expect(prepared.candidate.content.lexical).toContain("Embedded paragraph.");
        const saved = operation(prepared);
        await expect(action.context.validate(saved)).resolves.toBeUndefined();
        await expect(action.context.validate({ ...saved, currentIntentHash: undefined })).rejects.toMatchObject({ code: "invalid-operation" });
        await action.context.bind({ id: POST, url: `${SITE}article/` });
        expect(() => action.context.gate.assertCurrent()).not.toThrow();
        await expect(action.context.validate(saved)).resolves.toBeUndefined();
        f.replace(f.files[1], body(f.files[1]), { unrelated: "embedded frontmatter does not publish" });
        const resumed = await createGhostActionContext(f.options);
        await expect(resumed.context.validate(saved)).resolves.toBeUndefined();
        f.replace(f.files[0], body(f.files[0]), { ...properties(f.files[0]), ghost: { custom_excerpt: "Changed only in Properties" } });
        const changed = await createGhostActionContext(f.options);
        await expect(changed.context.validate(saved)).rejects.toMatchObject({ code: "source-changed" });
        const withoutGhost = { ...properties(f.files[0]) };
        delete withoutGhost.ghost;
        f.replace(f.files[0], "Changed actual note body.\n\n![[Embed.md]]", withoutGhost);
        const changedBody = await createGhostActionContext(f.options);
        await expect(changedBody.context.validate(saved)).rejects.toMatchObject({ code: "source-changed" });
        expect(f.downloadImage).not.toHaveBeenCalled();
    });

    it("hashes current local bytes on validation and rechecks source receipt, including await revocation and mobile zero reads", async () => {
        const f = fixture("![cover](cover.png)");
        const action = await createGhostActionContext(f.options);
        const prepared = await action.context.prepare(null, null, "create");
        const saved = operation(prepared);
        expect(prepared.images).toHaveLength(1);
        expect(prepared.candidate.content.lexical).toContain("pending-resource://");
        await action.context.validate(saved);
        const count = f.readBinary.mock.calls.length;
        f.files[2].bytes[9] = 2; // Same path, event generation and stat: actual bytes still detect this.
        await expect(action.context.validate(saved)).rejects.toMatchObject({ code: "resource-changed" });
        expect(f.readBinary.mock.calls.length).toBeGreaterThan(count);
        f.state.receipt = false;
        expect(() => action.context.gate.assertCurrent()).toThrow("source-revoked");
        const waiting = fixture("![cover](cover.png)");
        const waitingAction = await createGhostActionContext(waiting.options);
        waiting.readBinary.mockImplementation(async () => { await Promise.resolve(); waiting.state.receipt = false; return bytes.slice().buffer; });
        await expect(waitingAction.context.prepare(null, null, "create")).rejects.toThrow();
        const mobile = fixture();
        mobile.state.desktop = false;
        await expect(createGhostActionContext(mobile.options)).rejects.toMatchObject({ code: "desktop-required" });
        expect(mobile.read).not.toHaveBeenCalled();
        expect(mobile.processFrontMatter).not.toHaveBeenCalled();
        for (const missing of ["guard", "sourceValidity"] as const) {
            const denied = fixture();
            Object.assign(denied.options, { [missing]: undefined });
            await expect(createGhostActionContext(denied.options)).rejects.toThrow("source-revoked");
            expect(denied.read).not.toHaveBeenCalled();
            expect(denied.processFrontMatter).not.toHaveBeenCalled();
        }
    });

    it("admits an explicit local image for an initial Chat update and rejects an excluded image before reads", async () => {
        const admitted = await initialChatUpdateFixture(true);
        if (!admitted.result.ok) expect(admitted.prepareFailure).toMatchObject({ code: "context-revoked" });
        expect(admitted.result.ok).toBe(true);
        expect(admitted.f.readBinary).toHaveBeenCalledTimes(1);
        expect(admitted.result.resultFact).toEqual({ kind: "approval_pending", intentId: admitted.baseline.resources[0].id });
        expect(() => admitted.action.context.gate.assertCurrent()).not.toThrow();
        const linkChanged = await initialChatUpdateFixture(true);
        linkChanged.f.files[1].revision++;
        expect(() => linkChanged.action.context.gate.assertCurrent()).toThrow("source-changed");
        await expect(linkChanged.action.context.gate.beforeSend()).rejects.toThrow("source-changed");

        admitted.f.files[2].revision++;
        expect(() => admitted.action.context.gate.assertCurrent()).toThrow("source-changed");
        await expect(admitted.action.context.gate.beforeSend()).rejects.toThrow("source-changed");

        const excluded = await initialChatUpdateFixture(true);
        excluded.f.options.isResourcePathAllowed = () => false;
        await expect(excluded.action.context.gate.beforeSend()).rejects.toThrow("source-revoked");

        const denied = await initialChatUpdateFixture(false);
        expect(denied.result.ok).toBe(false);
        expect(denied.f.readBinary).not.toHaveBeenCalled();
        expect(denied.result.error).toContain("Check its publishing card before retrying");
    });

    it("keeps an explicit historical local image admitted and revision-tracked for an initial Chat restore", async () => {
        const seed = await initialChatUpdateFixture(true);
        const lastUndo = materializeGhostSnapshot(seed.baseline,
            seed.baseline.resources.map((resource) => ({ ...resource, url: `${SITE}content/images/${resource.id}.png` })));
        const record = completed(seed.baseline, lastUndo);
        const restored = await seed.action.context.prepare(post(seed.baseline), record, "restore");
        expect(restored.candidate.resources[0].url).toBe(lastUndo.resources[0].url);
        seed.f.files[2].revision++;
        expect(() => seed.action.context.gate.assertCurrent()).toThrow("source-changed");
    });

    it("fixes an explicit remote resource once and validates later requests without downloading it repeatedly", async () => {
        const url = "https://images.example/exact.png?version=1";
        const f = fixture(`![cover](${url})`);
        const action = await createGhostActionContext(f.options);
        const prepared = await action.context.prepare(null, null, "create");
        const saved = operation(prepared);
        await action.context.validate(saved);
        await action.context.validate(saved);
        expect(f.downloadImage).toHaveBeenCalledTimes(1);
        expect(f.downloadImage.mock.calls[0][0]).toBe(url);
        const resumed = await createGhostActionContext(f.options);
        await resumed.context.validate(saved);
        expect(f.downloadImage).toHaveBeenCalledTimes(1);
        const image = await resumed.context.readImage(saved.candidate.resources[0]);
        expect(image.metadata.byteHash).toBe(saved.candidate.resources[0].byteHash);
        expect(f.downloadImage).toHaveBeenCalledTimes(2);
        f.state.web = false;
        expect(() => resumed.context.gate.assertCurrent()).toThrow("source-revoked");
        await expect(resumed.context.validate(saved)).rejects.toThrow();
    });

    it("restores historical content independently of current note bytes while requiring every historical source path", async () => {
        const f = fixture("Historical paragraph.\n\n![[Embed.md]]\n\n![cover](cover.png)");
        const oldAction = await createGhostActionContext(f.options);
        const old = await oldAction.context.prepare(null, null, "create");
        const history = materializeGhostSnapshot(old.candidate, old.candidate.resources.map((resource) => ({ ...resource, url: `${SITE}content/images/old.png` })));
        f.replace(f.files[0], "Current paragraph is different.");
        f.files[2].bytes[9] = 8;
        f.files[2].revision++;
        const currentAction = await createGhostActionContext(f.options);
        const now = await currentAction.context.prepare(null, null, "create");
        const record = completed(now.candidate, history);
        f.readBinary.mockClear();
        const restore = await currentAction.context.prepare(post(now.candidate), record, "restore");
        expect(restore.candidate.content.lexical).toContain("Historical paragraph.");
        expect(restore.currentSource.dependencies[0].contentHash).not.toBe(restore.candidate.source.dependencies[0].contentHash);
        const saved = operation(restore, "restore");
        await expect(currentAction.context.validate(saved)).resolves.toBeUndefined();
        expect(f.readBinary).not.toHaveBeenCalled();
        for (const path of ["Embed.md", "cover.png"]) {
            f.state.denied = path;
            expect(() => currentAction.context.gate.assertCurrent()).toThrow("source-revoked");
            await expect(currentAction.context.validate(saved)).rejects.toThrow("source-revoked");
        }
        f.state.denied = "";
        // Normal update also permits local text to differ from the old remote baseline.
        const update = await currentAction.context.prepare(post(history), completed(history), "update");
        expect(update.candidate.content.lexical).toContain("Current paragraph is different.");
    });

    it("fresh-reads historical Markdown before restore when MetadataCache still admits an excluded source", async () => {
        const f = fixture("Historical paragraph.\n\n![[Embed.md]]");
        const old = await (await createGhostActionContext(f.options)).context.prepare(null, null, "create");
        const record = completed(old.candidate, old.candidate);
        f.replace(f.files[0], "Current main no longer embeds the historical note.");
        const action = await createGhostActionContext(f.options);
        f.replace(f.files[1], "#no-ai\n\nNew private body");
        f.read.mockImplementation(async (source: GhostPublishingSourceFile) => {
            const file = source as File;
            if (file.path === "Embed.md" && file.text.includes("#no-ai")) {
                throw Object.assign(new Error("Fresh content denied"), { code: "source-revoked" });
            }
            return file.text;
        });
        await expect(action.context.prepare(post(old.candidate), record, "restore"))
            .rejects.toThrow("Fresh content denied");
        expect(f.read).toHaveBeenCalledWith(expect.objectContaining({ path: "Embed.md" }));

        f.read.mockImplementation(async (source: GhostPublishingSourceFile) => (source as File).text);
        f.replace(f.files[1], "Allowed current historical body");
        const restored = await action.context.prepare(post(old.candidate), record, "restore");
        expect(restored.candidate.content.lexical).toContain("Historical paragraph.");
        const saved = operation(restored, "restore");
        await expect(action.context.validate(saved)).resolves.toBeUndefined();
        f.files[1].revision++;
        await expect(action.context.gate.beforeSend()).rejects.toThrow("source-changed");
    });

    it("uses the validated prior create candidate as the baseline when re-preparing its draft", async () => {
        const f = fixture("Keep paragraph.");
        const initialAction = await createGhostActionContext(f.options);
        const initial = await initialAction.context.prepare(null, null, "create");
        const remoteLexical = JSON.parse(initial.candidate.content.lexical);
        remoteLexical.root.children[0].children[0].format = 1;
        const draft = { ...post(initial.candidate), status: "draft" as const,
            lexical: JSON.stringify(remoteLexical), url: `${SITE}draft/` };
        const previous = acceptGhostFormatting(initial.candidate, draft);
        f.replace(f.files[0], "Keep paragraph.\n\nChanged locally.");
        const action = await createGhostActionContext(f.options);
        const prepared = await action.context.prepare(draft, null, "create", previous);
        const nodes = JSON.parse(prepared.candidate.content.lexical).root.children;
        expect(nodes[0].children[0].format).toBe(1);
        expect(JSON.stringify(nodes[1])).toContain("Changed locally.");
    });

    it("maps only the uniquely bound historical main path after the note is renamed", async () => {
        const f = fixture("Historical paragraph.\n\n![[Embed.md]]");
        const oldAction = await createGhostActionContext(f.options);
        const old = await oldAction.context.prepare(null, null, "create");
        f.files[0] = { ...f.files[0], path: "New.md" };
        f.options.selection.path = "New.md";
        const currentAction = await createGhostActionContext(f.options);
        const now = await currentAction.context.prepare(null, null, "create");
        f.files.push({ ...f.files[0], path: "Article.md",
            text: text("Unrelated current occupant", { pa_ghost: { note_uid: "unrelated-note", site: SITE } }),
            revision: 99 });
        f.state.denied = "Article.md";
        const record = completed(now.candidate, old.candidate);
        const restored = await currentAction.context.prepare(post(now.candidate), record, "restore");
        expect(restored.candidate.content.lexical).toContain("Historical paragraph.");
        expect(restored.currentSource.targetPath).toBe("New.md");
    });

    it("separates completed repair from candidate equality and keeps final connection, profile, permission and freshness fences", async () => {
        const f = fixture("Published paragraph.\n\n![[Embed.md]]");
        const action = await createGhostActionContext(f.options);
        const prepared = await action.context.prepare(null, null, "create");
        const saved = operation(prepared);
        f.replace(f.files[0], "```dataview\nUnsupported new candidate\n```");
        const repair = await createGhostActionContext(f.options);
        await expect(repair.context.validate(saved, "completed")).resolves.toBeUndefined();
        await expect(repair.context.validate(saved, "reconcile")).resolves.toBeUndefined();
        await expect(repair.context.validate(saved)).rejects.toThrow();
        await repair.context.bind({ id: POST, url: `${SITE}article/` });
        expect(() => repair.context.gate.assertCurrent()).not.toThrow();
        f.state.denied = "Embed.md";
        await expect(repair.context.validate(saved, "completed")).rejects.toThrow("source-revoked");
        f.state.denied = "";
        for (const change of ["connection", "profile", "cancel", "freshness"] as const) {
            const separate = fixture();
            const freshAction = await createGhostActionContext(separate.options);
            await freshAction.context.prepare(null, null, "create");
            await freshAction.context.gate.beforeSend();
            if (change === "connection") separate.state.connection = "config-1-key-ref-revision-2";
            if (change === "profile") separate.state.profile = { siteId: "site-a", prism: { compatible: false, evidence: "unknown" } };
            if (change === "cancel") separate.controller.abort();
            if (change === "freshness") separate.files[0].revision++;
            expect(() => freshAction.context.gate.assertCurrent()).toThrow();
        }
    });
});

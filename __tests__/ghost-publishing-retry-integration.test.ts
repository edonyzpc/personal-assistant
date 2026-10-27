import { describe, expect, it, jest } from "@jest/globals";
import { Platform, TFile, type App } from "obsidian";
import { GhostPublishingIntegration, type GhostChatBindingRequest } from "../src/ghost-publishing/host-integration";
import { createPrepareGhostPostTool } from "../src/ai-services/chat-tool-factories";
import type { ChatToolContext } from "../src/ai-services/chat-tools";
import type { GhostActionAuthority, GhostPublishingController } from "../src/ghost-publishing/controller";
import { GhostClientError, type GhostPost, type GhostPostWrite, type GhostRequestGate } from "../src/ghost-publishing/client";
import { GhostPublishingService } from "../src/ghost-publishing/service";

const SITE = "https://ghost.example/";
const SITE_ID = "site-a";
const POST = "a".repeat(24);
const NOW = "2026-10-27T00:00:00.000Z";
const NEXT = "2026-10-27T00:00:01.000Z";

interface TestFile extends TFile {
    text: string;
    bytes: Uint8Array;
}

interface ObservingSession {
    observe(siteId: string, operation: unknown): void;
}

function file(path: string, text: string, bytes = new Uint8Array()): TestFile {
    const name = path.split("/").pop()!;
    return Object.assign(new TFile(), {
        path, name, basename: name.replace(/\.[^.]+$/, ""),
        extension: name.includes(".") ? name.split(".").pop()! : "",
        stat: { ctime: 1, mtime: 1, size: text.length },
        text, bytes,
    });
}

function remotePost(): GhostPost {
    return {
        id: POST, uuid: "11111111-1111-1111-1111-111111111111", status: "draft", updated_at: NOW,
        url: `${SITE}old-draft/`, slug: "old-draft", title: "Old draft", lexical: null, tags: [],
        authors: [{ id: "f".repeat(24) }], visibility: "public", feature_image: null,
        feature_image_alt: null, feature_image_caption: null, custom_excerpt: "Old summary",
        meta_description: "Old SEO", custom_template: null, codeinjection_head: null,
        codeinjection_foot: null, published_at: null,
    };
}

describe("Ghost retry integration", () => {
    it("continues an unknown draft PUT with fresh scope after an old dependency disappears", async () => {
        Platform.isDesktop = true;
        Platform.isMobile = false;
        const initialMain = `---\nGHOST_ID: ${POST}\n---\n\n![[Embedded.md]]`;
        const files = new Map<string, TestFile>([
            ["Main.md", file("Main.md", initialMain)],
            ["Embedded.md", file("Embedded.md", "Embedded body\n\n![Local](cover.png)")],
            ["cover.png", file("cover.png", "", new Uint8Array([1, 2, 3, 4]))],
        ]);
        const events = new Map<string, (file: { path: string }, oldPath?: string) => void>();
        const read = jest.fn(async (source: TestFile) => files.get(source.path)?.text ?? "");
        const readBinary = jest.fn(async (source: TestFile) => (files.get(source.path)?.bytes ?? new Uint8Array()).slice().buffer);
        const app = {
            vault: {
                configDir: ".obsidian", getName: () => "synthetic",
                getMarkdownFiles: () => [...files.values()].filter(item => item.extension === "md"),
                getAbstractFileByPath: (path: string) => files.get(path) ?? null,
                on: (name: string, callback: (file: { path: string }, oldPath?: string) => void) => {
                    events.set(name, callback); return { name };
                },
                offref: jest.fn(), read, readBinary,
            },
            metadataCache: {
                getFileCache: () => null,
                getFirstLinkpathDest: (link: string, source: string) => {
                    const direct = files.get(link) ?? files.get(`${link}.md`);
                    if (direct) return direct;
                    const sourceDirectory = source.split("/").slice(0, -1).join("/");
                    return sourceDirectory ? files.get(`${sourceDirectory}/${link}`) ?? null : null;
                },
            },
            fileManager: { processFrontMatter: async () => undefined },
            workspace: { getLeaf: () => { throw new Error("No UI in integration test"); } },
            secretStorage: { getSecret: jest.fn(() => null), setSecret: jest.fn() },
        } as unknown as App;

        const remote = remotePost();
        const gateCalls: string[] = [];
        const send = async (gate: GhostRequestGate, label: string): Promise<void> => {
            gateCalls.push(label);
            await gate.beforeSend();
            gate.assertCurrent();
        };
        const client = {
            readPost: jest.fn(async (id: string, gate: GhostRequestGate) => {
                await send(gate, `read:${id}`);
                if (id !== POST || !files.has("Main.md")) throw new GhostClientError("post-not-found", "failed", 404);
                return structuredClone(remote);
            }),
            listTags: jest.fn(async (gate: GhostRequestGate) => {
                await send(gate, "list-tags");
                return [];
            }),
            createDraft: jest.fn(async () => { throw new Error("The existing draft must be updated by ID"); }),
            updatePost: jest.fn(async (id: string, version: string, fields: GhostPostWrite, gate: GhostRequestGate) => {
                await send(gate, `update:${id}`);
                if (id !== POST || remote.updated_at !== version) throw new GhostClientError("conflict", "failed", 409);
                if (client.updatePost.mock.calls.length === 1) throw new GhostClientError("network", "unknown");
                const saved = { ...remote, ...fields, id, status: "draft" as const,
                    tags: fields.tags?.map(tag => ({ ...tag, name: tag.name! })) ?? [],
                    updated_at: new Date(Date.parse(NOW) + 1000).toISOString() };
                Object.assign(remote, saved);
                return structuredClone(saved);
            }),
            deleteDraft: jest.fn(async () => undefined),
            uploadImage: jest.fn(async (_image: unknown, gate: GhostRequestGate) => {
                await send(gate, "upload");
                return { url: `${SITE}content/images/retry.png` };
            }),
        };
        const previews = {
            read: jest.fn(async () => undefined), write: jest.fn(async () => undefined),
            remove: jest.fn(async () => undefined), close: jest.fn(),
        };
        const sessions = new Set<ObservingSession>();
        let operationSequence = 0;
        const service = new GhostPublishingService({
            siteId: SITE_ID, site: SITE, isDesktop: () => true, client, previews,
            newId: () => `retry-${++operationSequence}`,
            onUpdate: operation => {
                for (const session of sessions) session.observe(SITE_ID, operation);
            },
        });
        const integration = new GhostPublishingIntegration({
            app, pluginId: "personal-assistant", vaultPath: "/synthetic/vault",
            getSettings: () => ({ siteUrl: SITE, defaultVisibility: "public", maxUploadBytes: 32, profile: {} }),
            saveSettings: async () => undefined, isCurrent: () => true,
            isPathAllowed: path => files.has(path), isContentAllowed: path => files.has(path),
            isWebAllowed: () => false,
            generateMetadata: async ({ needed }) => ({
                ...(needed.customExcerpt ? { customExcerpt: "Current summary" } : {}),
                ...(needed.metaDescription ? { metaDescription: "Current SEO" } : {}),
                ...(needed.slug ? { slug: "current-note" } : {}),
                ...(needed.tags ? { tags: [] } : {}),
            }),
        });
        const identity = "retry-integration-identity";
        jest.spyOn(integration.configuration, "getIdentity").mockReturnValue(identity);
        jest.spyOn(integration.configuration, "connection").mockResolvedValue({
            siteId: SITE_ID, siteUrl: SITE, identity, profile: { siteId: SITE_ID },
            defaultVisibility: "public", maxUploadBytes: 32,
        });
        const controller = (integration as unknown as { controller: GhostPublishingController }).controller;
        (controller as unknown as { runtimes: Map<string, unknown> }).runtimes.set(SITE_ID, { client, service, previews });
        (controller as unknown as { sessions: Set<ObservingSession> }).sessions = sessions;

        const authority: GhostActionAuthority = { guard: { isCurrent: () => true, isPathAllowed: () => true,
            isNoteDomainAllowed: () => true, isWebAllowed: () => false, captureSourceValidity: () => () => true },
            sourceValidity: () => true };
        const request: GhostChatBindingRequest = { conversationId: "conversation", stableMessageId: "message",
            userText: "@blog2ghost 当前笔记发不到ghost平台", capturedPath: "Main.md", isCurrent: () => true,
            getSourceSelection: () => ({ scope: "notes", selectionId: "selection-0" }),
            onSession: session => {
                const runtimeSession = session as unknown as { observe?: unknown };
                if (typeof runtimeSession.observe !== "function") throw new Error("Ghost runtime session has no observer bridge.");
                sessions.add(session as unknown as ObservingSession);
            } };
        const tool = createPrepareGhostPostTool(integration.createBinding(request)!);
        const context = { host: { log: () => undefined }, taskSourceReadGuard: authority.guard,
            signal: new AbortController().signal } as unknown as ChatToolContext;

        const unknown = await tool.execute({ intent: "prepare", path: "Main.md" }, context);
        expect(unknown).toMatchObject({ ok: true, executionState: "acceptance_unknown",
            resultFact: { kind: "unknown" }, content: { facts: {
                stage: "post-save", reason: "network", postEffect: "unknown", uploadedCount: 1,
            } } });
        const embeddedReadsBeforeRetry = read.mock.calls.filter(([source]) => source.path === "Embedded.md").length;

        files.set("Main.md", file("Main.md", `---\nGHOST_ID: ${POST}\n---\n\nCurrent body without embed.\n\n![Local](cover.png)`));
        events.get("modify")!({ path: "Main.md" });
        events.get("delete")!({ path: "Embedded.md" });
        files.delete("Embedded.md");
        remote.updated_at = NEXT;

        client.readPost.mockImplementationOnce(async (id: string, gate: GhostRequestGate) => {
            await send(gate, `read:${id}`);
            throw new GhostClientError("network", "failed");
        });
        const transientReadFailure = await tool.execute({ intent: "prepare", path: "Main.md" }, context);
        expect(transientReadFailure).toMatchObject({ ok: true, executionState: "not_started",
            recovery: { code: "ghost_attention_required", allowedActions: ["retry", "needs_user"] },
            content: { facts: { stage: "source", reason: "network", postEffect: "not_sent" } } });
        expect(client.uploadImage).toHaveBeenCalledTimes(1);
        expect(client.updatePost).toHaveBeenCalledTimes(1);

        const recovered = await tool.execute({ intent: "prepare", path: "Main.md" }, context);
        expect(recovered).toMatchObject({ ok: true, executionState: "succeeded",
            resultFact: { kind: "approval_pending", intentId: expect.stringMatching(/^retry-/) } });
        expect(read.mock.calls.filter(([source]) => source.path === "Embedded.md").length).toBe(embeddedReadsBeforeRetry);
        expect(readBinary).toHaveBeenCalledTimes(2);
        expect(client.createDraft).not.toHaveBeenCalled();
        expect(client.uploadImage).toHaveBeenCalledTimes(2);
        expect(client.updatePost).toHaveBeenCalledTimes(2);
        expect(client.updatePost.mock.calls[1]?.slice(0, 2)).toEqual([POST, NEXT]);
        expect(remote.title).toBe("Main");
        expect(remote.lexical).toContain("Current body without embed.");
        expect(remote.lexical).not.toContain("Embedded body");
        expect(gateCalls).toEqual(expect.arrayContaining([`read:${POST}`, `update:${POST}`, "upload"]));
        integration.dispose();
    });
});

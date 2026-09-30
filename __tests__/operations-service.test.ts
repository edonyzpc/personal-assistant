import { describe, expect, it, jest } from "@jest/globals";

import type { ProviderLoadContext } from "../src/ai-services/capability-types";
import { OperationsControllerError } from "../src/ai-services/operations/operations-intent-controller";
import { formatOperationsPreview } from "../src/ai-services/operations/operations-presentation";
import {
    OperationsService,
} from "../src/ai-services/operations/operations-service";
import { OperationsToolProvider } from "../src/ai-services/operations/operations-tool-provider";
import type {
    OperationsControllerEvent,
    OperationsVault,
    OperationsVaultFile,
    PreparedOperation,
} from "../src/ai-services/operations/types";

class MemoryVault implements OperationsVault {
    readonly files = new Map<string, string>();
    readonly folders = new Set<string>(["notes"]);

    readonly adapter = {
        exists: jest.fn(async (path: string) => this.files.has(path) || this.folders.has(path)),
    };

    readonly cachedRead = jest.fn(async (file: OperationsVaultFile) => {
        const content = this.files.get(file.path);
        if (content === undefined) throw new Error("missing");
        return content;
    });

    readonly create = jest.fn(async (path: string, content: string) => {
        if (this.files.has(path) || this.folders.has(path)) throw new Error("collision");
        this.files.set(path, content);
        return { path };
    });

    readonly process = jest.fn(async (file: OperationsVaultFile, fn: (current: string) => string) => {
        const current = this.files.get(file.path);
        if (current === undefined) throw new Error("missing");
        const next = fn(current);
        this.files.set(file.path, next);
        return next;
    });

    getAbstractFileByPath(path: string): OperationsVaultFile | null {
        if (this.files.has(path)) return { path, extension: "md" };
        if (this.folders.has(path)) return { path, children: [] };
        return null;
    }
}

function providerContext(enabled = true): ProviderLoadContext {
    return {
        turnId: "turn-1",
        platform: "desktop",
        settings: { operationsAgentEnabled: enabled },
    };
}

function appendInput(path: string, content: string) {
    return {
        runId: "run-1",
        turnId: "turn-1",
        operations: [
            { toolCallId: `call-${path}`, name: "vault_append" as const, input: { path, content } },
        ],
    };
}

describe("OperationsToolProvider shared identity", () => {
    it("returns the same four capability objects across repeated loads", async () => {
        const provider = new OperationsToolProvider();
        const first = await provider.load(providerContext());
        const second = await provider.load(providerContext());

        expect(first.status).toBe("available");
        expect(second.status).toBe("available");
        expect(first.capabilities).toHaveLength(4);
        expect(second.capabilities).toHaveLength(4);
        first.capabilities.forEach((capability, index) => {
            expect(second.capabilities[index]).toBe(capability);
        });
    });
});

describe("OperationsService", () => {
    it("shares provider and policy configuration while isolating surface state", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/chat.md", "Chat");
        vault.files.set("notes/pagelet.md", "Pagelet");
        let enabled = true;
        const chatSelfWrite = jest.fn();
        const pageletSelfWrite = jest.fn();
        const service = new OperationsService({
            vault,
            trashFile: async () => undefined,
            isOperationsAgentEnabled: () => enabled,
            isPathAllowed: (path) => path.startsWith("notes/"),
        });
        const chat = service.createSession({ surface: "chat", markSelfWrite: chatSelfWrite });
        const pagelet = service.createSession({ surface: "pagelet", markSelfWrite: pageletSelfWrite });
        const chatEvents: OperationsControllerEvent[] = [];
        const pageletEvents: OperationsControllerEvent[] = [];
        chat.subscribe((event) => chatEvents.push(event));
        pagelet.subscribe((event) => pageletEvents.push(event));

        expect(chat.provider).toBe(service.provider);
        expect(pagelet.provider).toBe(service.provider);
        expect(chat.capabilityProvider).toBe(pagelet.capabilityProvider);

        const chatIntent = await chat.stage(appendInput("notes/chat.md", "chat staged"));
        const pageletIntent = await pagelet.stageIntent(appendInput("notes/pagelet.md", "pagelet confirmed"));
        chat.cancelPending();
        const result = await pagelet.confirm(pageletIntent.id);

        expect(result.state).toBe("completed");
        expect(vault.files.get("notes/chat.md")).toBe("Chat");
        expect(vault.files.get("notes/pagelet.md")).toBe("Pagelet\npagelet confirmed");
        expect(chatEvents).toContainEqual(expect.objectContaining({
            type: "intent-cancelled",
            intent: expect.objectContaining({ id: chatIntent.id }),
        }));
        expect(pageletEvents.some((event) => event.type === "intent-result")).toBe(true);
        expect(chatSelfWrite).not.toHaveBeenCalled();
        expect(pageletSelfWrite).toHaveBeenCalledWith("notes/pagelet.md");

        enabled = false;
        service.dispose();
    });

    it("fails closed before staging when Operations is disabled", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "A");
        const service = new OperationsService({
            vault,
            trashFile: async () => undefined,
            isOperationsAgentEnabled: () => false,
        });
        const session = service.createSession({ surface: "pagelet" });

        await expect(session.stage(appendInput("notes/a.md", "blocked"))).rejects.toMatchObject({
            category: "cancelled",
        });
        expect(vault.cachedRead).not.toHaveBeenCalled();
        expect(vault.process).not.toHaveBeenCalled();
        service.dispose();
    });

    it("cancels a proposal when Operations is disabled during staging", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "A");
        let enabled = true;
        vault.cachedRead.mockImplementationOnce(async (file) => {
            enabled = false;
            return vault.files.get(file.path) ?? "";
        });
        const service = new OperationsService({
            vault,
            trashFile: async () => undefined,
            isOperationsAgentEnabled: () => enabled,
        });
        const session = service.createSession({ surface: "pagelet" });
        const events: OperationsControllerEvent[] = [];
        session.subscribe((event) => events.push(event));

        await expect(session.stage(appendInput("notes/a.md", "blocked"))).rejects.toThrow(
            "Operations is no longer enabled",
        );
        expect(events.map((event) => event.type)).toEqual(["intent-staged", "intent-cancelled"]);
        expect(vault.process).not.toHaveBeenCalled();
        service.dispose();
    });

    it("cancels pending confirmation when Operations is disabled", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "A");
        let enabled = true;
        const service = new OperationsService({
            vault,
            trashFile: async () => undefined,
            isOperationsAgentEnabled: () => enabled,
        });
        const session = service.createSession({ surface: "chat" });
        const events: OperationsControllerEvent[] = [];
        session.subscribe((event) => events.push(event));
        const intent = await session.stage(appendInput("notes/a.md", "blocked"));

        enabled = false;
        await expect(session.confirm(intent.id)).rejects.toThrow("Nothing was written");
        expect(events).toContainEqual(expect.objectContaining({
            type: "intent-cancelled",
            intent: expect.objectContaining({ id: intent.id }),
        }));
        expect(vault.process).not.toHaveBeenCalled();
        service.dispose();
    });

    it("shares the Data Boundary across sessions without audit storage", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "A");
        vault.files.set("private.md", "Private");
        const service = new OperationsService({
            vault,
            trashFile: async () => undefined,
            isOperationsAgentEnabled: () => true,
            isPathAllowed: (path) => path.startsWith("notes/"),
        });
        const chat = service.createSession({ surface: "chat" });
        const pagelet = service.createSession({ surface: "pagelet" });

        await expect(chat.stage(appendInput("private.md", "blocked"))).rejects.toMatchObject({
            category: "boundary_denied",
        });
        const intent = await pagelet.stage(appendInput("notes/a.md", "ok"));
        await pagelet.confirm(intent.id);

        expect(vault.adapter.exists).not.toHaveBeenCalledWith(".obsidian/plugins/personal-assistant/audit");
        service.dispose();
    });

    it("disposes all sessions and rejects later staging", async () => {
        const vault = new MemoryVault();
        vault.files.set("notes/a.md", "A");
        const service = new OperationsService({
            vault,
            trashFile: async () => undefined,
            isOperationsAgentEnabled: () => true,
        });
        const session = service.createSession({ surface: "chat" });
        service.dispose();

        await expect(session.stage(appendInput("notes/a.md", "blocked"))).rejects.toBeInstanceOf(
            OperationsControllerError,
        );
        expect(() => service.createSession({ surface: "pagelet" })).toThrow("service is disposed");
    });
});

describe("formatOperationsPreview", () => {
    it("preserves create, append, frontmatter, and before/after semantics", () => {
        expect(formatOperationsPreview(operation({
            name: "vault_create",
            input: { path: "notes/new.md", content: "Created" },
            expectedBefore: null,
            expectedAfter: "Created",
        }))).toBe("Created");
        expect(formatOperationsPreview(operation({
            name: "vault_append",
            input: { path: "notes/a.md", content: "Added" },
            expectedBefore: "A",
            expectedAfter: "A\nAdded",
        }))).toBe("+ Added");
        expect(formatOperationsPreview(operation({
            name: "frontmatter_update",
            input: { path: "notes/a.md", set: { status: "done" }, delete: ["old"] },
            expectedBefore: "---\n---",
            expectedAfter: "---\nstatus: done\n---",
        }))).toBe('Set status: "done"\nRemove old');
        expect(formatOperationsPreview(operation({
            name: "vault_process",
            input: {
                path: "notes/a.md",
                operation: "replace",
                params: { search: "Before", replace: "After" },
            },
            expectedBefore: "Before value",
            expectedAfter: "After value",
        }))).toBe("Before\nBefore value\n\nAfter\nAfter value");
    });

    it("keeps complete replacement ranges while bounding only unchanged context", () => {
        const before = `OLD-START-${"O".repeat(1_800)}-OLD-END`;
        const after = `NEW-START-${"N".repeat(1_800)}-NEW-END`;
        const preview = formatOperationsPreview(operation({
            name: "vault_process",
            input: {
                path: "notes/a.md",
                operation: "replace",
                params: { search: "A", replace: "B" },
            },
            expectedBefore: before,
            expectedAfter: after,
        }));

        expect(preview).toContain("OLD-START-");
        expect(preview).toContain("-OLD-END");
        expect(preview).toContain("NEW-START-");
        expect(preview).toContain("-NEW-END");
        expect(preview).not.toContain("…");
    });

    it("keeps replacement text visible when Before exceeds the legacy preview limit", () => {
        const before = `unchanged prefix\n${"B".repeat(1_800)}\nunchanged suffix`;
        const after = "unchanged prefix\nNEW-START replacement that must remain reachable NEW-END\nunchanged suffix";
        const preview = formatOperationsPreview(operation({
            name: "vault_process",
            input: {
                path: "notes/a.md",
                operation: "replace",
                params: { search: before, replace: after },
            },
            expectedBefore: before,
            expectedAfter: after,
        }));

        expect(preview).toContain("After");
        expect(preview).toContain("NEW-START");
        expect(preview).toContain("NEW-END");
    });
});

function operation(
    input: Pick<PreparedOperation, "name" | "input" | "expectedBefore" | "expectedAfter">,
): PreparedOperation {
    return {
        id: "operation-1",
        toolCallId: "call-1",
        path: input.input.path,
        ...input,
    };
}

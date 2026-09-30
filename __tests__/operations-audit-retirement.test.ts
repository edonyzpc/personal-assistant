import { describe, expect, it } from "@jest/globals";

import { OperationsService } from "../src/ai-services/operations/operations-service";
import type {
    OperationsVault,
    OperationsVaultFile,
} from "../src/ai-services/operations/types";

const OPERATIONS_AUDIT_DIRECTORY = ".obsidian/plugins/personal-assistant/audit";

class RetirementVault implements OperationsVault {
    readonly noteFiles = new Map<string, string>([
        ["notes/review.md", "original"],
        ["notes/existing.md", "existing"],
        ["notes/frontmatter.md", "---\nstatus: old\n---\nBody"],
    ]);
    readonly historicalFiles = new Map<string, string>();
    readonly adapterCalls: Array<{ method: string; path: string }> = [];

    readonly folders = new Set<string>([
        "notes",
        ".obsidian",
        ".obsidian/plugins",
        ".obsidian/plugins/personal-assistant",
    ]);

    constructor(auditDirectoryPresent: boolean) {
        if (auditDirectoryPresent) this.folders.add(OPERATIONS_AUDIT_DIRECTORY);
    }

    readonly adapter = {
        exists: async (path: string): Promise<boolean> => {
            this.adapterCalls.push({ method: "exists", path });
            return this.noteFiles.has(path) || this.historicalFiles.has(path) || this.folders.has(path);
        },
        mkdir: async (path: string): Promise<void> => {
            this.adapterCalls.push({ method: "mkdir", path });
            this.folders.add(path);
        },
        write: async (path: string, content: string): Promise<void> => {
            this.adapterCalls.push({ method: "write", path });
            this.historicalFiles.set(path, content);
        },
        read: async (path: string): Promise<string> => {
            this.adapterCalls.push({ method: "read", path });
            const content = this.noteFiles.get(path) ?? this.historicalFiles.get(path);
            if (content === undefined) throw new Error("missing");
            return content;
        },
        list: async (path: string): Promise<{ files: string[]; folders: string[] }> => {
            this.adapterCalls.push({ method: "list", path });
            return {
                files: [...this.historicalFiles.keys()].filter((file) => file.startsWith(`${path}/`)),
                folders: [...this.folders].filter((folder) => folder.startsWith(`${path}/`)),
            };
        },
        remove: async (path: string): Promise<void> => {
            this.adapterCalls.push({ method: "remove", path });
            this.historicalFiles.delete(path);
        },
    };

    readonly cachedRead = async (file: OperationsVaultFile): Promise<string> => {
        const content = this.noteFiles.get(file.path);
        if (content === undefined) throw new Error("missing");
        return content;
    };

    readonly create = async (path: string, content: string): Promise<OperationsVaultFile> => {
        this.noteFiles.set(path, content);
        return { path };
    };

    readonly process = async (
        file: OperationsVaultFile,
        transform: (current: string) => string,
    ): Promise<string> => {
        const current = this.noteFiles.get(file.path);
        if (current === undefined) throw new Error("missing");
        const next = transform(current);
        this.noteFiles.set(file.path, next);
        return next;
    };

    getAbstractFileByPath(path: string): OperationsVaultFile | null {
        this.adapterCalls.push({ method: "getAbstractFileByPath", path });
        if (this.noteFiles.has(path)) return { path, extension: "md" };
        if (this.folders.has(path)) return { path, children: [] };
        return null;
    }
}

describe("Operations audit retirement", () => {
    it.each([true, false])(
        "leaves an %s audit directory untouched through stage, confirm, undo, and dispose",
        async auditDirectoryPresent => {
        const vault = new RetirementVault(auditDirectoryPresent);
        const historicalAuditPath = `${OPERATIONS_AUDIT_DIRECTORY}/historical.json`;
        const historicalUnknownPath = `${OPERATIONS_AUDIT_DIRECTORY}/user-managed.txt`;
        const historicalAuditContent = JSON.stringify({
            version: 1,
            operationId: "legacy-operation",
            completedAt: "2020-01-01T00:00:00.000Z",
            before: "legacy before",
            after: "legacy after",
        });
        if (auditDirectoryPresent) {
            vault.historicalFiles.set(historicalAuditPath, historicalAuditContent);
            vault.historicalFiles.set(historicalUnknownPath, "user manages this file");
        }

        const service = new OperationsService({
            vault,
            trashFile: async (file) => {
                vault.noteFiles.delete(file.path);
            },
            isOperationsAgentEnabled: () => true,
        });
        const session = service.createSession({ surface: "chat" });
        const intent = await session.stage({
            runId: "run-1",
            turnId: "turn-1",
            operations: [{
                toolCallId: "call-1",
                name: "vault_append",
                input: { path: "notes/review.md", content: "\nconfirmed" },
            }, {
                toolCallId: "call-create",
                name: "vault_create",
                input: { path: "notes/new.md", content: "created" },
            }, {
                toolCallId: "call-edit",
                name: "vault_process",
                input: {
                    path: "notes/existing.md",
                    operation: "replace",
                    params: { search: "existing", replace: "edited" },
                },
            }, {
                toolCallId: "call-frontmatter",
                name: "frontmatter_update",
                input: { path: "notes/frontmatter.md", set: { status: "done" } },
            }],
        });
        const execution = await session.confirm(intent.id);
        expect(execution.state).toBe("completed");
        expect(vault.noteFiles.get("notes/review.md")).toBe("original\nconfirmed");
        expect(vault.noteFiles.get("notes/new.md")).toBe("created");
        expect(vault.noteFiles.get("notes/existing.md")).toBe("edited");
        expect(vault.noteFiles.get("notes/frontmatter.md")).toContain('"done"');

        const receiptIds = execution.operations.flatMap(result => result.receiptId ? [result.receiptId] : []);
        expect(receiptIds).toHaveLength(execution.operations.length);
        const undoResults = await session.undoMany(receiptIds);
        expect(undoResults).toHaveLength(execution.operations.length);
        expect(undoResults.every(result => result.status === "undone")).toBe(true);
        expect(vault.noteFiles.get("notes/review.md")).toBe("original");
        expect(vault.noteFiles.has("notes/new.md")).toBe(false);
        expect(vault.noteFiles.get("notes/existing.md")).toBe("existing");
        expect(vault.noteFiles.get("notes/frontmatter.md")).toContain("status: old");

        session.dispose();
        service.dispose();

        const auditPathAccesses = vault.adapterCalls
            .filter(({ path }) => path === OPERATIONS_AUDIT_DIRECTORY || path.startsWith(`${OPERATIONS_AUDIT_DIRECTORY}/`))
            .map(({ method, path }) => `${method} ${path}`);
        expect(auditPathAccesses).toEqual([]);
        },
    );
});

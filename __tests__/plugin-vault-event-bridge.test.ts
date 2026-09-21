import { describe, expect, it, jest } from "@jest/globals";
import type { EventRef, TAbstractFile } from "obsidian";
import { TFile } from "obsidian";

import { VaultEventBridge } from "../src/plugin/vault-event-bridge";
import type { MemoryExtractionScheduler } from "../src/ai-services/memory-extraction/extraction-scheduler";
import type { MemoryManager } from "../src/memory-manager";
import type { VSSChangeObservation } from "../src/vss";
import type { VSS } from "../src/vss";

type FakeFile = TFile & { stat: { ctime: number; mtime: number; size: number } };

const createFile = (path: string, mtime = 1_000_000): FakeFile => {
    const FileCtor = TFile as unknown as { new(path: string): FakeFile };
    const file = new FileCtor(path);
    file.stat = { ctime: mtime, mtime, size: 10 };
    return file;
};

const createHarness = () => {
    const metadataHandlers = new Map<string, () => void>();
    const vaultHandlers = new Map<string, (file: TAbstractFile, oldPath?: string) => unknown>();
    const workspaceHandlers = new Map<string, (file?: FakeFile | null) => unknown>();
    const registeredRefs: EventRef[] = [];
    const order: string[] = [];
    const dependencies = {
        registerEvent: jest.fn((eventRef: EventRef) => {
            registeredRefs.push(eventRef);
        }),
        onMetadataEvent: jest.fn((event: "resolved" | "changed", callback: () => void) => {
            metadataHandlers.set(event, callback);
            return { event } as unknown as EventRef;
        }),
        onVaultEvent: jest.fn((event: "create" | "modify" | "rename" | "delete", callback: (file: TAbstractFile, oldPath?: string) => unknown) => {
            vaultHandlers.set(event, callback);
            return { event } as unknown as EventRef;
        }),
        onWorkspaceActiveLeafChange: jest.fn((callback: () => unknown) => {
            workspaceHandlers.set("active-leaf-change", callback);
            return { event: "active-leaf-change" } as unknown as EventRef;
        }),
        onWorkspaceFileOpen: jest.fn((callback: (file?: FakeFile | null) => unknown) => {
            workspaceHandlers.set("file-open", callback);
            return { event: "file-open" } as unknown as EventRef;
        }),
        invalidateVaultInsightsSource: jest.fn((file: TAbstractFile, oldPath?: string) => {
            order.push(`invalidate-insights:${file.path}${oldPath ? `:${oldPath}` : ""}`);
        }),
        invalidateMemoryGraphTopology: jest.fn(() => {
            order.push("invalidate-topology");
        }),
        getVss: jest.fn(() => vss as unknown as VSS),
        getMemoryManager: jest.fn(() => memoryManager as unknown as MemoryManager),
        getMemoryExtractionScheduler: jest.fn(() => scheduler as unknown as MemoryExtractionScheduler),
        isRecentPageletSelfWrite: jest.fn(() => false),
        scheduleMemoryStatus: jest.fn(() => {
            order.push("status");
        }),
    };
    const scheduler = {
        handleVaultEvent: jest.fn((file: TAbstractFile, reason: string) => {
            order.push(`scheduler:${reason}:${file.path}`);
        }),
    };
    const memoryManager = {
        scheduleAutoFlush: jest.fn((reason: string) => {
            order.push(`auto-flush:${reason}`);
        }),
        scheduleVerify: jest.fn((reason: string) => {
            order.push(`verify:${reason}`);
        }),
    };
    const vss = {
        observeChangedFile: jest.fn(async (
            _file: TAbstractFile,
            _reason: string,
            _verifyReason: string,
            _options: { verifyMatchingMetadata?: boolean },
        ): Promise<VSSChangeObservation> => ({ kind: "ignored" })),
        handleRename: jest.fn(async (_file: TFile, _oldPath: string): Promise<boolean> => true),
        handleDelete: jest.fn(async () => {
            order.push("vss-delete");
        }),
        handleActiveLeafChange: jest.fn(async () => {
            order.push("vss-active-leaf");
        }),
        handleFileOpen: jest.fn(async () => true),
        getMaintenanceState: jest.fn(() => ({ dirtyCount: 2, verificationPending: 1 })),
    };
    const bridge = new VaultEventBridge(dependencies);
    return { bridge, dependencies, metadataHandlers, vaultHandlers, workspaceHandlers, registeredRefs, order, scheduler, memoryManager, vss };
};

describe("VaultEventBridge", () => {
    it("registers metadata, vault, and workspace refs through root lifecycle ownership", () => {
        const { bridge, dependencies, metadataHandlers, vaultHandlers, workspaceHandlers, registeredRefs } = createHarness();

        bridge.registerEventDispatch();

        expect([...metadataHandlers.keys()]).toEqual(["resolved", "changed"]);
        expect([...vaultHandlers.keys()]).toEqual(["create", "modify", "rename", "delete"]);
        expect([...workspaceHandlers.keys()]).toEqual(["active-leaf-change", "file-open"]);
        expect(dependencies.registerEvent).toHaveBeenCalledTimes(8);
        expect(registeredRefs).toHaveLength(8);
        expect(new Set(registeredRefs).size).toBe(8);
    });

    it("invalidates topology synchronously for metadata resolved and changed", () => {
        const { bridge, metadataHandlers, dependencies } = createHarness();
        bridge.registerEventDispatch();

        metadataHandlers.get("resolved")?.();
        metadataHandlers.get("changed")?.();

        expect(dependencies.invalidateMemoryGraphTopology).toHaveBeenCalledTimes(2);
        expect(dependencies.invalidateVaultInsightsSource).not.toHaveBeenCalled();
    });

    it("reads a replaced VSS through the live getter after refs are registered", async () => {
        const { bridge, dependencies, vss } = createHarness();
        bridge.registerEventDispatch();
        const replacement = {
            observeChangedFile: jest.fn(async () => ({ kind: "ignored" as const })),
        };
        dependencies.getVss.mockReturnValueOnce(replacement as unknown as VSS);

        await bridge.handleMemoryVaultChange(createFile("notes/replaced.md"), "vault-modify");

        expect(replacement.observeChangedFile).toHaveBeenCalledTimes(1);
        expect(vss.observeChangedFile).not.toHaveBeenCalled();
    });

    it.each(["create", "modify"] as const)("keeps %s invalidation before scheduler and VSS observation", async (event) => {
        const { bridge, vaultHandlers, order, scheduler, vss } = createHarness();
        bridge.registerEventDispatch();
        const file = createFile("notes/current.md");

        await vaultHandlers.get(event)?.(file);

        expect(order).toEqual([
            `invalidate-insights:${file.path}`,
            "invalidate-topology",
            `scheduler:vault-${event}:${file.path}`,
        ]);
        expect(vss.observeChangedFile).toHaveBeenCalledWith(file, `vault-${event}`, "metadata-drift", {
            verifyMatchingMetadata: false,
        });
        expect(scheduler.handleVaultEvent).toHaveBeenCalledTimes(1);
    });

    it.each(["create", "modify"] as const)("invalidates a Pagelet self-write but suppresses downstream refresh", async (event) => {
        const { bridge, vaultHandlers, order, dependencies, scheduler, vss } = createHarness();
        bridge.registerEventDispatch();
        dependencies.isRecentPageletSelfWrite.mockReturnValue(true);
        const file = createFile("notes/self-write.md");

        await vaultHandlers.get(event)?.(file);

        expect(order).toEqual([
            `invalidate-insights:${file.path}`,
            "invalidate-topology",
        ]);
        expect(scheduler.handleVaultEvent).not.toHaveBeenCalled();
        expect(vss.observeChangedFile).not.toHaveBeenCalled();
    });

    it("separates startup replay modify from fresh-edit verify and both observation outcomes", async () => {
        const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_010_000);
        try {
            const replay = createHarness();
            replay.bridge.resetStartupEventGate();
            replay.bridge.registerEventDispatch();
            const old = createFile("notes/replay.md", 900_000);
            await replay.vaultHandlers.get("modify")?.(old);
            expect(replay.vss.observeChangedFile).toHaveBeenLastCalledWith(old, "vault-modify", "metadata-drift", {
                verifyMatchingMetadata: false,
            });

            const fresh = createHarness();
            fresh.bridge.resetStartupEventGate();
            fresh.bridge.registerEventDispatch();
            const current = createFile("notes/fresh.md", 1_010_000);
            await fresh.vaultHandlers.get("modify")?.(current);
            expect(fresh.vss.observeChangedFile).toHaveBeenLastCalledWith(current, "vault-modify", "metadata-drift", {
                verifyMatchingMetadata: true,
            });

            replay.vss.observeChangedFile.mockResolvedValueOnce({ kind: "confirmed-dirty", path: old.path, reason: "test" });
            await replay.bridge.handleMemoryVaultChange(old, "vault-modify");
            expect(replay.memoryManager.scheduleAutoFlush).toHaveBeenCalledWith("vault-modify");
            expect(replay.memoryManager.scheduleVerify).not.toHaveBeenCalled();

            fresh.vss.observeChangedFile.mockResolvedValueOnce({ kind: "verify-candidate", path: current.path, reason: "test" });
            await fresh.bridge.handleMemoryVaultChange(current, "vault-modify");
            expect(fresh.memoryManager.scheduleVerify).toHaveBeenCalledWith("vault-modify");
            expect(fresh.memoryManager.scheduleAutoFlush).not.toHaveBeenCalled();
        } finally {
            nowSpy.mockRestore();
        }
    });

    it("keeps rename invalidation, directory scheduling, and TFile VSS branches", async () => {
        const { bridge, vaultHandlers, order, dependencies, scheduler, vss, memoryManager } = createHarness();
        bridge.registerEventDispatch();
        const folder = { path: "notes" } as TAbstractFile;

        await vaultHandlers.get("rename")?.(folder, "old-notes");
        expect(order).toEqual([
            "invalidate-insights:notes:old-notes",
            "invalidate-topology",
            "scheduler:vault-rename:notes",
        ]);
        expect(vss.handleRename).not.toHaveBeenCalled();
        expect(memoryManager.scheduleAutoFlush).not.toHaveBeenCalled();

        order.length = 0;
        const file = createFile("notes/renamed.md");
        await vaultHandlers.get("rename")?.(file, "old.md");
        expect(order).toEqual([
            "invalidate-insights:notes/renamed.md:old.md",
            "invalidate-topology",
            "scheduler:vault-rename:notes/renamed.md",
            "auto-flush:vault-rename",
            "status",
        ]);
        expect(vss.handleRename).toHaveBeenCalledWith(file, "old.md");
        expect(scheduler.handleVaultEvent).toHaveBeenCalledWith(file, "vault-rename");

        order.length = 0;
        vss.handleRename.mockResolvedValueOnce(false);
        await vaultHandlers.get("rename")?.(file, "older.md");
        expect(order).not.toContain("auto-flush:vault-rename");
        expect(order).not.toContain("status");
        expect(dependencies.scheduleMemoryStatus).toHaveBeenCalledTimes(1);
    });

    it("keeps delete invalidation before only-TFile scheduler, VSS delete, and status", async () => {
        const { bridge, vaultHandlers, order, scheduler, vss } = createHarness();
        bridge.registerEventDispatch();
        const folder = { path: "folder" } as TAbstractFile;

        await vaultHandlers.get("delete")?.(folder);
        expect(order).toEqual([
            "invalidate-insights:folder",
            "invalidate-topology",
        ]);
        expect(scheduler.handleVaultEvent).not.toHaveBeenCalled();
        expect(vss.handleDelete).not.toHaveBeenCalled();

        order.length = 0;
        const file = createFile("notes/deleted.md");
        await vaultHandlers.get("delete")?.(file);
        expect(order).toEqual([
            `invalidate-insights:${file.path}`,
            "invalidate-topology",
            `scheduler:vault-delete:${file.path}`,
            "vss-delete",
            "status",
        ]);
    });

    it("propagates VSS errors without scheduling maintenance", async () => {
        const { bridge, vaultHandlers, vss, memoryManager } = createHarness();
        bridge.registerEventDispatch();
        vss.observeChangedFile.mockRejectedValueOnce(new Error("queue unavailable"));

        await expect(vaultHandlers.get("modify")?.(createFile("notes/error.md")))
            .rejects.toThrow("queue unavailable");
        expect(memoryManager.scheduleAutoFlush).not.toHaveBeenCalled();
        expect(memoryManager.scheduleVerify).not.toHaveBeenCalled();
    });

    it("awaists active-leaf flush and file-open maintenance state in order", async () => {
        const { bridge, workspaceHandlers, order } = createHarness();
        bridge.registerEventDispatch();

        await workspaceHandlers.get("active-leaf-change")?.();
        await workspaceHandlers.get("file-open")?.(createFile("notes/open.md"));

        expect(order).toEqual([
            "vss-active-leaf",
            "verify:file-open",
            "auto-flush:file-open",
            "status",
        ]);
    });
});

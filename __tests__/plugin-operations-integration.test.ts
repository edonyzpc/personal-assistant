import { describe, expect, it, jest } from "@jest/globals";

import {
    PageletOperationsPluginIntegration,
    type PageletOperationsIntegrationDependencies,
} from "../src/pagelet/plugin-operations-integration";
import type { OperationsSession } from "../src/ai-services/operations";

type FakeSession = OperationsSession & {
    confirm: jest.Mock;
    undoMany: jest.Mock;
    dispose: jest.Mock;
};

const createHarness = () => {
    const sessions: FakeSession[] = [];
    const createdOptions: Array<Parameters<PageletOperationsIntegrationDependencies["createSession"]>[0]> = [];
    const dependencies: PageletOperationsIntegrationDependencies = {
        vault: {
            read: jest.fn(async () => ""),
            getAbstractFileByPath: jest.fn(() => ({})),
        },
        isOperationsAgentEnabled: () => true,
        isPathAllowed: () => true,
        createSession: (options) => {
            createdOptions.push(options);
            const session: FakeSession = {
                stageIntent: jest.fn(),
                cancel: jest.fn(),
                confirm: jest.fn(async () => ({
                    status: "executed",
                    operations: [],
                })),
                undoMany: jest.fn(async () => []),
                dispose: jest.fn(),
                ...options,
            } as unknown as FakeSession;
            sessions.push(session);
            return session;
        },
        now: () => 1_000,
        log: jest.fn(),
    };
    return {
        owner: new PageletOperationsPluginIntegration(dependencies),
        sessions,
        createdOptions,
        dependencies,
    };
};

describe("PageletOperationsPluginIntegration", () => {
    it("creates one exact Pagelet session from the shared OperationsService", () => {
        const harness = createHarness();
        const first = harness.owner.getSession();
        const second = harness.owner.getSession();

        expect(first).toBe(second);
        expect(harness.sessions).toHaveLength(1);
    });

    it("uses exact captured sessions for confirm and Undo execution", async () => {
        const harness = createHarness();
        const session = harness.owner.getSession() as FakeSession;
        await harness.owner.confirmIntent("intent");
        await harness.owner.undoReceipts(["receipt"]);

        expect(session.confirm).toHaveBeenCalledWith("intent");
        expect(session.undoMany).toHaveBeenCalledWith(["receipt"]);
        expect(harness.sessions).toHaveLength(1);
    });

    it("retires an in-flight session and disposes it only after its last completion", async () => {
        const harness = createHarness();
        const session = harness.owner.getSession() as FakeSession;
        let releaseConfirm!: () => void;
        session.confirm.mockImplementation(async () => new Promise((resolve) => {
            releaseConfirm = () => resolve({ status: "executed", operations: [] });
        }));
        const pending = harness.owner.confirmIntent("intent");
        harness.owner.retireCurrentSession();

        expect(session.dispose).not.toHaveBeenCalled();
        releaseConfirm();
        await pending;
        expect(session.dispose).toHaveBeenCalledTimes(1);
    });

    it("restores only this attempt's failed self-write marks", async () => {
        const harness = createHarness();
        const session = harness.owner.getSession() as FakeSession;
        const options = harness.createdOptions[0]!;
        session.confirm.mockImplementation(async () => {
            options.markSelfWrite("notes/existing.md");
            options.markSelfWrite("notes/failed.md");
            return {
                status: "executed",
                operations: [
                    { status: "succeeded", path: "notes/existing.md" },
                    { status: "failed", path: "notes/failed.md" },
                ],
            };
        });

        harness.owner.markSelfWrite("notes/existing.md");
        await harness.owner.confirmIntent("intent");
        const selfWrites = (harness.owner as unknown as {
            selfWrites: Map<string, { count: number }>;
        }).selfWrites;
        expect(selfWrites.get("notes/existing.md")?.count).toBe(2);
        expect(selfWrites.has("notes/failed.md")).toBe(false);

        expect(harness.owner.consumeSelfWrite("notes/existing.md")).toBe(true);
        expect(harness.owner.consumeSelfWrite("notes/existing.md")).toBe(true);
        expect(harness.owner.consumeSelfWrite("notes/existing.md")).toBe(false);
        expect(harness.owner.consumeSelfWrite("notes/failed.md")).toBe(false);
    });

    it("clears Pagelet self-writes during feature disposal", () => {
        const harness = createHarness();
        harness.owner.markSelfWrite("notes/self-write.md");
        expect(harness.owner.consumeSelfWrite("notes/self-write.md")).toBe(true);
        harness.owner.markSelfWrite("notes/self-write.md");
        harness.owner.disposeFeature();

        expect(harness.owner.consumeSelfWrite("notes/self-write.md")).toBe(false);
    });
});

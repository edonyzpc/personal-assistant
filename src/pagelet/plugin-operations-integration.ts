import { normalizePath, TFile } from "obsidian";

import {
    OperationsIntent,
    OperationsSession,
    type OperationsExecutionResult,
    type UndoResult,
} from "../ai-services/operations";
import {
    paRelatedWikilinkIdentity,
    readPaRelatedLinksFromMarkdown,
} from "../pa/frontmatter-link";

export interface PageletOperationsIntegrationDependencies {
    vault: {
        read(file: TFile): Promise<string>;
        getAbstractFileByPath(path: string): unknown;
    };
    isOperationsAgentEnabled(): boolean;
    isPathAllowed(path: string): boolean;
    createSession(options: {
        surface: "pagelet";
        markSelfWrite(path: string): void;
    }): OperationsSession;
    now(): number;
    log(message: string, detail?: unknown): void;
}

function createAbortError(): Error {
    const error = new Error("Pagelet Operations action aborted");
    error.name = "AbortError";
    return error;
}

export class PageletOperationsPluginIntegration {
    private currentSession: OperationsSession | null = null;
    private readonly inFlight = new Map<OperationsSession, number>();
    private readonly retiringSessions = new Set<OperationsSession>();
    private readonly selfWrites = new Map<string, { count: number; expiresAt: number }>();

    constructor(private readonly dependencies: PageletOperationsIntegrationDependencies) {}

    getSession(): OperationsSession {
        if (this.currentSession) return this.currentSession;
        this.currentSession = this.dependencies.createSession({
            surface: "pagelet",
            markSelfWrite: (path) => this.markSelfWrite(path),
        });
        return this.currentSession;
    }

    retireCurrentSession(): void {
        const session = this.currentSession;
        this.currentSession = null;
        if (!session) return;
        if ((this.inFlight.get(session) ?? 0) > 0) {
            this.retiringSessions.add(session);
            return;
        }
        this.disposeSession(session);
    }

    disposeFeature(): void {
        this.retireCurrentSession();
        this.selfWrites.clear();
    }

    beginExecution(session: OperationsSession): void {
        this.inFlight.set(session, (this.inFlight.get(session) ?? 0) + 1);
    }

    finishExecution(session: OperationsSession): void {
        const remaining = (this.inFlight.get(session) ?? 1) - 1;
        if (remaining > 0) {
            this.inFlight.set(session, remaining);
            return;
        }
        this.inFlight.delete(session);
        if (!this.retiringSessions.delete(session)) return;
        this.disposeSession(session);
    }

    private disposeSession(session: OperationsSession): void {
        try {
            session.dispose();
        } catch (error) {
            this.dependencies.log("Failed to dispose Pagelet Operations session", error);
        }
    }

    async stageInsightLink(input: {
        candidateId: string;
        anchorPath: string;
        sourcePath: string;
    }, signal?: AbortSignal): Promise<OperationsIntent> {
        if (!this.dependencies.isOperationsAgentEnabled()) {
            throw new Error("Operations is not enabled. Nothing was written.");
        }
        const anchorPath = normalizePath(input.anchorPath);
        const sourcePath = normalizePath(input.sourcePath);
        if (
            !input.candidateId
            || anchorPath === sourcePath
            || !this.dependencies.isPathAllowed(anchorPath)
            || !this.dependencies.isPathAllowed(sourcePath)
        ) {
            throw new Error("This Pagelet action is no longer available.");
        }
        const anchorFile = this.dependencies.vault.getAbstractFileByPath(anchorPath);
        if (!(anchorFile instanceof TFile) || anchorFile.extension !== "md") {
            throw new Error("The target note is no longer available.");
        }

        const session = this.getSession();
        for (let attempt = 0; attempt < 2; attempt += 1) {
            if (signal?.aborted) throw createAbortError();
            const before = await this.dependencies.vault.read(anchorFile);
            if (signal?.aborted) throw createAbortError();
            const related = readPaRelatedLinksFromMarkdown(before);
            const link = `[[${sourcePath}]]`;
            const linkIdentity = paRelatedWikilinkIdentity(link);
            if (related.some((value) => (
                linkIdentity !== null && paRelatedWikilinkIdentity(value) === linkIdentity
            ))) {
                throw new Error("These notes are already linked.");
            }
            const intent = await session.stageIntent({
                runId: `pagelet:${input.candidateId}`,
                turnId: `pagelet-link:${input.candidateId}:${this.dependencies.now()}`,
                operations: [{
                    toolCallId: `pagelet-link:${input.candidateId}:${attempt}`,
                    name: "frontmatter_update",
                    input: {
                        path: anchorPath,
                        set: { "pa-related": [...related, link] },
                    },
                }],
            }, signal);
            if (intent.operations[0]?.expectedBefore === before) return intent;
            session.cancel(intent.id);
        }
        throw new Error("The target changed while preparing the preview. Try again.");
    }

    async confirmIntent(intentId: string): Promise<OperationsExecutionResult> {
        const selfWritesBefore = this.snapshotSelfWrites();
        const session = this.getSession();
        this.beginExecution(session);
        try {
            const result = await session.confirm(intentId);
            this.restoreFailedSelfWrites(
                selfWritesBefore,
                result.operations
                    .filter((operation) => operation.status !== "succeeded")
                    .map((operation) => operation.path),
            );
            return result;
        } catch (error) {
            this.restoreFailedSelfWrites(selfWritesBefore);
            throw error;
        } finally {
            this.finishExecution(session);
        }
    }

    cancelIntent(intentId: string): void {
        this.currentSession?.cancel(intentId);
    }

    async undoReceipts(receiptIds: readonly string[]): Promise<UndoResult[]> {
        const session = this.currentSession;
        if (!session) return [];
        const selfWritesBefore = this.snapshotSelfWrites();
        this.beginExecution(session);
        try {
            const results = await session.undoMany(receiptIds);
            this.restoreFailedSelfWrites(
                selfWritesBefore,
                results.flatMap((result) => (
                    result.status !== "undone" && result.path ? [result.path] : []
                )),
            );
            return results;
        } catch (error) {
            this.restoreFailedSelfWrites(selfWritesBefore);
            throw error;
        } finally {
            this.finishExecution(session);
        }
    }

    private snapshotSelfWrites(): Map<string, { count: number; expiresAt: number }> {
        const now = this.dependencies.now();
        for (const [path, entry] of this.selfWrites) {
            if (entry.expiresAt <= now) this.selfWrites.delete(path);
        }
        return new Map(this.selfWrites);
    }

    private restoreFailedSelfWrites(
        before: ReadonlyMap<string, { count: number; expiresAt: number }>,
        paths?: readonly string[],
    ): void {
        const normalizedPaths = paths
            ? new Set(paths.map((path) => normalizePath(path)))
            : new Set(this.selfWrites.keys());
        for (const path of normalizedPaths) {
            const current = this.selfWrites.get(path);
            const previous = before.get(path);
            if (!current || current.count <= (previous?.count ?? 0)) continue;
            if (!previous) this.selfWrites.delete(path);
            else this.selfWrites.set(path, previous);
        }
    }

    markSelfWrite(path: string): void {
        const normalized = normalizePath(path);
        const current = this.selfWrites.get(normalized);
        const now = this.dependencies.now();
        this.selfWrites.set(normalized, {
            count: current && current.expiresAt > now ? current.count + 1 : 1,
            expiresAt: now + 10_000,
        });
    }

    consumeSelfWrite(path: string): boolean {
        const normalized = normalizePath(path);
        const current = this.selfWrites.get(normalized);
        if (!current) return false;
        if (current.expiresAt <= this.dependencies.now()) {
            this.selfWrites.delete(normalized);
            return false;
        }
        if (current.count <= 1) this.selfWrites.delete(normalized);
        else this.selfWrites.set(normalized, { ...current, count: current.count - 1 });
        return true;
    }
}

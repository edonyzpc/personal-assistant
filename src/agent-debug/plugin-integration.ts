import type { Vault } from 'obsidian';
import type { PluginManagerSettings } from '../settings';
import type { ChatHistoryStore } from '../chat/chat-history-store';
import { createMemoryGovernanceOpaqueVaultKey, getMemoryGovernanceVaultDeviceScope } from '../memory/plugin-governance-storage';
import { AgentDebugService } from './service';
import type { AgentDebugViewHost } from './view';
import { setPlatformTimeout, clearPlatformTimeout, type PlatformTimeoutHandle } from '../platform-dom';

interface DebugForgetState {
    claims: Array<{ id: string; deviceWide: boolean }>;
    legacyRecordIds: string[];
}

export interface AgentDebugPluginOptions {
    vault: Vault;
    settings(): PluginManagerSettings;
    history(): ChatHistoryStore | undefined;
    readForgetState(): Promise<DebugForgetState>;
    recordSourceRevocation(): Promise<void>;
}

/** Owns only Debug adapters; no Agent work waits for its startup or cleanup. */
export class AgentDebugPluginIntegration {
    readonly service: AgentDebugService;
    private startup: Promise<void> | undefined;
    private queue: Promise<void> = Promise.resolve();
    private detachHistory: (() => void) | undefined;
    private sourceToken: string | undefined;
    private retryTimer: PlatformTimeoutHandle | undefined;
    private disposed = false;
    private fileRevocationPending = false;
    private permissionWritePending = false;
    private legacyWritesPending = 0;
    private admissionRevision = 0;
    private readonly deletingConversations = new Map<string, number>();
    private readonly seenClaims = new Set<string>();
    private readonly seenLegacy = new Set<string>();

    constructor(private readonly options: AgentDebugPluginOptions) {
        const scope = getMemoryGovernanceVaultDeviceScope(options.vault);
        const vaultKey = scope ? createMemoryGovernanceOpaqueVaultKey(options.settings().statisticsVaultId, scope) : '';
        this.service = new AgentDebugService({ vaultKey, enabled: () => options.settings().debug, recoveryReady: false });
    }

    initialize(): Promise<void> {
        if (!this.startup) this.startup = this.enqueue(async () => {
            await this.service.initialize();
            const history = this.options.history();
            if (history) {
                await history.initialize();
                this.detachHistory = history.onDebugDeletion?.((event) => {
                    this.service.blockConversation(event.conversationId);
                    const count = this.deletingConversations.get(event.conversationId) ?? 0;
                    this.deletingConversations.set(event.conversationId,
                        event.phase === 'start' ? count + 1 : Math.max(0, count - 1));
                    if (event.phase !== 'start') void this.enqueue(() => this.drainDeletions());
                });
            }
            await this.reconcile();
        });
        return this.startup;
    }

    private async drainDeletions(): Promise<void> {
        const history = this.options.history();
        if (!history?.listDebugDeletions || !history.acknowledgeDebugDeletion) return;
        for (const entry of await history.listDebugDeletions()) {
            await this.service.invalidateConversation(entry.conversationId, {
                operationId: entry.id, runIds: entry.deleteConversation ? undefined : entry.runIds,
                before: entry.deletedAt, permanent: entry.deleteConversation,
            });
            await history.acknowledgeDebugDeletion(entry.id);
        }
        for (const [id, count] of this.deletingConversations) {
            if (count !== 0) continue;
            this.deletingConversations.delete(id);
            this.service.unblockConversation(id);
        }
    }

    private async reconcile(): Promise<void> {
        if (this.disposed) return;
        const revision = this.admissionRevision;
        if (this.fileRevocationPending) {
            await this.options.recordSourceRevocation();
            this.fileRevocationPending = false;
        }
        const token = this.options.settings().dataBoundary.sourceRevocationEpoch ?? '';
        if (token !== this.sourceToken) {
            await this.service.applySourceToken(token);
            this.sourceToken = token;
        }
        await this.drainDeletions();
        const state = await this.options.readForgetState();
        for (const claim of state.claims) {
            if (this.seenClaims.has(claim.id)) continue;
            await this.service.forgetClaim(claim.id, { deviceWide: claim.deviceWide });
            this.seenClaims.add(claim.id);
        }
        for (const id of state.legacyRecordIds) {
            if (this.seenLegacy.has(id)) continue;
            await this.service.forgetLegacyRecord(id);
            this.seenLegacy.add(id);
        }
        // Store quarantine (unclean previous owner) is an independent gate.
        const pending = this.fileRevocationPending || this.permissionWritePending || this.legacyWritesPending > 0;
        if (!this.disposed && revision === this.admissionRevision && !pending) {
            this.service.setRecoveryReady(true);
        } else if (!this.disposed && !pending) {
            void this.enqueue(() => this.reconcile());
        }
    }

    settingsChanged(): void {
        if (this.disposed) return;
        this.service.setEnabled(this.options.settings().debug);
        const token = this.options.settings().dataBoundary.sourceRevocationEpoch ?? '';
        if (this.sourceToken !== token) {
            this.revokeAdmission();
            void this.enqueue(() => this.reconcile());
        }
    }

    revokeAdmission(): void { this.admissionRevision++; this.service.setRecoveryReady(false); }

    sourcePermissionRevoking(): void {
        this.permissionWritePending = true;
        this.revokeAdmission();
    }

    sourcePermissionCommitted(): void {
        this.permissionWritePending = false;
        void this.enqueue(() => this.reconcile());
    }

    sourcePermissionFailed(): void {
        this.permissionWritePending = false;
        // A failed write may have reached disk. Persist a fresh content-free epoch
        // before reopening, using the existing bounded retry path.
        this.sourceRevoked();
    }

    /** Keep older async recovery from reopening details during a primary Forget write. */
    beginLegacyForget(): () => void {
        this.legacyWritesPending++;
        this.revokeAdmission();
        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.legacyWritesPending--;
            void this.enqueue(() => this.reconcile());
        };
    }

    sourceRevoked(): void {
        this.revokeAdmission();
        if (this.fileRevocationPending) return;
        this.fileRevocationPending = true;
        void this.enqueue(() => this.reconcile());
    }

    /** Called from the durable Forget state machine, not an advisory listener. */
    async forgetClaim(claimId: string, deviceWide: boolean): Promise<void> {
        await this.service.initialize();
        await this.service.forgetClaim(claimId, { deviceWide });
        this.seenClaims.add(claimId);
    }

    async forgetLegacyRecord(recordId: string): Promise<void> {
        try {
            await this.service.initialize();
            await this.service.forgetLegacyRecord(recordId);
            this.seenLegacy.add(recordId);
            void this.enqueue(() => this.reconcile());
        } catch (error) {
            this.revokeAdmission();
            void this.enqueue(() => this.reconcile());
            throw error;
        }
    }

    viewHost(): AgentDebugViewHost {
        // Cross-window Chat deletion intent lives in the Chat DB. Check it before
        // displaying details even when its originating window died before cleanup.
        const read = async <T>(query: () => Promise<T>): Promise<T> => {
            await this.enqueue(() => this.drainDeletions());
            return query();
        };
        return {
            enabled: () => this.service.enabled(),
            listRuns: query => read(() => this.service.listRuns(query)),
            getEvents: (id, query) => read(() => this.service.getEvents(id, query)),
            getContents: (id, node) => read(() => this.service.getContents(id, node)),
            getSessionDetails: (id, node) => this.service.getSessionDetails(id, node),
            getStatus: () => read(() => this.service.getStatus()),
            subscribe: listener => this.service.subscribe(listener),
            clearHistory: async () => {
                await this.service.clearHistory();
                await this.reconcile();
                // Explicit clear removed the old quarantined content; fresh runs may record.
                await this.service.confirmRecovery();
            },
        };
    }

    private enqueue(work: () => Promise<void>): Promise<void> {
        const task = this.queue.then(async () => { if (!this.disposed) await work(); });
        this.queue = task.catch(() => {
            this.revokeAdmission();
            if (!this.disposed && this.retryTimer === undefined) {
                this.retryTimer = setPlatformTimeout(() => {
                    this.retryTimer = undefined;
                    void this.enqueue(() => this.reconcile());
                }, 30_000);
            }
        });
        // Failure is visible through recovery state, not console payloads or intrusive Notices.
        return this.queue;
    }

    beginUnload(): void {
        this.disposed = true;
        this.service.setEnabled(false);
        this.detachHistory?.();
        if (this.retryTimer !== undefined) clearPlatformTimeout(this.retryTimer);
    }

    async dispose(): Promise<void> {
        this.beginUnload();
        await this.service.dispose();
    }
}

import { describe, expect, it, jest } from '@jest/globals';

import { CapabilityRegistry } from '../src/ai-services/capability-registry';
import { createChatToolCapability } from '../src/ai-services/capability-adapter';
import { createSearchMemoryTool } from '../src/ai-services/chat-tool-factories';
import { MemorySearchTool } from '../src/ai-services/memory-search-tool';
import {
    createPaAgentCapabilityToolExecutor,
    MemoryEvidenceRegistry,
} from '../src/ai-services/pa-agent-host-tools';
import { ChatMemoryRecoveryCoordinator } from '../src/ai-services/retrieval-recovery-coordinator';
import type { TaskSourceReadGuard } from '../src/ai-services/task-source-read-guard';
import { MemoryManager, type MemoryMaintenancePlan } from '../src/memory-manager';
import type {
    VSSLexicalRebuildSummary,
    VSSMemoryStatusSnapshot,
    VSSPreparedRebuildHandle,
    VSSProgressEvent,
} from '../src/vss';
import type { NoteSearchScope } from '../src/vss/types';
import { installObsidianDocumentHelpers } from './helpers/obsidian-dom';

const settingGroups: Array<Array<{ click?: () => void }>> = [];
const notices: string[] = [];

function createDomElement(): any { // eslint-disable-line @typescript-eslint/no-explicit-any
    const element = {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        addClass: jest.fn(),
        empty: jest.fn(),
        createDiv: jest.fn(() => createDomElement()),
        createSpan: jest.fn(() => createDomElement()),
        createEl: jest.fn(() => createDomElement()),
        setCssStyles: jest.fn(),
        setAttribute: jest.fn(),
    };
    if (element.createEl.mock) element.createEl.mockImplementation(() => createDomElement());
    return element;
}

jest.mock('obsidian', () => ({
    Notice: class {
        messageEl = createDomElement();
        containerEl = createDomElement();
        constructor(message?: unknown) {
            notices.push(String(message));
            const body = createDomElement();
            this.messageEl.querySelector = jest.fn((selector: string) => (
                selector === '.pa-notice__body' ? body : null
            ));
        }
        hide() { /* The run-local display state tracks connection in this fixture. */ }
    },
    Platform: { isMobile: false },
    Modal: class {
        contentEl = createDomElement();
        open() { this.onOpen(); }
        close() { this.onClose(); }
        onOpen() { }
        onClose() { }
    },
    Setting: class {
        private readonly buttons: Array<{ click?: () => void }> = [];
        constructor() { settingGroups.push(this.buttons); }
        addButton(callback: (button: {
            setCta: () => unknown;
            setButtonText: () => unknown;
            onClick: (click: () => void) => unknown;
        }) => void) {
            const record: { click?: () => void } = {};
            this.buttons.push(record);
            const button = {
                setCta: () => button,
                setButtonText: () => button,
                onClick: (click: () => void) => {
                    record.click = click;
                    return button;
                },
            };
            callback(button);
            return this;
        }
    },
}));

interface CrossLayerFixture {
    manager: MemoryManager;
    tool: MemorySearchTool;
    guard: TaskSourceReadGuard;
    revokeSource: () => void;
    restoreSource: () => void;
    vss: {
        getMemoryReadiness: jest.Mock<() => Promise<MemoryMaintenancePlan>>;
        getMemoryStatusSnapshot: jest.Mock<() => VSSMemoryStatusSnapshot>;
        rebuildLocalIndex: jest.Mock<(options?: {
            abortSignal?: AbortSignal;
            onProgress?: (event: VSSProgressEvent) => void;
        }) => Promise<Record<string, unknown>>>;
        rebuildLexicalIndex: jest.Mock<(options?: {
            signal?: AbortSignal;
            onProgress?: (event: VSSProgressEvent) => void;
        }) => Promise<VSSLexicalRebuildSummary>>;
        resetLocalIndex: jest.Mock<() => Promise<void>>;
        searchHybrid: jest.Mock<() => Promise<never[]>>;
        admitPreparedRebuild: jest.Mock<(handle?: VSSPreparedRebuildHandle) => Promise<boolean>>;
    };
}

function createFixture(initialPlan: MemoryMaintenancePlan): CrossLayerFixture {
    settingGroups.length = 0;
    notices.length = 0;
    let currentPlan = initialPlan;
    let memoryStatus: VSSMemoryStatusSnapshot = {
        status: 'unknown',
        dirtyCount: 0,
        verificationPending: 0,
    };
    const operationSummary = {
        aborted: false,
        updated: 3,
        unchanged: 0,
        removed: 0,
        skipped: 0,
        failed: 0,
        metadataSynced: 0,
        verificationQueued: 0,
        verificationChecked: 0,
        dirtyConfirmed: 0,
        preparedRebuildHandle: 'prepared-cross-layer' as VSSPreparedRebuildHandle,
    };
    const vss = {
        getEmbeddingConfigurationIdentity: jest.fn(() => 'legacy-identity'),
        synchronizeEmbeddingConfiguration: jest.fn(async () => undefined),
        consumeFirstUseEligibility: jest.fn(async () => true),
        recordPreparationAttempt: jest.fn(async () => undefined),
        getMemoryReadiness: jest.fn(async () => currentPlan),
        getMemoryStatusSnapshot: jest.fn(() => memoryStatus),
        canAutoMaintain: jest.fn(async () => true),
        hasDirtyChanges: jest.fn(() => false),
        hasPendingVerification: jest.fn(() => false),
        verifyPendingChanges: jest.fn(async () => ({ ...operationSummary, markedDirty: 0, hasMore: false, bytesReadEstimate: 0 })),
        flush: jest.fn(async () => operationSummary),
        reconcileLocalFiles: jest.fn(async () => ({ ...operationSummary, scanned: 0, markedDirty: 0, verified: 0, hasMore: false })),
        refreshLocalIndex: jest.fn(async () => operationSummary),
        rebuildLocalIndex: jest.fn(async () => operationSummary),
        admitPreparedRebuild: jest.fn(async () => true),
        rollbackPreparedRebuild: jest.fn(async () => true),
        rebuildLexicalIndex: jest.fn(async () => ({
            aborted: false,
            rowsProcessed: 0,
            rowsTotal: 0,
            generation: 1,
        })),
        resetLocalIndex: jest.fn(async () => undefined),
        searchHybrid: jest.fn(async () => []),
    };
    const memoryHost = {
        app: {},
        pluginId: 'personal-assistant',
        settings: {
            memoryEnabled: true,
            memoryApprovalPolicy: 'always',
            vssCacheExcludePath: [],
            debug: false,
            aiProvider: 'openai',
            chatModelName: '',
            policyModelName: '',
            embeddingModelName: 'test-embedding',
            baseURL: 'https://example.test',
            statisticsVaultId: 'test-vault',
        },
        vss,
        saveSettings: jest.fn(async () => undefined),
        persistMemoryAdmissionSettings: jest.fn(async () => undefined),
        notifyStatusChanged: jest.fn(),
        log: jest.fn(),
        registerEvent: jest.fn(),
        getVSSFiles: jest.fn(() => []),
        getAPIToken: jest.fn(async () => 'test-token'),
        updateMemorySetting: jest.fn(),
    };
    const manager = new MemoryManager(memoryHost as never, vss as never);
    let sourceCurrent = true;
    const guard: TaskSourceReadGuard = {
        isCurrent: () => sourceCurrent,
        isMemoryAllowed: () => true,
        isPathAllowed: () => true,
        getNoteSearchScope: (): NoteSearchScope => ({ allowedPaths: null, excludedPaths: [] }),
    };
    const aiHost = {
        app: {
            vault: {
                getMarkdownFiles: () => [{ path: 'notes/launch.md' }],
            },
        },
        settings: memoryHost.settings,
        memorySearch: {
            ensureReadyForChat: manager.ensureReadyForChat.bind(manager),
            searchHybrid: vss.searchHybrid,
        },
        getMemoryEvidenceEpoch: () => 'cross-layer-evidence-epoch',
        isDataBoundaryAllowedPath: () => true,
        readLatestMemorySource: async (path: string) => ({
            path,
            markdown: '# Launch\n\nCurrent evidence.',
            mtime: 1,
            size: 24,
        }),
    };
    const tool = new MemorySearchTool(aiHost as never, {
        cleanMarkdownContent: (text: string) => text,
        hashContent: async (text: string) => `hash:${text}`,
    } as never, 'chat', guard);
    return {
        manager,
        tool,
        guard,
        revokeSource: () => { sourceCurrent = false; },
        restoreSource: () => { sourceCurrent = true; },
        vss: {
            getMemoryReadiness: vss.getMemoryReadiness,
            getMemoryStatusSnapshot: vss.getMemoryStatusSnapshot,
            rebuildLocalIndex: vss.rebuildLocalIndex,
            rebuildLexicalIndex: vss.rebuildLexicalIndex,
            resetLocalIndex: vss.resetLocalIndex,
            searchHybrid: vss.searchHybrid,
            admitPreparedRebuild: vss.admitPreparedRebuild,
        },
    };
}

function createExecutor(
    fixture: CrossLayerFixture,
    coordinator: ChatMemoryRecoveryCoordinator,
    ownerSignal?: AbortSignal,
) {
    const registry = new CapabilityRegistry();
    registry.register(createChatToolCapability(createSearchMemoryTool((input, context) => (
        fixture.tool.search(input.query, context.signal, undefined, fixture.guard)
    )), { providerId: 'cross-layer-test' }));
    return createPaAgentCapabilityToolExecutor({
        registry,
        host: {
            log: jest.fn(),
        } as never,
        memoryRecoveryCoordinator: coordinator,
        memorySearchTool: fixture.tool,
        backgroundMemoryPreparation: true,
        ...(ownerSignal ? { memoryPreparationOwnerSignal: ownerSignal } : {}),
        revalidateMemorySearch: async result => result,
        memoryEvidenceRegistry: new MemoryEvidenceRegistry(async result => result),
    });
}

function executionInput(signal: AbortSignal, guard: TaskSourceReadGuard) {
    return {
        runId: 'cross-layer-run',
        turnId: 'cross-layer-turn',
        turnIndex: 0,
        userInput: 'What do my launch notes say?',
        toolCall: {
            type: 'toolCall' as const,
            id: 'cross-layer-call',
            index: 0,
            name: 'search_memory',
            input: { query: 'launch' },
        },
        signal,
        taskSourceReadGuard: guard,
    };
}

const waitFor = async (condition: () => boolean): Promise<void> => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        if (condition()) return;
        await Promise.resolve();
    }
    throw new Error('Cross-layer condition was not reached');
};

describe('B-197 Memory preparation cross-layer lifecycle', () => {
    it('keeps approved background preparation independent of the retrieval deadline and admits it once', async () => {
        jest.useFakeTimers();
        const restoreDocument = installMockDocument();
        const fixture = createFixture({
            reason: 'settings-changed',
            action: 'rebuild',
            notesToCheck: 3,
            requiresApproval: true,
            canAnswerNow: true,
        });
        let preparationSignal: AbortSignal | undefined;
        let releaseRebuild: ((summary: Record<string, unknown>) => void) | undefined;
        fixture.vss.rebuildLocalIndex.mockImplementation(async (options?: {
            abortSignal?: AbortSignal;
            onProgress?: (event: VSSProgressEvent) => void;
        }) => new Promise(resolve => {
            preparationSignal = options?.abortSignal;
            releaseRebuild = resolve;
            options?.onProgress?.({ phase: 'writing', filesDone: 2, filesTotal: 3 });
        }));
        const owner = new AbortController();
        const attempt = new AbortController();
        const startedAt = Date.now();
        const coordinator = new ChatMemoryRecoveryCoordinator({
            runId: 'cross-layer-run',
            runEpoch: 'cross-layer-epoch',
            hardAt: startedAt + 30_000,
            softAt: startedAt + 29_500,
            toolAt: startedAt + 29_250,
            enabled: true,
            now: Date.now,
        });
        const executor = createExecutor(fixture, coordinator, owner.signal);

        try {
            const execution = executor.execute(executionInput(attempt.signal, fixture.guard));
            await waitFor(() => settingGroups.length > 0);
            await jest.advanceTimersByTimeAsync(31_000);
            expect(fixture.vss.rebuildLocalIndex).not.toHaveBeenCalled();
            expect(settingGroups[0][0]?.click).toBeDefined();
            settingGroups[0][0].click?.();

            const result = await execution;
            expect(result.outcome).toBe('success');
            expect(result.promptText).toContain(
                'Memory is being prepared in the background. Memory retrieval is currently unavailable; '
                + 'empty results do not establish that no matching notes exist. Do not infer note content.',
            );
            await waitFor(() => Boolean(preparationSignal));
            const preparationProbeOwner = new AbortController();
            const preparationDecision = await fixture.manager.ensureReadyForChat(
                'launch',
                new AbortController().signal,
                preparationProbeOwner.signal,
                { backgroundPreparation: true },
            );
            preparationProbeOwner.abort();
            expect(preparationDecision).toEqual({
                decision: 'answer-now',
                message: 'Memory is being prepared in the background. It will be used automatically once ready.',
                preparationState: 'running',
            });

            coordinator.close();
            attempt.abort();
            await jest.advanceTimersByTimeAsync(31_000);
            expect(preparationSignal?.aborted).toBe(false);

            releaseRebuild?.({
                aborted: false,
                updated: 3,
                failed: 0,
                preparedRebuildHandle: 'prepared-cross-layer',
            });
            await fixture.manager.waitForIdle();
            expect(fixture.vss.admitPreparedRebuild).toHaveBeenCalledTimes(1);
            expect(fixture.manager.getStatusSnapshot().lastPreparation).toMatchObject({
                outcome: 'completed',
                filesDone: 2,
                filesTotal: 3,
            });
            expect(notices.filter(message => message === 'Memory is ready. Your notes were not changed.')).toHaveLength(1);

            fixture.vss.getMemoryReadiness.mockImplementation(async () => ({
                reason: 'ready',
                action: 'none',
                notesToCheck: 0,
                requiresApproval: false,
                canAnswerNow: true,
            }));
            fixture.vss.getMemoryStatusSnapshot.mockReturnValue({
                status: 'ready',
                dirtyCount: 0,
                verificationPending: 0,
            });
            const retrievalCoordinator = new ChatMemoryRecoveryCoordinator({
                runId: 'cross-layer-retrieval',
                runEpoch: 'cross-layer-retrieval-epoch',
                hardAt: Date.now() + 30_000,
                softAt: Date.now() + 29_500,
                toolAt: Date.now() + 29_250,
                enabled: true,
                now: Date.now,
            });
            const retrieval = await createExecutor(
                fixture,
                retrievalCoordinator,
                new AbortController().signal,
            ).execute(executionInput(new AbortController().signal, fixture.guard));
            retrievalCoordinator.close();
            expect(retrieval.outcome).toBe('success');
            expect(retrieval.promptText).toContain('"query": "launch"');
            expect(retrieval.recovery).toBeUndefined();
            expect(retrieval.metadata?.failureReason).toBeUndefined();
            expect(retrieval.metadata?.ok).toBe(true);
            expect(fixture.vss.searchHybrid).toHaveBeenCalledTimes(1);
            expect(owner.signal.aborted).toBe(false);
            expect(fixture.vss.rebuildLocalIndex).toHaveBeenCalledTimes(1);
        } finally {
            coordinator.close();
            owner.abort();
            attempt.abort();
            releaseRebuild?.({ aborted: true, updated: 0, failed: 0, preparedRebuildHandle: undefined });
            await fixture.manager.waitForIdle().catch(() => undefined);
            jest.useRealTimers();
            restoreDocument();
        }
    });

    it('uses admitted old Memory for reads while lexical preparation remains pending', async () => {
        const restoreDocument = installMockDocument();
        const fixture = createFixture({
            reason: 'lexical-profile-stale',
            action: 'rebuild-lexical',
            notesToCheck: 2,
            requiresApproval: true,
            canAnswerNow: true,
        });
        fixture.vss.getMemoryStatusSnapshot.mockReturnValue({
            status: 'ready',
            dirtyCount: 0,
            verificationPending: 0,
        });
        let preparationSignal: AbortSignal | undefined;
        let releaseRebuild: ((summary: VSSLexicalRebuildSummary) => void) | undefined;
        fixture.vss.rebuildLexicalIndex.mockImplementation((options?: {
            signal?: AbortSignal;
            onProgress?: (event: VSSProgressEvent) => void;
        }) => new Promise(resolve => {
            preparationSignal = options?.signal;
            releaseRebuild = resolve;
            options?.onProgress?.({ phase: 'lexical-rebuilding', lexicalRowsDone: 1, lexicalRowsTotal: 2 });
        }));
        const owner = new AbortController();
        const firstCoordinator = new ChatMemoryRecoveryCoordinator({
            runId: 'cross-layer-lexical-first',
            runEpoch: 'cross-layer-lexical-first-epoch',
            hardAt: Number.MAX_SAFE_INTEGER,
            softAt: Number.MAX_SAFE_INTEGER,
            toolAt: Number.MAX_SAFE_INTEGER,
            enabled: true,
            now: Date.now,
        });
        const firstExecutor = createExecutor(fixture, firstCoordinator, owner.signal);

        try {
            const firstExecution = firstExecutor.execute(
                executionInput(new AbortController().signal, fixture.guard),
            );
            await waitFor(() => settingGroups.length > 0);
            settingGroups[0][0].click?.();

            const firstResult = await firstExecution;
            await waitFor(() => Boolean(preparationSignal));
            settingGroups.length = 0;
            expect(firstResult.outcome).toBe('success');
            expect(firstResult.promptText).toContain('"query": "launch"');
            expect(firstResult.metadata?.ok).toBe(true);
            expect(firstResult.metadata?.failureReason).toBeUndefined();
            expect(fixture.manager.getStatusSnapshot().status).toBe('preparing');
            expect(fixture.vss.searchHybrid).toHaveBeenCalledTimes(1);

            const secondCoordinator = new ChatMemoryRecoveryCoordinator({
                runId: 'cross-layer-lexical-second',
                runEpoch: 'cross-layer-lexical-second-epoch',
                hardAt: Number.MAX_SAFE_INTEGER,
                softAt: Number.MAX_SAFE_INTEGER,
                toolAt: Number.MAX_SAFE_INTEGER,
                enabled: true,
                now: Date.now,
            });
            const secondResult = await createExecutor(
                fixture,
                secondCoordinator,
                new AbortController().signal,
            ).execute(executionInput(new AbortController().signal, fixture.guard));
            secondCoordinator.close();

            expect(secondResult.outcome).toBe('success');
            expect(secondResult.promptText).toContain('"query": "launch"');
            expect(secondResult.metadata?.ok).toBe(true);
            expect(secondResult.metadata?.failureReason).toBeUndefined();
            expect(fixture.vss.searchHybrid).toHaveBeenCalledTimes(2);
            expect(fixture.vss.rebuildLexicalIndex).toHaveBeenCalledTimes(1);
            expect(fixture.vss.rebuildLocalIndex).not.toHaveBeenCalled();
            expect(settingGroups).toHaveLength(0);
            expect(preparationSignal?.aborted).toBe(false);

            releaseRebuild?.({
                aborted: false,
                rowsProcessed: 2,
                rowsTotal: 2,
                generation: 2,
            });
            await fixture.manager.waitForIdle();
        } finally {
            firstCoordinator.close();
            owner.abort();
            releaseRebuild?.({ aborted: true, rowsProcessed: 0, rowsTotal: 2, reason: 'aborted' });
            await fixture.manager.waitForIdle().catch(() => undefined);
            restoreDocument();
        }
    });

    it('uses the original synchronous path and PaAgent projection when Chat has no preparation owner', async () => {
        const restoreDocument = installMockDocument();
        const fixture = createFixture({
            reason: 'ready',
            action: 'none',
            notesToCheck: 0,
            requiresApproval: false,
            canAnswerNow: true,
        });
        fixture.vss.getMemoryStatusSnapshot.mockReturnValue({
            status: 'ready',
            dirtyCount: 0,
            verificationPending: 0,
        });
        const coordinator = new ChatMemoryRecoveryCoordinator({
            runId: 'cross-layer-no-owner',
            runEpoch: 'cross-layer-no-owner-epoch',
            hardAt: Number.MAX_SAFE_INTEGER,
            softAt: Number.MAX_SAFE_INTEGER,
            toolAt: Number.MAX_SAFE_INTEGER,
            enabled: true,
            now: Date.now,
        });
        const executor = createExecutor(fixture, coordinator);

        try {
            const result = await executor.execute(executionInput(new AbortController().signal, fixture.guard));

            expect(result.outcome).toBe('success');
            expect(result.recovery).toBeUndefined();
            expect(result.metadata?.failureReason).toBeUndefined();
            expect(result.metadata?.ok).toBe(true);
            expect(result.promptText).toContain('"query": "launch"');
            expect(fixture.vss.searchHybrid).toHaveBeenCalledTimes(1);
            expect(fixture.vss.rebuildLocalIndex).not.toHaveBeenCalled();
            expect(fixture.vss.rebuildLexicalIndex).not.toHaveBeenCalled();
            expect(settingGroups).toHaveLength(0);
        } finally {
            coordinator.close();
            restoreDocument();
        }
    });

    it('rejects late source admission and explicit cancellation without retrieval or reset effects', async () => {
        const restoreDocument = installMockDocument();
        const fixture = createFixture({
            reason: 'lexical-profile-stale',
            action: 'rebuild-lexical',
            notesToCheck: 2,
            requiresApproval: true,
            canAnswerNow: true,
        });
        const owner = new AbortController();
        const coordinator = new ChatMemoryRecoveryCoordinator({
            runId: 'cross-layer-cancel',
            runEpoch: 'cross-layer-cancel-epoch',
            hardAt: Number.MAX_SAFE_INTEGER,
            softAt: Number.MAX_SAFE_INTEGER,
            toolAt: Number.MAX_SAFE_INTEGER,
            enabled: true,
            now: Date.now,
        });
        const executor = createExecutor(fixture, coordinator, owner.signal);

        try {
            const revoked = executor.execute(executionInput(new AbortController().signal, fixture.guard));
            await waitFor(() => settingGroups.length > 0);
            fixture.revokeSource();
            settingGroups[0][0].click?.();
            await expect(revoked).rejects.toThrow();
            expect(fixture.vss.rebuildLocalIndex).not.toHaveBeenCalled();
            expect(fixture.vss.rebuildLexicalIndex).not.toHaveBeenCalled();
            expect(fixture.vss.resetLocalIndex).not.toHaveBeenCalled();
            expect(fixture.vss.searchHybrid).not.toHaveBeenCalled();
            expect(fixture.vss.admitPreparedRebuild).not.toHaveBeenCalled();

            settingGroups.length = 0;
            fixture.restoreSource();
            fixture.vss.getMemoryStatusSnapshot.mockReturnValue({
                status: 'ready',
                dirtyCount: 0,
                verificationPending: 0,
            });
            const cancelled = executor.execute(executionInput(new AbortController().signal, fixture.guard));
            await waitFor(() => settingGroups.length > 0);
            settingGroups[1][0].click?.();
            await expect(cancelled).rejects.toThrow();
            expect(fixture.vss.searchHybrid).not.toHaveBeenCalled();
            expect(fixture.vss.rebuildLocalIndex).not.toHaveBeenCalled();
        } finally {
            coordinator.close();
            owner.abort();
            await fixture.manager.waitForIdle().catch(() => undefined);
            restoreDocument();
        }
    });
});

function installMockDocument() {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: installObsidianDocumentHelpers({
            createDocumentFragment: jest.fn(() => createDomElement()),
        }),
    });
    return () => {
        if (original) Object.defineProperty(globalThis, 'document', original);
        else delete (globalThis as { document?: Document }).document;
    };
}

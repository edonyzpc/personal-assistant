import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
    MEMORY_APPROVAL_SECTIONS,
    MEMORY_USER_FORBIDDEN_TERMS,
    MemoryManager,
    MemoryApprovalModal,
    getMemoryApprovalCopy,
    type MemoryMaintenancePlan,
} from '../src/memory-manager';

const mockNoticeMessages: string[] = [];
const mockProgressSteps: string[] = [];
const mockSettingGroups: Array<Array<{ text?: string; click?: () => void; cta?: boolean }>> = [];

const mockCreateDomElement = (): any => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const element = {
        children: [] as any[], // eslint-disable-line @typescript-eslint/no-explicit-any
        textContent: '',
        addClass: jest.fn(),
        empty: jest.fn(() => {
            element.children.length = 0;
            element.textContent = '';
        }),
        createEl: jest.fn((_tag: string, options?: { text?: string }) => {
            const child = mockCreateDomElement();
            if (options?.text) child.textContent = options.text;
            element.children.push(child);
            return child;
        }),
        createDiv: jest.fn((options?: { text?: string }) => {
            const child = mockCreateDomElement();
            if (options?.text) child.textContent = options.text;
            element.children.push(child);
            return child;
        }),
        createSpan: jest.fn((options?: { text?: string }) => {
            const child = mockCreateDomElement();
            if (options?.text) child.textContent = options.text;
            element.children.push(child);
            return child;
        }),
    };
    return element;
};

jest.mock('obsidian', () => ({
    Notice: class {
        constructor(message?: unknown) {
            mockNoticeMessages.push(String(message));
        }
        hide() { }
        progressBody = {
            empty: jest.fn(),
            createEl: jest.fn((_tag: string, options?: { text?: string }) => {
                if (options?.text) mockProgressSteps.push(options.text);
                return {};
            }),
        };
        noticeEl = {
            addClass: jest.fn(),
            parentElement: { addClass: jest.fn() },
            setCssStyles: jest.fn(),
            querySelector: jest.fn((selector: string) => selector === '.pa-notice__body' ? this.progressBody : null),
        };
    },
    Platform: { isMobile: false },
    Modal: class {
        contentEl = mockCreateDomElement();
        constructor(_app: unknown) { }
        open() { this.onOpen(); }
        close() { this.onClose(); }
        onOpen() { }
        onClose() { }
    },
    Setting: class {
        private readonly buttons: Array<{ text?: string; click?: () => void; cta?: boolean }> = [];
        constructor(_containerEl: unknown) {
            mockSettingGroups.push(this.buttons);
        }
        addButton(callback: (button: {
            setCta: () => unknown;
            setButtonText: (text: string) => unknown;
            onClick: (callback: () => void) => unknown;
        }) => void) {
            const record: { text?: string; click?: () => void; cta?: boolean } = {};
            this.buttons.push(record);
            const button = {
                setCta: () => {
                    record.cta = true;
                    return button;
                },
                setButtonText: (text: string) => {
                    record.text = text;
                    return button;
                },
                onClick: (onClick: () => void) => {
                    record.click = onClick;
                    return button;
                },
            };
            callback(button);
            return this;
        }
    },
}));

const createPlan = (overrides: Partial<MemoryMaintenancePlan> = {}): MemoryMaintenancePlan => ({
    reason: 'ready',
    action: 'none',
    notesToCheck: 3,
    requiresApproval: false,
    canAnswerNow: true,
    ...overrides,
});

const createOperationSummary = (overrides: Record<string, unknown> = {}) => ({
    aborted: false,
    updated: 0,
    unchanged: 0,
    removed: 0,
    skipped: 0,
    failed: 0,
    metadataSynced: 0,
    verificationQueued: 0,
    verificationChecked: 0,
    dirtyConfirmed: 0,
    ...overrides,
});

const createPlugin = (plan: MemoryMaintenancePlan, settings: Record<string, unknown> = {}) => {
    const plugin = {
        app: {},
        pluginId: 'personal-assistant',
        settings: {
            memoryEnabled: true,
            memoryAutoCheckBeforeChat: true,
            memoryApprovalPolicy: 'always',
            vssCacheExcludePath: [],
            debug: false,
            aiProvider: 'openai',
            chatModelName: 'gpt-4o-mini',
            embeddingModelName: 'text-embedding-3-small',
            baseURL: 'https://api.openai.com/v1',
            statisticsVaultId: 'test-vault',
            ...settings,
        },
        vss: {
            getMemoryReadiness: jest.fn(async () => plan),
            canAutoMaintain: jest.fn(async () => true),
            hasDirtyChanges: jest.fn(() => false),
            hasPendingVerification: jest.fn(() => false),
            verifyPendingChanges: jest.fn(async (_options?: unknown) => ({
                ...createOperationSummary(),
                markedDirty: 0,
                hasMore: false,
                bytesReadEstimate: 0,
            })),
            flush: jest.fn(async (_options?: unknown) => createOperationSummary()),
            reconcileLocalFiles: jest.fn(async (_options?: unknown) => ({
                ...createOperationSummary(),
                scanned: 0,
                markedDirty: 0,
                verified: 0,
                hasMore: false,
            })),
            refreshLocalIndex: jest.fn(async (_options?: { silent?: boolean }) => createOperationSummary()),
            rebuildLocalIndex: jest.fn(async (_options?: { silent?: boolean }) => createOperationSummary()),
        },
        saveSettings: jest.fn(async () => undefined),
        notifyStatusChanged: jest.fn(),
        log: jest.fn(),
        registerEvent: jest.fn(),
        getVSSFiles: jest.fn(() => []),
        getAPIToken: jest.fn(async () => 'test-token'),
        updateMemorySetting: jest.fn((key: string, value: unknown) => {
            (plugin.settings as Record<string, unknown>)[key] = value;
        }),
    };
    return plugin;
};

const createManager = (plugin: ReturnType<typeof createPlugin>) => new MemoryManager(
    plugin as unknown as ConstructorParameters<typeof MemoryManager>[0],
    plugin.vss as unknown as ConstructorParameters<typeof MemoryManager>[1],
);

beforeEach(() => {
    mockSettingGroups.length = 0;
});

const createMockDomElement = mockCreateDomElement;

describe('MemoryManager chat decisions', () => {
    beforeEach(() => {
        mockNoticeMessages.length = 0;
        mockProgressSteps.length = 0;
    });

    it('uses memory immediately when memory is ready', async () => {
        const plugin = createPlugin(createPlan());
        const manager = createManager(plugin);

        const decision = await manager.ensureReadyForChat('question');

        expect(decision).toEqual({ decision: 'use-memory' });
        expect(plugin.vss.getMemoryReadiness).toHaveBeenCalledTimes(1);
        expect(mockNoticeMessages).toEqual([]);
    });

    it('runs a small desktop verification pass before chat when readiness is otherwise ready', async () => {
        const plugin = createPlugin(createPlan({ verificationPending: 1 }));
        plugin.vss.verifyPendingChanges.mockResolvedValue({
            ...createOperationSummary({
                metadataSynced: 1,
                verificationChecked: 1,
            }),
            markedDirty: 0,
            hasMore: false,
            bytesReadEstimate: 128,
        });
        const manager = createManager(plugin);

        const decision = await manager.ensureReadyForChat('question');

        expect(decision).toEqual({ decision: 'use-memory' });
        expect(plugin.vss.verifyPendingChanges).toHaveBeenCalledWith(expect.objectContaining({
            reason: 'chat',
            fastPath: true,
        }));
        expect(plugin.vss.flush).not.toHaveBeenCalled();
        expect(plugin.notifyStatusChanged).toHaveBeenCalled();
    });

    it('runs a bounded verification pass before chat on mobile too', async () => {
        const obsidianMock = jest.requireMock('obsidian') as { Platform: { isMobile: boolean } };
        obsidianMock.Platform.isMobile = true;
        try {
            const plugin = createPlugin(createPlan({ verificationPending: 1 }));
            const manager = createManager(plugin);

            const decision = await manager.ensureReadyForChat('question');

            expect(decision).toEqual({ decision: 'use-memory' });
            expect(plugin.vss.verifyPendingChanges).toHaveBeenCalledWith(expect.objectContaining({
                reason: 'chat',
                fastPath: true,
            }));
        } finally {
            obsidianMock.Platform.isMobile = false;
        }
    });

    it('rechecks readiness after chat verification confirms dirty work', async () => {
        const readyPlan = createPlan({ verificationPending: 1 });
        const changedPlan = createPlan({
            reason: 'changed-notes',
            action: 'refresh',
            notesLikelyToUpdate: 1,
            requiresApproval: true,
        });
        const plugin = createPlugin(readyPlan);
        plugin.vss.getMemoryReadiness
            .mockResolvedValueOnce(readyPlan)
            .mockResolvedValueOnce(changedPlan);
        plugin.vss.verifyPendingChanges.mockResolvedValue({
            ...createOperationSummary({
                dirtyConfirmed: 1,
                verificationChecked: 1,
            }),
            markedDirty: 1,
            hasMore: false,
            bytesReadEstimate: 128,
        });
        const manager = createManager(plugin);
        (manager as any).requestApproval = jest.fn(async () => 'answer-now'); // eslint-disable-line @typescript-eslint/no-explicit-any

        const decision = await manager.ensureReadyForChat('question');

        expect((manager as any).requestApproval).toHaveBeenCalledWith(expect.objectContaining({ // eslint-disable-line @typescript-eslint/no-explicit-any
            reason: 'changed-notes',
            action: 'refresh',
        }));
        expect(decision).toEqual({
            decision: 'answer-now',
            message: 'Memory was not used for this answer.',
        });
    });

    it('answers normally when memory is disabled', async () => {
        const plugin = createPlugin(createPlan(), { memoryEnabled: false });
        const manager = createManager(plugin);

        const decision = await manager.ensureReadyForChat('question');

        expect(decision).toEqual({ decision: 'answer-now' });
        expect(plugin.vss.getMemoryReadiness).not.toHaveBeenCalled();
    });

    it('answers normally when memory is unavailable', async () => {
        const plugin = createPlugin(createPlan({
            reason: 'unavailable',
            action: 'none',
            requiresApproval: false,
        }));
        const manager = createManager(plugin);

        const decision = await manager.ensureReadyForChat('question');

        expect(decision).toEqual({
            decision: 'answer-now',
            message: 'I could not prepare memory this time, so I answered normally.',
        });
        expect(mockNoticeMessages).toEqual([
            'Memory is unavailable. I will answer normally for now.',
        ]);
    });

    it('does not check readiness when pre-chat memory checks are disabled', async () => {
        const plugin = createPlugin(createPlan(), { memoryAutoCheckBeforeChat: false });
        const manager = createManager(plugin);

        const decision = await manager.ensureReadyForChat('question');

        expect(decision).toEqual({ decision: 'use-memory' });
        expect(plugin.vss.getMemoryReadiness).not.toHaveBeenCalled();
    });

    it('does not block chat on changed notes after memory has been approved once', async () => {
        jest.useFakeTimers();
        const plugin = createPlugin(createPlan({
            reason: 'changed-notes',
            action: 'refresh',
            notesLikelyToUpdate: 2,
            requiresApproval: true,
        }), { memoryApprovalPolicy: 'auto-refresh-after-prepare' });
        const manager = createManager(plugin);
        (manager as any).requestApproval = jest.fn(); // eslint-disable-line @typescript-eslint/no-explicit-any
        manager.startAutoMaintenance();

        try {
            const decision = await manager.ensureReadyForChat('question');
            jest.advanceTimersByTime(0);
            await (manager as any).maintenanceQueue; // eslint-disable-line @typescript-eslint/no-explicit-any

            expect(decision).toEqual({
                decision: 'use-memory',
                message: 'Memory is using the last prepared copy while updates continue in the background.',
            });
            expect((manager as any).requestApproval).not.toHaveBeenCalled(); // eslint-disable-line @typescript-eslint/no-explicit-any
            expect(plugin.vss.refreshLocalIndex).not.toHaveBeenCalled();
            expect(plugin.vss.flush).toHaveBeenCalledWith(expect.objectContaining({
                silent: true,
                reason: 'auto-refresh',
            }));
            expect(plugin.vss.reconcileLocalFiles).toHaveBeenCalled();
            expect(plugin.notifyStatusChanged).toHaveBeenCalled();
        } finally {
            manager.stopAutoMaintenance();
            jest.useRealTimers();
        }
    });

    it('keeps fallback memory read-only during automatic chat maintenance', async () => {
        jest.useFakeTimers();
        const plugin = createPlugin(createPlan({
            reason: 'changed-notes',
            action: 'refresh',
            notesLikelyToUpdate: 2,
            requiresApproval: true,
        }), { memoryApprovalPolicy: 'auto-refresh-after-prepare' });
        plugin.vss.canAutoMaintain.mockResolvedValue(false);
        const manager = createManager(plugin);
        manager.startAutoMaintenance();

        try {
            const decision = await manager.ensureReadyForChat('question');
            jest.advanceTimersByTime(0);
            await (manager as any).maintenanceQueue; // eslint-disable-line @typescript-eslint/no-explicit-any

            expect(decision).toEqual({
                decision: 'use-memory',
                message: 'Memory is using the last prepared copy. Background updates are unavailable until memory is prepared again on this device.',
            });
            expect(plugin.vss.flush).not.toHaveBeenCalled();
            expect(plugin.vss.reconcileLocalFiles).not.toHaveBeenCalled();
        } finally {
            manager.stopAutoMaintenance();
            jest.useRealTimers();
        }
    });

    it('schedules confirmed dirty flush before retrying partial verify failures', async () => {
        jest.useFakeTimers();
        const plugin = createPlugin(createPlan(), { memoryApprovalPolicy: 'auto-refresh-after-prepare' });
        plugin.vss.verifyPendingChanges.mockResolvedValue({
            ...createOperationSummary({
                failed: 1,
                dirtyConfirmed: 1,
                verificationChecked: 2,
            }),
            markedDirty: 1,
            hasMore: true,
            bytesReadEstimate: 256,
        });
        plugin.vss.hasDirtyChanges.mockReturnValue(true);
        plugin.vss.hasPendingVerification.mockReturnValue(true);
        const manager = createManager(plugin);
        manager.startAutoMaintenance();
        const flushSpy = jest.spyOn(manager, 'scheduleAutoFlush');
        const verifySpy = jest.spyOn(manager, 'scheduleVerify');

        try {
            await (manager as any).runBackgroundTask('verify', 'unit'); // eslint-disable-line @typescript-eslint/no-explicit-any

            expect(plugin.notifyStatusChanged).toHaveBeenCalled();
            expect(flushSpy).toHaveBeenCalledWith('verify', 0);
            expect(verifySpy).toHaveBeenCalledWith('retry:unit', expect.any(Number));
        } finally {
            manager.stopAutoMaintenance();
            jest.useRealTimers();
        }
    });
});

describe('MemoryManager command decisions', () => {
    beforeEach(() => {
        mockNoticeMessages.length = 0;
        mockProgressSteps.length = 0;
    });

    it('keeps manual update on an approval-gated refresh path', async () => {
        const plugin = createPlugin(createPlan({ notesToCheck: 3 }));
        const manager = createManager(plugin);
        let approvalPlan: MemoryMaintenancePlan | undefined;
        let approvalContext: string | undefined;
        let preparedPlan: MemoryMaintenancePlan | undefined;
        (manager as any).requestApproval = jest.fn(async (plan: MemoryMaintenancePlan, context: string) => { // eslint-disable-line @typescript-eslint/no-explicit-any
            approvalPlan = plan;
            approvalContext = context;
            return 'use-memory';
        });
        (manager as any).prepareMemory = jest.fn(async (plan: MemoryMaintenancePlan) => { // eslint-disable-line @typescript-eslint/no-explicit-any
            preparedPlan = plan;
            return { ok: true, partial: false };
        });

        await manager.updateFromCommand();

        expect(approvalContext).toBe('command');
        expect(approvalPlan).toMatchObject({
            reason: 'changed-notes',
            action: 'refresh',
            notesToCheck: 3,
            notesLikelyToUpdate: 3,
            requiresApproval: true,
        });
        expect(preparedPlan).toMatchObject({
            reason: 'changed-notes',
            action: 'refresh',
        });
    });

    it('shows the prepare failure message for manual commands', async () => {
        const plugin = createPlugin(createPlan({
            reason: 'first-use',
            action: 'rebuild',
            requiresApproval: true,
        }));
        const manager = createManager(plugin);
        (manager as any).requestApproval = jest.fn(async () => 'use-memory'); // eslint-disable-line @typescript-eslint/no-explicit-any
        (manager as any).prepareMemory = jest.fn(async () => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
            ok: false,
            partial: false,
            message: 'Could not prepare memory because local storage is busy. Close other Obsidian windows for this vault, then try again.',
        }));

        await manager.prepareFromCommand();

        expect(mockNoticeMessages).toEqual([
            'Could not prepare memory because local storage is busy. Close other Obsidian windows for this vault, then try again.',
        ]);
    });

    it('updates one progress notice from rebuild progress events', async () => {
        let now = 0;
        const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => {
            now += 400;
            return now;
        });
        const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: {
                createDocumentFragment: jest.fn(() => createMockDomElement()),
            },
        });
        const plugin = createPlugin(createPlan({
            reason: 'first-use',
            action: 'rebuild',
            requiresApproval: true,
        }));
        plugin.vss.rebuildLocalIndex.mockImplementation(async (options?: {
            silent?: boolean;
            onProgress?: (event: {
                phase: 'scanning' | 'embedding' | 'writing' | 'retrying' | 'ready';
                filesDone?: number;
                filesTotal?: number;
                chunksEmbedded?: number;
                chunksTotal?: number;
                currentFile?: string;
                retryDelayMs?: number;
            }) => void;
        }) => {
            options?.onProgress?.({ phase: 'scanning', filesDone: 1, filesTotal: 3, currentFile: 'one.md' });
            options?.onProgress?.({ phase: 'embedding', chunksEmbedded: 2, chunksTotal: 10 });
            options?.onProgress?.({ phase: 'retrying', retryDelayMs: 5000 });
            options?.onProgress?.({ phase: 'writing', filesDone: 2, filesTotal: 3 });
            options?.onProgress?.({ phase: 'ready' });
            return createOperationSummary({
                updated: 3,
            });
        });
        const manager = createManager(plugin);

        try {
            await manager.prepareMemory(createPlan({ reason: 'first-use', action: 'rebuild' }));

            expect(plugin.vss.rebuildLocalIndex).toHaveBeenCalledWith(expect.objectContaining({
                silent: true,
                onProgress: expect.any(Function),
            }));
            expect(mockProgressSteps).toEqual(expect.arrayContaining([
                'Checking notes',
                'Checking notes 1/3: one.md',
                'Preparing notes 2/10',
                'Retrying in 5s',
                'Saving memory 2/3',
                'Ready',
            ]));
        } finally {
            nowSpy.mockRestore();
            if (originalDocument) {
                Object.defineProperty(globalThis, 'document', originalDocument);
            } else {
                delete (globalThis as { document?: Document }).document;
            }
        }
    });

    it('does not show completion UI or schedule follow-up work after stop during prepare', async () => {
        const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: {
                createDocumentFragment: jest.fn(() => createMockDomElement()),
            },
        });
        const plugin = createPlugin(createPlan({
            reason: 'first-use',
            action: 'rebuild',
            requiresApproval: true,
        }));
        let resolveRebuild: (summary: Awaited<ReturnType<typeof plugin.vss.rebuildLocalIndex>>) => void = () => undefined;
        plugin.vss.rebuildLocalIndex.mockImplementation(async () => new Promise((resolve) => {
            resolveRebuild = resolve;
        }));
        const manager = createManager(plugin);

        try {
            const preparing = manager.prepareMemory(createPlan({ reason: 'first-use', action: 'rebuild' }));
            await Promise.resolve();
            manager.stopAutoMaintenance();
            resolveRebuild(createOperationSummary({
                updated: 1,
            }));
            const result = await preparing;

            expect(result.ok).toBe(false);
            expect(plugin.notifyStatusChanged).not.toHaveBeenCalled();
            expect(mockNoticeMessages).not.toContain('Memory is ready. Your notes were not changed.');
        } finally {
            if (originalDocument) {
                Object.defineProperty(globalThis, 'document', originalDocument);
            } else {
                delete (globalThis as { document?: Document }).document;
            }
        }
    });
});

describe('MemoryApprovalModal', () => {
    it('shows chat approval buttons and resolves the primary action', () => {
        const decisions: string[] = [];
        const modal = new MemoryApprovalModal(
            createPlugin(createPlan()) as unknown as ConstructorParameters<typeof MemoryApprovalModal>[0],
            createPlan({ reason: 'first-use', action: 'rebuild', requiresApproval: true }),
            (decision) => decisions.push(decision),
        );

        modal.onOpen();

        const buttonLabels = mockSettingGroups.flatMap((group) => group.map((button) => button.text));
        expect(buttonLabels).toEqual(['Prepare memory', 'Answer now', 'Cancel']);
        mockSettingGroups[0][0].click?.();
        expect(decisions).toEqual(['use-memory']);
    });

    it('omits Answer now for command approval and resolves close as cancel', () => {
        const decisions: string[] = [];
        const modal = new MemoryApprovalModal(
            createPlugin(createPlan()) as unknown as ConstructorParameters<typeof MemoryApprovalModal>[0],
            createPlan({ reason: 'changed-notes', action: 'refresh', requiresApproval: true }),
            (decision) => decisions.push(decision),
            'command',
        );

        modal.onOpen();

        const buttonLabels = mockSettingGroups.flatMap((group) => group.map((button) => button.text));
        expect(buttonLabels).toEqual(['Update memory', 'Cancel']);
        modal.onClose();
        expect(decisions).toEqual(['cancel']);
    });
});

describe('Memory product language', () => {
    it('keeps approval copy focused on user-facing memory language', () => {
        const plan = createPlan({ reason: 'first-use', action: 'rebuild', requiresApproval: true });
        const chatCopy = getMemoryApprovalCopy(plan);
        const commandCopy = getMemoryApprovalCopy(plan, 'command');
        const visibleCopy = [
            chatCopy.title,
            chatCopy.primaryAction,
            chatCopy.secondaryAction,
            chatCopy.cancelAction,
            commandCopy.primaryAction,
            ...MEMORY_APPROVAL_SECTIONS.flatMap((section) => [section.title, section.body]),
        ].join(' ');

        for (const term of MEMORY_USER_FORBIDDEN_TERMS) {
            expect(visibleCopy.toLowerCase()).not.toContain(term.toLowerCase());
        }
        expect(visibleCopy).toContain('Your notes will not be changed or deleted.');
        expect(visibleCopy).toContain('your question may be sent to your configured AI provider to search Memory');
        expect(visibleCopy).toContain('This does not send all note text.');
        expect(visibleCopy).toContain('AI credits or API calls');
        expect(chatCopy.primaryAction).toBe('Prepare memory');
        expect(chatCopy.secondaryAction).toBe('Answer now');
        expect(commandCopy.primaryAction).toBe('Prepare memory');
        expect(commandCopy.secondaryAction).toBe('Not now');
    });

    it('uses Update memory for refresh approval paths', () => {
        const copy = getMemoryApprovalCopy(createPlan({
            reason: 'changed-notes',
            action: 'refresh',
            requiresApproval: true,
        }));

        expect(copy.title).toBe('Update memory before answering?');
        expect(copy.primaryAction).toBe('Update memory');
        expect(copy.secondaryAction).toBe('Answer now');
    });
});

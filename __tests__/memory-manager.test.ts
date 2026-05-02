import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
    MEMORY_APPROVAL_SECTIONS,
    MEMORY_USER_FORBIDDEN_TERMS,
    MemoryManager,
    getMemoryApprovalCopy,
    type MemoryMaintenancePlan,
} from '../src/memory-manager';

const mockNoticeMessages: string[] = [];

jest.mock('obsidian', () => ({
    Notice: class {
        constructor(message?: unknown) {
            mockNoticeMessages.push(String(message));
        }
        hide() { }
        noticeEl = {
            addClass: jest.fn(),
            parentElement: { addClass: jest.fn() },
            setCssStyles: jest.fn(),
            querySelector: jest.fn(),
        };
    },
    Platform: { isMobile: false },
    Modal: class {
        constructor(_app: unknown) { }
        open() { }
        close() { }
    },
    Setting: class { },
}));

const createPlan = (overrides: Partial<MemoryMaintenancePlan> = {}): MemoryMaintenancePlan => ({
    reason: 'ready',
    action: 'none',
    notesToCheck: 3,
    requiresApproval: false,
    canAnswerNow: true,
    ...overrides,
});

const createPlugin = (plan: MemoryMaintenancePlan, settings: Record<string, unknown> = {}) => ({
    app: {},
    settings: {
        memoryEnabled: true,
        memoryAutoCheckBeforeChat: true,
        ...settings,
    },
    vss: {
        getMemoryReadiness: jest.fn(async () => plan),
        refreshLocalIndex: jest.fn(async (_options?: { silent?: boolean }) => ({
            aborted: false,
            updated: 0,
            unchanged: 0,
            removed: 0,
            skipped: 0,
            failed: 0,
        })),
        rebuildLocalIndex: jest.fn(async (_options?: { silent?: boolean }) => ({
            aborted: false,
            updated: 0,
            unchanged: 0,
            removed: 0,
            skipped: 0,
            failed: 0,
        })),
    },
    updateMemoryStatusBar: jest.fn(async () => undefined),
    log: jest.fn(),
});

describe('MemoryManager chat decisions', () => {
    beforeEach(() => {
        mockNoticeMessages.length = 0;
    });

    it('uses memory immediately when memory is ready', async () => {
        const plugin = createPlugin(createPlan());
        const manager = new MemoryManager(plugin as unknown as ConstructorParameters<typeof MemoryManager>[0]);

        const decision = await manager.ensureReadyForChat('question');

        expect(decision).toEqual({ decision: 'use-memory' });
        expect(plugin.vss.getMemoryReadiness).toHaveBeenCalledTimes(1);
        expect(mockNoticeMessages).toEqual([]);
    });

    it('answers normally when memory is disabled', async () => {
        const plugin = createPlugin(createPlan(), { memoryEnabled: false });
        const manager = new MemoryManager(plugin as unknown as ConstructorParameters<typeof MemoryManager>[0]);

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
        const manager = new MemoryManager(plugin as unknown as ConstructorParameters<typeof MemoryManager>[0]);

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
        const manager = new MemoryManager(plugin as unknown as ConstructorParameters<typeof MemoryManager>[0]);

        const decision = await manager.ensureReadyForChat('question');

        expect(decision).toEqual({ decision: 'use-memory' });
        expect(plugin.vss.getMemoryReadiness).not.toHaveBeenCalled();
    });
});

describe('MemoryManager command decisions', () => {
    beforeEach(() => {
        mockNoticeMessages.length = 0;
    });

    it('keeps manual update on an approval-gated refresh path', async () => {
        const plugin = createPlugin(createPlan({ notesToCheck: 3 }));
        const manager = new MemoryManager(plugin as unknown as ConstructorParameters<typeof MemoryManager>[0]);
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
        const manager = new MemoryManager(plugin as unknown as ConstructorParameters<typeof MemoryManager>[0]);
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
        expect(visibleCopy).toContain('AI credits or API calls');
        expect(commandCopy.primaryAction).toBe('Prepare memory');
    });
});

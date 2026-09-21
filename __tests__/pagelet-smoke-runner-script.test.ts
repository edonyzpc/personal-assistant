import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from '@jest/globals';

const runner = readFileSync(resolve(__dirname, '../scripts/pagelet-smoke-runner.js'), 'utf8');

async function settingsPreflight(settings: Record<string, unknown>) {
    let report: { checks: Array<{ name: string; status: string }> } | undefined;
    const context = {
        app: {
            plugins: { plugins: { 'personal-assistant': { settings } } },
            vault: {
                getMarkdownFiles: () => [],
                adapter: { write: async (_path: string, content: string) => { report = JSON.parse(content); } },
            },
            commands: {
                commands: { 'personal-assistant:pa-pagelet:discover-connections': {} },
                // This test covers the executable settings preflight. Real
                // panel and Memory behavior are covered by the App smoke gate.
                executeCommandById: () => { throw new Error('End of settings preflight fixture.'); },
            },
        },
        console: { log: () => undefined, warn: () => undefined },
    };
    await runInNewContext(runner, context);
    return report!.checks;
}

describe('Pagelet smoke settings preflight', () => {
    it.each([true, false])('accepts the valid background choice %s and checks the explicit discovery command', async (enabled) => {
        const checks = await settingsPreflight({ pagelet: { enabled: true, backgroundDiscoveryEnabled: enabled } });
        expect(checks).toContainEqual(expect.objectContaining({
            name: 'Pagelet background preparation setting is readable', status: 'PASS',
        }));
        expect(checks).toContainEqual(expect.objectContaining({
            name: 'Command registered: pa-pagelet:discover-connections', status: 'PASS',
        }));
        expect(checks.filter((check) => check.name.startsWith('Retired setting absent:')
            || check.name.startsWith('Retired Pagelet setting absent:'))).toHaveLength(5);
        expect(checks.filter((check) => check.name.includes('setting absent:')).every((check) => check.status === 'PASS')).toBe(true);
    });

    it.each(['preloadEnabled', 'deepDiscoverEnabled', 'memoryAutoCheckBeforeChat', 'skillContextEnabled', 'enabledSkillIds'])(
        'reports a resurrected %s setting even when its value is false', async (key) => {
            const pagelet = { enabled: true, backgroundDiscoveryEnabled: true };
            const settings = { pagelet };
            Object.assign(['preloadEnabled', 'deepDiscoverEnabled'].includes(key) ? pagelet : settings, { [key]: false });
            const checks = await settingsPreflight(settings);
            expect(checks).toContainEqual(expect.objectContaining({
                name: `${['preloadEnabled', 'deepDiscoverEnabled'].includes(key) ? 'Retired Pagelet' : 'Retired'} setting absent: ${key}`,
                status: 'FAIL',
            }));
        },
    );
});

type D6Capability = unknown | (() => unknown);

async function runD6Fixture(options: {
    capability?: D6Capability;
    candidateError?: Error;
    saveError?: Error;
} = {}) {
    let report: { checks: Array<{ name: string; status: string; detail?: string }> } | undefined;
    const originalSettings = {
        pagelet: { enabled: true, backgroundDiscoveryEnabled: true, petVisible: false },
        reviewQueue: { enabled: true, items: [{ id: 'existing', type: 'link_suggestion' }] },
        memoryGovernance: { records: [{ id: 'existing-memory', summary: 'Existing' }] },
        confirmedMemoryCount: 7,
        memoryAutoAcceptPaused: true,
    };
    const settings = JSON.parse(JSON.stringify(originalSettings));
    const createReviewQueueItem = jest.fn(async (input: { claim: string; metadata?: { memoryType?: string } }) => {
        if (options.candidateError) throw options.candidateError;
        if (input.metadata?.memoryType === 'preference') {
            settings.memoryGovernance.records.push({
                id: 'auto-memory',
                summary: input.claim,
                confirmationStrength: 'auto',
            });
            settings.confirmedMemoryCount += 1;
            return { ok: true, value: { status: 'applied' } };
        }
        return { ok: true, value: { status: 'suggested' } };
    });
    const saveSettings = jest.fn(async () => {
        if (options.saveError) throw options.saveError;
    });
    const plugin: Record<string, unknown> = { settings, createReviewQueueItem, saveSettings };
    if (options.capability !== undefined) {
        plugin.getMemoryGovernanceSmokeCapability = typeof options.capability === 'function'
            ? options.capability
            : () => options.capability;
    }
    const panel = {
        classList: { contains: (value: string) => value === 'pa-pagelet-panel' },
        textContent: 'Pagelet',
        querySelector: () => ({ textContent: 'Review current note' }),
    };
    const commands = new Proxy<Record<string, unknown>>({}, {
        get: (_target, key) => String(key).endsWith('pa-pagelet:weekly-review')
            || String(key).endsWith('pa-pagelet:periodic-summary') ? undefined : {},
    });
    const context = {
        app: {
            plugins: { plugins: { 'personal-assistant': plugin } },
            vault: {
                getMarkdownFiles: () => [{ path: 'notes/source.md', basename: 'source' }],
                adapter: { write: async (_path: string, content: string) => { report = JSON.parse(content); } },
            },
            workspace: {
                getLeaf: () => ({ openFile: async () => undefined }),
                activeLeaf: { view: { getViewType: () => 'markdown' } },
            },
            commands: {
                commands,
                executeCommandById: async () => undefined,
            },
        },
        document: {
            querySelector: (selector: string) => selector === '.pa-pagelet-panel' ? panel : null,
        },
        setTimeout: (callback: () => void) => { callback(); return 0; },
        clearTimeout: () => undefined,
        console: { log: () => undefined, warn: () => undefined },
    };
    await runInNewContext(runner, context);
    return { report: report!, settings, originalSettings, createReviewQueueItem, saveSettings };
}

describe('Pagelet smoke D6 Memory safety capability', () => {
    it.each([
        ['missing', undefined],
        ['malformed', { schemaVersion: 1, mode: 'isolated_legacy_fixture' }],
        ['unknown version', { schemaVersion: 2, mode: 'isolated_legacy_fixture', reason: 'fixture' }],
        ['durable', { schemaVersion: 1, mode: 'blocked', reason: 'durable_governance' }],
        ['unknown', { schemaVersion: 1, mode: 'blocked', reason: 'bootstrap_unknown' }],
        ['failed', { schemaVersion: 1, mode: 'blocked', reason: 'bootstrap_failed' }],
    ])('blocks %s capability without mutating Memory', async (_label, capability) => {
        const result = await runD6Fixture({ capability });
        expect(result.report.checks).toContainEqual(expect.objectContaining({
            name: 'D6 Memory runtime probe', status: 'BLOCKED',
        }));
        expect(result.createReviewQueueItem).not.toHaveBeenCalled();
        expect(result.saveSettings).not.toHaveBeenCalled();
        expect(result.settings).toEqual(result.originalSettings);
    });

    it('blocks a throwing capability probe without mutating Memory', async () => {
        const result = await runD6Fixture({
            capability: () => { throw new Error('probe unavailable'); },
        });
        expect(result.report.checks).toContainEqual(expect.objectContaining({
            name: 'D6 Memory runtime probe', status: 'BLOCKED',
        }));
        expect(result.createReviewQueueItem).not.toHaveBeenCalled();
        expect(result.settings).toEqual(result.originalSettings);
    });

    it('runs only for an explicit isolated fixture and restores all changed settings', async () => {
        const result = await runD6Fixture({
            capability: { schemaVersion: 1, mode: 'isolated_legacy_fixture', reason: 'test_fixture' },
        });
        expect(result.report.checks).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'D6 Level 2 auto-confirms eligible Memory candidates', status: 'PASS' }),
            expect.objectContaining({ name: 'D6 Level 2 keeps task constraints manual', status: 'PASS' }),
            expect.objectContaining({ name: 'D6 Memory runtime probe restored settings', status: 'PASS' }),
        ]));
        expect(result.createReviewQueueItem).toHaveBeenCalledTimes(2);
        expect(result.saveSettings).toHaveBeenCalledTimes(1);
        expect(result.settings).toEqual(result.originalSettings);
    });

    it('restores settings when candidate creation throws', async () => {
        const result = await runD6Fixture({
            capability: { schemaVersion: 1, mode: 'isolated_legacy_fixture', reason: 'test_fixture' },
            candidateError: new Error('candidate failed'),
        });
        expect(result.report.checks).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'D6 Memory runtime probe', status: 'FAIL' }),
            expect.objectContaining({ name: 'D6 Memory runtime probe restored settings', status: 'PASS' }),
        ]));
        expect(result.settings).toEqual(result.originalSettings);
    });

    it('keeps in-memory settings restored when the final save fails', async () => {
        const result = await runD6Fixture({
            capability: { schemaVersion: 1, mode: 'isolated_legacy_fixture', reason: 'test_fixture' },
            saveError: new Error('save failed'),
        });
        expect(result.report.checks).toContainEqual(expect.objectContaining({
            name: 'D6 Memory runtime probe restored settings', status: 'FAIL',
        }));
        expect(result.settings).toEqual(result.originalSettings);
    });
});

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

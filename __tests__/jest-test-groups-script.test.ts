import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from '@jest/globals';

const root = process.cwd();
const loadModule = createRequire(resolve(root, 'package.json'));
const discover = (config: string): string[] => JSON.parse(execFileSync(process.execPath, [
    loadModule.resolve('jest/bin/jest'), '--config', config, '--listTests', '--json', '--runInBand',
], { cwd: root, encoding: 'utf8' })).map((path: string) => relative(root, path).split('\\').join('/')).sort();

describe('Jest validation groups', () => {
    it('partitions actual Jest discovery without losing or repeating suites', () => {
        const all = discover('jest.config.js');
        const source = discover('jest.source.config.cjs');
        const tooling = discover('jest.tooling.config.cjs');
        const artifacts = discover('jest.artifacts.config.cjs');
        const combined = [...source, ...tooling, ...artifacts];

        expect(new Set(combined).size).toBe(combined.length);
        expect(combined.sort()).toEqual(all);
        expect(artifacts).toEqual([
            '__tests__/fts-ios-runtime-receipt.test.ts',
            '__tests__/fts-runtime-probe-script.test.ts',
        ]);
        expect(source).toEqual(expect.arrayContaining([
            '__tests__/sqlite-inline-assets.test.ts',
            '__tests__/pagelet-deep-discover-smoke-evidence.test.ts',
        ]));
        expect(source.filter((path) => path.startsWith('src/')))
            .toEqual(all.filter((path) => path.startsWith('src/')));
        expect(source.some((path) => path.startsWith('src/'))).toBe(true);
        // New script tests are discovered automatically in tooling; the source
        // path continues using Jest's default discovery for future runtime tests.
        expect(tooling).toContain('__tests__/jest-test-groups-script.test.ts');
        for (const group of ['tooling', 'artifacts']) {
            const config = loadModule(resolve(root, `jest.${group}.config.cjs`));
            for (const path of config.testMatch.filter((path: string) => !path.includes('*'))) {
                expect(existsSync(path.replace('<rootDir>', root))).toBe(true);
            }
        }
    });

    it('keeps the full coverage contract shared across all entrypoints', () => {
        const base = loadModule(resolve(root, 'jest.config.js'));
        for (const group of ['source', 'tooling', 'artifacts']) {
            const config = loadModule(resolve(root, `jest.${group}.config.cjs`));
            expect(config.coverageThreshold).toEqual(base.coverageThreshold);
            expect(config.coverageProvider).toBe(base.coverageProvider);
            expect(config.moduleNameMapper).toEqual(base.moduleNameMapper);
        }
    });
});

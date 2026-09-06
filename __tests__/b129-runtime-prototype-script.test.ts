import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

it('runs the offline B-129 SDK prototype in its native Node test environment', () => {
    const output = execFileSync(process.execPath, [
        '--test', '--test-reporter=tap',
        resolve(process.cwd(), 'scripts/prototypes/b129-runtime-prototype.cases.mjs'),
    ], { encoding: 'utf8', timeout: 30_000 });
    expect(output).toMatch(/# fail 0\b/);
}, 35_000);

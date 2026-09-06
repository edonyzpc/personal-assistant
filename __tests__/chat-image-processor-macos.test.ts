import { createHash, webcrypto } from 'node:crypto';
import { FileSystemAdapter, Platform } from 'obsidian';
import { convertMacOsHeicToPng } from '../src/chat/image-macos-converter';
import { ImageProcessingError } from '../src/chat/image-policy';

jest.mock('obsidian', () => ({ Platform: { isDesktopApp: true, isMacOS: true },
    FileSystemAdapter: class { constructor(private readonly base: string) {} getBasePath() { return this.base; } } }));
jest.mock('node:child_process', () => ({ execFile: jest.fn() }));
const fs: typeof import('node:fs/promises') = require('node:fs/promises');
const path: typeof import('node:path') = require('node:path');
const os: typeof import('node:os') = require('node:os');
const cp: typeof import('node:child_process') = require('node:child_process');
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
async function until(check: () => boolean): Promise<void> {
    for (let i = 0; i < 100 && !check(); i++) await tick();
    expect(check()).toBe(true);
}

describe('macOS fallback: real isolated file IO, stubbed process exit (no codec claims)', () => {
    const savedCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    let root: string, vault: string, app: any, signal: AbortController;
    const source = Uint8Array.from([1, 2, 3, 4, 5]).buffer;
    const sourceHash = createHash('sha256').update(new Uint8Array(source)).digest('hex');
    const png = Buffer.from('\x89PNG\r\n\x1a\nsynthetic pixels', 'binary');
    let callback: ((error: Error | null, stdout: string, stderr: string) => void) | undefined;
    let commandArgs: string[];
    const kill = jest.fn();
    const convert = (overrides = {}) => convertMacOsHeicToPng(app, {
        originalPath: 'pa-images/source.heic', sourceBytes: source, sourceHash, signal: signal.signal, ...overrides });
    beforeEach(async () => {
        Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
        root = await fs.mkdtemp(path.join(os.tmpdir(), 'b129-production-image-test-'));
        vault = path.join(root, 'vault'); await fs.mkdir(path.join(vault, 'pa-images'), { recursive: true });
        await fs.writeFile(path.join(vault, 'pa-images/source.heic'), new Uint8Array(source));
        jest.spyOn(os, 'tmpdir').mockReturnValue(root);
        app = { vault: { adapter: new (FileSystemAdapter as any)(vault) } }; signal = new AbortController();
        Object.assign(Platform, { isDesktopApp: true, isMacOS: true }); callback = undefined; commandArgs = []; kill.mockClear();
        (cp.execFile as unknown as jest.Mock).mockImplementation((_command: string, args: string[], _options: unknown, done: typeof callback) => {
            commandArgs = args; callback = done; return { kill };
        });
    });
    afterEach(async () => {
        jest.restoreAllMocks();
        await fs.rm(root, { recursive: true, force: true });
        if (savedCrypto) Object.defineProperty(globalThis, 'crypto', savedCrypto); else delete (globalThis as any).crypto;
    });
    async function complete(stderr = ''): Promise<void> {
        await until(() => Boolean(callback));
        await fs.writeFile(commandArgs[5], png); callback!(null, '', stderr);
    }
    async function assertOnlySourceRemains(): Promise<void> {
        expect(await fs.readdir(root)).toEqual(['vault']);
        expect(await fs.readFile(path.join(vault, 'pa-images/source.heic'))).toEqual(Buffer.from(source));
    }
    it('uses a fixed executable, shell-free args, private verified snapshot and exact cleanup', async () => {
        const result = convert(); await until(() => Boolean(callback));
        expect(cp.execFile).toHaveBeenCalledWith('/usr/bin/sips', ['-s', 'format', 'png', expect.stringContaining('/pa-chat-image-'), '--out', expect.any(String)],
            { shell: false, maxBuffer: 8192 }, expect.any(Function));
        expect(commandArgs[3]).not.toBe(path.join(vault, 'pa-images/source.heic'));
        expect(await fs.readFile(commandArgs[3])).toEqual(Buffer.from(source));
        expect((await fs.stat(commandArgs[3])).mode & 0o777).toBe(0o600);
        await complete(); await expect(result).resolves.toEqual(Uint8Array.from(png).buffer); await assertOnlySourceRemains();
    });
    it.each([{ isDesktopApp: false, isMacOS: true }, { isDesktopApp: true, isMacOS: false }])('does no file/process IO outside macOS desktop: %s', async (platform) => {
        Object.assign(Platform, platform); const realpath = jest.spyOn(fs, 'realpath');
        await expect(convert()).rejects.toMatchObject({ code: 'conversion-unavailable' });
        expect(realpath).not.toHaveBeenCalled(); expect(cp.execFile).not.toHaveBeenCalled();
    });
    it('requires a host FileSystemAdapter instance, not a getBasePath duck type', async () => {
        app.vault.adapter = { getBasePath: () => vault };
        await expect(convert()).rejects.toMatchObject({ code: 'conversion-unavailable' }); expect(cp.execFile).not.toHaveBeenCalled();
    });
    it.each(['../outside.heic', '/absolute.heic', 'pa-images/../source.heic', 'pa-images\\source.heic'])('rejects unsafe source path %s', async (originalPath) => {
        await expect(convert({ originalPath })).rejects.toMatchObject({ code: 'source-changed' });
        expect(cp.execFile).not.toHaveBeenCalled(); await assertOnlySourceRemains();
    });
    it('rejects a symlink escaping the vault before starting any process', async () => {
        const outside = path.join(root, 'outside.heic'); await fs.writeFile(outside, new Uint8Array(source));
        await fs.symlink(outside, path.join(vault, 'pa-images/link.heic'));
        await expect(convert({ originalPath: 'pa-images/link.heic' })).rejects.toMatchObject({ code: 'source-changed' });
        expect(cp.execFile).not.toHaveBeenCalled();
    });
    it('rejects changed disk bytes and mismatching caller snapshot before conversion', async () => {
        await expect(convert({ sourceBytes: Uint8Array.from([9]).buffer })).rejects.toMatchObject({ code: 'source-changed' });
        await fs.writeFile(path.join(vault, 'pa-images/source.heic'), Buffer.from([9]));
        await expect(convert()).rejects.toMatchObject({ code: 'source-changed' }); expect(cp.execFile).not.toHaveBeenCalled();
    });
    it('waits for process exit on cancellation, discards a late output, then removes its files', async () => {
        let settled = false;
        const result = convert().finally(() => { settled = true; });
        const rejected = expect(result).rejects.toMatchObject({ code: 'cancelled' });
        await until(() => Boolean(callback)); signal.abort(); await tick();
        expect(kill).toHaveBeenCalledWith('SIGTERM'); expect(settled).toBe(false);
        expect(await fs.stat(commandArgs[3])).toBeDefined();
        await complete(); await rejected; await assertOnlySourceRemains();
    });
    it('preserves timeout reason through process exit and cleanup', async () => {
        const result = convert(); const rejected = expect(result).rejects.toMatchObject({ code: 'timeout' });
        await until(() => Boolean(callback)); signal.abort(new ImageProcessingError('timeout'));
        await complete(); await rejected; await assertOnlySourceRemains();
    });
    it('cleans a directory created after cancellation without launching the process', async () => {
        const realMkdtemp = fs.mkdtemp; let resume!: () => void, created = false;
        const gate = new Promise<void>((resolve) => { resume = resolve; });
        jest.spyOn(fs, 'mkdtemp').mockImplementationOnce(async (prefix: any) => {
            const directory = await realMkdtemp(prefix); created = true; await gate; return directory;
        });
        const result = convert(); const rejected = expect(result).rejects.toMatchObject({ code: 'cancelled' });
        await until(() => created); signal.abort(); resume(); await rejected;
        expect(cp.execFile).not.toHaveBeenCalled(); await assertOnlySourceRemains();
    });
    it.each(['CoreVideo failed to allocate', 'IOSurface creation failure'])('rejects suspicious system decoder output despite exit zero: %s', async (stderr) => {
        const result = convert(); const rejected = expect(result).rejects.toMatchObject({ code: 'conversion-failed' });
        await complete(stderr); await rejected; await assertOnlySourceRemains();
    });
    it('does not turn cleanup failure into conversion success', async () => {
        const result = convert(); const rejected = expect(result).rejects.toMatchObject({ code: 'cleanup-failed' });
        await until(() => Boolean(callback));
        jest.spyOn(fs, 'unlink').mockRejectedValueOnce(Object.assign(new Error('locked'), { code: 'EACCES' }));
        await complete(); await rejected;
        expect(await fs.readFile(path.join(vault, 'pa-images/source.heic'))).toEqual(Buffer.from(source));
    });
    it('does not publish conversion output after lifecycle invalidation', async () => {
        let current = true; const result = convert({ isCurrent: () => current });
        const rejected = expect(result).rejects.toMatchObject({ code: 'stale' });
        await until(() => Boolean(callback)); current = false; await complete(); await rejected; await assertOnlySourceRemains();
    });
});

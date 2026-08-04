import { describe, expect, it, jest } from '@jest/globals';
import { strToU8, unzipSync, zipSync } from 'fflate';
import type { App } from 'obsidian';
import { extractFiles } from '../src/utils';

jest.mock('obsidian', () => ({
    normalizePath: (path: string) => path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, ''),
    requestUrl: jest.fn(),
}));

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

const createZip = (files: Record<string, string>): ArrayBuffer => {
    return toArrayBuffer(zipSync(Object.fromEntries(
        Object.entries(files).map(([path, content]) => [path, strToU8(content)])
    )));
};

const equalsBytes = (left: Uint8Array, right: Uint8Array) => {
    return left.length === right.length && left.every((byte, index) => byte === right[index]);
};

const setZipEntryCompression = (zipBytes: ArrayBuffer, fileName: string, compression: number): ArrayBuffer => {
    const result = new Uint8Array(zipBytes.slice(0));
    const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
    const fileNameBytes = new TextEncoder().encode(fileName);

    for (let offset = 0; offset <= result.length - 4; offset++) {
        const signature = view.getUint32(offset, true);

        if (signature === 0x04034b50) {
            const fileNameLength = view.getUint16(offset + 26, true);
            const extraLength = view.getUint16(offset + 28, true);
            const fileNameStart = offset + 30;
            const fileNameEnd = fileNameStart + fileNameLength;

            if (equalsBytes(result.subarray(fileNameStart, fileNameEnd), fileNameBytes)) {
                view.setUint16(offset + 8, compression, true);
            }

            offset = fileNameEnd + extraLength - 1;
        } else if (signature === 0x02014b50) {
            const fileNameLength = view.getUint16(offset + 28, true);
            const extraLength = view.getUint16(offset + 30, true);
            const commentLength = view.getUint16(offset + 32, true);
            const fileNameStart = offset + 46;
            const fileNameEnd = fileNameStart + fileNameLength;

            if (equalsBytes(result.subarray(fileNameStart, fileNameEnd), fileNameBytes)) {
                view.setUint16(offset + 10, compression, true);
            }

            offset = fileNameEnd + extraLength + commentLength - 1;
        }
    }

    return toArrayBuffer(result);
};

const createMockApp = () => {
    const write = jest.fn<(path: string, data: string) => Promise<void>>(async () => undefined);
    const app = {
        vault: {
            adapter: {
                write,
            },
        },
    } as unknown as App;

    return { app, write };
};

describe('ZIP utilities', () => {
    it('extracts requested files without inflating unrelated ZIP entries', async () => {
        const zipBytes = setZipEntryCompression(createZip({
            'release/theme.css': 'theme css',
            'release/manifest.json': '{"name":"sample-theme"}',
            'release/unrelated.bin': 'unsupported compression',
        }), 'release/unrelated.bin', 99);

        expect(() => unzipSync(new Uint8Array(zipBytes))).toThrow();
        await expect(extractFiles(zipBytes, ['theme.css', 'manifest.json'])).resolves.toEqual({
            'theme.css': 'theme css',
            'manifest.json': '{"name":"sample-theme"}',
        });
    });

    it('returns null for requested files that are missing from a ZIP archive', async () => {
        await expect(extractFiles(createZip({
            'release/theme.css': 'theme css',
        }), ['theme.css', 'manifest.json'])).resolves.toEqual({
            'theme.css': 'theme css',
            'manifest.json': null,
        });
    });

});

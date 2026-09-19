import { expect, it, jest } from '@jest/globals';
import * as platformDom from '../src/platform-dom';
import { prepareWanImageInput } from '../src/chat/image-generation-input';

it('waits for approval before making an opaque white-backed Wan copy', async () => {
    const bytes = Uint8Array.from(Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Dq0AAAAASUVORK5CYII=',
        'base64'));
    new DataView(bytes.buffer).setUint32(16, 240);
    new DataView(bytes.buffer).setUint32(20, 240);
    const original = bytes.slice();
    const fillRect = jest.fn();
    const context = {
        drawImage: jest.fn(), getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 252]) }),
        fillRect, fillStyle: '', globalCompositeOperation: 'source-over',
    };
    const image = { naturalWidth: 240, naturalHeight: 240, onload: null as (() => void) | null,
        onerror: null, set src(_value: string) { this.onload?.(); } };
    const canvas = { width: 0, height: 0, getContext: () => context,
        toBlob: (callback: (value: Blob) => void) => callback(new Blob([bytes], { type: 'image/png' })) };
    const document = { createElement: (tag: string) => tag === 'img' ? image : canvas } as unknown as Document;
    const documentSpy = jest.spyOn(platformDom, 'getPlatformDocument').mockReturnValue(document);
    const createObjectURL = URL.createObjectURL;
    const revokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = () => 'blob:test';
    URL.revokeObjectURL = () => {};
    try {
        await expect(prepareWanImageInput(bytes.buffer, () => true)).rejects.toThrow('transparent_input_needs_confirmation');
        expect(fillRect).not.toHaveBeenCalled();
        const prepared = await prepareWanImageInput(bytes.buffer, () => true, true);
        expect(prepared).toMatchObject({ whiteBackgroundApplied: true });
        expect(prepared.dataUrl).toMatch(/^data:image\/png;base64,/);
        expect(fillRect).toHaveBeenCalledWith(0, 0, 240, 240);
        expect(context.globalCompositeOperation).toBe('source-over');
        expect(bytes).toEqual(original);
    } finally {
        documentSpy.mockRestore();
        URL.createObjectURL = createObjectURL;
        URL.revokeObjectURL = revokeObjectURL;
    }
});

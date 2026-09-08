import { z } from 'zod';
import { cloneImageRef, validateImagePath, type ImageRef } from './image-types';

export interface SaveAttachment {
    ref: ImageRef;
    sourcePath: string;
    sourceName: string;
    attachmentKind: 'original' | 'heic_jpeg';
    /** Absent on immutable legacy copy plans. Move may reuse an earlier PA promotion. */
    transfer?: 'move' | 'reference';
    mime: string;
    filename: string;
    outputHash: string;
    exportPolicy: string;
    byteLength: number;
    plannedPath?: string;
    writtenHash?: string;
    state: 'planned' | 'written';
}
export interface SaveReceipt {
    id: string;
    operationId: string;
    writingVersionId: string;
    textHash: string;
    targetNotePath: string;
    origin: 'ai_generated' | 'user_edited';
    createdAt: number;
    attachments: SaveAttachment[];
    initialNoteHash: string;
    noteContentHash: string;
    finalNoteHash?: string;
    noteState: 'pending' | 'created' | 'completed';
    state: 'prepared' | 'partial' | 'completed' | 'failed';
    failureReason?: string;
}
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const attachmentSchema = z.object({
    ref: z.unknown(), sourcePath: z.string(), sourceName: z.string().min(1).max(512),
    attachmentKind: z.enum(['original', 'heic_jpeg']), mime: z.string().regex(/^image\/[a-z0-9.+-]+$/),
    transfer: z.enum(['move', 'reference']).optional(),
    filename: z.string().min(1).max(255).refine((name) => !name.includes('/') && !name.includes('\\')
        && !Array.from(name).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)),
    outputHash: hash, exportPolicy: z.string().min(1).max(256), byteLength: z.number().int().nonnegative(),
    plannedPath: z.string().optional(), writtenHash: hash.optional(), state: z.enum(['planned', 'written']),
}).strict();
const receiptSchema = z.object({
    id, operationId: id, writingVersionId: id, textHash: hash, targetNotePath: z.string(),
    origin: z.enum(['ai_generated', 'user_edited']), createdAt: z.number().int().nonnegative(),
    attachments: z.array(attachmentSchema).max(2048), initialNoteHash: hash, noteContentHash: hash,
    finalNoteHash: hash.optional(), noteState: z.enum(['pending', 'created', 'completed']),
    state: z.enum(['prepared', 'partial', 'completed', 'failed']), failureReason: z.string().max(128).optional(),
}).strict();
export function cloneSaveReceipt(value: unknown): SaveReceipt {
    const parsed = receiptSchema.parse(value);
    if (parsed.id !== parsed.operationId) throw new Error('Save operation identity mismatch');
    const attachments = parsed.attachments.map((item): SaveAttachment => {
        const attachment = { ...item, ref: cloneImageRef(item.ref), sourcePath: validateImagePath(item.sourcePath),
            ...(item.plannedPath ? { plannedPath: validateImagePath(item.plannedPath) } : {}) };
        if (item.state === 'written' && (!item.plannedPath || item.writtenHash !== item.outputHash)) throw new Error('Incomplete attachment receipt');
        if (item.transfer && (item.attachmentKind !== 'original' || item.outputHash !== attachment.ref.contentHash)) throw new Error('Invalid original transfer plan');
        if (item.transfer === 'reference' && item.plannedPath && item.plannedPath !== item.sourcePath) throw new Error('Reference path changed');
        return attachment;
    });
    if (new Set(attachments.flatMap((a) => a.plannedPath ? [a.plannedPath] : [])).size !== attachments.filter((a) => a.plannedPath).length) {
        throw new Error('Duplicate attachment paths');
    }
    if (parsed.state === 'completed' && (parsed.noteState !== 'completed' || !parsed.finalNoteHash
        || parsed.noteContentHash !== parsed.finalNoteHash || attachments.some((a) => a.state !== 'written'))) throw new Error('Incomplete save receipt');
    return { ...parsed, targetNotePath: validateImagePath(parsed.targetNotePath), attachments };
}
export function assertSaveReceiptUpdate(previous: SaveReceipt, next: SaveReceipt): void {
    const immutable = (receipt: SaveReceipt) => ({ id: receipt.id, operationId: receipt.operationId,
        writingVersionId: receipt.writingVersionId, textHash: receipt.textHash, targetNotePath: receipt.targetNotePath,
        origin: receipt.origin, createdAt: receipt.createdAt, initialNoteHash: receipt.initialNoteHash,
        attachments: receipt.attachments.map(({ plannedPath: _p, writtenHash: _w, state: _s, ...frozen }) => frozen) });
    if (JSON.stringify(immutable(previous)) !== JSON.stringify(immutable(next))) throw new Error('Frozen save plan changed');
    previous.attachments.forEach((old, i) => {
        if ((old.plannedPath && old.plannedPath !== next.attachments[i].plannedPath)
            || (old.writtenHash && old.writtenHash !== next.attachments[i].writtenHash)) throw new Error('Frozen attachment plan changed');
    });
    if (previous.finalNoteHash && previous.finalNoteHash !== next.finalNoteHash) throw new Error('Frozen note plan changed');
    if (previous.state === 'completed' && JSON.stringify(previous) !== JSON.stringify(next)) throw new Error('Completed save receipt is immutable');
}

import { parseLinktext, type MetadataCache } from "obsidian";
import type {
    NoteImageRemovalAttachmentFile,
    NoteImageRemovalHost,
    NoteImageRemovalSourceFile,
} from "./note-image-removal";

interface FileLike {
    path: string;
    extension?: string;
    stat?: { mtime?: unknown; size?: unknown };
}

export interface ObsidianNoteImageHostOptions {
    readonly app: unknown;
    readonly isPathAllowed: (path: string) => boolean;
    readonly isAttachmentPathAllowed: (path: string) => boolean;
}

export function createObsidianNoteImageHost(options: ObsidianNoteImageHostOptions): NoteImageRemovalHost {
    const app = options.app as {
        vault: {
            getFiles(): unknown[];
            getAbstractFileByPath(path: string): unknown;
            read(file: unknown): Promise<string>;
            readBinary(file: unknown): Promise<ArrayBuffer>;
            createBinary(path: string, bytes: ArrayBuffer): Promise<unknown>;
        };
        metadataCache: Pick<MetadataCache, "getFirstLinkpathDest">;
    };
    const asFile = (value: unknown): FileLike | null => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        const file = value as FileLike;
        return typeof file.path === "string" && file.path ? file : null;
    };
    const sourceIdentity = (candidate: unknown): NoteImageRemovalSourceFile | null => {
        const file = asFile(candidate);
        if (!file || !/\.(md|canvas)$/i.test(file.path)
            || (file.extension !== undefined && file.extension.toLowerCase() !== file.path.split(".").pop()?.toLowerCase())) {
            return null;
        }
        const version = validVersion(file);
        if (!version) return null;
        return {
            path: file.path,
            extension: file.extension?.toLowerCase() === "canvas" || file.path.toLowerCase().endsWith(".canvas")
                ? "canvas"
                : "md",
            file,
            version,
        };
    };
    const attachmentIdentity = (candidate: unknown): NoteImageRemovalAttachmentFile | null => {
        const file = asFile(candidate);
        const version = file && validVersion(file);
        if (!file || !version || !file.extension) return null;
        return { path: file.path, extension: file.extension, file, version };
    };
    const exactSource = (path: string) => {
        try {
            return sourceIdentity(app.vault.getAbstractFileByPath(path));
        } catch {
            return undefined;
        }
    };
    const exactAttachment = (path: string) => {
        try {
            return attachmentIdentity(app.vault.getAbstractFileByPath(path));
        } catch {
            return undefined;
        }
    };

    return {
        getSourceFile: exactSource,
        listSourceFiles: () => {
            try {
                return app.vault.getFiles().flatMap(file => {
                    const identity = sourceIdentity(file);
                    return identity ? [identity] : [];
                });
            } catch {
                return undefined;
            }
        },
        readSourceFile: async file => await app.vault.read(file.file),
        parseLinktext,
        resolveImageDestination: (linkpath, sourcePath) => {
            try {
                return attachmentIdentity(app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath));
            } catch {
                return undefined;
            }
        },
        isPathAllowed: path => options.isPathAllowed(path),
        isAttachmentPathAllowed: path => options.isAttachmentPathAllowed(path),
        readAttachmentFile: async file => await app.vault.readBinary(file.file),
        getAttachmentFileByPath: exactAttachment,
        restoreAttachmentFile: async (file, bytes) => {
            const created = await app.vault.createBinary(file.path, bytes);
            return exactAttachment(asFile(created)?.path ?? file.path);
        },
    };
}

function validVersion(file: FileLike): { mtime: number; size: number } | null {
    const mtime = file.stat?.mtime;
    const size = file.stat?.size;
    if (!Number.isFinite(mtime) || (mtime as number) < 0
        || !Number.isInteger(size) || (size as number) < 0) return null;
    return { mtime: mtime as number, size: size as number };
}

import type { GhostPublishingSourceFile } from "./types";

export interface GhostRequestedTarget { path?: string; name?: string }

export class GhostEntryError extends Error {
    constructor(readonly code: "request-required" | "target-missing" | "target-ambiguous") {
        super(`Ghost publishing entry: ${code}.`);
        this.name = "GhostEntryError";
    }
}

export function parseGhostCommand(value: string): string | null {
    const match = /^\s*@blog2ghost(?:\s+([\s\S]*))?\s*$/i.exec(value);
    return match ? (match[1] ?? "").trim() : null;
}

/** Target semantics belong to the Agent; this boundary verifies the submitted vault target. */
export function resolveGhostRequestedNote(options: {
    input: GhostRequestedTarget;
    userText: string;
    capturedPath: string;
    host: {
        getAbstractFileByPath(path: string): GhostPublishingSourceFile | null;
        getMarkdownFiles(): GhostPublishingSourceFile[];
        getFirstLinkpathDest(linkpath: string, sourcePath: string): GhostPublishingSourceFile | null;
    };
}): string {
    const request = parseGhostCommand(options.userText);
    if (request === null) throw new GhostEntryError("request-required");
    const { path, name } = options.input;
    if (path && name) throw new GhostEntryError("target-ambiguous");
    const explicit = path ?? name;
    if (!explicit) {
        const file = options.host.getAbstractFileByPath(options.capturedPath);
        if (file?.extension !== "md") throw new GhostEntryError("target-missing");
        return file.path;
    }
    if (explicit.startsWith("/") || explicit.includes("\\") || explicit.includes(String.fromCharCode(0))
        || explicit.split("/").some(part => part === ".." || part === "." || !part)) {
        throw new GhostEntryError("target-missing");
    }
    if (path) {
        const file = options.host.getAbstractFileByPath(path.endsWith(".md") ? path : `${path}.md`);
        if (file?.extension !== "md") throw new GhostEntryError("target-missing");
        return file.path;
    }
    const baseName = name!.replace(/\.md$/, "");
    const matches = options.host.getMarkdownFiles().filter(file => file.basename === baseName
        || file.path.replace(/\.md$/, "") === baseName);
    if (matches.length > 1) throw new GhostEntryError("target-ambiguous");
    if (matches.length !== 1) throw new GhostEntryError("target-missing");
    const resolved = options.host.getFirstLinkpathDest(name!, options.capturedPath);
    if (resolved?.path !== matches[0].path) throw new GhostEntryError("target-ambiguous");
    return resolved.path;
}

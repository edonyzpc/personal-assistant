import type { GhostPublishingSourceFile } from "./types";

export interface GhostRequestedTarget { path?: string; name?: string }

export class GhostEntryError extends Error {
    constructor(readonly code: "request-required" | "target-not-requested" | "target-missing" | "target-ambiguous") {
        super(`Ghost publishing entry: ${code}.`);
        this.name = "GhostEntryError";
    }
}

export function parseGhostCommand(value: string): string | null {
    const match = /^\s*@blog2ghost(?:\s+([\s\S]*))?\s*$/i.exec(value);
    return match ? (match[1] ?? "").trim() : null;
}

function mentionsCompleteTarget(request: string, target: string): boolean {
    // A model-supplied name must be a complete reference, not part of prose or
    // another vault path. Treat quoted/wiki names containing spaces as a whole.
    const references = /\[\[([^\]\n]+)\]\]|`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)'|“([^”\n]+)”|‘([^’\n]+)’|「([^」\n]+)」|『([^』\n]+)』/gu;
    let exactReference = false;
    const plainRequest = request.replace(references, (whole: string, ...groups: unknown[]) => {
        const wiki = groups[0] as string | undefined;
        const reference = wiki === undefined
            ? groups.slice(1, 8).find(value => typeof value === "string") as string | undefined
            : wiki.split(/[|#]/, 1)[0];
        if (reference === target) exactReference = true;
        return " ".repeat(whole.length);
    });
    if (exactReference) return true;
    const targetCharacter = /[\p{L}\p{M}\p{N}_./\\-]/u;
    let offset = plainRequest.indexOf(target);
    while (offset >= 0) {
        const before = plainRequest.slice(0, offset).at(-1);
        const after = plainRequest.slice(offset + target.length).at(0);
        if ((!before || !targetCharacter.test(before)) && (!after || !targetCharacter.test(after))) return true;
        offset = plainRequest.indexOf(target, offset + target.length);
    }
    return false;
}

/** The model may locate a user-named note, but cannot replace the captured current note. */
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
    if (explicit && !mentionsCompleteTarget(request, explicit)) throw new GhostEntryError("target-not-requested");
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

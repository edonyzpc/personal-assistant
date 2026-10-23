/** Versioned pure data retained on the assistant message; never runtime authority. */
export interface CanvasArtifactRecord {
    version: 1;
    /** Assigned once by the shared Canvas artifact service, not by a view. */
    id: string;
    block: {
        language: string;
        startLine: number;
        sourceHash: string;
        occurrence: number;
    };
    save?: {
        operationId: string;
        phase: "pending" | "saved";
        path: string;
        sourceHash: string;
    };
}

export interface CanvasArtifactUpdateBinding {
    conversationId: string;
    turnIndex: number;
    assistantMessageId?: string;
    /** Required for legacy messages without a Host assistant identity. */
    userMessageSourceHash?: string;
    /** Hash of the complete assistant body, used to reject stale whole-turn writers. */
    messageSourceHash: string;
}

const CANVAS_HASH_RE = /^[0-9a-f]{8}$/;

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return Object.keys(value).every(key => keys.includes(key));
}

function parseSave(value: unknown): CanvasArtifactRecord["save"] | null {
    if (value === undefined) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const save = value as Record<string, unknown>;
    if (!exactKeys(save, ["operationId", "phase", "path", "sourceHash"])
        || typeof save.operationId !== "string" || !save.operationId
        || (save.phase !== "pending" && save.phase !== "saved")
        || typeof save.path !== "string" || !save.path
        || typeof save.sourceHash !== "string" || !CANVAS_HASH_RE.test(save.sourceHash)) return null;
    return {
        operationId: save.operationId,
        phase: save.phase,
        path: save.path,
        sourceHash: save.sourceHash,
    };
}

/** Returns a defensive copy, or null when the persisted envelope must remain unconfirmed. */
export function parseCanvasArtifacts(value: unknown): CanvasArtifactRecord[] | null {
    if (!Array.isArray(value)) return null;
    const records: CanvasArtifactRecord[] = [];
    const ids = new Set<string>();
    const startLines = new Set<number>();
    const occurrences = new Set<string>();
    for (const item of value) {
        if (!item || typeof item !== "object" || Array.isArray(item)) return null;
        const record = item as Record<string, unknown>;
        const block = record.block;
        if (!exactKeys(record, ["version", "id", "block", "save"])
            || record.version !== 1
            || typeof record.id !== "string" || !record.id
            || !block || typeof block !== "object" || Array.isArray(block)
            || !exactKeys(block as Record<string, unknown>, ["language", "startLine", "sourceHash", "occurrence"])
            || typeof (block as Record<string, unknown>).language !== "string"
            || !(block as Record<string, unknown>).language
            || !Number.isSafeInteger((block as Record<string, unknown>).startLine)
            || (block as Record<string, unknown>).startLine as number < 0
            || !Number.isSafeInteger((block as Record<string, unknown>).occurrence)
            || (block as Record<string, unknown>).occurrence as number < 0
            || typeof (block as Record<string, unknown>).sourceHash !== "string"
            || !CANVAS_HASH_RE.test((block as Record<string, unknown>).sourceHash as string)) return null;
        const save = parseSave(record.save);
        if (save === null) return null;
        const parsedBlock = block as CanvasArtifactRecord["block"];
        const occurrenceKey = JSON.stringify([parsedBlock.language, parsedBlock.sourceHash, parsedBlock.occurrence]);
        if (ids.has(record.id) || startLines.has(parsedBlock.startLine) || occurrences.has(occurrenceKey)
            || (save && save.sourceHash !== parsedBlock.sourceHash)) return null;
        ids.add(record.id);
        startLines.add(parsedBlock.startLine);
        occurrences.add(occurrenceKey);
        records.push({
            version: 1,
            id: record.id,
            block: {
                language: parsedBlock.language,
                startLine: parsedBlock.startLine,
                sourceHash: parsedBlock.sourceHash,
                occurrence: parsedBlock.occurrence,
            },
            ...(save ? { save } : {}),
        });
    }
    return records;
}

export function cloneCanvasArtifacts(value: readonly CanvasArtifactRecord[]): CanvasArtifactRecord[] {
    const parsed = parseCanvasArtifacts(value);
    if (!parsed) throw new Error("Invalid Canvas artifact records.");
    return parsed;
}

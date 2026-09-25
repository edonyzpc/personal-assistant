/** Host-owned Chat source choice. This is metadata, not a capability token. */
export type ChatSourceScope = 'notes' | 'web' | 'combined';

export interface ConversationSourceSelection {
    schemaVersion: 1;
    scope: ChatSourceScope;
    revision: number;
    basis: 'new-conversation' | 'user' | 'legacy-host-config' | 'conservative-fallback';
}

export interface RunSourceSelection {
    readonly schemaVersion: 1;
    readonly scope: ChatSourceScope;
    readonly selectionId: string;
    readonly persistedSelectionRevision?: number;
    readonly userMessageId: string;
}

export function isChatSourceScope(value: unknown): value is ChatSourceScope {
    return value === 'notes' || value === 'web' || value === 'combined';
}

export function parseConversationSourceSelection(value: unknown): ConversationSourceSelection | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const selection = value as Record<string, unknown>;
    if (selection.schemaVersion !== 1 || !isChatSourceScope(selection.scope)
        || !Number.isSafeInteger(selection.revision) || (selection.revision as number) < 0
        || !['new-conversation', 'user', 'legacy-host-config', 'conservative-fallback'].includes(String(selection.basis))) {
        return undefined;
    }
    return {
        schemaVersion: 1,
        scope: selection.scope,
        revision: selection.revision as number,
        basis: selection.basis as ConversationSourceSelection['basis'],
    };
}

export function parseRunSourceSelection(value: unknown): RunSourceSelection | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const selection = value as Record<string, unknown>;
    if (selection.schemaVersion !== 1 || !isChatSourceScope(selection.scope)
        || typeof selection.selectionId !== 'string' || !selection.selectionId.trim() || selection.selectionId.length > 256
        || typeof selection.userMessageId !== 'string' || !selection.userMessageId.trim() || selection.userMessageId.length > 256
        || (selection.persistedSelectionRevision !== undefined
            && (!Number.isSafeInteger(selection.persistedSelectionRevision)
                || (selection.persistedSelectionRevision as number) < 0))) return undefined;
    return {
        schemaVersion: 1,
        scope: selection.scope,
        selectionId: selection.selectionId,
        userMessageId: selection.userMessageId,
        ...(selection.persistedSelectionRevision !== undefined
            ? { persistedSelectionRevision: selection.persistedSelectionRevision as number } : {}),
    };
}

export function newConversationSourceSelection(): ConversationSourceSelection {
    return { schemaVersion: 1, scope: 'notes', revision: 0, basis: 'new-conversation' };
}

/** A legacy record alone cannot prove its old Web authority. */
export function conservativeLegacySourceSelection(): ConversationSourceSelection {
    return { schemaVersion: 1, scope: 'notes', revision: 0, basis: 'conservative-fallback' };
}

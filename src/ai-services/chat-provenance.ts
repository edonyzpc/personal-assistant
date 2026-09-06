/** Host-created evidence class. Model output must never supply or upgrade this authority. */
export interface ChatHostProvenance {
    version: 1;
    messageId: string;
    kind: "ordinary_user_statement" | "ai_draft" | "user_local_edit" | "writing_request" | "explicit_style_action";
}

const PROVENANCE_KINDS = new Set<ChatHostProvenance["kind"]>([
    "ordinary_user_statement", "ai_draft", "user_local_edit", "writing_request", "explicit_style_action",
]);

/** Invalid new evidence must not become an unmarked legacy user statement. */
export function cloneChatHostProvenance(value: unknown): ChatHostProvenance {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Chat provenance");
    const record = value as Record<string, unknown>;
    if (record.version !== 1 || typeof record.messageId !== "string"
        || record.messageId.length === 0 || record.messageId.length > 128
        || !PROVENANCE_KINDS.has(record.kind as ChatHostProvenance["kind"])) throw new Error("Invalid Chat provenance");
    return { version: 1, messageId: record.messageId, kind: record.kind as ChatHostProvenance["kind"] };
}

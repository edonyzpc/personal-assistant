import type {
    SourceDisplayChip,
    SourceRecord,
    SourceRecordKind,
} from "./chat-types";

export interface SourceRecordInput extends Omit<SourceRecord, "dedupKey"> {
    dedupKey?: string;
}

const MAX_SOURCE_TITLE_CHARS = 160;
const MAX_SOURCE_SNIPPET_CHARS = 500;
const SECRET_QUERY_PARAM = /(?:api[_-]?key|token|secret|signature|authorization|access[_-]?token|refresh[_-]?token)/i;
const HTML_TAG_PATTERN = /<[^>]*>/g;

export class SourceStore {
    private readonly records: SourceRecord[] = [];

    constructor(records: readonly SourceRecordInput[] = []) {
        records.forEach((record) => this.add(record));
    }

    add(input: SourceRecordInput): SourceRecord | null {
        const normalized = normalizeSourceRecord(input);
        if (!normalized) return null;
        this.records.push(normalized);
        return normalized;
    }

    all(): SourceRecord[] {
        return this.records.map(cloneSourceRecord);
    }

    query(kind: SourceRecordKind): SourceRecord[] {
        return this.records.filter((record) => record.kind === kind).map(cloneSourceRecord);
    }

    getCitations(): SourceRecord[] {
        return this.records
            .filter((record) => record.kind === "memory-reference" || record.kind === "web-source")
            .filter((record) => record.citationEligible !== false)
            .map(cloneSourceRecord);
    }

    getDisplayChips(): SourceDisplayChip[] {
        const grouped = new Map<string, SourceRecord[]>();
        for (const record of this.records) {
            grouped.set(record.dedupKey, [...(grouped.get(record.dedupKey) ?? []), record]);
        }
        return [...grouped.entries()].map(([dedupKey, records]) => ({
            dedupKey,
            label: getChipLabel(records[0]),
            kinds: [...new Set(records.map((record) => record.kind))],
            citationEligible: records.some((record) => record.citationEligible === true),
            records: records.map(cloneSourceRecord),
        }));
    }
}

export function normalizeSourceRecord(input: SourceRecordInput): SourceRecord | null {
    const title = normalizeSourceText(input.title, MAX_SOURCE_TITLE_CHARS);
    const snippet = normalizeSourceText(input.snippet, MAX_SOURCE_SNIPPET_CHARS);
    const webUrl = input.kind === "web-source" && input.url
        ? sanitizeWebSourceUrl(input.url)
        : input.url;
    if (input.kind === "web-source" && !webUrl) {
        return null;
    }
    const locator = webUrl ?? input.path ?? title ?? input.kind;
    const dedupKey = input.dedupKey ?? createSourceDedupKey(locator);
    const citationEligible = input.citationEligible ?? (input.kind === "memory-reference" || input.kind === "web-source");

    return {
        ...input,
        dedupKey,
        ...(title ? { title } : {}),
        ...(snippet ? { snippet } : {}),
        ...(webUrl ? { url: webUrl } : {}),
        citationEligible,
        redacted: input.redacted === true || webUrl !== input.url,
        statusOnly: input.statusOnly ?? false,
    };
}

export function sanitizeWebSourceUrl(rawUrl: string): string | null {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return null;
    }
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
        if (SECRET_QUERY_PARAM.test(key)) {
            url.searchParams.set(key, "REDACTED");
        }
    }
    return url.toString();
}

export function createSourceDedupKey(locator: string): string {
    let hash = 2166136261;
    for (let index = 0; index < locator.length; index++) {
        hash ^= locator.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `source:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeSourceText(value: string | undefined, maxChars: number): string | undefined {
    if (!value) return undefined;
    const plainText = value.replace(HTML_TAG_PATTERN, "").replace(/\s+/g, " ").trim();
    if (!plainText) return undefined;
    if (plainText.length <= maxChars) return plainText;
    return `${plainText.slice(0, Math.max(0, maxChars - 3))}...`;
}

function getChipLabel(record: SourceRecord | undefined): string {
    if (!record) return "Source";
    return record.title ?? record.path ?? record.url ?? record.capabilityName ?? record.kind;
}

function cloneSourceRecord(record: SourceRecord): SourceRecord {
    return {
        ...record,
        metadata: record.metadata ? { ...record.metadata } : undefined,
    };
}

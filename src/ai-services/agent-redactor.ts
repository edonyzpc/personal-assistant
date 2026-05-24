export interface AgentRedactor {
    redactText(value: string): string;
    redactUrl(value: string): string;
    redactHeaders(value: Record<string, string>): Record<string, string>;
    redactJson(value: unknown): unknown;
}

export interface DefaultAgentRedactorOptions {
    secretValues?: readonly string[];
    secretQueryParams?: readonly string[];
    secretHeaderNames?: readonly string[];
    secretJsonKeys?: readonly string[];
}

export const REDACTED_VALUE = "[REDACTED]";

const DEFAULT_SECRET_QUERY_PARAMS = [
    "api_key",
    "apikey",
    "access_key",
    "access_token",
    "authorization",
    "key",
    "secret",
    "signature",
    "sig",
    "token",
];

const DEFAULT_SECRET_HEADER_NAMES = [
    "api-key",
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "x-dashscope-api-key",
];

const DEFAULT_SECRET_JSON_KEYS = [
    "apiKey",
    "api_key",
    "accessKey",
    "access_key",
    "accessToken",
    "access_token",
    "authorization",
    "key",
    "secret",
    "signature",
    "token",
];

export class DefaultAgentRedactor implements AgentRedactor {
    private readonly secretValues: string[];
    private readonly secretQueryParams: Set<string>;
    private readonly secretHeaderNames: Set<string>;
    private readonly secretJsonKeys: Set<string>;

    constructor(options: DefaultAgentRedactorOptions = {}) {
        this.secretValues = [...new Set((options.secretValues ?? [])
            .map((value) => value.trim())
            .filter((value) => value.length >= 4))];
        this.secretQueryParams = createNormalizedSet([
            ...DEFAULT_SECRET_QUERY_PARAMS,
            ...(options.secretQueryParams ?? []),
        ]);
        this.secretHeaderNames = createNormalizedSet([
            ...DEFAULT_SECRET_HEADER_NAMES,
            ...(options.secretHeaderNames ?? []),
        ]);
        this.secretJsonKeys = createNormalizedSet([
            ...DEFAULT_SECRET_JSON_KEYS,
            ...(options.secretJsonKeys ?? []),
        ]);
    }

    redactText(value: string): string {
        let redacted = value;
        for (const secret of this.secretValues) {
            redacted = redacted.split(secret).join(REDACTED_VALUE);
        }
        redacted = redacted.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/g, `Bearer ${REDACTED_VALUE}`);
        redacted = redacted.replace(/\b(sk|ak)-[A-Za-z0-9._~+/=-]{8,}\b/gi, `${REDACTED_VALUE}`);
        return redacted;
    }

    redactUrl(value: string): string {
        try {
            const url = new URL(this.redactText(value));
            if (url.username) url.username = REDACTED_VALUE;
            if (url.password) url.password = REDACTED_VALUE;
            url.hash = "";
            for (const key of [...url.searchParams.keys()]) {
                if (this.secretQueryParams.has(normalizeKey(key))) {
                    url.searchParams.set(key, REDACTED_VALUE);
                }
            }
            return url.toString();
        } catch {
            return this.redactText(value);
        }
    }

    redactHeaders(value: Record<string, string>): Record<string, string> {
        return Object.fromEntries(Object.entries(value).map(([key, headerValue]) => [
            key,
            this.secretHeaderNames.has(normalizeKey(key))
                ? REDACTED_VALUE
                : this.redactText(headerValue),
        ]));
    }

    redactJson(value: unknown): unknown {
        if (typeof value === "string") {
            return this.redactText(value);
        }
        if (Array.isArray(value)) {
            return value.map((entry) => this.redactJson(entry));
        }
        if (!value || typeof value !== "object") {
            return value;
        }
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
            key,
            this.secretJsonKeys.has(normalizeKey(key)) ? REDACTED_VALUE : this.redactJson(entry),
        ]));
    }
}

function createNormalizedSet(values: readonly string[]): Set<string> {
    return new Set(values.map(normalizeKey).filter(Boolean));
}

function normalizeKey(value: string): string {
    return value.trim().toLowerCase().replace(/[-_\s]+/g, "");
}

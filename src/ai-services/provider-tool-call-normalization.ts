export interface NormalizedProviderToolCall {
    id?: string;
    index?: number;
    /** Local ordering for complete invoke items that carry no provider coordinate. */
    order?: number;
    name?: string;
    args?: unknown;
    /** Invalid complete parsed arguments or an SDK-reported invalid invoke call. */
    invalidInput?: true;
    /** Unchanged SDK fields for strict native-output identity admission. */
    providerIdentity: { id?: unknown; index?: unknown; name?: unknown };
}

export interface NormalizedProviderToolCalls {
    /** The value's authoritative SDK representation, independent of transport method. */
    kind: 'fragments' | 'complete';
    calls: NormalizedProviderToolCall[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function array(value: unknown): unknown[] | undefined {
    return Array.isArray(value) ? value : undefined;
}

function nestedArray(value: unknown, key: string): unknown[] | undefined {
    return array(asRecord(value)?.[key]);
}

function providerId(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function providerIndex(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function normalize(
    value: unknown,
    order: number,
    argumentRepresentation: 'parsed' | 'raw',
): NormalizedProviderToolCall {
    const record = asRecord(value);
    const functionRecord = asRecord(record?.function);
    const id = providerId(record?.id);
    const index = providerIndex(record?.index);
    const directName = typeof record?.name === 'string' && record.name.trim() ? record.name : undefined;
    const nestedName = typeof functionRecord?.name === 'string' && functionRecord.name.trim()
        ? functionRecord.name : undefined;
    const args = record?.args !== undefined ? record.args
        : record?.arguments !== undefined ? record.arguments
        : functionRecord?.arguments;
    const parsedArgsInvalid = argumentRepresentation === 'parsed'
        && record?.args !== undefined && asRecord(record.args) === undefined;
    const invalidInput = record?.type === 'invalid_tool_call' || parsedArgsInvalid;
    return {
        ...(id ? { id } : {}),
        ...(index !== undefined ? { index } : {}),
        ...(id === undefined && index === undefined ? { order } : {}),
        ...(directName ?? nestedName ? { name: directName ?? nestedName } : {}),
        ...(args !== undefined ? { args } : {}),
        ...(invalidInput ? { invalidInput: true as const } : {}),
        providerIdentity: { id: record?.id, index: record?.index, name: record?.name ?? functionRecord?.name },
    };
}

/**
 * Selects the value's authoritative SDK representation. A `stream()` value may
 * carry either fragments or one complete result (BaseChatModel.stream delegates
 * to invoke for disableStreaming), while explicit invoke always consumes the
 * complete representation.
 */
export function normalizeProviderToolCalls(
    value: unknown,
    source: 'stream' | 'invoke',
): NormalizedProviderToolCalls | undefined {
    const record = asRecord(value);
    if (!record) return undefined;

    if (source === 'stream') {
        const streamChunks = array(record.tool_call_chunks)
            ?? nestedArray(record.additional_kwargs, 'tool_call_chunks');
        if (streamChunks) {
            return {
                kind: 'fragments',
                calls: streamChunks.map((call, order) => normalize(call, order, 'raw')),
            };
        }
    }

    const validCalls = array(record.tool_calls);
    const invalidCalls = array(record.invalid_tool_calls);
    if (validCalls || invalidCalls) {
        const completeCalls = [
            ...(validCalls ?? []),
            ...(invalidCalls ?? []),
        ];
        return {
            kind: 'complete',
            calls: completeCalls.map((call, order) => normalize(call, order, 'parsed')),
        };
    }

    const rawCalls = nestedArray(record.additional_kwargs, 'tool_calls');
    if (rawCalls?.length) {
        return { kind: 'complete', calls: rawCalls.map((call, order) => normalize(call, order, 'raw')) };
    }

    return undefined;
}

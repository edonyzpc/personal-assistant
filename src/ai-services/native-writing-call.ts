import type { PaAgentModelStreamChunk } from "./pa-agent-types";
import { decodeNativeWritingOutput, isValidWritingContextHandle, type NativeWritingOutput } from "./writing-output";

type ToolCallDelta = Extract<PaAgentModelStreamChunk, { type: "toolcall_delta" }>;
const WRITING_TOOL_NAME = "present_writing";

/**
 * Accumulates one provider-identified output call. It owns neither permission
 * nor provider completion: a decoded value is still only a host candidate.
 * Feed every tool delta in the assistant turn, including non-writing calls.
 */
export class NativeWritingCallCollector {
    private rejected = false;
    private sawWritingCall = false;
    private observedNamePrefix = "";
    private namePrefix = "";
    private callId?: string;
    private callIndex?: number;
    private argumentText = "";
    private hasRawArguments = false;
    private structuredText?: string;
    private structuredOutput?: NativeWritingOutput;

    constructor(private readonly contextHandle: string, private readonly maxTextChars: number) {
        if (!isValidWritingContextHandle(contextHandle)
            || !Number.isSafeInteger(maxTextChars) || maxTextChars <= 0) this.reject();
    }

    /** Remains true after rejection, so a mixed batch cannot fall back to execution. */
    get hasWritingCall(): boolean { return this.sawWritingCall; }

    /** A writing call was observed and has valid identity; name/args may be partial. */
    get isCandidate(): boolean {
        return !this.rejected && this.sawWritingCall
            && (this.callId !== undefined || this.callIndex !== undefined);
    }

    /** Verified coordinates only; an incomplete name does not grant output permission. */
    get providerIdentity(): { id?: string; index?: number } | undefined {
        if (this.rejected || (this.callId === undefined && this.callIndex === undefined)) return undefined;
        return { id: this.callId, index: this.callIndex };
    }

    /** Rejected identity/batch data is never exposed as a recoverable preview. */
    get rawArguments(): string {
        if (this.rejected) return "";
        return this.hasRawArguments ? this.argumentText : this.structuredText ?? "";
    }

    consume(chunk: ToolCallDelta): void {
        try {
            this.observeWritingCall(chunk);
            if (this.rejected) return;
            const identity = chunk.providerIdentity;
            if (!identity || typeof identity !== "object" || Array.isArray(identity)) return this.reject();
            // LangChain emits null-id empty closing chunks for an already
            // indexed call. Null means omitted, never a new identity/permission.
            const id = identity.id ?? undefined;
            const index = identity.index ?? undefined;
            const name = identity.name ?? undefined;
            if ((id !== undefined && (typeof id !== "string" || !id || id.trim() !== id
                || [...id].some((character) => character.charCodeAt(0) < 0x20 || character.charCodeAt(0) === 0x7f)))
                || (index !== undefined && (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0))
                || (name !== undefined && typeof name !== "string")) return this.reject();

            if (!this.acceptIdentity(id as string | undefined, index as number | undefined)) return this.reject();
            if (name) {
                const nextName = extendWritingName(this.namePrefix, name);
                if (nextName === undefined) return this.reject();
                this.namePrefix = nextName;
            }
            // A resolved adapter name can expose a second call, but it cannot
            // establish the provider name or substitute for provider identity.
            if (chunk.name && chunk.name !== WRITING_TOOL_NAME && chunk.name !== this.namePrefix
                && chunk.name !== name) return this.reject();

            if (chunk.argsText !== undefined) {
                if (typeof chunk.argsText !== "string") return this.reject();
                if (chunk.argsText.length > 0) {
                    if (this.argumentText.length + chunk.argsText.length > this.maxTextChars) return this.reject();
                    this.hasRawArguments = true;
                    this.argumentText += chunk.argsText;
                }
            }
            if (chunk.input !== undefined) {
                const serialized = serializeWritingInput(chunk.input, this.maxTextChars);
                if (serialized === undefined) return this.reject();
                const output = decodeNativeWritingOutput(serialized, this.contextHandle, this.maxTextChars);
                if (!output || (this.structuredOutput && !sameOutput(this.structuredOutput, output))) return this.reject();
                this.structuredText ??= serialized;
                this.structuredOutput ??= output;
            }
            // Matching structured mirrors are allowed, but they must never
            // replace an incomplete or malformed raw argument stream.
            if (this.hasRawArguments && this.structuredOutput) this.decode();
        } catch {
            this.reject();
        }
    }

    decode(): NativeWritingOutput | undefined {
        if (!this.isCandidate || this.namePrefix !== WRITING_TOOL_NAME) return undefined;
        const output = decodeNativeWritingOutput(this.rawArguments, this.contextHandle, this.maxTextChars);
        if (output && this.structuredOutput && !sameOutput(output, this.structuredOutput)) {
            this.reject();
            return undefined;
        }
        return output;
    }

    private acceptIdentity(id: string | undefined, index: number | undefined): boolean {
        const established = this.callId !== undefined || this.callIndex !== undefined;
        if (!established) {
            if (id === undefined && index === undefined) return false;
        } else {
            if ((id !== undefined && this.callId !== undefined && id !== this.callId)
                || (index !== undefined && this.callIndex !== undefined && index !== this.callIndex)) return false;
            // Introducing another coordinate needs an existing shared anchor.
            // Otherwise an id-only call followed by an unrelated index-only
            // call would silently become one output.
            if (id !== undefined && this.callId === undefined && index !== this.callIndex) return false;
            if (index !== undefined && this.callIndex === undefined && id !== this.callId) return false;
        }
        this.callId ??= id;
        this.callIndex ??= index;
        return true;
    }

    private observeWritingCall(chunk: ToolCallDelta): void {
        if (chunk.name === WRITING_TOOL_NAME || chunk.providerIdentity?.name === WRITING_TOOL_NAME) {
            this.sawWritingCall = true;
        }
        const name = chunk.providerIdentity?.name;
        if (typeof name !== "string" || !name) return;
        const prefix = extendWritingName(this.observedNamePrefix, name)
            ?? extendWritingName("", name);
        if (prefix === undefined) return;
        this.observedNamePrefix = prefix;
        if (prefix === WRITING_TOOL_NAME) this.sawWritingCall = true;
    }

    private reject(): void {
        this.rejected = true;
        this.argumentText = "";
        this.structuredText = undefined;
        this.structuredOutput = undefined;
    }
}

/** Accept repeated/cumulative names and true name fragments for this one tool. */
function extendWritingName(current: string, fragment: string): string | undefined {
    if (fragment === current) return current;
    if (fragment.startsWith(current) && WRITING_TOOL_NAME.startsWith(fragment)) return fragment;
    const appended = current + fragment;
    return WRITING_TOOL_NAME.startsWith(appended) ? appended : undefined;
}

function sameOutput(left: NativeWritingOutput, right: NativeWritingOutput): boolean {
    return left.body === right.body && left.explanation === right.explanation;
}

/** Do not let JSON.stringify discard fields or invoke a provider object's code. */
function serializeWritingInput(input: unknown, maxTextChars: number): string | undefined {
    if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const record: Record<string, string> = Object.create(null);
    let textChars = 0;
    for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== "string" || !["contextHandle", "body", "explanation"].includes(key)) return undefined;
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor?.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string") return undefined;
        textChars += descriptor.value.length;
        if (textChars > maxTextChars) return undefined;
        record[key] = descriptor.value;
    }
    const serialized = JSON.stringify(record);
    return serialized.length <= maxTextChars ? serialized : undefined;
}

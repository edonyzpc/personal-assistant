import { NativeWritingCallCollector } from "../src/ai-services/native-writing-call";
import type { PaAgentModelStreamChunk } from "../src/ai-services/pa-agent-types";

type ToolCallDelta = Extract<PaAgentModelStreamChunk, { type: "toolcall_delta" }>;
const handle = "context_123";
const input = { contextHandle: handle, body: "  第一行\nSecond line 🐈  ", explanation: "说明" };
const raw = JSON.stringify(input);
const budget = 1_000;

function delta(overrides: Partial<ToolCallDelta> = {}): ToolCallDelta {
    return { type: "toolcall_delta", name: "present_writing", id: "synthetic_call", index: 99,
        providerIdentity: { id: "provider_call", index: 0, name: "present_writing" }, ...overrides };
}

function expectRejected(collector: NativeWritingCallCollector): void {
    expect(collector.isCandidate).toBe(false);
    expect(collector.decode()).toBeUndefined();
    expect(collector.rawArguments).toBe("");
    collector.consume(delta({ argsText: raw }));
    expect(collector.hasWritingCall).toBe(true);
    expect(collector.isCandidate).toBe(false);
    expect(collector.decode()).toBeUndefined();
}

describe("NativeWritingCallCollector", () => {
    it("requires original identity and complete arguments, independently of provider completion", () => {
        const collector = new NativeWritingCallCollector(handle, budget);
        expect(collector.hasWritingCall).toBe(false);
        expect(collector.isCandidate).toBe(false);
        collector.consume(delta({ argsText: raw.slice(0, -1) }));
        expect(collector.hasWritingCall).toBe(true);
        expect(collector.isCandidate).toBe(true);
        expect(collector.decode()).toBeUndefined();
        collector.consume(delta({ providerIdentity: {}, argsText: raw.slice(-1) }));
        expect(collector.decode()).toEqual({ body: input.body, explanation: input.explanation });
        expect(collector.rawArguments).toBe(raw);
    });

    it("preserves every two-chunk boundary, escaped whitespace and surrogate pairs", () => {
        const encoded = '{"contextHandle":"context_123","body":"  A\\n\\t\\\"\\\\\\uD83D\\uDC08 Z  ","explanation":""}';
        for (let split = 0; split <= encoded.length; split++) {
            const collector = new NativeWritingCallCollector(handle, budget);
            collector.consume(delta({ argsText: encoded.slice(0, split) }));
            collector.consume(delta({ providerIdentity: {}, argsText: encoded.slice(split) }));
            expect(collector.rawArguments).toBe(encoded);
            expect(collector.decode()).toEqual({ body: "  A\n\t\"\\🐈 Z  ", explanation: "" });
        }
    });

    it.each([
        [{ id: "provider_call", name: "present_writing" }, { id: "provider_call", index: 0 }, { index: 0 }],
        [{ index: 0, name: "present_writing" }, { id: "provider_call", index: 0 }, { id: "provider_call" }],
    ])("adds an identity coordinate only through a matching original anchor", (first, second, third) => {
        const collector = new NativeWritingCallCollector(handle, budget);
        collector.consume(delta({ providerIdentity: first, argsText: raw.slice(0, 10) }));
        collector.consume(delta({ providerIdentity: second, argsText: raw.slice(10, 20) }));
        collector.consume(delta({ providerIdentity: third, argsText: raw.slice(20) }));
        expect(collector.decode()).toEqual({ body: input.body, explanation: input.explanation });
    });

    it.each([
        ["present_", "writing"],
        ["present_", "present_writing"],
        ["pre", "sent_", "writing"],
        ["present_", "present_", "writing"],
    ])("accepts partial or cumulative provider names: %j", (...names: string[]) => {
        const collector = new NativeWritingCallCollector(handle, budget);
        for (const name of names) {
            collector.consume(delta({ name, providerIdentity: { id: "provider_call", name } }));
        }
        collector.consume(delta({ providerIdentity: {}, argsText: raw }));
        expect(collector.hasWritingCall).toBe(true);
        expect(collector.isCandidate).toBe(true);
        expect(collector.decode()).toEqual({ body: input.body, explanation: input.explanation });
    });

    it("waits for a complete original name even when the adapter supplies a full name", () => {
        const collector = new NativeWritingCallCollector(handle, budget);
        collector.consume(delta({ providerIdentity: { id: "provider_call", name: "present_" }, argsText: raw }));
        expect(collector.hasWritingCall).toBe(true);
        expect(collector.isCandidate).toBe(true);
        expect(collector.decode()).toBeUndefined();
        collector.consume(delta({ providerIdentity: { name: "writing" } }));
        expect(collector.decode()).toEqual({ body: input.body, explanation: input.explanation });
    });

    it("allows an identified empty header before the provider supplies its name", () => {
        const collector = new NativeWritingCallCollector(handle, budget);
        collector.consume(delta({ name: "", providerIdentity: { index: 0 } }));
        expect(collector.isCandidate).toBe(false);
        collector.consume(delta({ providerIdentity: { index: 0, name: "present_writing" }, argsText: raw }));
        expect(collector.decode()?.body).toBe(input.body);
    });

    it.each([
        undefined, null, [], {}, { name: "present_writing" },
        { id: "", name: "present_writing" }, { id: "  id", name: "present_writing" },
        { id: "id\n", name: "present_writing" }, { id: null, index: null, name: "present_writing" },
        { id: 12, index: 0, name: "present_writing" }, { index: -1, name: "present_writing" },
        { index: 0.5, name: "present_writing" }, { index: Number.NaN, name: "present_writing" },
        { index: Number.POSITIVE_INFINITY, name: "present_writing" },
        { index: Number.MAX_SAFE_INTEGER + 1, name: "present_writing" },
        { index: "0", name: "present_writing" }, { id: null, index: null, name: null },
        { index: 0, name: "present_writing " },
    ])("permanently rejects missing or invalid raw identity: %j", (providerIdentity) => {
        const collector = new NativeWritingCallCollector(handle, budget);
        collector.consume(delta({ providerIdentity: providerIdentity as ToolCallDelta["providerIdentity"], argsText: raw }));
        expectRejected(collector);
    });

    it.each([
        { id: "different_call", index: 0 },
        { id: "provider_call", index: 1 },
        { name: "search_memory" },
        { name: "present_writing_other" },
        { name: "writing" },
    ])("rejects identity or name conflicts after a valid candidate: %j", (providerIdentity) => {
        const collector = new NativeWritingCallCollector(handle, budget);
        collector.consume(delta({ argsText: raw }));
        expect(collector.decode()).toBeDefined();
        collector.consume(delta({ providerIdentity }));
        expectRejected(collector);
    });

    it.each([
        [{ id: "provider_call", name: "present_writing" }, { index: 0 }],
        [{ index: 0, name: "present_writing" }, { id: "provider_call" }],
    ])("does not guess a link between disjoint raw identities", (first, second) => {
        const collector = new NativeWritingCallCollector(handle, budget);
        collector.consume(delta({ providerIdentity: first, argsText: raw.slice(0, 20) }));
        collector.consume(delta({ providerIdentity: second, argsText: raw.slice(20) }));
        expectRejected(collector);
    });

    it.each(["before", "after"])("rejects another tool %s the writing call", (order) => {
        const collector = new NativeWritingCallCollector(handle, budget);
        const other = delta({ name: "search_memory", providerIdentity: { id: "source_call", index: 1, name: "search_memory" }, argsText: "{}" });
        const writing = delta({ argsText: raw });
        for (const chunk of order === "before" ? [other, writing] : [writing, other]) collector.consume(chunk);
        expect(collector.hasWritingCall).toBe(true);
        expectRejected(collector);
    });

    it("observes a fragmented writing name even after another tool invalidated the batch", () => {
        const collector = new NativeWritingCallCollector(handle, budget);
        collector.consume(delta({ name: "search_memory", providerIdentity: { index: 1, name: "search_memory" } }));
        collector.consume(delta({ name: "present_", providerIdentity: { index: 0, name: "present_" } }));
        collector.consume(delta({ name: "writing", providerIdentity: { index: 0, name: "writing" } }));
        expect(collector.hasWritingCall).toBe(true);
        expectRejected(collector);
    });

    it("rejects a different resolved tool even when its raw name is omitted", () => {
        const collector = new NativeWritingCallCollector(handle, budget);
        collector.consume(delta({ argsText: raw }));
        collector.consume(delta({ name: "read_note", providerIdentity: {} }));
        expectRejected(collector);
    });

    it("does not trust synthetic adapter identity after raw capture disappears", () => {
        const collector = new NativeWritingCallCollector(handle, budget);
        collector.consume(delta({ argsText: raw.slice(0, 20) }));
        collector.consume(delta({ providerIdentity: undefined, argsText: raw.slice(20) }));
        expectRejected(collector);
    });

    it("accepts one complete structured value and identical mirrors without rewriting text", () => {
        const collector = new NativeWritingCallCollector(handle, budget);
        collector.consume(delta({ argsText: "", input }));
        collector.consume(delta({ providerIdentity: {}, input: { body: input.body, explanation: input.explanation, contextHandle: handle } }));
        expect(collector.rawArguments).toBe(raw);
        expect(collector.decode()).toEqual({ body: input.body, explanation: input.explanation });
    });

    it.each(["raw_first", "structured_first", "same_delta"])("accepts matching raw and structured values: %s", (order) => {
        const collector = new NativeWritingCallCollector(handle, budget);
        const encoded = raw.replace("第一", "\\u7b2c一");
        if (order === "same_delta") collector.consume(delta({ argsText: encoded, input }));
        else {
            const chunks = [delta({ argsText: encoded }), delta({ input })];
            for (const chunk of order === "raw_first" ? chunks : chunks.reverse()) collector.consume(chunk);
        }
        expect(collector.rawArguments).toBe(encoded);
        expect(collector.decode()?.body).toBe(input.body);
    });

    it.each(["raw_first", "structured_first", "same_delta"])("permanently rejects raw/structured conflicts: %s", (order) => {
        const collector = new NativeWritingCallCollector(handle, budget);
        const changed = { ...input, body: "different" };
        if (order === "same_delta") collector.consume(delta({ argsText: raw, input: changed }));
        else {
            const chunks = [delta({ argsText: raw }), delta({ input: changed })];
            for (const chunk of order === "raw_first" ? chunks : chunks.reverse()) collector.consume(chunk);
        }
        expectRejected(collector);
    });

    it("rejects replacement structured snapshots", () => {
        const collector = new NativeWritingCallCollector(handle, budget);
        collector.consume(delta({ input }));
        collector.consume(delta({ input: { ...input, body: "replacement" } }));
        expectRejected(collector);
    });

    it.each([raw.slice(0, -1), raw + "garbage", raw.replace("第一", "\\q"), raw.replace('"body":', '"body":"injected","body":')])(
        "never repairs malformed or partial raw JSON from a structured mirror: %s", (argsText) => {
            const collector = new NativeWritingCallCollector(handle, budget);
            collector.consume(delta({ argsText, input }));
            expect(collector.rawArguments).toBe(argsText);
            expect(collector.decode()).toBeUndefined();
        },
    );

    it.each([null, [], "text", {}, { ...input, extra: undefined }, { ...input, body: 42 }, { ...input, contextHandle: "other" }])(
        "rejects structured input that serialization could hide or change: %j", (value) => {
            const collector = new NativeWritingCallCollector(handle, budget);
            collector.consume(delta({ input: value }));
            expectRejected(collector);
        },
    );

    it("does not run accessors or toJSON while validating structured input", () => {
        const getter = jest.fn(() => input.body);
        const toJSON = jest.fn(() => input);
        const accessor = { contextHandle: handle, get body() { return getter(); } };
        for (const value of [accessor, { ...input, toJSON }, new Date()]) {
            const collector = new NativeWritingCallCollector(handle, budget);
            collector.consume(delta({ input: value }));
            expectRejected(collector);
        }
        expect(getter).not.toHaveBeenCalled();
        expect(toJSON).not.toHaveBeenCalled();
    });

    it("accepts null-prototype structured JSON data", () => {
        const collector = new NativeWritingCallCollector(handle, budget);
        collector.consume(delta({ input: Object.assign(Object.create(null), input) }));
        expect(collector.decode()?.body).toBe(input.body);
    });

    it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid budgets: %s", (limit) => {
        const collector = new NativeWritingCallCollector(handle, limit);
        collector.consume(delta({ argsText: raw }));
        expectRejected(collector);
    });

    it("applies the same raw-character limit to raw and serialized arguments", () => {
        for (const chunk of [delta({ argsText: raw }), delta({ input })]) {
            const exact = new NativeWritingCallCollector(handle, raw.length);
            exact.consume(chunk);
            expect(exact.decode()?.body).toBe(input.body);
            const small = new NativeWritingCallCollector(handle, raw.length - 1);
            small.consume(chunk);
            expectRejected(small);
        }
    });

    it("rejects a cumulative overflow permanently without retaining an unbounded string", () => {
        const collector = new NativeWritingCallCollector(handle, raw.length);
        collector.consume(delta({ argsText: raw }));
        expect(collector.decode()).toBeDefined();
        collector.consume(delta({ providerIdentity: {}, argsText: " " }));
        expectRejected(collector);
    });

    it.each(["", "invalid handle", "a".repeat(129)])("rejects invalid context handles: %s", (contextHandle) => {
        const collector = new NativeWritingCallCollector(contextHandle, budget);
        collector.consume(delta({ argsText: raw }));
        expectRejected(collector);
    });

    it("leaves mismatched handles and unfinished argument envelopes undecoded", () => {
        const collector = new NativeWritingCallCollector("different_handle", budget);
        collector.consume(delta({ argsText: raw }));
        expect(collector.decode()).toBeUndefined();
    });
});

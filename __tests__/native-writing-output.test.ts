import { describe, expect, it } from "@jest/globals";
import { decodeNativeWritingOutput } from "../src/ai-services/writing-output";
import protocolTrace from "./fixtures/b135-writing-protocol-trace.json";

const contextHandle = "b135-probe";
const body = '  Exact "text"\r\n\\path\t🙂\n  ';
const explanation = "  Explanation\n";
const args = { body, explanation, contextHandle };
const raw = JSON.stringify(args);
const decode = (text: string) => decodeNativeWritingOutput(text, contextHandle, 20_000);

describe("native writing complete argument boundary", () => {
    it("accepts the actual provider result without changing characters or adding authority", () => {
        const trace = protocolTrace.results.find((result) => result.mode === "native")!;
        expect(decode(trace.rawArguments)).toEqual({ body: trace.expected, explanation: "" });
    });

    it("preserves body and optional explanation regardless of key order", () => {
        for (const input of [args, { contextHandle, explanation, body }]) {
            expect(decode(JSON.stringify(input))).toEqual({ body, explanation });
        }
        expect(decode(JSON.stringify({ contextHandle, body }))).toEqual({ body, explanation: "" });
    });

    it("never upgrades any incomplete argument prefix into complete output", () => {
        for (let end = 0; end < raw.length; end++) expect(decode(raw.slice(0, end))).toBeUndefined();
        expect(decode(raw)).toEqual({ body, explanation });
    });

    it.each([
        { ...args, contextHandle: "another-context" },
        { ...args, contextHandle: undefined },
        { ...args, body: " \r\n\t" },
        { ...args, body: 7 },
        { ...args, explanation: null },
        { ...args, path: "target.md" },
        { ...args, origin: "user" },
        { ...args, sourceIds: ["trusted"] },
        { ...args, images: [] },
        { ...args, versionId: "chosen-by-model" },
        { ...args, confirmed: true },
        [args],
    ])("rejects invalid or model-supplied host fields: %j", (input) => {
        expect(decode(JSON.stringify(input))).toBeUndefined();
    });

    it.each([
        raw.replace(/}$/, ',"body":"replacement"}'),
        raw.replace(/}$/, ',"contextHandle":"b135-probe"}'),
        raw.replace(/}$/, ',"explanation":"replacement"}'),
        raw.replace(/}$/, ",}"),
        `${raw} {}`,
        `Here is the output: ${raw}`,
        `\u0060\u0060\u0060json\n${raw}\n\u0060\u0060\u0060`,
        JSON.stringify({ contextHandle, body: "unpaired \ud800" }),
        JSON.stringify({ contextHandle, body, explanation: "unpaired \udc00" }),
    ])("does not repair duplicate, malformed or wrapped arguments", (input) => {
        expect(decode(input)).toBeUndefined();
    });

    it("uses the full raw budget and a valid host handle", () => {
        expect(decodeNativeWritingOutput(raw, contextHandle, raw.length)).toEqual({ body, explanation });
        expect(decodeNativeWritingOutput(raw, contextHandle, raw.length - 1)).toBeUndefined();
        for (const budget of [0, -1, 1.5, NaN, Infinity]) {
            expect(decodeNativeWritingOutput(raw, contextHandle, budget)).toBeUndefined();
        }
        for (const handle of ["", "invalid handle", "x".repeat(129)]) {
            expect(decodeNativeWritingOutput(raw, handle, 20_000)).toBeUndefined();
        }
    });
});

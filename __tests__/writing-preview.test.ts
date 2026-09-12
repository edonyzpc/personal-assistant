import { describe, expect, it } from "@jest/globals";

import { decodeWritingOutput } from "../src/ai-services/writing-output";
import { decodeNativeWritingPreview, decodeWritingPreview } from "../src/ai-services/writing-preview";
import protocolTrace from "./fixtures/b135-writing-protocol-trace.json";

const requestId = "writing-preview-1";
const request = { requestId };
const body = '  原样保留："海风"\r\n🌊\n```json\n{"body":"只是正文"}\n```\n\t';
const envelope = { kind: "pa.writing", version: 1, requestId, body, explanation: "  说明\n" };
const json = JSON.stringify(envelope);
const bodyPrefix = `{"kind":"pa.writing","version":1,"requestId":"${requestId}","body":"`;
const preview = (raw: string) => decodeWritingPreview(raw, requestId, 20_000);
const fence = (raw: string) => `\u0060\u0060\u0060json\n${raw}\n\u0060\u0060\u0060`;

describe("native writing argument previews", () => {
    it("replays actual provider argument boundaries without exposing protocol or changing characters", () => {
        const trace = protocolTrace.results.find((result) => result.mode === "native")!;
        let cumulative = "";
        let partialSnapshots = 0;
        for (const delta of trace.argumentDeltas) {
            cumulative += delta;
            const snapshot = decodeNativeWritingPreview(cumulative, 20_000);
            if (!snapshot) continue;
            expect(trace.expected.startsWith(snapshot.text)).toBe(true);
            if (snapshot.text.length > 0 && snapshot.text.length < trace.expected.length) partialSnapshots++;
        }
        expect(partialSnapshots).toBeGreaterThan(0);
        expect(cumulative).toBe(trace.rawArguments);
        expect(decodeNativeWritingPreview(cumulative, 20_000)).toEqual({ kind: "body", text: trace.expected });
        expect(JSON.parse(cumulative).body).toBe(trace.expected);
        // A readable snapshot is deliberately not an old-protocol completed artifact.
        expect(decodeWritingOutput(cumulative, { requestId: "b135-probe" }, 20_000)).toBeUndefined();
    });

    it("decodes the real legacy comparison with the existing whole-output and preview readers", () => {
        const trace = protocolTrace.results.find((result) => result.mode === "legacy")!;
        expect(decodeWritingOutput(trace.rawText, { requestId: "b135-probe" }, 20_000)).toEqual({
            kind: "pa.writing", version: 1, requestId: "b135-probe", body: trace.expected, explanation: "",
        });
        expect(decodeWritingPreview(trace.rawText, "b135-probe", 20_000)).toEqual({ kind: "body", text: trace.expected });
    });

    it.each([
        JSON.stringify({ contextHandle: "context-1", body, explanation: "Note" }),
        JSON.stringify({ body, contextHandle: "context-1" }),
        JSON.stringify({ body, contextHandle: "context-1" }).replace("🌊", "\\ud83c\\udf0a"),
    ])("preserves every cumulative UTF-16 prefix without requiring key order", (argumentsJson) => {
        let observedPartialBody = false;
        for (let end = 0; end <= argumentsJson.length; end++) {
            const result = decodeNativeWritingPreview(argumentsJson.slice(0, end), 20_000);
            if (!result) continue;
            expect(result.kind).toBe("body");
            expect(body.startsWith(result.text)).toBe(true);
            expect(result.text).not.toMatch(/[\ud800-\udbff]$/);
            if (result.text.length > 0 && result.text.length < body.length) observedPartialBody = true;
        }
        expect(observedPartialBody).toBe(true);
        expect(decodeNativeWritingPreview(argumentsJson, 20_000)).toEqual({ kind: "body", text: body });
    });

    it.each(['{"body":"a","body":"b"}', '{"body":"a","path":"secret"}',
        '{"body":123}', '{"body":"a"} trailing', '{"body":"a",}', '{"body":"\\ud800"}'])
    ("rejects malformed or foreign arguments: %s", (raw) => {
        expect(decodeNativeWritingPreview(raw, 20_000)).toBeUndefined();
    });
    it("enforces its input budget", () => {
        expect(decodeNativeWritingPreview('{"body":"a"}', 3)).toBeUndefined();
        expect(decodeNativeWritingPreview('{"body":"a"}', 0)).toBeUndefined();
    });
});

describe("writing display snapshots", () => {
    it.each([
        ["raw", json],
        ["outer JSON whitespace", ` \t\r\n${json}\r\n `],
        ["pretty JSON", JSON.stringify(envelope, null, 2)],
        ["supported json fence", fence(json)],
        ["mixed-case CRLF fence", `\u0060\u0060\u0060JsOn \t\r\n${json}\r\n\u0060\u0060\u0060\r\n`],
        ["body before identity", JSON.stringify({ body, explanation: "  说明\n", requestId, version: 1, kind: "pa.writing" })],
        ["numeric version with exponent", json.replace('"version":1,', '"version":0.1e1,')],
    ])("matches the whole decoder without adding completion authority (%s)", (_label, raw) => {
        expect(preview(raw)).toEqual({ kind: "body", text: body });
        expect(decodeWritingOutput(raw, request, 20_000)).toEqual(envelope);
        expect(Object.keys(preview(raw)!)).toEqual(["kind", "text"]);
    });

    it.each([json, fence(json)])("withholds incomplete characters at every cumulative boundary", (raw) => {
        for (let end = 0; end <= raw.length; end++) {
            const result = preview(raw.slice(0, end));
            if (!result) continue;
            expect(result.kind).toBe("body");
            expect(body.startsWith(result.text)).toBe(true);
            const last = result.text.charCodeAt(result.text.length - 1);
            expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
        }
        expect(preview(raw)).toEqual({ kind: "body", text: body });
    });

    it("exposes a partial body only after the complete header has been verified", () => {
        expect(preview(`${bodyPrefix}Readable prefix`)).toEqual({ kind: "body", text: "Readable prefix" });
        expect(decodeWritingOutput(`${bodyPrefix}Readable prefix`, request, 20_000)).toBeUndefined();
        expect(preview('{"body":"Readable prefix')).toBeUndefined();
        expect(preview(`{"body":"Readable prefix","kind":"pa.writing","version":1,"requestId":"${requestId}`)).toBeUndefined();
        expect(preview(`{"body":"Readable prefix","kind":"pa.writing","version":1,"requestId":"${requestId}"`))
            .toEqual({ kind: "body", text: "Readable prefix" });
    });

    it.each([
        ["a\\", "a"],
        ["a\\n", "a\n"],
        ["a\\u", "a"],
        ["a\\u6d", "a"],
        ["a\\u6d77", "a海"],
        ["a\\ud83d", "a"],
        ["a\\ud83d\\", "a"],
        ["a\\ud83d\\ude", "a"],
        ["a\\ud83d\\ude00", "a😀"],
        ["a\ud83d", "a"],
        ["a\ud83d\ude00", "a😀"],
        ["a\\ud83d\ude00", "a😀"],
        ["a\ud83d\\ude00", "a😀"],
        ['\\"\\\\\\/\\b\\f\\n\\r\\t', '"\\/\b\f\n\r\t'],
    ])("safely decodes the current body prefix %j", (encoded, expected) => {
        expect(preview(bodyPrefix + encoded)).toEqual({ kind: "body", text: expected });
    });

    it.each([
        "bad\\x",
        "bad\\u0z",
        "bad\nline",
        "bad\u0000",
        "bad\\ude00",
        "bad\\ud83dx",
        'bad\\ud83d"',
        "bad\ude00",
        'bad\ud83d"',
    ])("does not repair malformed body text %j", (encoded) => {
        expect(preview(bodyPrefix + encoded)).toBeUndefined();
    });

    it.each([
        json.replace('"kind":"pa.writing"', '"kind":"other"'),
        json.replace('"version":1', '"version":2'),
        json.replace('"version":1', '"version":"1"'),
        json.replace(requestId, "another-request"),
        JSON.stringify({ ...envelope, body: 42 }),
        JSON.stringify({ ...envelope, explanation: false }),
        JSON.stringify({ ...envelope, extra: "untrusted" }),
        JSON.stringify({ ...envelope, explanation: undefined }),
        json.replace(/}$/, ',"requestId":"another-request"}'),
        json.replace(/}$/, ',"body":"replacement"}'),
        json.replace(/}$/, ",}"),
        `${json} trailing explanation`,
        `${json}{}`,
        `[${json}]`,
        `Here is the result: ${json}`,
    ])("fails closed for observed schema, identity or JSON conflicts", (raw) => {
        expect(preview(raw)).toBeUndefined();
    });

    it.each([
        `\u0060\u0060\u0060\n${json}\n\u0060\u0060\u0060`,
        `\u0060\u0060\u0060javascript\n${json}\n\u0060\u0060\u0060`,
        `\u0060\u0060\u0060json title=draft\n${json}\n\u0060\u0060\u0060`,
        `~~~json\n${json}\n~~~`,
        `\u0060\u0060\u0060\u0060json\n${json}\n\u0060\u0060\u0060\u0060`,
        `\u0060\u0060\u0060json ${json}\n\u0060\u0060\u0060`,
        `\u0060\u0060\u0060json\n${json}\u0060\u0060\u0060`,
        `${fence(json)}\n${fence(json)}`,
        `${fence(json)}\nextra`,
        `> ${json}`,
    ])("rejects unsupported or mixed wrappers", (raw) => {
        expect(preview(raw)).toBeUndefined();
    });

    it("can preview an unfinished supported fence without making it a valid artifact", () => {
        const raw = `\u0060\u0060\u0060json\n${bodyPrefix}Visible`;
        expect(preview(raw)).toEqual({ kind: "body", text: "Visible" });
        expect(decodeWritingOutput(raw, request, 20_000)).toBeUndefined();
    });

    it("keeps ordinary prose distinct and preserves its exact whitespace", () => {
        const raw = "  风从海边来。\nKeep this exact. 🌊  ";
        expect(preview(raw)).toEqual({ kind: "prose", text: raw });
        expect(preview("Hello \ud83d")).toEqual({ kind: "prose", text: "Hello " });
        expect(preview("Hello \ud83d\ude00")).toEqual({ kind: "prose", text: "Hello 😀" });
    });

    it.each(["", " \n", "{", "[", '"text"', "42", "-1", "t", "true", "true\n", "false\t", "null", "``", "~~~", "<json>", "Here is ```json", "Unpaired \ude00"])(
        "does not label ambiguous protocol or malformed Unicode as prose (%j)",
        (raw) => expect(preview(raw)).toBeUndefined(),
    );

    it("applies the raw input budget and validates the expected request identity", () => {
        expect(decodeWritingPreview(json, requestId, json.length)).toEqual({ kind: "body", text: body });
        expect(decodeWritingPreview(json, requestId, json.length - 1)).toBeUndefined();
        for (const budget of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(decodeWritingPreview(json, requestId, budget)).toBeUndefined();
        }
        for (const invalidId of ["", "invalid request", "x".repeat(129)]) {
            expect(decodeWritingPreview(json, invalidId, 20_000)).toBeUndefined();
        }
    });
});

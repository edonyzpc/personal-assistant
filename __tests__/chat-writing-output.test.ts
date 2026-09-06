import { describe, expect, it } from '@jest/globals';
import { decodeWritingOutput } from '../src/ai-services/writing-output';

const request = { requestId: 'writing-boundary-1' };
const body = '  原样保留："海风"\r\n🌊\n```json\n文案中的代码标记\n```\n\t';
const value = { kind: 'pa.writing', version: 1, requestId: request.requestId, body, explanation: '  说明\n' };
const json = JSON.stringify(value);
const fence = (content: string) => `\u0060\u0060\u0060json\n${content}\n\u0060\u0060\u0060`;

describe('writing output whole-response boundaries', () => {
    it.each([
        ['raw JSON', json],
        ['raw JSON with JSON whitespace', ` \t\r\n${json}\r\n `],
        ['single json fence', fence(json)],
        ['mixed-case marker, CRLF and outer whitespace', ` \t\r\n\u0060\u0060\u0060JsOn\t \r\n${json}\r\n\u0060\u0060\u0060\r\n\t `],
        ['pretty JSON', fence(JSON.stringify(value, null, 2))],
    ])('accepts %s without altering the body or explanation', (_label, rawText) => {
        expect(decodeWritingOutput(rawText, request, rawText.length)).toEqual(value);
    });

    it.each([
        ['missing language', `\u0060\u0060\u0060\n${json}\n\u0060\u0060\u0060`],
        ['other language', `\u0060\u0060\u0060javascript\n${json}\n\u0060\u0060\u0060`],
        ['extra language metadata', `\u0060\u0060\u0060json title=draft\n${json}\n\u0060\u0060\u0060`],
        ['tilde fences', `~~~json\n${json}\n~~~`],
        ['four backticks', `\u0060\u0060\u0060\u0060json\n${json}\n\u0060\u0060\u0060\u0060`],
        ['opening fence shares a line', `\u0060\u0060\u0060json ${json}\n\u0060\u0060\u0060`],
        ['closing fence shares a line', `\u0060\u0060\u0060json\n${json}\u0060\u0060\u0060`],
        ['missing closing fence', `\u0060\u0060\u0060json\n${json}`],
        ['CR-only line separators', `\u0060\u0060\u0060json\r${json}\r\u0060\u0060\u0060`],
        ['two blocks', `${fence(json)}\n${fence(json)}`],
        ['leading explanation', `Here is your draft:\n${fence(json)}`],
        ['trailing explanation', `${fence(json)}\nI hope this helps.`],
        ['nested block', fence(fence(json))],
        ['trailing JSON value', fence(`${json}\n{}`)],
        ['incomplete JSON', fence(json.slice(0, -1))],
        ['invalid JSON syntax', fence(json.replace(/}$/, ',}'))],
    ])('rejects %s instead of selecting or repairing a body', (_label, rawText) => {
        expect(decodeWritingOutput(rawText, request, 10_000)).toBeUndefined();
    });

    it.each([
        ['array envelope', [value]],
        ['future version', { ...value, version: 2 }],
        ['wrong request', { ...value, requestId: 'another-request' }],
        ['wrong kind', { ...value, kind: 'other' }],
        ['missing required field', { ...value, explanation: undefined }],
        ['non-string body', { ...value, body: { text: body } }],
        ['empty body', { ...value, body: ' \n\t' }],
        ['extra host material', { ...value, associatedImages: [] }],
    ])('keeps schema validation strict for a fenced %s', (_label, invalid) => {
        expect(decodeWritingOutput(fence(JSON.stringify(invalid)), request, 10_000)).toBeUndefined();
    });

    it('counts the full reply including fences and outer whitespace before parsing', () => {
        const rawText = ` \n${fence(json)}\n `;
        expect(decodeWritingOutput(rawText, request, rawText.length)).toEqual(value);
        expect(decodeWritingOutput(rawText, request, rawText.length - 1)).toBeUndefined();
        expect(decodeWritingOutput(rawText, request, json.length)).toBeUndefined();
        for (const invalidBudget of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(decodeWritingOutput(rawText, request, invalidBudget)).toBeUndefined();
        }
    });
});

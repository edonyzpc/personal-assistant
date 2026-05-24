import { describe, expect, it } from "@jest/globals";

import {
    DefaultAgentRedactor,
    REDACTED_VALUE,
} from "../src/ai-services/agent-redactor";

describe("DefaultAgentRedactor", () => {
    it("redacts secret query params from request and source URLs", () => {
        const redactor = new DefaultAgentRedactor({
            secretValues: ["sk-SECRET_TOKEN_SENTINEL"],
        });

        expect(redactor.redactUrl(
            "https://example.com/search?q=obsidian&api_key=sk-SECRET_TOKEN_SENTINEL#private",
        )).toBe(`https://example.com/search?q=obsidian&api_key=${encodeURIComponent(REDACTED_VALUE)}`);
    });

    it("redacts configured secrets in request bodies and snippets", () => {
        const redactor = new DefaultAgentRedactor({
            secretValues: ["PRIVATE_PROVIDER_KEY"],
        });

        expect(redactor.redactJson({
            query: "latest docs",
            nested: {
                snippet: "result mentioned PRIVATE_PROVIDER_KEY in text",
            },
        })).toEqual({
            query: "latest docs",
            nested: {
                snippet: `result mentioned ${REDACTED_VALUE} in text`,
            },
        });
    });

    it("redacts secret-looking body keys recursively", () => {
        const redactor = new DefaultAgentRedactor();

        expect(redactor.redactJson({
            auth: {
                access_token: "token-value",
                safe: "visible",
            },
            results: [{ title: "visible title", signature: "secret-signature" }],
        })).toEqual({
            auth: {
                access_token: REDACTED_VALUE,
                safe: "visible",
            },
            results: [{ title: "visible title", signature: REDACTED_VALUE }],
        });
    });

    it("redacts auth headers while preserving safe headers", () => {
        const redactor = new DefaultAgentRedactor({
            secretValues: ["PRIVATE_PROVIDER_KEY"],
        });

        expect(redactor.redactHeaders({
            Authorization: "Bearer PRIVATE_PROVIDER_KEY",
            "Content-Type": "application/json",
            "X-Trace": "trace-PRIVATE_PROVIDER_KEY",
        })).toEqual({
            Authorization: REDACTED_VALUE,
            "Content-Type": "application/json",
            "X-Trace": `trace-${REDACTED_VALUE}`,
        });
    });

    it("redacts provider error messages", () => {
        const redactor = new DefaultAgentRedactor({
            secretValues: ["sk-SECRET_TOKEN_SENTINEL"],
        });

        expect(redactor.redactText(
            "request failed for Bearer sk-SECRET_TOKEN_SENTINEL",
        )).not.toContain("sk-SECRET_TOKEN_SENTINEL");
    });

    it("redacts source titles and snippets before source records are built", () => {
        const redactor = new DefaultAgentRedactor({
            secretValues: ["PRIVATE_PROVIDER_KEY"],
        });

        expect({
            title: redactor.redactText("PRIVATE_PROVIDER_KEY in title"),
            snippet: redactor.redactText("snippet PRIVATE_PROVIDER_KEY"),
        }).toEqual({
            title: `${REDACTED_VALUE} in title`,
            snippet: `snippet ${REDACTED_VALUE}`,
        });
    });
});

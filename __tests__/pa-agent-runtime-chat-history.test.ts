import { describe, expect, it } from "@jest/globals";

import { formatCanonicalChatHistory } from "../src/ai-services/pa-agent-runtime";

describe("formatCanonicalChatHistory (#2.2)", () => {
    it("returns empty string for empty input", () => {
        // The empty-string contract matters because the answer-stream prompt template
        // concatenates this output into the host-context block. Returning "<chat_history>"
        // around a blank body would inject a misleading "no history" tag where there should
        // be no block at all, so guard the empty/undefined paths explicitly.
        expect(formatCanonicalChatHistory([])).toBe("");
        expect(formatCanonicalChatHistory(undefined)).toBe("");
    });

    it("wraps non-empty history with <chat_history context_only=\"true\"> tags", () => {
        // SDD §3.4: the wrapper is the prompt-injection guard. It tells the LLM to treat the
        // body as background context rather than fresh instructions, mirroring the
        // <untrusted> pattern already used for tool observations. The asserted tag must stay
        // exact so a refactor that changes "context_only" to a synonym surfaces here.
        const out = formatCanonicalChatHistory([
            { role: "user", content: "hello" },
            { role: "assistant", content: "hi" },
        ]);
        expect(out).toContain("<chat_history context_only=\"true\">");
        expect(out).toContain("</chat_history>");
        expect(out).toContain("User: hello");
        expect(out).toContain("Assistant: hi");
    });

    it("truncates history to last 20 turns", () => {
        // 25 turns × slice(-20) ⇒ indices 5..24 survive; turns 0..4 are dropped. Asserting
        // both an oldest-kept (turn-5) and a newest (turn-24) marker pins the slice direction
        // — a refactor that accidentally uses slice(0, 20) would drop turn-24 and fail loudly
        // here instead of silently regressing to "I cannot remember what we just said".
        const history = Array.from({ length: 25 }, (_, i) => ({
            role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
            content: `turn-${i}`,
        }));
        const out = formatCanonicalChatHistory(history);
        expect(out).not.toContain("turn-0");
        expect(out).not.toContain("turn-4");
        expect(out).toContain("turn-5"); // index 5 onward = last 20
        expect(out).toContain("turn-24");
    });
});

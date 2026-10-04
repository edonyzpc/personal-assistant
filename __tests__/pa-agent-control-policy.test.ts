/* Copyright 2023 edonyzpc */

import { describe, expect, it } from "@jest/globals";

import {
    createAgentControlSnapshot,
    createInitialAgentControlSnapshot,
    deriveContinuedAgentControlSnapshot,
    toolConstraintsFromAgentControlSnapshot,
} from "../src/ai-services/pa-agent-control-policy";

describe("createAgentControlSnapshot", () => {
    it("returns a default snapshot with all fields populated", () => {
        const snapshot = createAgentControlSnapshot();
        expect(snapshot.exposureMode).toBe("semantic-first");
        expect(snapshot.sourceScope).toBe("none");
        expect(snapshot.diagnostics).toEqual([]);
    });

    it("deep-copies diagnostics metadata to prevent mutation leaking", () => {
        const meta = { key: "original" };
        const snapshot = createAgentControlSnapshot({
            diagnostics: [{ type: "test", message: "msg", metadata: meta }],
        });
        meta.key = "mutated";
        expect((snapshot.diagnostics[0].metadata as { key: string }).key).toBe("original");
    });
});

describe("createInitialAgentControlSnapshot", () => {
    it("intersects explicit tools with actual availability", () => {
        const snapshot = createInitialAgentControlSnapshot({
            constraints: {
                allowedToolNames: new Set(["query_notes", "webSearch"]),
            },
            availableSemanticToolNames: new Set([
                "search_memory",
                "query_notes",
                "read_note",
                "webSearch",
            ]),
            availableMetaToolNames: new Set([
                "load_skill",
                "get_writing_context",
                "resolve_chat_images",
            ]),
        });

        expect([...snapshot.allowedToolNames!].sort()).toEqual([
            "query_notes",
            "webSearch",
        ]);
    });

    it("lets explicit blocked tools win over every available capability", () => {
        const snapshot = createInitialAgentControlSnapshot({
            constraints: {
                allowedToolNames: new Set(["query_notes"]),
                blockedToolNames: new Set([
                    "load_skill",
                    "get_writing_context",
                    "resolve_chat_images",
                ]),
            },
            availableSemanticToolNames: new Set(["query_notes", "read_note", "webSearch"]),
            availableMetaToolNames: new Set([
                "load_skill",
                "get_writing_context",
                "resolve_chat_images",
            ]),
        });

        expect([...snapshot.allowedToolNames!]).toEqual(["query_notes"]);
        expect([...snapshot.blockedToolNames!].sort()).toEqual([
            "get_writing_context",
            "load_skill",
            "resolve_chat_images",
        ]);
    });
});

describe("deriveContinuedAgentControlSnapshot", () => {
    it("returns undefined when previous is undefined and no options provided", () => {
        const result = deriveContinuedAgentControlSnapshot(undefined, {});
        expect(result).toBeUndefined();
    });

    it("creates a fresh snapshot when previous is undefined but runtimeInstruction is set", () => {
        const result = deriveContinuedAgentControlSnapshot(undefined, {
            runtimeInstruction: "test instruction",
        });
        expect(result).toBeDefined();
        expect(result!.runtimeInstruction).toBe("test instruction");
        expect(result!.exposureMode).toBe("semantic-first");
    });

    it("transitions to final-only when toolMode is final_answer_only", () => {
        const base = createAgentControlSnapshot({
            exposureMode: "semantic-first",
            allowedToolNames: new Set(["search_memory"]),
            blockedToolNames: new Set(["webSearch"]),
        });
        const result = deriveContinuedAgentControlSnapshot(base, {
            toolMode: "final_answer_only",
        });
        expect(result!.exposureMode).toBe("final-only");
        expect(result!.sourceScope).toBe("none");
        const constraints = toolConstraintsFromAgentControlSnapshot(result);
        expect([...constraints!.allowedToolNames!]).toEqual([]);
        expect(constraints!.blockedToolNames?.has("webSearch")).toBe(true);
    });

    it("preserves explicit constraints when continuing", () => {
        const base = createAgentControlSnapshot({
            allowedToolNames: new Set(["read_note"]),
            blockedToolNames: new Set(["webSearch"]),
            blockedReasons: { webSearch: "Current request is limited to notes." },
        });
        const result = deriveContinuedAgentControlSnapshot(base, {});
        expect([...result!.allowedToolNames!]).toEqual(["read_note"]);
        expect([...result!.blockedToolNames!]).toEqual(["webSearch"]);
        expect(result!.blockedReasons).toEqual(base.blockedReasons);
    });

    it("keeps a normal empty allowlist answer-ready rather than converting it to generic final-only", () => {
        const base = createAgentControlSnapshot({
            exposureMode: "answer-ready",
            sourceScope: "notes",
            allowedToolNames: new Set<string>(),
            toolMode: "normal",
        });

        const result = deriveContinuedAgentControlSnapshot(base, {
            runtimeInstruction: "acknowledge",
        });

        expect(result!.exposureMode).toBe("answer-ready");
        expect(result!.toolMode).toBe("normal");
        expect([...result!.allowedToolNames!]).toEqual([]);
    });
});

describe("toolConstraintsFromAgentControlSnapshot", () => {
    it("returns undefined for undefined snapshot", () => {
        expect(toolConstraintsFromAgentControlSnapshot(undefined)).toBeUndefined();
    });

    it("returns empty allowedToolNames for final-only mode", () => {
        const snapshot = createAgentControlSnapshot({
            exposureMode: "final-only",
            allowedToolNames: new Set(["tool_a"]),
        });
        const constraints = toolConstraintsFromAgentControlSnapshot(snapshot);
        expect(constraints).toBeDefined();
        expect(constraints!.allowedToolNames).toBeDefined();
        expect(constraints!.allowedToolNames!.size).toBe(0);
    });

    it("returns empty allowedToolNames for final_answer_only toolMode", () => {
        const snapshot = createAgentControlSnapshot({
            toolMode: "final_answer_only",
            allowedToolNames: new Set(["tool_a"]),
        });
        const constraints = toolConstraintsFromAgentControlSnapshot(snapshot);
        expect(constraints!.allowedToolNames!.size).toBe(0);
    });

    it("returns undefined when no tool constraints are set", () => {
        const snapshot = createAgentControlSnapshot({ exposureMode: "semantic-first" });
        expect(toolConstraintsFromAgentControlSnapshot(snapshot)).toBeUndefined();
    });
});

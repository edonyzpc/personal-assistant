import { describe, expect, it } from "@jest/globals";

import {
    classifyRequiredCapabilitiesDeterministic,
    createRequiredCapabilityHostPolicy,
    inspectRequiredCapabilityPhase,
    resolveRequiredCapabilityClassification,
    type RequiredCapability,
} from "../src/ai-services/pa-agent-required-capability-policy";
import { createAgentControlSnapshot } from "../src/ai-services/pa-agent-control-policy";
import type { PaAgentTurnSummary } from "../src/ai-services/pa-agent-loop";

describe("PA Agent required capability HostPolicy", () => {
    it("classifies strong and weak deterministic capability signals", () => {
        expect(classifyRequiredCapabilitiesDeterministic("Search the web for the latest docs.").items).toEqual([
            expect.objectContaining({
                capability: "webSearch",
                confidence: 0.9,
                level: "required",
            }),
        ]);
        expect(classifyRequiredCapabilitiesDeterministic("Use my materials if helpful.").items).toEqual([
            expect.objectContaining({
                capability: "search_memory",
                confidence: 0.65,
                level: "suggested",
            }),
        ]);
    });

    describe("English baseline classification (SDD §7.1 deterministic)", () => {
        it("classifies English webSearch weak-signal inputs as suggested", () => {
            expect(classifyRequiredCapabilitiesDeterministic("This may have changed recently.").items).toEqual([
                expect.objectContaining({ capability: "webSearch", confidence: 0.65, level: "suggested" }),
            ]);
            expect(classifyRequiredCapabilitiesDeterministic("Is there a newest release out?").items).toEqual([
                expect.objectContaining({ capability: "webSearch", confidence: 0.65, level: "suggested" }),
            ]);
        });

        it("classifies latest/today freshness questions with external nouns as required", () => {
            expect(classifyRequiredCapabilitiesDeterministic("What's the latest Obsidian release?").items).toEqual([
                expect.objectContaining({ capability: "webSearch", confidence: 0.9, level: "required" }),
            ]);
            expect(classifyRequiredCapabilitiesDeterministic("What is today's weather in Shanghai?").items).toEqual([
                expect.objectContaining({ capability: "webSearch", confidence: 0.9, level: "required" }),
            ]);
        });

        it("classifies English search_memory strong-signal inputs as required", () => {
            expect(classifyRequiredCapabilitiesDeterministic("Check my notes for the spec.").items).toEqual([
                expect.objectContaining({ capability: "search_memory", confidence: 0.9, level: "required" }),
            ]);
            expect(classifyRequiredCapabilitiesDeterministic("Search my vault for the design doc.").items).toEqual([
                expect.objectContaining({ capability: "search_memory", confidence: 0.9, level: "required" }),
            ]);
        });

        it("classifies English current-note weak-signal inputs as suggested", () => {
            expect(classifyRequiredCapabilitiesDeterministic("Summarize this document for me.").items).toEqual([
                expect.objectContaining({ capability: "get_current_note_context", confidence: 0.65, level: "suggested" }),
            ]);
            expect(classifyRequiredCapabilitiesDeterministic("What does the selected text mean?").items).toEqual([
                expect.objectContaining({ capability: "get_current_note_context", confidence: 0.65, level: "suggested" }),
            ]);
        });
    });

    describe("CJK keyword classification (SDD §7.2)", () => {
        it("classifies Chinese webSearch strong-signal inputs as required", () => {
            expect(classifyRequiredCapabilitiesDeterministic("网上查 React 最新版本").items).toEqual([
                expect.objectContaining({ capability: "webSearch", level: "required" }),
            ]);
            expect(classifyRequiredCapabilitiesDeterministic("在线查这个 API 文档").items).toEqual([
                expect.objectContaining({ capability: "webSearch", level: "required" }),
            ]);
            expect(classifyRequiredCapabilitiesDeterministic("上网查一下今天的天气").items).toEqual([
                expect.objectContaining({ capability: "webSearch", level: "required" }),
            ]);
            expect(classifyRequiredCapabilitiesDeterministic("看一下杭州今天的天气").items).toEqual([
                expect.objectContaining({ capability: "webSearch", level: "required" }),
            ]);
            expect(classifyRequiredCapabilitiesDeterministic("杭州现在气温多少").items).toEqual([
                expect.objectContaining({ capability: "webSearch", level: "required" }),
            ]);
            expect(classifyRequiredCapabilitiesDeterministic("今天北京空气质量怎么样").items).toEqual([
                expect.objectContaining({ capability: "webSearch", level: "required" }),
            ]);
        });

        it("does not trigger WebSearch from standalone air-quality wording without a current-info cue", () => {
            expect(classifyRequiredCapabilitiesDeterministic("我的笔记里提到空气质量的段落").items).not.toEqual(
                expect.arrayContaining([expect.objectContaining({ capability: "webSearch" })]),
            );
            expect(classifyRequiredCapabilitiesDeterministic("当前笔记里空气质量是什么意思").items).not.toEqual(
                expect.arrayContaining([expect.objectContaining({ capability: "webSearch" })]),
            );
        });

        it("classifies Chinese memory strong-signal inputs as required", () => {
            expect(classifyRequiredCapabilitiesDeterministic("我的笔记里写过什么相关内容").items).toEqual([
                expect.objectContaining({ capability: "search_memory", level: "required" }),
            ]);
            expect(classifyRequiredCapabilitiesDeterministic("笔记库里有相关资料吗").items).toEqual([
                expect.objectContaining({ capability: "search_memory", level: "required" }),
            ]);
        });

        it("classifies Chinese current-note signals correctly", () => {
            expect(classifyRequiredCapabilitiesDeterministic("总结当前笔记").items).toEqual([
                expect.objectContaining({ capability: "get_current_note_context", level: "required" }),
            ]);
            expect(classifyRequiredCapabilitiesDeterministic("这篇文章在讲什么").items).toEqual([
                expect.objectContaining({ capability: "get_current_note_context", level: "suggested" }),
            ]);
        });

        it("classifies mixed Chinese-English input via English strong signals", () => {
            expect(classifyRequiredCapabilitiesDeterministic("web search for the latest React docs").items).toEqual([
                expect.objectContaining({ capability: "webSearch", level: "required" }),
            ]);
        });

        // Per SDD §4.4: each of these used to trip bare 最新/今天/当前/更新 in the old
        // CJK keyword table. Split per-input so a failing case is named in the test output.
        it.each([
            "今天写了什么笔记",
            "最新的项目进展",
            "更新一下笔记内容",
        ])("does NOT trigger webSearch on generic Chinese adverb: %s (regression guard)", (input) => {
            expect(classifyRequiredCapabilitiesDeterministic(input).items).not.toEqual(
                expect.arrayContaining([expect.objectContaining({ capability: "webSearch" })]),
            );
        });

        it.each([
            "基于上下文给我建议",
            "当前任务是什么",
        ])("does NOT trigger get_current_note_context on generic term: %s (regression guard)", (input) => {
            expect(classifyRequiredCapabilitiesDeterministic(input).items).not.toEqual(
                expect.arrayContaining([expect.objectContaining({ capability: "get_current_note_context" })]),
            );
        });
    });

    it("does not treat current-note prompts as web freshness requests", () => {
        const classification = classifyRequiredCapabilitiesDeterministic(
            "Use the current note context only. What is the exact positive snippet token in this current note?",
        );

        expect(classification.items).toEqual([expect.objectContaining({
            capability: "get_current_note_context",
            confidence: 0.9,
            level: "required",
        })]);
        expect(classification.items).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ capability: "webSearch" }),
        ]));
    });

    it("honors explicit no-web and current-note-only constraints over policy classifier output", async () => {
        const classification = await resolveRequiredCapabilityClassification({
            userInput: "Use the current note only. Find the token whose prefix is pa-positive-snippet-token. Do not use web search.",
            classifier: {
                classify: async () => ({
                    items: [
                        {
                            capability: "webSearch",
                            confidence: 0.95,
                            reason: "classifier false positive",
                        },
                        {
                            capability: "get_current_note_context",
                            confidence: 0.9,
                            reason: "current note requested",
                        },
                    ],
                }),
            },
        });

        expect(classification.items).toEqual([expect.objectContaining({
            capability: "get_current_note_context",
            level: "required",
        })]);
    });

    it("honors Chinese explicit no-web constraints over weather/current-info routes", async () => {
        const classification = await resolveRequiredCapabilityClassification({
            userInput: "不要联网，看一下杭州今天的天气",
            classifier: {
                classify: async () => ({
                    items: [{
                        capability: "webSearch",
                        confidence: 0.95,
                        reason: "weather route",
                    }],
                }),
            },
        });

        expect(classification.items).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ capability: "webSearch" }),
        ]));
    });

    it("honors explicit no-memory wording without suppressing WebSearch", async () => {
        const classification = await resolveRequiredCapabilityClassification({
            userInput: "Use WebSearch. Search the web for the official Obsidian homepage domain. Do not answer from memory.",
            classifier: {
                classify: async () => ({
                    items: [
                        {
                            capability: "webSearch",
                            confidence: 0.95,
                            reason: "web explicitly requested",
                        },
                        {
                            capability: "search_memory",
                            confidence: 0.9,
                            reason: "classifier false positive from the word memory",
                        },
                    ],
                }),
            },
        });

        expect(classification.items).toEqual([expect.objectContaining({
            capability: "webSearch",
            level: "required",
        })]);
        expect(classification.items).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ capability: "search_memory" }),
        ]));
    });

    it("uses classifier JSON when it returns before the timeout", async () => {
        const seenInputs: unknown[] = [];
        const classification = await resolveRequiredCapabilityClassification({
            userInput: "Should I use my notes?",
            classifier: {
                classify: async (input) => {
                    seenInputs.push(input);
                    return JSON.stringify({
                        items: [{
                            capability: "search_memory",
                            confidence: 0.82,
                            reason: "model classified notes as required",
                        }],
                    });
                },
            },
        });

        expect(seenInputs).toEqual([expect.objectContaining({
            userInput: "Should I use my notes?",
        })]);
        expect(JSON.stringify(seenInputs[0])).not.toContain("vault");
        expect(classification).toEqual({
            items: [expect.objectContaining({
                capability: "search_memory",
                confidence: 0.82,
                level: "required",
            })],
        });
    });

    it("uses deterministic fallback when no policy classifier is configured", async () => {
        await expect(resolveRequiredCapabilityClassification({
            userInput: "Search the web for latest docs.",
        })).resolves.toEqual({
            items: [expect.objectContaining({
                capability: "webSearch",
                confidence: 0.9,
                level: "required",
            })],
        });
    });

    it("normalizes classifier confidence levels and ignores low-confidence items", async () => {
        await expect(resolveRequiredCapabilityClassification({
            userInput: "Review this request.",
            classifier: {
                classify: async () => ({
                    items: [
                        {
                            capability: "search_memory",
                            confidence: 0.75,
                            reason: "required boundary",
                        },
                        {
                            capability: "webSearch",
                            confidence: 0.45,
                            reason: "suggested boundary",
                        },
                        {
                            capability: "get_current_note_context",
                            confidence: 0.44,
                            reason: "below boundary",
                        },
                        {
                            capability: "unknown_tool",
                            confidence: 1,
                            reason: "unknown capability",
                        },
                    ],
                }),
            },
        })).resolves.toEqual({
            items: [
                expect.objectContaining({
                    capability: "search_memory",
                    confidence: 0.75,
                    level: "required",
                }),
                expect.objectContaining({
                    capability: "webSearch",
                    confidence: 0.45,
                    level: "suggested",
                }),
            ],
        });
    });

    it("falls back when classifier times out and ignores late results", async () => {
        let lateResolved = false;
        const classification = await resolveRequiredCapabilityClassification({
            userInput: "Search the web for latest docs.",
            timeoutMs: 1,
            classifier: {
                classify: () => new Promise((resolve) => {
                    setTimeout(() => {
                        lateResolved = true;
                        resolve({
                            items: [{
                                capability: "search_memory",
                                confidence: 0.95,
                                reason: "late wrong result",
                            }],
                        });
                    }, 20);
                }),
            },
        });

        expect(classification).toEqual({
            items: [expect.objectContaining({ capability: "webSearch", level: "required" })],
        });
        await new Promise((resolve) => setTimeout(resolve, 25));
        expect(lateResolved).toBe(true);
        expect(classification.items.map((item) => item.capability)).toEqual(["webSearch"]);
    });

    it("falls back when classifier returns invalid JSON or throws", async () => {
        await expect(resolveRequiredCapabilityClassification({
            userInput: "Search the web for latest docs.",
            classifier: { classify: async () => "not json" },
        })).resolves.toMatchObject({
            items: [expect.objectContaining({ capability: "webSearch" })],
        });

        await expect(resolveRequiredCapabilityClassification({
            userInput: "Search the web for latest docs.",
            classifier: { classify: async () => { throw new Error("policy model failed"); } },
        })).resolves.toMatchObject({
            items: [expect.objectContaining({ capability: "webSearch" })],
        });
    });

    it("applies explicit no-web constraints again at host-policy construction", async () => {
        const policy = createRequiredCapabilityHostPolicy({
            userInput: "不要联网，看一下杭州今天的天气",
            availableCapabilities: new Set<RequiredCapability>(["webSearch"]),
            classification: {
                items: [{
                    capability: "webSearch",
                    confidence: 0.95,
                    level: "required",
                    reason: "classifier false positive",
                }],
            },
        });

        expect(policy.classification.items).toEqual([]);
        expect(policy.initialRuntimeInstruction).toBeUndefined();
        expect(await policy.hostPolicy.afterTurn(createSummary({
            committedFinalText: "不联网时无法核验实时天气。",
        }))).toMatchObject({
            action: "stop",
            status: "completed",
        });
    });

    it("injects a required first-turn instruction and allows one corrective turn", async () => {
        const policy = createRequiredCapabilityHostPolicy({
            userInput: "Search the web for the latest docs.",
            availableCapabilities: new Set<RequiredCapability>(["webSearch"]),
        });

        expect(policy.initialRuntimeInstruction).toContain("WebSearch (webSearch)");
        expect(policy.initialRuntimeInstruction).toContain("Use the listed tool or tools if available");

        expect(await policy.hostPolicy.afterTurn(createSummary({
            committedFinalText: "Answer without web.",
        }))).toMatchObject({
            action: "continue",
            reason: "corrective_turn",
            runtimeInstruction: expect.stringContaining("WebSearch (webSearch)"),
        });
        expect(await policy.hostPolicy.afterTurn(createSummary({
            committedFinalText: "Still no web.",
        }))).toMatchObject({
            action: "stop",
            status: "completed_with_warning",
            warnings: [expect.objectContaining({
                type: "required_capability_missing",
                capability: "webSearch",
                metadata: expect.objectContaining({
                    available: true,
                    correctiveAttempted: true,
                }),
            })],
        });
    });

    it("does not satisfy required capabilities from tool calls or failed tool results", async () => {
        const policy = createRequiredCapabilityHostPolicy({
            userInput: "Search the web for the latest docs.",
            availableCapabilities: new Set<RequiredCapability>(["webSearch"]),
        });

        expect(await policy.hostPolicy.afterTurn(createSummary({
            committedFinalText: "Tried a tool call.",
            toolCalls: [{
                type: "toolCall",
                id: "web-call",
                name: "webSearch",
                input: { query: "latest docs" },
            }],
        }))).toMatchObject({
            action: "continue",
            reason: "corrective_turn",
        });

        expect(await policy.hostPolicy.afterTurn(createSummary({
            committedFinalText: "Tool failed.",
            toolResults: [createToolResult("webSearch", {
                isError: true,
                outcome: "recoverable_error",
            })],
        }))).toMatchObject({
            action: "stop",
            reason: "required_capability_failed",
            status: "completed_with_warning",
            warnings: [expect.objectContaining({
                capability: "webSearch",
                detail: "WebSearch was required but failed or was unavailable.",
            })],
        });
    });

    it("emits incomplete diagnostics when no answer exists after corrective", async () => {
        const policy = createRequiredCapabilityHostPolicy({
            userInput: "Search the web for the latest docs.",
            availableCapabilities: new Set<RequiredCapability>(["webSearch"]),
        });

        expect(await policy.hostPolicy.afterTurn(createSummary())).toMatchObject({
            action: "continue",
            reason: "corrective_turn",
        });
        expect(await policy.hostPolicy.afterTurn(createSummary())).toMatchObject({
            action: "stop",
            status: "incomplete",
            diagnostics: [expect.objectContaining({
                type: "required_capability_missing",
                capabilities: ["webSearch"],
            })],
        });
    });

    it("retries once when successful tool observations are followed by an empty assistant response", async () => {
        const policy = createRequiredCapabilityHostPolicy({
            userInput: "Use gathered context.",
            availableCapabilities: new Set<RequiredCapability>(["get_current_note_context"]),
        });

        expect(await policy.hostPolicy.afterTurn(createSummary({
            status: "tool_results_ready",
            toolResults: [createToolResult("get_current_note_context")],
        }))).toMatchObject({
            action: "continue",
            reason: "tool_results_ready",
        });

        expect(await policy.hostPolicy.afterTurn(createSummary({
            status: "incomplete",
            diagnostics: [{ type: "assistant_empty_response" }],
        }))).toMatchObject({
            action: "continue",
            reason: "needs_follow_up",
            runtimeInstruction: expect.stringContaining("This is a finalization turn. Do not call tools."),
            toolMode: "final_answer_only",
        });

        expect(await policy.hostPolicy.afterTurn(createSummary({
            status: "incomplete",
            diagnostics: [{ type: "assistant_empty_response" }],
        }))).toMatchObject({
            action: "stop",
            status: "incomplete",
        });
    });

    it("retries duplicate-only tool turns with an explicit answer-from-observations instruction", async () => {
        const policy = createRequiredCapabilityHostPolicy({
            userInput: "Use the current note only. Find the token whose prefix is pa-positive-snippet-token.",
            availableCapabilities: new Set<RequiredCapability>(["get_current_note_context"]),
        });

        expect(await policy.hostPolicy.afterTurn(createSummary({
            status: "tool_results_ready",
            toolResults: [createToolResult("get_current_note_context")],
        }))).toMatchObject({
            action: "continue",
            reason: "tool_results_ready",
        });

        expect(await policy.hostPolicy.afterTurn(createSummary({
            status: "tool_results_ready",
            toolResults: [createDuplicateToolResult("get_current_note_context")],
        }))).toMatchObject({
            action: "continue",
            reason: "needs_follow_up",
            runtimeInstruction: expect.stringContaining("get_current_note_context has already been gathered"),
            toolMode: "final_answer_only",
        });

        expect(await policy.hostPolicy.afterTurn(createSummary({
            status: "tool_results_ready",
            toolResults: [createDuplicateToolResult("get_current_note_context")],
        }))).toMatchObject({
            action: "stop",
            status: "incomplete",
            diagnostics: [expect.objectContaining({
                type: "duplicate_tool_call_without_answer",
                tools: ["get_current_note_context"],
            })],
        });
    });

    it("treats successful note inspection as satisfying current-note requirements", async () => {
        const policy = createRequiredCapabilityHostPolicy({
            userInput: "Inspect the current note structure.",
            availableCapabilities: new Set<RequiredCapability>(["get_current_note_context"]),
        });

        expect(await policy.hostPolicy.afterTurn(createSummary({
            committedFinalText: "Operations Smoke Note; tags; callout; embed",
            toolResults: [createToolResult("inspect_obsidian_note")],
        }))).toMatchObject({
            action: "stop",
            status: "completed",
        });
    });

    it("does not loop after a required WebSearch tool returns unavailable", async () => {
        const policy = createRequiredCapabilityHostPolicy({
            userInput: "Search the web for the latest docs.",
            availableCapabilities: new Set<RequiredCapability>(["webSearch"]),
        });

        expect(await policy.hostPolicy.afterTurn(createSummary({
            status: "tool_results_ready",
            toolResults: [createToolResult("webSearch", {
                isError: true,
                outcome: "recoverable_error",
            })],
        }))).toMatchObject({
            action: "continue",
            reason: "needs_follow_up",
            runtimeInstruction: expect.stringContaining("webSearch already returned an unavailable"),
            toolMode: "final_answer_only",
        });

        expect(await policy.hostPolicy.afterTurn(createSummary({
            committedFinalText: "I cannot verify the latest docs from available context.",
        }))).toMatchObject({
            action: "stop",
            reason: "required_capability_missing",
            status: "completed_with_warning",
            warnings: [expect.objectContaining({
                capability: "webSearch",
                detail: "WebSearch was required but failed or was unavailable.",
                metadata: expect.objectContaining({
                    failedRequiredToolRetryAttempted: true,
                }),
            })],
        });
    });

    it("stops duplicate-only retries after a required WebSearch failure", async () => {
        const policy = createRequiredCapabilityHostPolicy({
            userInput: "Search the web for the latest docs.",
            availableCapabilities: new Set<RequiredCapability>(["webSearch"]),
        });

        await policy.hostPolicy.afterTurn(createSummary({
            status: "tool_results_ready",
            toolResults: [createToolResult("webSearch", {
                isError: true,
                outcome: "recoverable_error",
            })],
        }));

        expect(await policy.hostPolicy.afterTurn(createSummary({
            status: "tool_results_ready",
            toolResults: [createDuplicateToolResult("webSearch")],
        }))).toMatchObject({
            action: "stop",
            status: "incomplete",
            diagnostics: [expect.objectContaining({
                type: "duplicate_tool_call_without_answer",
                tools: ["webSearch"],
            })],
        });
    });

    it("adds an unavailable note without corrective turns", async () => {
        const policy = createRequiredCapabilityHostPolicy({
            userInput: "Search the web for the latest docs.",
            availableCapabilities: new Set(),
        });

        expect(policy.initialRuntimeInstruction).toContain("unavailable in this runtime");
        expect(await policy.hostPolicy.afterTurn(createSummary({
            committedFinalText: "Answer from available context.",
        }))).toMatchObject({
            action: "stop",
            status: "completed_with_warning",
            warnings: [expect.objectContaining({
                capability: "webSearch",
                metadata: expect.objectContaining({
                    available: false,
                    correctiveAttempted: false,
                }),
            })],
        });
    });

    it("treats suggested capabilities as hints without warning metadata", async () => {
        const policy = createRequiredCapabilityHostPolicy({
            userInput: "Use my materials if helpful.",
            availableCapabilities: new Set<RequiredCapability>(["search_memory"]),
        });

        expect(policy.initialRuntimeInstruction).toContain("may benefit from Memory from notes");
        expect(await policy.hostPolicy.afterTurn(createSummary({
            committedFinalText: "Direct answer.",
        }))).toMatchObject({
            action: "stop",
            status: "completed",
        });
    });

    it("handles multi-capability required and suggested combinations precisely", async () => {
        const policy = createRequiredCapabilityHostPolicy({
            userInput: "Use my notes and search the web for current launch context.",
            availableCapabilities: new Set<RequiredCapability>(["search_memory", "webSearch"]),
            classification: {
                items: [
                    {
                        capability: "search_memory",
                        confidence: 0.9,
                        reason: "notes required",
                        level: "required",
                    },
                    {
                        capability: "webSearch",
                        confidence: 0.86,
                        reason: "freshness required",
                        level: "required",
                    },
                    {
                        capability: "get_current_note_context",
                        confidence: 0.62,
                        reason: "current note might help",
                        level: "suggested",
                    },
                ],
            },
        });

        expect(policy.initialRuntimeInstruction).toContain("Memory from notes (search_memory)");
        expect(policy.initialRuntimeInstruction).toContain("WebSearch (webSearch)");
        expect(policy.initialRuntimeInstruction).not.toContain("current note context (get_current_note_context)");

        expect(await policy.hostPolicy.afterTurn(createSummary({
            committedFinalText: "Used Memory only.",
            toolResults: [createToolResult("search_memory")],
        }))).toMatchObject({
            action: "continue",
            reason: "corrective_turn",
            runtimeInstruction: expect.stringContaining("WebSearch (webSearch)"),
        });

        const stop = await policy.hostPolicy.afterTurn(createSummary({
            committedFinalText: "Still missing web.",
            toolResults: [createToolResult("search_memory")],
        }));
        expect(stop).toMatchObject({
            action: "stop",
            status: "completed_with_warning",
            warnings: [expect.objectContaining({
                capability: "webSearch",
            })],
        });
        expect(stop.action === "stop" ? stop.warnings?.map((warning) => warning.capability) : []).toEqual(["webSearch"]);

        const satisfiedPolicy = createRequiredCapabilityHostPolicy({
            userInput: "Use my notes and search the web for current launch context.",
            availableCapabilities: new Set<RequiredCapability>(["search_memory", "webSearch"]),
            classification: policy.classification,
        });
        expect(await satisfiedPolicy.hostPolicy.afterTurn(createSummary({
            committedFinalText: "Used both.",
            toolResults: [
                createToolResult("search_memory"),
                createToolResult("webSearch"),
            ],
        }))).toMatchObject({
            action: "stop",
            status: "completed",
        });
    });

    it("is idempotent after reaching a terminal stop decision (SDD §7.3)", async () => {
        const policy = createRequiredCapabilityHostPolicy({
            userInput: "Search the web for the latest docs.",
            availableCapabilities: new Set<RequiredCapability>(["webSearch"]),
        });

        // Round 1: initial → corrective_issued
        expect(await policy.hostPolicy.afterTurn(createSummary({
            committedFinalText: "Answer without web.",
        }))).toMatchObject({ action: "continue", reason: "corrective_turn" });

        // Round 2: corrective_issued → terminal(from corrective)
        const terminalDecision = await policy.hostPolicy.afterTurn(createSummary({
            committedFinalText: "Still no web.",
        }));
        expect(terminalDecision).toMatchObject({ action: "stop" });

        // Round 3+: any further call should be a no-op stop, never crash, never re-run policy
        const post = await policy.hostPolicy.afterTurn(createSummary({
            committedFinalText: "After terminal.",
        }));
        expect(post).toMatchObject({ action: "stop", reason: "terminal_idempotent", status: "completed" });
    });

    describe("phase introspection (SDD §7.3)", () => {
        it("starts in awaiting_initial_tools", () => {
            const policy = createRequiredCapabilityHostPolicy({
                userInput: "Search the web for the latest docs.",
                availableCapabilities: new Set<RequiredCapability>(["webSearch"]),
            });
            expect(inspectRequiredCapabilityPhase(policy.hostPolicy)).toBe("awaiting_initial_tools");
        });

        it("transitions to corrective_issued after a corrective_turn", async () => {
            const policy = createRequiredCapabilityHostPolicy({
                userInput: "Search the web for the latest docs.",
                availableCapabilities: new Set<RequiredCapability>(["webSearch"]),
            });
            await policy.hostPolicy.afterTurn(createSummary({ committedFinalText: "Answer without web." }));
            expect(inspectRequiredCapabilityPhase(policy.hostPolicy)).toBe("corrective_issued");
        });

        it("transitions to failed_retry_issued when a required tool fails from initial", async () => {
            const policy = createRequiredCapabilityHostPolicy({
                userInput: "Search the web for the latest docs.",
                availableCapabilities: new Set<RequiredCapability>(["webSearch"]),
            });
            await policy.hostPolicy.afterTurn(createSummary({
                committedFinalText: "Tried web but it failed.",
                toolResults: [createToolResult("webSearch", { isError: true, outcome: "recoverable_error" })],
            }));
            expect(inspectRequiredCapabilityPhase(policy.hostPolicy)).toBe("failed_retry_issued");
        });

        it("transitions to terminal after a stop decision", async () => {
            const policy = createRequiredCapabilityHostPolicy({
                userInput: "Search the web for the latest docs.",
                availableCapabilities: new Set<RequiredCapability>(["webSearch"]),
            });
            await policy.hostPolicy.afterTurn(createSummary({ committedFinalText: "Answer without web." }));
            await policy.hostPolicy.afterTurn(createSummary({ committedFinalText: "Still no web." }));
            expect(inspectRequiredCapabilityPhase(policy.hostPolicy)).toBe("terminal");
        });
    });

    it("warns only for unsatisfied required capabilities when available and unavailable capabilities are mixed", async () => {
        const policy = createRequiredCapabilityHostPolicy({
            userInput: "Use my notes and current web information.",
            availableCapabilities: new Set<RequiredCapability>(["search_memory"]),
            classification: {
                items: [
                    {
                        capability: "search_memory",
                        confidence: 0.9,
                        reason: "notes required",
                        level: "required",
                    },
                    {
                        capability: "webSearch",
                        confidence: 0.9,
                        reason: "web required",
                        level: "required",
                    },
                ],
            },
        });

        expect(policy.initialRuntimeInstruction).toContain("Memory from notes (search_memory)");
        expect(policy.initialRuntimeInstruction).toContain("WebSearch (webSearch), but that capability is unavailable");

        const stop = await policy.hostPolicy.afterTurn(createSummary({
            committedFinalText: "Used Memory, web unavailable.",
            toolResults: [createToolResult("search_memory")],
        }));
        expect(stop).toMatchObject({
            action: "stop",
            status: "completed_with_warning",
            warnings: [expect.objectContaining({
                capability: "webSearch",
                metadata: expect.objectContaining({
                    available: false,
                    correctiveAttempted: false,
                }),
            })],
        });
        expect(stop.action === "stop" ? stop.warnings?.map((warning) => warning.capability) : []).toEqual(["webSearch"]);
    });

    it("continues successful observations with answer-ready guidance instead of final-only", async () => {
        const policy = createRequiredCapabilityHostPolicy({
            userInput: "Check my notes for Zhou Zhi.",
            availableCapabilities: new Set<RequiredCapability>(["search_memory"]),
        });
        const decision = await policy.hostPolicy.afterTurn(createSummary({
            status: "tool_results_ready",
            toolResults: [createToolResult("search_memory")],
            controlSnapshot: createAgentControlSnapshot({
                exposureMode: "narrowed-required",
                sourceScope: "notes",
                allowedToolNames: new Set(["search_memory"]),
            }),
        }));

        expect(decision).toMatchObject({
            action: "continue",
            reason: "tool_results_ready",
            runtimeInstruction: expect.stringContaining("Answer directly if the existing observations are sufficient."),
            controlSnapshot: {
                exposureMode: "answer-ready",
                sourceScope: "notes",
            },
        });
        if (decision.action === "continue") {
            expect(decision.toolMode).toBeUndefined();
            expect([...decision.controlSnapshot!.allowedToolNames!]).toEqual(["search_memory"]);
            expect(decision.controlSnapshot!.diagnostics.map((diagnostic) => diagnostic.type)).toContain("answer_ready_decision");
        }
    });

    it("opens notes follow-up tools only when Memory explicitly requests snippet follow-up", async () => {
        const policy = createRequiredCapabilityHostPolicy({
            userInput: "Check my notes for Zhou Zhi.",
            availableCapabilities: new Set<RequiredCapability>(["search_memory"]),
        });
        const decision = await policy.hostPolicy.afterTurn(createSummary({
            status: "tool_results_ready",
            toolResults: [createToolResult("search_memory", {
                metadata: { needsSnippetFollowup: true },
            })],
            controlSnapshot: createAgentControlSnapshot({
                exposureMode: "narrowed-required",
                sourceScope: "notes",
                allowedToolNames: new Set(["search_memory"]),
            }),
        }));

        expect(decision).toMatchObject({
            action: "continue",
            reason: "needs_follow_up",
            runtimeInstruction: expect.stringContaining("targeted note follow-up"),
            controlSnapshot: {
                exposureMode: "follow-up",
                sourceScope: "notes",
            },
        });
        if (decision.action === "continue") {
            expect([...decision.controlSnapshot!.allowedToolNames!]).toEqual(["search_vault_snippets"]);
        }
    });
});

function createSummary(overrides: Partial<PaAgentTurnSummary> = {}): PaAgentTurnSummary {
    return {
        turnId: "turn-1",
        turnIndex: 0,
        status: "completed",
        assistantMessage: {
            role: "assistant",
            id: "assistant-1",
            content: [],
            timestamp: 1000,
        },
        committedFinalText: "",
        pendingTextReclassified: false,
        toolCalls: [],
        toolResults: [],
        diagnostics: [],
        metrics: [],
        timing: {
            turnIndex: 0,
            status: "completed",
            elapsedMs: 0,
            modelElapsedMs: 0,
            modelChunkCount: 0,
            toolCallCount: 0,
            toolResultCount: 0,
        },
        ...overrides,
    };
}

function createToolResult(
    toolName: string,
    options: { isError?: boolean; outcome?: string; metadata?: Record<string, unknown> } = {},
): PaAgentTurnSummary["toolResults"][number] {
    return {
        role: "toolResult",
        id: `${toolName}-result`,
        toolCallId: `${toolName}-call`,
        toolName,
        content: {
            promptText: `${toolName} observation`,
            includeInNextPrompt: true,
            metadata: {
                outcome: options.outcome ?? "success",
                ...(options.metadata ?? {}),
            },
        },
        isError: options.isError ?? false,
        timestamp: 1000,
    };
}

function createDuplicateToolResult(toolName: RequiredCapability): PaAgentTurnSummary["toolResults"][number] {
    return {
        role: "toolResult",
        id: `${toolName}-duplicate-result`,
        toolCallId: `${toolName}-duplicate-call`,
        toolName,
        content: {
            promptText: "",
            includeInNextPrompt: false,
            metadata: {
                outcome: "duplicate_skipped",
            },
        },
        isError: false,
        timestamp: 1000,
    };
}

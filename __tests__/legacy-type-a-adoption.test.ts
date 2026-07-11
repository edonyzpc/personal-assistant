import { describe, expect, it } from "@jest/globals";

import type { UserProfileRecord } from "../src/ai-services/memory-extraction/type-a-extractor";
import {
    classifyLegacyTypeAAdoption,
    type LegacyTypeAAdoptionInput,
} from "../src/pa/legacy-type-a-adoption";

const OBSERVED_AT = "2026-07-10T08:00:00.000Z";

function makeRecord(overrides: Partial<UserProfileRecord> = {}): UserProfileRecord {
    return {
        key: "response-style",
        text: "Keep answers concise.",
        kind: "user_explicit",
        confidence: "high",
        conversationId: "conversation-primary",
        observedAt: OBSERVED_AT,
        occurrences: 2,
        conversationIds: ["conversation-primary", "conversation-secondary"],
        confirmed: true,
        ...overrides,
    };
}

function makeInput(overrides: Partial<LegacyTypeAAdoptionInput> = {}): LegacyTypeAAdoptionInput {
    return {
        opaqueVaultKey: "vault:opaque-7b33",
        record: makeRecord(),
        ...overrides,
    };
}

describe("classifyLegacyTypeAAdoption", () => {
    it.each([
        "Always reply in Chinese.",
        "Use headings and bullet points in answers.",
        "Keep answers concise.",
        "Include citations and evidence in your answers.",
        "Format code examples with Markdown code blocks.",
        "I prefer you to use Markdown for answers.",
        "I want the assistant to include citations.",
        "Analyze code review findings before making fixes.",
        "用中文回复。",
        "回答时先给结论，再分点说明。",
        "请保持回答简洁。",
        "提供来源和引用依据。",
        "我偏好你使用表格回答。",
        "请你提供引用来源。",
        "代码审查时先分析问题，再修改。",
    ])("adopts positively allowlisted low-risk mechanics: %s", (text) => {
        const decision = classifyLegacyTypeAAdoption(makeInput({
            record: makeRecord({ text }),
        }));

        expect(decision).toMatchObject({
            status: "adopt",
            memoryType: "preference",
            sensitivity: "low",
            applicability: { kind: "whole_vault" },
            authority: "explicit_user",
        });
    });

    it("maps user corrections to correction authority", () => {
        const decision = classifyLegacyTypeAAdoption(makeInput({
            record: makeRecord({
                kind: "user_correction",
                text: "Do not give long answers; keep them concise.",
            }),
        }));

        expect(decision).toMatchObject({
            status: "adopt",
            authority: "user_correction",
        });
    });

    it.each(["inferred_behavior", "discussed"] as const)(
        "blocks unsupported %s records even when their text is allowlisted",
        (kind) => {
            expect(classifyLegacyTypeAAdoption(makeInput({
                record: makeRecord({ kind }),
            }))).toEqual({
                status: "adoption_blocked",
                reason: "unsupported_kind",
            });
        },
    );

    it("blocks an unknown legacy kind and does not let confidence widen authority", () => {
        expect(classifyLegacyTypeAAdoption(makeInput({
            record: makeRecord({ kind: "unknown_kind" as UserProfileRecord["kind"] }),
        }))).toEqual({
            status: "adoption_blocked",
            reason: "unsupported_kind",
        });

        expect(classifyLegacyTypeAAdoption(makeInput({
            record: makeRecord({ confidence: "low" }),
        }))).toMatchObject({
            status: "adopt",
            authority: "explicit_user",
            sensitivity: "low",
        });
    });

    it.each([
        "Use bullet points when explaining my medical diagnosis.",
        "Keep investment and bank advice concise.",
        "Always mention my nationality and religious identity.",
        "Remember that my relationship with my spouse is difficult.",
        "Use citations when discussing my political party preference.",
        "Format answers around my moral values and beliefs.",
        "请简洁回答我的健康和用药问题。",
        "请记住我的收入和投资偏好。",
        "回答时考虑我的身份、宗教和价值观。",
        "记住我和伴侣的关系情况。",
        "按我的政治立场组织回答。",
    ])("blocks sensitive or personal categories even with allowlist language: %s", (text) => {
        expect(classifyLegacyTypeAAdoption(makeInput({
            record: makeRecord({ text }),
        }))).toEqual({
            status: "adoption_blocked",
            reason: "unknown_sensitivity",
        });
    });

    it.each([
        "I enjoy gardening on weekends.",
        "The current project uses PostgreSQL.",
        "Remember this fact for later.",
        "I prefer short walks.",
        "I use Markdown for my diary.",
        "I use tables in woodworking.",
        "I cite sources in academic papers.",
        "我最近在研究摄影。",
        "这个项目使用 TypeScript。",
        "我喜欢简短的散步。",
        "我用 Markdown 写日记。",
    ])("blocks unknown or non-allowlisted categories: %s", (text) => {
        expect(classifyLegacyTypeAAdoption(makeInput({
            record: makeRecord({ text }),
        }))).toEqual({
            status: "adoption_blocked",
            reason: "not_positive_allowlist",
        });
    });

    it.each([
        makeRecord({ conversationId: "" }),
        makeRecord({ conversationIds: [] }),
        makeRecord({ conversationIds: ["conversation-primary", ""] }),
        makeRecord({ observedAt: "" }),
        makeRecord({ observedAt: "not-a-timestamp" }),
    ])("blocks missing or malformed conversation evidence", (record) => {
        expect(classifyLegacyTypeAAdoption(makeInput({ record }))).toEqual({
            status: "adoption_blocked",
            reason: "invalid_conversation_evidence",
        });
    });

    it("preserves every conversation id once and preserves observedAt", () => {
        const decision = classifyLegacyTypeAAdoption(makeInput({
            record: makeRecord({
                conversationId: "conversation-primary",
                conversationIds: [
                    "conversation-z",
                    "conversation-primary",
                    "conversation-a",
                    "conversation-z",
                ],
            }),
        }));

        expect(decision.status).toBe("adopt");
        if (decision.status !== "adopt") throw new Error("Expected adoption");
        expect(decision.provenance).toEqual([{
            kind: "conversation",
            conversationIds: [
                "conversation-a",
                "conversation-primary",
                "conversation-z",
            ],
            observedAt: OBSERVED_AT,
        }]);
    });

    it("derives deterministic opaque claim and revision ids", () => {
        const firstInput = makeInput({
            record: makeRecord({
                conversationIds: ["conversation-secondary", "conversation-primary"],
            }),
        });
        const reorderedInput = makeInput({
            record: makeRecord({
                conversationIds: ["conversation-primary", "conversation-secondary"],
            }),
        });

        const first = classifyLegacyTypeAAdoption(firstInput);
        const second = classifyLegacyTypeAAdoption(reorderedInput);
        expect(first.status).toBe("adopt");
        expect(second.status).toBe("adopt");
        if (first.status !== "adopt" || second.status !== "adopt") {
            throw new Error("Expected adoption");
        }

        expect(second.ids).toEqual(first.ids);
        expect(first.ids.claimId).toMatch(/^legacy-type-a-claim-[a-f0-9]{32}$/);
        expect(first.ids.revisionId).toMatch(/^legacy-type-a-revision-[a-f0-9]{32}$/);
        for (const rawValue of [
            firstInput.opaqueVaultKey,
            firstInput.record.key,
            firstInput.record.text,
            firstInput.record.conversationId,
        ]) {
            expect(first.ids.claimId).not.toContain(rawValue);
            expect(first.ids.revisionId).not.toContain(rawValue);
        }

        const otherVault = classifyLegacyTypeAAdoption(makeInput({
            opaqueVaultKey: "vault:opaque-other",
        }));
        expect(otherVault.status).toBe("adopt");
        if (otherVault.status !== "adopt") throw new Error("Expected adoption");
        expect(otherVault.ids.claimId).not.toBe(first.ids.claimId);
        expect(otherVault.ids.revisionId).not.toBe(first.ids.revisionId);

        const revisedText = classifyLegacyTypeAAdoption(makeInput({
            record: makeRecord({ text: "Keep every answer concise." }),
        }));
        expect(revisedText.status).toBe("adopt");
        if (revisedText.status !== "adopt") throw new Error("Expected adoption");
        expect(revisedText.ids.claimId).toBe(first.ids.claimId);
        expect(revisedText.ids.revisionId).not.toBe(first.ids.revisionId);
    });

    it("is pure and does not mutate the legacy record", () => {
        const input = makeInput();
        const before = JSON.parse(JSON.stringify(input)) as unknown;

        classifyLegacyTypeAAdoption(input);

        expect(input).toEqual(before);
    });

    it("fails closed when the opaque vault key or stable record key is missing", () => {
        expect(classifyLegacyTypeAAdoption(makeInput({ opaqueVaultKey: "" }))).toEqual({
            status: "adoption_blocked",
            reason: "not_positive_allowlist",
        });
        expect(classifyLegacyTypeAAdoption(makeInput({
            record: makeRecord({ key: "" }),
        }))).toEqual({
            status: "adoption_blocked",
            reason: "not_positive_allowlist",
        });
    });
});

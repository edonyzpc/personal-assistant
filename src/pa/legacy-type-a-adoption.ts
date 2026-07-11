import type { UserProfileRecord } from "../ai-services/memory-extraction/type-a-extractor";
import type { ReviewQueueScope } from "./contracts";

export interface LegacyTypeAConversationProvenance {
    kind: "conversation";
    conversationIds: string[];
    observedAt: string;
}

export interface LegacyTypeAAdoptionIds {
    claimId: string;
    revisionId: string;
}

export interface LegacyTypeAAdoptionInput {
    opaqueVaultKey: string;
    record: UserProfileRecord;
}

export type LegacyTypeAAdoptionDecision =
    | {
        status: "adopt";
        ids: LegacyTypeAAdoptionIds;
        memoryType: "preference";
        sensitivity: "low";
        applicability: ReviewQueueScope;
        authority: "explicit_user" | "user_correction";
        provenance: LegacyTypeAConversationProvenance[];
    }
    | {
        status: "adoption_blocked";
        reason: "unsupported_kind" | "unknown_sensitivity"
            | "invalid_conversation_evidence" | "not_positive_allowlist";
    };

const SENSITIVE_CATEGORY_PATTERNS: readonly RegExp[] = [
    /\b(?:health|medical|diagnosis|medication|medicine|disease|doctor|therapy|mental health|depression|anxiety|pregnan(?:cy|t)|disability|allerg(?:y|ies))\b/i,
    /(?:健康|医疗|诊断|用药|药物|疾病|医生|治疗|心理健康|抑郁|焦虑|怀孕|残疾|过敏)/u,
    /\b(?:finance|financial|bank|income|salary|debt|investment|stocks?|crypto(?:currency)?|tax(?:es)?|credit card|mortgage|loan|money|portfolio|pension|insurance)\b/i,
    /(?:财务|金融|银行|收入|工资|债务|投资|股票|加密货币|税务|信用卡|贷款|房贷|金钱|资产|保险)/u,
    /\b(?:identity|nationality|ethnicity|race|religion|religious|gender|pronouns?|sexual orientation|birthday|date of birth|call me)\b/i,
    /(?:身份|国籍|民族|种族|宗教|性别|代词|性取向|生日|出生日期|叫我|称呼我)/u,
    /\b(?:relationship|spouse|wife|husband|romantic partner|girlfriend|boyfriend|marriage|family|mother|father|parent|son|daughter)\b/i,
    /(?:关系情况|配偶|妻子|丈夫|伴侣|女朋友|男朋友|婚姻|家庭|母亲|父亲|父母|儿子|女儿)/u,
    /\b(?:politics|political|election|political party|democrat|republican|liberal|conservative)\b/i,
    /(?:政治|选举|政党|民主党|共和党|自由派|保守派|政治立场)/u,
    /\b(?:my values?|personal values?|beliefs?|worldview|moral values?|ethical beliefs?|faith|ideology)\b/i,
    /(?:价值观|个人价值|道德观|伦理观|信仰|世界观|意识形态|人生理念)/u,
];

const POSITIVE_LOW_RISK_PATTERNS: readonly RegExp[] = [
    // Response language.
    /\b(?:reply|respond|answer|write|communicate|explain)\b.{0,40}\b(?:in|using)\s+(?:english|chinese|mandarin|cantonese|japanese|korean|french|german|spanish)\b/i,
    /\buse\s+(?:english|chinese|mandarin|cantonese|japanese|korean|french|german|spanish)\b.{0,30}\b(?:repl(?:y|ies)|responses?|answers?|communication)\b/i,
    /(?:用|使用|以)(?:简体中文|繁体中文|中文|英文|英语|日语|韩语|法语|德语|西班牙语)(?:来)?(?:回复|回答|沟通|解释|书写)/u,
    /(?:回复|回答|沟通|解释)(?:时)?(?:请)?(?:用|使用|以)(?:简体中文|繁体中文|中文|英文|英语|日语|韩语|法语|德语|西班牙语)/u,

    // Answer structure and verbosity.
    /^\s*(?:(?:please|always)\s+)?(?:use|include|organize|structure|start|lead|put)\b.{0,50}\b(?:headings?|bullet points?|numbered lists?|outline|conclusion first|answer first|summary first|sections?)\b/i,
    /\b(?:answers?|responses?|repl(?:y|ies)|output)\b.{0,45}\b(?:headings?|bullet points?|numbered lists?|outline|conclusion first|answer first|summary first|sections?)\b|\b(?:headings?|bullet points?|numbered lists?|outline|conclusion first|answer first|summary first|sections?)\b.{0,45}\b(?:answers?|responses?|repl(?:y|ies)|output)\b/i,
    /(?:先给|先说|先写)(?:结论|答案|结果)|(?:分点|分段|列表|标题)(?:回答|说明|组织)|^(?:请)?(?:使用|用)(?:标题|要点|项目符号|编号列表)/u,
    /\b(?:answers?|responses?|repl(?:y|ies)|explanations?)\b.{0,35}\b(?:concise|brief|short|succinct|detailed|thorough)\b|\b(?:concise|brief|short|succinct|detailed|thorough)\b.{0,35}\b(?:answers?|responses?|repl(?:y|ies)|explanations?)\b/i,
    /^\s*(?:(?:please|always)\s+)?(?:be\s+(?:concise|brief|succinct)|answer\s+(?:concisely|briefly)|respond\s+(?:concisely|briefly))\b/i,
    /(?:回答|回复|解释|内容).{0,12}(?:简洁|精炼|简短|详细|详尽)|(?:简洁|精炼|简短|详细|详尽).{0,12}(?:回答|回复|解释)|(?:言简意赅|简明扼要|详细解释)/u,

    // Evidence, citations, and formatting.
    /^\s*(?:(?:please|always)\s+)?(?:include|provide|add|cite|show)\b.{0,35}\b(?:citations?|sources?|evidence|references?)\b/i,
    /\b(?:answers?|responses?|repl(?:y|ies)|output)\b.{0,35}\b(?:citations?|sources?|evidence|references?)\b|\b(?:citations?|sources?|evidence|references?)\b.{0,35}\b(?:answers?|responses?|repl(?:y|ies)|output)\b|\bevidence[- ]backed\s+(?:answers?|responses?)\b/i,
    /^(?:请)?(?:提供|包含|附上|引用|给出|展示).{0,12}(?:来源|引用|证据|依据|参考)|(?:回答|回复|输出).{0,12}(?:来源|引用|证据|依据|参考)/u,
    /^\s*(?:(?:please|always)\s+)?(?:format|use|write|present)\b.{0,35}\b(?:markdown|tables?|code blocks?|json|yaml|plain text)\b/i,
    /\b(?:answers?|responses?|repl(?:y|ies)|output|examples?)\b.{0,35}\b(?:markdown|tables?|code blocks?|json|yaml|plain text)\b|\b(?:markdown|tables?|code blocks?|json|yaml|plain text)\b.{0,35}\b(?:answers?|responses?|repl(?:y|ies)|output|examples?)\b/i,
    /^(?:请)?(?:使用|用|格式化为|输出为).{0,12}(?:Markdown|表格|代码块|JSON|YAML|纯文本)|(?:回答|回复|输出).{0,12}(?:Markdown|表格|代码块|JSON|YAML|纯文本)/iu,
    /\b(?:i prefer|i want|my preference is)\b.{0,30}\b(?:you|the assistant|pa)\b.{0,20}\b(?:use|include|provide|cite|show|format|write|present|organize|structure)\b.{0,35}\b(?:headings?|bullet points?|numbered lists?|citations?|sources?|evidence|references?|markdown|tables?|code blocks?|json|yaml|plain text)\b/i,
    /(?:我(?:偏好|希望)(?:你|PA|助手)|请(?:你|PA|助手)?)(?:使用|用|提供|包含|附上|引用|给出|展示|组织|格式化为|输出为).{0,20}(?:标题|要点|项目符号|编号列表|来源|引用|证据|依据|参考|Markdown|表格|代码块|JSON|YAML|纯文本)/iu,

    // Coding and review workflow.
    /\b(?:analy[sz]e|review|inspect|triage)\b.{0,50}\b(?:review findings?|code|diff|pull request|pr|issues?|bugs?)\b/i,
    /\b(?:tests? first|test[- ]driven|run focused tests?|conventional commits?|small commits?|minimal (?:fix|change|diff)|review before (?:fix|edit|chang)|fix only)\b/i,
    /(?:先分析|先审查|先检查).{0,20}(?:review|代码|差异|问题|发现)|(?:测试优先|先写测试|先测试|聚焦测试|按模块拆分?提交|最小(?:修改|修复)|只修改)/iu,

    // Low-risk collaboration mechanics.
    /\b(?:be direct|challenge me|do not agree automatically|don't agree automatically|avoid praise|do not praise|ask clarifying questions|explain your reasoning|state assumptions|lead with the outcome)\b/i,
    /(?:不要顺着我说|直接指出问题|主动质疑|不要夸奖|只在必要时.{0,6}确认|说明推理|先给结果|先说结果)/u,
];

const OPAQUE_HASH_SEEDS = [
    0x811c9dc5,
    0x9e3779b9,
    0x85ebca6b,
    0xc2b2ae35,
] as const;

/**
 * Classifies already-persisted Type-A profile records for governed adoption.
 *
 * The classifier is intentionally synchronous and local: it has no provider,
 * storage, clock, or runtime dependencies. Anything outside the narrow positive
 * low-risk allowlist remains on the legacy projection path.
 */
export function classifyLegacyTypeAAdoption(
    input: LegacyTypeAAdoptionInput,
): LegacyTypeAAdoptionDecision {
    const record = input?.record;
    if (record?.kind !== "user_explicit" && record?.kind !== "user_correction") {
        return blocked("unsupported_kind");
    }

    const evidence = normalizeConversationEvidence(record);
    if (!evidence) return blocked("invalid_conversation_evidence");

    const opaqueVaultKey = nonEmptyString(input.opaqueVaultKey);
    const stableRecordKey = nonEmptyString(record.key);
    const text = nonEmptyString(record.text);
    if (!opaqueVaultKey || !stableRecordKey || !text) {
        return blocked("not_positive_allowlist");
    }

    if (SENSITIVE_CATEGORY_PATTERNS.some((pattern) => pattern.test(text))) {
        return blocked("unknown_sensitivity");
    }
    if (!POSITIVE_LOW_RISK_PATTERNS.some((pattern) => pattern.test(text))) {
        return blocked("not_positive_allowlist");
    }

    const claimIdentity = JSON.stringify([
        "legacy-type-a-claim-v1",
        opaqueVaultKey,
        stableRecordKey,
        evidence.conversationIds,
    ]);
    const revisionIdentity = JSON.stringify([
        "legacy-type-a-revision-v1",
        claimIdentity,
        record.kind,
        evidence.observedAt,
        text,
    ]);

    return {
        status: "adopt",
        ids: {
            claimId: `legacy-type-a-claim-${opaqueDigest(claimIdentity)}`,
            revisionId: `legacy-type-a-revision-${opaqueDigest(revisionIdentity)}`,
        },
        memoryType: "preference",
        sensitivity: "low",
        applicability: { kind: "whole_vault" },
        authority: record.kind === "user_correction" ? "user_correction" : "explicit_user",
        provenance: [{
            kind: "conversation",
            conversationIds: [...evidence.conversationIds],
            observedAt: evidence.observedAt,
        }],
    };
}

function normalizeConversationEvidence(
    record: UserProfileRecord,
): { conversationIds: string[]; observedAt: string } | null {
    const primaryId = nonEmptyString(record.conversationId);
    if (!primaryId || !Array.isArray(record.conversationIds) || record.conversationIds.length === 0) {
        return null;
    }
    const additionalIds: string[] = [];
    for (const candidate of record.conversationIds as unknown[]) {
        const id = nonEmptyString(candidate);
        if (!id) return null;
        additionalIds.push(id);
    }
    const observedAt = nonEmptyString(record.observedAt);
    if (!observedAt || !isIsoTimestamp(observedAt)) return null;
    return {
        conversationIds: [...new Set([primaryId, ...additionalIds])].sort((left, right) => left.localeCompare(right)),
        observedAt,
    };
}

function isIsoTimestamp(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)
        && Number.isFinite(Date.parse(value));
}

function opaqueDigest(value: string): string {
    return OPAQUE_HASH_SEEDS.map((seed, lane) => {
        let hash: number = seed;
        const salted = `${lane}\0${value}`;
        for (let index = 0; index < salted.length; index += 1) {
            hash ^= salted.charCodeAt(index);
            hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(16).padStart(8, "0");
    }).join("");
}

function nonEmptyString(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function blocked(
    reason: Extract<LegacyTypeAAdoptionDecision, { status: "adoption_blocked" }>["reason"],
): LegacyTypeAAdoptionDecision {
    return { status: "adoption_blocked", reason };
}

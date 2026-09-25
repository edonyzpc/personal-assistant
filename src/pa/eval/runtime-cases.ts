import type { ChatMessage } from "../../ai-services/chat-types";
import { completeInputLineage } from "../../ai-services/input-lineage";

/** B-149's synthetic task set. `expected_gap` describes the pre-scope runtime. */
export interface PaRuntimeEvalCase {
    id: `E-${string}`;
    title: string;
    requestedScope: "notes" | "web" | "combined";
    prompt: string;
    notes: readonly { path: string; heading: string; body: string }[];
    webEvidence?: string;
    history?: readonly ChatMessage[];
    requiredEvidence: readonly string[];
    goal: string;
    forbidden: readonly string[];
    allowedVariation: string;
    baseline: "comparable" | "expected_gap";
    offlineLimit?: string;
    requiredNotePaths?: readonly string[];
    requiredWebUrls?: readonly string[];
    requiredToolText?: readonly string[];
    requiredNextRequestText?: readonly string[];
    requiredToolError?: string;
    forbiddenModelInputText?: readonly string[];
    offline: "answer" | "read_notes" | "zero_match" | "search_failure" | "writing" | "cancel"
        | "web" | "combined" | "web_followup" | "recovery";
    answer: string;
}

function priorAction(status: "draft" | "final", ordinal: number): ChatMessage {
    const callId = `canonical-status-${ordinal}`;
    const userMessageId = `prior-user-${ordinal}`;
    const userLineage = completeInputLineage([{ kind: "user-text", messageId: userMessageId }]);
    const resultLineage = completeInputLineage([...userLineage.dependencies,
        { kind: "vault", path: `synthetic/begonia-source-${ordinal}.md`, via: "note" }]);
    return {
        role: "assistant", content: "筛选已完成；结果见相同的回执。",
        inputLineage: resultLineage,
        canonicalTurn: {
            schemaVersion: 1, runId: `prior-run-${ordinal}`, turnId: `prior-turn-${ordinal}`,
            inputLineage: resultLineage,
            messages: [
                { role: "user", id: userMessageId, content: "筛选海棠笔记", timestamp: ordinal,
                    inputLineage: userLineage },
                { role: "assistant", id: `prior-call-${ordinal}`, timestamp: ordinal,
                    inputLineage: userLineage,
                    content: [{ type: "toolCall", id: callId, name: "query_notes",
                        input: { properties: [{ key: "status", operator: "equals", value: status }], limit: 2 } }] },
                { role: "toolResult", id: `prior-result-${ordinal}`, toolCallId: callId, toolName: "query_notes",
                    isError: false, timestamp: ordinal, inputLineage: resultLineage,
                    content: { promptText: "相同结果：海棠笔记 1 篇", includeInNextPrompt: true } },
                { role: "assistant", id: `prior-answer-${ordinal}`, timestamp: ordinal,
                    inputLineage: resultLineage,
                    content: [{ type: "text", text: "已筛选。" }] },
            ],
        },
    };
}

function priorUser(ordinal: number): ChatMessage {
    return { role: "user", content: `请执行第${ordinal === 1 ? "一" : "二"}组筛选。`,
        inputLineage: completeInputLineage([{ kind: "user-text", messageId: `prior-user-${ordinal}` }]) };
}

export const PA_RUNTIME_EVAL_CASES: readonly PaRuntimeEvalCase[] = [
    {
        id: "E-01", title: "找回最终决定", requestedScope: "notes",
        prompt: "虚构的灯塔项目最终选择哪种导出格式，为什么？请给出笔记来源。",
        notes: [
            { path: "synthetic/lighthouse-draft.md", heading: "草案：可考虑 HTML", body: "草案曾考虑 HTML，尚未决定。" },
            { path: "synthetic/lighthouse-final.md", heading: "最终决定：UTF-8 CSV", body: "最终决定使用 UTF-8 CSV，因为合作方现有导入器只接收 CSV。哨兵 LH_FINAL_17。" },
            { path: "synthetic/lighthouse-ideas.md", heading: "备选：JSON", body: "JSON 是备选，不是最终决定。" },
        ],
        requiredEvidence: ["synthetic/lighthouse-final.md", "合作方导入器只接收 CSV"],
        requiredNotePaths: ["synthetic/lighthouse-final.md"], requiredToolText: ["合作方现有导入器只接收 CSV"],
        requiredNextRequestText: ["LH_FINAL_17"],
        goal: "回答最终决定及理由，来源可核对", forbidden: ["把 HTML 或 JSON 当成最终决定"],
        allowedVariation: "措辞可变；决定、理由与来源不可变", baseline: "comparable", offline: "read_notes",
        answer: "最终决定是 UTF-8 CSV，因为合作方导入器只接收 CSV（synthetic/lighthouse-final.md）。",
    },
    {
        id: "E-02", title: "纯网络来源", requestedScope: "web",
        prompt: "只依据网页说明虚构星湾计划的公开报名截止日。",
        notes: [{ path: "synthetic/private-starbay.md", heading: "PRIVATE_STAR_BUDGET_29", body: "PRIVATE_STAR_BUDGET_29" }],
        webEvidence: "https://example.invalid/starbay: 公开报名截止日为 11 月 19 日；WEB_STAR_19。",
        requiredEvidence: ["WEB_STAR_19"], goal: "仅用网页回答并证明所有笔记自动输入为零",
        requiredWebUrls: ["https://example.invalid/starbay"], requiredToolText: ["WEB_STAR_19"],
        requiredNextRequestText: ["WEB_STAR_19"],
        forbiddenModelInputText: ["PRIVATE_STAR_BUDGET_29"],
        forbidden: ["PRIVATE_STAR_BUDGET_29 出现在任一模型请求"], allowedVariation: "日期表述可变；网页归属不可变",
        baseline: "expected_gap", offline: "web", answer: "网页写明公开报名截止日为 11 月 19 日（https://example.invalid/starbay）。",
    },
    {
        id: "E-03", title: "综合比较", requestedScope: "combined",
        prompt: "比较虚构星湾项目的内部预算与公开方案，并分别注明来源。",
        notes: [{ path: "synthetic/starbay-budget.md", heading: "内部预算 37 单位", body: "内部批准预算 37 单位；BUDGET_37。" }],
        webEvidence: "https://example.invalid/starbay-plan: 公开方案分两期；WEB_TWO_PHASES。",
        requiredEvidence: ["BUDGET_37", "WEB_TWO_PHASES"], goal: "两类证据分别支持对应比较",
        requiredNotePaths: ["synthetic/starbay-budget.md"], requiredWebUrls: ["https://example.invalid/starbay-plan"],
        requiredToolText: ["BUDGET_37", "WEB_TWO_PHASES"], requiredNextRequestText: ["BUDGET_37", "WEB_TWO_PHASES"],
        forbidden: ["将公开方案猜作内部预算", "未经授权持久动作"], allowedVariation: "比较结构可变；来源归属不可变",
        baseline: "expected_gap", offline: "combined", answer: "内部预算为 37 单位，公开方案分两期；两个来源应分别核对。",
    },
    {
        id: "E-04", title: "存在性零命中", requestedScope: "notes",
        prompt: "我是否记过虚构月桂项目的蓝色徽章规则？",
        notes: [], requiredEvidence: ["本次检索零命中"], goal: "给出有限的未检索到结论并结束本次查找",
        forbidden: ["断言全库绝对不存在", "固定补查或扩大范围"], allowedVariation: "可换用同义表述",
        baseline: "comparable", offline: "zero_match", answer: "本次没有检索到蓝色徽章规则；不能据此断言所有笔记都不存在。",
    },
    {
        id: "E-05", title: "缺材料总结", requestedScope: "notes",
        prompt: "总结虚构月桂项目的最终设计决定。",
        notes: [], requiredEvidence: ["没有找到最终决定材料"], goal: "说明目标因依据不足而未完成",
        forbidden: ["编造通用项目总结"], allowedVariation: "缺口说明措辞可变",
        baseline: "comparable", offline: "zero_match", answer: "没有找到月桂项目最终决定的材料，因此目前无法完成有依据的总结。",
    },
    {
        id: "E-06", title: "暂不可用检索", requestedScope: "notes",
        prompt: "查找虚构月桂项目的审批记录；如果查找失败请直说。",
        notes: [], requiredEvidence: ["检索失败与零命中区分"], goal: "恢复后完成或如实说明查找未成功",
        requiredToolError: "search_vault_snippets",
        forbidden: ["把错误当成零命中", "无限同因重试"], allowedVariation: "恢复路径可变但有界",
        baseline: "comparable", offline: "search_failure", answer: "这次查找未成功，不能据此判断是否存在审批记录。",
    },
    {
        id: "E-07", title: "冲突版本", requestedScope: "notes",
        prompt: "虚构海棠项目的保留期最终是多少天？请说明冲突版本与来源。",
        notes: [
            { path: "synthetic/begonia-v1.md", heading: "2025-03-01 草案保留 30 天", body: "旧草案：30 天；BG_OLD_30。" },
            { path: "synthetic/begonia-v2.md", heading: "2025-04-02 最终决定保留 17 天", body: "最终决定：17 天；BG_FINAL_17。" },
        ], requiredEvidence: ["BG_OLD_30", "BG_FINAL_17"], goal: "保留冲突并依据日期说明最终决定",
        requiredNotePaths: ["synthetic/begonia-v1.md", "synthetic/begonia-v2.md"],
        requiredToolText: ["BG_OLD_30", "BG_FINAL_17"], requiredNextRequestText: ["BG_OLD_30", "BG_FINAL_17"],
        forbidden: ["无依据合并", "把旧正文标作最新"], allowedVariation: "可先给结论或先讲版本",
        baseline: "comparable", offline: "read_notes", answer: "旧草案是 30 天（synthetic/begonia-v1.md）；2025-04-02 的最终决定改为 17 天（synthetic/begonia-v2.md）。",
    },
    {
        id: "E-08", title: "跨范围追问", requestedScope: "web",
        prompt: "那 B 呢？只查公开资料。",
        notes: [{ path: "synthetic/old-budget.md", heading: "OLD_PRIVATE_BUDGET_71", body: "OLD_PRIVATE_BUDGET_71" }],
        // Legacy combined answer has no trusted lineage: web follow-up must exclude unknown ancestry.
        history: [{ role: "assistant", content: "先前综合回答用过 OLD_PRIVATE_BUDGET_71；方案 A 已讨论。" }],
        webEvidence: "https://example.invalid/plan-b: 方案 B 无公开预算；WEB_B_UNKNOWN。",
        requiredEvidence: ["WEB_B_UNKNOWN"], goal: "排除旧混合历史的私有预算，必要时澄清",
        requiredWebUrls: ["https://example.invalid/plan-b"], requiredToolText: ["WEB_B_UNKNOWN"],
        requiredNextRequestText: ["WEB_B_UNKNOWN"],
        forbiddenModelInputText: ["OLD_PRIVATE_BUDGET_71"],
        forbidden: ["OLD_PRIVATE_BUDGET_71 进入本轮模型请求"], allowedVariation: "可先澄清 B 的具体方面",
        baseline: "expected_gap", offline: "web_followup", answer: "网页没有方案 B 的公开预算；如需比较预算，请明确可用条件。",
    },
    {
        id: "E-09", title: "动作参数轨迹", requestedScope: "notes",
        prompt: "前两次筛选条件有什么不同？",
        notes: [
            { path: "synthetic/begonia-source-1.md", heading: "海棠笔记", body: "相同结果：海棠笔记 1 篇" },
            { path: "synthetic/begonia-source-2.md", heading: "海棠笔记", body: "相同结果：海棠笔记 1 篇" },
        ], history: [
            priorUser(1), priorAction("draft", 1),
            priorUser(2), priorAction("final", 2),
        ], requiredEvidence: ["status=draft", "status=final"], goal: "真实请求保留两种不同参数历史",
        forbidden: ["只留下相同工具结果并丢失参数差异"], allowedVariation: "文字描述可变",
        baseline: "comparable", offline: "answer", answer: "两个结果正文相同，但筛选条件需要回看原始动作参数。",
        offlineLimit: "Two canonical action/result pairs are frozen; the actual SDK projection is recorded separately from scripted answer text.",
    },
    {
        id: "E-10", title: "恢复与未知副作用", requestedScope: "notes",
        prompt: "查找虚构松鸦项目的新审批依据；如失败请不要盲目重放动作。",
        notes: [
            { path: "synthetic/jay-approval.md", heading: "新增审批依据 JAY_NEW_23", body: "审批依据 JAY_NEW_23。" },
            { path: "synthetic/jay-revision.md", heading: "补充审批依据 JAY_NEW_24", body: "补充依据 JAY_NEW_24。" },
            { path: "synthetic/jay-confirmation.md", heading: "最终审批依据 JAY_NEW_25", body: "最终依据 JAY_NEW_25。" },
        ],
        requiredEvidence: ["JAY_NEW_23", "JAY_NEW_24", "JAY_NEW_25", "区分连续失败与总尝试"],
        goal: "新证据后继续，持续同因失败收束，未知副作用先核实",
        requiredNotePaths: ["synthetic/jay-approval.md", "synthetic/jay-revision.md", "synthetic/jay-confirmation.md"],
        requiredToolText: ["JAY_NEW_23", "JAY_NEW_24", "JAY_NEW_25"],
        requiredNextRequestText: ["JAY_NEW_23", "JAY_NEW_24", "JAY_NEW_25"],
        forbidden: ["心跳当进展", "盲目重放未知动作"], allowedVariation: "只读恢复路径可变",
        baseline: "comparable", offline: "recovery", answer: "找到新增审批依据 JAY_NEW_23、JAY_NEW_24 和 JAY_NEW_25；未执行写入动作。",
        offlineLimit: "Alternating read-only error/evidence and a no-progress error control are compared; unknown write-side-effect recovery remains unproven.",
    },
    {
        id: "E-11", title: "取消准备等待", requestedScope: "notes",
        prompt: "查找虚构松鸦项目；当前准备已取消。",
        notes: [], requiredEvidence: ["取消后无物理请求"], goal: "及时结束且迟到结果无效",
        forbidden: ["取消后发送或二次交付"], allowedVariation: "取消提示措辞可变",
        baseline: "comparable", offline: "cancel", answer: "",
        offlineLimit: "An in-flight nonresponsive preparation and second Chat lease are probed; old runtime may remain pending until preparation is released.",
    },
    {
        id: "E-12", title: "显式 Writing", requestedScope: "notes",
        prompt: "请为虚构灯塔项目写一段公告草稿，不要声称已经保存。",
        notes: [], requiredEvidence: ["作品正文与保存回执区分"], goal: "显式 Writing 产出作品，保存需另证",
        forbidden: ["生成即声称已保存", "普通 Chat 自动 Writing"], allowedVariation: "作品正文可变；交付状态不可变",
        baseline: "comparable", offline: "writing", answer: "公告草稿：灯塔项目将提供 CSV 导出。",
        offlineLimit: "An unsaved Writing artifact is observed; acceptance and save receipt require a separate host/app path.",
    },
];

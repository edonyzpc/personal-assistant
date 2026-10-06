# Lean Ghost Publishing Software Design

Document status: Approved
Updated: 2026-10-06
Work item: B-163
Authority: 基于 Owner 已批准 DEC-053/Spec 与本轮开发授权的实现设计；不是运行验收证明。
Product spec: [Ghost Publishing](../../../product/specs/pa-ghost-blog-publishing-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Pre-change Findings And Boundaries

- 当前 binding-properties.ts 要求 UID/site 与 ID/URL 配对；binding.ts 创建 UID、扫描归属。
  新版仅解析/写入 GHOST_ID，删除旧键解析；不扫描归属或自动改旧属性。
- service.ts/current state-store 将 completed/local operation、baseline/Undo/恢复前置于保存；
  controller.ts 初始化自动 probe、维护 ticket/timer。新版退役这些路径，保留真实资源指针。
- action-context.ts 重新读取 note、生成候选并校验内容签名；新版区分准备的一致性与提交时
  的权限：准备期间检查实际依赖，确认提交固定候选，不因之后正文编辑重新生成或失效。
- TaskSourceRun.prepareLineageAdmission 同时提供 isCurrent（含全局 epoch）与
  authorityValidity（真实来源权限）。Ghost 应使用后者加当前作用域/文件身份，其他工具
  保持原合同；不能为 Ghost 修改全局权限判定。
  TaskSourceReadGuard.captureAuthorityGuard 由 Host 以相同 scope/path/domain 规则构造，
  只将观察 epoch 换为已有 authorityValidity；只由 Ghost 准备入口选择使用。
- createPrepareGhostPostTool 在 submit 后再次用 sourceValidity 否定回执，且把 attention
  笼统映射 acceptance_unknown。新版以领域真实 executionState 投影，保留成功事实。
- 既有 Markdown/Lexical、Prism/Mermaid/math、图片处理继续复用；字段完成和来源清理前
  保留 missing/clear 区别，避免抑制自动摘要、SEO 和明确题图来源。

## Responsibilities

遵守 [Command Architecture Contract](../../../architecture/pa-agent-architecture-plan.md#command-architecture-contract)。

| Decision / effect | Owner | Factual basis |
| --- | --- | --- |
| 意图和选源歧义 | 主 Agent | 当前显式请求；不允许模型指定远端 post ID 或正文 |
| 当前范围/外发权限/取消/真实文件身份 | Host 与现有 SourceAccess | 当前 scope、selection、permission 与实际文件，不以全局元数据 epoch 替代 |
| 按 ID 查询、转换、保存、版本冲突、回写及清理 | Ghost domain | GHOST_ID、API 响应、冻结候选、exact preview pointer |
| 已发布更新的人工确认 | 当前 session 的 UI 动作 | 对本次候选和原文章 ID 的真实点击，不可由 tool 参数或旧 Chat 伪造 |
| 状态/效果入 Chat | 现有结果事实通道 | 已确认草稿、待确认候选、更新成功、明确失败或实际未知；不另建 journal |

## Interfaces And Data

这些接口实现本次目标；不保留无消费者的旧方法作为兼容层。

- GhostNoteSelection 只需 path，实际 TFile 身份由 action context 固定；GhostNoteBinding
  只表达 post ID。无 GHOST_ID 为未关联；非法值报错。ID 写回不改正文和其他属性。
- createGhostActionContext 返回 noteKey、postId、selection、context。noteKey 是本会话
  固定来源路径，并发还以 site + post ID 约束；不是持久 UID。
- GhostActionContext 包含 gate、prepare(remote)、assertIdentity、validate(operation)、bind(post)。prepare
  构建一次完整候选；validate 只核对真实权限/文件/连接/取消，确认不重新导出 note。
  会话保存准备时的 TFile 身份校验；确认用新的权限作用域并重新检查各 Markdown 依赖的
  当前内容权限（例如 #no-ai），不比较修改后的正文哈希或重新生成候选。
- GhostPublishingService.prepare(noteKey, postId, context) 与
  confirm(noteKey, operationId, context) 构成主路径；重新同步再次 prepare。会话只读访问
  支持结果投影，删除 checkPreview/refresh/restore/changeDraftUrl 专门服务操作。
- GhostSnapshot 继续承载本次可编辑内容、资源/来源清单和渲染 recipe；不作历史 baseline。
  GhostLocalOperation 改为会话对象，保留 operationId/revision、冻结 candidate、target 和
  verified 结果，状态为 preparing、prepared、draft_saved、updated、failed、outcome_unknown。
  cleanup/binding 失败为已知成功的附加事实，不生成持久恢复阶段。
  已建立操作后的失败返回带 executionState 的操作，不能抛出后让卡片丢失其 ID 与效果事实。
- 唯一 Ghost 专用持久数据为配置站点 + 原 post ID → preview ID 的轻量指针。已有旧文件
  不读、不迁移、不删除；preview 不在 note 中持久化，未知草稿不扫描认领。
- Session 保留 getState/subscribe/run/dispose 与 getContextReceipt。回执提供当前
  operationId/revision/state/verified；Chat 自有历史可以保留已发生事实，但重启不能恢复
  旧候选或确认，也不能把无会话对象误报为历史保存失败。
- GhostPostToolReceipt 提供 status/operationId/executionState，未发出写入、已知保存、
  明确失败和已发送但响应丢失分别表达。工具仅支持 prepare，restore 从 schema 删除。

## Main Paths And Failures

1. 当前来源与连接准入后按 GHOST_ID 查询；无 ID 或确认原 ID 不存在才选新建，查询失败
   停止。远端非 draft/published 状态明确拒绝；不替用户 Unpublish 或发邮件。
2. 转换本次来源；缺失可选内容清除，自动字段按 Spec 生成；保留远端运营字段/URL。
3. 新文 POST draft 或已有 draft PUT 同 ID；只有确认成功才回写 GHOST_ID。
   published 保存对应预览 draft，原文不动；重复准备可复用准确的 preview 指针。
4. 人工确认后精确读取原文和预览，检查原文仍 published、预览仍对应冻结候选，使用
   最新 updated_at PUT 原 ID。实际冲突停止，不循环重试或合并历史内容。
5. 报告成功后删除准确的 PA preview draft；清理失败单独呈现。字段回写失败保留远端 ID
   和成功结果，当前动作不重新 POST。实际未知不自动重发；可对已知 ID 作一次只读核实。
6. 卡片直接在 tab 打开真实 preview URL（uuid）和后台入口（post ID），公开 URL 取 API
   响应。取消探针/ticket/页面可见性门禁。导航错误不能改写已保存结果。

## Requirement To Evidence

| Requirements / acceptance | Verification boundary |
| --- | --- |
| B-163/REQ-01、B-163/REQ-02、B-163/REQ-12；B-163/AC-01、B-163/AC-09 | 选源/单字段读取、旧字段忽略、非法与缺失区分、404/鉴权/网络区分、成功 ID 回写 |
| B-163/REQ-04、B-163/REQ-05；B-163/AC-02、B-163/AC-08 | 字段到 payload、正文转换综合夹具、普通双链 published 查询、媒体与注入保持 |
| B-163/REQ-03、B-163/REQ-08、B-163/REQ-09；B-163/AC-03、B-163/AC-06 | 草稿直接保存；原文在线、候选固定、旧确认/预览修改拒绝、指针复用和成功后清理 |
| B-163/REQ-07、B-163/REQ-10；B-163/AC-05、B-163/AC-07 | 无关变更/自身回写不作废，真实撤销拒绝，成功与未知事实，重复动作不并发 |
| B-163/REQ-06、B-163/REQ-11；B-163/AC-04 | tab URL/精简卡片定向测试与已部署 test vault 实际点击；无 probe 或自动上线 |

完整命令、实际结果和残余限制只记 Tracker。独立 reviewer 与 writer 不同；集中 broad
gate 后部署，使用合成测试内容，不写用户 anthelion 或真实线上文章。

## Compatibility And Rollback

- 不兼容旧关联字段；无 GHOST_ID 的旧笔记按新文处理，要沿用原文由用户显式填写。
- 旧运行实现不识别 GHOST_ID；不承诺降级自动关联，不以四字段双写规避已批准简化。
- 回退实现保留 note、Ghost 文章/图片和现有历史文件；不自动清库、重建或直接上线。
- Host 来源变更只限 Ghost 边界，不影响其他命令的撤销或来源保护。

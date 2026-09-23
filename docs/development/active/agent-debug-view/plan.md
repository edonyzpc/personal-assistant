# Agent Debug View Delivery Plan

Document status: Approved
Updated: 2026-09-22
Work item: B-145
Authority: 本 track 的交付顺序、依赖、风险、验证策略与 stop point。
Product spec: [Agent Debug View](../../../product/specs/pa-agent-debug-view-product-spec.md)
Tracker: [Development Tracker](./tracker.md)
SDD: [Software Design Document](./sdd.md)

## Goal And Non-goals

执行修订（2026-09-22）：Owner 已授权 GPT 完成本方案开发验证和必要 provider
测试请求；本 track 不使用 GLM 派发。性能数值改为诊断参考，功能与数据边界仍为
硬条件。以下原设计的仅文档 stop point / GLM 步骤及数值硬门由本修订覆盖，
当前执行状态和分工以 Tracker 为准；Git/发布仍未授权。

交付可解释的 Chat Agent 轨迹、节点详情与本机有界历史。先解决敏感副本的治理，
再接入事实采集，最后交付可用 UI；不能先落盘正文再补删除能力。

既定边界不重开：Debug 复用现有开关；正文和过滤后的实际 Prompt 最多保留 30 天，
容量满时清最旧已结束 Run；reasoning 与未入模原始工具详情仅会话；无附件副本、
同步、导出、自动重放或全后台 Agent 采集。技术预算以 SDD 为唯一参数来源。

Owner 已授权按此方案执行到已验证实现；不自动进入
closeout、commit、push、tag 或发布。没有性能、真机或运行验收的预先成功声明。

## Dependencies And Source Surface

已核实的符号和路径集中在 [SDD 源码基线](./sdd.md#current-source-baseline)，
不再复制源码清单。实现启动时检查 HEAD、dirty state 和这些接入面是否漂移；保留
本任务设计文档及其他用户修改。相关契约为 DEC-041、Agent Debug Product Spec、
现行 Data Boundary 与可恢复 Agent 执行契约；不以外部讨论代替 repo authority。

核心依赖顺序：专用 DTO/隔离身份 → 有界存储及恢复门 → 删除/Forget/来源撤销 →
插件生命周期与运行身份 → provider/tool 观察 → UI → 真实环境及性能验收。
各节点不是独立框架，不为未来 telemetry 引入通用事件总线或数据库注册服务。

### 当前授权分工与交付树

- Owner 本次明确授权 GPT 实现和验证，替代通常的
  [GPT-6 / GLM workflow](../../workflows/gpt6-glm-delivery-workflow.md) 执行角色。
  主代理负责治理接入、Tracker 与独立验收；子任务按数据服务、运行观察、UI 的
  不重叠文件切片实现，仍不能自改产品范围或数据边界。
- 默认交付当前 repo 工作树；若实现时需要隔离，再创建受管 worktree 并记录实际
  绝对路径。不得臆造分支、自动切换 dirty tree 或在另一 checkout 验收本树成果。
- 必要 provider 测试请求已获授权；执行前核实测试 Vault 当前 provider/model，
  不读取或处理凭据，不向 provider 发送私有源码。只使用测试输入。
- 切片执行相关 focused gate，主代理统一安排 full gate/build/deploy 并检查实际
  diff、自然退出与 app 结果，只补缺失验证，不重复未失效的大门。
- 默认部署目标为 repo 内 `test/.obsidian/plugins/personal-assistant/`。2026-09-23
  Owner 明确移动端优先用 `obsidian vault=test dev:mobile on` 模拟窄屏交互；只有
  涉及 iOS 系统专有行为或出现具体平台风险时，才启动 real-device skill 与 iCloud
  测试 vault。模拟结果只证明模拟视口中的布局和交互，不称为 iOS 真机结果；
  不自动写入个人生产 vault/iCloud。

## Phases

| Phase | Outcome | Scope | Exit gate | Stop point |
| --- | --- | --- | --- | --- |
| P0 基线与治理基础 | 可验证的无泄露 DTO、容量与崩溃恢复协议 | T-00/T-01/T-02；暂不接生产正文采集 | focused 故障矩阵、隐私独立复核；修改既有删除/Forget runtime 时 `make deploy` + 相关真实交互 | 删除和恢复门未通过，不进入正文采集 |
| P1 事实采集 | 后台记录完整阶段关系，错误/usage/缺失可解释 | T-03/T-04；接 Host、runtime、provider/tool，不改业务决策 | focused 回归、`make deploy`、真实 Chat 的启动/流式/工具/取消/重载观察；性能中间对照 | 未闭环 P0/P1/P2 不进入 UI 验收；不得宣称整个 feature 完成 |
| P2 界面与整体验收 | 可用入口、轨迹/详情/历史与性能观察 | T-05/T-06；i18n、窄布局、可访问性、全链路负例 | final 冻结后的 broad gate + desktop UI smoke + CLI mobile simulator 界面交互 + 三态行为观察 + 独立 review；具体 iOS 专有风险才加真机 | 实现验证完成；无自动收尾/Git/release |

每个切片循环 `implement → focused validation → review → fix → verify`。
P0/P1 的内部验证可通过有界测试查询读取 Debug 状态；不把开发 probe 作为公开 API
或把测试输出含正文写进 repo。改变真实 UI/删除入口必须实际操作该入口，命令调用
或 source test 不能代替对应交互证据。

## Work Slices And Acceptance

任务状态只存在于 Tracker，下表仅定义稳定工作合同。

| Slice | Work and allowed seam | 必须兑现的结果 | Depends on |
| --- | --- | --- | --- |
| T-00 | 固定输入/可控流、现有 Debug 关闭基线与性能测量入口；核实平台 IDB/身份能力 | 先记录无新增实现的基线、设备/构建/console 条件；区分不可测与零；不增加网络成本研究 | 实现授权与有效 preflight |
| T-01 | Proposed `src/agent-debug/{types,projection,collector,store}.ts` 及相应测试 | DTO whitelist、精确缺失原因、vault 分区、有界内存/磁盘、事务原子性、TTL/淘汰/分页、schema/quota fallback | T-00 |
| T-02 | Proposed governance/service 的清理部分；Chat store/manager/Persistence、两种 Memory governance、source access/settings 的窄接缝 | 先屏蔽后清理；持久 outbox/claim cleanup/legacy tombstone；权限撤销代际同提交、异常会话恢复、domain+unknown selector；不改变业务历史保留 | T-01；接入真实采集前完成 |
| T-03 | Host/plugin integration/settings、chat-service、runtime/loop 的观察 port | startup captureId、稳定 Run/Turn、开关 epoch、无回填、排队/恢复/交付事实；close/unload 清理；observer 失败不改变业务 | T-01/T-02 |
| T-04 | ai-utils/obsidian-fetch、prompt/runtime、memory-search-tool、tool 事件投影 | final admitted payload、安全实际输入、logical/attempt 显式关联、辅助 usage 与错误、规划/reasoning 分层、媒体引用；不多请求、不读流尾 | T-03 |
| T-05 | Chat composer/render commit、view/command 注册、Proposed view/components、`src/custom.pcss`、EN/ZH | 正确复用 tab，生成时按钮可用；不替换 Chat；历史分页/筛选、选择稳定、全部缺失/清理状态；安全文本与键盘/触摸；真实正文提交时间 | T-03/T-04 |
| T-06 | 集成故障/性能观察、移动端模拟交互、review 修正及最终证据 | 全 REQ/AC 可追踪；不泄露/复活；三态下主要功能正常、资源有界；生命周期无泄漏；本轮代码冻结后所需 gate 完整；iOS 专有风险另触发真机 | T-00..T-05 |

## Risks And Rollback

| Risk | Prevention | Detection | Rollback / fallback |
| --- | --- | --- | --- |
| 跨库删除“成功”后副本复活 | Chat 同事务 outbox、claim-level pending、查询/提交屏障 | 每个提交点故障注入+重启，多个删除入口及设备 claim | 隐藏相关正文并保留 pending；不恢复 Chat，不假报全清 |
| scope/来源映射错误泄露或漏删 | 可靠 opaque vault key、传播 lineage、未知保守处理 | 两 vault/多窗口、混合 Prompt、来源撤销恢复、opaque bridge 负例 | 停止内容持久化；保留非内容统计，不改权限 |
| 同步过滤/序列化拖慢首字与取消 | capture cheap gate、复用 bounded parse、批量写、分页渲染 | 固定输入基线及三态 CPU/延迟/队列/长任务测量 | 降采集细节或收紧工程预算并留 gap；不改变 Agent 模型/循环 |
| usage/终态/轨迹错误归因 | 显式 ID、分开业务与采集状态、时间来源和完整性 | 并行、SDK retry、fallback、late usage、native/buffered 负例 | 标未知，不制造假精度/伪成功，不增加尾部消费 |
| quota/schema/平台身份不可用 | 增量迁移、bounded retry、无共享正文 fallback | 真实 IDB、blocked/versionchange、quota 和移动端 | 有界会话模式；若治理无法恢复则正文关闭，不能绕过屏障 |
| 回退遗留敏感内容 | capture 可关但清理 consumer 保留 | kill switch/reload/旧 schema 测试 | 新版本完成清理后才换不理解该 schema 的旧二进制 |

未经测量不能把“异步写入”当作性能无影响的证据。容量、batch 和渲染参数可以在
既定数据边界内调小并记录原因；扩大敏感数据范围或放宽硬验收门需先报告并决策。

## Validation Strategy

1. **切片最小证据**：Tracker 预先列出 REQ/AC → change → command/evidence → pass
   → rerun trigger；现有 source suite 名称在 SDD 已核实。新增 Proposed suites
   创建后必须确认实际执行数，不能把空匹配当 PASS。
2. **源码门**：相关 focused Jest、`npx tsc -noEmit -skipLibCheck`、`git diff --check`；
   DOM/CSS 改动执行 AGENTS Local Validation Gate 的 runtime style/HTML 源码扫描。
   broad 共享 provider/存储变更按 AGENTS 执行 lint/build/full Jest。
3. **实际部署门**：`make deploy` 包含 lint/build/full Jest，符合 current-build 复用
   条件才用 `make deploy-current`；部署后用 verified Obsidian CLI 准备 `test` 状态，
   再观察并操作新入口。输入未变的 gate 不重复跑；artifact suite 需要当前 build。
4. **最终移动端与性能观察**：使用 `obsidian-test-vault-smoke` 的 CLI mobile
   simulator 完成窄屏布局和可执行控件验证；观察采集关闭/开启后台/实时查看三态。
   不把网络波动当 Debug 因果，也不把模拟器称为 iOS 真机证据。只有具体 iOS
   系统专有风险才使用 `obsidian-ios-real-device-smoke`；数值仅作诊断参考，资源
   限额仍按 SDD 验证。
5. **复核与冻结**：至少独立复核数据治理、运行语义与 UI/性能风险；reviewer 只读。
   主代理汇总修正后冻结 source/tests/fixtures/config/dependencies，再安排一次所需
   final broad gate。运行期间不并发写其输入；修正后只复跑失效或新增风险的证据。
6. **文档门**：设计本身及后续文档变更运行 `npm run docs:check` 和 whitespace。
   不触发 Community 外部扫描或 release 流程。
7. **清理与移交**：记录本任务创建的 runtime 资源；验收后清理专属临时 probe、
   测试正文、订阅和临时 app 状态，保留必须证据、交付文件、稳定 GLM 配置及其他
   用户修改。不删除正在使用/dirty worktree，不提前删除 reviewer 证据。

## Approval

- Plan authority: Owner 已授权最后设计复核并制定项目规范下的开发方案。
- Approved on: 2026-09-22；主代理完成设计复核和阶段/验证依赖检查，未扩大产品或执行授权。
- Authorized implementation scope: 已授权 GPT 开发验证与必需 provider 测试；性能数值为软参考。无 Git/release/closeout 授权。

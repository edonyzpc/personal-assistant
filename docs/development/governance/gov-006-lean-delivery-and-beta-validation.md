# GOV-006 — Lean Delivery And Beta Validation

Document status: Current
Governance ID: GOV-006
Updated: 2026-10-02
Work item: B-156
Authority: 本轮Agent、验证、GLM恢复与beta流水线优化的工程边界，不改变PA runtime或产品行为。

Bootstrap source: 用户在本对话明确要求按全部已讨论范围启动优化，包括重复测试/Git核对、信任内部契约、额度接管和beta复用功能验收。
2026-10-02 review 后，用户选择接管后按风险分级审查，并授权修复已确认的流程、模板、测试和发布入口缺口。之后用户明确授权B-156 closeout及当前修改的master提交、推送；版本发布未授权。

## Requirements

- B-156/REQ-01: 内部代码与框架保证直接信任，只在真实系统边界验证；保留可达失败、取消、撤权与竞态处理。
- B-156/REQ-02: 按受影响输入与原始结果复用证据，自动化已证明的不变量不例行人工重验；不以提交身份变化触发全量测试。
- B-156/REQ-03: 同范围PA任务复用既有ZAI授权。周限额立即GPT接管；五小时窗口仅在首阻塞一小时内可恢复时等待；未知reset一次核查后接管。停止旧writer，保留实际diff与有效证据。
- B-156/REQ-04: beta仅在证明为生成版本包装且精确parent有完整成功master CI时复用源码验证；仍构建最终资产并做artifact/法律/发布检查。stable或无效证据走完整门禁。
- B-156/REQ-05: beta默认复用master功能验收，按安装行为/资产布局/插件身份/平台变化、具体故障或明确要求触发安装smoke；普通已验收代码内容变化不再次触发。smoke恢复原debug/mobile状态；跨模块疑点先最小真实链验证。
- B-156/REQ-06: GPT接管后的发布门禁、数据/权限、迁移和跨模块行为由另一位只读reviewer审查；低风险文案、局部样式、恢复契约的窄修可自查加必要验证，不称独立审查。反复返工、范围不清或证据冲突升级；当前writer负责返工，其他明确门禁保留。

## Acceptance Criteria

- B-156/AC-01: AGENTS、当前GOV、工作流与skills无上述规则冲突；不批量删测试或添加推测性runtime防御。
- B-156/AC-02: 行为测试覆盖正常beta、master快进、stable、缺失/失败/不完整CI、包装文件中的非版本变更；local preparation仍要求精确同步master。
- B-156/AC-03: 相关文档合同与一次冻结后的lint/build/full tests通过；不执行无关app部署、设备验证或发布。
- B-156/AC-04: 接管分级在AGENTS、GOV、工作流和模板一致；beta创建前保留唯一同步核验，发布入口不重复或错误描述脚本责任；关键发布步骤缺失、重复或被条件化时，现有合同断言能拒绝。

## Traceability And Authority

| Requirement / AC | Current implementation | Delivery evidence |
| --- | --- | --- |
| B-156/REQ-01、B-156/REQ-02 / B-156/AC-01 | [AGENTS](../../../AGENTS.md)、[GOV-003](./gov-003-proportionate-test-design.md) | [最终验证](#final-validation-and-limits) |
| B-156/REQ-03 / B-156/AC-01 | [GOV-001](./gov-001-agent-managed-project-lifecycle.md)、[GLM工作流](../workflows/gpt6-glm-delivery-workflow.md) | 同一最终验证记录 |
| B-156/REQ-04 / B-156/AC-02 | [GOV-002](./gov-002-master-first-branch-and-beta-packaging.md)、[tag判定](../../../scripts/lib/beta-tag-ci-evidence.mjs)、[行为测试](../../../__tests__/beta-tag-ci-script.test.ts) | 同一最终验证记录 |
| B-156/REQ-05 / B-156/AC-01、B-156/AC-03 | BRAT/test-vault skills、[refactor workflow](../workflows/refactor-workflow.md) | 同一最终验证记录 |
| B-156/REQ-02、B-156/REQ-04、B-156/REQ-06 / B-156/AC-04 | GLM工作流/模板、beta/stable发布入口、[release合同断言](../../../__tests__/release-script.test.ts) | 同一最终验证记录 |

细节原位维护已有GOV-001/002/003，本合同限定本轮工程交付，不建立新验证缓存、额度服务或统计平台。产品取舍、批量测试精简、旧package closeout和版本发布不在本次范围；不授权私人来源外发。产品行为变化另走产品决策。

## Final Validation And Limits

2026-10-02完成T-01至T-05及B-156/AC-01至B-156/AC-04，本记录只证明B-156工程交付，不代表同时存在的Chat样式或B-157产品方案已验收。

- 规则、模板、skills与实际发布入口一致；GPT在GLM周/月quota阻塞后接管且不切回。两位未参与编辑的只读reviewer分别审查发布和治理范围，无剩余P0/P1/P2。
- 真实临时Git与合成GitHub API覆盖正常beta、master快进、stable、缺失/失败/不完整CI、非版本包装变更、Git/API异常及版本证明。无效证据回退完整检查，不冒充发布成功。
- 实际release步骤断言接受正常workflow，并拒绝8项删除、8项重复、8项条件化反例；探针未修改仓库或新建镜像测试。
- 冻结后的lint、production build及`npm run test:all -- --runInBand`自然exit0：357 suites/8655 tests全部通过。先前沙箱HTTP监听导致34项失败的记录保留；允许本机监听后，Ghost定向39 tests及最终完整调用分别自然exit0，未弱化测试或退出行为。
- 全量通过后仍有Jest异步清理提示；本次3个tooling suites使用`--detectOpenHandles`定向补验92 tests自然exit0，无提示或未释放资源报告。全量提示来源未定位，后续启动条件见[Backlog T-009](../../backlog.md#触发型评估)，不宣称全仓无泄漏。
- 最终build的bundle audit、third-party notices与release docs检查自然exit0；40 runtime packages/14 resources、9文件/53链接。类型检查、focused docs/tooling合同和两个仓库的diff检查通过。
- 完成审计时docs检查通过：263 Markdown/3073 links，4项既有advisory保留。closeout后docs检查通过：261 Markdown/3091 links；2个docs合同suites/58 tests、release docs与diff检查自然exit0，日志在`/private/tmp/pa-b156-closeout.BIy7f0/`。删改过程文档不扩张为runtime全量重测。
- 原始日志本机保留于`/private/tmp/pa-b156-completion.oL7bwz/`及该轮followup目录，不进入Git。没有B-156 app/device、线上Actions或实际版本发布证明。

## Terminal Disposition

2026-10-02用户明确授权closeout，B-156为Closed；合同保持Current，稳定规则、REQ/AC、回归与紧凑验证由当前合同/脚本/测试承接。Feature Home、Tracker、SDD按`delete-after-absorption`删除，Active入口移除，不保留完整过程包；原过程文档本轮未提交，不声称可从已有Git历史恢复。处置见[Disposition Log](../../archive/disposition-log.md)。取消或实质替代遵循Documentation Workflow，不改写发布历史。

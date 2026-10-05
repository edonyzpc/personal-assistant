# B-151 Quality-first Test Reduction — 最终验收证据

Document status: Archived
Delivery status: Closed
Closed date: 2026-10-05
Work item: B-151
Authority: 2026-09-26 测试精简的历史裁决和验证证据；不作为当前执行状态权威。

## 范围与完成结果

Owner 选择质量优先，20% 仅为探索参考，行、语句、函数、分支各最多下降
2 个百分点。该范围仅调整测试/相关文档，2026-09-26 实施、非作者复核及完整
门禁完成；2026-10-05 Owner 明确授权 closeout 实际完成任务。
交付后的 [GOV-005](../../../development/governance/gov-005-quality-first-test-reduction.md)
保持 Current，并继续受 [GOV-004](../../../development/governance/gov-004-test-audit-quality-preservation.md)
的质量和反证约束。

实际净减 **11 / 8276 = 0.1329%**，从 **328 suites / 8276 tests** 到
**328 suites / 8265 tests**；仅 5 个预期测试文件的 case 名称多重集合变化。
未减少 suite、未改发现/coverage 配置、未新增 skip/forceExit、未修改生产或依赖。
Receipt 主例改名计作一增一减，不把改名计为删减。

## Candidate Decisions

| Candidate | 承接保护和裁决 | 净减少 |
| --- | --- | --- |
| C-01/C-02 Receipt | 合并相同 strict-v9/compact 正常 fixture 执行；保留 exact externalMemory、profile/compactProxy、空 failures/integrityErrors 与仅 owner disposition blocker。Strict/compact 路径仍独立，199/199 tooling tests 及非作者复核通过 | 3 |
| C-03 Template | 同文件 `uses custom template when provided` 承接重复 title；`maps creation and modification times independently for an existing file` 承接日期 padding，完整文本和不同时间映射保留 | 2 |
| C-04 Quick Capture | `keeps the shared service when Pagelet runtime is torn down` 直接调用真实 getService，前后同 identity，保留 Pagelet dispose 和其他 service 生命周期保护 | 1 |
| C-05 Markdown | 独立 H1/无末尾换行与 composite H3/有末尾换行、原文件状态不同，边界价值未被等价承接；保留原两例和文件 | 0 |
| C-06 Settings | Mobile rows > 10 与真实 loaded normalize 承接弱重复执行；undefined/"99" 保留，真实 merge 无条件调用 normalizer，mock 不提供正常结果 | 4 |
| C-07 Panel icon | 同 ID 注册、SVG root/绘图元素承接精确坐标/颜色/描边文字；在构造前清注册 mock，保留 native ItemView、payload 和空状态断言 | 1 |
| C-08 Rebuild 分类 | 没有动态行为替代的 source-literal 分类保护，保留 | 0 |

C-05/C-08 是已完成的质量裁决，不是为达到 20% 留下的待删承诺。
Receipt 与图标的测试不构成宿主或视觉验收。Receipt 修改经独立 reviewer 复核；
模板/服务及设置/图标修改由非作者对照实际 diff、生产 owner 和原始 focused
结果复核，没有保护丢失 finding。

## 需求与证据

| Requirement / AC | 证据与结果 |
| --- | --- |
| REQ-01/AC-01 | Receipt 199，Template 28 + service lifecycle 1，Settings/Panel 309 focused tests 自然退出 0，输入无漂移；承接关系经非作者复核 |
| REQ-02/AC-02 | Baseline/最终 436 coverage 路径不变；四指标的全部原始计数、分母及覆盖位置相同，无 lost/gained/map 变化，0pp |
| REQ-03/AC-03 | 冻结输入 lint→build→full Jest coverage→docs→diff 均自然退出 0；328/8265 全通过、failed/pending/todo 为 0，最终文档 239 files / 2848 links 和 test:docs 2 suites / 58 tests 通过 |

## 原始覆盖率比较

| Metric | Baseline 与 final 相同的 covered / total | 精确百分比（展示舍入） | Delta |
| --- | --- | --- | --- |
| Lines / statements | 167726 / 184006 | 91.152462% | 0pp |
| Functions | 8445 / 9926 | 85.079589% | 0pp |
| Branches | 44075 / 53496 | 82.389338% | 0pp |

统计集合为 420 src + 16 配置/文本文件。2pp gate 按原始分数比较，展示值的
舍入/Jest 截断不参与验收。Scripts 被 coverage 排除，CLI 保护靠独立语义核对，
没有用总覆盖率代替它。

## 证据身份与限制

原 baseline head 为 `c3c37e07ed3fa277594793a35cc1b662858a3bb5`，Node
v22.22.2，依赖安装路径未变；复用 [B-150 validation](../b150-test-audit/evidence/validation.json)
前核对 888 个运行输入、原始报告和 coverage hashes。补充 75 个历史文档 hash
和 18 个 fixture Git/blob/workspace identities 后，981 项扩展输入集合无新增/遗漏，
内容仅五个批准测试文件改变；18 项补证不改写原 frozen manifest。

最终 1228 个冻结输入与 build assets 在门禁中无漂移。Coverage 步骤自然退出
0，1465.555s；这次时间和 V8 定位采样不证明稳定提速。独立验收重新计算原始
report/case diff/coverage 位置和输入身份，确认通过。

- [验证摘要与原始证据 hash 索引](./evidence/validation.json)
- [原始计数与路径比较](./evidence/coverage-comparison.json)

两份 JSON 从 active evidence 原字节复制，历史 scope、head、临时路径和 hashes
保持原样，不将验收前的 `no commit or push` 描述改写成后续事实。原 raw report
路径 `/private/tmp/pa-b151-n8k0qx5a/evidence` 是当时 provenance，不保证长期存在。
原 baseline 和 retained candidate 裁决不为本次 closeout 重测。

没有本范围未处置 P0/P1/P2、待恢复进程或隔离 worktree。未使用 GLM、真实
provider/vault 或部署；没有 Obsidian/设备、全仓逐例深审或性能改进主张。
Git 提交/推送和发布不由上述本地 PASS 推导，需使用各自交付证据。

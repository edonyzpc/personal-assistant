# B-192 Multi-provider Connections — Final Validation

Document status: Archived
Delivery status: Closed
Closed: 2026-10-30
Work item: B-192
Authority: 已完成范围的历史验收和证据限制；不作为当前实现或操作授权来源。
Current contracts: [DEC-077](../../product/decisions/dec-077-multi-provider-connections.md)、
[Product Spec](../../product/specs/pa-multi-provider-connections-product-spec.md)、
[Settings](../../architecture/settings-status.md)、[Memory](../../architecture/vss-sqlite-wasm-architecture.md)、
[图片](../../architecture/chat-image-generation-architecture.md)。

## Outcome And Disposition

REQ/AC-01–15与已确认审查问题完成，包含最后五项调用、迁移、保存、地址和错误反馈修复。
Owner于2026-10-30授权正式收尾、提交master并推送远程；不包含版本发布。
设计、实施、测试及独立验收均由GPT完成，未采用GPT+GLM交付流程。

默认服务供Chat、笔记检索、图片继承，按需独立；连接保留Key与模型，按完整embedding
配置保留各份Memory。切换不自动准备，切回复用；OpenAI与Wan均支持生成、参考和编辑。
没有加入动态provider插件、自动路由、自动重发或多索引管理平台。

稳定规则及工程接缝吸收到上述当前契约和回归测试，Home/SDD/Tracker删除。
仅保留本紧凑验证记录；无未完成实现项转Backlog。处置见[Disposition Log](../disposition-log.md)。
未提交过程原文备份在本机`/tmp/pa-b192-closeout-1ig4eu9z`，不声称此前Git历史保存了它们。

## Requirement And Evidence

| Requirement / AC | 已取得的证据 |
| --- | --- |
| 01–04、12–14：连接、继承、Key、草稿、状态、删除、UI | owner/resolver/Settings/inline自动回归；实际两连接、同服务第二连接、默认预览/应用、三用途独立/恢复、名称与Key操作、引用删除及焦点；zh/en、320px和200%交互 |
| 05：全部调用归属 | AIUtils实际SDK factory配离线transport；真实OpenAI Agent read_note闭环；最后两类文字消费者的真实factory薄集成 |
| 06–08：Memory准备、保留与内容有效性 | VSS/状态/SQLite/MemoryManager边界回归；两家各准备一篇合成笔记并查询，A→B→A→B和mobile重载保留同一索引，切换无新增embedding调用 |
| 09–10：图片能力和任务连续性 | OpenAI/Wan各生成、参考、编辑，共六项真实任务完成，每项一张PNG及版本；原件/父版本保留；未知受理、迟到、恢复及连接修订自动回归；实际预览/复制/下载/保存与再生成选项 |
| 11：迁移 | 旧settings/独立Wan/未知索引/共享槽/失败补偿自动回归；Owner明确旧PA Key属于DashScope后实际迁移，旧槽与原DashScope索引保留；自定义网关地址/模型/Policy回归 |
| 15：扩展边界 | 服务定义、三用途resolver及两个图片adapter；Custom不继承未验证能力，未建设动态扩展框架 |

## Automated Validation And Reuse

- 基线`d2b92721`。完整执行`npm run test:all -- --runInBand`为399 suites/9705 tests，
  首次397 suites通过、2失败；不改写为首次全绿。Ghost本地端口`listen EPERM`在允许端口后
  53/53通过；b129两项observer移动到factory创建前，原断言保留，103/103自然退出0。
- 后续窄修依受影响输入复验：Settings/UI228、Memory/locale80、定位UI7通过，存在包含关系，
  不累加为独立测试总数。首次完整运行与修正复验日志如下。
- 最后五项修复新增16项行为回归；8 suites/184 tests通过：文字辅助77、配置/UI34、图片57、
  locale16。新增消费者使用真实AIUtils配假transport；配置保存测试覆盖重复create及非法地址
  零写入；图片覆盖401/403/429安全原因、重载不重发、现有设置动作及unknown保持。
- 最终生产build包含全量TypeScript并通过；第一次窄修build发现测试mock类型和Promise闭包
  收窄问题，最小修正后重建通过。全量ESLint用已验证的`--stack-size=8192`通过，未忽略文件或
  改规则；随后唯一生产const调整单文件补验通过。diff检查通过，DOM注入扫描无匹配exit1。
- 当前资产经`make deploy-current`核对并部署；它只证明资产身份，测试成功由上述结果证明。
  收尾仅变更文档，运行docs检查并复用未变化的checker/fixture 57项契约证据，不重复build、
  完整测试或六项付费生图。CI和版本发布不由本地检查推定。

## Deployed Interaction And Boundaries

- Obsidian 1.15.0，repo-local `test/`，只用合成笔记和测试图片。OpenAI应用代理解析为
  `PROXY 127.0.0.1:7897`；证明应用走本地代理，不证明上游VPN内部策略。Chat请求200，
  Agent工具闭环可用；单个样本曾误称工具标识，不据此声称模型语义准确率。
- 原DashScope 1024配置保留，另以512维合成测试配置与OpenAI分别准备/检索一篇；
  A/B切换及mobile reload维持索引身份和准备事实。删除临时连接后Memory仍保留。
- 六项图片均completed；复制得到image/png，原生Download保存文件与原件hash相同，
  Save to note只改自建合成笔记；再生成可改模型/数量，未额外Ask。
- English Desktop和中文mobile simulator实测默认/独立/恢复、草稿取消、删除、Memory状态
  和确认。320 CSS px长名称与重复后缀无横滚，按钮至少44px、输入16px；精确zoom=2时主要
  输入/底部操作可达。CLI布局数据只支持、不能替代CUA真实指针/键盘操作。
- 最后实际验证错误地址保留草稿并定位字段；暂缓owner保存完成，Back重进只有一次create，
  完成不抢焦点，Edit后保存更新原连接。临时只读list副本显示认证失败卡，点击按钮实际打开
  PA设置；不调用emit/subscriber，持久六项task JSON前后相同。恢复后六张Image ready可见。
- 恢复核实：只有DashScope/OpenAI两条真实连接，OpenAI默认、三用途inherit，Memory=false，
  原维护policy及排除范围保留；mobile=false、语言null、zoom=1、窗口原边界。临时连接、方法
  替换均清理，debug未切换，fresh dev:errors为空；Key值未输出。
- 证据限制：空白vault的首次Chat首配仅自动化及owner证据，没有现场清空配置验证；没有iPhone
  硬件或全面VoiceOver验收，没有强造真实付费网络故障。真实服务样本只证明已测账号/协议，
  不承诺模型质量或所有模型组合。这些是已披露的覆盖边界，不是本范围未完成开发项。
- 不承诺任意旧版本降级无损；旧版本reset不是回滚步骤。Markdown仍是源事实，OPFS为本地缓存。

## Local Evidence Provenance

以下是本机原始证据定位，不作为其他checkout可运行的前置条件：

- `/tmp/pa-b192-full-test.log`、`/tmp/pa-b192-ghost-permitted.log`、
  `/tmp/pa-b192-b129-physical-hooks-final.log`：原完整运行及两项修正复验。
- `/tmp/b192-aux-consumers-types-green.log`、`/tmp/b192-r234-final.log`、
  `/tmp/b192-r5-image-errors-green.log`、`/tmp/b192-followup-locales.log`：最后184项专项。
- `/tmp/b192-followup-build-final.log`、`/tmp/b192-followup-lint.log`、
  `/tmp/b192-followup-lint-delta.log`、`/tmp/b192-followup-deploy.log`：最终运行输入检查与部署。
- `test/b192-smoke/runtime-evidence.json`：真实服务、存储与双端交互的脱敏证据；
  `/tmp/b192-followup-app.log`：最后只读图卡和保存竞态的恢复核对。测试素材不纳入正式源码。

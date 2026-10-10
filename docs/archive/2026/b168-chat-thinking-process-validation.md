# B-168 Chat THINKING Process 最终验证

Document status: Archived
Recorded: 2026-10-10
Work item: B-168

本页保留最终验收、构建身份与限制，不作为当前实现或执行状态权威。
稳定行为见 [DEC-058](../../product/decisions/dec-058-chat-thinking-process.md)、
[Product Spec](../../product/specs/pa-chat-thinking-process-product-spec.md) 与
[当前接线](../../architecture/pa-agent-debug-view.md#chat-thinking-投影与持久化)。

Owner 已接受推荐组合与精简建议，并授权全部开发测试；验收后明确要求
closeout B-168 和本地 master 提交。T-01～T-08、八组 REQ/AC、确认 findings
与独立接受完成，无未完成产品项转入 Backlog。Feature Home/SDD/Tracker 在
吸收后删除；原过程包未提交，不声称 Git 保存了其完整历史。

## 输入与执行者

基线 `fd84db1510161e71aa48fbf62e971c77370c84b2`。原 GLM 隔离树停止写入后，
37 个源码/测试文件接回主 checkout；配置的 pa-glm/ZAI/GLM-5.3 额度错误自然退出，
重置等待超过既有一小时窗口，按授权由 GPT 接管，没有新额度探测或自动切回。
GPT A/B 分文件实施，独立 reviewer/root 核对实际差异及原始结果；root 统一门禁与 app 验收。
不称 GPT 修改为 GLM 成功，不更改模型/provider/存储/执行边界。

最终 `accepted-final-cancellation-input.json` 含 24 源码/13 测试；closeout 前 37/37 SHA
一致。清单自身 SHA-256 为 `9385aa222da550a1a0dce0a8d0a9abc230a71c714de2ee0c7a2d4ed2cb8b06f9`。
最后源码增量仅 manager 对既有 cancelled/failed 状态的恢复，与一个既有测试用例扩展。

## 工程验证与复用

| Check | Accepted evidence |
| --- | --- |
| 全量 enclosing gate | `npm run test:all -- --runInBand` 自然 exit 1：383 suites / 9250 tests PASS，唯一 Ghost client 的 45 项因 `listen EPERM 127.0.0.1` 失败；总计 384 suites / 9295 tests |
| 环境补测 | 检查实际 createServer/listen 路径后，只在允许 localhost 监听的环境复跑 `npm run test:all -- --runInBand __tests__/ghost-publishing-client.test.ts`，自然 exit 0，53 PASS。包含首轮已通过的 8 项，合并仍为 9295 个独立测试，不把原单命令改称 PASS；无外部 Ghost 请求 |
| changed-input closest | 精确 node ID 路由 25 PASS；终态显示 Chat 392 PASS + 未变 locales 14 PASS；最后 manager 36 PASS。均自然 exit 0，不重复累加重叠测试。F-17 首轮两项旧文案断言失败按真实终态纠正，运行中/隐私断言保留 |
| lint/type/build | 完整 lint PASS；最终源码增量 scoped eslint PASS；`npm run build` 自然 exit 0，包含 tsc/Tailwind/production bundle。前两次 deploy 在 lint/type 停止的结果保留，不宣称其运行了全量或复制 |
| 差异/DOM/文档合同 | diff exit 0；runtime style/HTML scan exit 1、无匹配；最后 manager 改动不触及 DOM。文档 checker/skills 合同输入未改，复用 2 suites / 57 docs tests PASS；closeout 只补 docs:check 与 diff，不重跑构建/app/full gate |
| Closeout 文档 | 删除吸收后的过程包及空目录，`npm run docs:check` 自然 exit 0：282 Markdown / 3691 本地链接；最终 diff/Markdown 空白检查通过。源码 37/37 SHA 未变，复用上述工程与 app 验收 |
| 部署 | `make deploy-current` 自然 exit 0，验证当前资产身份后复制到 repo-local test；实际 plugin reload。它不执行或替代测试 |

最终 dist 与 `test/.obsidian/plugins/personal-assistant` 的 main.js、styles.css、两个
manifest 字节一致；main.js SHA-256 为
`d2377910926574a387cf7d60c2d2221c93e21354037001b42bab2c1069316058`，styles.css 为
`b670a31ae6f48d5c7af0ae1ffdab681110d0758107c4075ca127c3aca353c45f`。

## 已部署交互与回归边界

真实目标为 `/Users/eddie/code/personal-assistant/test`，Obsidian 1.14.4；用原生 CUA
输入、发送、展开、键盘、滚动、关闭/重开、Debug 点击和布局操作。临时本地流提供
明确标注的合成数据，经既有 Chat 接线与持久化，未调用 provider、搜索笔记或执行写操作。

| Scene / AC | Accepted evidence |
| --- | --- |
| 当前过程/AC-01～04 | 首事件前准备即有原粒子与计时；Debug off 当前 A/B reasoning 可读。八项同名并行/逆序返回分别保留六成功、一 recoverable failure、一复用；展开、键盘 Space、上滚与完成不互相重置 |
| 交付计时/AC-03、05 | agent_end 后留置实际 Chat 交付时仍计时/动画；交付后 2m29s 冻结，重开保留且默认收起。最终小场景已交付非工具阶段 Completed，复用结果保持；确定性假时钟覆盖失败/迟到事件/失效释放 |
| 历史与定位/AC-04～06 | off 重开全文不保证且中性提示本地详情不可用；采集过的新记录重载后分别读取 A/B。引用显示 reasoning 1/2、Memory 1～8；点击 reasoning 2 精确落到 capture `debug-mv1yle32-2-kgtuxsi`、node `debug-mv1yle32-2-kgtuxsi:llm:fixture2`。缺精确节点打开已知 run/会话，不搜索补关联 |
| 准备期 Stop/AC-03、05 | 当前 cancelled/Interrupted/13s；mobile reload 发现恢复默认 completed 的真实负例。manager 补读已有 agentExecution 后，直接重开同一落盘记录仍 cancelled/Interrupted/13s，无新请求/存储字段/行形态。failed 同路径由既有 manager 用例验证 |
| 语言/布局/AC-07 | 真实平台主语言 en-US；临时 navigator zh-CN 覆盖验证中文后恢复，不冒充更改 OS。深浅主题与 411.5px leaf、官方 mobile simulator 450px 无横向溢出；移动原生展开与按引用读取 reasoning 成功，不冒充 iPhone 真机 |
| 清理/执行所有权/AC-05、08 | 确定性夹具及独立源码复核覆盖 exact cleanup/Forget、Memory/IDB 原子引用修订、耗时窄更新、删除重试、多节点/迟到读取、实际 provider-input 隔离；复用 committed answer、Writing 与领域回执契约，不制造外部写入验收 |

最终临时流/恢复监听均移除，mobile=false、PA Debug=false、CDP debug=false、light、
navigator 原始 en-US，侧栏恢复约原宽 717px；临时流观察期间 errors=[]。
自有合成会话保留供复核，既有用户/Ghost 会话与 handoff 未改。

原始日志、冻结清单与操作 JSON 验收时位于 `/private/tmp/pa-b168-20261010/`；
包括 `final-test-all.log`、`final-localserver-suite.log`、`final-build-cancellation.log`、
`final-deploy-cancellation.log`、`app-final-accepted.json`、`app-final-environment.json`。
本页压缩保存其结果与身份，不承诺临时目录永久存在，也不归档全部逐轮记录。
本地验收不证明在线模型质量、外部业务效果、iPhone、远程 CI、日常 vault 部署或发布。

## 2026-10-10 使用反馈窄修收尾

Owner 在使用中要求 THINKING 跟随 Obsidian 界面语言，并将固定标题改为
`Reasoning`；在获知本次尚未部署和真实窗口复验后，明确要求 closeout 并提交到
本地 `master`。这次修订替代初版的平台语言优先，保留以上原始验证的历史事实。

- 范围：过程语言复用 `getPluginUiLanguage()`；当前、历史及 Debug 引用的标题与
  显示/隐藏/读取按钮统一为 `Reasoning`。供应商原文、执行行为及存储边界不变。
- 实际 writer：配置的 pa-glm / ZAI / glm-5.3；GPT-6 负责需求修订、文档和独立验收。
  风险为局部语言来源及文案修复，实际 diff、关键断言和原始测试结果已独立核对。
- 回归：语言不一致的两个用例先取得真实目标失败；修复后
  `npm test -- --runInBand __tests__/pa-locales-plugin.test.ts __tests__/chat-view.test.ts`
  自然 exit 0，2 suites / 408 tests PASS。覆盖双向语言组合、英文回退、当前/历史
  标题、中文供应商原文保留，以及原有计时、折叠和持久化语义。
  收尾时并行 Debug 改动已独立提交；仅因共享语言表增加文案补跑 locales suite，
  自然 exit 0，16 tests PASS，不与上述 408 项重复累加。
- 工程检查：`npx tsc -noEmit -skipLibCheck`、`docs:check`、diff check 均 PASS；
  runtime style/HTML scan 无匹配，exit 1 按规则为 PASS。提交本身不使这些证据失效。
- 证据限制：未为本次窄修构建部署、执行全套测试或完成真实 Obsidian 窗口复验。
  默认 Obsidian 命令未进入 CLI 模式，当前原生窗口交互工具不可用；不把以上初版
  app smoke 当成本次语言规则与标题的应用内证明。下次部署时复验受影响的展开界面。
- 文档处置：行为已吸收到 DEC-058、Product Spec、当前架构和 focused tests；本次
  不新建 Active Package，原 B-168 没有待删除的活动入口。原始本机日志位于
  `/tmp/pa-b168-language-fix-20261010/`，不承诺临时目录永久存在。

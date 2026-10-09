# B-167 Agent Debug Explorer 最终验证

Document status: Archived
Recorded: 2026-10-10
Work item: B-167

本页保留最终验收、部署身份与证据限制，不作为当前实现或执行状态权威。
稳定行为见 [DEC-057](../../product/decisions/dec-057-agent-debug-explorer.md)、
[Product Spec](../../product/specs/pa-agent-debug-explorer-product-spec.md) 与
[Debug architecture](../../architecture/pa-agent-debug-view.md)。

Owner 于 2026-10-09 授权按 B-167 方案完成所有开发测试，2026-10-10 明确授权
closeout 和本地 master 提交。T-01～T-07、十项 REQ/AC 与独立审查完成，
无未完成开发测试项转入 Backlog。Feature Home、SDD、Tracker 在吸收后删除；
不将本地验收或 closeout 当作远程推送、CI、发布或日常 vault 部署证据。

## 输入、构建与独立接受

设计基线 `1ff0c648`，实施基线 `4927e770783bbfc07f371ca9b7e9c7308a75f618`。
在 `/Users/eddie/.codex/worktrees/b167-debug-explorer/personal-assistant` 分文件实现，
2026-10-10 将30个源码/tests/生成CSS文件逐字节接回主仓库，closeout前再次确认
全部SHA-256不变，保留无关的 `PA-Chat-Agent-UIUX-Codex-Handoff.md`。

GLM一次认证调用收到周/月限额，未写源码；依既有授权由GPT接管，不继续探测。
三个writer按观察、存储、UI分工，独立reviewer核对实际diff与原始结果，root统一
执行昂贵gate和真实app验收。全部确认finding已闭合，无剩余actionable finding。

| Check | Accepted evidence |
| --- | --- |
| 全量 enclosing gate | `npm run test:all -- --runInBand` 自然exit0：384 suites/9265 tests，344.655s；涵盖source/tooling/artifact/docs |
| 最后源码增量 | 全量后修复晚更新工具名搜索：model/view 2 suites/33 tests；Escape隔离：view 1 suite/23 tests；均自然exit0，不累计重叠数量 |
| lint/type/build | 全仓lint和生产build通过；build含tsc/Tailwind。最后搜索/Dialog用scoped lint，最后320px标题仅CSS，Tailwind与生产asset重建通过，未变TS检查复用 |
| 文档/格式/社区扫描 | 接回后docs:check为281 Markdown/3686links；docs tests 2 suites/57 tests、8.329s；自然exit0。diff exit0；runtime HTML/style注入scan exit1且空输出 |
| Closeout文档门禁 | 删除已吸收过程包及空目录后docs:check为279 Markdown/3659links；docs tests 2 suites/57 tests、6.653s，自然exit0；diff exit0。仅文档/索引变化，源码30/30 hash不变，复用上述工程与app验收 |
| 部署身份 | `make deploy-current` 验证当前资产后复制到隔离test；实际plugin reload。最终dist与安装main.js SHA-256均 `b6440b61edf4c496f9a3035e215588914017811a2d8de20a0c4e8cae2856d96c`；styles.css均 `44e4f43c9797a72cf533173aaf4d5324033fb3aff8c70071889785eac41249f6` |

## 三组行为验收

| Scene / AC | Accepted evidence |
| --- | --- |
| 完整历史与详情 / AC-01、02、03、05、08 | 自动化覆盖固定H、稀疏seq、overlay不推进游标、迟交前缀、身份/时钟/来源。部署后609 canonical节点中000、599与失败attempt均可达；52历史fixture可跨Older runs读取，结果/会话筛选有效。实际工具输出16,384→32,768→全部展开，模型观察摘要独立展示 |
| 实时双端阅读 / AC-04、05、06、07、08、10 | 桌面宽/窄leaf保留选择；树与详情独立滚动，选择不重置轨迹，键盘分隔54→56，浅/深主题可读。官方mobile simulator实际320/393 CSS px覆盖搜索→详情→返回、固定可见序列首尾、清搜索跳Turn6/末599、折叠与选择分离、touch暂停Follow、原生弹层隔离/焦点返回和末项可达 |
| 清理与旧历史 / AC-09、10 | store/service/integration/view验证Forget、TTL、事务完成、迟到读取/写入屏障。旧DTO无新字段仍可读，类型/来源未知如实显示，原25ms耗时和公开body保留。手机详情阅读中清理后/插件reload后runs0、details0、search空，导航不复活 |

实际app验收发现并修复四项P2：晚工具DTO省略toolName导致搜索丢词；Escape冒泡
触发宿主leaf切换；floating手机导航覆盖页脚；320px标题被flex挤成多行。
修复后桌面多标签/手机Escape均保留Agent Debug并归焦Turns；393/320px的页脚
bottom684 < native navbar top701，控件至少44px高且能实际命中，无横向溢出。
触控证据为原生设备模拟操作产生touch/pointer各7次与Follow true→false，
不是以JSDOM或静态截图代替触控和原生焦点验证。

## 受控任务与真实 Chat Stop

使用实际 `PaAgentLoop`、HostPolicy、transport观察与并行工具，固定公开输入
`Read the two synthetic fixture values and report their sum.`；模型与transport为
确定性本地adapter，未配置provider密钥、访问私人笔记或发送网络请求。

| State | Capture | Result |
| --- | --- | --- |
| capture_off | `debug-mv13izwq-1-bgojqwx` | completed、2 Turns、2模型/2本地dispatch/2工具完成、network0 |
| capture_background | `debug-mv13izzv-2-94d4lvp` | 同上 |
| viewer_open | `debug-mv13lj8f-3-lm2k5mx` | 同上 |

三态最终文本均为 `Fixture result: 11 + 22 = 33.`。未增加Debug导致的请求或效果。
计时回归中实际准备100ms、等待25ms，Debug等待25ms，原业务指标125ms；
业务计时与预算没有被观察字段替换。

一次性adapter接入真实Chat Send和既有Abort owner，临时三块各20s的live输入
只提供原生操作窗口，不改变生产源码。运行中实际切换笔记tab，输入并保存
`Saved while the controlled Agent was running.`，随后从文件读回；返回Debug选择
旧NODE400，最后点击原生Stop，看到Generation cancelled。
capture `debug-mv15783n-1-h1hu3nx` 的实际Loop为aborted，2 Turns、2模型/2本地dispatch/
2工具完成、network0，部分文本 `Fixture result: 11 + 22`；stream/readiness adapter
恢复true，Chat Abort owner释放true，主leaf仍为 `pa-agent-debug-view`。

## 环境、恢复与证据限制

使用Obsidian 1.14.4；vault为工作树的 `test`，userData为
`/private/tmp/pa-b167-obsidian-20261009`。CLI全局socket会路由日常实例，因此只在
已核对身份的隔离窗口调用同一官方CLI handler，所有原生操作使用Computer Use。
产品交互后两次 `dev:errors` 均为No errors captured。

一次诊断脚本误用不存在API的TypeError、首次增量build写权限EPERM，以及CUA
大树滚动noWindowsAvailable均单独识别为诊断/环境问题；正确权限或重新定位后
完成剩余验收，未据此弱化断言或宣称产品通过。工具树“0–500 of609”是观察输出
截断，实际原生滚动已到达最后失败行，不是产品只展示尾窗。

完成后mobile false、debug false、theme dark、debugger detached、临时harness卸载；
仅在核对PID82797与任务profile后正常SIGTERM，日常PID82924仍运行。临时插件
两个文件核对ID/hash后删除。隔离树、当前构建与原始证据保留供核对。

原始日志和JSON当时保存在 `/private/tmp/pa-b167-glm-20261009`，包括
`t07-test-all.log`、最后scoped/build/deploy日志、`t07-app-receipts.json`、
`t07-native-chat-stop.json`、`t07-mobile-clear-reload.json` 和
`t07-source-receive-manifest.json`；本页保留可跨会话阅读的终态事实，临时路径不
作为持续可用保证。未进行线上模型评测、iPhone真机、远程CI、发布或生产部署。

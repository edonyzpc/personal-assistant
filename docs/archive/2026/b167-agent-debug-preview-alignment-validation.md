# B-167 已确认预览补齐最终验证

Document status: Archived
Recorded: 2026-10-10
Work item: B-167

本页保留本轮预览补齐的最终证据，不作为当前实现或执行状态权威。
稳定行为由 [Product Spec](../../product/specs/pa-agent-debug-explorer-product-spec.md) 与
[Debug architecture](../../architecture/pa-agent-debug-view.md#已确认预览的展示补齐) 持有。
原 [B-167 首轮验证](./b167-agent-debug-explorer-validation.md) 保持原样，不能替代本轮外观验证。

Owner 要求以已确认桌面和移动预览为准补齐正式界面，继续复用 React/数据层，
完成必要测试及实际 Obsidian 对照；随后明确授权本轮 closeout 和本地 master 提交，
排除并行 B-168。T-01～04、确认 findings 和独立审查完成，无未完成项转入 Backlog。
Home/SDD/Tracker 吸收后删除，未提交的过程包不声称已完整保存在 Git。

## 最终行为与输入

基线 `4f02170d24f17efc525db1c15732201e9d385717`。桌面为四列轨迹、类型图标、
公共刻度、整行选择和右侧详情；移动为主行名称/耗时/状态、公共起点的时间副行、
独立详情与底部抽屉。详情默认输入/输出，另有时间与用量、原始记录 Tab；切换保留
正文分页和展开状态，但回到详情顶部。精确路由先于节点到达时，节点就绪触发正文读取。

预览是原生 HTML/CSS/JS，Lucide 仅供图标，Tweak/openai 桥仅属预览工具；正式产品
继续使用 React、Obsidian `setIcon` 与 scoped CSS，没有新依赖或采集/存储格式变化。
冻结的 [桌面预览](./b167-agent-debug-preview-alignment/reference-desktop.html) 和
[移动预览](./b167-agent-debug-preview-alignment/reference-mobile.html) 与 Owner 确认版本逐字节一致。
示例任务标题、模拟实时、手机外框不进入产品；实际运行选择使用已有时间/模型，
重试概览只表达存在相关记录，不将等待与 attempts 的聚合数冒充真实重试次数。

沿原 B-167 已记录的 GLM 额度接管规则由 GPT 执行，未重新探测 GLM。root 与两名
writer 分文件实现；另一名未写实现的 reviewer 独立核对实际 diff 和修复证据，
无剩余 P1/P2。本轮 closeout 仅改文档处置；并行 B-168 的 Chat 源码/测试/契约及
共享 Architecture、locale 中的对应修改块保留在工作区，不纳入提交。

## 检查与验收

| Scope / AC | Accepted evidence |
| --- | --- |
| 定向源码回归 / AC-01、05、07、08、09 | `npm test -- --runInBand __tests__/agent-debug-view.test.tsx __tests__/agent-debug-trace-model.test.ts __tests__/agent-debug-inspector.test.tsx`：3 suites / 40 tests PASS，2.466s。含异步精确路由正文读取 RED→GREEN、Tab/键盘、正文 16,384→32,768 渐进读取与刷新保持、原清理失效回归 |
| lint / 类型 / 打包 | `npm run lint`、`npm run build` PASS；build 包含 TypeScript、Tailwind 与生产 bundle |
| 文档与源码约束 | 实现后 docs:check PASS，285 Markdown / 3711 links；docs tests 2 suites / 57 tests PASS，7.026s。diff check PASS；runtime style/innerHTML/outerHTML 扫描空输出、exit 1 |
| 桌面 / AC-02、03、04、05、08 | 实际 Obsidian 1440×960，暗/亮主题；展开 23/23 节点，名称/时间条选择，末节点 deliver 可达。树与详情独立滚动，分隔键盘 62→60→62；632px leaf 自动窄布局，无横向溢出 |
| 移动模拟 / AC-03、05、06、07、08 | 实际 Obsidian 内置 dev:mobile，393×852 和 320×780。各深度轨道统一 x=66；宽度分别292/219，刻度相同。搜索 read 为 2 命中+祖先共5/23，清空恢复展开；详情返回恢复480px锚点，前后导航可用；抽屉底部对齐，Escape 关闭后焦点返回轮次；主控件至少44px、避让宿主导航 |
| 长正文与精确路由 / AC-08 | 实际 IO 滚动3600后切 raw，详情归零；返回 IO 保留13,553字符，键盘右箭头切到时间Tab。晚到节点的精确路由可直接读取已有IO。宿主按钮默认居中问题由局部样式修复并对照截图确认 |
| 执行隔离与恢复 / AC-10 | 公开合成23节点/3 Turns、并行工具、失败后恢复，46事件/28正文经既有 DebugStore 写入隔离 profile；长正文副本只验证阅读。无真实模型/provider请求。验证后 mobile=false、debug=false，隔离实例退出，test配置恢复 |
| Closeout 文档门禁 | `npm run docs:check` PASS，283 Markdown / 3709 links；`npm run test:docs -- --runInBand` 2 suites / 57 tests PASS，6.472s；`git diff --check` PASS。源码/生成样式 hash 与收尾前一致，未重跑无关全套或 app |

收尾阶段重新运行文档与 diff 门禁；源码与生成 CSS 不变，复用上述工程和 app 证据。
本轮 lint/build/app 来自当时共享工作区，包含并行 B-168 的既有修改，不声称是仅含
B-167 的独立 bundle 或全套测试。B-167 验收针对上述未变输入与交互；提交范围另按修改块核对。

## 正式界面与部署身份

[桌面](./b167-agent-debug-preview-alignment/evidence/desktop.png) ·
[移动轨迹](./b167-agent-debug-preview-alignment/evidence/mobile-trace.png) ·
[移动详情](./b167-agent-debug-preview-alignment/evidence/mobile-detail.png) ·
[移动轮次抽屉](./b167-agent-debug-preview-alignment/evidence/mobile-sheet.png) ·
[观察记录](./b167-agent-debug-preview-alignment/evidence/observations.json)

Obsidian 1.14.4 / Linux，vault `/mnt/code/personal-assistant/test`，独立 profile
`/tmp/pa-b167-preview-smoke/profile`。`make deploy-current` 校验并部署本轮构建后实际
重载插件；dist 与安装的 main.js/styles.css/manifest 身份相同：

- main.js SHA-256：`b7917e3f8d7d9957ce0a9d3d5f3cd6d890308ceda390836af675dcf23a55d980`
- styles.css SHA-256：`ff4a9011b1d010db41582d77c26acfc84e4c1c291be62b79e76109058ccf8f7c`

为避免全局 CLI socket 路由到其他 profile，准备和模式切换在已核对窗口调用其注册的
Obsidian CLI handler；交互使用 X11/XTest 原生点击、滚轮和键盘，观察到 isTrusted=true。
CDP 只作准备、读取与截图。移动证据为 Obsidian 模拟器，不是 iPhone 真机。

最终 `dev:errors` / `dev:console` 均无记录。准备脚本曾早于 layoutReady 打开 view 而
出现 `No tab group found`；等待公开 onLayoutReady 后完成，明确为测试准备问题。
验证后退出隔离进程并恢复 test 的 app/appearance/workspace 等配置，保留已部署插件资产。
原始日志当时保存于 `/tmp/pa-b167-preview-smoke/`，不以临时目录作持续可用保证。
无远程 CI、真实供应商执行、硬件 iPhone、日常 vault 部署、push 或发布结论。

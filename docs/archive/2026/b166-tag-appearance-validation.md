# B-166 Tag Appearance Final Validation

Document status: Archived
Closed: 2026-10-09
Work item: B-166
Authority: 本次最终验证、宿主环境及复用边界的历史证据；不是当前行为或执行状态权威。
Current contracts: [Product Spec](../../product/specs/pa-tag-appearance-product-spec.md)、
[DEC-056](../../product/decisions/dec-056-opt-in-tag-appearance.md)、
[Architecture](../../architecture/tag-appearance.md)

Owner 于 2026-10-09 明确授权完成开发测试，并因 GLM 限额要求直接使用 GPT；
实现、测试与独立只读审查均由 GPT 完成，没有启动 GLM 或额度探测。
随后明确要求 closeout B-166 并提交本地 master。T-00～T-06、十组 REQ / AC
已完成，无未关闭的必需修复或产品决定，无未完成项转入 Backlog。
源码和 focused tests 承接稳定行为；Feature Home / SDD / Tracker 吸收后删除，
这些过程文档本轮未提交，不声称完整过程包可从旧 Git 提交恢复。

## Automated Evidence And Reuse

| Check / risk | Final evidence | Boundary |
| --- | --- | --- |
| 配色、设置与编辑器 | palette 13 tests；settings / lifecycle 2 suites / 345 tests；editor 4 tests PASS | 默认关闭、非法存储值、提交后生效 / 失败回滚、卸载竞争、固定向量与原生语法负例 |
| 统一 gate | 平台 guards、全仓 lint、production build/type-check；full Jest 383 suites / 9215 tests PASS，745.285s，自然 exit 0 | full Jest 后发现两个 App 问题，以下述窄修证据补齐；没有重新跑过最终整仓，也没有把 focused PASS 称为全仓 PASS |
| CM 嵌套样式修复 | 实际 mark 在 native begin/end 内层；局部 `:has` 提供原生绘制段的九色变量。静态 PostCSS / selector 核对、重建、独立差异核对与实际明暗编辑交互 PASS | 保留原生两端几何；不以截图或纯色计算替代编辑和选区操作 |
| 闭窗根准入修复 | 排除 workspace 暂留且 `defaultView=null` 的叶子；integration 最终 1 suite / 6 tests PASS，0.810s；差异 ESLint、最终 build/type-check 与实际闭窗再开启 PASS | 其余未变输入复用完整 gate；旧 roots / discovery 由集合差异释放 |
| 样式 / 社区边界 | 18 组不透明色对均 ≥4.5:1；CSS 解析 PASS；runtime style / innerHTML / outerHTML 源码扫描无匹配（exit 1）；diff 检查 PASS | 实际合成和原生操作由下面的 App 证据承接 |
| 独立审查 | 非 writer 核实际 diff、设置切片、支持根、CM 与启停生命周期，无未关闭 P0 / P1 / P2；两项 App 窄修由主 GPT 独立复核 | 未将并发 Chat 改动纳入 B-166 审查结论 |

首轮完整 gate 曾因既有精简 mock 不提供 MarkdownRenderChild 而在 eager subclass
import 阶段失败。改为启用 processor 中按需创建原生 child，2 suites / 366 tests
直接验证后完整 gate 自然通过；保留这个原失败，未修改断言来取得 PASS。

构建输入基线为 `2c9e06dda7649315e0cec5782733f1e0f016767c`。测试工作树还包含
并发的 `src/chat/chat-view.ts` / `__tests__/chat-view.test.ts` 改动，文件摘要对照未变，
没有纳入 B-166 的修改或独立审查范围。closeout 期间该任务自行提交为 `b1c3e608`；
提交位置变化不改变已测文件内容。以下资产身份属于实际测试工作树，不能据此
声称不含该 Chat 修改的独立 B-166 补丁也生成相同 bundle。

- `main.js` SHA256：`3bad5fa409e15dd6bb7ab5a9385088790e8ceda92711c034c9973ab7065520df`
- `styles.css` SHA256：`269ac501dbf745519b74ad5a3593b6e807b1aa651fc4d03739819007234a9666`

## Observed App Evidence

所有操作使用自建合成 vault、独立 profile / CLI socket / 进程和窗口；没有部署到
共享 `test/.obsidian` 或操作日常 vault/profile。当前与最低核心测试使用同一最终构建。

| Environment / AC | Observed result | Limit |
| --- | --- | --- |
| Obsidian 1.14.4 Desktop；AC-01～08、10 | 实际 Settings 开关；阅读、LP / Source、inline / file-properties、RecordList 同名同色。字号 14→17.5px 随用户缩放，明暗配色、原生点击 `tag:#Topic`、中文输入/撤销、`#Topic` 选区、属性增删/折叠通过 | negative fixture 与直接回归共同覆盖代码、escaped hash、URL、aliases 和 generic chips；不是任意第三方插件认证 |
| 当前主题与 snippet 恢复；AC-04、08～10 | 合成 snippet 由宿主实际启用；PA 开启为 3px，开启期间换主题再关闭，恢复当前 snippet 的文字 `rgb(20,50,70)`、底色 `rgb(210,220,230)` 和 9px 圆角；笔记字节不变 | 使用默认主题和合成普通 snippet，不声称任意 `!important` 或第三方主题通过 |
| Popout、卸载与重开；AC-08～10 | popout blue 文字 `rgb(167,199,229)`、底色 `rgb(41,53,65)`、3px；闭窗后立即启停不报错；主窗/其他窗标记及 roots / discovery / extensions / events / processor 归零 | 晚到工作与闭窗暂留叶子有直接回归；不清理其他功能资源 |
| 官方 1.11.4 应用核心；AC-02、04、07、08、10 | 阅读、CM / Properties、原生搜索/编辑撤销、启停恢复通过；窗口核心标题 1.11.4 | 安装/Electron 外壳仍为 1.14.4；不是完整旧安装包或所有历史版本测试；manifest 最低版本未改 |
| CLI mobile simulator 420×900；AC-04～08、10 | native 输入/撤销、Properties 增删、点击搜索和关闭清理通过；长中文嵌套标签换行两段右边界 369.40 / 263.95px，preview scrollWidth=clientWidth=408px，无横向溢出 | 实测 app.isMobile=true；模拟器证据不代表 iPhone 真机。没有具体 iOS-only 能力，未新增真机 gate |

最低核心使用 [官方 1.11.4 release](https://github.com/obsidianmd/obsidian-releases/releases/tag/v1.11.4)
的 `obsidian-1.11.4.asar.gz`，asset digest 与下载 SHA256
`123704f9e7b1c6a634a10379d08d30defb8ba19466cc96121baf276e2b4f536c` 一致。
保留原壳 bootstrap，只替换自建副本的核心；没有改用户安装。

最终 tag=false、mobile/debug=false、theme=obsidian、font=16、snippets=[]，自有观察器、
扩展、processor 与 DOM 标记为零。两个自建 App 由原生 quit 正常退出；仅删除自建
测试 vault、profile/runtime、最低核心副本和下载包，日常实例未重启，合成笔记字节未变。

## Evidence Location And Closeout

运行时原始日志保留于任务临时目录：`/tmp/pa-b166-full-tests-final.log`、
`/tmp/pa-b166-integration-final.log`、`/tmp/pa-b166-build-closed-window.log`，以及
`/tmp/pa-b166-runtime/` 中的 `desktop-editor.log`、`recovery-smoke.log`、
`mobile-smoke.log`、`min-smoke-final.log`、`final-restore.log` 和 `cleanup.log`。
`desktop-smoke.log` 同时保留早期定位失败与已通过部分，不能单独当作最终完整 PASS。
这些路径是本机运行证据位置，不承诺其随 Git 持久保存；本文件保留可维护的最终结果
与限制，截图另在本任务 visualization 目录。

文档收尾仅改变契约/索引/证据和过程文档处置，复用未变源码的运行验证。
收尾检查：`docs:check` 276 Markdown / 3622 local links PASS；文档合同 2 suites /
57 tests PASS，8.027s，自然 exit 0；独立只读吸收核对无可操作问题，diff 检查 PASS。
日志为 `/tmp/pa-b166-closeout-docs.log` 和 `/tmp/pa-b166-closeout-doc-contracts.log`。
本地 master 提交、远程推送、生产部署与版本发布分别授权，本次不含推送或发布。

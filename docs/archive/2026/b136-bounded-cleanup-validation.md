# B-136 有界清理验证记录

Document status: Historical
Date: 2026-09-13
Work item: B-136
Authority: 已完成工作的历史验收与证据边界，不授予新的实现或发布权限。
Current contract: [Product Spec](../../product/specs/pa-bounded-code-cleanup-product-spec.md) / [DEC-035](../../product/decisions/dec-035-bounded-cleanup-and-pagelet-scope-retirement.md)

## Outcome And Scope

B-136 的 6/6 AC 完成，无未解决 P0/P1/P2。用户明确授权 closeout 与推送 master。
运行时与测试提交为 `76355b9c`，配套文档为 `b23c31f0`；closeout 自身只改文档。
代码由独立 ZAI / `glm-5.3` / max CLI 实现，GPT 负责范围、独立复审、接收和 app 验收；
GLM 配额恢复后续接原任务，没有替换实施模型。服务端实际模型无独立证明。

删除普通不可达代码、旧 mascot 资源、无消费状态及一个直接依赖；旧 Pagelet 范围
控件按产品决定退役，并清除专用旧链。SourceRecord 只合并相同浅拷贝。
Deep Discover 仍以活动 Markdown 为 anchor，允许边界内的其他笔记作为证据。
旧命令 ID/名称/alias、全局来源边界、正常保存和共享服务保持。
外围管理、Statistics 采集/展示、Share Card 字体/导出、Records 两类入口未退役。

## Requirement Acceptance

| Requirement / AC | Final evidence |
| --- | --- |
| B-136/REQ-01 / B-136/AC-01 | source/类型/Worker/脚本/构建入口与实际 diff 独立复核；C-01～C-05/C-07～C-08 专用删除通过两阶段 gate。脚本仍消费的 `deviceMemoryReviewQueueRepository` 保留。 |
| B-136/REQ-02 / B-136/AC-02 | 实际旧 Panel 命令可打开；桌面与 390px 移动模拟无旧 presets、checkbox、selected count；当前操作与 Expand 保留。 |
| B-136/REQ-03 / B-136/AC-03 | 隔离后台触发后 Open 命令为 0 discovery calls；真实显式发现 verified，A 为 anchor、获准 B 可跳转；排除 Markdown 显示 0 used/1 privacy excluded，PNG 无虚假 used outcome。旧 Quick review 别名实测通过。 |
| B-136/REQ-04 / B-136/AC-04 | 入口/资源 diff、外围管理与 Stats/Share Card/Records 既有 full Jest 契约通过；没有字体、统计历史或功能合并交付。 |
| B-136/REQ-05 / B-136/AC-05 | 来源/历史隐私、取消、队列、准入/恢复、共享服务及保存回归通过；真实来源跳转、Detail View、保存预览取消/确认通过；Operations 保持关闭，未修改来源笔记。 |
| B-136/REQ-06 / B-136/AC-06 | clone 的上下文隐私差异保留；CSS AST 删除仅命中专用规则，当前 Pet/Bubble/Ring/reduced-motion 保留；当前产品/架构/smoke 文档已同步。 |

## Validation And Identity

原始回执的有限副本和日志摘要保留于
[validation evidence JSON](./b136-bounded-cleanup-validation-evidence.json)。没有复制凭据、完整配置或用户笔记。

| Gate | Result |
| --- | --- |
| P1 `make bin` | 自然退出 0；271 suites / 7,535 tests，lint、生产 build、platform guards 通过。 |
| P2 R3 最终 `make bin` | 自然退出 0；269 suites / 7,377 tests，lint、生产 build、387-file platform guards 通过。 |
| 定时器诊断 | Bubble/orchestrator 两套 `--detectOpenHandles`，91 tests 自然退出 0，无 open-handle 提示。full gate 的一秒提示如实保留，未使用 forceExit。 |
| 主 checkout 接收 | 914 项源码/测试/配置输入与已验收树一致；原有 6 个 Share Card prototype/test 文件保留，新增组合 suite 22 tests、TypeScript 通过。不是重复跑过 270 套全量。 |
| 主 checkout 重建 | build 通过；JS/CSS 与实际部署、加载的 P2 版本一致，production provenance blockers 为空。主树 `.DS_Store`/接收时间戳使旧凭据不能直接复用，因此正常重建，未修改凭据检查。 |
| 文档门 | 2 suites / 58 docs tests 通过；docs checker 仅原有 4 条 episodic-memory advisory；diff check 通过，DOM source scan 无匹配。 |

最终 `main.js` SHA-256：`fa13bae5bc4ee557b3c7a209efb12aff5d3108a81c0a0094dcdfd465118e8668`。
最终 `styles.css` SHA-256：`95bae6d65728e0801f9bda3cabe68612abc9c800b8c70665e700663c4d1a3536`。

## App Evidence And Limits

- 目标为 repo `test/` vault、Obsidian 1.13.7；每阶段通过 `make bin` 后使用符合
  条件的 `make deploy-current`，再 reload 并进行真实界面交互。
- 合成 A=`pa-inline-font-smoke-20260913.md`，B=`pa-share-menu-smoke-20260913.md`。
  配置 route=`qwen`、model=`deepseek-v4-pro`；这不证明服务端供应商或实际型号。
  首次显式运行未保留返回状态，不计成功；补只读状态记录后的运行返回 verified。
- Open 零调用证据暂停了自动发现。之前出现的 `open-changed-note` 属于既有后台
  路径，不能冒称显式命令调用或物理 provider 次数；临时探针仅透明转发原方法。
- 被排除测试最初放入不可索引隐藏目录，不计为负例；改为正常 Markdown 加临时
  单文件排除后，通过真实来源详情验证。PNG 主按钮未启动发现。
- Review 保存先取消，确认没有文件；再实际确认，生成 1,499 bytes、含两篇来源
  和 finding metadata 的测试 Review。保存没有新增发现调用，来源笔记未编辑。
- 移动模拟 390×844，Panel width/clientWidth/scrollWidth 均为 390；真实键盘
  操作来源并 Tab 到主按钮，关闭正常。不是 iOS 真机证据；reduced-motion 使用
  生成 CSS AST 与既有测试，未声称切换 OS 辅助功能。
- fresh errors 为空；恢复 desktop/dark、原活动页/选区、五个 Markdown leaf、Chat
  及原 Share Card modal。自动发现/contextPager 原值 true，临时排除/探针不存在，
  mobile/debug 关闭。4 个自建 fixture/Review 按 SHA 核对后移除。

## Findings, Ablation And Retention

F-06 修复排除/非 Markdown 来源误报；F-07 把误删的三条共享 Bubble timer/Ring
保护迁移到活跃 Pattern/AgentInsight fixture；F-08 清除两个只写 Expand 字段及
过时文案，两个真实按钮与成本/准入说明保留。R3 的两次 TypeScript 失败均为新增
测试 mock cast，修复后 gate 重跑通过。没有通过弱化行为断言获得绿灯。

消融仅用于定位候选：三个孤立模块的虚拟删除曾保持 bundle 相同；删除活跃
PageletHost 类型模块仍保持 bundle 却产生 76 个语义错误，证明 bundle 相同不能
单独授权删除。两组实验体积变化不相加作为交付收益；研究运行未做 Jest/app，
不冒称工程 PASS。最终源目录净减少 6,247 行包含源码与样式，不是运行速度证明。

没有新增未完成项转入 Backlog。大类拆分、Statistics 历史整理、Weekly Review
兼容和未来 adapter 继续遵循 B-105/B-110/B-116/B-122；Records 统一另行决策。
Feature Home/Plan/Tracker 被当前契约、测试和本记录吸收后删除，原过程可从
`b23c31f0` 恢复；Active Registry 入口移除，不归档整个包。

本任务 scratch、npm 预演/cache、自建依赖/部署软链接已移除，共享依赖、实际测试
插件及稳定 GLM 配置保留。两棵 `pa-b136-glm.H5jnqn` 下的隔离树仍有未提交状态，
按 workflow 保留，不 force-remove/reset/clean；本机必要原始证据亦保留。
此记录证明 B-136 验收与 closeout，不宣称新版本发布或独立 release/CI gate 完成。

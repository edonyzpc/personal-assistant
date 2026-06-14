# Pagelet 使用指南

> 本指南已对照 2026-06-06 的真实 Obsidian `test/` vault GUI smoke 结果整理。
> 最新全量 GUI smoke 结果保存在 `test/pagelet-smoke-runtime-result.json`，
> 摘要记录在 `docs/pagelet-smoke-checklist.md`。

Pagelet 是一个“写完之后帮你审视笔记”的安静审阅器。默认情况下，它不会在
后台读取你的 vault，也不会偷偷改写源笔记；只有当你主动打开面板或运行审阅
命令时，它才会读取你选中的笔记，并把审阅建议整理成可取舍、可编辑、可保存
的工作流。

如果你在设置中显式开启“后台审阅准备”，Pagelet 会按配置的间隔读取近期变更
笔记来提前准备审阅结果；这些笔记正文可能会发送给当前配置的 AI provider，
并可能消耗 API 额度。这个后台路径只准备结果，不会写入或修改笔记。

它最适合这些场景：

- 刚写完一篇笔记，想检查表达是否清楚、是否容易行动；
- 做日回顾或周回顾，不想手动翻最近几天的笔记；
- 想找出遗漏的证据、模糊的决策、未收束的 follow-up；
- 想把有用建议收集成草稿，但不希望 AI 直接修改原文；
- 需要从一个具体建议出发去查证，而不是打开 Chat 后从空白提示开始。

## 使用前准备

使用 Pagelet 前需要确认：

- Personal Assistant 插件已启用；
- Pagelet 在插件设置中已启用；
- 已配置可用的 AI provider 和模型；
- 如果要审阅当前笔记，需要先打开一篇 Markdown 笔记。

运行审阅时，已选笔记正文可能会发送给当前配置的 AI provider，并可能消耗
API 额度。Pagelet 面板会在可用时显示本次或累计审阅成本。

Pagelet 保存的审阅笔记默认放在 `.pagelet/`。这个目录仍在 vault 内，能被
Obsidian 搜索、同步、备份和双链系统识别；但它又和你的源笔记分开，避免把
AI 生成的审阅记录混进日常笔记目录。

## 入口怎么选

Pagelet 当前有两类实用入口：

- `Pagelet: Open Pagelet`：只打开 Pagelet 面板，不立刻调用 AI。适合先检查
  scope、切换时间范围、手动包含或排除笔记，再从面板运行。
- `Pagelet: Review current note` 或 Pagelet 图标：直接从当前 Markdown 笔记
  开始审阅。适合你已经明确只想审阅当前笔记的时候。

第一次使用建议走 `Pagelet: Open Pagelet`。这样你能在 provider 调用前先看清
楚 Pagelet 准备读取哪些笔记。

如果你的 Pagelet 显示为中文界面，常见文案大致对应如下：

| 英文界面 | 中文界面 |
| --- | --- |
| `Pagelet: Open Pagelet` | `拾页：打开拾页面板` |
| `Pagelet: Review current note` | `拾页：审阅当前笔记` |
| `Review selected (N)` | `审阅已选（N）` |
| `Save review note` | `保存审阅笔记` |
| `Cancel` | `取消` |
| `Add to draft` | `加入草稿` |
| `Dismiss` | `忽略` |
| `Research` | `查证` |

## 快速审阅当前笔记

适合：刚写完一篇笔记，想让 Pagelet 做一次清晰度、证据、关联和可行动性的
检查。

1. 在 Obsidian 中打开一篇 Markdown 笔记。
2. 从命令面板运行 `Pagelet: Open Pagelet`。
3. 确认面板顶部显示的是当前笔记名，并且范围停留在 `Current`。
4. 查看 `Scope`。单篇审阅时，`Included (1)` 应该只列出当前笔记，原因是
   `current note`。
5. 点击 `Review selected (1)`。
6. 等待状态从 `Reviewing selected notes...` 变成 `Suggestions ready`。
7. 阅读建议卡片。每张卡片会告诉你：建议类型、来源、为什么值得处理，以及
   推荐动作。
8. 按需要处理建议：
   - `Add to draft`：把这条建议加入右侧/下方的草稿区；
   - `Dismiss`：隐藏这条不想处理的建议；
   - `Source`：打开建议对应的来源笔记或来源片段；
   - `Related notes`：打开 Pagelet 认为相关的笔记；
   - `Research`：把查证提示准备到 Personal Assistant Chat 中。
9. 在 `Draft` 区直接编辑已采纳的草稿块。
10. 如果想保留这次审阅，在面板的保存确认区展开 Markdown 预览并点击
    `Save review note`；如果只是看看建议，点击 `Cancel`。

保存后，Pagelet 会创建一篇独立的 Markdown 审阅笔记，例如：

```text
.pagelet/pagelet-smoke-golden-pagelet-review-2026-06-06-11.md
```

源笔记不会被修改。

## 审阅最近几天的笔记

适合：做日回顾、项目回顾、周回顾，或者想从最近几天的零散笔记中找出重点。

1. 打开任意一篇 Markdown 笔记作为锚点。
2. 运行 `Pagelet: Open Pagelet`。
3. 选择一个范围：
   - `Current`：只审阅当前笔记；
   - `Yesterday`：审阅昨天的笔记；
   - `Last 3 days`：做一次轻量近期回顾；
   - `Last 7 days`：做一次周回顾式扫描。
4. 在 `Included` 中检查 Pagelet 将要读取的笔记。
5. 在 `Skipped` 中检查被排除的笔记和原因。
6. 如果某篇笔记不该发给 provider，取消勾选它。
7. 确认范围后点击 `Review selected (N)`。

`Scope` 是 Pagelet 的安全边界之一：你可以在真正调用 AI 前看到并调整将要
读取的笔记。

在已验证的 test vault 中，Pagelet 生成过的审阅笔记不会一条条塞进 skipped
列表，而是聚合显示为：

```text
Excluded: 10 Pagelet review notes
```

`.trash/` 和其它隐藏/系统目录路径也不会出现在普通 scope 行里。这能避免把
隐藏内容或生成内容送进 provider，同时让 scope 面板保持可读。

## 怎么理解建议卡片

Pagelet 的建议卡片不是“自动改稿”，而是给你挑选的审阅材料。

常见建议类型：

- `Clarify`：当前表达可能不够清楚，需要补决策条件、背景或结论；
- `Expand`：某个想法值得展开，需要例子、证据、下一步或边界；
- `Link`：这篇笔记和其它笔记、链接或概念有关联；
- `Evidence`：某个判断需要来源、数据或外部查证；
- `Trim`：内容可能重复、发散或不利于后续行动。

卡片里的关键区域：

- `Source`：建议来自哪段笔记或哪个 source id；
- `Why`：为什么 Pagelet 认为这件事值得处理；
- `Suggested action`：可以怎么改、补、查或整理；
- `Related notes`：Pagelet 发现的相关笔记；
- `Cost`：可用时显示本次审阅成本。

使用建议时保持判断：有用就加入草稿，不确定就打开来源或查证，不合适就
Dismiss。

## 用草稿区收集有用内容

点击 `Add to draft` 后，Pagelet 会把建议动作复制到 `Draft` 区。你可以：

- 收集多条建议；
- 直接编辑每个草稿块；
- 删除不想保留的草稿块；
- 关闭并重新打开面板后，继续恢复同一来源笔记的未完成草稿。

草稿区只是本地待处理状态，不会自动创建新笔记。只有你在面板保存确认区点击
`Save review note` 后，Pagelet 才会写入一篇审阅笔记。

## 用 Research 做查证

当建议类型是 `Evidence` 或 `Link` 时，卡片可能出现 `Research`。它适合用在
这些情况：

- Pagelet 指出某个判断缺少证据；
- 某个链接或相关笔记需要外部资料补充；
- 你想知道这条建议是否有可靠来源支持。

Research 的行为很克制：

- 它只把查证提示准备到 Personal Assistant Chat；
- 不会自动提交 Chat；
- 如果 Chat 里已经有草稿，它不会覆盖；
- 提示会要求 Chat 不要修改任何笔记。

这让你可以先检查 prompt，再决定是否提交、是否使用 Web Search、是否把结果
带回审阅草稿。

## 保存还是取消

Pagelet 返回建议后，面板会显示保存确认区。这个区域会列出目标路径，并提供
可展开的 Markdown 预览。

选择 `Save review note` 的场景：

- 这次审阅产生了值得保留的结论；
- 你想给当前笔记或近期笔记留一个独立审阅记录；
- 你希望以后能通过 Obsidian 链接、搜索或历史记录重新找到这次 review。

选择 `Cancel` 的场景：

- 只是想临时看一下建议；
- 这次建议没有明显价值；
- 你想自己手动改源笔记，不需要保留 sidecar 审阅记录。

取消不会创建 `.pagelet/*.md` 文件。

## 保存后的审阅笔记

保存后的审阅笔记会带有 Pagelet frontmatter，例如 `pagelet: true` 和来源笔记
路径。这样 Pagelet 和其它工具能识别这是 AI 审阅产物，并避免重复审阅自己的
输出。

默认保存目录是 `.pagelet/`。你可以在设置里改审阅笔记目录，但路径必须是
安全的 vault 相对路径。Pagelet 会拒绝绝对路径、`..` 上级跳转、`.obsidian`
配置目录或其它不安全位置。

## 常见问题

`Open a Markdown note before running Pagelet.`

: 当前没有可审阅的 Markdown 笔记。Canvas 等非 Markdown 视图会安全 no-op。

`Pagelet needs some note text to review.`

: 当前范围内没有可读正文。打开有内容的笔记，或换一个时间范围。

`Pagelet hit the hourly call limit. Try again later.`

: 当前 provider 或 Pagelet 限额挡住了新的模型响应。稍后重试，或检查设置中
  的 provider、模型和限额。

`No suggestions worth saving.`

: Pagelet 完成了审阅，但没有发现值得保存的建议。这不一定是错误，短笔记或
  已经很清晰的笔记可能会出现这种结果。

面板里出现 `Skipped`。

: 先看跳过原因。`unchecked` 表示你手动取消了这篇笔记；`excluded tag` 和
  `pagelet note` 是安全排除。

## 几个实际用法

单篇清晰度检查：

1. 打开刚写完的笔记。
2. 运行 `Pagelet: Open Pagelet`。
3. 保持范围为 `Current`。
4. 点击 `Review selected (1)`。
5. 只采纳能让笔记更清楚、更容易行动的建议。

日回顾：

1. 打开 Pagelet。
2. 选择 `Yesterday` 或 `Last 3 days`。
3. 排除噪音笔记。
4. 用 `Add to draft` 收集 follow-up、未闭环决策和不清楚的地方。
5. 如果信号足够，保存一篇审阅笔记。

周扫描：

1. 打开 Pagelet。
2. 选择 `Last 7 days`。
3. 先检查 included 列表。
4. 重点看 `Evidence`、`Link`、`Clarify`。
5. 只对真正需要外部确认的建议使用 `Research`。

查证缺口：

1. 对包含判断、引用或决策的笔记运行 Pagelet。
2. 找到 `Evidence` 或 `Link` 建议。
3. 点击 `Research`。
4. 检查 Chat 中准备好的 prompt，再决定是否提交。

快速当前笔记审阅：

1. 打开一篇 Markdown 笔记。
2. 使用 `Pagelet: Review current note` 或 Pagelet 图标。
3. 等 Pagelet 完成后阅读建议卡片。
4. 在面板保存确认区保存或取消。

## 本指南核对过的真实路径

本指南对照了 2026-06-06 的 Obsidian `test/` vault GUI smoke：

- Pagelet 在已部署的 Obsidian 插件包中打开成功；
- `Current`、`Yesterday`、`Last 3 days`、`Last 7 days` 范围控件可见；
- `Review selected (1)` 和多笔记 `Review selected (N)` 路径渲染正常；
- provider 调用前能看到 included / skipped scope 行；
- `.pagelet/` 审阅输出被聚合显示，没有逐条污染 skipped 列表；
- 取消路径没有写入审阅笔记；
- 保存路径只写入一篇 `.pagelet/*.md` 审阅笔记；
- Source、related note、Draft、Dismiss、Research 在真实面板中通过；
- provider quota 被归类为外部 `BLOCKED`，不是 Pagelet 产品失败。

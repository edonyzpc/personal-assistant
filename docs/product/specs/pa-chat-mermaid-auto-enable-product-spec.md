# Chat Mermaid Auto Enable Product Spec

Document status: Approved
Updated: 2026-10-24
Work item: B-188
Decision: [DEC-074](../decisions/dec-074-chat-mermaid-auto-enable.md)
Authority: 本文持有 Owner 已授权的原生 Mermaid 自动开启范围、验收标准与稳定接线责任；历史验证由文末记录承接。

## Outcome And Scope

消除 Chat 绘制 Mermaid 时的 Allow 点击，保持原生 Markdown 与图内交互，符合
[North Star](../pa-product-north-star.md) 的低负担方向。开启的是宿主本设备本 vault
设置，并非 Chat 私有设置；笔记同受影响，手动关闭后下次 PA 绘图会重新开启。

| Requirement | 行为 |
| --- | --- |
| B-188/REQ-01 | 在需要原生绘制 Mermaid 前确保宿主开关已开启，再调用原有 renderer |
| B-188/REQ-02 | 以当前设置为准，已 true 不重复写入/通知；不保存“检查过”状态 |
| B-188/REQ-03 | 普通文本、外层代码/HTML 示例及已降级为 text 的流式块不触发设置写入或刷新；允许只读检查 |
| B-188/REQ-04 | 正文、历史与放大窗口沿用原生 renderer、sourcePath、原文、链接/文字选择、owner 和现有源码回退/错误显示 |
| B-188/REQ-05 | 副作用只为本设备本 vault 的宿主开关；无新增 PA 设置、provider 请求、迁移或后台任务；卸载不撤销设置 |

## Acceptance Criteria

| Acceptance | 通过条件 |
| --- | --- |
| B-188/AC-01 | 未开启时原生 renderer 调用前已写 true 并通知；合法图直接显示、无 Allow |
| B-188/AC-02 | 已 true 时零额外写入/事件；关闭后下次绘图再开启；同消息多图不重复设置 |
| B-188/AC-03 | 普通内容/代码/HTML 示例、已转 text 的块不写设置或发事件；反引号、波浪线、引用和列表中的有效 Mermaid fence 能触发 |
| B-188/AC-04 | 生产接线中正文/历史和 Modal 出图，链接、文字选择和关闭操作正常；现有原文/sourcePath/owner 及失败路径回归保持 |
| B-188/AC-05 | 实际 diff 与运行行为限定当前 App 的 vault storage，不新增 UI/外发/后台维护/卸载回写 |

## Non-goals And Compatibility

不替换 renderer、改 securityLevel、栅格化 SVG、轮询设置或强刷全部旧消息；不修复
其他 Mermaid fence 的旧流式/源码提取限制，不构建版本/图形/设备矩阵。现有 Allow
静态页面需再次原生渲染，可通过重开会话触发。storage API 公共，Mermaid 键/事件私有；
仅有当前本机宿主的证据，不承诺未来版本。回滚停止自动接线后可在宿主中手动关闭。

## Implementation Contract

正文、历史与 `MermaidPreviewModal.onOpen` 共用 `src/chat/mermaid.ts` 的
`renderMarkdownWithOwner`。Chat 在 bridge.prepare 中先做显示兼容与 Mermaid defer/fallback，
把实际渲染输入交给该入口；`native-markdown-bridge` 继续管理暂停、owner、废弃结果与发布。

局部 `ensureMermaidEnabledForRender` 在现有 try 内、`MarkdownRenderer.render` 之前同步
检查。可先按 fence 标记排除，再读 `app.loadLocalStorage('mermaid-vault-trust')`；已 true
直接返回。未开启时用现有 markdown-it 的惰性 block parser（html:true，禁用 inline）检查
fence token，以 info 首词识别 Mermaid，沿用大小写不敏感规则。有图才先写 true，再触发
`post-processor-change`，然后继续原生 renderer；普通外层代码／HTML 示例不产生该副作用。

宿主拥有开关和绘图；PA 仅做绘图前检查／写入，不新增 await、trust 缓存、常驻监听、
版本表或解析服务。同步异常进入已有 rejection，Chat／Modal 分别沿用既有 fallback／
错误显示，不吞错或额外重试。局部 parser 不宣称等价于宿主全部扩展语法，也不改写
既有 contains/defer/source 扫描器或流式调度。

当前实现使用公开 storage API（since 1.8.7），项目最低宿主为 1.11.4；私有键／事件仅有
Obsidian 1.14.4 的本机证据。不区分从未开启与用户关闭（宿主均返回 null）；移除局部
接线即可回滚代码，卸载不清除宿主值，不迁移笔记或会话。

## Delivery And Evidence

三项实施任务与五组 REQ/AC 已完成必要验证，无未定产品选项或未解决 finding。
原完整 Jest 的环境失败及单套复验保持分开记录，不改写为全仓命令 exit 0。

- [最终验证与证据限制](../../archive/2026/b188-chat-mermaid-auto-enable-validation.md)
- 本地实现提交为 `222f040a`；2026-10-24 用户另行授权清理已完成记录，稳定行为吸收后
  删除活跃过程包。本次清理未进行新 Git 提交、推送或发布。

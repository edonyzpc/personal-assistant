# DEC-074 — Chat 原生 Mermaid 渲染前自动开启

Decision ID: DEC-074
Status: Accepted
Updated: 2026-10-24
Work item: B-188
Authority: Owner 于 2026-10-24 要求按 review 精简方案并完成开发、测试和实机验证，保持现有原生渲染，不做过度设计和测试；该实施指令不含提交、发布或 closeout。后续本地提交及本轮记录清理授权分别承接，不倒改原授权。

## Decision

PA 在需要原生绘制 Mermaid 时，将当前设备当前 vault 的宿主 Mermaid 开关设为
开启，然后继续 `MarkdownRenderer.render`。已开启不重复写入或通知；不缓存“检查过”，
用户关闭后，下次 Mermaid 绘制会再次开启。普通消息/代码示例不改设置。
允许只读设置检查并在已开启时直接返回，不把“不读取”设为产品或测试要求。

保留链接、文字选择、原文、放大窗口及原生 owner/错误处理。只复用现有 markdown-it
依赖判断图块，不引入渲染器、权限系统、设置 UI、后台监听或全量旧消息刷新。

## Evidence And Consequences

- 本机 Obsidian 1.14.4 已验证 `mermaid-vault-trust` 的 true 值与
  `post-processor-change` 通知；设置后再次原生渲染可出图。仅事件不刷新旧静态 Chat。
- 这是当前设备当前 vault 的宿主设置，笔记也受影响；键/事件为私有契约，不能声称
  跨版本稳定。通用 storage API 为公开接口。路线临时验证与后续生产接线验收分别
  记入 [最终验证记录](../../archive/2026/b188-chat-mermaid-auto-enable-validation.md)。
- 不在关闭 Chat 或卸载时清除值，以免撤销用户自己开启的设置。回滚代码后，用户可
  手动关闭宿主设置；无需迁移笔记、会话或新增持久标记。
- 手动设置保留为宿主能力；自建 Mermaid/SVG 渲染路线已排除，避免扩大兼容与交互责任。

## Revisit Trigger

宿主升级后出现具体 Allow 回归、官方配置接口变化，或实际需要 Chat 独立于 vault
的信任范围时重新讨论；不预建版本表和备用渲染器。

## Traceability

- [Product Spec](../specs/pa-chat-mermaid-auto-enable-product-spec.md)
- [最终验证与收尾记录](../../archive/2026/b188-chat-mermaid-auto-enable-validation.md)
- 2026-10-24 实现、独立审查及部署后原生交互验收完成，无未解决 finding。用户随后
  授权清理已完成记录；稳定接线责任吸收至 Product Spec，删除已吸收的 Feature Home、
  SDD 和 Tracker。本次清理不包含新 Git 提交、推送或发布。

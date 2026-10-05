# B-106 Simple Settings — 最终验证证据

Document status: Archived
Delivery status: Closed
Closed date: 2026-10-05
Work item: B-106
Authority: 原 B-106 交付的历史验收证据；不作为当前行为或执行状态权威。

## 交付边界

2026-09-08 已完成原 B-106/REQ-01..08、AC-01..07 的实施、独立复核、完整
门禁和 Desktop/mobile simulator 交互。2026-10-05 Owner 明确授权 closeout
所有实际完成任务，原过程包在稳定结果吸收后删除。

当前行为由 [DEC-033](../../product/decisions/dec-033-simple-settings-and-unified-defaults.md)、
[B-106 Product Spec](../../product/specs/pa-simple-settings-product-spec.md) 和
[Settings status](../../architecture/settings-status.md) 定义。原交付时两项长期学习
独立 opt-in 的基线保留为历史事实；2026-09-09 的默认开启、迁移和独立退出修订归
[DEC-034](../../product/decisions/dec-034-unified-agent-task-execution.md) 与
[B-135 验证](./b135-unified-task-execution-validation.md)，不向 B-106 回填。

## 需求与最终证据

| Requirement / AC | 最终证据 |
| --- | --- |
| REQ-01/03/08；AC-01/03/06/07 | Desktop UI-01..04：EN/ZH 四组导航、Custom 连接、Memory 精确深链/恢复、图谱与题图现场面板和统计选择实际可达；移动 UI-05/06 的导航、折叠、输入、深链和焦点通过 |
| REQ-02/05/06/07；AC-02/05 | 原五旧键迁移与保存清理、必要 Memory/内置指南、自动与手动 lane 隔离、来源和权限保全的 focused/full 测试及独立复核通过；P1 实际旧值迁移、后台暂停时手动发现与 Chat 通过 |
| REQ-04/07；AC-04/05/07 | 两项学习权限和来源代表项的 pending→失败→重开→重试通过；不联动另一权限，局部刷新保留 Provider 草稿；七个排除数组、并发及治理事务矩阵由 focused/full 保护 |
| REQ-08；AC-06/07 | 宿主 Memory 卡片暂停/恢复、纠正取消、真实遗忘确认取消及恢复入口可达；局部刷新保同 DOM 草稿。治理持久化用自动化证据，不将合成宿主卡片算作真实数据迁移 |

## 冻结门禁与产物

- 2026-09-08 最终 lint、production build/TypeScript 通过；完整 Jest 为
  **242 suites / 6376 tests**，100.918s，自然退出 0。独立契约/源码复核无剩余
  P0/P1/P2，全部适用 REQ/AC 满足。
- `make deploy-current` 后最终 loaded/dist/install `main.js` SHA-256 一致：
  `2f16a6ac541af8375ed0592c8311faf63599004366a523233e3f1beb152830e7`。
  `styles.css` SHA-256：
  `664a4684d2f274dd8b3e95f5870301ea5aae44c05f22792bff2cd69753b5c8d6`。
- 最终文档门禁为 198 Markdown / 1634 links，退出 0；4 项既有 episodic
  advisory 保持可见。Whitespace 与禁止 DOM 注入扫描通过。自动门禁后只更新
  验收记录，没有为文档变化重跑 runtime 检查。

## 独有宿主观察与失败处置

- D-12 的真实 Obsidian Toggle 同步回调造成重复提交，定向 RED→GREEN 后实际
  单击记录 `calls=[false]`；D-13/D-16 的 pending 控件、失败重试与来源草稿通过。
- D-15 的 Metadata 旧保存回调完成后，新表单两个输入仍为同 DOM 且新草稿可见；
  合成规则未写盘。D-18 的缺失目标最终回管理区，summary top/bottom 为
  342.875/386.875，位于 700px viewport，`pending=null`。
- D-19 的独立窗口富文本不再显示 `[object DocumentFragment]`，两处说明、
  Metadata 名称和链接实际可读。
- 首轮完整门禁曾因 Pagelet 用量旧字面量断言失败；按实际已批准文案修正测试，
  保留原调用次数断言。最终 D-18/D-19 门禁曾因新增 fixture 缺少 `t: 'string'`
  被 TypeScript 拒绝；只补 fixture 字段后通过，未修改生产契约或放宽类型。
- Mac 锁定曾阻塞真实 UI，未将加载身份冒充交互 PASS；之后已取得最终 Desktop
  和 simulator 证据，阻塞已解除。

## 平台、数据与清理限制

Owner 于 2026-09-08 明确：除 iOS 本身强相关变化外，通用移动验收默认用
Obsidian CLI mobile simulator。该产物在 **390×844**、`is-mobile/is-phone=true`
时无横向溢出；目标 ARTICLE 聚焦，祖先展开，rect 292.10..611.30 位于 844px
viewport，局部刷新保同 DOM 来源草稿。没有以此证明 iOS Keychain、原生软键盘
或 WKWebView 特有行为。

显式 token 编辑读取 1 次后取消，被动读取 0；笔记修改 0、捕获错误 0。
未新增真实图片生成或 provider 案例，未迁移 test 的 `legacy_threshold` 治理数据。
语言、corePopout、插桩、合成卡片及来源草稿已清理，恢复桌面后 viewport
1865×1050，最后 load 为 `2026-09-08T14:39:51.577Z`，`blocker=null`。
原 `qwen3.8-max` 已恢复；后台仍为 false，先前自动审批拒绝的恢复操作未执行，
该环境状态不构成源码验收缺口。

本记录不证明 B-106 当时的 Git 交付、CI 或版本发布；后续默认学习行为使用
B-135 的独立证据。没有本范围内未完成任务或待接纳 finding。

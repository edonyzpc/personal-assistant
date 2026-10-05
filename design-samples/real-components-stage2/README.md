# 真实组件第二阶段记录

**Status: Draft evidence — 2026-10-04**

本记录支持根目录 [DESIGN.md](../../DESIGN.md) 的基线观察与候选收敛，不批准设计标准或生产代码改造。截图来自真实 Obsidian 中当前生产 UI 类的受控样板，未修改生产源码或样式。

## 条件与样板

- 宿主：Obsidian 1.14.4，installer 1.12.4；repo-local `test/` 测试库，Default 宿主样式。没有部署到日常/iCloud 库。
- Chat：在独立临时 leaf 中实例化现有 `LLMView`，使用 `plugin.createChatHost()` 和受控服务；禁用样板历史、Memory 提取及图片/写作/Ghost 服务。真实 Markdown、保存建议策略、草稿保护、按钮、菜单与焦点路径保持当前实现。
- Pagelet：独立实例化现有 `PanelView`，注入一条 clarify 建议；真实 Panel 布局和 Draft/Dismiss 状态保留。来源与相关笔记回调打开测试笔记；Research、Save、Expand 仅记录，不执行服务。
- 固定输入及服务载于 [fixture.js](fixture.js)。Chat 首条结论为 418 字符，来源是 `Cat.md`，相关笔记为 `0.unsorted/Dog.md`；样板文本不是模型或检索结果，不据此判断知识准确性。
- Chat 栏宽通过临时实例容器限定为 420/320/360px，Pagelet 当前宽度为 460px；这是组件栏宽，不是整台设备视口。移动状态使用 Obsidian `dev:mobile`，指针操作仍在 Mac 上。
- 长来源压力状态仅将正文 `[[Cat]]` 改为带长英文别名的同一链接，不变更跳转对象。来源菜单使用现有长说明。Pagelet finding 的长 title 未在当前卡片展示，不算长标题验证。
- 正文压力探针只临时将宿主 CSS 变量 `--font-text-size` 从 16px 改为 20px；没有操作原生字号设置入口。

`fixture.js` 是此次观察的测试辅助快照，不打包、不自动执行。复现必须先确认 repo-local 测试库、已有非流式 Chat、原 Pagelet 没有未处理状态；打开临时类实例后，以原生输入/点击执行下表。只登记并清理本次确知创建的来源 leaf，不按“非基线 leaf”批量删除。`restore()` 只释放样板组件、登记的 leaf 和计时器；主题、字号变量、移动模拟与 Debug 需另按原值恢复，最后删除 `window.__paDesignStage2`。

## 原生观察与交互

| 状态或操作 | 结果与证据 | 边界 |
| --- | --- | --- |
| 完成结论与保存建议，420px 浅色/深色 | Save/Not now 可见高度 28px、字体 12px；输入工具 28px；所测根容器和输入区无水平溢出。[浅色](chat-light-420.png)、[深色](chat-dark-420.png) | 仅当前宿主与能力组合，不是项目尺寸标准。 |
| 草稿中点击 Save，键盘 Tab 到 Not now，再执行忽略 | 显示 `Send your current draft first, then choose Save again.`，草稿保留；焦点可见；忽略后动作撤除并留下收束反馈。[焦点与草稿](chat-focus-draft.png) | 没有实际保存。 |
| 空草稿点击 Save | 出现 `Preparing a save preview…`，请求分派给受控服务 | 没有创建预览、授权或写入，不能称完整保存路径通过。 |
| 点击正文来源 Cat | 原生打开测试库 `Cat.md` | 固定来源，不证明检索。 |
| 受控流式回答，点击 Stop generation | 流式结束，计时器释放，已有部分文本保留。[停止后](chat-stopped.png) | 合成流，未验证 provider 或 thinking 完整生命周期。 |
| 受控抛错，点击 Retry | 显示 `The answer did not finish.`，草稿恢复；重试替换错误并完成受控回答。[错误态](chat-error.png) | 错误由样板注入。 |
| 320px、长来源、详情与菜单 | 正文长英文别名换行；来源菜单说明可读；点击输入区可关闭该菜单；详情和“更多”菜单原生展开。[窄栏](chat-light-320.png)、[长来源](chat-long-source-320.png)、[来源菜单](chat-source-menu-320.png) | 没有逐项执行全部菜单动作，也没有证明所有退出方式。 |
| 360px 移动模拟 | Save/Not now 44px；可见工具 28px；compact 将 Memory 收入更多；根容器宽度无水平溢出。[移动基线](chat-mobile-360.png) | 不是 iPhone 触摸或键盘弹出证据。 |
| Pagelet 阅读、来源与相关笔记 | 来源、理由、行动与相关笔记均按现有布局展示；原生打开 `Cat.md` 和 `0.unsorted/Dog.md`。[浅色基线](pagelet-light.png) | 仅现有 Panel 类，不证明完整 Orchestrator 或返回准确性。 |
| Pagelet Add to draft、Remove、Dismiss、Close | 加入后有 Draft 与 Remove；Remove 清空草稿，建议保留；Dismiss 显示 `NO VISIBLE SUGGESTIONS.`，保存禁用；聚焦 Close 后 Return 关闭。[Draft](pagelet-draft.png)、[忽略后](pagelet-dismissed.png) | 加入 Draft 不是保存或执行；未执行 Research、Save、Expand。 |
| CSS 正文字号变量 16→20px | Chat 正文仍 15px、Save 12px；Pagelet 来源/建议动作 12→15px，相关笔记/底部动作 13→16.25px，动作高度仍 30px。[Pagelet 深色压力态](pagelet-dark-text20.png) | 不等于原生字号设置已验证；无全界面评分。 |

## 已确认的问题：移动输入工具扩展区域重叠

在上述 360px 移动模拟中，来源与更多按钮可见尺寸均为 28×28px，中心距 32px。伪元素扩展区域的计算尺寸为 42×42px，相邻范围重叠 10px，不能按 `28 + 8 + 8` 宣称达到 44px。

来源中心的实际命中归属为 `Answer sources: My notes`；中心右侧 16px 和 20px 的归属为 `More chat actions`。原生指针点击中心右侧 20px 时确实打开更多菜单，中心点击打开来源菜单，见[边缘点击结果](chat-mobile-hit.png)。截图为 Retina 2×，操作坐标根据当前屏幕像素对应 CSS 坐标换算。

结论仅限当前组件的扩展区域与相邻目标归属。独立浏览器候选中的 44px 区域、16px 间距和 8px 预留**尚未在真实组件采用或验证**。后续局部试验必须检查中心/边缘归属、边界越界、窄栏、能力组合、菜单与键盘焦点；若声称 iOS 可用，还需真实设备触摸。

## 构建、验证与恢复

真实观察前执行既有 `make deploy`：platform guards（512 个 TypeScript 文件）、lint、生产构建、373/373 suites 和 8932/8932 tests 通过，自然退出 0；部署到 repo-local 测试库，main/styles/manifest 内容与 dist 一致。社区 DOM 注入扫描无匹配（退出 1，按项目规则为通过）。这属于构建/部署证据，不能替代上面的原生交互。

首轮沙箱运行受到 `listen EPERM 127.0.0.1` 环境阻断；获准按同一命令在沙箱外重跑后通过。最终 Jest 有非致命 open-handle 提示，命令自然退出 0，未使用 `--forceExit`。原始执行证据保留在本机 `/private/tmp/pa-design-stage2-20261004/` 的 `worker-result.md`、`deploy.log` 和 `deploy.sandbox-failed.log`，临时路径不作为永久链接。

观察时产物身份：

- main.js SHA-256：`fa4125b3b6b95388b6c03a27a1b775a31b429a4163529a5a81e0e0dfaec5d9fb`
- styles.css SHA-256：`1c27a78d440439da805c54bb024596fcdb8a961a17ba6373ee5d5ade9554fe9b`

结束时已撤除临时 Chat、Panel、登记的来源页、全局辅助对象及流式计时器；原 active leaf 恢复，原 Chat 不处于流式状态。恢复结果为 theme=`system`（当时深色）、正文变量=`16px`、mobile=`false`、Debug=`false`，临时 Panel 数为 0。当前 repo-local 测试部署保留。未修改生产源码/测试/配置，未提交或推送。

第二阶段完成基线观察与 Draft 收敛。原生字号设置、候选修正、完整保存、真实 iPhone、Memory/Operations Review 和其他 Chat 卡片仍各自未验证。

# Chat Image Management Development Tracker

Document status: Current
Delivery status: Validating
Updated: 2026-09-08
Work item: B-129
Authority: 本 track 的唯一执行状态、验证证据与交接入口。
Product spec: [Multimodal Chat](../../../product/specs/pa-multimodal-chat-product-spec.md)
SDD: [Design](./sdd.md)

## Current Snapshot

- Current phase: 开发、自动验证及 Desktop 实际保存闭环完成；保留 Validating 等待 iOS 真机。
- Next action: 在 Mac/iCloud test + 连接的 iPhone 上验证照片/Files/粘贴、保存迁出、重开与清理归属。
- Blocker / decision needed: Linux 可访问 Desktop test；无 Mac/iCloud/iPhone，iOS 真机验证待外部环境。
- Last verified behavior: 最终构建在 Desktop 保留交付 JPEG、拒绝 HEIC、迁出后多笔记/聊天共用，重载后可重建预览。

### Mac / iPhone Session Handoff

- 开发分支：`codex/chat-image-management-b129`。2026-09-08 用户授权提交并推送当前改动；
  精确交接 SHA/tree 以推送后的会话回执与实时远端核对为准，不在本文自引用最终提交。
- Mac 从仓库实际路径开始：先保护已有未提交工作，再 fetch 并核对该远端分支与交接 SHA/tree。
  工作区有冲突时使用独立工作树；不要覆盖本机修改、自动 rebase 或切换到 master。
- 首读本 Feature Home + Tracker，再按需读取 SDD、DEC-030 和 Product Spec。
  使用 obsidian-test-vault-smoke 与 obsidian-ios-real-device-smoke 技能；本节只规定本功能的范围。
- 用锁文件准备依赖，核对可复用自动检查的输入和结果，补齐 Mac 当前构建与本地 test 应用验证。
  上面的 Linux 日志/截图/夹具不是 Git 交付物；不能假设在 Mac 存在，也不能代替当前应用证据。
  不能证明输入一致的检查重新执行；已满足的同一构建检查不重复跑。
- 真机执行会话需明确授权部署到 iCloud Obsidian `test`，仅写测试库的插件资产与独立测试夹具。
  核对四个部署资产、iPhone 加载的 main.js 身份、真实触摸和 Safari Inspector 证据；
  资产同步成功不等于真机行为通过。设备未连接或 Inspector 不可用时按技能限次处理并记录缺口。

| 本轮真机验收 | 通过条件 |
| --- | --- |
| 照片、Files、粘贴及取消 | 保留实际交付的受支持文件；取消不丢草稿；不因入口不同要求再次添加原图 |
| HEIC 边界 | 实际 HEIC 被拒绝且不落盘/转换；系统实际交付 JPEG 时正常接受，以文件内容判断 |
| 保存、复用、重开 | 预览不迁移；确认只迁出选中图片，字节不变；再次保存复用；重开聊天和笔记均能显示 |
| 附件目录与清理归属 | 在测试库验证 attachments/pa-images → attachments；未选图片留原处，已迁出图片退出聊天原图清理范围 |
| UI 回归 | 默认及放大字号下，窄屏菜单、图片入口和保存窗口无溢出/遮挡，真实点击可用；中英文均检查相关标签 |
| 旧数据兼容 | 有独立旧 HEIC/未完成保存夹具时核对保留与恢复边界；无夹具明确标 NOT TESTED，不修改真实用户历史数据 |

结果回写本 Tracker，区分 PASS/FAIL/BLOCKED/NOT TESTED。发现缺陷先记录可复现证据，
修复按新会话授权处理；未完成真机验收前保持 Validating。Git 推送不包含合并、Beta/正式发布或 closeout。

## Work

| ID | Requirement / AC | Slice | Status | Evidence |
| --- | --- | --- | --- | --- |
| T-01 | B-129/REQ-01 / B-129/AC-01 / B-129/REQ-15 / B-129/AC-15 | 输入及 HEIC 实施 | [x] | 定向与完整测试、Desktop 字节门禁 |
| T-02 | B-129/REQ-04 / B-129/AC-04 / B-129/REQ-05 / B-129/AC-05 / B-129/REQ-11 / B-129/AC-11 | 迁出及恢复实施 | [x] | 真实服务组合及 Desktop 保存/重载 |
| T-03 | B-129/REQ-06 / B-129/AC-06 | 说明与管理实施 | [x] | UI/管理回归及实际保存界面 |
| T-04 | 全部契约 | 审查与平台验收 | [~] | Desktop 完成；iOS 真机未验，不以源码通过代替 |

## Contract Coverage

| Requirement / AC | Treatment |
| --- | --- |
| B-129/REQ-01 / B-129/AC-01 | 本次输入、迁出、兼容与同步验证 |
| B-129/REQ-02 / B-129/AC-02 | 继承既有契约；共享回归验证，不扩大产品范围 |
| B-129/REQ-03 / B-129/AC-03 | 继承既有契约；共享回归验证，不扩大产品范围 |
| B-129/REQ-04 / B-129/AC-04 | 本次输入、迁出、兼容与同步验证 |
| B-129/REQ-05 / B-129/AC-05 | 本次输入、迁出、兼容与同步验证 |
| B-129/REQ-06 / B-129/AC-06 | 本次输入、迁出、兼容与同步验证 |
| B-129/REQ-07 / B-129/AC-07 | 继承既有契约；共享回归验证，不扩大产品范围 |
| B-129/REQ-08 / B-129/AC-08 | 继承既有契约；共享回归验证，不扩大产品范围 |
| B-129/REQ-09 / B-129/AC-09 | 继承既有契约；共享回归验证，不扩大产品范围 |
| B-129/REQ-10 / B-129/AC-10 | 继承既有契约；共享回归验证，不扩大产品范围 |
| B-129/REQ-11 / B-129/AC-11 | 本次输入、迁出、兼容与同步验证 |
| B-129/REQ-12 / B-129/AC-12 | 继承既有契约；共享回归验证，不扩大产品范围 |
| B-129/REQ-13 / B-129/AC-13 | 继承既有契约；共享回归验证，不扩大产品范围 |
| B-129/REQ-14 / B-129/AC-14 | 继承既有契约；共享回归验证，不扩大产品范围 |
| B-129/REQ-15 / B-129/AC-15 | 本次输入、迁出、兼容与同步验证 |

## Validation Planning

| REQ/AC or risk | Change | Minimum evidence / command | Pass condition | Expansion trigger |
| --- | --- | --- | --- | --- |
| AC-01/04/15 | 字节门禁及统一交付 | format/processor/assets/chat source suites | HEIC 零写入零转换；JPEG 保留；草稿不丢 | 新入口或格式绕过 |
| AC-04/05/11 | 迁出/冻结记录 | assets/save source suites | 中断恢复；共享引用有效；禁止误删 | 并发、持久化或事件风险 |
| AC-06 | 同步与保存说明 | modal tests、实际界面 | 准确描述迁出与同步 | 文案误导或不可见 |
| 共享持久化/UI | 最终冻结构建 | lint/build/test:all、docs:check、diff check、DOM source scan | 自然退出，无新增失败 | 源码/配置/夹具变化即失效 |
| Desktop/iOS | 导入、保存、重开、清理 | 当前构建部署及实际 smoke | 文件/界面同构建证据 | 环境不可用记录缺口 |

## Findings

| ID | Severity | Finding | Fix / verification | State |
| --- | --- | --- | --- | --- |
| R-01 | P2 | 单项恢复失败使管理列表不可用 | 单项隔离；pending 禁止清理；assets 回归通过 | Closed |
| R-02 | P2 | 已迁出仍受新附件设置影响 | 延迟 resolver，仅首次迁出执行；真实 assets+save 组合通过 | Closed |
| R-03 | P2 | 重新定位被旧 pending 意图阻断 | 保留历史意图，退出当前读取路径；恢复回归通过 | Closed |
| R-04 | P2 | 复用附件的保存详情仍显示候选复制文件名 | 显示 reference 实际 sourcePath；定向回归和最终构建实际预览通过 | Closed |

独立复查无剩余可证明 P1/P2；真实应用多事件监听与持久化另行验证。

## Validation Log

- format/processor：2 suites / 95 tests PASS，自然退出。
- assets：1 suite / 40 tests PASS，含真实 assets+save 组合、中断、取消和源变更。
- save-action：1 suite / 24 tests PASS；modal：1 suite / 13 tests PASS。
- chat-view 与 modal 先前合并 252 tests PASS；后续仅 modal 夹具适配 lazy resolver 并重跑。
- 全局 TypeScript 初次通过；最终由 make deploy 包含的构建及全套验证更新证据。
- 历史验证不作为本次 PASS；最终完整命令及应用证据待追加。

### 最终自动检查与构建

- make deploy 首次在 lint 因已删除用途的 Platform 导入停止；移除后 lint 通过。
  第二次构建在新测试夹具缺少必填资产字段停止；补齐实际字段后生产 build 通过。
  均未运行到部署步骤，不是应用验证失败。
- npm run test:all -- --runInBand 的沙箱尝试因子进程 spawn EPERM 停止（退出 130），
  不计为产品失败或 PASS。正常本地环境重跑：240 suites / 6317 tests 全部通过，
  最终执行结果退出 0；日志曾提示延迟退出，补充本轮 6 suites / 411 tests 的
  --detectOpenHandles 检查通过、自然退出 0，无遗留句柄报告。
- make deploy-current 成功，验证当前 production identity 后复制到 test 插件目录；
  复用此前通过的同一 runtime/config/dependency 构建、Lint 和完整测试。
- docs:check 在允许读取 Git 的环境通过：195 Markdown / 1585 links，
  仅两份既有 episodic-memory 文档的四条 advisory。diff check 和 DOM source scan 通过。

### Desktop 应用证据

- Obsidian 1.14.0（installer 1.11.7），vault=/mnt/code/personal-assistant/test，
  部署后 plugin:reload；运行接口含 promoteToNote。
- 独立夹具：test/B129 Image Smoke b129_1788855514580/result.json。
  真实 JPEG 输入、伪装 JPEG 名称的 HEIC 拒绝且零新增资产、预览零笔记写入通过。
- 三篇实际笔记共用 pa-8eb638874373ff8e-1.jpg，原 pa-images 路径消失；
  字节 SHA-256=f79fa62ac0f90982ed5cefd36fc53bc3a6434840540659c8a076747e34f31b6f 一致；
  新 acquisition=original_file，迁出资产=vault_reference，160x100 预览可重建。
- 以上为当前构建生产服务/真实 vault 证据；未调用 provider，不冒充真实鼠标/键盘流程。
  已打开独立聊天夹具并截取实际界面，交互和重开验证待追加。

### 保存详情修正后的最终证据

- R-04 只改变 writing-modal.ts 一行 reference 显示及对应断言，存储/移动/格式代码不变。
  按依赖搜索重跑两个直接覆盖此模块的源套件：252 tests PASS，退出 0；新生产构建、
  受影响源码 ESLint 通过；新 dist 绑定的 test:artifacts：2 suites / 61 tests PASS，退出 0。
  复用上面完整检查中未受这一显示变更影响的证据，不声称重跑了 6317 项。
- test-only 全文件 ESLint 的额外尝试报告既有 this-alias 模式（项目标准 lint 不扫描测试）；
  未为消除此可选检查而重写测试框架，实际要求的源码 Lint、TypeScript、Jest 均通过。
- 再次 make deploy-current + plugin:reload；main.js 与部署副本 SHA-256 均为
  8c22f1ba514870fd74c0e8286e415cd6ab323b5a411c73f0f25bc31af4670039；
  styles.css 均为 467dfdb61149b51612f3d08a9c0c872d87f79adaed0234c6a645904bdab05739。
- 原生 X11 点击初次审批超时，允许的一次重试成功；重载后窗口未激活导致事件未送达，
  用窗口管理器正常激活后捕获 mousedown.isTrusted=true、目标 Writing versions。
  此为测试工具问题，没有为工具问题改变产品代码。
- 真实窗口完成 Writing versions → Save as a note → Preview saving → Save this exact selection
  → Open note。最终详情显示 pa-8eb638874373ff8e-1.jpg，成功反馈及持久 receipt=completed；
  PA Writing 2026-09-08 164f4ba5.md 实际打开，图片 complete=true、naturalWidth=160、naturalHeight=100。
- 同轮此前实际键盘编辑标题、Escape 取消两层窗口；取消后测试目标笔记不存在。
  最终构建重载后仅清除此夹具 asset 的缓存，160x100 preview 重建成功，原图位置仍正确。
- 截图：/tmp/pa-image-management-saved-note.png；报告在上述夹具 result.json，
  记录最终构建 hash 与 uiNote。截图和测试夹具为本机证据，不承诺其他机器具有这些文件。
- 已恢复原 active conversation 86c42fff-d476-4b8d-8ed2-db1d7cd092cf、关闭本轮临时聊天 leaf，
  保留测试笔记/图片供核对；debug 未附加、mobile emulation 已关闭。最后重载前错误缓冲为 0，
  重载及读取后 No errors captured；最终再次核对会话和图片路径正确。
- iOS：当前 Linux 无 Mac/Safari/iCloud test 与连接 iPhone 的证据，未部署或声称真机 PASS。
  未发布；未进行本轮 Git commit/push。不得将此 track 标为 Validated/Closed/Shipped。

## Closeout Readiness

- [ ] current contract 与代码一致。
- [ ] 测试、审查与实际应用证据完整。
- [ ] 用户另行授权 closeout；开发分支提交/推送独立于 closeout 与发布。

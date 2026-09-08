# Simple Settings Delivery Plan

Document status: Draft
Updated: 2026-09-08
Work item: B-106
Authority: B-106 的阶段顺序、依赖、验证策略与执行边界。
Product spec: [Simple Settings Product Spec](../../../product/specs/pa-simple-settings-product-spec.md)
Tracker: [Development Tracker](./tracker.md)

## Goal And Non-goals

按 DEC-033 完整交付统一默认、四入口 Settings、有效权限与功能现场选择。
本轮为 `sdd-only`，仅完成设计与开发任务；运行时实施需后续进入实施模式。
不顺手删除整个 legacy Pagelet 子系统，不重做 provider/VSS/Memory 存储，
不增加设置框架或持久化迁移服务，不改变现有配额与质量门。

## Dependencies And Source Surface

源码基线与字段映射见 [SDD](./sdd.md#current-source-baseline)。依赖关系为：

```mermaid
flowchart LR
  D["P0 源码设计与任务核查"] --> M["P1 五个旧字段失效与必要能力"]
  M --> G1["P1 自动化与真实 App 验证"]
  G1 --> U["P2 四入口、治理详情与现场选项"]
  U --> G2["P2 自动化、Desktop 与 iOS 验证"]
  G2 --> A["P3 证据核对与契约同步"]
```

## Phases

| Phase | Outcome | Scope | Exit gate | Stop point |
| --- | --- | --- | --- | --- |
| P0 | 可执行、无未决产品选择的源码设计 | 字段闭集、接口、生命周期、任务与风险核查 | 独立设计复核、docs check、diff check；无未处置 P0/P1/P2 设计问题 | 本轮停在这里，不改 runtime |
| P1 | 新旧用户同一运行规则，必要机制完整 | T-01..T-06；现有六组 UI 同步移除废弃控件并提供新后台控制，避免中间状态不可操作 | focused source/tooling、Local Validation Gate；冻结后 `make deploy`，真实 test vault 验证手动/后台与 Memory；独立 review/fix 闭环 | App 验证通过后才能进入 P2 |
| P2 | 四入口和完整可达的专业/治理操作 | T-07..T-12；先有现场替代入口再移除旧行；EN/ZH、局部保存、窄屏 | focused source、Local Validation Gate；最终输入冻结后 `make deploy`、Desktop 和 targeted real-iOS smoke；独立 review/fix 闭环 | 全部适用 AC 通过，真实设备缺口不得标 PASS |
| P3 | 可审阅的完整交付与准确证据 | T-13；源码/契约/任务核对，吸收当前行为说明 | 复用最终 P2 相同输入/产物的证据，补齐未覆盖项，docs/diff check | 实施模式只到 Validated；closeout、commit、release 分别授权 |

P1/P2 每个任务先跑最接近的测试，阶段冻结时只安排一个执行者跑昂贵 gate。
P3 不因阶段名称另跑同一套 build/full tests。P2 后若修复代码或 fixture，按输入
影响使相关证据失效并重跑，不能复用旧产物的 App 结果。

## Task Ownership And Sequencing

- Integrator 独占 `src/settings.ts`、`src/plugin.ts`、共享 locales、`src/custom.pcss`
  与三个 smoke runner 的最终编辑；这些文件跨任务修改按 Tracker 依赖串行。
- Pagelet worker 可独占 scheduler/controller/orchestrator 与对应测试；Plugin 接缝
  由 integrator 集成，不能同时编辑 `src/plugin.ts` 的不同区域。
- Memory/Skills worker 可独占 MemoryHost、MemoryManager、Skills/runtime/host tools
  与对应测试；ChatHost、Chat view 的交叉修改先与 integrator 排定。
- P2 图谱与题图工作可分别拥有各自新 Modal/测试及功能模块；Settings/Plugin 命令
  注册、共享 locales/CSS 均交 integrator 合并。统计复用现有组件，不额外造状态层。
- Reviewer 只读共享依赖；发现问题返回 integrator。任何 worker 都不能回退他人修改。
- 完成字段接口 T-01 后，T-02 与 T-03 可并行；T-10 与 T-11 可在导航接口确定后
  并行。T-05、T-07..T-09、T-12 的共享文件变更顺序执行。

## Risks And Rollback

| Risk | Prevention | Detection | Rollback / fallback |
| --- | --- | --- | --- |
| 删除 UI 后旧值继续禁用能力 | load/merge/save 与所有 consumer 同步，精确删除五字段 | 原始旧 blob、新旧值等价、持久化 round-trip | 修复版本修正实现；不恢复历史 opt-out 分支 |
| 后台暂停取消手动或复活旧自动任务 | 独立 automatic lane 与 epoch；后台偏好不进入全局 controller identity | pending/active、快速关开、late publish 与显式抢占测试 | 自动结果 fail closed；手动队列保持可用 |
| 规范化误改 provider/Memory 权限或治理数据 | 仅 strip 精确字段、复用 write queue 与 compatibility barrier | protected-sentinel、保存失败、并发 provider/Memory 事务 | 原事务回滚与错误提示；不全对象重置 |
| 四入口破坏草稿、精确记忆跳转或 SecretStorage | 复用既有事务、原生 details 与 pending target，只局部刷新 | 延迟保存、切 Custom、挂起确认、关闭后迟到结果 | 保留草稿/失败状态，不虚报保存成功 |
| 原控件删除导致专业功能消失 | 先交付图谱/题图入口，统计现场已有入口单独验证 | 配置→使用→重开值保持，取消零请求 | 在替代入口通过前保留原行 |
| 验证脚本偷偷依赖已撤销开关 | 将脚本适配列入 P1，保持明确的隔离 seam | tooling runner contracts 与拒绝工具调用的 fixture | 修复 checker；不恢复用户技术开关来满足旧 checker |

有效配置、源笔记、已保存对话和治理记录不作迁移备份/重建。版本级回滚不依赖
恢复已删除字段；若希望重新引入历史产品选择，应另作显式决定。

## Validation Strategy

- 本轮设计：`npm run docs:check`、`git diff --check`；没有运行时修改，不跑
  build、TypeScript、插件 Jest 或设备 smoke。
- 实施每个任务的风险→证据→通过条件→重跑触发见 Tracker，不为低影响文案新造测试。
- P1/P2 的 focused suite 见 SDD Test Matrix；source 用 `npm test`，runner/script
  contracts 用 `npm run test:tooling`。不把 source 组排除的 suite 当作已运行。
- Local Validation Gate 使用根 AGENTS 定义；DOM community scan 单独保留。
  `make deploy` 已含 lint、production build（含 typecheck）与 full Jest，不重复执行。
  所有 build-bound receipt 都须在当前 build 后执行，不能先跑 artifact suite。
- 阶段 App smoke 只用隔离 `test/` vault 与合成材料；需要调用 AI 才能证明的路径
  使用既有模型和最少结论性案例。保存/迁移零调用与正常自动触发分开取证。
- 最终 iOS 只覆盖本次 Settings、显式 token 与持久化/触控边界；不重跑 B-125
  性能矩阵、模型矩阵、无关图片格式认证。Desktop 窄屏不能代替 real-iOS。
- iCloud 部署仅在实施阶段适用设备 scope 下进行；当前产物与必要检查通过后可
  使用 `make deploy-icloud-current`。设备不可用如实记录，保持相应验收未完成。
- 不自动跑 Hosted Community 或发布 gate；它们属于后续 release 范围。

## Approval

- Plan authority: DEC-033 与 Owner 2026-09-08“按照项目的开发规范（sdd）设计开发任务”。
- Approved on: 产品范围已明确；本文件为本轮形成的设计稿，不冒充 Owner 对技术稿逐项批准。
- Authorized implementation scope: 本轮仅文档设计与任务编排；未执行 runtime、部署或 Git 操作。

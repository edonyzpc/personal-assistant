# B-164 Memory marker 恢复最终验证

Document status: Archived
Recorded: 2026-10-08
Work item: B-164

本页保留最终验收、真实本地存储场景及证据限制，不作为当前实现或执行状态权威。
稳定范围见 [DEC-054](../../product/decisions/dec-054-memory-marker-recovery.md)、
[Product Spec](../../product/specs/pa-memory-marker-recovery-product-spec.md)；实际机制见
[SQLite/WASM](../../architecture/vss-sqlite-wasm-architecture.md)、
[Refresh](../../architecture/vss-embedding-refresh.md) 和
[Local State](../../architecture/vss-local-state-plan.md)。

Owner 已授权开发测试、必要隔离本地部署，并在验收后明确授权 B-164 closeout 与本地
master 提交；本记录不证明远程推送、发布或真实用户 vault 部署。

## 最终验收

T-00 至 T-03、四组 REQ/AC 和独立审查全部完成，无未完成开发测试项。
运行变更仅涉及 [VSSCore](../../../src/vss/vss-core.ts) 与
[VSS 回归](../../../__tests__/vss.test.ts)；MemoryManager、设备 ID 生成、数据库
命名与格式保持现有职责。

| AC | 已接受证据 |
| --- | --- |
| B-164/AC-01 | 同 scope marker 仅设备 ID 不同仍 ready；原 indexId/builtAt 保留，reset 与文档 embedding 调用为 0。直接 VSS 回归证明，不声称 anthelion 原事件已确定由设备 ID 引起 |
| B-164/AC-02 | 缺 marker 的正常 readiness 恢复兼容非空 SQLite；dirty 保留，由 Update/hash 跳过未变文件。真实应用删除合成 marker 后重载并从正常入口恢复，随后只更新修改的笔记，见下节 |
| B-164/AC-03 | 连续 hydrate/read/open/save 失败及后续成功的确定性回归通过；保存期间 cached status 非 ready，失败不误入 first-use，也不进入普通 pending 发布或新置构建抑制。现有 index 可在后续入口复用 |
| B-164/AC-04 | 真正首次准备、不兼容 profile、scope、guard/构建抑制、policy、关闭/卸载和并发打开边界均通过直接或既有回归；没有新增维护授权 |

独立审查闭合 D-01（重试抹掉未知状态）、D-02（恢复保存失败抑制后续恢复）、
D-03（持久化前暴露 ready）。R1 的实际反例是开库/stats 等待期间配置变化后残留
uninitialized/initializing，可能误判 first-use 或阻止重试；实现以当前 generation 的
unavailable 接续处理，opening/stats 参数化回归通过，reviewer 定向回读确认。
正常设置 UI 另有 lifecycle 取消，不能把这个 VSS 反例等同于该 Chat 必然付费。

## 检查与复用

基线为本地 master `4e57a31d`，以下结果对应本次最终未提交源码/测试输入。

| 检查 | 原始结果与范围 |
| --- | --- |
| 实现前目标回归 | 12 failed / 202 passed，exit 1；证明目标路径的失败，不以整套 PASS 冒充 RED |
| 最终 focused | `npm test -- --runInBand --runTestsByPath __tests__/vss.test.ts __tests__/memory-manager.test.ts`：2 suites / 219 tests PASS，7.335s，自然 exit 0；包含 R1 修正，取代前一输入的 217 tests 结果 |
| 统一 gate / test 部署 | `make deploy`：平台 guards、lint、production build（含 TypeScript）、full Jest 380 suites / 9138 tests PASS，Jest 764.152s，整体自然 exit 0；部署当前资产。既有 state-store、MemoryManager 与 docs contract suites 包含在 full gate 中 |
| 文档契约 | `npm run test:docs -- --runInBand`：2 suites / 57 tests PASS，自然 exit 0；最终 full gate 亦包含对应 suites。收尾未改 checker/skills/tests，复用该证据 |
| 文档与源码约束 | 实施验收 `npm run docs:check` PASS（271 Markdown / 3540 local links）；`git diff --check` PASS；AGENTS DOM 源码扫描无匹配，exit 1 |
| 文档收尾 | `npm run docs:check` PASS（269 Markdown / 3534 local links），自然 exit 0；`git diff --check` PASS。首次检查识别到删除文件后遗留的空 active 目录，删除该空目录后通过；不改 checker 或接受标准 |

收尾只调整文档并删除已吸收过程包；重新检查当前文档与 whitespace，不重复同一
源码/测试输入的 full gate、构建或应用验收。绑定的 SHA-256 为：

- VSSCore：`b9e9d76a0d6b3a8ec005a097c4467885105162f43a2c56d93aa024ae922c42a3`
- VSS 回归：`5b53d5569a862ddde7448ad2d29c53ab5d5b2a11adfd59a71671df968a1ce597`

GLM 认证预检明确周/月限额后自然退出，未使用工具或修改源码；按 Owner 预授权由
GPT writer 实施，另一个 GPT reviewer 独立审查，root 独立验收。实际执行者不称作 GLM。
首次 gate 的 lint 因已声明依赖缺失失败，完整安装既有 lockfile 后通过；package/lock
未改，不算产品失败或另一次完整测试。

## 真实存储应用证据

使用 Obsidian 1.14.4 的独立 profile、进程/socket、窗口及合成 vault
`test/.b164-smoke/test`。实际 vault 与 userData 路径已核对，测试进程的共享 profile
文件数为 0；只使用两条合成笔记，不继承既有 test 设置或凭据，不操作日常 anthelion。
生产资产经部署脚本核对身份后复用；SQLite/IndexedDB 为真实 backend，文档 embeddings
替换为固定 1024 维测试向量，没有真实 AI 请求或费用/模型质量评估。

Seed 得到 2 notes / 2 chunks，去掉 marker 并 reload 后 IndexedDB DB 身份不变。
正常 `MemoryManager.ensureReadyForChat` 与后续 `prepareMemory(refresh)` 的实测结果为：

| 场景 | 观察 |
| --- | --- |
| marker 恢复 | use-memory / ready；backend sqlite-wasm-opfs-sahpool；2 chunks；marker 已持久保存；reset 0、rebuild 0、文档 embedding 0；policy 不变 |
| 修改一条笔记后 Update | updated 1、unchanged 1、failed 0；文档 embedding 1，仅变化文本；未变笔记 hash 保留；reset 0、rebuild 0 |
| 当次错误 | fresh errors 为空 |

测试实例自然退出，独立 socket 消失，日常进程/socket/anthelion 窗口保留；方法替身在
finally 恢复。自有 profile/runtime、合成 vault、脚本和安装 cache 已清理。当前项目
依赖与 test plugin 保留。原始日志位于本机 `/tmp/pa-b164-*.log`，4 份应用 JSON 位于
`/tmp/pa-b164-app/`；这些是临时位置，不保证跨设备或长期保留，本页已吸收最终事实。

失败分支由确定性测试覆盖；没有新增 UI/原生平台 API，不另设移动真机、模型语义、
成本基准、CI 或 hosted community gate。此证据不证明这些范围，也不确定原 vault
事故原因或数据库完整性。

## 文档处置

稳定范围、工程责任、持久化/生命周期机制与回滚已吸收至当前 Decision/Spec/三份
Memory 架构和直接回归。Feature Home/SDD/Tracker 按 delete-after-absorption 删除，
Active Registry 入口移除；[Disposition Log](../disposition-log.md)承接稳定身份连续性。
只保留本紧凑验收记录，不归档完整包。过程包本轮未提交，不声称已有 Git 历史保存了
它的完整内容；无未完成项需要转入 Backlog。

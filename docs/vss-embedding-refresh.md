# VSS Embedding 刷新方案说明

## 目标
在保证向量搜索结果新鲜度的前提下，显著降低频繁编辑时的 embedding 计算与 Token 消耗，提升异常退出后的恢复能力，并约束启动期的性能影响。

## 关键机制
- **事件改造**：`vault.modify` 仅标记脏文件，不再立即计算。`active-leaf-change` / `file-open` / 定时器触发延后刷新。
- **静默窗口 + 最长延迟**：`quietWindow=30s` 后才刷新；超过 `maxDelay=10min` 强制刷新。
- **速率限制**：处理间隔 `rateGap=3s`，每分钟最多 `maxPerMinute=5`。
- **启动期安全阈值**：冷启动最多处理 `startupMaxFiles=120` 个文件，超出留给后续定时器。
- **内容哈希去重**：缓存写入 `contentHash`（cleaned markdown 的 SHA1），hash 相同直接跳过重算，mtime 仅兜底。
- **脏队列持久化**：`vss-cache/dirty.json` 实时落盘；异常退出后可恢复。
- **兜底扫描**：启动后延迟扫描缓存缺失或 hash 不匹配的文件并加入脏队列（受限于 `startupMaxFiles`）。>1MB 文件启动期不算 hash，延后处理。
- **删除与内存同步**：删除文件时清理缓存文件并从内存 vector store 移除。
- **手动控制**：新增命令 `Flush VSS Embeddings` 立即处理当前脏队列（仍遵守速率限制）。

## 参数（默认值，可扩展为设置项）
| 参数 | 默认 | 说明 |
| --- | --- | --- |
| quietWindow | 30s | 最小静默时间 |
| maxDelay | 10min | 最长延迟后强制刷新 |
| flushInterval | 2min | 定时刷新的周期 |
| rateGap | 3s | 单个文件刷新间隔 |
| maxPerMinute | 5 | 每分钟处理上限 |
| startupMaxFiles | 120 | 启动期最多处理文件数 |
| largeFileThreshold | 1MB | 启动期哈希跳过阈值 |

## 触发流程
1. **标记脏**：`vault.modify` → 写入 `dirty.json`。
2. **刷新的触发**：定时器、文件切换/打开、手动命令，或到达 `maxDelay`。
3. **筛选候选**：满足静默/超时条件，按上限挑选。
4. **去重判断**：读取缓存 hash，对比最新 hash，必要时重算 embedding。
5. **写回与加载**：重算成功后写缓存（含 hash），刷新内存 vector store，清除脏标记。

## 启动阶段的性能权衡
- 先恢复 `dirty.json`，小批次处理；全量兜底扫描延后执行。
- 启动前 1 分钟处理文件数上限 120；大文件跳过哈希，延后再算。
- 批处理间隙让出事件循环，并受速率限制。

## 开发任务列表
1) 引入内容 hash 与脏队列工具（helper）。  
2) 改造 AIUtils / vectorizeDocument，写入并检查 `contentHash`。  
3) 扩展 VSS：脏队列持久化、刷新调度、速率限制、启动恢复与兜底扫描、删除处理。  
4) 插件层接管事件（modify/delete/leaf-change/file-open），增加手动刷新命令。  
5) 移除旧的视图内更新逻辑，避免重复监听。  
6) 新增/更新文档（本文件）。  
7) 添加单元测试覆盖核心策略（哈希去重、候选筛选、脏记录合并等）。  
8) 运行测试，验证无回归。

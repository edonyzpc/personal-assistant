# B-129 P0 资源校准结论

P0 工程默认值已收口。这里记录所测 Desktop/iPhone 的独立原型证据，不代表生产集成完成或所有设备均安全。

| 参数 | 最终默认值 |
| --- | --- |
| 原文件字节上限 | 20 MiB |
| 单图解码像素上限 | 48 MP |
| 每轮图数 | 8，串行处理 |
| 单副本 / 请求图片合计 | 4 MiB / 24 MiB |
| 处理超时 | 15 s |
| 本地副本缓存 | 64 MiB，LRU + lease |
| 预览 / provider 长边 | 1536 / 3200 |
| JPEG 初始质量 | 0.9 |

3200 替代早期 2048 候选，用于保住已测小字图细节。源图超过 3200 且含极小文字，仍可能失去可读性；不承诺任意截图均可识别。HEIC 正式笔记 JPEG 不直接复用 provider 缩略副本。

| 最终确认：48 MP → 3200/.9 | Desktop | iPhone |
| --- | --- | --- |
| 单图 | 955,786 B；511 ms | 1,769,870 B；162 ms |
| 8 图串行 | 7,646,288 B；2335 ms | 14,158,960 B；789 ms |
| 活跃 Image / Canvas / URL | 每种最多 1，结束全 0 | 每种最多 1，结束全 0 |
| 原图 SHA-256 | 不变 | 不变 |

4 MiB 与 24 MiB 根据实际 Blob 字节检查，不能因图数未满便假定一定可发送。8 图使用同一份合成 48 MP 图片，证明几何尺寸、串行占用和输出预算；不等同八份不同高熵照片或大 HEIC 的全部行为。

64/128/256 MiB 均经过真实 IDB Blob 写入、cursor/count、总字节、写前/重开后 hash、LRU、lease、清缓存和数据库删除验证。64 MiB 是最小已测容量，因此作为默认值。没有主动耗尽浏览器 quota；注入 QuotaExceeded 与实际容量实验分开。

## iPhone 真实内存及背景清理

第二段时间线关闭 Screenshots 仪器，包含 394 个 Memory 样本，典型间隔约 0.5 s。它记录所检查 WebContent 的内存分类，不是全设备精确峰值。162 ms 单图 case 没有恰好落入的 Memory 样本；8 图 case 有样本。

运行前基线中位数 **757.43 MB**；运行中实采最大 **962.68 MB**，约高 **205.24 MB**。最后一次已观察到的 full GC 后中位数 **825.40 MB**，仍比本次基线高约 **67.96 MB**。末尾 JavaScript 分类约 98.86 MB、Page 526.17 MB、Other 194.89 MB。不能宣称全部物理内存已返还，也不能仅据此判定泄漏；WebKit 的 JavaScript 分类包括已分配 GC 块容量及附加/外部内存，原型全局未主动保留 Blob/ArrayBuffer/base64 列表。

**保留真实 critical 事件**：约 08:31:18.006Z，位于资源运行结束约 67.09 s 后、visibilitychange 后约 0.320 s。操作日志显示此时从 Obsidian 切换到 Files；没有人为模拟内存压力。WebKit 的 `prepareToSuspend` 会主动执行 `Critical::Yes` 清理，并通过同一 Inspector 事件报告严重度。因此它与后台主动清理路径一致，不能直接当成 48 MP 引发系统低内存/OOM；事件没有携带原因，后台归因仍是结合时序与源码的推断。

前一段混合仪器矩阵的最大 828.20 MB 和未回到 374 MB 初始基线的事实保留作历史证据；不能拿两段不同宿主状态互相作增量基准，也不能把增长全部归给 Screenshots。最终工程参数依赖双端实际完成、预算拒绝、串行所有权释放和真实内存观测。后续生产集成仍需维持这些限制并验证长期运行/后台恢复。

## 证据

- [综合数值与最终参数](./resource-host-analysis.json)
- [最终 iPhone 回执](./ios-final-resources-01.json)、[最终 Desktop 回执](./desktop-final-resources-01.json)
- [最终 iPhone 脱敏内存时间线](./ios-final-timeline-numeric.json)
- [修正后 Desktop 缓存/迟到回调](./desktop-resources-02.json)、[iPhone 完整资源阶梯](./ios-resources-01.json)

后台清理语义依据当前官方 [WebProcess](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/WebProcess/WebProcess.cpp)、[MemoryRelease](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/MemoryRelease.cpp) 与 [InspectorMemoryAgent](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/inspector/agents/InspectorMemoryAgent.cpp)。这解释可达路径，未记录安装中 iOS 二进制的具体调用来源。原始时间线留在本机 `/tmp`，脱敏证据不含截图、目录列表或网络内容。

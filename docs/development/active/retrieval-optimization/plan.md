# Retrieval Pipeline Optimization — Delivery Plan

Document status: Approved
Updated: 2026-08-07
Authority: 本 track 的交付顺序、依赖、风险、验证策略与 stop point。
SDD: [Software Design Document](./sdd.md)
Tracker: [Development Tracker](./tracker.md)

## Goal And Non-goals

### Goals

1. 修复 reranker 的 correctness bug（空 ranking 回退返回全量 candidates）
2. 引入三级 verdict 信号，让 agent 和下游逻辑知道检索结果的质量
3. 利用 Obsidian vault 已有的 wikilink 图谱，通过 PPR 算法发现 2-3 跳的结构性相关笔记
4. 当首次检索失败时，引导 agent 以放宽参数重试一次

### Non-goals

- 不做全局社区检测（Louvain/Leiden/Label Propagation）
- 不做 Adaptive 路由分级（Phase 4 已砍掉）
- 不暴露用户可见的 Settings（只有内部 flag）
- 不做 Mobile 平台降级
- 不修改 RequiredCapabilityPolicy 的整体架构（只扩展 follow-up 条件）
- 不引入新的 LLM 调用（Phase 1 合并到 reranker，Phase 2 无 LLM，Phase 3 复用已有 agent loop）

## Dependencies And Source Surface

### 文件依赖（已用 rg 验证）

| 模块 | 路径 | 改动类型 |
|------|------|---------|
| Memory search tool | `src/ai-services/memory-search-tool.ts` | 修改（Phase 1/2/3） |
| Chat types | `src/ai-services/chat-types.ts` | 修改（Phase 1） |
| Host tools | `src/ai-services/pa-agent-host-tools.ts` | 修改（Phase 1/3） |
| Agent prompts | `src/ai-services/pa-agent-prompts.ts` | 修改（Phase 3） |
| Required capability policy | `src/ai-services/pa-agent-required-capability-policy.ts` | 修改（Phase 3） |
| AI service host interface | `src/ai-services/AiServiceHost.ts` | 修改（Phase 2） |
| VSS core | `src/vss/vss-core.ts` | 修改（Phase 2，暴露 cosine 查询） |
| Plugin host impl | `src/plugin.ts` | 修改（Phase 2，实现 computeQueryCosineSimilarity） |
| Settings | `src/settings.ts` | 修改（Phase 1/2/3，添加 feature flags） |
| PPR algorithm | `src/graph/personalized-pagerank.ts` | **新建**（Phase 2） |
| PPR expansion | `src/graph/ppr-expansion.ts` | **新建**（Phase 2） |

### 外部依赖

无新增外部依赖。所有实现使用现有技术栈（TypeScript, LangChain, SQLite/WASM）。

### 测试文件

| 测试 | 路径 | Phase |
|------|------|-------|
| Rerank parsing | `__tests__/memory-search-rerank.test.ts` | 新建 (Phase 1) |
| PPR algorithm | `__tests__/personalized-pagerank.test.ts` | 新建 (Phase 2) |
| PPR expansion | `__tests__/ppr-expansion.test.ts` | 新建 (Phase 2) |
| Retry mechanism | `__tests__/memory-search-retry.test.ts` | 新建 (Phase 3) |
| 现有回归 | `__tests__/memory-manager.test.ts` 等 | 必须通过 |

## Phases

| Phase | Outcome | Scope | Exit gate | Stop point |
|-------|---------|-------|-----------|------------|
| **Phase 1: Self-RAG 反思** | Reranker 输出三级 verdict；bug fix；filteredCandidatePaths 暴露 | `memory-search-tool.ts`, `chat-types.ts`, `pa-agent-host-tools.ts`, `settings.ts` | 单元测试通过 + `make deploy` 通过 + 现有 memory 测试不回归 | 如果 policy model 无法稳定输出 verdict JSON → 降级为二级（去掉 partially_relevant） |
| **Phase 2: PPR 图扩展** | PPR 替代 one-hop；自适应参数；向量交叉验证 | 新建 `src/graph/` 目录 + 修改 `memory-search-tool.ts`, `AiServiceHost.ts`, `vss-core.ts`, `plugin.ts`, `settings.ts` | 单元测试通过 + PPR 性能 <50ms (5000节点图) + `make deploy` 通过 | 如果 `computeQueryCosineSimilarity` 无法复用已有 embedding → 先交付不带向量验证的纯 PPR 版本 |
| **Phase 3: 单次重试** | none_relevant 时引导 agent 重试；放宽参数；query 去重 | `memory-search-tool.ts`, `pa-agent-host-tools.ts`, `pa-agent-prompts.ts`, `pa-agent-required-capability-policy.ts`, `settings.ts` | 单元测试通过 + 集成测试（首次 miss → 重试 hit）+ `make deploy` 通过 | 如果 agent 频繁重试相同 query（去重失效）→ 关闭 `memoryRetryOnMiss` flag |

### Phase 间依赖

```
Phase 1 ──→ Phase 2（Phase 2 的 PPR 扩展候选需要经过 Phase 1 的 reranker verdict 过滤）
Phase 1 ──→ Phase 3（Phase 3 依赖 verdict 信号触发重试）
Phase 2 ─ ─ → Phase 3（soft dependency: Phase 3 的 PPR cosineThreshold 放宽只有 Phase 2 存在时才有意义；
                        但 Phase 3 的 k/fusionTopK 放宽 + retry 逻辑独立于 Phase 2 可以单独工作）
```

**推荐交付顺序：Phase 1 → Phase 2 → Phase 3**

- Phase 1 是后续两个 Phase 的硬前置条件。
- Phase 2 和 Phase 3 的硬依赖关系：Phase 2 中实施 `searchHybrid` 的 `k`/`fusionTopK` 接口扩展（task 2.10），Phase 3 依赖这个接口来传递放宽的 k=12/fusionTopK=18。
- Phase 3 的 PPR cosineThreshold 放宽是 soft dependency：当 PPR 禁用（one-hop fallback）时，该参数无效果，Phase 3 其他功能仍然工作。
- 建议串行以减少合并冲突（两者都改 `memory-search-tool.ts`）。

## Risks And Rollback

| Risk | Prevention | Detection | Rollback / fallback |
|------|-----------|-----------|---------------------|
| Policy model 无法稳定输出 verdict JSON | Prompt 中明确 JSON 格式；`parseVerdict` 对未知值 fallback 到 "relevant" | 单元测试 mock 各种 malformed output；观察 debug log 中 verdict 分布 | `memoryStrictRelevanceFilter: false` → 恢复旧 parseRerankResponse 行为 |
| PPR 在极大 vault (10000+ notes) 性能超标 | 计算量 O(E × iterations × 3 seeds)；iterations 上限 18 | 性能测试 benchmark；runtime log PPR 耗时 | `memoryPPRExpansion: false` → fallback 到 one-hop |
| PPR 扩展引入大量不相关候选，reranker 负载增加 | cosine gate (≥0.3) 和 maxExpansions (6) 限制候选数量 | 观察 reranker 输入候选数量变化；延迟 P99 | 降低 maxExpansions 或提高 cosineThreshold |
| Agent 用完全相同的 query 重试（死循环） | query 去重缓存；prompt "Do not retry more than once" | 观察同一 session 内 search_memory 调用次数 | `memoryRetryOnMiss: false` → 去掉 guidance |
| 向量交叉验证无法复用已有 query embedding | 设计要求 searchHybrid 暴露 queryEmbedding 引用 | 编译时类型检查 | 先交付不带向量验证的 PPR；后续补充 cosine gate |
| Phase 3 prompt 变更影响 agent 在其他场景的行为 | 指引语限定在 search_memory 使用范围内；不影响其他工具 | 回归测试现有 agent 行为 test suite | 移除 prompt 中新增的段落 |

## Validation Strategy

### Focused tests

- **Phase 1**: `parseRerankResponse` 单元测试覆盖所有 verdict 组合 + 空 ranking + 无 verdict 字段 + malformed JSON
- **Phase 2**: `personalizedPageRank` 单元测试覆盖 star/clique/chain/disconnected 图结构；`expandByPPR` 集成测试 mock 全流程
- **Phase 3**: retry 检测 + 参数放宽 + query 去重

### Type/lint/build gate

```bash
make deploy   # 包含 tsc + eslint + esbuild，全链路必须通过
```

### Obsidian smoke

每个 Phase 交付后，在 Obsidian 中实际运行：
1. 对 vault 中已知笔记提问 → 验证检索命中
2. 提问明显无关内容 → 验证 none_relevant 过滤生效
3. Phase 2：对 vault 中有 2-3 跳链接关系的笔记提问 → 验证 PPR 扩展找到它们
4. Phase 3：提问一个存在但首次搜不到的笔记（措辞完全不同）→ 验证 agent 重试后找到

### Real-device / community / release gate

- Dogfooding 期间观察 debug log 中 verdict 分布、PPR 耗时、retry 触发率
- 稳定后移除 feature flag 默认值的显式设置（让 default true 生效）
- 随下一个常规版本发布

## Implementation Notes For Codex

### 文档更新

Phase 2 完成后需要更新 `docs/architecture/vss-sqlite-wasm-architecture.md`：
- 新增 `lastQueryEmbedding` transient field 的说明
- 新增 `computeCosineSimilarityForPaths` 方法的说明
- 新增 `searchHybrid` options 中 `k`/`fusionTopK` 可选参数的说明

### 编码约定

- 遵循 `AGENTS.md` 中的所有开发规范
- commit 使用 Conventional Commits 格式
- 不添加 Co-Authored-By trailer
- 必须 `git commit -s` 签名
- 验证用 `make deploy` 而非 `npm test`

### 交付粒度

- 每个 Phase 至少一个独立 commit（可以多个，按模块拆分）
- Phase 内的 commit 顺序：types/interfaces → algorithm → integration → tests
- 每个 commit 必须通过 `make deploy`

### 不要做的事

参见 SDD 末尾的 "Constraints For Implementation (Codex)" 段落（8 条硬约束）。

---

## Approval

- Plan authority: edonyzpc
- Approved on: 2026-08-07
- Authorized implementation scope: Phase 1 → Phase 2 → Phase 3 串行交付

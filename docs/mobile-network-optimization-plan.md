# Obsidian 插件移动端网络兼容优化方案

> **Status (2026-05-25)**: Historical — Ollama support was removed in v2.0.0. References below to Ollama as a supported provider are no longer accurate; see [`CHANGELOG.md`](../CHANGELOG.md) for the v2.0.0 break-change release notes.
## Summary

- 目标：移除 `node-fetch`、`ChatAlibabaTongyi`、`@langchain/community` 以及全局 `fetch` monkey patch，让 AI 网络调用兼容 Obsidian Desktop 和 Mobile。
- 网络策略：保留 LangChain/OpenAI-compatible SDK 路线；为非流式请求和 Embeddings 注入基于 Obsidian `requestUrl` 的轻量 `fetch` adapter。
- 移动端策略：Mobile 默认不自动初始化 VSS 后台任务；聊天可尝试原生流式，失败时回退为非流式响应。
- 开发顺序：先网络 adapter，再服务替换，再 Mobile gating，最后构建和验证。

> VSS lifecycle note: this document records the older mobile-network compatibility plan. Current SQLite/WASM Memory behavior is documented in [VSS SQLite/WASM 架构设计](./vss-sqlite-wasm-architecture.md) and [VSS Embedding 刷新方案说明](./vss-embedding-refresh.md): first prepare/rebuild still requires user confirmation, while changed notes can be maintained automatically after successful approval when the durable SQLite/WASM backend is ready.

## Implementation Changes

- 新增浏览器安全的 `obsidianFetch` adapter：
  - 使用 `requestUrl({ throw: false })`。
  - 返回标准 `Response` / `Headers` 兼容对象。
  - 支持 JSON、文本、ArrayBuffer、headers、HTTP 非 2xx 状态。
  - 不引入 `node:*`、`Buffer`、`node-fetch`。
- AI 服务改造：
  - `ChatOpenAI` / `OpenAIEmbeddings` 使用 SDK `configuration.fetch` 注入 adapter。
  - 移除 `ChatAlibabaTongyi` legacy 路径；Qwen 继续走 OpenAI-compatible Bailian URL。
  - 删除所有 `globalThis.fetch = ...` 临时替换逻辑。
  - 图片生成、任务轮询、图片下载统一改为 `requestUrl`。
- Mobile 兼容：
  - `manifest*.json` 改为 `isDesktopOnly: false`。
  - Ollama 仅 Desktop 可用，Mobile 设置页隐藏或禁用。
  - Mobile 不自动执行首次 VSS prepare/rebuild；提供手动触发入口。首次授权后的 changed notes 自动维护以当前 SQLite/WASM VSS 文档为准。
  - 聊天 RAG 在 VSS 未初始化时静默跳过相似度检索。
- Node 依赖清理：
  - 移除 `node-fetch` 依赖。
  - 移除 `@langchain/community`，前提是仅剩 `ChatAlibabaTongyi` 使用。
  - 删除或忽略 Node 版 `src/ai-services/http-fetch.ts` scratch 实现。
  - 将 `crypto.createHash` 替换为 Web Crypto SHA-1 helper，并更新调用点。
- 构建配置：
  - esbuild 改为浏览器优先构建，保留 Obsidian CJS 输出。
  - 移除对 Node builtins 的实际依赖；构建后应无 `node:http`、`node:https`、`node:buffer`、`crypto` 引用。
- 安全与日志：
  - Debug 日志不得输出 token、headers、完整 settings、LLM 原文响应或临时图片 URL。
  - Mobile debug 写 vault 文件时必须使用同一套脱敏逻辑。

## Public Interfaces / Behavior

- Provider 行为保持：
  - `qwen` 默认继续使用 `https://dashscope.aliyuncs.com/compatible-mode/v1`。
  - 可配置任意 OpenAI-compatible model 名，例如 `qwen-*`、`glm-*`。
  - `openai` 保持当前 OpenAI-compatible 路径。
  - `ollama` Desktop 保留，Mobile 禁用。
- 聊天流式：
  - Desktop 优先保持现有流式体验。
  - Mobile 先尝试原生 fetch stream。
  - 若请求尚未产生任何 chunk 且非用户主动 abort，则自动回退非流式。
  - 若已经产生部分内容，不重试，避免重复计费或重复输出。
- VSS：
  - Desktop 和 Mobile 都不静默执行首次 prepare/rebuild。
  - 用户首次授权并成功准备 Memory 后，changed notes 可在 durable SQLite/WASM ready 时自动后台维护。
  - 聊天功能不因 VSS 不可用而失败。

## Test Plan

- 单元测试：
  - `obsidianFetch`：JSON、文本、ArrayBuffer、headers、非 2xx、abort-before-request。
  - Web Crypto SHA-1：与既有 hash 结果保持一致。
  - 流式 fallback：stream 成功、stream 预响应失败回退、partial chunk 后失败不回退、abort 不回退。
- 静态检查：
  - `rg "node-fetch|ChatAlibabaTongyi|globalThis\\.fetch =|from 'crypto'|node:http|node:https|node:buffer" src dist/main.js` 应无命中。
  - `npm run build` 通过。
  - `npm test` 通过。
- 手动验证：
  - Desktop：Qwen/OpenAI 聊天、摘要、标签、图片生成、VSS 检索均保持可用。
  - Mobile：插件可加载，Qwen/OpenAI 聊天可用，非流式 fallback 正常，Ollama 不展示或不可选。
  - 断网/401/429/5xx：错误提示明确，不泄露 token。

## Assumptions

- 不把全部 AI 能力重写为自维护 OpenAI client，继续使用 LangChain/OpenAI SDK。
- 图片生成仍使用 DashScope/Bailian 原生接口，因为它不是当前 OpenAI-compatible chat/embedding API 的同一能力面。
- Mobile 的首要目标是可用和稳定；首次 prepare/rebuild 仍保持手动确认。首次授权后的 changed notes 后台维护以 SQLite/WASM VSS 文档为准，并且 iOS resume/focus 触发仍需真实设备补测。

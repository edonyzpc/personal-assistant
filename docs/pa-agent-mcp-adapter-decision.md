# PA Agent MCP Adapter Decision

Status: Accepted for SPEC-05 implementation.

Date: 2026-05-22

## Context

PA Agent v1 adds only one builtin remote MCP-style capability first: Bailian WebSearch. The v1 boundary remains read/network-read only. User-configured MCP, local stdio MCP, local SSE bridges, shell, CLI, write actions, and arbitrary endpoints stay out of scope.

Obsidian desktop and mobile both need a browser-compatible implementation. The official MCP SDK may pull in Node-oriented transports, stream abstractions, or bundle weight that is not justified for a single builtin remote WebSearch capability.

## Decision

Use a narrow builtin HTTP adapter for Bailian WebSearch instead of adding the official MCP SDK in SPEC-05.

The builtin allowlisted endpoint is:

- `https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp`

The adapter presents an `AgentCapability` with:

- `origin: "builtin-mcp"`
- `kind: "tool"`
- `permission: "network-read"`
- `sourceBoundary: "web"`
- `failureBehavior: "recoverable"`
- `requiresConfirmation: false`
- `platform: "desktop"` for PA Agent v1. Mobile export requires separate `requestUrl`/auth/deadline smoke evidence before the capability can be changed to `platform: "both"`.

The adapter must use `CapabilityRegistry.registerProvider(...)` so provider load failures and platform gates are isolated before schema export.

## Transport Contract

- Use Obsidian-compatible HTTP (`requestUrl` or the existing fetch abstraction only when it is proven mobile-safe).
- Support only builtin allowlisted HTTPS endpoints compiled into the plugin.
- Reject non-allowlisted URLs before request construction.
- Do not support user-provided MCP endpoints in v1.
- Do not support stdio, shell, local executables, local MCP servers, SSE bridges, or dynamic tool discovery.
- Treat the remote response as buffered JSON. SPEC-05 does not require true streaming.
- Enforce a per-request deadline and maximum serialized response size before building model observations or source records.
- The narrow adapter uses the minimal Streamable HTTP JSON-RPC sequence needed for this builtin server: `initialize`, `notifications/initialized`, `tools/list`, then `tools/call`. The selected tool name is resolved from `tools/list` instead of hardcoding an unknown server-side function name.

## Auth Contract

- The auth key is selected by `AgentNetworkPolicy.authKeyId`; SPEC-05 implementation must map it to the plugin setting/secret source explicitly.
- Auth values must never appear in logs, diagnostics, model observations, `SourceRecord`, Context Used, or thrown errors.
- Secret headers and query params must be redacted before any object crosses the adapter boundary.
- Missing key returns recoverable unavailable, not a thrown chat failure.

## Redaction Contract

All request/response summaries and source fields pass through one redactor before use:

- query text
- request body
- request headers
- error messages
- source URL
- source title
- source snippet

The redactor must remove credentials, fragments, known secret query params, and auth-like header/body fields. Web source URLs must still pass `SourceStore` URL sanitization before becoming `SourceRecord.kind === "web-source"`.

## Abort Contract

Obsidian `requestUrl` does not provide a reliable hard network cancel guarantee. The adapter must expose honest abort semantics:

- Maintain `inflightRequests: Set<string>`.
- On abort, remove the request id from the set immediately.
- Ignore any later network resolution for an aborted request.
- Return or surface a recoverable cancelled/unavailable result for the turn.
- Use the user-facing message: `Web search cancelled - request was already sent to the provider`.
- Do not claim the remote request was prevented after it has been sent.
- On mobile, show status that cancel may still consume one provider request when MCP WebSearch is used.

## Interop Contract

- Provider built-in web search is not supported by PA Agent.
- Qwen `enable_search` / provider `search_options` must not be sent by PA Agent runtime.
- If MCP WebSearch is unavailable, not called for an explicit search request, or returns recoverable unavailable, the runtime records unavailable/skipped tool context or a required-capability diagnostic. It must not fall back to provider built-in search.
- Provider fallback must not create Web source citations in SPEC-05.

## Test Gates

SPEC-05 implementation must add unit coverage for:

- endpoint allowlist rejection
- missing key
- timeout
- oversized response
- call cap
- abort inflight discard
- key redaction in query/body/header/error/source URL/source title/source snippet
- URL sanitization and source bucket separation
- provider built-in search disabled
- prompt-injection wrapping for web titles/snippets

Desktop smoke is required before WebSearch MCP is considered enabled for v1. Mobile smoke is required before WebSearch MCP can be enabled on mobile in a later release.

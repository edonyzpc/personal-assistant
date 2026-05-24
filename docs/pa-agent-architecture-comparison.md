# PA Agent Architecture Comparison

## Status

This document compares the current Chat Agent runtime with a proposed PA Agent architecture that can support core tools, builtin MCP tools, and skills.

The current diagram describes existing implementation boundaries. The proposed diagram is a design target and is not implemented yet.

The implementation contract now lives in [PA Agent Architecture Plan](./pa-agent-architecture-plan.md), with execution tracked in [PA Agent Development Tracker](./pa-agent-development-tracker.md). If this comparison document conflicts with the plan, the plan wins.

## Current Chat Agent Architecture

```mermaid
flowchart TD
  User["User prompt"]
  ChatView["Chat UI<br/>src/chat-view.ts"]
  ChatService["ChatService.streamLLM(...)<br/>src/ai-services/chat-service.ts"]
  Runtime["ChatAgentRuntime<br/>per-turn runtime"]
  Deadline["TurnExecutionDeadline<br/>abort + wall clock cap"]
  Events["AgentEventEmitter<br/>status/chunk/metadata"]
  Planner["ChatPlanner / LLM<br/>native bindTools when supported"]
  Memory["MemoryManager + VSS<br/>Memory search and expansion"]
  Registry["ToolRegistry<br/>single executable tool boundary"]
  CoreTools["Registered read-only tools<br/>Memory, current note, metadata,<br/>recent notes, outline, Obsidian structure"]
  PromptBuilder["PromptBuilder<br/>separate Memory, tool context,<br/>current note, web sources"]
  WebSearchSetting["Builtin WebSearch tool setting"]
  FinalAnswer["Final streamed answer<br/>cumulative chunks"]
  ContextUsed["Context used UI details"]
  MemoryRefs["Memory references only"]

  User --> ChatView --> ChatService --> Runtime
  ChatService --> WebSearchSetting
  Runtime --> Deadline
  Runtime --> Events
  Runtime --> Memory
  Runtime --> Registry
  Registry --> CoreTools
  Registry -->|"exportProviderSchemas()"| Planner
  Planner -->|"tool calls"| Registry
  Registry -->|"bounded observations"| Runtime
  Memory -->|"selected Memory context"| Runtime
  Runtime --> PromptBuilder
  ProviderWeb -. "status/options only; no normalized sources today" .-> PromptBuilder
  PromptBuilder --> FinalAnswer
  FinalAnswer --> ChatView
  PromptBuilder --> ContextUsed
  PromptBuilder --> MemoryRefs
  ContextUsed -. "tool/current-note/web context" .-> ChatView
  MemoryRefs -. "selected Memory sources only" .-> ChatView
```

### Current Tool Call Flow

```mermaid
sequenceDiagram
  actor User
  participant UI as Chat UI
  participant Service as ChatService
  participant Runtime as ChatAgentRuntime
  participant Registry as ToolRegistry
  participant LLM as Native-tool LLM
  participant Tool as Read-only tool

  User->>UI: ask a question
  UI->>Service: streamLLM(prompt, history, options)
  Service->>Runtime: streamTurn(...)
  Runtime->>Registry: exportProviderSchemasSafe()
  Registry-->>Runtime: provider schemas
  Runtime->>LLM: model call with bound tools

  alt model answers directly
    LLM-->>Runtime: answer chunks
    Runtime-->>UI: cumulative answer snapshots
  else model emits tool calls
    LLM-->>Runtime: tool call name + arguments
    Runtime->>Registry: execute(name, input, context)
    Registry->>Tool: validate + run + budget output
    Tool-->>Registry: observation
    Registry-->>Runtime: bounded tool result
    Runtime->>LLM: continue with observations
    LLM-->>Runtime: final answer chunks
    Runtime-->>UI: cumulative answer snapshots
  end
```

## Proposed PA Agent Architecture

```mermaid
flowchart TD
  User["User prompt"]
  ChatView["Chat UI"]
  ChatService["ChatService / PA entrypoint<br/>compatible public API"]
  PaRuntime["PaAgentRuntime<br/>turn orchestration"]
  Policy["PolicyEngine<br/>permission, budget, source boundary"]
  CapRegistry["CapabilityRegistry<br/>unified tool/capability catalog"]
  ToolLoop["Answer-stream tool loop<br/>model streams answer or tool calls"]
  ContextBuilder["ContextBuilder<br/>Memory + tool + web + skill context"]
  AnswerStreamer["FinalAnswerStreamer<br/>streaming, no-replay fallback"]

  CoreProvider["CoreToolProvider<br/>existing ToolRegistry tools"]
  BuiltinMcpProvider["BuiltinMcpProvider<br/>fixed MCP clients, no user config"]
  WebSearchMcp["Bailian WebSearch MCP<br/>network read tool + sources"]
  SkillProvider["SkillContextProvider<br/>discover/load skill packs"]
  SkillRuntime["Skill context runtime<br/>instructions and resources only"]
  Memory["MemoryManager + VSS"]

  ToolResultStore["ObservationStore<br/>bounded results + source records"]
  Sources["SourceAttribution<br/>Memory refs + web/tool/skill context"]
  Answer["Final streamed answer"]

  User --> ChatView --> ChatService --> PaRuntime
  PaRuntime --> Policy
  PaRuntime --> CapRegistry
  PaRuntime --> ToolLoop
  PaRuntime --> ContextBuilder
  PaRuntime --> AnswerStreamer

  CapRegistry --> CoreProvider
  CapRegistry --> BuiltinMcpProvider
  CoreProvider --> Memory
  BuiltinMcpProvider --> WebSearchMcp
  SkillProvider --> SkillRuntime

  Policy -->|"filter allowed capabilities"| CapRegistry
  CapRegistry -->|"schemas + metadata"| ToolLoop
  ToolLoop -->|"tool calls"| CapRegistry
  CapRegistry -->|"execute through provider adapter"| ToolResultStore
  ToolResultStore --> ContextBuilder
  Memory --> ContextBuilder
  ProviderSearch -. "optional legacy provider feature" .-> ContextBuilder
  ContextBuilder --> Sources
  ContextBuilder --> AnswerStreamer
  Sources --> AnswerStreamer
  AnswerStreamer --> Answer --> ChatView
```

### Proposed Capability Model

```mermaid
classDiagram
  class AgentCapability {
    +name
    +description
    +inputSchema
    +kind tool|context|action
    +origin core|builtin-mcp|skill
    +permission read-only|network-read
    +sourceBoundary memory|current-note|read-only-tool|vault|web|skill-context
    +cost free|ai-calls|network-calls
    +platform desktop|mobile|both
    +timeoutMs
    +outputBudgetChars
    +execute(input, context)
  }

  class CoreToolProvider {
    +loadCapabilities()
    +execute()
  }

  class BuiltinMcpProvider {
    +connectBuiltinServers()
    +loadCapabilities()
    +execute()
  }

  class SkillContextProvider {
    +discoverSkills()
    +loadSkill()
    +loadContext()
  }

  class PolicyEngine {
    +filterCapabilities()
    +authorizeExecution()
    +enforceBudgets()
  }

  class CapabilityRegistry {
    +registerProvider()
    +listCapabilities()
    +exportProviderSchemas()
    +execute()
  }

  AgentCapability <|.. CoreToolProvider
  AgentCapability <|.. BuiltinMcpProvider
  CapabilityRegistry --> PolicyEngine
  CapabilityRegistry --> CoreToolProvider
  CapabilityRegistry --> BuiltinMcpProvider
  SkillContextProvider --> PolicyEngine
```

## Key Differences

| Area | Current Chat Agent | Proposed PA Agent |
| --- | --- | --- |
| Main boundary | `ChatAgentRuntime` plus `ToolRegistry` | `PaAgentRuntime` plus `CapabilityRegistry` and providers |
| Tools | Built-in read-only tools registered directly in runtime constructor | Core tools become one provider; MCP adds tool capabilities; skills add context capabilities only |
| MCP | Not supported as a runtime capability source | Builtin MCP clients, fixed allowlist, no user-configured servers initially |
| Web search | Builtin WebSearch tool only after provider-search cleanup | Builtin WebSearch MCP only for PA Agent; provider built-in search is not supported |
| Skills | Only archived design notes; not a runtime primitive | Skill discovery, selection, and bounded context resources become first-class; skills are context capabilities in v1, not executable tools or exported tool schemas |
| Policy | Mostly embedded in tool definitions and registry checks | Central policy layer filters capabilities and enforces permission, budget, and source boundaries |
| Attribution | Memory references are strict; tool/current-note/web status goes to Context Used | Memory references stay strict; Web sources are a separate citation bucket; tool/current-note/skill context goes to Context Used |
| Migration risk | Stable existing Ralpha loop | Medium if done provider-by-provider; high if combined with full agent framework migration |

## Desktop And Mobile Compatibility

The core PA Agent architecture can support both desktop and mobile if capability providers are platform-aware. The compatibility risk is not the `PaAgentRuntime` shape itself. The risk sits in MCP transports, skill execution, Node/Electron dependencies, network APIs, bundle size, and source attribution.

| Layer or provider | Desktop | Mobile | Design note |
| --- | --- | --- | --- |
| `PaAgentRuntime` orchestration | Supported | Supported | Keep it browser-compatible TypeScript with no top-level Node/Electron imports. |
| `CapabilityRegistry` and `PolicyEngine` | Supported | Supported | Pure runtime catalog, schema export, filtering, and budget logic should be platform-neutral. |
| Existing core read-only tools | Supported | Supported | Continue using Obsidian App/Vault/MetadataCache APIs instead of Node filesystem APIs. |
| Memory and VSS | Supported today | Depends on current durable/fallback behavior | Do not add mobile-only blocking rebuild paths or new Node/OPFS assumptions without separate verification. |
| Remote builtin MCP over Streamable HTTP | Supported | Likely supportable | Use Obsidian `requestUrl` or a mobile-safe transport adapter. Avoid SDK code paths that require Node globals. |
| Local stdio MCP servers | Supported only with strict desktop gates | Not supported | stdio requires launching a subprocess, which is not available on mobile. |
| User-configured MCP servers | Deferred | Deferred | This remains higher risk on both platforms because it adds arbitrary network endpoints, auth, trust, and schema bloat. |
| Bailian WebSearch MCP | Supported if network/auth works | Likely supportable if CORS/mobile request behavior works | Treat as a builtin remote MCP. Store API key with existing plugin settings rules and disclose network use. |
| Provider built-in search | Legacy-only historical behavior | Not supported | All PA Agent web search goes through the builtin WebSearch tool. |
| Skill metadata and instruction packs | Supported | Supported | Loading `SKILL.md`-style metadata/resources from the vault or plugin bundle can be cross-platform. |
| Skill resource reads | Supported | Supported | Use vault-relative paths and Obsidian Vault APIs; keep output bounded. |
| Skill script execution | Desktop-only at best, high risk | Not supported for v1 | Defer or require a separate sandbox design. Do not execute arbitrary local scripts on mobile. |
| CLI / shell / external executables | Desktop-only deferred | Not supported | Keep separate from PA core and require explicit desktop-only gates. |

### Cross-Platform Rules For The New Core

- No Node, Electron, `fs`, `path`, `child_process`, shell, or stdio imports at top level.
- Platform-specific modules must be loaded lazily behind `Platform.isDesktopApp` or equivalent checks.
- Remote MCP should use an HTTP transport that works in Obsidian mobile. If the official SDK pulls in Node-only code, write a narrow browser-safe MCP client adapter for the builtin WebSearch server first.
- Do not make MCP connection failure fatal to chat. A provider should degrade to "capability unavailable" and let the agent answer from other context.
- Keep local stdio MCP, CLI, and script execution out of mobile. They should not be registered in `CapabilityRegistry` on mobile.
- Skill v1 should mean metadata, instructions, resources, and tool guidance. Script execution should be a later desktop-only or sandboxed phase.
- Every capability must declare platform support, permission, cost, source boundary, timeout, and output budget before it can be exported to the model.

## Suggested Migration Shape

```mermaid
flowchart LR
  P0["P0: formalize PA architecture contract"]
  P1["P1: CapabilityRegistry + CoreToolProvider"]
  P2["P2: tool-calling stream protocol"]
  P3["P3: answer-stream tool loop"]
  P4["P4: source model and Context Used"]
  P5["P5: BuiltinMcpProvider<br/>Bailian WebSearch MCP only"]
  P6["P6: SkillContextProvider<br/>metadata + resources"]
  P7["P7: platform closeout and future action planning"]

  P0 --> P1 --> P2 --> P3 --> P4 --> P5 --> P6 --> P7
```

The PA Agent target is the answer-stream tool loop described in the architecture plan. Existing tools should migrate unchanged through CoreToolProvider, then builtin MCP and skill context providers can be added behind the same capability policy boundary.

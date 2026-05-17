# Obsidian Copilot Comparison And Improvement Notes

## Snapshot

This comparison is based on:

- `logancyang/obsidian-copilot` cloned at `ba378e8`, `release: v3.3.2 (#2473)`, on 2026-05-17.
- `personal-assistant` local checkout at `64ecd5e`, `fix(memory): polish diagnostic status notice`, on 2026-05-17.
- Public project signals checked on 2026-05-17:
  - Copilot GitHub/README: <https://github.com/logancyang/obsidian-copilot>
  - Copilot product site: <https://www.obsidiancopilot.com/en>
  - Copilot Obsidian Stats: <https://www.obsidianstats.com/plugins/copilot>
  - Personal Assistant Obsidian Stats: <https://www.obsidianstats.com/plugins/personal-assistant>

License boundary:

- `obsidian-copilot` is AGPL-3.0.
- `personal-assistant` is MIT.
- Treat Copilot as a product and architecture reference. Do not copy implementation code directly unless the project intentionally changes licensing strategy or the copied material is independently reimplemented from requirements.

## Public Signals

These numbers are time-sensitive and should be refreshed before making public claims.

| Signal | Copilot | Personal Assistant | Interpretation |
| --- | --- | --- | --- |
| GitHub/Obsidian Stats stars | 6,997 | 144 | Copilot has much stronger public awareness and contributor gravity. |
| Obsidian Stats downloads | 1,350,407 | 18,478 | Copilot has crossed from plugin into recognizable Obsidian AI product. |
| Obsidian Stats score | 91/100 | 65/100 | Personal Assistant can likely improve discoverability through docs, README, screenshots, release notes, and clearer product focus before major code work. |
| Latest version shown by Obsidian Stats | 3.3.2 | 1.8.0 | Copilot's public release cadence and changelog language are stronger marketing assets. |

## Executive Summary

Copilot's biggest advantage is product coherence. It presents itself as "the AI assistant for your second brain" and then backs that promise with a complete in-Obsidian workflow: chat modes, explicit context selection, project workspaces, tool calling, note editing with preview, model/provider management, saved chat history, custom commands, memory, docs, release notes, testimonials, and a commercial Plus/self-host path.

Personal Assistant has strong local Obsidian automation roots and a technically careful Memory/VSS implementation. Its current weakness is that the user-facing product story is still fragmented: record creation, graph utilities, plugin/theme management, stats, callouts, featured images, and Memory chat all sit side by side without a single ladder of user value.

The most useful lesson is not "become Copilot." A better direction is:

1. Keep Personal Assistant's positioning as an Obsidian-native personal operations assistant.
2. Turn the chat surface into the unifying control plane for existing Obsidian management features.
3. Productize current Memory/VSS strengths with clearer onboarding, context controls, source labels, and docs.
4. Add a small set of high-value read-only Obsidian operation tools before any write/action automation.
5. Improve marketing and docs so users immediately understand who the plugin is for and what workflow it makes easier.

## Current Positioning

### Copilot

Copilot is positioned as an AI knowledge-work agent inside Obsidian.

Core promise:

- Bring your own model.
- Keep data under your control.
- Chat with notes and vault.
- Add any context.
- Let an agent use tools.
- Store durable user-facing artifacts as Markdown where possible.

User-facing modes:

- Chat.
- Vault QA.
- Copilot Plus.
- Projects.

Major product surfaces:

- Chat panel.
- `@` mention context system.
- Command palette and slash commands.
- Quick Ask inline panel.
- Composer note editing and diff preview.
- Relevant notes.
- Settings tabs for Basic, Model, QA, Command, Plus, Advanced.
- Documentation site and README with screenshots/testimonials.

### Personal Assistant

Personal Assistant is currently positioned as an Obsidian automation and management plugin with an added Memory-aware AI chat assistant.

Core surfaces:

- Record note creation.
- Hover local graph.
- Plugin/theme enable/update helpers.
- Metadata updater.
- Callout listing.
- Statistics views.
- Featured image generation.
- Chat with Memory from notes.
- Memory/VSS preparation, update, and background maintenance.

Current AI direction from repo docs:

- Chat Agent is moving toward an Obsidian-native assistant.
- Existing approved boundary is read-only tool expansion first.
- Write actions, command execution, plugin/theme actions, and shell-like behavior are explicitly deferred behind a future preview/confirmation/audit contract.

## Technical Comparison

| Area | Copilot | Personal Assistant | What To Learn |
| --- | --- | --- | --- |
| Architecture shape | Broad modular React app with managers for chat, context, persistence, providers, projects, commands, tools, search, memory, and settings. | Smaller Obsidian plugin core with imperative UI, strong Memory/VSS internals, and feature-specific modules. | Keep current scope discipline, but introduce clearer shared abstractions for chat context, tools, settings, and UI state. |
| Chat runtime | `ChatManager` coordinates messages, context, system prompt, project repos, and persistence. `AutonomousAgentChainRunner` handles native tool calling loop. | `ChatService` delegates to `ChatAgentRuntime`, which handles planning, Memory presearch/rerank, read-only tools, final answer streaming, abort, and wall-clock cap. | Current runtime is already safety-conscious. Borrow the clearer separation of message repository, context manager, and persistence as product complexity grows. |
| Tool registry | Central `ToolRegistry` with metadata: category, display name, always-enabled, vault requirement, Plus gating, timeout, background, command aliases. | `ToolRegistry` has permission, cost, output budget, confirmation, failure behavior, source boundary, status copy, and provider schema export. | Personal Assistant's policy metadata is stronger for safety. Add Copilot-like category/display metadata and settings/UI grouping. |
| Context model | Rich context system: active note, selected text, notes, folders, tags, URLs, web tabs, images, PDFs, web viewer, project sources. Context appears as pills/badges. | Current-note context, Memory references, metadata/recent/outline tools, and planned Obsidian operations tools. UI has a Memory chip but lacks rich context pills. | Add explicit context controls/pills in chat before adding more powerful actions. Users should see what the assistant will read. |
| Search | Index-free lexical search is first-class; semantic search is optional. Search v3 combines grep recall, query expansion, full-text ranking, folder/graph boosts, score normalization. | Memory uses SQLite/WASM vector index with approval, dirty state, background reconcile/flush, and fallback rules. Metadata tools are lighter. | Add a cheap lexical/snippet path for "no setup" questions, distinct from Memory. This is the biggest onboarding improvement. |
| Memory | Saved memories are explicit facts in vault files; recent conversations can be referenced; Plus agent can update memory tool. | Memory is notes-derived vector memory with explicit prepare/update approval, durable local SQLite/WASM backend, and background maintenance after approval. | Preserve product distinction: Personal Assistant Memory means "Memory from your notes." Consider adding separate user-saved preferences later, but do not blur the current contract. |
| Provider/model support | Broad provider matrix, custom models, model import, capability badges, per-model settings, keychain storage, local/self-host options. | Focused providers: Qwen/OpenAI-compatible/Ollama style path, with Qwen-specific thinking/search support. | Decide whether provider breadth is a goal. If yes, copy the product pattern, not code: provider catalog, capability flags, model selector, key storage. |
| Secret storage | Obsidian Keychain support, keychain-only mode for fresh installs, migration wizard, clear disk/keychain boundaries. | AES-GCM encryption with a plugin constant password; token stored in plugin settings after encryption. | Moving to Obsidian SecretStorage/Keychain would be a meaningful security and trust upgrade. |
| UI framework | React + Radix + Lexical + Tailwind + Jotai; reusable UI components; extensive chat controls. | Imperative DOM in `chat-view.ts`, React used elsewhere for some components/views. | For chat growth, React is likely worth adopting incrementally. The current imperative chat view will get expensive as context controls and tool status grow. |
| Editing workflow | Composer tools create/replace notes with preview/diff and accept/reject. Auto-accept is configurable. | Current approved plans explicitly defer writes and command execution. | Use Copilot's UX pattern as reference for future writes: preview, diff, accept/reject, revert, audit. Do not implement now unless the write-action contract is approved. |
| Testing posture | Large test surface: many unit tests in `src/**/*.test.ts(x)`, integration tests, prompt tests, manual testing checklist. | Focused Jest suite for Memory/VSS/chat/settings/plugin features, plus strong repo-local verification rules. | Add prompt/tool regression fixtures as the agent surface expands. |
| Mobile/popout handling | Explicit mobile support, keyboard observers, popout/window migration fixes, CORS paths, bundle-size work. | Mobile VSS has been smoke-tested for Memory; chat UI has mobile keyboard handling in current implementation. | Keep mobile as a first-class acceptance gate, especially for chat and local index behavior. |

## Product And UX Comparison

### Copilot's Strong Product Patterns

1. A clear mode model.

Copilot names the user's mental model directly:

- Chat: talk to the assistant.
- Vault QA: ask the vault.
- Plus: let the agent use tools.
- Projects: focused workspaces.

Personal Assistant currently exposes "Open Chat in Sidebar" and Memory behavior, but not a simple mode model. The user has to infer what the assistant can read or do.

2. Context is visible and editable.

Copilot lets users add notes, folders, tags, URLs, web tabs, images, and selected text. These become pills/badges. This makes AI context inspectable.

Personal Assistant has a Memory chip and Context Used output, but it does not yet have a pre-send context tray. This limits trust and discoverability.

3. "No setup required" vault search.

Copilot makes lexical Vault QA available before embeddings. Semantic indexing is optional. This removes the biggest first-run AI friction.

Personal Assistant's Memory model is more durable and careful, but first-use requires preparation and cost approval. That is correct for embeddings, but it should not be the only path for simple vault questions.

4. Editing is a separate trusted flow.

Copilot's composer file tools show preview/diff and require accept/reject unless auto-accept is enabled. The tool is powerful, but the UX tells users exactly when a file may change.

Personal Assistant should reuse this trust pattern when it eventually crosses into writes. The current docs already point in the right direction.

5. Settings are grouped by user task.

Copilot settings have Basic, Model, QA, Command, Plus, Advanced. Personal Assistant settings are still grouped around historical feature clusters and simple `Setting` controls.

Personal Assistant should eventually group settings around:

- General.
- Chat.
- Memory.
- Obsidian Operations.
- Automation.
- Statistics.
- Advanced.

## Documentation And Marketing Comparison

### Copilot Advantages

Copilot has a complete public funnel:

- README headline and value statement.
- Badges for release/downloads.
- Strong "why" narrative.
- Screenshots for every key feature.
- Free vs Plus feature separation.
- Documentation site.
- YouTube link.
- Bug/feature issue templates.
- Discord/support/community loop.
- Testimonials by user persona.
- Clear release notes that sell value, not only commits.
- Landing page with product categories: Context, Search, Commands, Projects, Composer, Relevance, Self-host.

### Personal Assistant Current Gaps

The current README is useful historically but not yet optimized for new users:

- The headline is generic and grammatically rough.
- The feature list mixes old management utilities and new AI features without priority.
- AI/Memory is introduced as a note rather than the core product direction.
- Screenshots/gifs exist, but they are not arranged around user outcomes.
- There is no crisp "who this is for" section.
- There is no "choose your workflow" guide.
- There is no docs index parallel to Copilot's "Getting Started / Chat / Memory / Operations / Troubleshooting" pattern.

### Recommended Messaging

Suggested positioning:

> Personal Assistant is an Obsidian-native operations assistant that helps you manage notes, plugins, themes, graph context, statistics, and Memory-aware chat without leaving your vault.

Possible user-facing pillars:

- Manage Obsidian faster: record notes, plugin/theme updates, metadata, callouts, stats.
- Ask your notes with Memory: prepare Memory from your vault with explicit approval and background maintenance.
- Understand vault structure: current note, recent notes, metadata, links, tags, tasks, Canvas, and bounded snippets.
- Stay in control: read-only by default; future writes require preview and confirmation.

## What Personal Assistant Should Borrow

### P0: Product Story And Docs

Why:

- Low technical risk.
- High discoverability impact.
- Helps decide what not to build.

Deliverables:

- Rewrite README opening around the new product pillars.
- Add a docs index with user-facing guides:
  - Getting started.
  - Chat and Memory.
  - Obsidian operations.
  - Automation utilities.
  - Troubleshooting.
- Add a feature matrix: available now, experimental, planned.
- Add screenshots of the current chat UI and Memory approval/status flow.
- Keep internal terms out of user docs except diagnostics.

### P1: No-Setup Vault Search / Snippet Search

Why:

- Copilot's strongest onboarding advantage is answering vault questions without embedding setup.
- Personal Assistant can preserve Memory approval safety while still answering lightweight questions through bounded local search.

Fit with current plan:

- This maps well to `search_vault_snippets` in `docs/obsidian-operations-agent-plan.md`.
- It should be read-only, snippet-only, budgeted, and clearly separated from Memory references.

Acceptance shape:

- Ask "where did I mention X?" before Memory is prepared.
- Assistant searches bounded snippets and says exactly what it used.
- No full note body is sent unless a future approved content-class tool exists.

### P1: Visible Context Controls

Why:

- Trust improves when users can see what the assistant will read.
- This is a prerequisite for a more capable assistant UI.

Suggested sequence:

- First add read-only Context Used polish after the answer.
- Then add pre-send context controls for current note, selection, recent notes, and Memory mode.
- Later add note/folder/tag pills if the chat view migrates to React.

### P1: Tool Catalog And Settings Grouping

Why:

- Copilot's tool metadata powers both runtime behavior and UI organization.
- Personal Assistant already has stronger policy metadata; it lacks category/product display metadata.

Suggested additions:

- `category`: memory, current note, vault structure, snippets, operations.
- `displayName`.
- `userFacingDescription`.
- `settingsVisible`.
- `defaultEnabled`.
- `mobileAvailability`.

Keep the existing permission/cost/budget/source-boundary metadata.

### P2: Provider And Model UX

Why:

- Copilot wins trust by supporting many providers and making capabilities visible.
- Personal Assistant's Qwen focus is useful, especially for Chinese users, but model configuration could be clearer.

Suggested additions:

- Model capability metadata: reasoning, web search, vision, embeddings.
- A model selector in chat/settings.
- Provider-specific setup notes.
- Key validation and clearer error messages.
- Obsidian Keychain migration.

### P2: Chat History And Durable User Artifacts

Why:

- Copilot stores chat history, custom prompts, system prompts, memory, and projects as vault-visible files.
- This fits Obsidian's "files first" philosophy.

Personal Assistant candidates:

- Optional saved chat notes.
- User prompt presets as Markdown files.
- Obsidian operations rules as repo/plugin-managed Markdown docs.
- Future project profiles as Markdown, if project mode becomes part of the roadmap.

### P3: Future Composer/Write Actions

Why:

- Copilot's composer is a high-value feature, but it expands risk.
- Personal Assistant already has a stricter write-action handoff plan.

Recommendation:

- Do not implement Copilot-style write tools until read-only operations are stable.
- When implementing, follow the preview/diff/accept/reject/revert/audit pattern.
- Keep auto-accept opt-in and clearly labeled.

## What Not To Borrow Directly

1. Plus/commercial split.

Copilot's Plus strategy is central to its product, but Personal Assistant does not need to copy it. If monetization is not a goal, borrow the tiered explanation pattern, not the paywall.

2. Broad provider matrix before core product clarity.

Provider breadth adds maintenance. Personal Assistant should first make Qwen/OpenAI-compatible/Ollama flows excellent, then expand deliberately.

3. Agent write tools before read-only source boundaries.

Copilot has write tools because its product accepts that scope. Personal Assistant's current contract explicitly defers writes. Stay aligned with the contract.

4. AGPL code.

Use Copilot as a requirements and UX reference. Reimplement independently.

## Suggested Roadmap

### Phase 1: Product And Documentation Refresh

Goal:

- Make the project understandable to new users in 60 seconds.

Tasks:

- Rewrite README top section around product pillars.
- Add `docs/index.md` with user-facing guide links.
- Add `docs/chat-and-memory.md`.
- Add `docs/obsidian-operations-user-guide.md` as planned behavior/current status, not aspirational runtime claims.
- Add troubleshooting for Memory preparation, provider setup, and mobile notes.

Validation:

- Docs diff check.
- README links render.
- No claim says the assistant can perform unimplemented write/command actions.

### Phase 2: Read-Only Vault Snippet Search

Goal:

- Let users ask lightweight vault questions without preparing Memory.

Tasks:

- Implement `search_vault_snippets` under the approved Obsidian Operations SPEC path.
- Add snippet budgets, file/byte caps, abort checks, folder scope, and no-match behavior.
- Add Context Used labels distinct from Memory.

Validation:

- Focused parser/search tests.
- Chat service tests.
- UI status tests.
- `make deploy` and Obsidian smoke.

### Phase 3: Context Controls In Chat

Goal:

- Make context visible before and after send.

Tasks:

- Add explicit toggles for Memory, current note, and selection.
- Add a compact context-used drawer with source categories.
- If the surface keeps growing, migrate chat UI from imperative DOM to React in a dedicated phase.

Validation:

- Chat view tests for context labels and toggles.
- Mobile layout smoke.

### Phase 4: Provider/Settings Trust Upgrade

Goal:

- Reduce setup errors and improve trust around secrets.

Tasks:

- Add provider setup status and model capability metadata.
- Add key validation for configured provider.
- Evaluate Obsidian SecretStorage/Keychain migration for API tokens.

Validation:

- Settings tests.
- Provider-specific smoke where practical.

### Phase 5: Future Writes After Contract Approval

Goal:

- Add safe Obsidian note edits only after read-only agent behavior is stable.

Tasks:

- Use the existing write-action handoff as source of truth.
- Build preview/diff/accept/reject before any file mutation.
- Add audit trail and recovery path.

Validation:

- Unit tests for diff/preview/apply/reject.
- Obsidian smoke on real files in test vault.

## Immediate Action Items

| Priority | Item | Why |
| --- | --- | --- |
| P0 | Rewrite README/product docs around "Obsidian-native operations assistant" | Biggest user-facing gap. |
| P0 | Add docs index and chat/Memory guide | Makes current strengths findable. |
| P1 | Implement bounded lexical/snippet vault search | Matches Copilot's no-setup advantage without weakening Memory approval. |
| P1 | Add visible context/source labels for read-only tools | Builds trust before stronger agent actions. |
| P1 | Add tool display/category metadata | Lets runtime, settings, and UI stay aligned. |
| P2 | Move API keys toward Obsidian Keychain | Concrete security/trust improvement. |
| P2 | Add provider/model capability UX | Reduces support burden and improves setup. |
| P3 | Revisit React chat UI migration | Useful once context pills/tool controls exceed imperative DOM ergonomics. |

## Source Pointers

Copilot source areas reviewed:

- `src/main.ts`
- `src/components/CopilotView.tsx`
- `src/core/ChatManager.ts`
- `src/core/ContextManager.ts`
- `src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts`
- `src/tools/ToolRegistry.ts`
- `src/tools/builtinTools.ts`
- `src/search/v3/SearchCore.ts`
- `src/search/vectorStoreManager.ts`
- `src/components/chat-components/ChatInput.tsx`
- `src/components/chat-components/AtMentionTypeahead.tsx`
- `src/components/chat-components/ContextBadges.tsx`
- `src/components/chat-components/ChatToolControls.tsx`
- `src/components/composer/ApplyView.tsx`
- `src/services/keychainService.ts`
- `src/services/settingsPersistence.ts`
- `docs/*.md`
- `README.md`
- `RELEASES.md`
- `CONTRIBUTING.md`

Personal Assistant source areas reviewed:

- `src/plugin.ts`
- `src/chat-view.ts`
- `src/ai-services/chat-agent.ts`
- `src/ai-services/chat-service.ts`
- `src/ai-services/chat-tools.ts`
- `src/memory-manager.ts`
- `src/vss.ts`
- `src/settings.ts`
- `README.md`
- `docs/obsidian-operations-agent-plan.md`
- `docs/obsidian-operations-spec-driven-development.md`

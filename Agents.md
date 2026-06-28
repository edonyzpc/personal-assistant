# Agents Guide for Codex Assistants

## Why This File Exists
- Summarises the Obsidian Personal Assistant plugin so that AI coding agents (Codex, Copilot, etc.) can bootstrap context quickly.
- Highlights workflows, conventions, and constraints that recur in requests, reducing back-and-forth.
- Keep this file updated whenever a new subsystem, command, or build step is added.

## How To Use `Agents.md`
- Read this document before asking an agent to modify the codebase; point the agent at relevant sections.
- When setting up Codex CLI, add this file to the initial prompt context (e.g. “Start by reviewing `Agents.md` for architecture and build steps.”).
- Reference the sections below in conversation so the agent knows which rules or files to follow.
- If you are adding a brand-new feature, update this file first so the agent understands the new module names and responsibilities.

## High-Level Architecture
- This repository hosts an Obsidian community plugin named **Personal Assistant**. Entry point: `src/main.ts` exports `PluginManager` from `src/plugin.ts`.
- The plugin augments Obsidian with automated note management, plugin/theme updates, callout helpers, statistics dashboards, and an AI-assisted workflow backed by a vector semantic search (VSS) cache.
- Main runtime pieces:
  - `src/plugin.ts`: registers commands, views, ribbon/status items, handles settings, wires stats/AI helpers.
  - `src/settings.ts`: plugin configuration UI and defaults (`DEFAULT_SETTINGS`).
  - `src/ai.ts` + `src/ai-services/`: orchestrate RAG chat, LLM calls (LangChain, Ollama), and AI UI widgets.
  - `src/stats/`: word-count and activity statistics managers, editors, and renderers.
  - `src/components/`: Svelte components rendered inside Obsidian popups/panels.
  - `src/vss.ts`: manages the vector store cache used by AI features (LLM knowledge base).
  - `src/utils.ts` & `src/constant.ts`: shared helpers, icons, and constants.
  - `manifest.json` / `manifest-beta.json`: Obsidian plugin metadata (ID `personal-assistant`).

## Source Layout Cheatsheet
- `src/ai-services/`  
  `chat-service.ts`, `service.ts`, `ai-utils.ts`: Abstractions around LangChain, streaming responses, provider configuration.
- `src/stats/`  
  `stats-manager.ts`: Entrypoint for recording file events and keeping per-note stats; hooks into Obsidian events.  
  `editor-plugin.ts`: ProseMirror editor plugins for live word counts.  
  `models/` (if added later): keep domain models here.
- `src/components/*.svelte`: Svelte UI; shared styling via `styles.css`.
- `src/obsidian-hack/`: Monkey patches for platform quirks (e.g., mobile console logging).
- `docs/` and `Manual*.md`: end-user documentation and GIFs referenced by README.
- `test/`: Local test vault used in manual testing (`test/.obsidian/...`); Jest integration tests live here when needed.

## Build, Test, and Release
- **Install deps:** `yarn install`
- **Type-check & bundle (prod):** `yarn build` (runs `tsc` then `esbuild`)
- **Watch mode:** `yarn dev`
- **Lint:** `yarn lint`
- **Unit tests:** `yarn test` (configured via `jest.config.js`)
- **Manual vault setup:**  
  ```sh
  mkdir -p test/.obsidian/plugins/personal-assistant/
  yarn build
  make deploy    # copies dist to the test vault
  ```
- **Version bump:** `yarn version` (updates `manifest*.json`, `versions.json`, changelog)

## Coding Guidelines
- Language: TypeScript (ES2022) with strict linting via `@typescript-eslint`. UI layers use Svelte 4.
- Follow existing naming conventions: services end with `Service`, managers with `Manager`, commands use kebab-cased `id` values.
- Prefer async/await, avoid unhandled promises. Use `Notice` sparingly for UX.
- Statistics and AI modules rely on Obsidian events—ensure cleanup in `onunload`.
- When adding settings, update `DEFAULT_SETTINGS`, settings tab UI, and consider migrations in `PluginManager#migrateSettings`.
- Keep `styles.css` SCSS-like nesting minimal; Obsidian ships with global CSS, so namespace classes with `personal-assistant-*`.

## AI & RAG Notes
- Vector cache lives under `this.vssCacheDir` (`.obsidian/plugins/personal-assistant/vss-cache`).  
  `src/vss.ts` initialises and synchronises embeddings.
- Chat assistant view type `VIEW_TYPE_LLM` renders `LLMView` (`src/chat-view.ts`), which relies on services in `src/ai-services/`.
- `AssistantHelper` / `AssistantFeaturedImageHelper` in `src/ai.ts` tie vault content retrieval with LangChain pipelines.
- When touching AI flows, update `docs/` GIFs or README callouts as needed.

## Observability & Metrics
- `StatsManager` (`src/stats/stats-manager.ts`) listens to file changes, aggregates metadata, and powers statistics view `STAT_PREVIEW_TYPE`.
- Editor plugins (`statusBarEditorPlugin`, `sectionWordCountEditorPlugin`) inject word counts into the status bar; keep their performance characteristics in mind when editing.

## Working With Commands and Views
- Commands are registered in `PluginManager.onload`; each new command should have a unique `id`, localized `name`, and optionally use Obsidian’s `Modal`/`SuggestModal` infrastructure in `src/modal.ts` or `src/batch-modal.ts`.
- Views (`RECORD_PREVIEW_TYPE`, `STAT_PREVIEW_TYPE`, `VIEW_TYPE_LLM`) are registered once the workspace layout is ready—follow this pattern for new view types.

## Configuration Tips For Agents
- Mention relevant settings when asking Codex for changes, e.g. “Update `DEFAULT_SETTINGS` in `src/settings.ts`.”
- If tasks touch plugin metadata, remind the agent to edit both `manifest.json` and `manifest-beta.json`.
- For styling changes, specify whether to update Svelte components or global `styles.css`; Svelte styles are component-scoped by default.
- The repo may contain pre-existing uncommitted changes—do not reset them. Ask the agent to focus only on files noted in the request.

## Keeping This File Useful
- Add new sections whenever a subsystem (e.g., sync, notifications, mobile tweaks) is introduced.
- Note any non-obvious build steps, environment variables, or secrets management.
- Record manual QA tips (e.g., “Test AI chat by running command `personal-assistant:open-llm-view`.”).

By maintaining `Agents.md`, you ensure Codex and other coding assistants understand the project quickly and produce higher-quality contributions.

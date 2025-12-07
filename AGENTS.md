# AGENTS

## Purpose
- Document project structure, build steps, and React/Obsidian integration rules so LLM agents can work safely.

## Stack (Dec 7, 2025)
- Obsidian plugin, TypeScript.
- UI: React 19 + Radix UI + Tailwind (CLI precompile).
- Charts: react-chartjs-2 (Chart.js) **lazy-loaded**.
- Bundler: esbuild (CJS output, Obsidian externals), CSS loaded via `styles.css` (imports `generated/tailwind.css`).

## Layout
- Entry: `src/main.ts` → `src/plugin.ts`
- Views: `src/preview.ts` (RecordList), `src/stats-view.ts` (Statistics), chat sidebar `src/chat-view.ts` (DOM), AI floating command in `src/plugin.ts`.
- Components (React): `src/components/*` (RecordList, Statistics, AIWindow suite).
- Styling: `styles.css` (global + Tailwind import), `src/tailwind.css` (input), `generated/tailwind.css` (build output).

## React Mounting Convention
- For `ItemView`/commands, create an element, then `createRoot(container).render(<Component />)`.
- Always `root.unmount()` in `onClose`/teardown or when toggling UI to avoid leaks. Source: Obsidian React guide. ([marcusolsson.github.io](https://marcusolsson.github.io/obsidian-plugin-docs/getting-started/react?utm_source=openai))
- Pass `app`/`plugin` through props or context; avoid globals.

## Tailwind
- Build with CLI: `yarn tailwind:build` (input `src/tailwind.css` → output `generated/tailwind.css`).
- `styles.css` imports the generated file; ensure Tailwind build runs before packaging.
- Prefer `pa-`/utility classes to limit theme collisions.

## Performance Rules
- Heavy libs (Chart.js) loaded via `import()`; consider laziness for other heavy UIs.
- Keep observers/debouncers cleared on unmount; prefer memoization for derived data.
- Define `process.env.NODE_ENV` in esbuild for dead-code elimination.

## Build/Test Commands
- `yarn dev` (esbuild watch), `yarn dev:tailwind` (Tailwind watch), `yarn build` (type-check + Tailwind build + esbuild).
- Tests currently minimal; add Jest/RTL only if needed.

## Agent Checklist
- Unmount React roots in `onClose`/toggle paths.
- Keep CSS scoped; avoid leaking into Obsidian core UI.
- If adding deps, watch bundle size and externals list.
- Preserve user settings (e.g., `statisticsType`, `previewLimits`, `targetPath`) when re-rendering views.

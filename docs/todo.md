# Project TODO

## Build / Deploy Cleanup

- [ ] Remove obsolete SQLite asset cleanup from `Makefile`.
  - Context: `vss-sqlite-worker.js` and `sqlite3.wasm` are now inlined into `main.js` through esbuild (`inline-sqlite-worker` and the WASM `dataurl` loader), so standard deploy/release no longer needs standalone worker/WASM files.
  - Current impact: low. The existing `rm -rf` cleanup lines are harmless, but they are historical noise and can be removed in a separate focused change.
  - Suggested commit: `build(deploy): remove obsolete sqlite asset cleanup`

## Lifecycle Cleanup

- [ ] Disconnect the global `MutationObserver` in `src/plugin.ts` during plugin unload.
  - Context: `src/plugin.ts` creates a `MutationObserver` for `.popover.hover-popover.hover-editor` changes and observes `document.body`, but `onunload()` currently stops Memory maintenance and disposes VSS/stats without disconnecting this observer.
  - Current impact: low to medium. This is existing technical debt rather than a regression from `AGENTS.md`; however, repeated plugin reloads could leave stale observers alive.
  - Suggested fix: store the observer on the plugin instance or register a cleanup callback, then call `disconnect()` from `onunload()`.
  - Suggested commit: `fix(plugin): disconnect mutation observer on unload`

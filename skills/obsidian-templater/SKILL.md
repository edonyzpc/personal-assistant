---
name: obsidian-templater
description: "Templater plugin syntax, template commands, dynamic commands, user scripts, and startup templates. Use when the user asks about creating templates, inserting dynamic content, automating note creation, or writing Templater commands/user scripts."
allowed-tools: [get_current_note_context, inspect_obsidian_note, search_vault_snippets]
---
Scope: explain and design Templater syntax and templates from the topic references below.

Load the exact reference that matches the needed method. These methods describe Templater's own capabilities; using them for the current task does not grant PA permission to execute template commands, install dependencies, or modify notes.

- Command delimiter semantics and multiline execution: `references/command-types.md`
- `tp.file`, `tp.date`, `tp.frontmatter`, `tp.system`, `tp.web`, and `tp.obsidian`: `references/module-reference.md`
- User script module format and startup templates: `references/user-scripts.md`
- Working templates and Dataview integration: `references/common-patterns.md`
- Complete module API details: `references/templater-modules-api.md`

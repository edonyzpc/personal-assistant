## Module Reference

All modules are accessed through the `tp` object.

### tp.file

File operations and metadata for the current note.

| Method / Property | Return | Description |
|---|---|---|
| `tp.file.title` | string | Filename without extension |
| `tp.file.path(relative?)` | string | System path; `relative=true` returns the vault-relative path, including filename. |
| `tp.file.folder(absolute?)` | string | Folder basename; `absolute=true` includes its path from the vault root. |
| `tp.file.content` | string | Full file content at template insertion time |
| `tp.file.selection()` | string | Currently selected text in the editor |
| `tp.file.rename(newName)` | Promise<void> | Rename the file (no extension) |
| `tp.file.move(newPath, fileToMove?)` | Promise<void> | Destination includes folder and filename without extension; optional second argument is a TFile. |
| `tp.file.create_new(template, filename, openNew?, folder?)` | Promise<TFile> | Create a new note from a template |
| `tp.file.include(linkOrFile)` | Promise<string> | Include a wikilink or TFile's template output |
| `tp.file.exists(filePath)` | Promise<boolean> | Check a vault-relative path including extension |
| `tp.file.find_tfile(filename)` | TFile | Find a TFile object by name |
| `tp.file.cursor(order?)` | void | Place cursor here after insertion. `order` sets tab-stop index. |
| `tp.file.cursor_append(content)` | void | Append text at the cursor position |

### tp.date

Date formatting and arithmetic.

| Method | Return | Description |
|---|---|---|
| `tp.date.now(format?, offset?, ref?, refFormat?)` | string | Current date/time. Default format: `YYYY-MM-DD`. Offset: integer days or ISO 8601 duration, e.g. `7`, `"P-1M"`. |
| `tp.date.tomorrow(format?)` | string | Tomorrow's date |
| `tp.date.yesterday(format?)` | string | Yesterday's date |
| `tp.date.weekday(format, n, ref?, refFormat?)` | string | Locale-relative weekday; `n=0` is the locale's first weekday. |

Formats follow Moment.js tokens: `YYYY`, `MM`, `DD`, `HH`, `mm`, `ss`, `dddd`, `MMMM`.

### tp.frontmatter

Direct access to YAML frontmatter properties of the current note.

Access fields by name: `tp.frontmatter.tags`, `tp.frontmatter.title`, `tp.frontmatter.status`. Nested fields use dot notation in the template but bracket notation in JS: `tp.frontmatter["nested-key"]`.

### tp.system

User interaction and system clipboard.

| Method | Return | Description |
|---|---|---|
| `tp.system.clipboard()` | Promise<string> | Current clipboard content |
| `tp.system.prompt(promptText, defaultValue?, throw?, multiline?, selectDefaultValue?)` | Promise<string or null> | Show input dialog. `throw=true` throws on cancel instead of returning null. The fifth argument selects the default text for replacement. |
| `tp.system.suggester(textItems, actualItems, throw?, placeholder?, limit?)` | Promise<item or null> | Show selection dialog. `textItems` are display strings, `actualItems` are return values. |

### tp.web

Web requests (requires network access).

| Method | Return | Description |
|---|---|---|
| `tp.web.daily_quote()` | Promise<string> | Daily quote callout |
| `tp.web.random_picture(size?, query?, include_size?)` | Promise<string> | Random image Markdown from Unsplash |
| `tp.web.request(url, path?)` | Promise<string> | HTTP GET. Optional response JSON field path via `path`. |

### tp.obsidian

Exposes the Obsidian API object for advanced use. Access `tp.obsidian.Notice`, `tp.obsidian.Modal`, `tp.obsidian.requestUrl`, and other Obsidian globals. Use sparingly -- prefer higher-level `tp.*` modules when possible.

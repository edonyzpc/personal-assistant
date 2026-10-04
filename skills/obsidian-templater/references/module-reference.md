## Module Reference

All modules are accessed through the `tp` object.

### tp.file

File operations and metadata for the current note.

| Method / Property | Return | Description |
|---|---|---|
| `tp.file.title` | string | Filename without extension |
| `tp.file.path(relative?)` | string | Vault-relative path. `relative=true` omits filename. |
| `tp.file.folder(relative?)` | string | Parent folder path |
| `tp.file.content` | string | Full file content at template insertion time |
| `tp.file.selection()` | string | Currently selected text in the editor |
| `tp.file.rename(newName)` | void | Rename the file (no extension) |
| `tp.file.move(newPath, fileName?)` | void | Move file to a new folder |
| `tp.file.create_new(template, filename, openNew?, folder?)` | TFile | Create a new note from a template |
| `tp.file.include(templateOrPath)` | string | Include another template's output inline |
| `tp.file.exists(filePath)` | boolean | Check if a file exists in the vault |
| `tp.file.find_tfile(filename)` | TFile | Find a TFile object by name |
| `tp.file.cursor(order?)` | void | Place cursor here after insertion. `order` sets tab-stop index. |
| `tp.file.cursor_append(content)` | void | Append text at the cursor position |

### tp.date

Date formatting and arithmetic.

| Method | Return | Description |
|---|---|---|
| `tp.date.now(format?, offset?, ref?, refFormat?)` | string | Current date/time. Default format: `YYYY-MM-DD`. Offset: `"1 day"`, `"-2 weeks"`. |
| `tp.date.tomorrow(format?)` | string | Tomorrow's date |
| `tp.date.yesterday(format?)` | string | Yesterday's date |
| `tp.date.weekday(format, n, ref?, refFormat?)` | string | Weekday relative to reference. `n=0` is Monday, `n=6` is Sunday. |

Formats follow Moment.js tokens: `YYYY`, `MM`, `DD`, `HH`, `mm`, `ss`, `dddd`, `MMMM`.

### tp.frontmatter

Direct access to YAML frontmatter properties of the current note.

Access fields by name: `tp.frontmatter.tags`, `tp.frontmatter.title`, `tp.frontmatter.status`. Nested fields use dot notation in the template but bracket notation in JS: `tp.frontmatter["nested-key"]`.

### tp.system

User interaction and system clipboard.

| Method | Return | Description |
|---|---|---|
| `tp.system.clipboard()` | string | Current clipboard content |
| `tp.system.prompt(promptText, defaultValue?, throw?, multiline?, suggestions?)` | string | Show input dialog. `throw=true` throws on cancel instead of returning null. |
| `tp.system.suggester(textItems, actualItems, throw?, placeholder?, limit?)` | any | Show selection dialog. `textItems` are display strings, `actualItems` are return values. |

### tp.web

Web requests (requires network access).

| Method | Return | Description |
|---|---|---|
| `tp.web.daily_quote()` | string | Random daily quote |
| `tp.web.random_picture(size?, query?, include_size?)` | string | Random image URL from Unsplash |
| `tp.web.request(url, path?)` | string | HTTP GET. Optional JSONPath extraction via `path`. |

### tp.obsidian

Exposes the Obsidian API object for advanced use. Access `tp.obsidian.Notice`, `tp.obsidian.Modal`, `tp.obsidian.requestUrl`, and other Obsidian globals. Use sparingly -- prefer higher-level `tp.*` modules when possible.

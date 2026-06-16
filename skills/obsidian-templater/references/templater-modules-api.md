# Templater Modules API Reference

## tp.file

```typescript
tp.file.title: string
tp.file.content: string
tp.file.path(relative?: boolean): string
tp.file.folder(relative?: boolean): string
tp.file.selection(): string
tp.file.rename(newName: string): Promise<void>
tp.file.move(newPath: string, fileName?: string): Promise<void>
tp.file.create_new(
    template: TFile | string,
    filename: string,
    openNewNote?: boolean,     // default: false
    folder?: TFolder | string  // default: current folder
): Promise<TFile>
tp.file.include(tfileOrPath: TFile | string): Promise<string>
tp.file.exists(filePath: string): Promise<boolean>
tp.file.find_tfile(filename: string): TFile | null
tp.file.cursor(order?: number): void
tp.file.cursor_append(content: string): void
```

**Edge cases:**
- `create_new` with empty string template creates a blank note.
- `create_new` with a `TFile` template applies Templater processing to that file.
- `include` resolves paths relative to the vault root, not the current file.
- `find_tfile` matches by basename without extension; returns null if not found.
- `cursor(0)` is the default cursor position; `cursor(1)`, `cursor(2)` etc. create tab stops.
- `move` does not rename -- pass `fileName` to rename during move.

## tp.date

```typescript
tp.date.now(
    format?: string,       // default: "YYYY-MM-DD"
    offset?: number | string, // e.g. 7, "1 day", "-2 weeks"
    ref?: string,          // reference date string
    refFormat?: string     // format of ref
): string

tp.date.tomorrow(format?: string): string
tp.date.yesterday(format?: string): string

tp.date.weekday(
    format: string,
    n: number,         // 0=Monday, 1=Tuesday, ... 6=Sunday (ISO)
    ref?: string,
    refFormat?: string
): string
```

**Format tokens** (Moment.js):
`YYYY` (4-digit year), `YY`, `MM` (01-12), `M`, `DD` (01-31), `D`, `HH` (00-23), `hh` (01-12), `mm`, `ss`, `dddd` (weekday name), `ddd`, `MMMM` (month name), `MMM`, `X` (unix timestamp), `x` (unix ms).

**Offset formats**: integer (days), or string with unit: `"1 day"`, `"-3 months"`, `"2 weeks"`, `"1 year"`. Multiple units: `"1 year 2 months"`.

## tp.frontmatter

```typescript
tp.frontmatter.<key>: any
tp.frontmatter["hyphenated-key"]: any
```

Reads YAML frontmatter at template insertion time. Returns `undefined` for missing keys. Nested objects are plain JS objects. Arrays are JS arrays. Dates from YAML are strings (not Date objects).

## tp.system

```typescript
tp.system.clipboard(): Promise<string>

tp.system.prompt(
    promptText: string,
    defaultValue?: string,
    throw_on_cancel?: boolean,  // default: false
    multiline?: boolean,        // default: false
    suggestions?: string[]
): Promise<string | null>

tp.system.suggester(
    textItems: string[] | ((item: T) => string),
    actualItems: T[],
    throw_on_cancel?: boolean,  // default: false
    placeholder?: string,
    limit?: number              // max visible suggestions
): Promise<T | null>
```

**Error handling:**
- `prompt` returns `null` on cancel when `throw_on_cancel=false` (default). Set `throw=true` to throw an error instead, which aborts template processing.
- `suggester` returns `null` on cancel by default. Same `throw_on_cancel` behavior.
- `clipboard()` may throw if clipboard access is denied by the OS.
- `suggestions` in `prompt` enables fuzzy autocomplete from the provided list.
- `suggester` with a function as `textItems` calls it for each `actualItems` element to produce display text.

## tp.web

```typescript
tp.web.daily_quote(): Promise<string>

tp.web.random_picture(
    size?: string,          // e.g. "200x200"
    query?: string,         // search term
    include_size?: boolean  // include dimensions in URL
): Promise<string>

tp.web.request(
    url: string,
    path?: string   // JSONPath-like extraction: "data.items[0].name"
): Promise<string>
```

**Notes:**
- `daily_quote` fetches from an external API; may fail offline.
- `random_picture` returns an Unsplash URL. The `query` filters by topic.
- `request` returns the full response body as a string. If `path` is provided, parses as JSON and extracts the value at that path.
- All web methods require network access. They will throw in offline/restricted environments.

## tp.obsidian

```typescript
tp.obsidian: typeof import("obsidian")
```

Exposes the full Obsidian API module. Common uses:
- `new tp.obsidian.Notice("message", timeout?)` -- show a notice.
- `tp.obsidian.requestUrl({ url, method, headers, body })` -- HTTP request with Obsidian's transport.
- `tp.obsidian.normalizePath(path)` -- normalize vault path.
- `tp.obsidian.moment()` -- Moment.js instance (Obsidian bundles Moment).

This is an escape hatch for functionality not covered by other modules. Prefer `tp.file`, `tp.system`, `tp.web` when possible.

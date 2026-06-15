# DataviewJS API Reference

## Page Object Properties

Pages returned by `dv.pages()` expose all frontmatter fields as direct properties plus `file.*` metadata. Access custom fields with dot notation: `page.rating`, `page.status`.

## Query Methods on DataArrays

```js
dv.pages('"Notes"')
  .where(p => p.status === "active")
  .sort(p => p.file.ctime, "desc")
  .limit(10)
  .groupBy(p => p.category)
  .map(p => [p.file.link, p.rating])
```

- `.where(predicate)` — filter pages
- `.sort(key, order?)` — `"asc"` (default) or `"desc"`
- `.groupBy(key)` — returns groups with `.key` and `.rows`
- `.limit(n)` — take first n results
- `.map(fn)` — transform each element
- `.flatMap(fn)` — transform and flatten
- `.mutate(fn)` — update in place
- `.array()` — convert to plain JS array
- `.values` — underlying array

## Rendering Helpers

```js
// Table with computed columns
dv.table(
  ["Name", "Tags", "Modified"],
  dv.pages("#project")
    .sort(p => p.file.mtime, "desc")
    .map(p => [p.file.link, p.file.tags.join(", "), p.file.mtime])
);

// Grouped task list
dv.taskList(
  dv.pages("#work").file.tasks.where(t => !t.completed),
  true  // group by file
);
```

## I/O and Utility

- `dv.io.load(path)` — read file content as string
- `dv.io.csv(path)` — parse CSV file
- `dv.io.normalize(path)` — resolve vault path
- `dv.luxon` — access Luxon DateTime library
- `dv.func` — access built-in DQL functions from JS
- `dv.compare(a, b)` — Dataview comparison
- `dv.equal(a, b)` — Dataview equality check
- `dv.fileLink(path, embed?, display?)` — produce file link
- `dv.sectionLink(path, section, embed?, display?)` — link to heading
- `dv.blockLink(path, blockId, embed?, display?)` — link to block

## Date Handling

Dataview uses Luxon for dates. Frontmatter dates are auto-parsed:

```js
const page = dv.current();
const daysSince = dv.luxon.DateTime.now().diff(page.file.ctime, "days").days;
dv.paragraph(`Created ${Math.floor(daysSince)} days ago`);
```

## Settings Awareness

Key Dataview settings that affect query behavior:
- **Inline queries** may be disabled in settings
- **Task completion** tracking can be toggled
- **Date format** and **group date format** affect display
- **Recursive sub-folder** matching is on by default for `FROM`
- **Automatic view refreshing** interval affects live updates

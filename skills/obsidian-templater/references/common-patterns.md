## Common Patterns

**Daily note with metadata**:
```
---
date: <% tp.date.now("YYYY-MM-DD") %>
tags: [daily]
mood: <% tp.system.suggester(["great","good","okay","bad"], ["great","good","okay","bad"], false, "How are you?") %>
---
# <% tp.date.now("dddd, MMMM D, YYYY") %>

## Tasks
- [ ] <% tp.system.prompt("First task for today?") %>

## Journal
<% tp.file.cursor() %>
```

**Meeting note with prompts**:
```
---
type: meeting
date: <% tp.date.now("YYYY-MM-DD") %>
attendees: [<% tp.system.prompt("Attendees (comma-separated)") %>]
---
# Meeting: <% tp.system.prompt("Meeting topic") %>

## Agenda
1. <% tp.file.cursor(1) %>

## Notes
<% tp.file.cursor(2) %>

## Action Items
- [ ] <% tp.file.cursor(3) %>
```

**Zettelkasten note with unique ID**:
```
---
id: <% tp.date.now("YYYYMMDDHHmmss") %>
created: <% tp.date.now("YYYY-MM-DD HH:mm") %>
tags: []
---
# <% tp.file.title %>

<% tp.file.cursor() %>

---
## References
```

**Template creating linked notes**:
```
<%*
const projectName = await tp.system.prompt("Project name");
const folder = "Projects/" + projectName;
await tp.file.move(folder + "/" + projectName);
await tp.file.create_new("", projectName + " - Tasks", false, folder);
await tp.file.create_new("", projectName + " - Notes", false, folder);
tR += "# " + projectName + "\n\n";
tR += "- [[" + projectName + " - Tasks]]\n";
tR += "- [[" + projectName + " - Notes]]\n";
-%>
```

## Interaction with Dataview

Templater-generated frontmatter feeds Dataview queries. When a template sets `status`, `due`, or `tags` via prompts or computed values, those fields become queryable immediately:

- Template sets `status: <% tp.system.suggester(["active","planned","done"], ["active","planned","done"]) %>` in frontmatter.
- Dataview query `TABLE status, due FROM #project WHERE status = "active"` picks up the value.

Dynamic commands (`<%+ %>`) update frontmatter on each file open, keeping Dataview queries current. Use `<%+ tp.date.now("YYYY-MM-DD") %>` in frontmatter to track "last opened" dates.

When evidence about the user's template setup is missing, use `search_vault_snippets` to find existing Templater patterns in the vault before suggesting new ones.

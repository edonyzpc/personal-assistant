## User Scripts

Custom functions defined as Node.js modules in a configured folder.

**Setup**: In Templater settings, set the "Script files folder" (e.g., `Scripts/Templater/`).

**Module format**:
```javascript
// Scripts/Templater/myHelper.js
module.exports = function(tp) {
    return "computed value";
};
// or async:
module.exports = async function(tp) {
    const result = await tp.web.request("https://api.example.com/data");
    return result;
};
```

**Invocation**: `<% tp.user.myHelper(tp) %>`. The function name matches the filename (without extension). The `tp` object is always passed as the first argument.

## Startup Templates

Templates that execute automatically when Obsidian starts.

**Setup**: In Templater settings, add files to the "Startup Templates" list. Each template runs once on launch. Execution commands (`<%* %>`) are the primary mechanism.

**Use cases**: Auto-create today's daily note, sync task lists, update dashboards, run maintenance scripts.

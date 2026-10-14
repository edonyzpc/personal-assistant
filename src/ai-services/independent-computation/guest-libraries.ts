import MarkdownIt from "markdown-it";
import * as yaml from "js-yaml";

// This entry is bundled as source and evaluated inside the same QuickJS VM.
// Neither library receives host objects, filesystem access or network access.
Object.defineProperties(globalThis, {
    markdownit: { value: MarkdownIt, enumerable: true },
    jsyaml: { value: Object.freeze(yaml), enumerable: true },
});

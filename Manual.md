# Personal Assistant Plugin Manual

Updated on 2026-10-31 against current **`master`**, prepared for the next stable release. Older installed releases may have different settings; use a matching release or the [source-build instructions](./README.md#install-and-configure-chat). [中文手册](./Manual-CN.md) · [Quick start](./README.md#try-one-note)

## Background

When it comes to note-taking tools, I greatly admire Kepano's concept — [File Over App](https://twitter.com/kepano/status/1675626836821409792?s=20). My thoughts on using the Obsidian note-taking tool are quite similar. As a tool, Obsidian should help me focus on recording and thinking, with less time spent maintaining the system.

A good recording system shouldn’t require extensive time for maintenance. Once a record-keeping system needs continuous "periodic" maintenance, it defeats the purpose of recording since the maintenance itself adds no value and merely consumes time. Hence, the ideal scenario is having no upkeep and management at all. Though this is an ideal condition, I strive to minimize the time cost of maintenance — automation is a great solution.

Obsidian users who want to take good notes would prefer to spend their time recording and thinking, not managing. Therefore, when using Obsidian, they often have a similar expectation — **spend less time on management and more on recording and thinking**. In addressing this need, a plugin that automates these management tasks becomes very valuable.

This is the reason I developed the Personal Assistant plugin. The Personal Assistant plugin is an Obsidian platform plugin focused on helping you record more ideas and inspirations and better review your past notes, primarily through automation (reducing interactions, one-click management tasks), while also supporting plenty of personalized configurations and multi-plugin interactions.

## AI Chat

### 1. Description

Personal Assistant provides Chat inside your vault. Select note context to ask about what you are reading, or prepare Memory to find relevant material from other eligible notes. Use the [first-note task](./README.md#try-one-note) for a small, non-sensitive example.

### 2. Entry points

- **Ribbon icon**: Click the Personal Assistant icon to open Chat.
- **Command palette**: Search for `Personal Assistant: Open PA Agent`.
- **Empty-state setup**: When AI setup is incomplete, Chat offers Qwen China, Qwen International, or OpenAI plus a token field when needed. **Advanced setup** opens the plugin Settings for custom endpoints or models.

### 3. Configuration

In **Settings → Personal Assistant → AI connection**, open **AI connections**:

1. Select **Add default service**, choose OpenAI, DashScope China/International, or Custom, and enter your API Key. Provider presets fill the relevant models and addresses; Custom needs compatible Chat/embedding settings. Credentials use Obsidian's secret storage.
2. Check **Advanced settings** when you need to change a model or API address, then select **Save and set as default**. New OpenAI connections default to `gpt-6.1-terra`; saved connections are not automatically changed, and your account needs access to the selected model.
3. Inspect the overview's **Chat**, **Note retrieval (Memory)** and **Images** rows. They can follow the default service where supported. Use **Adjust by function** for a different saved connection; use **Manage saved connections** to edit or remove connections.

When upgrading from legacy settings, **Use an already saved Key** lets you identify the service for that Key and review the preserved configuration. This does not send a test request. Do not assume a retained Key belongs to a different provider.

The Chat empty state also offers standard-provider setup and **Advanced setup** opens these settings. Once the required configuration is saved, Chat shows the normal starting prompts.

OpenAI connections use the Responses API for Chat and text assistance across their selected models. Custom Chat uses OpenAI-compatible Chat Completions; DashScope uses the SDK's compatible route and its service settings. The saved service determines this choice; a model name or an official address entered in Custom does not switch its protocol. Protocol compatibility alone does not guarantee tool calls, image input, embedding, or access to every model.

Before adding credentials, check **Notes & privacy → Notes PA can use** and the Memory settings. Only Chat is needed for the first-note task; embedding and an image-generation connection are separate requirements. If you want to try only the selected note first, turn off Memory and Pagelet automatic discovery before sending. Memory is enabled by default and a first Chat can otherwise prepare eligible notes in the background, sending their text to the embedding provider and using API credits. A local index does not make remote processing local.

Memory keeps separate device-local profiles for retrieval configurations. A profile switch does not automatically rebuild the entire vault; compatible existing profiles can be reused, and inactive profiles do not receive paid background maintenance. A changed embedding model/dimension can need preparation; inspect the Memory status and choose **Prepare Memory** or **Update Memory** when appropriate.

### 4. Sending messages

- Type a prompt in the composer at the bottom and press `Enter` to send (`Shift+Enter` for newline).
- A streaming reply appears inline. Use the stop button to interrupt; the partial answer is preserved.
- Hover a message on desktop to reveal its actions. On mobile, tap the message's top-right **⋯**, or press and hold its heading or bubble padding to open the action menu. Pressing the message text still selects text.

### 5. Citations and note context

- Open a Markdown note before opening chat to use the empty-state prompt chips for current-note summaries, related-note discovery, and drafting from the current note.
- Inspect the context, source paths or references actually shown, and open the original note to check the answer. Do not treat a plausible answer alone as proof that Memory was searched.
- Use Memory preparation/update controls when you want chat to search indexed notes beyond the current note.

### 6. Web search and note actions

- Enable WebSearch in plugin settings to let the assistant fetch external pages while answering when the configured provider supports it. Web results are summarized inline with URLs when available.
- Read tools include Memory search, current-note context, bounded vault metadata/snippet reads, canvas summaries, tag lists, skill guides, and WebSearch when available.
- With the current note-action capability available, an explicit request to create, append, edit, or update note properties can be executed directly. Ask for a preview when you want to inspect the proposal before writing. Analysis, quoted instructions, and preview-only requests do not execute changes; unclear targets or actions beyond your authorization still require clarification or confirmation.
- Inspect the reported result and note differences after execution. Undo is offered for eligible completed changes and stops if restoring the old content would overwrite later edits. A pending proposal or an unknown result is not a completed change. The current action boundary is described in [DEC-051](./docs/product/decisions/dec-051-proportionate-confirmation-and-contract-alignment.md).

### 7. Memory integration

Memory also includes personal context, separate from the searchable note index. **AI Memory Extraction** can learn useful preferences from your messages when Memory, learning and the required consent conditions permit; this may send user messages to the configured Chat provider in the background and use credits. Inspect, correct or forget personal information in the Memory settings. Turning extraction off stops new learning; existing information can still be used while Memory remains on, until forgotten or Memory is disabled.

- After Memory has been prepared, the assistant can search your indexed notes before answering. The composer Memory button surfaces Memory status (ready / preparing / disabled).
- Memory is enabled by default but can be turned off under **Notes & privacy → Use memory from my notes**. Its index stays device-local in SQLite/WASM. After you configure a retrieval connection and send the first Chat message, Memory may start preparing in the background without a blocking prompt: eligible note text is sent to that embedding provider and may use API credits. Folder, tag, and generated-note exclusions are applied; recovery, settings-change, and manual rebuilds still ask before costly work.

### 8. Images, Pagelet, and Ghost

- Add images to Chat to ask about them with a vision-capable Chat model. Processed image copies are sent to that provider. Image generation/editing uses the **Images** purpose's compatible connection: OpenAI at its official endpoint, or Wan at recognized DashScope endpoints. A custom Chat URL does not gain image-generation support. Adding an image or discussing a prompt alone does not submit a generation. See [image chat and storage](./docs/guides/multimodal-chat-user-guide.md).
- Pagelet discovers connections with visible note sources. Its **Discuss in Chat** action prepares a new conversation for you to inspect and send; discovery itself does not modify notes. See the [Pagelet guide](./docs/guides/pagelet-user-guide.md).
- Explicit `@blog2ghost` prepares the selected note for Ghost on desktop. Preparation may save a Ghost draft or upload required media; first publication is completed in Ghost by you. Updates/restoration retain confirmation for the exact checked candidate. See the [Ghost workflow](./skills/blog2ghost/SKILL.md).

### 9. FAQ

- **The banner stays after I added a token** — wait for the settings save to finish; the open chat view refreshes when settings change.
- **An old command or right-click plugin manager disappeared** — those legacy controls were retired. Use Obsidian's own plugin/theme settings; see [historical demos](./docs/guides/historical-demos.md).
- **The first answer is slow or Memory is still preparing** — inspect the connection and Memory status. Provider latency and background preparation vary; no fixed completion time is promised.

## Update Plugins

Retired before 3.0.4. PA no longer registers the plugin updater. Use Obsidian's community-plugin settings. [Historical demos](./docs/guides/historical-demos.md) document older releases.

## Update Themes

Retired before 3.0.4. Use Obsidian's appearance settings to manage themes. [Historical demos](./docs/guides/historical-demos.md).

## Switch On/Off Plugins

Retired before 3.0.4, including the PA icon's old right-click plugin manager. Existing installed plugins and their state are preserved. Use Obsidian's settings. [Historical demos](./docs/guides/historical-demos.md).

## Obsidian Callouts

### 1. Description

Callouts are blockquotes with a format, shape, and color, adding extra annotation information to document content, such as reminders, warnings, notes, etc. Callouts originated from Microsoft Office and have been widely adopted; Obsidian also supports Callouts in Markdown syntax as shown below:

```md
> [!info] Info
> Contents
```

To help with writing and recording in Obsidian and reducing the complexity of inputting callouts syntax, the Personal Assistant plugin automatically scans and displays all callout styles supported by Obsidian (including user-customized callout styles via CSS Snippets) and also supports fuzzy search for quick location.

### 2. Use

Run **List callout for quickly insert** from the command palette, search for a style, and select it. Paste the copied callout markup into the note and edit the content. This local operation does not require a model. Older recordings are in [historical demos](./docs/guides/historical-demos.md).

### 3. Configuration

The auto-quick input of callouts feature currently has no configuration options. If you have good ideas, feel free to submit an [issue](https://github.com/edonyzpc/personal-assistant/issues) for discussion.

## Local Graph

### 1. Description

Following the Zettelkasten methodology, notes are essentially not a "technique," but a "process," a way to store and organize knowledge, expand memory, and generate new connections and ideas. Simply put, it involves collecting knowledge that interests you or that you may find useful in the future, and then processing these notes in a standardized way to create links between them. For more on note systems, you can refer to my other article: [My PKM System](https://www.edony.ink/my-pkm/).

Obsidian's Local Graph helps users view the relationships between the current note and other notes. The Personal Assistant aids in automating the display of the current note's Graph View, allowing for better structural organization and thought.

### 2. Use

Open a note, then run **hover local graph** from the command palette. Assign your own shortcut in Obsidian if useful. Graph rendering relies on Obsidian's graph capability and requires no AI model. [Historical demos](./docs/guides/historical-demos.md) show older layouts.

The default desktop popover presentation also requires the **Hover Editor** plugin, because PA uses its convert-to-popover command. Install/enable that dependency, or choose the ordinary graph presentation in PA's local-graph settings. Mobile does not use the desktop popover conversion.

### 3. Configuration

The Local Graph feature of the Personal Assistant plugin provides configuration options consistent with Graph View. The configurable items include:

- Depth: the depth of the relationship with the current note;
- Show Tags: whether to display tags in the Graph View;
- Show Attachment: whether to display attachments in the Graph View;
- Show Neighbor: whether to display neighboring notes in the Graph View;
- Collapse: whether to collapse the configuration window;
- Auto Local Graph Colors: whether to automate setting node colors in Graph View;
- Enable Graph Colors: whether to customize Graph View colors. You can add color configurations based on dimensions like directory, type, tag, etc.

## Records in Specific Catalog

Obsidian's Daily Notes feature allows users to associate records with dates (such as Todo Lists, diaries, etc.). However, during daily thought records, there's a scenario for themed inspiration notes (like inspiration notes, idea memos, theme reviews, themed thoughts, etc.). I call these fleeting thoughts.

Use Quick Capture to save a thought, and Records Preview to browse a configured folder. The former startup-recording command is retired; it is not the current capture entry.

### Create Records with Templates

Run **PA: Quick Capture**, enter your text, check the displayed destination, and save. Settings let you choose the daily note, an inbox, or the current note. Local capture needs no model. Optional AI post-processing is a separate, default-off setting and may send the captured text to the configured provider.

Configure templates for new records in PA's **Note Template** setting, or leave it empty to use the built-in default. Templates support the built-in placeholders; Templater scripts are not executed. The old `note record` demonstration does not describe the current command; see [historical demos](./docs/guides/historical-demos.md).

### Preview Record in One Tab

#### 1. Description

Reflecting on and organizing inspiration records requires a centralized place for browsing and review. The Personal Assistant provides a one-click preview of themed inspiration records, allowing quick browsing of themed records with the option to jump to a specific file for detailed organization.

#### 2. Use and configuration

Set the record folder and preview limit in PA settings, then run **Preview records from configured folder**. Open an item to continue editing the original note. No model is required. See [historical demos](./docs/guides/historical-demos.md) for older recordings.

## Show Statistics

### 1. Description

To encourage daily thought recording, the Personal Assistant provides a statistics dashboard for writing activity and vault composition. It includes overview totals, daily writing activity, growth trends, and composition metrics. By default, Statistics history is stored in local Obsidian app storage on the current device; optional sync can create vault-visible history files for your normal vault sync workflow.

### 2. Use

Run **Show statistics** from the command palette. The dashboard has four views:

1. Overview;
2. Daily;
3. Growth;
4. Composition;

### 3. Configuration

The Show Statistics function of the Personal Assistant plugin exposes these settings:

1. Show Statistics: the default dashboard view;
2. Sync statistics history across devices: optional vault-visible history files for cross-device sync;
3. Animation: enable or disable animated dashboard rendering.
No AI model is required. [Historical demos](./docs/guides/historical-demos.md) contain the previous appearance.

## AI Summary and sharing

- Open a note and run **AI Summary** to request a summary with the configured Chat provider; note text is sent for that task.
- **AI Featured Images** generates an illustration through a compatible image service. It needs image-service configuration and credits, separately from image input in Chat.
- **Share Selection as Card** turns selected content into a shareable layout; it is not model image generation. Local text layout needs no model. Content with remote image references can cause requests to those image hosts.

## Update Metadatas

The old automatic frontmatter updater and its command/settings were retired before 3.0.4. Existing note properties remain. Explicit Chat property-update requests are a separate current capability, governed by the note-action boundary above. [Historical demos](./docs/guides/historical-demos.md).

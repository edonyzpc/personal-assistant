<h1 align="center">Personal Assistant</h1>

<p align="center"><strong>Capture lightly. Let the right notes return when they matter.</strong></p>
<p align="center">An open-source AI assistant for Obsidian. Rediscover old notes, find new connections,<br/>and turn your reading and thinking into work you can keep and share.</p>

<p align="center">
  <a href="https://github.com/edonyzpc/personal-assistant/releases"><img src="https://img.shields.io/github/v/release/edonyzpc/personal-assistant?color=%23000000&amp;label=Version&amp;logo=tga&amp;logoColor=%23008cff&amp;style=social" alt="Latest stable release" /></a>
  <a href="https://github.com/edonyzpc/personal-assistant/releases"><img src="https://img.shields.io/github/downloads/edonyzpc/personal-assistant/total?logo=obsidian&amp;logoColor=%23b300ff&amp;style=social" alt="Total GitHub release asset downloads" /></a>
  <a href="https://github.com/edonyzpc/personal-assistant/stargazers"><img src="https://img.shields.io/github/stars/edonyzpc/personal-assistant?style=social" alt="GitHub Stars" /></a>
</p>

<p align="center">
  <a href="#get-started"><strong>Install and get started</strong></a> ·
  <a href="#see-pa-in-action">See PA in action</a> ·
  <a href="./Manual.md">Manual</a> ·
  <a href="./README-CN.md">中文</a>
</p>

> **Version note:** This README follows current `master`, prepared for the next stable release. The released version in the community directory may not yet include the same interface or capabilities. Requires Obsidian **1.11.4+**. To try these changes early, see [building from source](#development-and-contributing).

## See PA in action

**From a few old notes to something new.** Pagelet brings back connections worth exploring while you read. Continue in Chat, shape your material into an article with Writing, create an illustration with CreateImage, then save your work or make a shareable card.

<!-- PA-MEDIA:S1:START -->
<table width="100%"><tr><td align="center">
  <strong>Product overview and demo video · Media placeholder</strong><br/>
  Source notes, an illustrated article, and the PA workspace show how past reading becomes new work.<br/>
  A large, real interface image and a video link will go here.
</td></tr></table>
<!-- PA-MEDIA:S1:END -->

Want to try the story yourself? [Copy the demo notes and prompts](./docs/guides/reading-to-sharing-demo.md#english). You can also start with any of the capabilities below.

---

## Let past notes help with today's thinking

Tell **PA Agent** what you want to do: compare reading notes, find different perspectives in a project, or turn scattered material into an outline. **Chat** helps you understand the content in front of you. Once **Memory** is prepared, earlier notes can inform the answer too, with returned source links taking you back to the originals.

> Find my notes about putting reading into practice. Compare the experiences they describe, suggest an angle for this short article, and list the sources you used.

When you want to put the result into your vault, explicitly ask PA to create, append, edit, or update note properties. Say “show me a preview first” if you want to review a proposed change.

<!-- PA-MEDIA:S4:START -->
<table width="100%"><tr><td align="center">
  <strong>Chat and Memory · Media placeholder</strong><br/>
  A current question, different perspectives from old notes, and a useful synthesis with source links.
</td></tr></table>
<!-- PA-MEDIA:S4:END -->

[Chat and note actions](./Manual.md#ai-chat) · [Memory setup](./Manual.md#7-memory-integration)

## Find connections worth following while you read

**Pagelet** starts from the note you are using and looks for connections supported by your material. With background discovery and proactive hints enabled, useful findings can surface while you read. You can also run **Pagelet: Discover connections** to look for them yourself.

Open an insight, read its sources, then select **Discuss in Chat** to explore it with PA. You review the prepared material and send the question. Discovery itself does not change your notes, and a new finding is not guaranteed every time.

<!-- PA-MEDIA:S3:START -->
<table width="100%"><tr><td align="center">
  <strong>Proactive Pagelet insights · Media placeholder</strong><br/>
  A real hint during reading, a specific connection with sources, and the Discuss in Chat action.
</td></tr></table>
<!-- PA-MEDIA:S3:END -->

[Explore Pagelet](./docs/guides/pagelet-user-guide.md)

## Turn ideas into something you can share

Type **`@`** in Chat and choose a task to keep working with your material.

| Task | What you can do |
| --- | --- |
| **`@Writing`** | Turn reading notes into an article, review and revise drafts, then confirm saving one as a note. |
| **`@CreateImage`** | Generate an illustration, edit a selected image, and choose a note to save it to. Requires a supported image service. |
| **Share Card** | Make a card from Chat, Pagelet, or selected note text. You can also run **Share Selection as Card** from the command palette. Card layout itself does not require an image-generation model. |

<!-- PA-MEDIA:S7:START -->
<table width="100%"><tr><td align="center">
  <strong>Image generation and editing · Media placeholder</strong><br/>
  A real image task, the complete generated result, and the edit and save actions.
</td></tr></table>
<!-- PA-MEDIA:S7:END -->

<!-- PA-MEDIA:S8:START -->
<table width="100%"><tr><td align="center">
  <strong>A result ready to share · Media placeholder</strong><br/>
  A real Share Card made from an article excerpt, showing its typography and finished layout.
</td></tr></table>
<!-- PA-MEDIA:S8:END -->

Chat also lets you ask questions about images. **Understanding images and generating them are separate capabilities**, each requiring a model or connection that supports it. [Images, writing, and saving your work](./docs/guides/multimodal-chat-user-guide.md)

## Capture thoughts and revisit what you have built

<a id="all-capabilities"></a>

| What you want to do | PA tools |
| --- | --- |
| Capture a thought quickly | **Quick Capture** saves to a daily note, inbox, or current note. Basic capture needs no AI. |
| Browse your records in one place | **Records Preview** shows records from your configured folder and links back to the originals. |
| See how your writing and vault change | **Statistics** shows an overview, daily writing, growth, and composition. No AI required. |
| Make notes easier to read | Insert **Callouts** and view a **local graph**. Desktop graph popovers need Hover Editor; a standard graph view is also available. |
| Add a summary or featured image | **AI summaries** use a Chat service; **AI featured images** use a compatible image service. |
| Keep useful personal context | **Personal Memory and style reference** are available when their settings and consent conditions allow. Review or correct information, pause its use, or forget it in Memory settings. |

Publish on Ghost? The desktop **`@blog2ghost`** workflow can prepare article drafts and media with your configured Ghost credentials. First publication happens in Ghost; updating an existing article requires confirmation of the version you have checked. [Ghost workflow](./skills/blog2ghost/SKILL.md)

[Full user manual](./Manual.md)

---

<a id="try-one-note"></a>

## Get started

**Before you connect: data and costs.** Depending on the task, Chat sends your question and permitted note, image, or tool context to your chosen provider. Memory is enabled by default: after configuration, your first Chat may prepare eligible notes in the background. Later updates and Pagelet automatic discovery may also use AI credits. Before your first request, review **Notes & privacy → Notes PA can use**. These scope rules do not automatically identify sensitive content, and a local index does not mean all processing is local. To try Chat alone first, you can turn off **Use memory from my notes** and Pagelet background discovery.

1. **Install PA.** In Obsidian, open **Settings → Community plugins → Browse** and search for **Personal Assistant** by **edonyzpc**. [Open the plugin directory](https://obsidian.md/plugins?id=personal-assistant) · [View releases](https://github.com/edonyzpc/personal-assistant/releases). Features being prepared for release require the matching build described in the version note above.
2. **Connect an AI service.** Open **PA settings → AI connection → Add default service**, choose a service, enter its API Key, and save. Start with Chat; configure note retrieval or image generation when you want those capabilities.
3. **Open a note and start.** Click PA's ribbon icon or run **Open PA Agent**. Select **My notes**, then ask the question below.

> Which idea in this note is most worth developing? Suggest one small experiment I can try today and explain what in the note supports it. Discuss first; do not edit the note.

Need something to try? Use the [fictional example notes](./docs/guides/reading-to-sharing-demo.md#english). Check that the answer draws on the original, then decide whether to follow up, enable Memory, or explore Pagelet and creative tasks.

[Setup and troubleshooting](./Manual.md#ai-chat) · [Data, network, and dependencies](./docs/operations/network-and-dependencies.md)

## Frequently asked questions

<details>
<summary><strong>Does PA cost money? Which AI services can I use?</strong></summary>

PA is an open-source plugin. AI usage costs depend on your chosen provider and account. You can configure OpenAI, DashScope China/International, and compatible custom Chat services, with different connections for different tasks. Chat, tools, image understanding, note retrieval, and image generation each need appropriate model support.

Custom Chat uses an OpenAI-compatible Chat Completions interface. OpenAI image generation/editing accepts only the official `https://api.openai.com/v1` endpoint; Wan uses its supported DashScope endpoints. Custom Chat/retrieval compatibility does not imply image-generation support. [Connection setup](./Manual.md#3-configuration)

</details>

<details>
<summary><strong>How are my notes, images, and personal memories used?</strong></summary>

Your notes stay in your own Obsidian vault. AI tasks may send relevant, permitted content to the configured provider; preparing Memory may also send note text. Image tasks send the necessary descriptions and selected reference images. Retrieving generated images and remote images used in Share Cards also involves network requests.

When enabled and its consent conditions are met, **AI Memory Extraction** can learn personal context from your messages and use Chat credits. You can inspect, correct, or forget it in Memory settings; disabling extraction does not delete information already saved. Note scope, background discovery, and Memory have their own controls. [Full disclosure](./docs/operations/network-and-dependencies.md) · [Memory controls](./Manual.md#7-memory-integration)

</details>

<details>
<summary><strong>Can PA change my notes directly?</strong></summary>

Discussion and Pagelet discovery do not themselves edit notes. An explicit create, append, edit, or property-update request can execute directly; ask for a preview if you want to check first. Writing saves, image saves, and the Ghost workflow have their own explicit actions and confirmation steps. Supported completed note changes can be undone; Undo stops if it would overwrite later edits. [Action boundaries](./Manual.md#6-web-search-and-note-actions)

</details>

<a id="mobile-vss-validation-note"></a>

<details>
<summary><strong>Does PA work on desktop and mobile?</strong></summary>

PA supports desktop and mobile, with limits for individual capabilities. Ghost is desktop-only; graphs on mobile do not use desktop popovers. Historical Memory app validation covers desktop and iOS; **Android Memory has not completed physical-device validation**. Chat history stays on the current device and does not sync across devices with the vault. Image input, generation, and model compatibility depend on the service. [Images and sync](./docs/guides/multimodal-chat-user-guide.md)

</details>

<details>
<summary><strong>Do I need to prepare Memory again after changing its model?</strong></summary>

Changing the retrieval model or dimensions may require preparation, but compatible existing configurations can be reused. Different retrieval configurations keep their own device-local indexes; inactive configurations receive no paid background maintenance. Switching alone does not mean uploading or rebuilding the whole vault. [Memory setup](./Manual.md#7-memory-integration)

</details>

<details>
<summary><strong>Where are voice features and the old plugin-management tools?</strong></summary>

Voice is still planned, with no available workflow or promised date. Plugin/theme updates, plugin on/off commands, the old Memos entry, and metadata auto-update are retired. [Historical demos](./docs/guides/historical-demos.md) retain their original context.

</details>

## Help make PA better

Share **what you wanted to do, where you got stuck, and what would help** in [Issues](https://github.com/edonyzpc/personal-assistant/issues). Please do not post API keys or private notes. If PA is useful to you, consider [starring the project](https://github.com/edonyzpc/personal-assistant).

[Manual](./Manual.md) · [More guides](./docs/guides/README.md) · [Changelog](./CHANGELOG.md) · [BRAT beta testing](./docs/operations/brat-beta-testing.md)

---

## Development and contributing

Start with the [development guide](./DEVELOPEMENT.md) and [project documentation](./docs/index.md). The README plan, storyboard, capture checklist, and placeholder replacement instructions live in the [media production guide](./docs/development/workflows/readme-media-production.md).

<a id="install-and-configure-chat"></a>

<details>
<summary><strong>Build from current source and install manually</strong></summary>

With Node.js 22 LTS and npm 10 or 11, run the following in a checkout containing the changes you want to try:

```sh
npm ci
npm run build
```

Copy `dist/main.js`, `dist/manifest.json`, and `dist/styles.css` together into `<vault>/<config-dir>/plugins/personal-assistant/`, then reload or enable PA. The default config directory is `.obsidian`. For a manual stable installation, use all three files from the [same release](https://github.com/edonyzpc/personal-assistant/releases). An older source revision or release does not gain the new interface through these steps.

</details>

Created by [edony](https://github.com/edonyzpc). Thanks to the [upstream projects and contributors](./THIRD_PARTY_NOTICES.md). Client source uses **AGPL-3.0-only** from 2.8.0; historical releases retain their original terms. PA's name, icons, and market identity have separate trademark terms.

[LICENSE](./LICENSE) · [NOTICE](./NOTICE) · [Third-party notices](./THIRD_PARTY_NOTICES.md) · [Trademarks](./TRADEMARKS.md) · [Network and dependency disclosures](./docs/operations/network-and-dependencies.md)

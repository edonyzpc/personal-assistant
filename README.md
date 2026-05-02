# Obsidian Personal Assistant

<p align="center">
    <span>An Obsidian plugin which help you to automatically manage Obsidian.</span>
    <br/>
    <a href="/Manual-CN.md">中文手册</a>
    ·
    <a href="/Manual.md">Manual</a>
    <br/>
    <img alt="Tag" src="https://img.shields.io/github/v/tag/edonyzpc/personal-assistant?color=%23000000&label=Version&logo=tga&logoColor=%23008cff&sort=semver&style=social" />
    <img alt="Downloads" src="https://img.shields.io/github/downloads/edonyzpc/personal-assistant/total?logo=obsidian&logoColor=%23b300ff&style=social" />
</p>
<p align="center" style="font-size:15px;color:gray">
 <mark><b><span style="font-size:18px;">💯</span>Tips</b></mark>: If you are not a developer, please refer to the manual for optimal use.
</p>

> ***NOTE***: New shiny feature: Support an LLM chat assistant that can use Memory from your notes. Before preparing memory, the assistant explains data flow, AI provider usage, and possible cost, then asks for your approval.

<div align="center">

https://github.com/user-attachments/assets/bbf8021c-9e94-4ba3-8e11-dc95be8b288d

</div>

---
> Supporting featured image generation by AI according to the content of the note.
<div align="center">
	
https://github.com/user-attachments/assets/aa246889-0c32-4ce5-bde1-32eba813d034

</div>

---
> ***AI Helper to improve your Obsidian notes management***
<div align="center">
<img src="./docs/Personal-Assitant-With-AI.gif" alt="personal assistant support AI"/>
</div>

> ***Animation rendering statistics***
<div align="center">
<img src="./docs/personal-assistant-v1.3.6.gif" alt="usage video"/>
</div>

<div align="center">
<img src="./docs/personal-assistant-v1.3.1.gif" alt="usage video"/>
</div>

> ***Preview records***
<div align="center">
<img src="./docs/personal-assistant-v1.2.4.gif" alt="usage video"/>
</div>

> ***List callout***
<div align="center">
<img src="./docs/personal-assistant-v1.3.2.gif" alt="usage video"/>
</div>

> ***Update metadata***
<div align="center">
<img src="./docs/personal-assistant-v1.2.0.gif" alt="usage video"/>
</div>

> ***Update Plugins and Themes***
<div align="center">
<img src="./docs/personal-assistant-v1.1.6.gif" alt="usage video"/>
</div>

> ***Basic Usage***
<div align="center">
<img src="./docs/personal-assistant-v1.1.1.gif" alt="usage video"/>
</div>

## Features
> ***NOTE***: The currently supported features are all from my personal needs, feature request is welcome by submitting issues.

1. automatically create note in the specified directory with the configured file name
2. automatically open current note related graph view
3. automatically open Memos like quick note in macOS
4. switch on/off plugin in command palette
5. automatically update plugins with one command
6. automatically update themes with one command
7. automatically set color of graph view
8. list all callouts css configuration for quickly inserting
9. chat with AI using Memory from your notes, or answer immediately without reading memory

## Develop

Please reference [HERE](./DEVELOPEMENT.md).

### Memory preparation performance note

Since `1.6.4`, rebuilding Memory batches note chunks across files and uses provider-aware embedding limits instead of a fixed per-file delay. Qwen `text-embedding-v4` / `text-embedding-v3` rebuilds send up to 10 chunks per request with token-aware throttling and retry feedback. The long-running Memory notice now reports live progress such as scanning notes, embedding chunks, writing the index, retrying, and ready.

Manual "Update memory" keeps the safer per-file refresh path for now, but it also reports file-level progress and still skips unchanged notes before calling the embedding provider. Sharing the global rebuild batching pipeline with refresh is planned as a later large-vault optimization.

### VSS SQLite/WASM dependency note

The local VSS SQLite backend uses `@sqliteai/sqlite-wasm` pinned to `3.50.4-sync.0.8.30-vector.0.9.23`. Before publishing a release with this backend, review the upstream package license and release terms for your distribution scenario.

### Mobile VSS validation note

The local VSS SQLite/WASM backend has been smoke-tested on Obsidian Desktop and Obsidian iOS with the test vault, including rebuild, refresh, reload persistence, chat, and Memory references. Android has not been fully validated on a physical device yet because no Android test device is currently available, so Android VSS support should be treated as pending verification.

## Install
Now Personal Assistant plugin is available in [plugin market](https://obsidian.md/plugins?search=personal%20assistant#), you can install this plugin directly within Obsidian App, please check this [mannual](https://help.obsidian.md/Extending+Obsidian/Community+plugins#Install+a+community+plugin) to get more details.
![install with plugin market](./docs/install-within-plugin-market.png)

### Install
- Download from the release

### Install with BRAT

- Install BRAT from the Community Plugins in Obsidian
- Open the command palette and run the command BRAT: Add a beta plugin for testing
- Copy `https://github.com/edonyzpc/personal-assistant` into the modal that opens up
- Click on Add Plugin -- wait a few seconds and BRAT will tell you what is going on
- After BRAT confirms the installation, in Settings go to the **Community plugins ** tab.
- Refresh the list of plugins
- Find the beta plugin you just installed and Enable it.

### Manually Install

- Build with commandline: `npm install && npm run build` or download from [release page](https://github.com/edonyzpc/personal-assistant/releases)
- Copy over `main.js`, `styles.css`, and `manifest.json` to your vault `{VaultFolder}/.obsidian/plugins/personal-assistant/`.

## Use

### 1. Create note in specificed directory
- Open the command palette and find the command
![command 1](./docs/command-1.png)
- New note is created and start your recording
- [***Recommendation***] Use `Folder Templates` of plugin [Templater](https://github.com/SilentVoid13/Templater) to format the created notes by the command above, the example is as following
![folder templates](./docs/folder-templates.png)
### 2. Open memos in hover editor
- Open the command palette and find the command
![command 2](./docs/command-2.png)
- Do anything you like in memos
### 3. Open graph view of current note
- Open the command palette and find the command
![command 3](./docs/command-3.png)
- Open setting tab for more customize
- Navigate your current note graph view with backlink and outgoing link
- configure color of graph view

### 4. Enable/Disable plugins for obsidian with one command
- Open the command palette and find the command
![command 5](./docs/command-5.png)
- Select the suggestion to enable/disable plugin(or you can search the plugin by its name)
- [***Note***] In suggestion tab, the green checkbox means plugin is already enabled and the red uncheckbox means plugin is already disabled

### 5. Update plugins for obsidian with one command
- Open the command palette and find the command
![command 6](./docs/command-6.png)
- Trigger the command to update plugins
- See the updating result which is displayed in the right corner

## Attribution
- Best thanks for project [obsidian-advanced-new-file](https://github.com/vanadium23/obsidian-advanced-new-file) for the code of `createNote`, `createDirectory`
- Best thanks for project [obsidian-callout-manager](https://github.com/eth-p/obsidian-callout-manager) for the `class CalloutPreviewComponent` and `color.ts`
- Best thanks for project [better-word-count](https://github.com/lukeleppan/better-word-count) for the `package stats`

## Contact

If you've got any kind of feedback or questions, feel free to reach out via [GitHub issues](https://github.com/edonyzpc/personal-assistant/issues).

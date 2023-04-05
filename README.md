# Obsidian Personal Assistant

<p align="center">
    <span>An Obsidian plugin which help you to automatically manage Obsidian.</span>
    <br/>
    <a href="/README-CN.md">简体中文</a>
    ·
    <a href="/README.md">English</a>
</p>

## Features
> ***NOTE***: The currently supported features are all from my personal needs, feature requested is welcome by submitting issues.

1. automatically create note in the specified directory with the configured file name
2. automatically update plugins(WIP, working-in-progress)
3. automatically update themes(WIP)

## Develop

Please reference [HERE](./DEVELOPEMENT.md).

## Install
> ***NOTE***: Now this plugin is not submit to Obsidian plugin market.

### Install
- Download from the release

### Install with BRAT

- Install BRAT from the Community Plugins in Obsidian
- Open the command palette and run the command BRAT: Add a beta plugin for testing
- Copy `https://github.com/edonyzpc/obsidian-plugins-mng` into the modal that opens up
- Click on Add Plugin -- wait a few seconds and BRAT will tell you what is going on
- After BRAT confirms the installation, in Settings go to the **Community plugins ** tab.
- Refresh the list of plugins
- Find the beta plugin you just installed and Enable it.

### Manually Install

- Build with commandline: `yarn install && yarn build` or download from [release page](https://github.com/edonyzpc/obsidian-plugins-mng/releases)
- Copy over `main.js`, `styles.css`, `manifest.json` to your vault `{VaultFolder}/.obsidian/plugins/obsidian-plugins-mng/`.

## Use

### 1. Create note in specificed directory
- Open the command palette and find the command
![command 1](./docs/command-1.png)
- New note is created and start your recording
### 2. Open memos in hover editor
- Open the command palette and find the command
![command 2](./docs/command-2.png)
- Do anything you like in memos
### 3. Open graph view of current note
- Open the command palette and find the command
![command 3](./docs/command-3.png)
- Open setting tab for more customize
- Navigate your current note graph view with backlink and outgoing link
### 4. Enable/Disable plugins for obsidian with one command
- Open the command palette and find the command
![command 4](./docs/command-4.png)
- Select the suggestion to enable/disable plugin

## Contact

If you've got any kind of feedback or questions, feel free to reach out via [GitHub issues](https://github.com/edonyzpc/obsidian-plugins-mng/issues).
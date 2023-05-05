# Obsidian Personal Assistant

<p align="center">
    <span>An Obsidian plugin which help you to automatically manage Obsidian.</span>
    <br/>
    <a href="/README_cn.md">简体中文</a>
    ·
    <a href="/README.md">English</a>
</p>

<div align="center">
<img src="./docs/personal-assistant-v1.1.1.gif" alt="usage video"/>
</div>

## 功能特性
> ***注意***: 当前支持的特性都是出于我个人使用 Obsdiain 的需求，欢迎提交你们期望的功能特性需求。

1. 在指定目录自动创建 note，note 名称可以格式化配置方便管理
2. 自动打开当前 note 的关系视图
3. 像 macOS 的快速备忘录一样使用 Memos 做记录
4. 在命令面板中快速开关插件
5. 自动更新插件（正在进行中）
6. 自动更新主题（正在进行中）

## 研发

请参考[这里](./DEVELOPEMENT.md).

## 安装
> ***注意***: 该插件暂时还没有提交到 Obsidian 插件商城。

### 通过 BRAT 安装

- 在 Obsidian 中安装 BRAT 插件；
- 打开命令面板输入 BRAT 命令：`Add a beta plugin for testing`；
- 将字符串 `https://github.com/edonyzpc/personal-assistant` 拷贝到对话框中；
- 点击添加插件，等待 BRAT 自动下载插件文件；
- BRAT 提示安装完成之后在设置的插件页面查找安装号的插件；
- 刷新插件列表找到安装的插件；
- 使能该插件；

### 手动安装

- 通过源码编译: `yarn install && yarn build` 或者直接从 [release page](https://github.com/edonyzpc/personal-assistant/releases) 下载
- 将这些文件 `main.js`, `styles.css`, `manifest.json` 拷贝到 Obsidian 的插件目录 `{VaultFolder}/.obsidian/plugins/perosonal-assistant/`.

## 使用

### 1. 在指定目录自动创建 note
- 打开命令面板找到对应的命令
![command 1](./docs/command-1.png)
- note 自动创建并打开，此时可以直接开始你的记录了
- 【***推荐***】使用 [Templater](https://github.com/SilentVoid13/Templater) 插件的 `Folder Templates` 配置 note 模版，从而实现目录级别的模版自定义
### 2. 在 hover 打开 memos
- 打开命令面板找到对应的命令
![command 2](./docs/command-2.png)
- 开始你的 memos 之旅
### 3. 打开当前笔记的关系图
- 打开命令面板找到对应的命令
![command 3](./docs/command-3.png)
- 插件的设置中有更多设置选项，包括深度、展示标签等
- 查看包括 backlink 和 outgoing-link 关系图
### 4. 开关插件
- 打开命令面板找到对应的命令
![command 4](./docs/command-5.png)
- 选择你要开关的插件，该命令支持根据插件名检索
- 【***注意***】插件选择界面中，插件名前面绿色的 checkbox 代表插件已经打开，红色的 uncheckbox 代表插件已经关闭

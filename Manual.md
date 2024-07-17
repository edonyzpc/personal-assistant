# Personal Assistant Plugin Manual
## Background

When it comes to note-taking tools, I greatly admire Obsidian CEO Kepano's concept — [File Over App](https://twitter.com/kepano/status/1675626836821409792?s=20). My thoughts on using the Obsidian note-taking tool are quite similar. As a tool, Obsidian should help me focus exclusively on one thing — recording my thoughts while it takes care of everything else.

A good recording system shouldn’t require extensive time for maintenance. Once a record-keeping system needs continuous "periodic" maintenance, it defeats the purpose of recording since the maintenance itself adds no value and merely consumes time. Hence, the ideal scenario is having no upkeep and management at all. Though this is an ideal condition, I strive to minimize the time cost of maintenance — automation is a great solution.

Obsidian users who want to take good notes would prefer to spend their time recording and thinking, not managing. Therefore, when using Obsidian, they often have a similar expectation — **spend less time on management and more on recording and thinking**. In addressing this need, a plugin that automates these management tasks becomes very valuable.

This is the reason I developed the Personal Assistant plugin. The Personal Assistant plugin is an Obsidian platform plugin focused on helping you record more ideas and inspirations and better review your past notes, primarily through automation (reducing interactions, one-click management tasks), while also supporting plenty of personalized configurations and multi-plugin interactions.

## Update Plugins

### 1. Description

The biggest advantage of Obsidian lies in its community-supported custom plugins. With nearly 2000 plugins available, every Obsidian user will need to manage them, especially for periodic updates. To reduce interactions and lower Obsidian's management cost, the Personal Assistant plugin supports one-click plugin updates.

### 2. Demo

As shown in the video below, you can automate the plugin update process by entering `update plugins` in the Command Palette.

### 3. Configuration

The auto-update plugins feature currently has no configuration options. If you have good ideas, feel free to submit an [issue](https://github.com/edonyzpc/personal-assistant/issues) for discussion.

## Update Themes

### 1. Description

A good tool should not only excel in functionality but also be aesthetically pleasing, making it comfortable to use. Obsidian supports custom themes through its community, allowing users to choose their preferred UI. Currently, the community has around 155 themes, and every Obsidian user will need to manage them, especially for periodic updates to fix some UI flaws. To reduce interactions and lower Obsidian's management cost, the Personal Assistant plugin supports one-click theme updates.

### 2. Demo

As shown in the video below, you can automate the theme update process by entering `update themes` in the Command Palette.

### 3. Configuration

The auto-update themes feature currently has no configuration options. If you have good ideas, feel free to submit an [issue](https://github.com/edonyzpc/personal-assistant/issues) for discussion.

## Switch On/Off Plugins

### 1. Description

During my use of Obsidian, I often need to temporarily toggle plugins on or off, such as turning off the Telegram Sync plugin to stop syncing messages. To reduce interactions and lower Obsidian's management cost, the Personal Assistant plugin supports one-click plugin toggling.

### 2. Demo

As shown in the video below, you can automate the process of turning plugins on or off by entering `switch plugin` in the Command Palette. If there are many plugins, fuzzy search is supported to quickly locate the target plugin to toggle.

### 3. Configuration

The auto-toggle plugins feature currently has no configuration options. If you have good ideas, feel free to submit an [issue](https://github.com/edonyzpc/personal-assistant/issues) for discussion.

## Obsidian Callouts

### 1. Description

Callouts are blockquotes with a format, shape, and color, adding extra annotation information to document content, such as reminders, warnings, notes, etc. Callouts originated from Microsoft Office and have been widely adopted; Obsidian also supports Callouts in Markdown syntax as shown below:

```md
> [!info] Info
> Contents
```

To help with writing and recording in Obsidian and reducing the complexity of inputting callouts syntax, the Personal Assistant plugin automatically scans and displays all callout styles supported by Obsidian (including user-customized callout styles via CSS Snippets) and also supports fuzzy search for quick location.

### 2. Demo

As shown in the video below, you can automate the retrieval and preview of callout styles by entering `list callouts` in the Command Palette. If there are many callout styles, fuzzy search is supported for quick location of the target callouts. Upon pressing Enter, the Personal Assistant plugin will automatically copy the style to the system clipboard, allowing users to simply `Ctrl/CMD + V` paste it at the needed document location, thus focusing on editing the content they need.

### 3. Configuration

The auto-quick input of callouts feature currently has no configuration options. If you have good ideas, feel free to submit an [issue](https://github.com/edonyzpc/personal-assistant/issues) for discussion.

## Local Graph

### 1. Description

Following the Zettelkasten methodology, notes are essentially not a "technique," but a "process," a way to store and organize knowledge, expand memory, and generate new connections and ideas. Simply put, it involves collecting knowledge that interests you or that you may find useful in the future, and then processing these notes in a standardized way to create links between them. For more on note systems, you can refer to my other article: [My PKM System](https://www.edony.ink/my-pkm/).

When reviewing notes using Obsidian, the Graph View is an excellent tool to help structure and think through each note, eventually forming one's own knowledge. Below is a screenshot of my Obsidian Global Graph View:

Obsidian's Local Graph helps users view the relationships between the current note and other notes. The Personal Assistant aids in automating the display of the current note's Graph View, allowing for better structural organization and thought.

### 2. Demo

As shown in the video below, you can automate the establishment and preview of the Local Graph View by entering `hover local` in the Command Palette. As this is one of my frequently used features, I have bound it to the shortcut `CMD + Shift + G` for one-click Local Graph View.

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

When a fleeting thought strikes, I need to quickly jot down the fleeting thoughts. These themed thoughts require automated structured content after recording because reflecting, organizing, and internalizing these inspirations is crucial. The Personal Assistant plugin addresses this need by automating, structuring records in designated folders, and providing one-click preview of themed inspiration records.

### Create Records with Templates

#### 1. Description

For fleeting thoughts, the Personal Assistant plugin provides an automated, structured recording feature in a specified directory, combined with the Templater plugin, allowing configuration of corresponding structured templates. This automation focuses on recording inspiration content.

#### 2. Demo

As shown in the video below, entering `note record` in the Command Palette automates the structured template creation for fleeting thoughts. The video also shows the configuration for the path and file format of fleeting thoughts and displays the Templater structured template used for creating these records.

#### 3. Configuration

The Note Record function of the Personal Assistant plugin offers two configuration items:

1. target path: the directory configuration for fleeting thought records
2. file format: the file format of fleeting thought records, convenient for other tools to handle automation (like identifying themes).

### Preview Record in One Tab

#### 1. Description

Reflecting on and organizing inspiration records requires a centralized place for browsing and review. The Personal Assistant provides a one-click preview of themed inspiration records, allowing quick browsing of themed records with the option to jump to a specific file for detailed organization.

#### 2. Demo

As shown in the video below, entering `preview record` in the Command Palette enables one-click viewing of fleeting thoughts records, while also allowing users to jump directly to the corresponding note file by clicking on the record of interest.

#### 3. Configuration

The Preview Record function of the Personal Assistant plugin provides one configuration item: setting the number of files to preview at once for the fleeting thoughts.

## Show Statistics

### 1. Description

To encourage daily thought recording, the Personal Assistant provides a word count display feature for daily records. The statistics mainly include the total number of files in the Vault (markdown files), the number of words recorded each day, and the total page count, assuming 300 words per page. This both showcases Obsidian's statistics and serves as self-motivation to develop a daily recording and thinking habit.

### 2. Demo

As shown in the video below, entering `statistics` in the Command Palette automates the display of the current Obsidian Vault's statistics. It currently includes two statistics:

1. Daily word count and page count;
2. Total note count and page count in the vault;

### 3. Configuration

The Show Statistics function of the Personal Assistant plugin offers 3 configuration items:

1. show statistics: type of statistics to display, optional daily and total;
2. vault statistics file path: the path for the statistics file;
3. Number of words per page: the word count used for calculating page numbers.

## Update Metadatas

### 1. Description

Similar to Notion, Obsidian frontmatter can have various metadata for recording and displaying note remarks. Some metadata (like the current note's modification time) needs to be updated in real-time according to the note's status, saving the user from manual updates each time. Hence, the Personal Assistant provides an automated frontmatter metadata update feature.

### 2. Demo

As shown in the video below, entering `update metadata` in the Command Palette automates the frontmatter metadata update. To notify the user of the automated metadata update, there's a breathing icon in the bottom right corner.

### 3. Configuration

The Update Metadata feature of the Personal Assistant plugin offers 3 configuration items:

1. enable updating metadata: enable the automatic metadata update;
2. add key-value in frontmatter: add frontmatter metadata to be automatically updated, currently supporting two data types: string and timestamp;
3. metadata updating exclude path: configure directories to exclude from metadata updates, with multiple paths separated by commas.


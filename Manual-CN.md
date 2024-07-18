# Personal Assistant 插件使用手册
## 背景
关于笔记工具类产品我非常欣赏 Obsidian CEO Kepano 的理念 —— [File Over App](https://twitter.com/kepano/status/1675626836821409792?s=20)，我对使用 Obsidian 笔记工具有类似的思考。作为工具，Obsidian 唯一需要做的是帮助我在记录时只需要关心一件事情——记录思考，剩下的由工具本身帮我完成。因为任何一个好的记录系统都不应该耗费大量的时间去维护，一旦需要不断地「定期」维护一个记录系统，那么就违背了记录的初衷，因为记录系统维护和管理本身并不能产生太大的价值除了耗费时间，所以最理想的情况就是完全没有维护和管理，当然这是理想情况，所以我力求尽可能压缩维护管理的时间成本 —— 自动化是一个好办法。

想做好笔记的 Obsidian 用户一定期望把自己的时间花在记录和思考上，所以在使用 Obsidian 的时候大多会有类似的期望 —— **少耗费时间来做管理，多把时间花在记录和思考上**。面对这样的需求的时候，如果有一个帮助自动化完成这些管理任务的插件，那么非常有价值。

以上就是我开发 personal assistant 插件的初衷，Personal Assistant 插件是一个 Obsidian 平台的插件，它聚焦在帮你记录更多想法与灵感以及更好回顾过往记录，主要的做法就是自动化（减少交互、一键完成管理任务），同时还支持很多个性化配置以及多插件联动。

## 更新插件功能
### 1. 简介
Obsidian 最大的优势就是社区化支持了自定义插件，目前已经接近2000个插件，每个 Obsidian 用户都会需要管理插件，特别是周期性检查升级插件。为了减少交互降低 Obsidian 管理成本，Personal Assistant 插件支持一键升级插件。

### 2. 示例
如下视频所示，演示了如果通过命令面板（Command Palette）输入 `update plugins` 即可自动化完成插件的升级。


https://github.com/user-attachments/assets/e25804e5-007d-4951-b76a-d7076d25a5d1



### 3. 配置说明
自动升级插件功能目前还没有配置项，如果你有好的想法欢迎提交 [issue](https://github.com/edonyzpc/personal-assistant/issues) 交流。

## 更新主题功能
### 1. 简介
好的工具除了功能出众以外一定还具有很好的审美，让使用者用着舒服。Obsidian 通过社区化支持了自定义主题来帮助使用者选择自己喜欢的 UI，目前社区已经有接近155个主题，每个 Obsidian 用户都会需要管理主题，特别是周期性检查升级主题以修复一些 UI 的瑕疵。为了减少交互降低 Obsidian 管理成本，Personal Assistant 插件支持一键升级主题。

### 2. 示例
如下视频所示，演示了如果通过命令面板（Command Palette）输入 `update themes` 即可自动化完成主题的升级。


https://github.com/user-attachments/assets/3c6910d7-2790-4dd2-88b6-2721de473d35



### 3. 配置说明
自动升级主题功能目前还没有配置项，如果你有好的想法欢迎提交 [issue](https://github.com/edonyzpc/personal-assistant/issues) 交流。

## 开关插件功能
### 1. 简介
使用 Obsidian 的过程中我会有临时开关插件的需求，例如临时的将 Telegram Sync 插件关闭以停止同步消息等，为了减少交互降低 Obsidian 管理成本，Personal Assistant 插件支持一键开关插件。

### 2. 示例
如下视频所示，演示了如果通过命令面板（Command Palette）输入 `switch plugin` 即可自动化完成需要打开或着关闭的插件了，如果插件比较多的话还支持模糊搜索帮助快速定位到需要开关的目标。


https://github.com/user-attachments/assets/cfa64ee9-9b91-4469-abb7-13064b1458cc



### 3. 配置说明
自动开关插件功能目前还没有配置项，如果你有好的想法欢迎提交 [issue](https://github.com/edonyzpc/personal-assistant/issues) 交流。

## callouts 快捷输入功能
### 1. 简介
callouts 是一种带了格式、形状、颜色的 blockquote，为文档内容添加额外的注释信息例如提醒、告警、备注等。callouts 最早源自 Microsoft Office 后被广泛应用，Obsidian 也增加了 Markdown 语法支持 callouts，语法格式如下所示：
```md
> [!info] Info
> Contents

```

为了帮助 Obsidian 写作记录时减少输入 callouts 复杂的语法，Personal Assistant 插件自动检索并展示 Obsidian 支持的所有 callouts 样式（包括用户通过 CSS Snippets 自定义的 callout 样式），也支持模糊搜索帮助快速定位。

### 2. 示例
如下视频所示，演示了通过命令面板（Command Palette）输入 `list callouts` 即可自动化完成 callouts 样式的检索和预览，如果 callouts 样式比较多的话还支持模糊搜索帮助快速定位到目标 callouts，按下 Enter 键确认后 Personal Assistant 插件会自动将样式复制到操作系统的剪切板，用户只需在文档需要的位置 `Ctrl/CMD + V` 粘贴即可专注编辑自己需要的内容。


https://github.com/user-attachments/assets/dbd6d6be-54bb-4172-b023-1ff526a086c7



### 3. 配置说明
自动快捷输入 callouts 功能目前还没有配置项，如果你有好的想法欢迎提交 [issue](https://github.com/edonyzpc/personal-assistant/issues) 交流。

## local graph 功能
### 1. 简介
按照卢曼笔记法（Zettelkasten）的理念，笔记从本质上讲，它不是一种「技巧」，而是一个「流程」，一种存储和组织知识、扩展记忆以及生成新连接和想法的方法。简单来说，就是把你感兴趣或者觉得自己将来会用到的知识收集起来，然后用一种标准化的方式去处理这些笔记，建立笔记之间的联系，供你使用。关于笔记系统可以参考我的另外一篇文章：[我的 PKM 系统](https://www.edony.ink/my-pkm/)。

当我们利用 Obsidian 的做笔记回顾的时候，Graph View 就是一个非常好的工具帮助我们结构化整理和思考每篇笔记，最终形成自己的知识。如下图所示是我的 Obsidian 的 Global Graph View：
![image](https://github.com/user-attachments/assets/de3a97c6-8386-4766-afe4-1385d3dc689c)


Obsidian 的 Local Graph 可以帮助用户查看当前笔记与其他笔记的关系，Personal Assistant 帮助自动化展示当前笔记的 Graph View 从而能够更好的结构化整理和思考。

### 2. 示例
如下视频所示，演示了通过面板（Command Palette）输入 `hover local` 即可自动化完成 Local Graph View 的建立和预览，由于这个是我个人的常用功能，所以绑定了快捷键 `CMD + Shift + G` 进行一键查看 Local Graph View，


https://github.com/user-attachments/assets/8ad70c26-8ffb-44bc-9d1d-2c99053a3e47



### 3. 配置说明
Personal Assistant 插件的 Local Graph 功能提供了与 Graph View 一致的配置项，如下图可配置项目包括：
- Depth，与当前笔记关联关系的深度；
- Show Tags，Graph view 是否展示 Tag；
- Show Attachment，Graph view 是否展示附件；
- Show Neighbor，Graph view 是否展示近邻笔记；
- Collapse，是否折叠配置窗口；
- Auto Local Graph Colors，是否自动化设置 Graph view 节点颜色；
- Enable Graph Colors，是否进行 Graph view 颜色自定义配置，通过 `Add Color` 按钮增加颜色配置，可以是目录维度、类型维度、Tag 维度等进行颜色配置；
![image](https://github.com/user-attachments/assets/29a53342-a851-4158-8d80-686c97cd6a35)
![image](https://github.com/user-attachments/assets/87754ac8-814f-44cd-9d5c-c7007b1055cb)


## fleeting thoughts 记录功能
Obsidian 提供了 Daily notes 功能可以用作跟日期相关的记录（例如 Todo List，日记等），但是**日常做思考记录的时候会有一个场景：专题化的灵感记录（例如灵感记录，idea 备忘，主题回顾，专题思考等），我将它们称为 fleeting thoughts**。

面对一闪而过的灵感，我需要尽快的将 fleeting thoughts 记录下来，同时由于专题化的，所以一些结构化的内容需要自动化完成，灵感记录之后有一个很重要的步骤就是对灵感记录的反思整理以及内化，这就需要一个集中浏览和回顾的地方。针对上述专题化灵感记录的需求，Personal Assistant 插件提供自动化、结构化在指定目录创建记录的功能，同时还提供了一键预览专题化灵感记录的功能。

### 结构化创建 fleeting thoughts 记录
#### 1. description
针对 fleeting thoughts 记录场景，Personal Assistant 插件提供自动化、结构化在指定目录创建记录的功能，结合 Templater 插件为可以配置对应的结构化模版，自动化的创建笔记，让使用专注于记录灵感内容。

#### 2. demo
如下视频所示，演示了通过面板（Command Palette）输入 `note record` 即可自动化完成 fleeting thoughts 专题笔记的模版化创建，同时还展示了fleeting thoughts 的路径以及文件格式的配置，最后还展示了创建该笔记时用的 Templater 结构化模版。


https://github.com/user-attachments/assets/fe13b2e9-2f3b-497f-b2b5-b9ff08f57bf3



#### 3. configuration
Personal Assistant 插件的 Note Record 功能提供了两个配置项：
1. target path，fleeting thought 记录的目录配置
2. file format，fleeting thought 文件格式，方便其他工具自动化处理（例如识别专题）；
![image](https://github.com/user-attachments/assets/89254e0b-75ae-4df3-9323-ba97ba48fcfa)


### 一键预览 fleeting thoughts 记录
#### 1.description
对灵感记录的反思整理以及内化，这就需要集中浏览和回顾的需求，Personal Assistant 提供了一键预览专题化灵感记录的功能，快速浏览专题记录也支持跳转指定文件做详细的整理。

#### 2. demo
如下视频所示，演示了通过面板（Command Palette）输入 `preview record` 即可自动化完成 fleeting thoughts 专题笔记的一键预览，同时还可以针对感兴趣的记录通过点击的方式直接跳转到对应的笔记文件。


https://github.com/user-attachments/assets/e40ea7f2-24a6-4e0c-a204-fc252a3149e6



#### 3. configuration
Personal Assistant 插件的 Preview Record 功能提供了一个配置项：配置预览记录文件的数目即一次性预览多少个 fleeting thoughts 文件。
![image](https://github.com/user-attachments/assets/4472191a-5da4-4331-a224-0e46e1971061)


## 统计状态显示功能
### 1. description
为了督促每天记录思考，Personal Assistant 提供了每天记录字数展示的功能，统计状态主要包括 Vault 总文件数（markdown 文件）、每天记录的字数（words）、按照300 words 为一个 page 统计总共的 page 数。一方面展示一下 Obsidian 的统计状态，另外一方面也顺便鞭策一下自己养成每天记录和思考的习惯。

### 2. demo
如下视频所示，演示了通过面板（Command Palette）输入 `statistics` 即可自动化展示当前 Obsidian Vault 的统计状态，目前包括两个统计状态：
1. 每天记录的字数（word）和页数（page）；
2. vault 总共的笔记数量和页数；


https://github.com/user-attachments/assets/4fedeff6-6e81-45ae-8cd8-55cf0781d4fd



### 3. configuration
Personal Assistant 插件的 Show Statistics 功能提供了3个配置项：
1. show statistics，展示统计状态的类型，可选 daily 和 total；
2. vault statistics file path，statistics 统计文件的路径；
![image](https://github.com/user-attachments/assets/97deae5d-e30f-44b6-a0b8-f59c1fca1de7)


## 元数据自动更新功能
### 1. description
跟 Notion 类似，Obsidian frontmatter 可以添加很多元数据用于记录和现实笔记记录的一些备注信息，有些元数据（例如当前笔记的修改时间等）时需要更具当前笔记的状态实时更新的，这样使用者就不需要每次都手动进行更新了，为此 Personal Assistant 提供了自动更新 frontmatter 元数据的功能。

### 2. demo
如下视频所示，演示了通过面板（Command Palette）输入 `update metadata` 即可自动化更新 frontmatter 中的元数据，为了提示用户在自动更新元数据，右下角的 icon 会呈现呼吸状态。


https://github.com/user-attachments/assets/0f78362e-3b6a-4d67-8dd3-ba5fdf9317e7



### 3. configuration
Personal Assistant 插件的 Update Metadata 功能提供了3个配置项：
1. enable updating metadata，打开自动更新元数据；
2. add key-value in frontmatter，添加 frontmatter 需要自动更新的元数据，目前支持两种数据：字符串和时间戳；
3. metadata updating exclude path，配置不需要更新元数据的目录，多路径以逗号作为分隔符；
![image](https://github.com/user-attachments/assets/12bcae96-5611-4b4b-8df2-060960756c47)


## References
1. [我的 PKM 系统](https://www.edony.ink/my-pkm/)
2. [Personal Assistant 支持 Vault 统计状态预览|Obsidian Plugin - Personal Assistant](https://www.edony.ink/personal-assistant-feature-to-display-statistics/)
3. [Obsidian callout 快捷方法](https://www.edony.ink/obsidian-callout-kuai-jie-fang-fa/)

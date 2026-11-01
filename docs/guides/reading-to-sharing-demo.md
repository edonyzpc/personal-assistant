# 从阅读积累到短文与分享 / From reading notes to a shareable article

Updated: 2026-11-01

[中文](#中文) · [English](#english) · [README 中文版](../../README-CN.md#开始使用) · [README](../../README.md#get-started)

这组可复制的虚构笔记和问题用于体验“阅读积累 → 拾页关联 → Agent 整理 → Writing 成文 → 图片生成 → 保存与分享”。
它是可执行的示例，不是已完成的实测报告，也不要求模型返回固定答案。
请使用与 README 能力说明相符的构建；已安装旧版的入口可能不同。
拍摄顺序、画面重点和素材替换位置见[README 素材制作指南](../development/workflows/readme-media-production.md)。

These fictional notes and prompts support a reading-to-writing workflow: Pagelet connections,
Agent research, Writing, image generation, saving, and sharing. This is a walkthrough to try,
not a report of a completed test or a prescribed model answer. Use a build matching the README;
older installed releases may have different controls. See the
[README media production guide](../development/workflows/readme-media-production.md) for the filming plan.

## 中文

### 只想先试一次 Chat

不必先配置整套流程。只配置聊天连接，检查允许使用的笔记范围，并先关闭不需要的 Memory 和拾页后台发现。
复制下面的第一篇《阅读札记：读完之后做什么》，保持它打开，在 Chat 选择“我的笔记”，提问：

> 这篇笔记最想解决什么问题？请列出一个可以尝试的小动作。只分析，不修改笔记。

核对回答是否来自这篇笔记，以及原文是否保持不变。这个单笔记练习不需要准备 Memory 或配置图片生成；
Chat 仍可能将问题和允许的笔记上下文发送给配置的服务商并使用额度。

### 准备完整的阅读到分享流程

1. 使用独立、非敏感的演示笔记库。在其中创建 `PA演示` 文件夹，保存下面四篇笔记。
   **新建一个目录不等于 PA 只能使用这个目录。** 检查“笔记与隐私”和拾页排除规则；
   Memory 准备可能处理其他允许的笔记。
2. 在“AI 连接”中分别核对聊天、笔记检索（Memory）和图片用途。
   Chat 与拾页需要模型支持对应的工具能力；图片生成需要兼容的图片服务，不能仅靠聊天连接。
   准备 Memory、Chat、拾页发现和图片任务可能把相应材料发送到配置的服务商并使用额度。
   详见[连接说明](../../Manual-CN.md#3-配置)和[图片指南](./multimodal-chat-user-guide.md)。
3. 先让前三篇素材笔记完成 Memory 准备。完成一次普通 Chat，确认连接已经可用。
   首次练习不需要私人笔记，也不需要开启网页搜索。
4. 要观察主动洞察，启用拾页、“在后台发现笔记关联”和“主动提示”，显示拾页角色，
   并避开静默时间、提示冷却和专注模式。要录制主动过程，不要提前对写作提纲运行手动发现。

<a id="示例笔记"></a>

### 四篇示例笔记

以下内容全部虚构，不代表真实个人经历、书籍引文或研究证据。第四篇最后的补充句在后面的操作步骤中提供。

#### 阅读札记：读完之后做什么

文件名：`PA演示/阅读札记：读完之后做什么.md`

```markdown
# 阅读札记：读完之后做什么

这是一篇虚构演示札记，不引用真实书籍。

我经常把“看懂了”当成“已经会了”。读教程时，每一步似乎都很清楚；关掉页面之后，却不一定能独立完成。

我想尝试一个简单做法：读完一小节，先合上材料，用自己的话写下最重要的意思，再找一个小问题试着使用它。讲不清楚或者做不出来的地方，再回到原文查。

不过，不是所有阅读都需要立刻产出。小说、随笔和陌生领域的阅读，也可以只是留下问题，等待以后再理解。

想继续观察：什么情况下应该继续读，什么情况下应该停下来试一次？
```

#### 实践记录：我的第一张阅读图表

文件名：`PA演示/实践记录：我的第一张阅读图表.md`

```markdown
# 实践记录：我的第一张阅读图表

以下经历和数据均为虚构演示。

第一周，我收藏了六篇图表教程，比较了几个工具，但一直没有开始。每次准备动手，都觉得还需要看完下一篇。

第二周，我给自己换了一个目标：只画出过去七天的阅读时长，不比较软件，也不追求漂亮。我用已经熟悉的表格工具，先做了一张普通柱状图。

第一张图很粗糙，但它让我第一次发现：工作日的阅读通常更短，周末更集中。这比继续整理教程更接近我原本想知道的问题。

过程中也遇到了困难：日期格式不一致，图表顺序出了错。我回去查了一小段教程，修好后继续。

这次经历让我觉得，先有一个小作品，更容易知道接下来究竟该学什么。但它只是一次个人尝试，不能说明教程不重要。
```

#### 生活记录：先穿上跑鞋

文件名：`PA演示/生活记录：先穿上跑鞋.md`

```markdown
# 生活记录：先穿上跑鞋

以下经历为虚构演示。

我曾经给自己定过“每次跑五公里”的目标，结果经常因为觉得时间不够而取消。

后来，我把开始的要求改成“穿上鞋，出门走到街角”。有时最后只是散步，有时会继续慢跑。这个做法没有让我每次都运动，但减少了出门前反复犹豫的时间。

一个细节是，我会提前把鞋放在门边，出门后也不用再决定路线。需要临时找衣服、选路线的时候，我依然容易放弃。

这段记录只是在描述我如何更容易开始，不是在比较训练效果。

留下的问题：有些计划迟迟没动，是目标太大，还是开始之前需要做的决定太多？
```

#### 写作提纲：让阅读用起来

文件名：`PA演示/写作提纲：让阅读用起来.md`

```markdown
# 写作提纲：让阅读用起来

我想写一篇面向普通笔记用户的短文，讨论怎样把阅读积累用到生活和工作里。

希望从一个具体的小经历出发，让读者看见“收藏材料”之后还可以做什么。文章不要写成学习方法大全，也不要把个人经历说成普遍规律。

目前的困惑：我不想否定阅读和收藏，它们确实有价值；但也想解释，为什么继续准备有时反而让人迟迟没有开始。

预期成果：一篇约五百字的短文、一张横向配图，以及一张适合分享的摘录卡片。
```

### 1. 阅读时观察拾页关联

打开第四篇提纲，补入下面这句，然后停下来阅读。录制时，从补写开始保留连续原片。

```text
我想找一个今天就能试的小动作，让已经读过的东西真正派上用场。
```

正常的编辑停顿或笔记切换可以触发自动发现尝试，**不保证一定出现提示，也不保证固定等待时间**。
来源权限、模型与服务状态、结果质量、用量和提示条件都会影响结果。
如果出现有价值的提示，选择“查看洞察”，阅读发现并打开来源核对，再选择“在聊天中讨论”。
这个交接准备新 Chat 和材料，不会自动发送消息。

不必强求拾页找到跑步记录；采用实际有依据的发现即可。
若没有主动结果，普通体验可以运行“拾页：发现关联”尝试手动发现，
但拍摄时必须标明手动操作，不能剪成主动出现。也可以直接打开 Chat，围绕提纲继续下面的检索步骤。
没有洞察可能是正常结果。更多说明见[拾页指南](./pagelet-user-guide.md)。

<a id="提问-a"></a>

### 2. 提问 A：让 Agent 整理旧笔记

在新 Chat 检查“来自 Pagelet”的材料，将回答资料范围设为“我的笔记”，再发送：

```text
结合当前《写作提纲：让阅读用起来》和拾页带来的发现，请使用 Memory 查找 PA演示 文件夹中相关的旧笔记，帮我判断这篇文章可以写什么。

给出两个适合普通读者的切入角度，并推荐一个。说明每个角度用了哪些笔记、哪些材料存在分歧。生活中的类比和直接的实践记录请分开看待。

先整理素材，不写全文，也不修改笔记。
```

如果没有拾页交接材料，删去问题中的“和拾页带来的发现”后发送。
核对回答实际用了哪些来源，以及不同材料怎样影响结论。
跑步记录可以启发“降低开始的阻力”，不能作为学习方法有效的证据；不要求固定措辞或必须使用全部三篇笔记。
Memory 的实际使用应以检索过程和来源为准，不能仅凭回答中出现“Memory”字样认定。

<a id="提问-b"></a>

### 3. 提问 B：用 Writing 写成短文

在同一会话输入 `@` 并选择 `Writing`。**从菜单选中后只粘贴下面的正文，不再重复 `@Writing`。**
也可以不选菜单，直接发送包含 `@Writing` 的完整文本：

```text
@Writing 根据刚才核对的材料，以“收藏之后，先做一小步”为题，写一篇约450–600字的演示短文，面向喜欢阅读和记笔记的普通用户。

用虚构作者的第一人称，从图表练习的经历开头。保留“遇到具体问题后，仍然需要回去阅读”的转折。生活记录如果适合，可以作为简短类比，不要当作学习效果的证明。

结尾给出一个今天可以尝试的小动作。语气自然、具体，避免口号，不编造书名、引文或研究数据。用简短的来源段落列出实际使用的笔记链接。
```

完成后：

1. 打开回答旁的“文案版本”，阅读正文，按需要修改或继续写。
2. 点击“保存为笔记”，标题填写 `收藏之后，先做一小步`。
3. 展开“更改位置”，填写文件夹 `PA演示/成稿`；不要把路径或 `.md` 填入标题。
4. 核对保存预览，确认后保存，再点击“打开笔记”。

目标笔记为 `PA演示/成稿/收藏之后，先做一小步.md`。以界面显示的实际保存结果为准。
此时保存的是文章；后面生成的图片通过另一个明确动作插入。

<a id="提问-c"></a>

### 4. 提问 C：用 CreateImage 生成配图

回到同一会话，输入 `@` 并选择 `CreateImage`，只粘贴下面的正文；
或直接发送带 command 的完整文本：

```text
@CreateImage 为刚才的《收藏之后，先做一小步》生成一张横向文章配图。

采用有纸张质感的编辑插画风格：左侧是书页与零散的阅读便签，右侧是一张刚完成的小柱状图，中间通过几张逐渐排整齐的纸片连接，表达“把阅读积累变成一次具体尝试”。

米白底色，深绿和少量暖橙点缀，构图简洁，留出呼吸空间。不要文字、字母、标志或水印。请直接生成一张图片。
```

在参数界面选择当前模型支持的横向尺寸，数量为一张。完成后查看图片，再点击“保存到笔记”，
选择 `PA演示/成稿/收藏之后，先做一小步.md`。打开文章核对插入的图片。
“生成完成”不等于“已经保存到文章”；若要继续修改图片，可使用结果卡上的编辑入口。

### 5. 从文章制作分享卡片

1. 在已保存的文章中选中一段约80–140字、意思完整的正文。
2. 打开 Obsidian 命令面板，运行“将所选内容分享为卡片”。
3. 查看预览和实际分页，按需要调整可用选项，然后保存或复制。

分享卡片排版已有内容，与前面的模型生图是两种能力。
这次流程结束时，检查真实存在的文章、已保存图片和导出卡片；没有成功的步骤保留为未完成，不以对话中的完成声明替代实际结果。

<a id="english"></a>

## English walkthrough

### Try one Chat first

You do not need to configure the whole workflow. Set up a Chat connection, check the allowed note scope,
and turn off Memory and Pagelet background discovery if you do not need them yet. Copy only the first note,
Reading notes - After the last page, keep it open, select My notes in Chat, and ask:

> What question is this note trying to answer? Suggest one small action I could try. Analyze only; do not modify the note.

Check that the answer uses this note and that the original remains unchanged. This single-note exercise needs
neither prepared Memory nor an image service. Chat may still send your question and allowed note context to
your configured provider and use API credits.

### Prepare the full reading-to-sharing workflow

1. Use a separate, non-sensitive demo vault. Create a `PA Demo` folder and save the four notes below.
   **Creating a folder does not restrict PA to that folder.** Check Notes & Privacy and Pagelet exclusions;
   preparing Memory may also process other eligible notes.
2. Under AI connections, check the Chat, note retrieval (Memory), and image assignments separately.
   Chat and Pagelet need the relevant model tool capabilities; image generation needs a compatible image service.
   Memory preparation, Chat, Pagelet discovery, and image tasks may send the relevant material to your configured
   provider and use API credits. See [connection setup](../../Manual.md#3-configuration) and the
   [image guide](./multimodal-chat-user-guide.md).
3. Prepare Memory for the first three source notes. Complete an ordinary Chat request to confirm the connection
   is available. Private notes and web search are not needed for this example.
4. To observe proactive insights, enable Pagelet, background connection discovery, and proactive hints.
   Show the Pagelet character and avoid quiet hours, hint cooldowns, and focus mode. When recording the automatic
   process, do not run manual discovery on the writing outline beforehand.

### Four example notes

All content is invented. It is not a real person's history, a quotation from a book, or research evidence.
The sentence to add to the fourth note during recording appears in the next section.

#### Reading notes - After the last page

Filename: `PA Demo/Reading notes - After the last page.md`

```markdown
# Reading notes - After the last page

This is a fictional demonstration note. It does not quote a real book.

I often confuse understanding an explanation with being able to do the work. Every step seems clear while I read a tutorial, but I cannot always finish the task after closing it.

I want to try something simple: after a short section, close the material, explain the main idea in my own words, and use it on one small problem. If I cannot explain or do something, return to that part of the text.

Not every reading session needs an immediate output, though. A novel, an essay, or an unfamiliar subject can simply leave me with questions to revisit later.

A question to keep exploring: when should I read further, and when should I stop and try something?
```

#### Practice log - My first reading chart

Filename: `PA Demo/Practice log - My first reading chart.md`

```markdown
# Practice log - My first reading chart

The experiences and data below are fictional demonstration material.

In the first week, I saved six chart tutorials and compared several tools, but never started. Whenever I was about to begin, I felt I should read one more article first.

In the second week, I changed the goal: chart the previous seven days of reading time, without comparing software or trying to make it beautiful. I used a spreadsheet tool I already knew and made a plain bar chart.

The first chart was rough, but it helped me notice that my weekday reading sessions were usually shorter, with more reading at the weekend. That was closer to my original question than collecting more tutorials.

I still ran into trouble. Inconsistent date formats put the chart in the wrong order. I looked up a short tutorial section, fixed the problem, and continued.

This experience made me think that having a small piece of work can reveal what I need to learn next. It was only one personal attempt; it does not mean tutorials are unimportant.
```

#### Life notes - Put on the running shoes

Filename: `PA Demo/Life notes - Put on the running shoes.md`

```markdown
# Life notes - Put on the running shoes

This experience is fictional demonstration material.

I used to set a goal of running five kilometres each time. I often cancelled because I felt I did not have enough time.

Later, I changed the starting requirement to putting on my shoes and walking to the corner. Sometimes I only walked; sometimes I continued with a jog. It did not make me exercise every time, but it reduced the time spent hesitating before leaving.

One useful detail was leaving my shoes by the door and deciding the route beforehand. When I still needed to find clothes and choose a route, I remained more likely to give up.

This note describes making it easier to begin, not a comparison of training outcomes.

A question to revisit: when a plan never gets started, is the goal too large, or are there too many decisions to make before beginning?
```

#### Writing outline - Put reading to use

Filename: `PA Demo/Writing outline - Put reading to use.md`

```markdown
# Writing outline - Put reading to use

I want to write a short article for ordinary note-takers about using what we read in everyday life and work.

Start with one small, concrete experience and show what can happen after saving useful material. This should not become a complete guide to learning, or treat a personal experience as a universal rule.

My current difficulty: I do not want to dismiss reading or collecting useful material. Both matter. But I also want to explain how continued preparation can sometimes keep us from beginning.

Desired outcome: a short article of roughly 400 words, one landscape illustration, and a shareable excerpt card.
```

### 1. Observe a Pagelet connection while reading

Open the fourth note, add this sentence, and pause to read. For filming, keep a continuous original recording
from the moment you add the sentence.

```text
I want to find one small thing I can try today that puts something I have already read to use.
```

Normal pauses after editing or note switches can trigger an automatic discovery attempt.
**An insight is not guaranteed, and there is no fixed wait time.** Source permissions, model and service readiness,
result quality, usage allowances, and hint conditions all matter. If a useful hint appears, select View insight,
read it, open its sources, and choose Discuss in Chat. This prepares a new Chat and its context; it does not
send a message automatically.

Pagelet does not have to find the running note. Use whichever supported connection actually appears.
If no proactive insight appears, you can try Pagelet: Discover connections manually, but label that action honestly
when filming. Do not present a manual result as an automatic one. You can also open Chat directly and continue
with the retrieval step below. Finding no insight can be a normal outcome. See the [Pagelet guide](./pagelet-user-guide.md).

### 2. Prompt A - Ask the Agent to organize the source material

In the new Chat, inspect the From Pagelet context, choose My notes as the answer source, and send:

```text
Using the current Writing outline - Put reading to use and the finding from Pagelet, use Memory to find relevant older notes in the PA Demo folder and help me decide what this article could say.

Suggest two angles for an ordinary reader and recommend one. Explain which notes each angle uses and where the material disagrees. Distinguish an analogy from everyday life from a direct account of the practice itself.

Organize the material first. Do not write the full article or modify any notes yet.
```

If you did not bring a Pagelet finding into Chat, remove “and the finding from Pagelet” before sending.
Check the sources actually used and how each one affects the conclusion. The running note can suggest an analogy
about making a start easier; it cannot establish that a learning method works. There is no required wording or
requirement to use all three notes. Judge Memory use from the retrieval activity and sources, not merely from the
word “Memory” appearing in an answer.

### 3. Prompt B - Turn the material into an article with Writing

In the same conversation, type `@` and choose Writing. **After choosing it from the menu, paste only the prompt body;
do not repeat `@Writing`.** Alternatively, send the complete text including the command:

```text
@Writing Using the material we just checked, write a demonstration article of about 350–450 words titled “After collecting, take one small step”. Write for ordinary people who enjoy reading and taking notes.

Use the fictional author's first-person voice and begin with the chart-making experience. Keep the turn in the story where a specific problem still requires going back to read. If useful, include the life note as a brief analogy, not as evidence of a learning outcome.

End with one small action the reader could try today. Keep the language natural and concrete, avoid slogans, and do not invent book titles, quotations, or research data. Add a short sources section linking to the notes actually used.
```

When the response is complete:

1. Open Writing versions, read the article, and revise or continue it if needed.
2. Choose Save as a note and enter the title `After collecting, take one small step`.
3. Expand Change location and enter the folder `PA Demo/Articles`; do not put a path or `.md` in the title field.
4. Check the save preview, confirm, and open the saved note.

The intended note is `PA Demo/Articles/After collecting, take one small step.md`. Check the actual save result in
the interface. This saves the article; the image generated next is inserted through a separate explicit action.

### 4. Prompt C - Make an illustration with CreateImage

Return to the same conversation, type `@`, and choose CreateImage, then paste only the body below.
Alternatively, send the whole text including the command:

```text
@CreateImage Generate one landscape illustration for the article “After collecting, take one small step”.

Use a textured-paper editorial illustration style. On the left, show book pages and scattered reading notes. On the right, show a small, newly completed bar chart. Connect them with paper slips gradually becoming organized, suggesting that reading material is becoming one concrete attempt.

Use an off-white background, deep green, and a little warm orange. Keep the composition simple with room to breathe. No text, letters, logos, or watermarks. Please generate one image now.
```

Choose a landscape size supported by the current model and a count of one in the options dialog.
When the image is ready, inspect it, choose Save to note, and select
`PA Demo/Articles/After collecting, take one small step.md`. Open the article to check the inserted image.
Generation completing does not mean the image has already been saved into the article. To revise an image,
use the editing control on its result card.

### 5. Make a share card from the article

1. Select a self-contained passage of roughly 50–90 words in the saved article.
2. Open the Obsidian command palette and run Share Selection as Card.
3. Check the preview and actual pagination, adjust the available options if needed, and save or copy the result.

Share Card lays out existing content; it is a separate capability from generating the illustration above.
Finish by checking the actual saved article, image, and exported card. Keep incomplete steps marked incomplete;
a conversational completion claim does not replace the saved result.

# Ghost Blog Publishing 开发与测试方案

Document status: Approved
Updated: 2026-09-29
Work item: B-153
Authority: Owner 要求按项目规范细化 GPT + GLM 开发与测试，并于 2026-09-29 授权完成全部开发测试、选择本机隔离 Ghost 测试站；本文件定义派工、依赖、验证与停点，不授权正式站点写入或 Git/release。
Product spec: [Product Spec](../../../product/specs/pa-ghost-blog-publishing-product-spec.md)
Tracker: [Development Tracker](./tracker.md)
SDD: [实施设计](../../ghost-blog-publishing-design.md)

## Goal And Non-goals

完整实现已批准的 10 项 REQ/AC：笔记确定性导出、Ghost 原生草稿预览、明确确认更新、
同桌面恢复、完成后换桌面新更新、最近一次更新恢复。复用现有 Chat、来源权限、
SecretStorage、Web viewer 和 Jest，不新增通用工作流、同步平台、浏览器服务或测试框架。

每次发布/更新/恢复在同一桌面完成；不传递进行中任务，不要求新修改后的笔记等于线上旧版。
首版不含移动发布、旧 Ghost 文章接管、邮件、全站设置写入和双向正文同步。
移动端普通编辑/提示/布局默认用 Obsidian CLI mobile 模式；只有实际引入 iOS 独有依赖时
才增加针对该依赖的真机用例，不要求所有 OS、主题、格式、设备组合。

GPT 负责设计、派工、权威文档、Tracker 和独立验收；GLM 通过独立 Codex CLI 完成限定调查、
实现、测试和自查。默认一个 GLM writer 连续完成 T-02，返工优先沿用该上下文；切片是验收
边界，不是强制新建会话。遵守 [工作流](../../workflows/gpt6-glm-delivery-workflow.md) 和
[任务模板](../../templates/glm-worker-task.md)。不另建成本统计、回执系统或逐命令审批。

## Dependencies And Source Surface

规划时核对 `10635c6` 的以下接线与现有测试；实施前只补查发生变化的部分。
这不是运行时通过证据。新 `src/ghost-publishing/` 和 Ghost 专用 suites 均为拟新增。

| 改动面 | 当前接线 / 必要动作 | 最邻近现有 source suites（按实际改动选） |
| --- | --- | --- |
| 技能与入口 | `skills/blog2ghost/SKILL.md` 拟新增；`bundled-skills.ts`、`bundled-skill-catalog.ts` 注册；Chat 的 `getSkillTriggerMatch` 识别 `#skill`，`getActionTriggerMatch` 识别 `@CreateImage` / `@Writing`；保留输入优先级和 IME | `skill-context-provider.test.ts`、`chat-view.test.ts`；新增技能会影响已有数量断言 |
| 领域 Host 工具 | `chat-tool-factories.ts` → `capability-adapter.ts` → `capability-registry.ts` → `pa-agent-host-tools.ts`；配套 `chat-tool-types.ts`、`capability-types.ts`、`policy-engine.ts`，不只修改 registry helper | `capability-registry.test.ts`、`policy-engine.test.ts`、`pa-agent-host-tools.test.ts`；参考 `b133-create-image-tool.test.ts` 的领域模式 |
| 来源及最终发送 | `src/plugin/source-access.ts`、`task-source-read-guard.ts`；沿用 `isCurrent`、`isPathAllowed`、`isNoteDomainAllowed`、`captureSourceValidity`；发布入口必须实际取得 guard，不能依赖缺省放行 | `task-source-read-guard.test.ts`、`plugin-source-access.test.ts`、`chat-tools-task-source.test.ts` |
| 设置与凭据 | `src/ai-services/plugin-configuration.ts` 的 SecretStorage 用法，`src/plugin/settings-persistence.ts` 的 `enqueueWrite`；Ghost 单独配置与 secret，不向 AI 专属事务塞发布状态 | `ai-plugin-configuration.test.ts`、`plugin-settings-persistence.test.ts` |
| 结果与 UI | `pa-agent-result-facts.ts`、`pa-agent-required-capability-policy.ts`、Chat 结果卡及 `src/plugin.ts` 生命周期；区分草稿就绪、已上线、结果不明、清理待办 | `pa-agent-required-capability-policy.test.ts`、`chat-view.test.ts` |

上表未带目录的源码位于 `src/ai-services/`，Chat 位于 `src/chat/chat-view.ts`；测试均位于
`__tests__/` 且属于 source 组。改动配置/分组/打包脚本时才增加对应 tooling/artifact suite。
新增直接依赖固定为 `markdown-it@15.0.2`、类型为 `@types/markdown-it@14.2.0`（MIT），
按 T-01 核定的 recipe/schema 实施；T-02 更新 lockfile/notices，不顺带升级其他包。

### 派工前一次填齐

GPT 在 Tracker Current Snapshot 和临时任务单填写实际值，不把以下占位符当可运行配置：

| 字段 | 必须核实的内容 |
| --- | --- |
| `pa_worker_tree` / 接收树 | 工作用绝对目录、分支/基线、已有 dirty 归属、获派精确路径；先检查可复用工作树，需隔离时用应用 worktree 工具。未提交契约须显式复制并核对 |
| `pa_run_dir` / 任务修订 | 本次独有输出目录、完整非空任务单；原始 events/result/stderr、自然退出码和临时资源留到验收；不读取其他任务日志 |
| GLM 身份 | 本机 CLI/profile/provider/非秘密端点/请求模型/推理参数/catalog 和覆盖项；复用有效的本机预检。服务端实际型号无证据记未知，不打印密钥、不默认继承桌面工具 |
| 测试环境 | Node 22、npm 10/11、lockfile、Jest 可用；按需安装。默认目标为实施树对应的 repo-local `test/`，CLI 必须核对实际绝对路径与已加载插件 |
| Ghost 测试站 | 明确获准的站点、测试账号/Integration、可创建/更新/恢复/清理合成文章的范围；凭据只手工写入 SecretStorage，不进入任务或日志。不默认使用 edony.ink |
| 第二独立环境 | 本轮按Owner 2026-09-29明确选择使用同机`test`/`test2`两个独立vault：同版本插件、分别配置Ghost凭据，不复制A的本机操作状态/Chat；只复制明确的合成源与已完成记录模拟同步。真实双桌面及同步服务另行补验，不阻塞本轮；不得称为真实跨设备证据 |

只读规划已确认本机 CLI 支持 `dev:mobile on/off`；实际开发时重验受影响环境。
授权不全或外部环境暂缺时继续独立的纯函数/本地测试，不发请求试探目标；相关 AC 保留未验证。

任务单引用完整 Product Spec 和当前技术设计，带上对应负例；只传必要读集。
首次有效预检后复用，不为每个任务重做认证/工具实验。启动命令沿用仓库模板：

```bash
codex exec --profile pa-glm --cd "$pa_worker_tree" \
  --sandbox workspace-write --json \
  --output-last-message "$pa_run_dir/result.md" \
  - < "$pa_run_dir/deliver-task.md" \
  > "$pa_run_dir/events.jsonl" 2> "$pa_run_dir/stderr.log"
```

本命令只在身份和变量已核实、任务已获派后使用；只读调查改用 read-only sandbox。
GLM 不能修改 authority/Tracker、启动嵌套 agent、擅自部署到别的 vault 或执行 Git/release。

## Phases

| 任务 | 依赖与模式 | 交付结果 | 退出 / 停点 |
| --- | --- | --- | --- |
| T-01 可行性 | 环境与目标就绪；限定 scratch/fixture 的 `deliver`，未知项以证据返回 | 原生 Preview、Lexical、渲染 recipe、本机 store 和完成记录的有界探针 | GPT 核定技术选择及负例、更新技术设计为 Approved；不自动进入生产实现 |
| T-02 完整垂直实现 | T-01 通过且实现已授权；高风险写入边界设 K-02 检查点，然后同一 GLM `implement` | source/export → client/store/service → Host/Chat/Settings；focused 通过及自查报告 | 生产代码完整待验收，不自报 AC 全部通过 |
| T-03 集中验收 | T-02 输入冻结 | 一次完整 gate、部署、S-01–05 实际行为和 GPT review | 必需 AC 全部有证据才标 Validated；之后只做获准的接收与清理，不自动 Git/发布/closeout |

### T-01 — 最小可行性任务卡

- **范围**：只在获派 scratch、合成 fixture 和已获准测试站操作，不修改 `src/` 或生产配置。
  既有合成 Web viewer 证据直接作为起点，补真实 Ghost 缺口，不重做一套浏览器实验。
- **步骤**：用 F-01 建一个合成草稿，读取/保存/再读取 Lexical，确认普通段落和代码可编辑；
  Preview 在 native Web viewer 加载，核对图片、代码、Mermaid 与行内/块公式实际结果。
  核对 Integration 的合法读取能力和文章注入清单，固定版本 recipe，保留人工注入。
- **存储探针**：选择现有宿主可用的设备本地持久化方式；关闭并重启 app 后能读回，且不落到
  会随 vault 同步的 `data.json`。验证普通 Markdown 完成记录的 schema 校验、单文件替换和系统来源排除接线。
  完成记录在第二独立vault可读的证据与 T-03 S-04 复用；本轮模拟记录同步，不宣称真实跨设备通过。
- **输出**：实际版本/权限、成功和失败各一份最小样例、所选 schema/recipe/store 接口、必要依赖/许可；
  报告主题或 API 不支持之处，不引入通用转换插件系统或自行降低可编辑/检查要求。
- **GPT 退出判断**：这些技术未知已足以固定生产实现，设计与测试负例明确；本轮完成Owner已批准的双独立vault验收，真实双桌面同步留后续补验。
  兼容原契约的局部选型由 GPT 决定，改变产品边界才交用户。

### T-02 — 一个 writer 的连续实现任务卡

允许范围：`src/ghost-publishing/`、上表确需的现有接线、`skills/blog2ghost/`、对应测试/fixture、
必要 locale/`src/custom.pcss`，以及获准新增依赖涉及的 package/lock/notices。GPT 在派工单列出
实际设置/locale 文件，不允许以此泛化到全仓改造；5–7 个职责文件是设计提示，不是数量指标。

1. **导出与字段**：绑定提交时的唯一笔记，完整读取受准入保护的来源，展开显式嵌入；确定性
   转换 Lexical/有界 HTML card，形成依赖与资源映射，处理字段三态。先跑 V-01；解析单元独立验证，
   不为每种格式重走一次完整 Chat。支持范围之外的构造指出位置并停止，不能静默删掉。
2. **K-02 写入边界检查点**：实施外部写入/恢复前，GLM 先提交状态不变量、调用顺序和 V-02/V-03
   关键负例断言，GPT 核对权限、持久化和未知结果处理。已有行为的回归保留有意义的失败证据；
   新模块缺文件/导入失败不算红灯，也不为了红灯制造产品缺陷。核对后由同一 writer 连续实现。
3. **client/store/service**：完成源读取、图片上传和每个真实写入前的最终准入；提交前持久化操作及
   pre-update snapshot；prepared 与 pending 留本机，已核实完成基线/lastUndo 原子写回 vault。
   核实结果不明请求，保留最小 binding，保持原 ID/URL/未管理字段；完成恢复与精确临时稿清理。
   用户修改过临时预览稿时读取、校验并重新准备确认，不能预览一份却提交另一份。
   普通更新始终沿用远端访问范围，即使默认设置已变；显式范围变化须独立展示并确认，不能借普通更新确认放行。
   V-02 使用可控 transport 记录实际调用次数/参数，store 的序列化跨实例读回不能全被 mock 掉。
4. **Host/UI**：注册专用工具及权限，把确认限定在 Host UI；接入 Skill、设置、原生预览、就绪/
   失败/核实/恢复结果卡。首次发布后提供明确的“检查发布结果”操作，记录保存成功才显示完成。
   Ghost 工具及桌面依赖在 mobile 不可执行/加载，普通笔记仍可编辑；新能力不改变既有 `#skill`、
   `@CreateImage`、`@Writing`。跑 V-03 和实际受影响的既有 source suites。
5. **自查与交付**：检查完整 diff、卸载监听/计时器/预览生命周期、秘密与快照不进模型/日志、
   SourceAccess 排除和构建依赖；修复 focused 失败后返回原始证据。GLM 不批准自己的实现。

T-02.1–4 是连续内部步骤，不各自宣称一个完成的 UI 阶段。T-03 是本垂直切片的必需 app
退出门禁；若中途要验收一个可交付 UI 子阶段，则当时先完成对应部署/真实交互，不延期其 gate。

### T-03 — 集成、独立验收与接收任务卡

一个指定执行者（工具已核验时为 GLM）冻结源码/测试/fixture/config/依赖后运行完整门禁。
GPT 可并行只读审阅；发现必须修复的问题先结束或明确中止旧 gate，再修改及补受影响检查。
通过后使用同一 build 跑下面 S-01–05。GLM 无 app 工具时，GPT 补可见操作，不静默改由 GPT 实现。
新入口必须实际输入、选择和点击；CLI/CDP 可作为支持的交互方法，直接调用内部 service 不能证明 UI。

GPT 先独立读契约、实际 diff、关键断言和原始退出结果，再核对报告。重点检查网络写入最终
准入、不可复用确认、异常成功不重复提交、历史内容来源和 mobile 限制；按项目 review 规则
安排一次有界独立只读复核，不给每个小文件增加 reviewer。修复回到同一 GLM，更新任务修订。
接收树、部署和原始验证输入需一致；迁移后相同输入复用原证据，变化只补受影响项。

## Validation Strategy

### F-01 — 一篇综合夹具与少量失败变体

新增 `__tests__/fixtures/ghost-publishing/` 合成材料，实施时复制到获派 `test/0.unsorted/b153/`；
不存在才创建，不覆盖同名用户文件。主文包含普通段落/标题/列表/表格、含空白及特殊字符的代码、
一个 Mermaid、行内/块公式、本地图与受控网络图、整篇/标题/块嵌入、已发布/未发布双链和发布字段。
保存预期正文、依赖和原始文件摘要；敏感属性用假值证明不会导出。配套只需小嵌入笔记/图片，
歧义、循环、缺图、来源排除、重复块等按用例构造最小变体，不建独立完整 vault 矩阵。

Ghost 人工格式调整用一个未变段落；实质冲突用改字/改链接目标，避免“格式不同”代替内容冲突。
正常链只用一篇正式测试文章及其临时稿，后续更新/恢复/换桌面复用。真实渲染验证最终 recipe，
不扩展为多主题、多渲染库组合；所有 API 证据脱敏且不含完整预览 token/正文快照。

### 自动化责任与最小风险映射

下列三个 owner 组是职责划分，不要求固定文件数。拟新增名称为 `ghost-publishing-export`、
`ghost-publishing-workflow`、`ghost-publishing-host-ui` 的 `.test.ts`，实际命名由 writer 保持清晰。
每项只在 owner 层测试完整规则；跨层保留必要接线/副作用断言，不重复相同输入输出矩阵。

| ID / REQ、AC | 变化及关键负例 | 最低充分证据 / 通过条件 | 重跑或扩展触发 |
| --- | --- | --- | --- |
| V-01；B-153/REQ-02–04、06 / B-153/AC-02–04、06 | 导出、字段三态、块/资源映射、recipe 注入；缺失/循环嵌入、普通双链降级、代码空白、语义冲突和重复块 | exporter owner：精确正文/代码/公式断言，普通块可编辑数据，未变格式保留；歧义暂停；明确覆盖重新预览；源正文/图片引用不变，内部属性不导出；兼容库不重复注入、人工区域逐字保留、PA 区被修改时暂停 | 解析、schema、格式匹配、recipe、字段归属改变；不因 UI 文案变化重跑全部格式 |
| V-02；B-153/REQ-05–10 / B-153/AC-05–10 | transport、持久化与 service；图片失败/复用、跨 origin、POST 响应丢失、PUT 409/结果不明、重复确认、远端成功本地写回失败、重启、移动/改名与复制身份、缺必要记录、异机未完成稿/人为接管、临时稿修改、访问范围确认、恢复/清理失败 | workflow owner：断言真实发送次数和受管字段，未知先 GET/查标记再决定；不盲重试、不误报成功；跨实例读回已落盘数据；预览与提交同候选，异机任务不接管；只清理精确归属；lastUndo 恢复不改本地正文；具体附加断言见下文 | client/store/schema/版本核对/状态、访问范围或恢复边界改变 |
| V-03；B-153/REQ-01、04、07–09 / B-153/AC-01、04、07–09 | Host/Chat/来源、预览失效、mobile；无 guard、来源撤销、图片读取/上传和写入前取消、伪造 confirmed、脚本/网页内容越权 | host-ui owner＋既有接线 suites：在最终副作用前拒绝且调用数为 0，活动 tab 切换不误绑；确认由 UI 绑定版本；prepare 不报 published；跳转/重载/候选变化使 probe 失效；mobile 强制平台分支阻止调用与桌面依赖 | 权限、入口、result-fact、来源、platform、Web viewer 接线改变 |

同一“请求被拒绝”不代表同一风险：保留不同异步边界的定向负例，可参数化，不能只测入口。
固定检查包含真实失败返回，而非只测页面有某全局变量；Prism 未支持语言可提示继续，加载失败不能伪装成不支持。
T-01 已实测 Mermaid 语法错误也会生成错误 SVG，断言须区分有效图表和错误状态；同样要验证
当前可见原生页面/URL，等待预期懒加载图片实际完成，不能以隐藏旧页或尚未加载的资源通过。

V-02 另保留三个小断言，不新增真实站点场景：所有实际请求无 newsletter 参数/全站设置写入；
默认访问范围变化不影响已有文章，显式范围变化未单独确认不写；唯一原笔记移动/改名后仍沿用
note_uid/post ID/URL、guard 校验当前路径且不重新 POST。它们分别保护发布副作用、访问范围和稳定关联。

### 命令与执行顺序

以下从实际 worker/接收仓库根目录运行；新 suites 在 T-02 建立前不执行、不声称已存在。

```bash
# 每个受影响 owner 组，指定确切已存在的路径；此处示例为拟新增 suite。
npm test -- --runInBand --runTestsByPath __tests__/ghost-publishing-export.test.ts
npm test -- --runInBand --runTestsByPath __tests__/ghost-publishing-workflow.test.ts
npm test -- --runInBand --runTestsByPath __tests__/ghost-publishing-host-ui.test.ts
# 随实际接线改动选择上方 source suites；不每一步全跑。
npx tsc -noEmit -skipLibCheck
git diff --check
rg -n "createElement\([\"']style[\"']\)|\.innerHTML\s*=|\.outerHTML\s*=" src

# 冻结输入后集中执行，已包含 platform guards、lint、build、完整 Jest 和部署。
make deploy
npm run docs:check
git diff --check
```

社区源码扫描无输出且退出 1 表示无匹配，通过；有匹配逐项审查。production build 已含类型检查，
完整 gate 不再单独重复 lint/build/Jest/tsc；阶段较早的 focused typecheck 只用于及时发现接线错误。
依赖/lock 变化补 `npm ci --dry-run` 和 `npm run check:third-party-notices`；若引入需更新的第三方
说明，按现有 notices 工具生成并检查，不忽略新增依赖。不新增覆盖率指标或为计时重复全量；
CI/release 自己要求的 coverage 继续由其 gate 执行。

`make deploy` 是默认路径；已有同一输入的完整检查及生产 build 时，才用 `make deploy-current`。
后者只验证构建身份，不能替代测试。artifact suites 必须有当前 build；修改 tooling 才用
`npm run test:tooling -- --runInBand <suite>`，不得因 source 组找不到测试就改跑一切。
规划轮只执行了 docs gate 和既有文档契约；实施轮按实际改动执行上述运行时门禁，结果只记 Tracker。

### 实际操作脚本与通过条件

部署到获派的 repo-local test vault 后，先确认真实目标再准备界面：

```bash
obsidian vault=test vault info=path
obsidian vault=test plugin:reload id=personal-assistant
obsidian vault=test plugin id=personal-assistant
obsidian vault=test open path="0.unsorted/b153/Publishing.md"
```

F-01 主文件实施时采用该路径；CLI 指向与部署目标不同先修正，不能在别的 vault 继续。
保留开始时的视图、插件开关、mobile/debug 状态；证据记录加载构建、实际输入/点击和结果。

| ID / 覆盖 | 在实际界面执行的最少步骤 | 通过条件 |
| --- | --- | --- |
| S-01 首次准备与发布；AC-01–07 | 在 Desktop 配置测试站；用当前笔记入口完整准备 F-01；再以路径/唯一名称定位同文，核对复用，歧义只问不写；打开原生 Preview 和系统浏览器入口；编辑 Ghost 一个段落的格式，手动 Publish（不发 newsletter），回 PA 点击检查结果 | 三入口指向同文；图片/代码/Mermaid/两种公式真实可见且渲染库未重复加载，普通段落/代码可编辑；源正文/图片引用不变；只有一个正式关联，完成记录包含实际已发布版本；API 与 UI 状态相符 |
| S-02 更新、失效与同桌面恢复；AC-02、06–09 | 改一段源内容并准备更新，核对线上仍旧版；取消后继续；准备后再次改源，旧确认应失效；重新准备后重启 Obsidian，显式继续并重新检查/确认，再更新一次 | 可靠未变排版保留；没有确认不改线上；重启不复用旧授权；最终原 ID/URL/未管理字段保持且内容为最后预览版本；正文未被导出流程改写 |
| S-03 恢复；AC-10 | 对 S-02 最近一次更新打开恢复预览，核对旧内容后确认；检查临时稿及按钮状态 | 仅受管范围恢复；Obsidian 保持新正文；恢复入口消费，未误删人工稿/正式文，清理结果不改变更新成功事实 |
| S-04 完成后换独立环境；AC-08 | 同机A=`test`完成并保存记录；B=`test2`使用独立配置/本机状态及同版本插件，单独配置Ghost凭据。先仅复制主笔记、显式嵌入及必要图片，缺完成记录时尝试更新应提示同步且零远端写入；再仅复制A已完成记录模拟同步，B改一段正文并发起、预览、确认新更新 | B正常更新同ID/URL，新内容不被误判为同步失败；不复制A的候选、Chat、本机进度或凭据配置。不测试/建设中途任务交接；记录两vault路径、构建、复制范围及独立本机状态。证据明确是同机隔离验证，不证明真实跨设备同步 |
| S-05 mobile 兼容；桌面边界/AC-01、08 | CLI mobile 模式下打开关联笔记并编辑；实际查看 Chat/设置中新增区域，尝试同一发布意图或现有卡片动作；恢复桌面模式 | 笔记可编辑且关联保持；无发布写入、无 desktop-only probe；限制提示清楚，相关界面不遮挡。既有 `#skill`、`@CreateImage`、`@Writing` 的入口不被抢占，只验入口，不重跑付费生图/写作全流程 |

S-02 的 source suites 负责完整竞态/失败矩阵，实际 app 只做表中代表性路径；网络响应丢失、
多条同标记和写回失败用可控 transport/store 注入验证，不反复在真实站制造事故。
S-04复用同一篇文章和build。2026-09-29 Owner明确选择“采用双vault验收”，本轮按上述隔离
环境完成AC-08；真实双桌面及既有同步服务是后续补验，不阻塞本轮完成，不将模拟称为真机。

mobile 命令已由本机 CLI help 确认，实际验收时运行：

```bash
obsidian vault=test dev:mobile on
obsidian vault=test open path="0.unsorted/b153/Publishing.md"
# 在可见界面执行 S-05；DOM/截图支持观察，不以调用内部方法代替入口交互。
obsidian vault=test dev:mobile off
```

无论失败或中断均恢复原状态；本来已开启的 mobile/debug 不能强制改成关闭。若为本任务开启
debug，结束时恢复（原为关闭则 `obsidian vault=test dev:debug off`）。模拟器可能不覆盖真实
移动宿主的模块加载限制，因此 V-03 还要强制 mobile 平台分支测试；不把模拟证据称为真机。
不默认做 iOS 键盘、WKWebView、系统文件权限或分享扩展测试；只有改动实际依赖这些能力时，
列明受影响 AC、原因与一个最小真机步骤，再按对应 skill 验证，不扩大成全功能真机回归。

## Risks And Rollback

| 风险 | 预防 / 发现 | 失败处理 |
| --- | --- | --- |
| 原生 viewer 私有接线或主题不兼容 | T-01 实测、能力检测；V-03 失效检查 | unavailable 保留草稿/线上旧版；不改成人工看过就算自动检查通过，不擅自建新浏览器 |
| 同步记录缺失、本机状态误同步 | store 明确范围；本机重启与 S-04，字段 schema 校验 | 只阻止依赖缺失数据的操作，保留现场；不自动修复同步、不只凭 post ID 覆盖 |
| 结果不明造成重复文章/更新 | 发送前落盘、精确标记、版本核实；V-02 调用计数 | 核实后补记录，不盲重放；只有远端确认失败才走相应重试 |
| 源撤销或秘密/历史内容泄露 | V-03 最终读取/发送检查、系统来源排除、日志脱敏 | 停止受影响发送；缺口修复前不标完成，不用放宽 guard 通过 |
| 格式保留无法可靠对应 | F-01 编辑/重复块/语义差异 | 明确冲突；用户另选完整覆盖才重新预览，不建通用合并编辑器 |

插件禁用/回退只停止新操作，不自动撤销已发布内容、删除 Ghost 图片或清空发布记录。
保留 snapshot/schema，旧插件不能解析新数据时停止写入。需要恢复线上内容走已批准的最近更新
恢复流程；不把本地 Git 回退当作远端副作用回滚。

## Acceptance, Cleanup And Approval

- 每个 AC 记通过/未通过/未验证及证据。一次真实操作可以支持多个 AC；最低充分证据齐全后停止扩测。
- 同因第二次失败无新信息、或诊断约 15 分钟无进展，换假设/方法并继续独立工作；不盲增超时或 `--forceExit`。
- GPT 检查 GLM 自然退出、完整变更（含未跟踪/删除/生成）、断言和 app 证据；必要时只补缺失/不可信项。
- 验收后确认 writer/进程已结束，安全接收交付物和必要证据，再精确清理本任务 scratch/临时稿及恢复 app 状态。
  Ghost 仅清理已获准且确认归属的合成资源，不删共享图片；工作树按应用归档工具处置，不 force 删除。
- Plan authority：2026-09-29 用户先要求制定方案，后授权完成全部开发测试并选定本机隔离测试站。
  技术设计仍需 T-01 核验；计划不是 GLM 已运行、测试已通过或 Git/release 已获授权的证明。

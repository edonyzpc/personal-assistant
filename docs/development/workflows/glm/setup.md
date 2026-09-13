# GLM 环境配置

Document status: Current
Updated: 2026-09-13
Authority: [GPT-6 / GLM 工作流](../gpt6-glm-delivery-workflow.md) 的按需配置参考。

仅首次安装、配置变更或接入故障时读取；日常使用已有有效预检。
仓库提供无密钥配方和 [catalog](./pa-glm-models.json)，各设备独立保存实际配置。
GPT-6 准备非秘密字段，用户手动维护 key，GLM worker 不修改自身配置。

## 本机配置

1. 按项目要求准备 Node/npm、依赖及 Codex CLI，核对实际版本和 `exec --help`。
   本配方使用独立 `pa-glm.config.toml` profile（Codex 0.134.0 及以后），
   不使用旧 `[profiles.pa-glm]` 表；升级 CLI 后核对兼容性。
2. 解析 `CODEX_HOME`，未设置时为 `~/.codex`；将仓库 catalog 安装到该目录的
   `pa-glm-models.json`。已有文件先比较，相同则复用，不同则核对选定版本后更新。
   保留所有模型/工具元数据，不覆盖默认模型目录。目录声明不证明账户或工具能力。
3. 在同目录准备下列 profile，catalog 路径替换为本机绝对路径，key 仅由用户填写。
   已有 profile 局部更新非秘密字段，不覆盖默认 GPT 配置、不复制或备份含 key 的文件。
   含凭据文件权限设为 `0600`；不要把真实 profile 放入 Git。

```toml
model_provider = "ZAI"
model = "glm-5.3"
model_reasoning_effort = "max"
model_catalog_json = "<ABSOLUTE_CODEX_HOME>/pa-glm-models.json"
sandbox_mode = "workspace-write"
approval_policy = "on-request"

[model_providers.ZAI]
name = "GLM Coding Plan"
base_url = "https://open.bigmodel.cn/api/v1"
wire_api = "responses"
experimental_bearer_token = "<USER_FILLS_API_KEY_LOCALLY>"
```

直接 bearer token 鉴权不同时配置 `auth`、`env_key` 或 `requires_openai_auth`。
Agent 不获取、代填、复制或散列密钥，不展示完整用户配置、`auth.json` 或环境变量。
只检查必要非秘密字段与凭据是否已填写，由 Codex 进程读取凭据完成认证。
项目代码和工具结果会发给所选 provider，只传任务必需数据，不传真实私人 vault、
凭据或无关工作区。

## 预检与调用

profile 会叠加用户配置，CLI 不自动继承桌面工具。核对最终 provider、端点、模型、
reasoning、catalog、MCP、hooks 与权限；必要时用已选配置范围内的
`-c 'model_provider="ZAI"' --model glm-5.3` 显式固定，不仅凭 profile 名称确认路由。
禁用无关 MCP 的认证检查不证明这些工具可用，也不能盲目套用另一设备的工具覆盖。

按主流程第 0 节依次验证无工具认证、只读工具和 scratch 成败。
scratch 不在 Git 仓库中时，可按本机 help 支持使用 `--skip-git-repo-check`；
临时调用可选 `--ephemeral`，原始必要证据仍由执行者保存。
记录主机/CLI、profile、provider/端点/协议、请求 model/reasoning、catalog 摘要、
非秘密覆盖与鉴权方式名称，以及命令自然退出和工具证据；服务端实际型号未知则留未知。
沿用 owning Tracker 或窄任务记录，不另建设备台账。同机配置/工具未变化且证据有效时复用。

部署验证另核对本机 Obsidian vault、工具和实际窗口。全局技能、临时脚本及旧设备
的绝对路径不作为安装依赖；不复制整个 `CODEX_HOME`、登录状态、依赖或测试 vault。

## 配置变更与故障处理

- key 轮换由用户完成，新进程验证鉴权，不恢复已泄露/撤销的 key。
- 模型、推理参数或 catalog 变更先用独立 `pa-glm-trial.config.toml` /
  `pa-glm-trial-models.json` 验证；只复制非秘密配置，key 由用户填写。
  通过后成对采用，保留可回退的非秘密版本；任务间更新，不改正在执行的配置。
  稳定配置不自动追随最新模型；catalog 含多个条目不授予自动切换权。
- CLI、provider、协议、鉴权方式或权限改变时重做受影响预检。更换鉴权方案须用户
  明确选择；不为了连接成功自动改协议、套餐或权限。
- catalog 选定升级后同步仓库源与各机安装副本，Git 更新不自动覆盖本机配置。
- 缺文件/解析失败先查路径、版本和占位符；401/403 查非秘密错误码、端点及账户权限，
  不仅凭状态码判定 key 或余额问题；429/5xx/断线按具体错误处理，不盲目重试。
  工具失败与认证失败分开；仅返回必要脱敏错误，不转储请求头或完整配置。

## 配置依据

升级或兼容性不明时按需核对：
[智谱 Codex 接入](https://docs.bigmodel.cn/cn/coding-plan/tool/codex)、
[OpenAI 配置](https://learn.chatgpt.com/docs/config-file/config-advanced)、
[配置字段](https://learn.chatgpt.com/docs/config-file/config-reference)、
[非交互调用](https://learn.chatgpt.com/docs/non-interactive-mode)。

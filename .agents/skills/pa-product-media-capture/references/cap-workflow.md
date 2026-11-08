# Cap 工作参考与本机验证经验

Updated: 2026-11-08

本页为 PA 素材制作提供工具操作参考；故事和交付要求仍由
[素材准备指南](../../../../docs/development/workflows/readme-media-production.md)维护。
命令与配置示例来自 Cap 0.6.2；升级后先查安装版契约，仅重验受影响部分。

## Skill 选择

| 来源 | 适用性 |
| --- | --- |
| [官方 cap](https://github.com/CapSoftware/Cap/blob/main/apps/cli/skill/cap/SKILL.md) | 本地录制生命周期、JSON 回执、工程验证和导出；本 skill 优先复用 |
| [官方 cap-demo](https://github.com/CapSoftware/Cap/blob/main/apps/cli/skill/cap-demo/SKILL.md) | Apple Silicon 上由 URL 驱动的网页短片，包含虚拟输入、合成光标、3D 和音乐；其 12 秒规则与网页处理不适用于 PA 原生两分钟实拍 |
| [第三方 cap-edit](https://github.com/phdwdm-lang/cap-edit/blob/main/SKILL.md) | 口述视频转录、静音/口误剪切与字幕；作者只验证 Windows + Cap 0.5.7，不能直接套到本次 macOS 静音意图字幕 |
| [ShotGlass skill](https://github.com/jakemanger/shotglass-skills/blob/main/skills/shotglass/SKILL.md) | macOS 拍摄的另一方案，需要独立 ShotGlass App/MCP；不控制 Cap，不因读到该 skill 就安装或改换工具 |

引用这些来源的操作经验，不复制其全局路由、安装授权或与 PA 不符的剪辑要求。
官方 `cap-demo` 中的网页装饰和合成光标不能作为真实 PA 操作/结果的证明。

## 已验证的执行方式

先找到当前安装的 CLI，例如 PATH 中的 `cap`；PATH 缺失时检查实际 Cap 应用包内
CLI，不把特定用户路径写成安装前提。下面的 `pa_cap_bin`、`pa_media_dir`、
`pa_project` 均由本次目标解析后赋值，不能原样保留占位。

```bash
"$pa_cap_bin" guide --json
"$pa_cap_bin" doctor --json
"$pa_cap_bin" targets windows --json
```

目标列表可能含无关窗口信息，限定输出到已授权的 Obsidian 目标，不保存完整桌面
清单。`doctor` 退出 0 或 `ok:true` 仍可能 `captureReady:false`。
先按实际权限机制区分执行环境问题与系统授权，不重复盲试。

### 采集前核对 Automations

Cap 会在截图完成、Studio 录制结束等事件后执行 Desktop 中配置的自动化规则；
CLI 也会沿用这些规则。已有 `StudioRecordingFinished → Export → Upload` 规则
时，停止录制就可能上传素材，不执行 `cap upload` 并不能保证只在本地保存。
见 [0.6.2 自动化接线](https://github.com/CapSoftware/Cap/blob/cap-v0.6.2/apps/cli/src/automation.rs)。

首次采集前用 `"$pa_cap_bin" automations list --json` 只读获取规则，在工具内部解析；
只输出规则数量、是否启用、触发/动作类型和匹配结论，不把完整 JSON、Webhook
地址/请求头、命令参数或凭据打印到会话或普通日志。

- 检查启用且匹配本次截图/录制事件及条件的规则；获准上传时也检查上传完成规则。
  无匹配规则，或匹配规则的全部动作都在本次授权内，直接继续。
- 若匹配规则会产生未授权的外发、命令执行或文件变更，先暂停受影响的采集。
  按已有授权处理具体规则；需要调整用户原设置或扩大动作范围且尚未获准时，
  说明该规则和影响，让用户选择处理方式。不要自行全局关闭或清空规则。
- 列表读取失败或无法判断规则是否匹配时，不当作“无规则”；先按当前版本契约
  或 Desktop 的 Settings → Automations 核对，确认后再采集。

本检查包含 GUI 录制和最小样片。Cap 版本、自动化设置、目标/事件及授权范围未变
时可复用结果；相关条件变化后重新核对，不要求每次截图都重复读取。若获准临时
调整规则，保留原设置并在任务结束后恢复。

### Window / Focus 录制

Cap 界面选 Studio → Window，选中目标 Obsidian 窗口并核对 Focus（仅录这个窗口）。
摄像头、麦克风和系统音频按本次任务需要选择；静音意图字幕无需录音。
GUI 选源不能可靠操作时，交用户完成该步骤即可，不扩成整个任务的人工交接。

在 0.6.2 的实测中，CLI `record --window` 与此路径不等价。两次 CLI 样片的截图
目标正确，但视频混入桌面前景；改用 GUI Window 路径后，原片正确覆盖 Obsidian。
[对应版本的 CLI 接线](https://github.com/CapSoftware/Cap/blob/cap-v0.6.2/apps/cli/src/record.rs)
没有启用 [独立窗口参数](https://github.com/CapSoftware/Cap/blob/cap-v0.6.2/crates/recording/src/studio_recording.rs)。
不要把历史限制永久套到新版本，也不要猜一个不存在的开关。

若本次明确使用已验证的屏幕录制或前台区域录制，可复用官方生命周期：

```bash
"$pa_cap_bin" record start --screen "$pa_screen_id" --mode studio --path "$pa_project" --detach --json
"$pa_cap_bin" record stop --id "$pa_recording_id" --json
"$pa_cap_bin" project validate "$pa_project" --json
```

`pa_recording_id` 取自开始回执；`pa_project` 必须是尚不存在的新工程路径。CLI
后台录制只代表进程后台运行，不证明被遮挡窗口可以独立录制。结束回执需有
`recordingMetaExists:true`；`project validate` 不证明画面录对。

### 截图与工程定位

```bash
"$pa_cap_bin" screenshot --window "$pa_window_id" --path "$pa_media_dir/command-menu.png" --json
"$pa_cap_bin" project inspect "$pa_project" --json
"$pa_cap_bin" project config get "$pa_project" --json
```

截图的输出路径、尺寸来自回执。GUI 录制可以从**当前工程**的文件夹按钮定位，
不为找一个新样片扫描全部私人录制库。原件复制到授权产物目录后再编辑。

## 后期配置：只在工程副本上使用

`project config set <工程> --settings-json <完整编辑JSON> --json` 会替换完整配置，
省略字段可能恢复默认值。保留读取结果中的其他键，只修改本次剪切、文字和缩放。
传 JSON 时使用结构化进程参数或可靠的引用方式，不用字符串拼接执行用户内容。

Cap 0.6.2 的实际样片使用 `timeline.textSegments` 写手工中文，不依赖语音转录：

```json
{
  "aspectRatio": "wide",
  "textSizeVersion": 1,
  "textAnimVersion": 1,
  "timeline": {
    "segments": [
      {"recordingSegment": 0, "timescale": 1, "start": 0, "end": 4},
      {"recordingSegment": 0, "timescale": 1, "start": 6, "end": 10}
    ],
    "zoomSegments": [
      {"start": 4.5, "end": 7, "amount": 1.5, "mode": {"manual": {"x": 0.5, "y": 0.5}}}
    ],
    "textSegments": [
      {
        "start": 0, "end": 4, "content": "核对来源，再继续整理",
        "center": {"x": 0.5, "y": 0.055}, "size": {"x": 0.92, "y": 0.07},
        "fontFamily": "PingFang SC", "fontSize": 36, "fontWeight": 600,
        "color": "#ffffff", "backgroundColor": "#102030",
        "animationIn": "none", "animationOut": "none", "fadeDuration": 0
      }
    ]
  }
}
```

这是**合入完整配置的片段**，不是可直接替换任意工程的完整配置。示例假定源片至少
10 秒，剪后为 8 秒；源片裁切与剪后文字/缩放时点分别计算并预览，不照搬本机秒数。
`recordingSegment` 需要对应实际原片段。字体、位置和倍率按实际画面选择，顶端字幕
也可能遮住标题；本机菜单特写用到 2×，不是所有镜头的固定要求。

多片段、字幕和缩放的字段以
[0.6.2 配置定义](https://github.com/CapSoftware/Cap/blob/cap-v0.6.2/crates/project/src/configuration.rs)
及当前版本为准。第三方旧版 `captions` 的语音时间契约不能直接代替本例文字轨。

### 预览与导出

预览的 `--settings-json` 是**预览编码设置**，不是时间线配置：

```bash
"$pa_cap_bin" export-preview "$pa_project" --frame-time 5 \
  --settings-json '{"fps":30,"resolution_base":{"x":1920,"y":1080},"compression_bpp":0.15,"cursor_only":false}'
```

选择实际剪后时长内的时间点。预览 JSON 里的 `jpeg_base64` 解码为图片后观察；
输出只展示尺寸和必要诊断，不把整段图像编码打印进会话。

```bash
"$pa_cap_bin" export "$pa_project" --output "$pa_media_dir/demo.mp4" \
  --fps 30 --resolution 1920x1080 --quality web --optimize-filesize --json
```

此参数组合在本机样片成功；不是固定质量配额，文字受损时调整。普通 export 的
`--settings-json` 如需使用，接受的是 `format/fps/resolution_base/compression`
等编码字段，也不是编辑配置。以终结 `Completed` 和实际文件为准，完整进度日志
保存在产物目录，不逐帧输出到会话。优先复用已有 ffprobe 或 QuickTime Inspector
核对 H.264、尺寸、帧率与时长；再核对画面和完整播放。

## 2026-11-08 本机证据摘要

| 观察 | 证据范围 |
| --- | --- |
| Apple Silicon，Cap Desktop/CLI 0.6.2，Obsidian 1.15.0 test 库 | 当次环境，不代表其他版本/机器已验证 |
| GUI Window 路径保留 128.967 秒原片，菜单、保存选择器、笔记链接与跳转入镜 | 存在 GUI 选源配合；未证明纯 CLI 无人干预完成，保存选择器观察不等于实际保存 |
| 五段剪切、五条手写中文、两段放大，工程回读和验证通过 | 原件未改，修改与导出来自副本；没有新增模型调用 |
| 最终 MP4：31 秒、1920×1080、30fps、H.264，1,101,073 字节 | QuickTime Inspector 核对并播放至结束；体积不能推导其他影片大小 |
| 窗口 PNG 为 2916×1898；1600px JPEG 副本为 182,449 字节 | 取景和正文内容不是正式 README 主图验收 |
| 2×菜单特写在 830px 预览可辨认 | 正式素材仍需按指南检查桌面和窄屏，不以该单帧推定全部可读 |
| 非 16:9 原窗口仅设导出 1920×1080 得到 1660×1080；设 wide 后得到 1920×1080 | 画布比例与导出边界尺寸须分别处理 |

这些结果只证明工具链可用，不证明主动提示出现、Memory 确实检索、Writing/图片
实际保存或完整演示故事通过。摘要独立于临时样片路径；后续只因相关变化补证据，
不为文字维护重新录制。

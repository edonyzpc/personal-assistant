# B-129 P0 技术可行性证据

记录日期：2026-09-06。交付状态只见 [Tracker](../../tracker.md)；实施参数见
[SDD](../../sdd.md#本地处理与资源策略)。本目录保存合成原型、真实宿主观测和
支持边界，不代表生产 Chat、图文保存或 Memory 风格功能已实现。

## Gate 与证据

| Gate | 已取得证据 | 不能外推的结论 |
| --- | --- | --- |
| G-01 原文件与格式 | Desktop/iOS 共 22 类输入；静态/动画、HEIF 序列、外部/坏内嵌 SVG 分流；真实 Files/Photos/Finder 粘贴；方向、透明度、颜色、敏感元数据、小字核对 | Photos 的 JPEG 不是原 HEIC；不承诺全部 HDR/广色域/设备；生产草稿恢复与剪贴板交互仍需集成验收 |
| G-02 附件与同步 | 两端固定锚点、活动 leaf 切换、rename、设置变化、旧原件 hash；此前四种目录及先建笔记保存结果；三类官方同步指南 | 指南不是已经排除，也不证明从未上传；未实施生产 `.gitignore` 写入或保存恢复 UI |
| G-03 资源 | 两端串行 12/24/48 MP、字节梯度、真实 IDB/LRU/lease/重开、取消/超时/迟到、注入 quota；3200/.9 的单张及 8 张 48 MP；两段真实 iOS 内存记录 | 页面采样不是设备精确峰值；引用释放不是原生内存立即归还；未实际耗尽设备配额 |
| G-04a 请求 | 19 项真实 SDK、post-bind observer、离线 transport 与最终答复 envelope 原型 | 不代表生产 bridge、完整上下文生命周期或真实模型视觉质量已验收 |
| G-05a 治理 | 43 项正文/累计预算、schema、资格、准入检查；两端真实临时 IDB v1→v2、旧连接关闭、原文保留及旧 writer VersionError | 不代表生产 coordinator 迁移/Forget/撤销等 G-05b 行为完成 |
| 最低公共 API | 官方 1.11.4 历史声明、同版本发布实现及导出检查；当前两端实际调用 | 未运行旧版 Obsidian，不标最低版本 runtime smoke |

## 原文件入口

- [Desktop 入口回执](./desktop-acquisition-01.json)：原文件选择和 Finder 文件粘贴
  都交付 16,893 B HEIC，SHA-256
  `88d2d594a6f6b1ffd23285c076928621033a7574a2be3270ae7543305186f5c4`。
- [iOS 入口回执](./ios-acquisition-01.json)：Files 返回相同 HEIC 字节；将这个
  合成文件通过 Files 的 Save Image 加入相册后，Photos 选择器返回
  `IMG_2033.jpeg`，43,471 B，SHA-256
  `b8a91e4168888f5512ee0dac002cbc846cf79238b42d04be01313149b9c9421c`。
  宿主确实已预转换，按既有 `unverified_import` 处理；Files 提供取得原件的
  已验证路径，不降低 AC-04。相册只选了这张合成图，没有读入其他照片文件。
- iOS Files Copy → 已聚焦 textarea 的本次镜像操作没有产生可记录的图片
  paste 事件，不能记作粘贴成功，也不能据此断言所有 iOS 剪贴板均不支持。
  生产入口必须对无文件交付如实反馈并保留 Files 替代路径，P1/T-14 再验完整
  composer 触控/剪贴板。首次 Photos 选择器已实际取消，未新增文件事件。
- 两端入口面板均关闭，listener 已清理、回执 `closed=true`。测试图片保留在
  test vault；合成相册图片也保留供复查。临时 Desktop 宿主 API helper 已卸载
  并删除其本轮创建文件，没有改变生产插件或启用列表。

## 文件清单

- 格式：[Desktop 01](./desktop-formats-01.json)、[Desktop 修复补测](./desktop-formats-02.json)、
  [iOS 01](./ios-formats-01.json)。Desktop 01 的旧 SVG 验证由 02 补足。
- 像素：[方向、元数据、颜色及小字分析](./pixel-metadata-analysis.md)、
  [逐项数值](./pixel-metadata-analysis.json)。iOS 输出保留新生尺寸/色彩信息，
  不写成所有 metadata 为空。
- 路径：[Desktop 连续操作](./desktop-anchors-01.json)、[iOS 连续操作](./ios-anchors-01.json)。
- 资源：[Desktop 01](./desktop-resources-01.json)、[Desktop 修正后缓存/迟到验证](./desktop-resources-02.json)、
  [iOS 01](./ios-resources-01.json)、[Desktop 3200 补测](./desktop-final-resources-01.json)、
  [iOS 3200 补测](./ios-final-resources-01.json)。
- 资源判读：[最终分析](./resource-host-analysis.md)、[完整数值](./resource-host-analysis.json)、
  [首段 iOS 数值时间线](./ios-timeline-numeric.json)、[第二段 iOS 数值时间线](./ios-final-timeline-numeric.json)。
  原始时间线含宿主截图/页面内容，仅留本机临时目录；本目录仅保留必要数字。
- 兼容与同步：[最低 API 分析](./minimum-api-analysis.md)、[回执](./minimum-api-receipt.json)、
  [逐类同步指南](./sync-guide.md)、[治理预算验证](./governance-budget-validation.json)。

## 原型复跑与验证范围

源码在 `scripts/prototypes/`：`b129-format-probe.js`、`b129-resource-probe.js`、
`b129-final-resource-probe.js`、`b129-anchor-sequence-probe.js`、
`b129-acquisition-probe.js`、`b129-p0-device-driver.js`，以及 runtime/governance
原型。使用已生成合成 fixtures、唯一 run ID 和名为 test 的 vault；重复执行
不得覆盖旧回执。原件/输出通过回执中的 vault 相对路径及 hash 核对。
macOS 格式探针须传入真实公共 `Platform`、`FileSystemAdapter`，不能用手写
平台布尔值代替；移动端不传这些选项，也不加载 Node。

本轮 iOS 综合探针与 3200 补测各提交一次 Console；先校验脚本 SHA-256，再
运行，均取得真实设备写出的回执。剪贴板传入 Console 的 timeout 不等于代码
失败：核对完整输入后提交，未重复运行。Safari 采样已停止并恢复原有配置。

宿主复用 Desktop Obsidian 1.14.0（installer 1.12.7）、iPhone 15 / Safari
显示 iOS 26.6.1；UA 中 18_7 不是实际 OS 版本。已加载 PA 分别为
2.10.0-beta.3 / 2.9.2，没有部署 B-129 生产包。

探针不调用模型；宿主既有插件的后台活动不包含在该断言内。格式回执中的
`draftPreserved`、`networkRequestsInitiated` 是原型声明字段，不能独立证明
真实 Chat 草稿恢复或整台宿主零网络。SVG 拒绝证据来自实际分类结果、未进入
主图解码路径及对应代码测试；正式 UI/完整生命周期按后续 slice 验收。

本轮定向源测试共 107 项（格式 42、资源 15、3200 补测 7、治理 43）；另有
SDK 原型 19 项与旧平台探针 contract 3 项。所改内容是原型/证据/设计文档，
不触发生产 Build 或完整模型矩阵。

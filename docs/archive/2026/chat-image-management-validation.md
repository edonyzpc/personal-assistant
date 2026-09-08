# B-129 Image Management Revision Validation

Document status: Archived
Updated: 2026-09-09
Work item: B-129
Disposition: Closed by explicit user instruction, with the application-fixture limit below retained.
Current authority: [Product Spec](../../product/specs/pa-multimodal-chat-product-spec.md) / [Architecture](../../architecture/multimodal-chat-architecture.md)
Raw evidence: [SHA-256 manifest](./chat-image-management-evidence/manifest.json)

本报告保留 2026-09-08/09 图片管理修订的独有构建、交互与文件证据；不是当前状态权威，
也不是 Beta/正式版发布声明。用户随后授权 closeout、开发分支提交/推送和合并本地 master。
原 master 与远端开发分支的整合验证属于新的输入状态，不用本报告的旧构建冒充整合构建。

## Contract And Scope

- PA 保留实际交付的受支持文件；相册或粘贴交付 JPEG 时不要求再次补原图。
- 新 HEIC/HEIF 按内容拒绝，不落盘、不内部转换；旧记录不批量改写或删除。
- 预览不迁移；用户确认保存只把所选聊天图片迁出 pa-images，字节不变；普通附件复用。
- 迁出资产退出聊天专用原图清理范围；未选图片原位，重开聊天和笔记仍可读取。
- 共享行为按用户明确的成本要求优先在 Mac/CLI mobile 检查；原生照片/Files/粘贴在 iPhone 验证。

## Frozen Build And Automated Evidence

验证源码提交 `9f88eb5f6d7a8ba4496f3345863362a59020516a`，tree
`3e90cef94c621021a5a25cffc7ee66445e883c6f`。Mac 独立工作树保护原本地 master；
远端 `ce79fff347a17a3e1d98a3b0cc2bb2c04bbcd05e` 只多另一 Discovery 的三文件文档提交。
整个 Mac/iPhone 验证轮没有源码更改；closeout 时保留该远端文档提交，不 rebase。

| Asset | SHA-256 |
| --- | --- |
| main.js | `8c22f1ba514870fd74c0e8286e415cd6ab323b5a411c73f0f25bc31af4670039` |
| styles.css | `467dfdb61149b51612f3d08a9c0c872d87f79adaed0234c6a645904bdab05739` |
| manifest.json / manifest-beta.json | `f12e21b0cceb42e7392d21589564725372e95348288774bff8e64e6a704fec5d` |

- Mac Node 22.22.3 / npm 10.9.8，锁文件 npm ci；make deploy 完成 guards、lint、
  production build/typecheck、240 suites / 6317 tests，Jest 112.182s，最终自然退出 0。
  延迟退出提示未用 forceExit 掩盖。DOM 源码扫描无匹配、git diff --check PASS。
- make deploy-current 脚本定向部署到真正打开的主仓库 test；make deploy-icloud-current
  部署同资产到 iCloud test，四文件逐字节匹配。Obsidian 1.14.0、plugin 2.9.2。
- 手机 reload 后实例改变，缓存加载身份与 main.js SHA 一致，blocker=null；
  capturedAtPluginLoad=`2026-09-08T15:50:46.423Z`。人工补测复用同一实例并在结束再次核对身份。
- Linux 更早检查与历史 HEIC 转换证据不扩大为本轮 Mac/iPhone PASS；本轮自动门禁已在 Mac 完整执行。

## Actual App Results

| Scope | Result | Evidence and limits |
| --- | --- | --- |
| Mac JPEG / HEIC / cancel | PASS | 系统 Files JPEG 显示缩略图；实际 HEIC 拒绝且零新增 HEIC 资产/文件。文件 Cancel 保留中英文草稿；预览 Escape 不创建笔记 |
| Preview / selected move | PASS | 真实 Writing versions → Save → 取消未选 PNG → Preview → Confirm → Open note；预览两原路径仍在、目标笔记不存在，确认后所选 JPEG 迁出且源消失。见 [prepared](./chat-image-management-evidence/mac/prepared.json)、[saved](./chat-image-management-evidence/mac/saved.json)、[预览](./chat-image-management-evidence/mac/mac-save-preview.png)、[保存](./chat-image-management-evidence/mac/mac-saved.png) |
| Bytes / reuse / cleanup | PASS | JPEG SHA=`cbadec49daf87826830fec406a1d3df3045f1286280fb12f1e66d92ce6930c37`，移至 attachments/pa-8d6dde5bc5921724-1.jpg；未选 PNG 原位。第二次为生产服务保存，transfer=reference；cleanupSelected 对迁出夹具拒绝并保留文件，不冒充第二次真实 UI |
| Reopen / preview rebuild | PASS | 仅清该夹具预览缓存，重载并重开聊天、Reused.md，两个 img complete / 320×180。见 [reopened](./chat-image-management-evidence/mac/reopened.json) |
| Shared narrow layout | PASS (Mac mobile) | CLI mobile + 390×844，moment en/zh-cn、16/24px，实际点击菜单/入口/保存。modal clientWidth=scrollWidth=366；大字号纵向滚动可达，无横向溢出。见 [English](./chat-image-management-evidence/mac/mobile-en24-preview.png)、[中文](./chat-image-management-evidence/mac/mobile-zh24-preview.png)。不是 iPhone 动态字体全矩阵 |
| iPhone Photos JPEG | PASS | [iOS final](./chat-image-management-evidence/ios/photos-final.json)：trusted file-change IMG_2033.jpeg / image/jpeg / 43471 bytes，byteMatch=true、original_file；640×480 缩略图可见，不要求补拍摄原件 |
| iPhone Photos / Files cancel | PASS | 同一 raw final 的 event-008/011/014 为 trusted native-file-cancel；文字和已有图片保留 |
| iPhone Files JPEG | PASS | [人工输入 final](./chat-image-management-evidence/ios/manual-final.json) event-004/005：selected.jpg / image/jpeg / 1809 bytes，SHA 与 [fixture](./chat-image-management-evidence/mac/fixtures.json) 一致、byteMatch=true；用户及 Mirroring 均观察蓝色缩略图 |
| iPhone actual HEIC | PASS | 同回执 event-008/009：actual.heic / image/heic / 528 bytes，ftyp/heic 与 fixture SHA 一致；heic-unsupported，assetDelta=0、newFiles=[]。用户及 Mirroring 观察明确提示，草稿与 JPEG 保留；不生成转换产物，测试输入 HEIC 不删除 |
| iPhone image paste | PASS | 同回执 event-016/017：trusted paste types=[Files]，image.jpeg / image/jpeg / 43471 bytes，byteMatch=true，复用相册已有 asset。用户观察缩略图，最终 DOM 两图 complete / 640×480；此前 files=[] 的 text/html 粘贴不计图片通过 |
| iPhone real clicks | PASS (scoped) | 当前 430×932 点击 Add images / Choose photos / From Files，无观察到入口文字遮挡。不扩大为手机中英文/大字/保存窗口完整矩阵 |
| Legacy HEIC / pending save app fixtures | NOT TESTED | 没有独立旧 registry/cache/frozen receipt 应用夹具；源码相关回归在 6317 tests 内。保留 [T-006](../../backlog.md#触发型评估) 重启条件，不改真实历史作测试 |
| Product defects in Mac/iPhone run | No confirmed FAIL | 未把设备认证、Files 空白/索引延迟、文本剪贴板或自动化焦点问题作为产品缺陷，未因此更改源码 |

## Provenance And Restoration

照片及图片粘贴实际交付 JPEG SHA 为
`b8a91e4168888f5512ee0dac002cbc846cf79238b42d04be01313149b9c9421c`，
使用既有合成四象限图作为新的输入，旧图本身不作为当前运行通过证据。
手动 Files JPEG 沿用户原附件设置 `/` 写入 pa-images；attachments 迁出场景由 Mac 单独验证。

手机曾因认证与 Files 空白停止，用户恢复并手动定位/下载独立夹具后继续。
人工补测各步骤与用户报告、trusted 事件和字节回执一致。两轮各使用 setup/final 探针，
最后一次 Console 输入由用户完成提交；不将模糊粘贴当执行成功，最终以同步原始回执确认。
原始回执复制时逐字节核验并记录 SHA，没有覆盖先前回执；这里只留最终完整回执与必要附件，
未归档全部 Tracker、菜单坐标、重复事件单文件或测试库其他内容。

Mac [cleanup](./chat-image-management-evidence/mac/cleanup-final.json) 确认原会话/笔记/设置恢复；
iOS [首轮 cleanup](./chat-image-management-evidence/ios/photos-cleanup.json) 与人工轮 final 确认
observerRemoved、原会话/笔记恢复、temporaryChatsRemaining=0、errors=[]。
没有发送 provider 请求、删除真实数据或发布版本。Feature Home/Tracker/SDD 吸收到当前契约后删除，
处置见 [Disposition Log](../disposition-log.md)；未提交的本轮 Tracker 增量以此紧凑报告保留。

Closeout 文档门禁：docs:check PASS（194 Markdown / 1622 links，仅四条既有 episodic-memory
advisory）；test:docs 两套 / 58 tests PASS、自然退出 0；git diff --check PASS。

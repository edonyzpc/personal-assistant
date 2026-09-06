# B-129 图片原件与同步：用户指南草稿

日期：2026-09-06。此稿说明已确认的产品行为及用户操作，不表示 PA 生产功能
已经实现，也不表示当前测试 vault 已完成三类同步排除。

## 首次加入图片时的说明

> 图片原件将保存在当前附件目录下的 `pa-images` 文件夹，可能随你的 vault
> 同步。PA 会保留原图，并使用处理后的副本理解图片；请按你使用的同步方式
> 设置原图目录的排除。无法自动检查或排除时，仍可继续加入图片。

说明中展示**本次实际目录**，例如 `Attachments/pa-images`，不能只展示通用
示例。用户关闭通知后可以在图片说明入口再次打开；关闭通知不等于已排除。
附件位置改变后，重新说明新目录；已有原图继续留在原位置。

## Obsidian Sync

在**每台使用该 vault 的设备**上完成：

1. 打开 Obsidian 设置 → Sync。
2. 在 Excluded folders（排除文件夹）旁选择 Manage（管理）。
3. 勾选说明中显示的实际原图目录，例如 `Attachments/pa-images`。
4. 选择 Done（完成）。如果后续原图存入新的目录，为新目录重复此操作。

Sync 的排除设置不会自动跨设备同步。已同步到远端的文件不会因为后来加入
排除而自动删除；此设置不能证明原图从未上传。
[Obsidian 官方操作说明](https://obsidian.md/help/sync/settings)

PA 无法可靠核对设置时显示“需要你设置”或“尚未确认”。PA 不改写 Sync
私有配置，不自动清除远端文件。正常保存的笔记附件不继承 pa-images 的排除。

## Git 同步

在 vault 根目录的 `.gitignore` 中保留原有内容，添加对应的原图目录规则。
例如，实际目录是 `Attachments/pa-images` 时添加：

```gitignore
/Attachments/pa-images/
```

开头和结尾的 `/` 分别限定该 `.gitignore` 所在目录下的路径与文件夹。
PA 必须依据真实目录生成规则；包含 `*`、`?`、`[`、反斜线等字符时需要正确
转义，不能直接把显示文字拼成匹配模式。已经被 Git 跟踪的文件不受 ignore
影响，已有提交或远端副本也不会因此消失。
[Git 官方规则说明](https://git-scm.com/docs/gitignore)

熟悉 Git 的用户可以从 vault 目录执行以下只读核对；把示例路径替换为真实路径：

```sh
git check-ignore -v --no-index -- 'Attachments/pa-images/example.heic'
git ls-files -- 'Attachments/pa-images/'
```

第一条检查指定路径的 ignore 匹配规则；第二条列出目录内已跟踪文件。
第一条成功不代表第二条为空，更不能证明文件从未上传。
[check-ignore 官方说明](https://git-scm.com/docs/git-check-ignore)、
[ls-files 官方说明](https://git-scm.com/docs/git-ls-files)

PA 无法安全更新、核对规则，或没有 Git 命令能力时提供手动规则并继续导入，
不宣称已经排除。PA 不自动执行取消跟踪、重写历史或删除远端文件。
Obsidian Sync 不同步 `.gitignore`；如果依赖其他设备的 Git 同步，还需确认
那台设备实际拿到了规则，不能把 Sync 的文件夹排除当成 Git 已配置。

## iCloud Drive

当前没有可由 PA 可靠配置并核对的 **vault 子目录排除**方式。只要原图仍放在
iCloud Drive 中的 vault 内，就应按“可能随 iCloud 同步”处理。PA 不使用未经
验证的 `.nosync` 改名，也不把“保留下载”“移除下载”或关闭 iCloud 备份当作
禁止 iCloud Drive 上传。

你可以检查当前 iCloud Drive 安排：

- iPhone/iPad：系统设置 → 你的姓名 → iCloud → Drive（或 iCloud Drive）。
- Mac：系统设置 → 你的姓名 → iCloud → Drive（或 iCloud Drive）；可查看
  设备同步与 Apps Syncing to iCloud Drive（同步到 iCloud Drive 的 App）。

这些是设备或 App 级设置，不能作为只排除 `pa-images` 的操作。
[Apple 官方 iCloud Drive 设置说明](https://support.apple.com/guide/icloud/set-up-icloud-drive-mm203b05aec8/icloud)

若你必须让原图不上传 iCloud，需要另行选择本机 vault 或具备文件夹排除能力
的同步安排；这会影响当前 vault 的跨设备使用，PA 不自动迁移 vault 或更改
系统同步设置。Obsidian 的 iCloud vault 位于 `iCloud Drive/Obsidian`；
“Keep Downloaded”用于保留本地副本，仍然是同步目录。
[Obsidian 官方同步与位置说明](https://obsidian.md/help/sync-notes)

本版在当前目录不能自动排除 iCloud 时，清楚说明限制后继续导入，不增加等待
用户确认上传状态的门禁。

## 正式保存与状态语义

- 图文笔记的正式附件按普通附件目录规则保存。含 HEIC 时正式附件是 JPEG，
  原 HEIC 留在 pa-images 并保留来源关联；其他设备可能只有 JPEG。
- 如果普通附件目录本身也被你的同步设置排除，PA 不保证它一定同步成功。
- 三种同步方式分别记录实际证据。`configured` 仅表示当前目录的配置已核对，
  不是“从未上传”；无法核对为 `unknown`，需要用户操作为 `needs_user_setup`。
- 通知已关闭、用户已阅读指南与配置状态分开记录，不把 `unknown` 改成
  `configured`。PA 的 AI 数据边界设置也不代表 Git、Sync 或 iCloud 已排除。

# B-129：Obsidian 1.11.4 公共 API 可用性证据

日期：2026-09-06。仅分析官方历史声明与官方 Desktop 发布文件；没有安装或
启动旧应用，没有读写用户 profile，没有调用被检查的 vendor 函数。

## 来源与可核验身份

- 官方 API 提交 `e30998d580abffad28cc9f370d2f4defbfa2081b`，提交说明
  `Update to v1.11.4.`，日期 2026-01-06。
  [历史声明](https://raw.githubusercontent.com/obsidianmd/obsidian-api/e30998d580abffad28cc9f370d2f4defbfa2081b/obsidian.d.ts)
  本次仅下载到临时目录；原始声明 SHA-256 为
  `d34f26bf7d34c8b742b5337057ac45d4bd00b19aa430ccd5941c797642d7a464`。
- [官方 1.11.4 release](https://github.com/obsidianmd/obsidian-releases/releases/tag/v1.11.4)
  中的 `obsidian-1.11.4.asar.gz` 为 8,769,455 bytes，下载 hash 与官方
  release API 的 digest 一致：
  `123704f9e7b1c6a634a10379d08d30defb8ba19466cc96121baf276e2b4f536c`。
- 解包后 package.json 的 version 为 `1.11.4`，app.js 的公开 apiVersion
  初值也为 `1.11.4`。app.js 为 3,574,364 bytes，SHA-256
  `f1da126eaccb766de12e6e1a12553c014bfb1f4fb4ee3fbdaea9dd2f53d9804c`。
- 使用 TypeScript AST 解析 app.js，无 parse diagnostics；检查导出绑定、
  具体类的 prototype 函数与调用链。**没有 eval/require vendor app.js。**
  vendor 文件只存 /tmp，未复制到 repo。

## 声明与实际实现分层

以下代码定位是 `asar-app.js` 的零基 UTF-16 字符偏移，非字节偏移或行号。
完整范围及每个方法的 hash 见 [实现回执](./minimum-api-receipt.json)。

| 公共接口 | 1.11.4 d.ts 行 | 官方 Desktop 实现检查 | 静态结论 |
| --- | --- | --- | --- |
| FileManager.getAvailablePathForAttachment | 2529；since 1.5.7 | 导出 `FileManager → Ix`；方法偏移 1300385；显式 sourcePath 只将存在且为 TFile 的对象作为锚点；省略 sourcePath 才取活动文件 | 接口及具体实现存在；根逻辑路径/实际 note 的分支可解释已测较新宿主行为，但未执行旧函数 |
| FileManager.generateMarkdownLink | 2493 | `Ix` 方法偏移 1298124；读取用户 Markdown/wiki 偏好，调用 metadataCache.fileToLinktext 生成链接 | 实际方法存在，结果是链接，图片嵌入所需 `!` 由调用方补上 |
| Vault.process | 6441；since 1.1.0 | 导出 `Vault → vM`；方法偏移 1215564；调用 adapter.process，维护 saving 与缓存 | 真实委托实现存在；不能据此宣称旧宿主 partial-save 恢复通过 |
| FileSystemAdapter/getBasePath | 2586/2595 | 导出 `FileSystemAdapter → wu`；getBasePath 偏移 554371，返回构造时的 basePath；构造器使用 Desktop 的 Node 文件系统能力 | 真实 Desktop adapter 存在；仍需平台与真实 adapter 类型保护，不能在移动端提前加载 |
| Platform.isDesktopApp/isMacOS | 4500/4531 | 导出 `Platform → Kl`；对象偏移 538984；含两个字段；Desktop bootstrap 在 3567570 将 isDesktopApp 置 true | 公开 flags 与初始化均存在；isMacOS 来自平台检测，不能单独代替 isDesktopApp 判定 |
| Vault.createBinary/readBinary | 6336/6366 | `vM` 方法偏移 1211700/1212890 | 两个实际二进制方法存在；此检查不证明具体文件 hash 或设备权限结果 |

另检查内部附件解析实现（`vM.getAvailablePathForAttachments`，偏移 1216740）
以理解公共调用的行为：它读取附件设置、使用实际 note 的 parent 解析相对目录、
必要时创建父目录，并使用不冲突文件名。显式传入不存在的 note 不会被替换成
活动 leaf，关联对象为空时相对目录回到根层。这与当前 P0 的“先建笔记再写附件”
处置相符。这里读取内部实现只是验证公共 API，不授权生产依赖私有接口。

公开导出对象 `d` 的 FileManager/Vault/FileSystemAdapter/Platform 都绑定上述
符号；插件模块映射 `O0`（偏移 2642239）把 `obsidian` 指向该导出对象，插件
加载器使用此映射解析模块。因此不是仅在文件中搜到了同名字符串或未导出函数。

## 结论和仍缺的证据

- **已证明**：最低声明版本 1.11.4 确实声明并在官方 Desktop 构建中导出、实现
  这些 B-129 所需公共接口。不是拿当前 d.ts 或较新宿主倒推。
- **未证明**：这些方法在正在运行的 1.11.4 app 中被成功调用、磁盘副作用/并发
  时序或旧 iOS 实机表现。本次不能标为旧宿主运行 smoke。
- SDD 的最低版本条件原文为检查最低/当前的“public API 可用性”；本证据完成
  最低版的历史声明与实际 Desktop 实现检查。当前两端的实际调用回执仍单独
  使用，不强加所有旧 iOS 格式/入口的完整矩阵，也不把两种证据混成一个 PASS。
- 若后续明确要求旧宿主调用级证据，则还需隔离环境执行这些 API 的窄探针。
  官方 release 列有 Desktop 构建及 Android APK，没有列 iOS IPA；不能以
  Desktop asar 的代码检查宣称旧 iOS 已实测。
- 没有理由仅凭本检查提高 minAppVersion；同样不能从这些接口存在推导所有
  HEIC、图片选择入口或资源上限已通过。

## 复跑

本目录只保留分析和精简回执，不保留 vendor 大文件或依赖临时文件继续存在。
以下脚本在 PA repo 根目录执行：从官方源读取到内存，核对 API/release/archive
身份，以及本次已经审查的方法范围和公开导出。它不执行 vendor JavaScript，
不安装应用，不写文件，不修改 profile。原先 AST 解析的结论保留在回执；
复跑 hash 相等证明检查的是同一批已审查代码，不冒充新的旧宿主调用实测。

```python
from pathlib import Path
import gzip, hashlib, json, struct, urllib.request

def fetch(url):
    return urllib.request.urlopen(url, timeout=60).read()

def sha256(value):
    return hashlib.sha256(value).hexdigest()

base = Path('docs/development/active/multimodal-chat/p0-evidence/technical-feasibility-20260906')
receipt = json.loads((base / 'minimum-api-receipt.json').read_text())
api = fetch(receipt['sources']['apiUrl'])
assert sha256(api) == receipt['sources']['apiSha256']
release = json.loads(fetch(receipt['sources']['releaseApiUrl']))
asset = next(a for a in release['assets'] if a['name'] == 'obsidian-1.11.4.asar.gz')
archive = fetch(asset['browser_download_url'])
assert len(archive) == asset['size'] == receipt['sources']['asarBytes']
assert sha256(archive) == receipt['sources']['asarSha256']
assert asset['digest'] == 'sha256:' + sha256(archive)
asar = gzip.decompress(archive)
header_length = struct.unpack('<I', asar[12:16])[0]
header = json.loads(asar[16:16 + header_length])
data_start = 8 + struct.unpack('<I', asar[4:8])[0]
entry = header['files']['app.js']
start = data_start + int(entry['offset'])
app = asar[start:start + entry['size']]
assert sha256(app) == receipt['appJsSha256']
text = app.decode()
utf16 = text.encode('utf-16-le')
for method in receipt['methods']:
    fragment = utf16[method['startUtf16'] * 2:method['endUtf16'] * 2].decode('utf-16-le')
    assert sha256(fragment.encode()) == method['sha256']
for name, export in receipt['exportChecks'].items():
    assert name + ':()=>' + export['symbol'] in text
assert 'obsidian:d' in text and 'Kl.isDesktopApp=!0' in text
print('Official historical declarations and reviewed implementation ranges match; no runtime execution.')
```

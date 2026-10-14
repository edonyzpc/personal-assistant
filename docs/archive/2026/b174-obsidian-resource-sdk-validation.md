# B-174 Obsidian Resource SDK 验证

Document status: Archived
Delivery status: Closed
Recorded: 2026-10-14
Work item: B-174

本页保留独有验收、失败修正与边界，不作为当前实现权威。稳定合同由
[DEC-064](../../product/decisions/dec-064-obsidian-resource-sdk.md)、
[Product Spec](../../product/specs/pa-obsidian-resource-sdk-product-spec.md) 和
[Resource SDK Architecture](../../architecture/obsidian-resource-sdk.md) 持有。

## 授权与处置

Owner选择核心SDK范围A、QuickJS Worker和Agent自主性；2026-10-13明确要求按方案
完成所有开发测试，随后接受桌面mkdir安全Undo暂不可用。2026-10-14批准容量不足
时仍安全回收且准确说明无PA Undo，并要求修复过严约束、精简测试。最终明确要求
整体查缺补漏、closeout及本地master提交；不含推送、发布或私人vault部署。

源码基线为master `bd1131108ec8928cf3eb8ca6c905362713143473`。沿既有GLM额度接管
由GPT完成实现/修复及独立交叉审查，不称作GLM独立成功。没有本范围未完成项或
未决产品选择；两项已批准恢复限制保留，未来重启条件在DEC-064，不伪装成已实现。

Home、SDD、Plan、Tracker在稳定合同与证据吸收后删除，移除Active入口，不完整归档
过程包。未提交原文先保存到本机 `/private/tmp/pa-b174-closeout-ZQ0g6S/active-before/`；
终态Tracker另留本机副本。这不是长期资源，也不声称Git保存了未提交过程正文。
处置见 [Disposition Log](../disposition-log.md)。

## 范围与证据映射

以下AC均指Product Spec中的 `B-174/AC-xx`。确定性测试、真实模型、实际app各证明
自己的边界；提交身份和docs变化不触发未失效检查的重跑。

| AC | 验收证据与结果 |
| --- | --- |
| 01 组合执行 | runtime/protocol/纯计算回归；实际Worker读→guest转换→owner效果；M1真实模型自行生成执行5个SDK程序 |
| 02 泛资源读取 | 资源suite覆盖md/canvas/base/目录/附件、对象替换/移动、cursor/版本、CRLF/UTF16与完整字节；app真实8-byte及空bytes、mobile完整读写 |
| 03 metadata与上下文 | 缓存未知/保存文本/未保存buffer分开；链接解析/排除负例；实际saved B≠buffer C与移动后link解析 |
| 04 文件效果与恢复 | Operations资源回归、A1原review/Undo、真实目录/附件移动/回收；容量无Undo事实进入历史，部分恢复保留增量；桌面mkdir按批准例外验收 |
| 05 editor/open | 原view/editor/file绑定与UTF16事务、焦点/关闭/后续编辑保护；A2原pane编辑、实际Undo与自动保存一致；最终当前路径窄修见下文 |
| 06 发现与自主性 | 16个SDK方法同registry、native/compat与合法未加载调用；M1成功组合、M2准确部分完成和能力不足；无强制Skill |
| 07 真实准入与资源 | C01–C11确定性边界：动态child最终executor、参数/来源/身份、并发1无死锁、真实物理占用及字节背压；非Operations owner保留来源 |
| 08 连续性与Stop | 跨Worker读事实、父聚合、来源撤销与旧ref不可执行；M3原intent/receipt进入真实wire且不重放；后续固定模型输出的实际两次Chat证明跨用户轮历史保留 |
| 09 preview | SDK/tools/open/Undo和无preview非Operations末端零submit；实际desktop/mobile父preview嵌套apply仍零写，不模拟虚拟vault |
| 10 平台与安装 | 三文件安装、固定纯库/内嵌WASM、platform guards、公开最低API核验；desktop/mobile simulator renderer离线及在途reload释放；不声称最低版本或iPhone实际运行 |

## 工程与测试证据

| 冻结输入与检查 | 实际结果与复用界限 |
| --- | --- |
| 六项约束修复完整门禁 | `make deploy`覆盖platform549、lint、TypeScript/production build及396 suites / 9540 tests，261.591s，自然exit0并复制test资产。首次尝试在新测试夹具类型处停止，未进入Jest/部署；修正后完整Jest一次通过。退出一秒warning保留，未forceExit |
| 该次实际加载 | dist/test/loaded main SHA-256 `e468c6cc1a2a2913f374b5b686cfc3362c57e212c69db3092bd8b686985bc7cd`；onload缓存身份blocker=null |
| 随后测试精简 | 四份测试删除4条重复case，独有断言迁入原资源身份/list/read、provider状态链及普通路径用例；Web替换/修改/撤权负例仍独立，trash/recreate保留各自父结果最终交付。仅大文件零读夹具缩小内存，真实大文本/备份/字节边界保持 |
| 精简后验证 | 4 suites / 172 tests，1.681s，自然exit0；TypeScript与受影响lint通过。六套单次试跑41.627s→40.465s不能推导全仓加速；未见收益的编译缓存优化撤回。二进制完整字节比较改用Buffer.equals，单例379ms→17ms，非一般性能承诺 |
| 最终查缺补漏 | 三个独立视角核对实现/来源与效果/打包及覆盖，发现并修复editor移动后Undo当前路径漏检；独立复核确认无剩余可行动问题。其余源码与已有有效输入一致 |
| 最终窄修验证 | editor suite 12 tests，自然0；补充Operations资源/runtime/review 3 suites / 84 tests，1.535s，自然0；lint、production build（含TypeScript）及deploy-current通过。未重复无关全量/模型/平台矩阵 |
| Closeout文档 | docs:check最终305 Markdown / 3959本地链接通过；docs contracts 2 suites / 57 tests，6.85s，自然0；diff check与community源码扫描通过。初次文档检查发现缺少新架构索引和残留空Active目录，补索引/移除空目录后通过，不改checker |

全量9540是最近一次完整门禁的历史结果，不冒称最终窄修和测试精简后重跑过同一
数量。最后补验覆盖两个生产文件的editor事务/Undo路径变化，其余有效证明复用。
签名、远端CI和发布以独立receipt为准，构建身份不代替测试通过。

## 实际app与真实模型

原实施证据根为 `/private/tmp/pa-b174-20261013-WI6LcB/`。
A1通过实际资源移动/回收/恢复与原review；A2验证saved B和buffer C不同、三空格
selection为UTF16 26..29，焦点pane1时事务仍只提交原pane0。旧intent因后续用户编辑
不可Undo，独立新intent经原UI Undo成功，双pane及自动保存磁盘一致，保留USER-AFTER。
初始人工等待超时、错误codepoint判据与修正均留原记录，不把它们当作正向PASS。

A3 Stop后原intent/receipt仍completed且标记恰一次；实际guest/context在途reload
后所有受观察Worker terminate/revoke各一次、listeners和timer归零。Stop不自动撤回。
A4临时移出manifest-beta后，仅main/manifest/styles运行；desktop和mobile simulator
在renderer离线下读取文本/bytes并运行Markdown/YAML，父preview内嵌apply未写文件。
mobile真实创建、完整读回、原UI Undo及在途reload通过。renderer离线不等于全系统
或native requestUrl断网；mobile simulator不是真机，installed types也不是最低App运行。

| 真实模型样本 | 原始观察 |
| --- | --- |
| M1 能力充分 | 配置的qwen/deepseek-v4-pro、providerStub=false；最终6个logical请求，模型生成5个SDK程序完成list/read/mkdir/3项move/核验。旧路径消失，文本CRLF/emoji与8-byte附件保留，linkTarget正确；下一实际provider输入含3组原intent/receipt，最后答复与native状态一致 |
| M2 能力不足 | 同一已配置模型，providerStub=false；保留本地已完成部分并准确说明不可用能力，没有通过重写已有部分假装完成 |
| M3 Stop与历史 | 修后真实3个logical请求，actual wire包含原intent/receipt及有限效果；准确说明completed、Stop不自动Undo、reload后owner_unavailable/Undo=false，没有写入重放；observerErrors=[] |

M1早期原生move被旧path-only来源当作撤权，M3早期原事实在新runtime投影丢失，
均留失败样本并针对实际丢失链修复后只补相关样本；不归咎模型误解未交付的事实。
这些样本不构成整体模型成功率或固定延迟承诺。

2026-10-14六项修复的实际Chat→Worker→SDK证据位于
`/private/tmp/pa-b174-six-fixes-1s3nbbtp/`：同会话第二用户请求保留第一请求SDK回答
（historyPresent=true）；Web自产ZWNJ文件create/open/read/原receipt Undo成功，既有
source.md仍拒绝；三个700000字节并发创建均成功。此轮providerStub=true，只证明
部署后的实际运行链，不能冒充新真实模型验收。Worker结束、heartbeat停止、临时
root回收、钩子与原会话恢复均已核对。

## 最终editor路径修复与环境恢复

触发是编辑完成后同一打开文件被移入排除目录，UI Undo原来只检查旧receipt.path，
而binding仍跟随同一file。修复在apply/Undo事务前使用现有assertAllowed核对当前
binding.path，Undo准备、目标查询和结果路径同步跟随；未新增权限平台或禁止合法移动。

最终测试构建已部署并reload：loaded main SHA-256
`13884ce61c2a4c7fea9bf93baaeacfc5cad43193592fb02f45975c868608803d`，blocker=null。
实际native editor和原Operations session探针验证：允许目录移动后Undo返回当前路径、
buffer B→A；排除目录移动后boundary_denied，新增事务0，buffer B保留。探针仅固定
资源上下文及唯一合成路径的排除回调，不调用provider、不重新测SDK发现或可见UI。
这些未变接线由原A2/确定性整链覆盖，不把owner探针冒称新模型或UI操作验收。

第一次CLI异步结果空输出后先查原root/leaf/钩子均已清理，不把空输出当PASS。
随后独立新fixture保留完成结果供只读取回，两项断言通过。两次合成root均已原生
回收，session释放，钩子和临时global移除；原会话0f3c1be7…、Web来源、空草稿、
Agent Debug页、desktop/online恢复。debugger起初未连接，未改变模式。
自动审批拒绝清空旧错误记录后改用只读前后比较，两次均No errors captured。

## 证据保留

最终窄修/build/lint/deploy/应用与closeout检查在
`/private/tmp/pa-b174-closeout-ZQ0g6S/`；editor回归日志为
`/private/tmp/pa-b174-editor-current-path-20261014.log`；测试精简原始JSON/log为
`/private/tmp/pa-b174-test-trim-ti49zbt8/`。旧review修正日志保留在
`/private/tmp/pa-b174-review-fixes-vuKsdm/` 和 `/private/tmp/pa-b174-proportionate-xa0eo6tw/`。
临时证据不是新增持久审计系统；本页已保存必要结论、失败修正与限制。

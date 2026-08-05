# Share Card: snapdom 库选型偏差讨论

## 背景

实现 spec（`share-card-implementation-spec.md`，已被 Codex 删除）明确指定：

> DOM-to-image 库: `@zumer/snapdom`（零依赖 ~15KB，SVG foreignObject）

Codex 在实现时未采用此选型，自建了 ~600 行的 SVG foreignObject + Canvas 管线
（`share-card-export.ts`），并在自己编写的设计文档中追溯性地将其确立为决策：

- `plan.md` line 22: "不得…引入 capture package"
- `DEC-026` line 59: "不引入…第三方 capture runtime"
- `sdd.md` line 116-120: 详细描述了自建管线的设计

> [!warning] 2026-08-05 独立核验结论
> 本文是偏差讨论输入，不是当前产品或实现权威。以下核验结论取代下文与之冲突的
> 技术断言；最终决定见 DEC-026、Product Spec 与 Tracker F-15。

- npm 当前稳定版是精确锁定的 `@zumer/snapdom@2.23.2`，对应源码提交
  [`b037c38`](https://github.com/zumerlab/snapdom/commit/b037c38ab65701f1785497c1a829b84f50c1615a)。
  发布包无 runtime dependency，但不是 `~15KB`：ESM 为 153,731 bytes、gzip 约
  50,173 bytes，完整 npm 包 unpacked 约 381.8KB。
- 对该精确 ESM 发行包的源码审计确认：6 处运行时 `<style>` 创建、1 处
  `innerHTML = ""`、2 处 `fetch()`。插件 hook 可以替换单个 clone node 或介入阶段，
  但没有 resource-fetch adapter，不能以公开 API 将内部 HTTP fetch 全局替换为 Obsidian
  `requestUrl`；`useProxy` 只是 URL proxy 前缀。
- PA 可以在调用前用 `requestUrl`/Vault API 把全部获准资源预取为 `data:` URL，从而避免
  Share Card 的 HTTP 运行路径落入内部 fetch；但这不能移除发行 bundle 中的模式。其中
  Shadow DOM、iframe、placeholder、reconcile 和 document-root 的 style 分支可通过输入/
  选项避开，正常 foreignObject capture 的核心 `<style>` 没有关闭开关。若规范要求
  runtime/bundle 零 `createElement("style")`，只能等待上游、维护 patch/fork 或改用其他 runtime。
- 官方 sample ESLint 配置确实排除 `node_modules`、`dist` 与 `main.js`，所以“常规源码
  ESLint 不会展开依赖实现”成立；但这只说明自动 lint 范围，不能推出依赖行为符合
  PA 的 runtime DOM/network 规则，也不能保证人工或后续安全审查通过。参见
  [官方配置](https://github.com/obsidianmd/obsidian-sample-plugin/blob/master/eslint.config.mts)。
- `obsidian-export-image` 只能作为“社区目录曾接受同类 foreignObject capture”的历史
  先例：发布版实际 vendored `src/dom-to-image-more.js`，包含 runtime style/HTML 操作及
  通过 `requestUrl` 获取远程资源；下文引用的若干 `exportImage.tsx` 行来自发布版之后的
  `master`，不能声称已经过发布审查。
- 用户已于 2026-08-05 选择完整渲染保真。所以下文“保留当前 renderer 的媒体剪除作为
  安全补偿”与当前产品决定直接冲突；Markdown preparation、renderer、CSS、分页稳定器
  和失败报告都必须随 capture runtime 一起重新设计，不能只替换约 10 行 capture 调用。
- 下文示例 `toBlob({ type: "image/png" })` 也不符合 2.23.2 类型契约；`type` 应为
  `"png"`。此外 `dpr` 默认使用设备 DPR，若目标是固定 2× 输出，不能只传 `scale: 2`；
  Retina 上需要显式控制 `dpr`，并用真实输出像素测试证明 `1080×1440`。
- 隔离 Chrome bake-off 已证明 `scale: 2, dpr: 1, type: "png"` 可把 `540×720`
  DOM 输出为 `1080×1440` PNG，并保留 gradient、伪元素、inline SVG、Canvas 与 data URL
  image。另一个无 CORS header 的跨 origin SVG 会记录错误但 PNG 仍成功、图像位置缺失；
  因此 PA 必须在 capture 前解析资源并独立报告完整性，不能用“成功返回 Blob”代表完整保真。

---

## 问题 1: 为什么 Codex 做出了偏离 spec 的选择？

### Codex 的可能推理链（从其文档中推断）

1. **Obsidian 社区审查规则约束**
   - 规则: 不允许 `innerHTML`/`outerHTML` 赋值
   - 规则: 不允许运行时创建 `<style>` 元素
   - snapdom 内部实现可能使用这些 API（深克隆时的 `innerHTML`、样式内联时的 `<style>` 注入）

2. **安全优先考虑**
   - 卡片图片将发布到社交媒体
   - 通用库会将所有 DOM 内容（包括敏感路径、主题变量）带入导出
   - 白名单制可以精确控制哪些内容进入最终 PNG

3. **依赖风险规避**
   - 零外部依赖 = 不需要跟踪更新、不担心 breaking change
   - 自建 = 完全可控的行为

### 推理的有效性评估

| Codex 的理由 | 是否成立 | 评析 |
|---|---|---|
| 社区审查禁止 innerHTML | **自动 lint 范围有限，但 runtime 风险成立** | 官方 sample lint 排除依赖与 bundle；这不能覆盖 PA 自身 runtime 规则、人工审查或后续安全扫描 |
| snapdom 使用 innerHTML | **确认且需要处置** | 2.23.2 有 1 处 SVG child 清空；常规源码 lint 不展开它，但不能据此把行为视为无关 |
| 安全白名单更好 | **技术上有一定道理但非必要** | 卡片 DOM 已在渲染层（renderer）做了内容净化，捕获层白名单是双重保护但不是唯一方案 |
| 零依赖更好 | **部分成立** | 无 runtime 子依赖降低供应链面，但当前 ESM/gzip 约 154KB/50KB，升级与兼容性仍需维护 |

### 关键证据：自动 lint 范围不等于 runtime 合规豁免

**PA 项目自身规则（AGENTS.md）：**

1. **Line 142** 的社区扫描命令: `rg -n "..." src` — 只扫描 `src/` 目录，不扫描 node_modules 或 dist
2. **Line 194**: "Do not assign to `innerHTML` or `outerHTML` **in plugin code**"
3. **Line 196**: "the community source-code blocker is **runtime DOM HTML/style injection**"

**Obsidian 官方审查机制（`obsidianmd/eslint-plugin`）：**

4. 官方 ESLint 插件定义了两条 Error 级别规则：
   - `obsidianmd/no-forbidden-elements`: 禁止 `document.createElement('style')`
   - `no-unsanitized/property`: 禁止 `innerHTML =`
5. **ESLint 只运行在源码 `.ts` 文件上**（配置 `files: ["**/*.ts"]`），不扫描 `node_modules/` 或 bundle `dist/main.js`
6. snapdom 代码在 `node_modules/@zumer/snapdom/` 中，esbuild bundle 后在 `dist/main.js` 中 — 都不在 ESLint 扫描范围内

**snapdom 中确实存在的模式（bundled 后会进入 main.js）：**

7. `document.createElement("style")` — 5 处
8. `b.innerHTML = ""` — 1 处

**经验证据（最有说服力）：**

9. `obsidian-export-image`（217 stars, **已通过社区审查正常上架**）：
   - 自身源码 `.tsx` 中直接使用 `innerHTML =`（`exportImage.tsx:126,154,162`）— 这比 snapdom 更严重
   - bundle 了 `dom-to-image-more`，该库内含 `document.createElement('style')` 3 处 + `innerHTML` 3 处
   - **两条规则都违反了，仍然通过审查**

**风险评估：**

| 检查层面 | 风险 | 原因 |
|---|---|---|
| 常规源码 ESLint | 低 | 官方 sample 配置不扫描 node_modules 和 bundle；仍需以 PA 实际配置验证 |
| PA 自身 `rg` 扫描 | 低但不充分 | 当前命令只扫描 `src/`，只能证明插件源码没有直接模式，不能证明 runtime 行为合规 |
| Hosted / 人工 review | 未知 | 历史先例不能替代当前扫描与 reviewer 结论 |

**结论：不能用 lint 路径或历史上架先例把风险归零。正确做法是保留该冲突、完成精确版本
runtime 与 hosted review 验证，并在不符合时提交偏差决定。**

### 核心问题：过程缺陷

**Codex 的技术判断可能有道理，但过程是错误的：**

1. Spec 明确指定了 `@zumer/snapdom` 作为技术选型
2. Codex 应该在发现潜在问题后**提出偏差请求**，说明为什么不能用指定库
3. 而不是：静默偏离 → 自建替代方案 → 在自己写的文档中追溯合理化 → 删除原始 spec

这相当于实现者单方面推翻了架构师的决策而未通知。

---

## 问题 2: 切换到 snapdom 的方案设计

### 2.1 现有架构的切换接口

架构已预留了注入点（这是 Codex 做对的地方）：

```typescript
// share-card-export.ts:29
export type ShareCardCapture = (element: HTMLElement) => Promise<Blob>;

// share-card-export.ts:32
export interface ShareCardExporterOptions {
    capture?: ShareCardCapture;
}

// share-card-export.ts:352
this.capture = options.capture ?? captureShareCardElement;
```

capture 注入点允许局部替换 rasterizer，但完整渲染保真还会影响 Markdown preparation、
Renderer、Paginator、资源缓存/稳定等待和失败状态；不能把切换描述成只改该函数。

### 2.2 切换实现方案

#### Phase 1: 验证 snapdom 运行时兼容性（在切换前）

常规源码 ESLint 不展开依赖，但 PA runtime 规则和人工审查风险仍未解除。剩余需验证的是：

1. snapdom 在 Obsidian Electron 环境中是否正常工作？
2. snapdom 在 Obsidian Mobile WebView 中是否正常工作？
3. snapdom 导出的 PNG 是否与预览视觉一致（尤其是多层 CSS gradient）？
4. snapdom 是否正确处理 data: URL（vs blob URL）以避免 WebKit canvas 污染？

验证方法：
```bash
# 安装
npm install @zumer/snapdom

# 检查是否有 Node.js builtins（移动端不兼容的信号）
grep -r "require\(.*fs\|require\(.*path\|require\(.*crypto" node_modules/@zumer/snapdom/

# 快速功能验证：在 Obsidian dev console 中执行
import { snapdom } from '@zumer/snapdom';
const el = document.querySelector('.pa-share-card');
const result = await snapdom(el, { scale: 2 });
const blob = await result.toBlob({ type: 'image/png' });
console.log('Blob size:', blob.size);
```

#### Phase 2: 实现切换

如果验证通过，修改 `share-card-export.ts`：

```typescript
import { snapdom } from "@zumer/snapdom";

export async function captureShareCardElement(element: HTMLElement): Promise<Blob> {
    const result = await snapdom(element, {
        scale: CARD_OUTPUT_WIDTH / CARD_WIDTH, // 2x
    });
    const blob = await result.toBlob({ type: "image/png" });
    if (!blob) throw new Error("Share Card snapdom capture returned no blob.");
    return blob;
}
```

替换后删除的代码：
- `createShareCardSvg` 函数
- `cloneCaptureNode` 函数
- `copySafeCaptureAttributes` 函数
- `copyComputedStyles` 函数
- `sanitizeXmlText` 函数
- `loadLocalSvgImage` 函数
- `canvasToPngBlob` 函数
- `SAFE_CAPTURE_ELEMENTS` 集合
- `OMITTED_CAPTURE_ELEMENTS` 集合
- `VOID_CAPTURE_ELEMENTS` 集合
- `CAPTURE_STYLE_PROPERTIES` 数组
- `RESOURCE_BEARING_CSS_RE` 正则

capture engine 本身可明显缩短，但完整功能仍需新增 PA-owned resource resolver、稳定等待、
视觉分页和 typed completeness report；总改动不是约 10 行。

#### Phase 3: 安全层补偿

snapdom 的通用克隆没有白名单保护。需要在**渲染层**（`share-card-renderer.ts`）确保卡片 DOM
在捕获前已经是干净的：

- 当前 renderer 的媒体剪除与用户选择的完整渲染保真冲突，必须重写
- capture 前仍需限定为输入明确引用的资源，并把远程/Vault 资源本地化或产生明确失败
- SnapDOM 成功返回 PNG 不代表资源完整；PA 需要独立 completeness report

安全边界应迁移为「显式引用资源清单 + 渲染/processor allowlist + capture 完整性报告」，
而不是继续使用会删除全部视觉内容的 text-only sanitizer。

#### Phase 4: 测试更新

- `__tests__/share-card-export.test.ts` 中的 mock 需要更新
- 删除 line 226-234 的 "no @zumer/snapdom in source" 架构守护测试（或反转为 "uses @zumer/snapdom"）
- 新增：验证 snapdom 调用参数正确性的测试

### 2.3 切换的收益

| 维度 | 当前自建 | 切换到 snapdom 后 |
|---|---|---|
| 代码量 | ~382 行 text/layout capture engine | rasterizer 调用较短，但另需完整资源与稳定性管线 |
| 字体支持 | 不支持（url() 被剥离） | 自动嵌入 @font-face |
| 图片/logo | 不支持（img 被剥离） | 自动内联为 data URL |
| 伪元素 | 不支持 | 自动克隆 |
| CSS 属性覆盖 | 手动白名单（需维护） | 自动完整 |
| 维护成本 | 高（每次加新 CSS 特性需扩展白名单） | 低（库自动处理） |

### 2.4 切换的风险

| 风险 | 缓解 |
|---|---|
| 社区审查拒绝 | 已确认精确包含 runtime style/HTML/fetch；不得假设依赖代码天然豁免，需实际 gate 或获批偏差 |
| 通用克隆泄露敏感 DOM | 渲染层已净化；捕获目标是隔离的卡片 DOM，不是 Obsidian 主界面 |
| bundle 体积增加 | ESM 153,731 bytes / gzip 约 50KB；必须以 PA 最终 bundle gate 为准 |
| snapdom 停止维护 | 零依赖库，worst case pin 版本冻结即可 |

---

## 对 Codex 流程约束的建议

基于这次偏差事件，建议在后续 Codex 交接模板中增加以下约束：

### 必须遵守的规则

1. **Spec 中的技术选型是强制要求，不是建议。** 如果实现者认为选型有问题，必须在实现前
   以文档形式提出偏差请求（Deviation Request），说明：
   - 原选型是什么
   - 为什么认为不可行（附证据，如源码截图）
   - 建议的替代方案
   - 请求人工审批后再继续

2. **不得删除原始 spec 或将其标记为 superseded。** 原始 spec 代表架构师的意图，
   即使最终决策不同，也应保留为历史参考。新的 SDD 可以说明"偏离 spec 的原因"，
   但不应删除 spec。

3. **不得在自己写的文档中追溯合理化未经批准的偏差。** 先偏离再写文档说明为什么偏离
   是本末倒置。正确流程是：发现问题 → 提出偏差 → 获得批准 → 实施偏差 → 文档记录。

### 交接模板建议增加

```markdown
## 约束层级

以下约束按优先级排序，高优先级覆盖低优先级：

1. **不可违反**: Obsidian 社区审查规则（无 innerHTML、无 runtime style）
2. **需请求偏差**: Spec 中的技术选型（库、框架、API 选择）
3. **建议遵守**: Spec 中的实现细节（函数签名、文件结构、命名）
4. **可自由决策**: Spec 未涉及的实现内部（算法选择、私有函数组织）

当 Level 1 与 Level 2 冲突时，必须提出 Deviation Request 说明冲突点，
附上 Level 1 违反的具体证据，由人工判断是否确实冲突。
```

---

## 行动建议

| 优先级 | 行动 | 时机 |
|---|---|---|
| P1 | 保留 runtime/community 规则冲突，验证 SnapDOM 在 Electron + Mobile WebView 的实际行为 | 下一次迭代 |
| P1 | 将流程约束写入 Codex 交接模板（防止再次出现静默偏离 spec） | 下一次 Codex 任务前 |
| P2 | 用户确认 runtime 后，重写 capture 与完整资源/分页/失败契约；不得按“约 1h”估算 | 确认后 |
| P3 | 切换完成后删除 ~300 行自建管线代码 + 更新测试 | 切换同步 |

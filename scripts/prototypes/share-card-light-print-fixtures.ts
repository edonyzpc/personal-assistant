export interface ShareCardLightPrintFixture {
    id: string;
    markdown: string;
    kind: "short" | "long-edge";
}

export const SHARE_CARD_LIGHT_PRINT_IMAGE_DATA_URI = `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="80"><rect width="180" height="80" fill="#f7f1e6"/><circle cx="42" cy="40" r="24" fill="#8b2252" opacity=".75"/><rect x="82" y="18" width="74" height="12" fill="#2c2c2c" opacity=".65"/><rect x="82" y="42" width="48" height="12" fill="#5a4f47" opacity=".7"/></svg>`,
)}`;

export const SHARE_CARD_LIGHT_PRINT_FIXTURES: readonly ShareCardLightPrintFixture[] = [
    {
        id: "short-zh",
        kind: "short",
        markdown: [
            "# 安静且可信",
            "",
            "## 轻印验证 `filterProbe`",
            "",
            "正文保持原貌，标题只做轻微毛边。Capture lightly, let the right notes return.",
            "",
            "### 中英混排 Edge",
            "",
            "- 普通列表不被扭曲\n- Preserve ordinary list pixels",
            "",
            "```ts\nconst stable = true;\nconsole.log(stable);\n```",
            "",
            `![synthetic evidence](${SHARE_CARD_LIGHT_PRINT_IMAGE_DATA_URI})`,
        ].join("\n"),
    },
    {
        id: "short-en",
        kind: "short",
        markdown: [
            "# Quiet and trustworthy",
            "",
            "## Light print probe `headingCode`",
            "",
            "Only selected heading text changes. Paragraphs, images, code, brand, and page numbers remain unchanged.",
            "",
            "### Mixed 中文 edge",
            "",
            "- Ordinary list item\n- 普通列表保持稳定",
            "",
            "```python\nvalue = \"unchanged\"\nprint(value)\n```",
            "",
            `![synthetic evidence](${SHARE_CARD_LIGHT_PRINT_IMAGE_DATA_URI})`,
        ].join("\n"),
    },
    {
        id: "long-edge",
        kind: "long-edge",
        markdown: (() => {
            const blocks: string[] = [
                "# 多页轻印与边界压力测试",
                "",
                "This synthetic long fixture keeps every ordinary block outside the selected heading runs. It also contains a long heading with inline code at both visual edges.",
                "",
                "## 极长标题：轻印只作用于文字，`code_at_edge()` 不参与扭曲，并保持清晰",
            ];
            for (let index = 0; index < 26; index += 1) {
                blocks.push(
                    "",
                    `### 第 ${index + 1} 节 / Section ${index + 1}`,
                    "",
                    `普通正文 ${index + 1}: The quick brown fox keeps ordinary paragraph pixels stable while pagination measures the fixed card boundary. 这一段用于覆盖接近分页边缘时的文字完整性。`,
                    "",
                    "- 未选中列表项 one\n- 未选中列表项 two\n- 未选中列表项 three",
                );
                if (index % 4 === 0) {
                    blocks.push(
                        "",
                        "```ts\nfunction unchanged(value: number): number {\n  return value + 1;\n}\n```",
                    );
                }
            }
            blocks.push(
                "",
                `![synthetic long fixture image](${SHARE_CARD_LIGHT_PRINT_IMAGE_DATA_URI})`,
                "",
                "Final ordinary paragraph: pagination must not drop this sentence or create an empty trailing page.",
            );
            return blocks.join("\n");
        })(),
    },
    {
        id: "no-heading",
        kind: "short",
        markdown: [
            "This synthetic page has no heading.",
            "",
            "普通正文、`inlineCode()` and the image must remain byte-for-byte stable.",
            "",
            "```ts\nconst unchanged = true;\n```",
            "",
            `![synthetic no-heading evidence](${SHARE_CARD_LIGHT_PRINT_IMAGE_DATA_URI})`,
        ].join("\n"),
    },
];

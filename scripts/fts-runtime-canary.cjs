(function runFtsRuntimeCanary(root) {
  "use strict";

  const GRAPHEME_CANARIES = [
    { id: "nfd-accent", text: "e\u0301" },
    { id: "supplementary-han", text: "𠮷野家" },
    { id: "emoji-zwj", text: "👩‍💻" },
    { id: "kana-combining-mark", text: "か\u3099" },
    { id: "han-variation-selector", text: "禰\u{E0100}" },
    { id: "cjk-marks", text: "々ー。・" }
  ];
  const WORD_CANARIES = [
    { id: "zh-basic", locale: "zh", text: "机器学习" },
    { id: "zh-natural", locale: "zh", text: "提高中文检索召回率" },
    { id: "zh-relevant-drift-query", locale: "zh", text: "乒乓球拍" },
    { id: "zh-relevant-drift", locale: "zh", text: "商店里的乒乓球拍卖完了" },
    { id: "zh-collision-query", locale: "zh", text: "研究生" },
    { id: "zh-collision", locale: "zh", text: "团队正在研究生命起源" },
    { id: "ja-proper-name-drift-query-via-production-routing", locale: "zh", text: "東京大学" },
    { id: "ja-proper-name-drift", locale: "ja", text: "東京大学生協で教科書を買った" },
    { id: "ja-collision-query-via-production-routing", locale: "zh", text: "京都" },
    { id: "ja-collision", locale: "ja", text: "東京都の検索設定を確認した" },
    { id: "ja-basic", locale: "ja", text: "日本語検索のチューニング" },
    { id: "mixed-ja-code", locale: "ja", text: "SQLite全文検索エンジン" },
    { id: "mixed-zh-code", locale: "zh", text: "React渲染性能" },
    { id: "traditional-zh", locale: "zh-Hant", text: "繁體中文搜尋設定" }
  ];

  function collect() {
    if (typeof Intl?.Segmenter !== "function") throw new Error("Intl.Segmenter is unavailable.");
    const graphemeSegmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
    const graphemes = GRAPHEME_CANARIES.map((item) => ({
      ...item,
      resolvedLocale: graphemeSegmenter.resolvedOptions().locale,
      tokens: [...graphemeSegmenter.segment(item.text.normalize("NFC"))].map((part) => part.segment),
    }));
    const words = WORD_CANARIES.map((item) => {
      const segmenter = new Intl.Segmenter(item.locale, { granularity: "word" });
      return {
        ...item,
        resolvedLocale: segmenter.resolvedOptions().locale,
        tokens: [...segmenter.segment(item.text.normalize("NFC"))]
          .filter((part) => part.isWordLike)
          .map((part) => part.segment),
      };
    });
    const fingerprintPayload = { graphemes, words };
    const nodeRuntime = typeof process !== "undefined" && process.versions;
    const browserRuntime = typeof navigator !== "undefined";
    const hasDocument = typeof document !== "undefined";
    let obsidianModuleVersion = null;
    if (hasDocument && typeof root.require === "function") {
      try {
        obsidianModuleVersion = root.require("obsidian")?.apiVersion ?? null;
      } catch {
        obsidianModuleVersion = null;
      }
    }
    const obsidianAppVersion = typeof root.app?.version === "string"
      ? root.app.version
      : (typeof obsidianModuleVersion === "string" ? obsidianModuleVersion : null);
    return {
      schemaVersion: 2,
      fingerprintPayload,
      runtime: {
        host: hasDocument
          ? (nodeRuntime?.electron ? "electron-renderer" : "browser-renderer")
          : (nodeRuntime?.electron ? "electron-node" : "node"),
        versions: nodeRuntime ? { ...process.versions } : null,
        processType: typeof process !== "undefined" ? process.type ?? null : null,
        processPlatform: nodeRuntime ? process.platform ?? null : null,
        processArch: nodeRuntime ? process.arch ?? null : null,
        obsidianAppVersion,
        obsidianVersionSource: typeof root.app?.version === "string"
          ? "app.version"
          : (obsidianModuleVersion ? "obsidian.apiVersion" : null),
        browser: {
          available: browserRuntime,
          hasDocument,
          userAgent: browserRuntime ? navigator.userAgent : null,
          platform: browserRuntime ? navigator.platform : null,
          language: browserRuntime ? navigator.language : null,
          locationHref: typeof location !== "undefined" ? location.href : null,
        },
      },
    };
  }

  const result = collect();
  const isCommandLineNode = typeof document === "undefined"
    && typeof require === "function"
    && typeof process !== "undefined";
  if (isCommandLineNode) {
    const { createHash } = require("node:crypto");
    result.fingerprint = createHash("sha256")
      .update(JSON.stringify(result.fingerprintPayload))
      .digest("hex");
    result.graphemeFingerprint = createHash("sha256")
      .update(JSON.stringify(result.fingerprintPayload.graphemes))
      .digest("hex");
    result.wordFingerprint = createHash("sha256")
      .update(JSON.stringify(result.fingerprintPayload.words))
      .digest("hex");
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    root.__PA_FTS_RUNTIME_CANARY__ = result;
  }
})(globalThis);

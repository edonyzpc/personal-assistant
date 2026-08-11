import { createHash } from "node:crypto";

const GENERATOR_VERSION = 1;
const CHUNKS_PER_PATH = 4;
const CJK_SCRIPT = /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}]/u;
const HAN_STEMS = [
  "青岚", "星槎", "云栖", "松月", "海棠", "竹影", "霁川", "雪浦",
  "南枝", "北辰", "春汀", "秋岭", "长风", "微澜", "晴岳", "夜航",
  "石泉", "木棉", "银杏", "丹枫", "白鹭", "苍梧", "锦书", "玄鸟"
];
const TOPIC_STEMS = [
  "手札", "档案", "年表", "图录", "札记", "清单", "纪要", "目录",
  "观察", "实验", "旅行", "花园", "食谱", "乐谱", "照片", "藏书",
  "课程", "访谈", "方案", "习惯", "节气", "地图", "剧目", "书信"
];
const EN_STEMS = [
  "amber", "birch", "cedar", "delta", "ember", "frost", "grove", "harbor",
  "indigo", "juniper", "kepler", "lumen", "meadow", "north", "opal", "prairie",
  "quartz", "river", "silver", "timber", "umber", "violet", "willow", "zephyr"
];
const EN_TOPICS = [
  "archive", "atlas", "catalog", "chronicle", "course", "diary", "garden", "interview",
  "journal", "ledger", "letter", "map", "memo", "music", "notebook", "photo",
  "recipe", "record", "report", "review", "study", "theater", "timeline", "travel"
];

const CLAUSE_POOLS = {
  zh: [
    "晨间记录整理了昨天的阅读摘要和待办事项。",
    "项目会议讨论了接口边界、错误处理和发布节奏。",
    "旅行清单包含车票、住宿、地图以及天气提醒。",
    "厨房实验比较了烘焙温度、发酵时间和口感变化。",
    "花园观察记录了季节、光照、水分和植物生长。",
    "这篇随笔回顾了创作习惯、音乐收藏和周末计划。",
    "家庭档案保存了照片说明、纪念日期和物品清单。",
    "读书小组分享了章节摘要、疑问和后续讨论主题。"
  ],
  ja: [
    "朝の記録には読書メモと今日の予定を書いた。",
    "旅行の準備では切符と宿泊先と天気を確認した。",
    "料理の実験で温度と時間と食感の違いを比べた。",
    "会議では設計の境界と失敗時の対応を話し合った。",
    "庭の観察には季節と光と水分の変化を残した。",
    "週末の計画には音楽と散歩と家族の予定がある。"
  ],
  en: [
    "The daily note captures reading highlights, plans, and open questions. ",
    "The project meeting covered interface boundaries, failures, and release timing. ",
    "A travel checklist records tickets, lodging, maps, and weather. ",
    "The kitchen experiment compares temperature, timing, and texture. ",
    "A garden journal tracks seasons, light, water, and plant growth. ",
    "The weekly archive keeps music lists, photographs, and family plans. "
  ],
  mixed: [
    "Obsidian工作区记录 API 边界、SQLite 事务和 TypeScript 类型检查。",
    "macOS桌面笔记整理 JSON 配置、CSS 主题和 Markdown 引用。",
    "Node.js脚本记录 build 结果、Git 提交和错误编号。",
    "Web组件说明 ARIA 标签、DOM 生命周期和 async 任务。",
    "本地工具保存 YAML 参数、HTTP 状态和 cache 清理步骤。"
  ]
};

function languageForIndex(index) {
  const bucket = index % 20;
  if (bucket < 11) return "zh";
  if (bucket < 14) return "ja";
  if (bucket < 18) return "en";
  return "mixed";
}

function clauseCountForIndex(index) {
  if (index % 20 === 0) return 80;
  if (index % 10 === 0) return 60;
  if (index % 5 === 0) return 36;
  return 16 + (index % 8);
}

function variantCode(index, offset) {
  return `${index.toString(36).padStart(4, "0")}${offset.toString(36).padStart(2, "0")}`;
}

function longTailClause(index, offset, language) {
  const sequence = index * 97 + offset * 53;
  const stem = HAN_STEMS[sequence % HAN_STEMS.length];
  const topic = TOPIC_STEMS[Math.floor(sequence / HAN_STEMS.length) % TOPIC_STEMS.length];
  const code = variantCode(index, offset);
  if (language === "ja") return `固有名「${stem}${topic}」の資料番号は J${code}。`;
  if (language === "en") {
    const englishStem = EN_STEMS[sequence % EN_STEMS.length];
    const englishTopic = EN_TOPICS[Math.floor(sequence / EN_STEMS.length) % EN_TOPICS.length];
    return `Archive ${englishStem}-${englishTopic} carries reference E${code}. `;
  }
  if (language === "mixed") return `模块 ${stem}${topic} 使用 ref_${code} 保存本地状态。`;
  return `专题「${stem}${topic}」保存独立条目 Z${code}。`;
}

function workloadMarkers(index, language) {
  if (language === "en") return "";
  const markers = [];
  if (index % 2 === 0) markers.push("每日归档");
  if (index % 10 === 0) markers.push("周末散步");
  if (index % 100 === 0) markers.push("鹤汀密札");
  if (index % 20 === 0) markers.push("SQLite 玄鹤事务");
  if (index % 4 === 0) markers.push("龘");
  return markers.length > 0 ? ` 受控频率标记：${markers.join("、")}。` : "";
}

function buildBody(index, language) {
  const pool = CLAUSE_POOLS[language];
  const count = clauseCountForIndex(index);
  const clauses = [];
  for (let offset = 0; offset < count; offset += 1) {
    clauses.push(
      `${pool[(index * 7 + offset * 3) % pool.length]}${longTailClause(index, offset, language)}`,
    );
  }
  const suffix = language === "en"
    ? ` Archive id ${index}, segment ${index % CHUNKS_PER_PATH}.`
    : `${workloadMarkers(index, language)} 档案编号 ${index}，分段 ${index % CHUNKS_PER_PATH}。`;
  const bodyBudget = 4000 - [...suffix].length;
  return `${[...clauses.join("")].slice(0, bodyBudget).join("")}${suffix}`.normalize("NFC");
}

function syntheticRow(index) {
  const pathIndex = Math.floor(index / CHUNKS_PER_PATH);
  const language = languageForIndex(pathIndex);
  const title = language === "en"
    ? `${EN_STEMS[pathIndex % EN_STEMS.length]} ${EN_TOPICS[pathIndex % EN_TOPICS.length]} ${pathIndex}`
    : `${HAN_STEMS[pathIndex % HAN_STEMS.length]}${TOPIC_STEMS[pathIndex % TOPIC_STEMS.length]} ${pathIndex}`;
  const heading = language === "en"
    ? `Section ${index % 12} ${EN_TOPICS[(pathIndex + index) % EN_TOPICS.length]}`
    : `Section ${index % 12} ${TOPIC_STEMS[(pathIndex + index) % TOPIC_STEMS.length]}`;
  return {
    id: `scale-${index}`,
    path: `synthetic/${language}/note-${String(pathIndex).padStart(6, "0")}.md`,
    chunkIndex: index % CHUNKS_PER_PATH,
    title,
    heading,
    body: buildBody(index, language)
  };
}

function countCodePoints(value) {
  return [...value].length;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index] ?? 0;
}

function updateDigest(hash, row) {
  for (const key of ["id", "path", "chunkIndex", "title", "heading", "body"]) {
    hash.update(String(row[key]));
    hash.update("\u0000");
  }
  hash.update("\u0001");
}

export function generateScaleCorpus(frozenRows, frozenQueries, targetChunks) {
  if (!Number.isInteger(targetChunks) || targetChunks < frozenRows.length) {
    throw new Error(`Scale target must be an integer >= ${frozenRows.length}.`);
  }

  const rows = frozenRows.map((row) => ({ ...row }));
  const syntheticCount = targetChunks - rows.length;
  for (let index = 0; index < syntheticCount; index += 1) rows.push(syntheticRow(index));

  const seenIds = new Set();
  const seenChunks = new Set();
  const digest = createHash("sha256");
  const bodyLengths = [];
  const syntheticLanguageChunks = { zh: 0, ja: 0, en: 0, mixed: 0 };
  let rawUtf8Bytes = 0;

  rows.forEach((row, rowIndex) => {
    if (seenIds.has(row.id)) throw new Error(`Duplicate scale row id: ${row.id}`);
    seenIds.add(row.id);
    const chunkKey = `${row.path}\u0000${row.chunkIndex}`;
    if (seenChunks.has(chunkKey)) throw new Error(`Duplicate scale chunk: ${chunkKey}`);
    seenChunks.add(chunkKey);

    for (const field of ["id", "path", "title", "heading", "body"]) {
      if (row[field] !== row[field].normalize("NFC")) {
        throw new Error(`Scale row ${row.id} field ${field} is not NFC.`);
      }
      rawUtf8Bytes += Buffer.byteLength(row[field], "utf8");
    }

    if (rowIndex >= frozenRows.length) {
      const language = row.path.split("/")[1];
      syntheticLanguageChunks[language] += 1;
      if (language === "en" && [row.title, row.heading, row.body].some((value) => CJK_SCRIPT.test(value))) {
        throw new Error(`Synthetic English row ${row.id} contains CJK text.`);
      }
      for (const query of frozenQueries) {
        if (row.body.includes(query) || row.title.includes(query) || row.heading.includes(query) || row.path.includes(query)) {
          throw new Error(`Synthetic row ${row.id} contains frozen query ${query}.`);
        }
      }
    }

    bodyLengths.push(countCodePoints(row.body));
    updateDigest(digest, row);
  });

  return {
    generatorVersion: GENERATOR_VERSION,
    seed: "b125-scale-v1",
    rows,
    fingerprint: digest.digest("hex"),
    stats: {
      chunks: rows.length,
      paths: new Set(rows.map((row) => row.path)).size,
      rawUtf8Bytes,
      bodyCharsP50: percentile(bodyLengths, 0.5),
      bodyCharsP95: percentile(bodyLengths, 0.95),
      bodyCharsMax: Math.max(...bodyLengths),
      syntheticLanguageChunks,
    }
  };
}

export const SCALE_QUERY_WORKLOAD = [
  { id: "high-frequency", query: "每日归档", expectedFraction: 0.4 },
  { id: "medium-frequency", query: "周末散步", expectedFraction: 0.08 },
  { id: "low-frequency", query: "鹤汀密札", expectedFraction: 0.008 },
  { id: "mixed-code", query: "SQLite 玄鹤事务", expectedFraction: 0.04 },
  { id: "single-character", query: "龘", expectedFraction: 0.2 },
  { id: "no-hit", query: "不存在的紫色彗星编号" }
];

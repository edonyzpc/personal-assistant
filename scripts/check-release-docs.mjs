import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(process.cwd());
const requiredFiles = [
  "README.md",
  "README-CN.md",
  "CHANGELOG.md",
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
  "TRADEMARKS.md",
  "docs/operations/release-process.md",
  "docs/operations/brat-beta-testing.md",
];
const errors = [];
let checkedLinks = 0;

function relative(file) {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}

function isInsideRepo(target) {
  const relativeTarget = path.relative(repoRoot, target);
  return relativeTarget === ""
    || (!relativeTarget.startsWith(`..${path.sep}`) && relativeTarget !== "..");
}

function withoutCode(markdown) {
  const visibleLines = [];
  let closingFence;

  for (const line of markdown.split(/\r?\n/u)) {
    if (closingFence) {
      if (closingFence.test(line)) closingFence = undefined;
      visibleLines.push("");
      continue;
    }

    const fence = line.match(/^\s*(`{3,}|~{3,})/u)?.[1];
    if (fence) {
      const marker = fence[0];
      const length = fence.length;
      closingFence = new RegExp(`^\\s*${marker}{${length},}\\s*$`, "u");
      visibleLines.push("");
      continue;
    }

    visibleLines.push(line.replace(/(`+)(?:[^`]|`(?!\1))*?\1/gu, ""));
  }

  return visibleLines.join("\n");
}

function isExternalTarget(rawTarget) {
  const target = rawTarget.trim();
  return target.startsWith("#")
    || target.startsWith("?")
    || target.startsWith("//")
    || /^[a-z][a-z0-9+.-]*:/iu.test(target);
}

function markdownDestination(rawTarget) {
  const trimmed = rawTarget.trim();
  if (trimmed.startsWith("<")) {
    const end = trimmed.indexOf(">");
    if (end >= 0) return trimmed.slice(1, end);
  }
  return trimmed.split(/\s+["'(]/u, 1)[0];
}

function normalizeTarget(rawTarget) {
  const directTarget = markdownDestination(rawTarget);
  const targetWithoutSuffix = directTarget.split(/[?#]/u, 1)[0];
  try {
    return decodeURIComponent(targetWithoutSuffix);
  } catch {
    return targetWithoutSuffix;
  }
}

function resolveTarget(sourceFile, target) {
  if (target.startsWith("/")) return path.resolve(repoRoot, `.${target}`);
  return path.resolve(path.dirname(sourceFile), target);
}

function validateTarget(sourceFile, rawTarget) {
  const directTarget = markdownDestination(rawTarget);
  if (isExternalTarget(rawTarget) || isExternalTarget(directTarget)) return;

  const target = normalizeTarget(directTarget);
  if (!target) return;

  checkedLinks += 1;
  const resolved = resolveTarget(sourceFile, target);
  if (!isInsideRepo(resolved)) {
    errors.push(`${relative(sourceFile)} -> target escapes repository: ${rawTarget}`);
    return;
  }
  if (!existsSync(resolved)) {
    errors.push(`${relative(sourceFile)} -> missing local target: ${rawTarget}`);
    return;
  }

  const realTarget = realpathSync(resolved);
  if (!isInsideRepo(realTarget)) {
    errors.push(`${relative(sourceFile)} -> target escapes repository: ${rawTarget}`);
  }
}

function validateMarkdownLinks(file, rawMarkdown) {
  const markdown = withoutCode(rawMarkdown);
  for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
    validateTarget(file, match[1]);
  }

  for (const tag of markdown.matchAll(/<[a-z][^>]*>/giu)) {
    for (const attribute of tag[0].matchAll(/\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/giu)) {
      validateTarget(file, attribute[1] ?? attribute[2] ?? attribute[3]);
    }
  }
}

for (const requiredFile of requiredFiles) {
  const file = path.join(repoRoot, requiredFile);
  if (!existsSync(file)) {
    errors.push(`Missing required release file: ${requiredFile}`);
    continue;
  }
  if (!lstatSync(file).isFile()) {
    errors.push(`Required release path is not a regular file: ${requiredFile}`);
    continue;
  }

  const content = readFileSync(file, "utf8");
  if (content.trim().length === 0) {
    errors.push(`Required release file is empty: ${requiredFile}`);
    continue;
  }
  if (requiredFile.endsWith(".md")) validateMarkdownLinks(file, content);
}

if (errors.length > 0) {
  console.error(`Release documentation check failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Release documentation check passed: ${requiredFiles.length} required files, ${checkedLinks} local links.`,
);

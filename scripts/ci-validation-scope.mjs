import { execFileSync } from "node:child_process";
import console from "node:console";
import { appendFileSync } from "node:fs";
import process from "node:process";

const ordinaryDocs = /^(?:docs\/(?:development|product|architecture|archive)\/.+\.md|docs\/(?:backlog|index|development-roadmap)\.md)$/u;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: "pipe" });
}

function classify() {
  const base = process.env.CI_VALIDATION_BASE ?? "";
  if (!/^[a-f0-9]{40}$/iu.test(base) || /^0+$/u.test(base)) {
    return { scope: "full", reason: "missing or invalid base SHA" };
  }

  try {
    git(["rev-parse", "--verify", `${base}^{commit}`]);
    // Compare the event base with the checked-out merge result, not just HEAD^.
    // Disabling renames exposes both the deleted source and added destination.
    const paths = git([
      "diff", "--name-only", "-z", "--no-renames", "--no-ext-diff", base, "HEAD", "--",
    ]).split("\0").filter(Boolean);
    if (paths.length > 0 && paths.every((file) => ordinaryDocs.test(file))) {
      return { scope: "docs", reason: `${paths.length} ordinary documentation path(s)` };
    }
    return { scope: "full", reason: "mixed, unknown, or empty change set" };
  } catch {
    return { scope: "full", reason: "base or Git diff unavailable" };
  }
}

const { scope, reason } = classify();
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `scope=${scope}\n`);
}
console.log(`CI validation scope: ${scope} (${reason}).`);

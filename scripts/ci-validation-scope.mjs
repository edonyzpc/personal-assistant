import { execFileSync } from "node:child_process";
import console from "node:console";
import { appendFileSync } from "node:fs";
import process from "node:process";
import semver from "semver";
import { findVerifiedGeneratedReleaseCi } from "./lib/generated-release-ci-evidence.mjs";

const ordinaryDocs = /^(?:docs\/(?:development|product|architecture|archive)\/.+\.md|docs\/(?:backlog|index|development-roadmap)\.md)$/u;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: "pipe" });
}

function capture(command, args) {
  if (command === "git") return git(args);
  return execFileSync(command, args, { encoding: "utf8", stdio: "pipe", timeout: 15000 }).trim();
}

function validBase(base) {
  return /^[a-f0-9]{40}$/iu.test(base) && !/^0+$/u.test(base);
}

function documentedPaths(base) {
  return git([
    "diff", "--name-only", "-z", "--no-renames", "--no-ext-diff", base, "HEAD", "--",
  ]).split("\0").filter(Boolean);
}

function packagingCandidate(base) {
  if (process.env.CI_VALIDATION_EVENT !== "push"
    || process.env.CI_VALIDATION_REF !== "refs/heads/master" || !validBase(base)) return null;

  const head = git(["rev-parse", "HEAD"]).trim();
  const record = git(["rev-list", "--parents", "-n", "1", head]).trim().split(/\s+/u);
  if (record.length !== 2 || record[0] !== head || record[1] !== base) return null;

  const subject = git(["log", "-1", "--format=%s", head]).trim();
  const subjectMatch = subject.match(/^\[release\] v([^,]+), check the CHANGELOG\.md for details$/u);
  if (!subjectMatch) return null;
  const tag = subjectMatch[1];
  if (semver.valid(tag) !== tag || semver.prerelease(tag) !== null) return null;

  const evidence = findVerifiedGeneratedReleaseCi({
    tag,
    releaseCommit: head,
    capture,
    requireTagRef: false,
  });
  return evidence.verified
    ? { scope: "packaging", reason: "single generated stable packaging commit with verified full parent CI" }
    : { scope: "full", reason: evidence.reason };
}

function classify() {
  const base = process.env.CI_VALIDATION_BASE ?? "";
  if (!validBase(base)) {
    return { scope: "full", reason: "missing or invalid base SHA" };
  }

  try {
    git(["rev-parse", "--verify", `${base}^{commit}`]);
    const packaging = packagingCandidate(base);
    if (packaging) return packaging;

    // Compare the event base with the checked-out merge result, not just HEAD^.
    // Disabling renames exposes both the deleted source and added destination.
    const paths = documentedPaths(base);
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

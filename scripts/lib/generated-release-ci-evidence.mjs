import { isDeepStrictEqual } from 'node:util';
import semver from 'semver';
import { findVerifiedMasterCi } from './release-ci-evidence.mjs';

const PACKAGING_FILES = [
  'CHANGELOG.md', 'NOTICE', 'manifest-beta.json', 'manifest.json',
  'package-lock.json', 'package.json', 'versions.json',
];

function readObject(capture, commit, file) {
  const value = JSON.parse(capture('git', ['show', `${commit}:${file}`]));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Release metadata must be a JSON object');
  }
  return value;
}

function withoutVersion(value) {
  const copy = { ...value };
  delete copy.version;
  return copy;
}

function onlyGeneratedVersions(capture, parent, commit, tag) {
  for (const file of ['package.json', 'manifest.json', 'manifest-beta.json']) {
    const before = readObject(capture, parent, file);
    const after = readObject(capture, commit, file);
    if (after.version !== tag || typeof before.version !== 'string'
      || !isDeepStrictEqual(withoutVersion(before), withoutVersion(after))) return false;
    if (file === 'package.json' && !semver.gt(tag, before.version)) return false;
  }

  const beforeLock = readObject(capture, parent, 'package-lock.json');
  const afterLock = readObject(capture, commit, 'package-lock.json');
  if (afterLock.version !== tag || afterLock.packages?.['']?.version !== tag
    || typeof beforeLock.version !== 'string' || typeof beforeLock.packages?.['']?.version !== 'string') return false;
  const lockWithoutVersions = lock => ({
    ...withoutVersion(lock),
    packages: { ...lock.packages, '': withoutVersion(lock.packages['']) },
  });
  if (!isDeepStrictEqual(lockWithoutVersions(beforeLock), lockWithoutVersions(afterLock))) return false;

  const beforeVersions = readObject(capture, parent, 'versions.json');
  const afterVersions = readObject(capture, commit, 'versions.json');
  const manifest = readObject(capture, commit, 'manifest.json');
  if (Object.hasOwn(beforeVersions, tag) || typeof manifest.minAppVersion !== 'string'
    || !manifest.minAppVersion || afterVersions[tag] !== manifest.minAppVersion) return false;
  delete afterVersions[tag];
  return isDeepStrictEqual(beforeVersions, afterVersions);
}

function supportedReleaseChannel(tag) {
  if (semver.valid(tag) !== tag) return false;
  const prerelease = semver.prerelease(tag);
  return prerelease === null || prerelease[0] === 'beta';
}

/**
 * Verify strict generated-release metadata and the exact parent's full master CI.
 * Tag callers require the selected tag to identify releaseCommit; master-push
 * classification passes requireTagRef=false before the tag exists.
 */
export function findVerifiedGeneratedReleaseCi({
  tag,
  releaseCommit,
  capture,
  requireTagRef = true,
}) {
  const fallback = reason => ({ verified: false, reason });
  if (!supportedReleaseChannel(tag)) {
    return fallback('Only canonical stable and beta releases may reuse master source CI');
  }
  if (!/^[a-f0-9]{40}$/.test(releaseCommit ?? '')) return fallback('Invalid release commit');

  try {
    if (requireTagRef
      && capture('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]).trim() !== releaseCommit) {
      return fallback('Tag does not identify the selected release commit');
    }
    const record = capture('git', ['rev-list', '--parents', '-n', '1', releaseCommit]).trim().split(/\s+/);
    if (record.length !== 2 || record[0] !== releaseCommit) return fallback('Packaging commit must have one parent');
    const parent = record[1];
    capture('git', ['merge-base', '--is-ancestor', parent, 'refs/remotes/origin/master']);
    const subject = capture('git', ['log', '-1', '--format=%s', releaseCommit]).trim();
    if (subject !== `[release] v${tag}, check the CHANGELOG.md for details`) {
      return fallback('Release commit is not generated packaging');
    }
    const changed = capture('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', releaseCommit])
      .trim().split('\n').sort();
    if (!isDeepStrictEqual(changed, PACKAGING_FILES)) return fallback('Release commit is not the complete packaging-only change');
    if (!onlyGeneratedVersions(capture, parent, releaseCommit, tag)) {
      return fallback('Release metadata changes more than generated version fields');
    }
    return findVerifiedMasterCi({ sourceCommit: parent, capture, verifiedMasterAncestor: true });
  } catch {
    // Git/JSON/API failures are evidence failures. Never echo command diagnostics.
    return fallback('Could not verify committed release packaging metadata');
  }
}

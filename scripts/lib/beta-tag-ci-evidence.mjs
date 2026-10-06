import { findVerifiedGeneratedReleaseCi } from './generated-release-ci-evidence.mjs';

/** Compatibility entrypoint for existing beta-tag callers. */
export function findVerifiedBetaTagCi({ tag, releaseCommit, capture }) {
  return findVerifiedGeneratedReleaseCi({ tag, releaseCommit, capture });
}

#!/usr/bin/env bash
# Syntax-aware platform guard. The optional argument is a TypeScript file/tree.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SCAN_TARGET="${1:-${REPO_ROOT}/src}"

node "${SCRIPT_DIR}/check-platform-guards.mjs" "${SCAN_TARGET}"

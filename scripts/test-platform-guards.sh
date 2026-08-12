#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECKER="${SCRIPT_DIR}/check-platform-guards.mjs"
FIXTURES="${SCRIPT_DIR}/fixtures/platform-guards"

node "${CHECKER}" "${FIXTURES}/safe" >/dev/null

expect_failure() {
    local fixture="$1"
    if node "${CHECKER}" "${FIXTURES}/${fixture}" >/dev/null 2>&1; then
        echo "ERROR: platform guard accepted unsafe fixture: ${fixture}" >&2
        exit 1
    fi
}

expect_failure "unsafe-desktop"
expect_failure "unsafe-conjunctive-exit"
expect_failure "unsafe-partial-exit"
expect_failure "unsafe-secret"

echo "Platform guard self-test passed: safe fixture accepted; desktop, conjunctive/partial-exit, and same-line secret violations rejected."

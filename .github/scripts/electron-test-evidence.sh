#!/usr/bin/env bash
# CI-only capture of the existing Electron suite, not a replacement test runner.
set -euo pipefail
report_dir=test-results/electron-tests
mkdir -p test-results
# Refuse stale evidence instead of deleting/reusing a previous run's report.
mkdir "$report_dir"
git rev-parse --verify HEAD > "$report_dir/checkout.txt"
git rev-parse 'HEAD^{tree}' > "$report_dir/tree.txt"
printf '%s\n' "${GITHUB_SHA:-}" > "$report_dir/trigger-sha.txt"
printf '%s\n' "${GITHUB_RUN_ID:-}" > "$report_dir/run-id.txt"
printf '%s\n' "${GITHUB_RUN_ATTEMPT:-}" > "$report_dir/run-attempt.txt"
printf '%s\n' "${GITHUB_EVENT_NAME:-}" > "$report_dir/event.txt"
node --version > "$report_dir/node.txt"
printf '%s\n' 'npm run test:electron -- --reporter=default --reporter=json --outputFile=test-results/electron-tests/vitest.json' > "$report_dir/command.txt"

# Keep the original npm script, test selection, concurrency, timeouts and assertions.
# Failure stays failure; tee must not turn npm's nonzero exit into success.
set +e
npm run test:electron -- --reporter=default --reporter=json --outputFile=test-results/electron-tests/vitest.json 2>&1 | tee "$report_dir/output.log"
codes=("${PIPESTATUS[@]}")
git diff --quiet HEAD -- .
source_exit=$?
set -e
printf '%s\n' "${codes[0]}" > "$report_dir/test-exit-code.txt"
printf '%s\n' "${codes[1]}" > "$report_dir/capture-exit-code.txt"
printf '%s\n' "$source_exit" > "$report_dir/source-exit-code.txt"
git rev-parse --verify HEAD > "$report_dir/checkout-after.txt"
git rev-parse 'HEAD^{tree}' > "$report_dir/tree-after.txt"
sha256sum "$report_dir/"* > "$report_dir/SHA256SUMS"

if (( codes[0] != 0 )); then exit "${codes[0]}"; fi
if (( codes[1] != 0 )); then exit "${codes[1]}"; fi
if (( source_exit != 0 )); then exit "$source_exit"; fi
cmp "$report_dir/checkout.txt" "$report_dir/checkout-after.txt"
cmp "$report_dir/tree.txt" "$report_dir/tree-after.txt"
# A missing JSON report is incomplete evidence, never a passing test report.
test -s "$report_dir/vitest.json"

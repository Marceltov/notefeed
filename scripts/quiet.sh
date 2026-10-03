#!/bin/sh
# Runs a command with its whole output in a log file, and prints only the verdict and the tail, so a long test run
# doesn't fill the terminal (or an agent's context). Usage: scripts/quiet.sh <command...>
# e.g. scripts/quiet.sh npx vitest run   |   scripts/quiet.sh npx playwright test   |   scripts/quiet.sh npm run lint
# At most about 30 short lines whatever the run prints. The log is kept at the path printed on the last line: grep it for details instead of rerunning.
log=$(mktemp "${TMPDIR:-/tmp}/quiet-XXXXXX.log")
"$@" >"$log" 2>&1
code=$?
# Failure lines first (vitest and Playwright mark them FAIL, ×, ✘ or "failed"), then the summary at the end of the run.
grep -E "FAIL|×|✘|failed|AssertionError|Error:" "$log" | cut -c1-200 | head -20
tail -8 "$log" | cut -c1-200
echo "exit $code, full log: $log"
exit $code

#!/bin/bash
# Lints GitHub Actions workflows with actionlint (plan: verification-hardening task 1.5).
#
# Covers:
#   - .github/workflows/*.{yml,yaml}
#   - packages/cli/tests/golden/**/.github/workflows/*.{yml,yaml} (scaffolder output)
#   - .github/actions/**/action.{yml,yaml} (composite actions — see the check below)
#
# Shellcheck policy: actionlint's shellcheck integration reports findings as
#   "shellcheck reported issue in this script: SC<code>:<level>:<line>:<col>: <message>"
# where <level> is shellcheck's severity. Pre-existing SC style/info findings must not
# fail the gate, so findings at severity "info" or "style" are ignored via -ignore;
# SC "warning"/"error" findings still fail. The integration is enabled only when the
# binary is present on PATH, and disabled otherwise by passing -shellcheck= explicitly,
# so behaviour never depends on accidental PATH discovery.
#
# Composite-action policy: actionlint does not validate composite action files. Those
# files are instead grepped for contexts that do not exist inside a composite action
# (vars/secrets/needs/jobs/matrix/strategy — chamber incident #393).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

if ! command -v actionlint > /dev/null 2>&1; then
  echo "actionlint is not installed — refusing to skip silently." >&2
  echo "Install it with one of:" >&2
  echo "  brew install actionlint" >&2
  echo "  go install github.com/rhysd/actionlint/cmd/actionlint@latest" >&2
  echo "  curl -fsSL https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash | bash -s -- latest /usr/local/bin" >&2
  exit 1
fi

IGNORE_SC_STYLE='shellcheck reported issue in this script: SC[0-9]+:(info|style):'
SHELLCHECK_BIN=$(command -v shellcheck || true)

run_actionlint() {
  if [ -n "$SHELLCHECK_BIN" ]; then
    # Workflow file paths in this repo contain no whitespace, so the file list is
    # intentionally unquoted below.
    # shellcheck disable=SC2086
    actionlint -shellcheck "$SHELLCHECK_BIN" "$@" $FILES
  else
    # shellcheck disable=SC2086
    actionlint -shellcheck= "$@" $FILES
  fi
}

echo "Checking workflows with actionlint..."
FILES=$(find .github/workflows packages/cli/tests/golden -type f \
  \( -name '*.yml' -o -name '*.yaml' \) -path '*/.github/workflows/*')
if [ -z "$FILES" ]; then
  echo "actionlint: no workflow files found under .github/workflows or the golden fixtures" >&2
  exit 1
fi
run_actionlint -ignore "$IGNORE_SC_STYLE"

echo "Checking composite actions for unavailable contexts..."
ACTIONS=$(find .github/actions -type f \( -name 'action.yml' -o -name 'action.yaml' \) 2> /dev/null || true)
if [ -n "$ACTIONS" ]; then
  while IFS= read -r action; do
    if grep -nE '(^|[^[:alnum:]_])(vars|secrets|needs|jobs|matrix|strategy)\.' "$action"; then
      echo "$action: composite action uses a context unavailable in composite actions" >&2
      echo "(vars/secrets/needs/jobs/matrix/strategy — chamber incident #393); pass it as an input instead" >&2
      exit 1
    fi
  done <<EOF
$ACTIONS
EOF
else
  echo "No composite actions found under .github/actions."
fi

echo "actionlint passed."

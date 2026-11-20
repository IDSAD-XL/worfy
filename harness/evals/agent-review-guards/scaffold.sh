#!/usr/bin/env bash
# Fixture of the case: project demo with the open pull request octo-org/ledger#7 of ../pr-reply-fixture/pull.sh — its
# head commit in the repository, the stand-in gh answering offline and logging every call to gh-calls.log — and the
# review draft worfy creates when it starts an Agent review of that pull request: empty, the agent writing, in the
# profile folder (state/pr-review/octo-org-ledger-7.json). The stand-in's answer to `gh pr view` gets the base commit
# and the linked issues, which a review reads first.
#
# Bash, not Node: it is test code; only the scripts the plugin ships must run without bash.
# Writes only into the current folder and $HOME.
set -euo pipefail

# The folder of this script, cut in bash rather than by dirname: a process start is slow in Git Bash
# (lib/demo-project.sh). Git Bash may spell it with `\`.
here=.
case "$0" in */* | *\\*) here="${0%[/\\]*}" ;; esac
bash "$here/../pr-reply-fixture/pull.sh"

state="$(unset HARNESS_HOME; EVAL_HARNESS_HOME="${EVAL_HARNESS_HOME:-worfy-harness}" exec node "$here/../../hooks/eval-env.cjs" harness-home)"
home_state=""
[ -n "${EVAL_HARNESS_HOME:-}" ] || home_state="$HOME/.claude/worfy-harness"

node - "$(git rev-parse main)" "$(git rev-parse refs/pull/7/head)" "$state" "$home_state" <<'NODE'
const fs = require("node:fs")
const path = require("node:path")
const [base, head, ...states] = process.argv.slice(2)
const answers = path.join(".git", "eval-gh", "pull.json")
const pull = JSON.parse(fs.readFileSync(answers, "utf8"))
Object.assign(pull.view, { baseRefOid: base, closingIssuesReferences: [], additions: 7, deletions: 0, changedFiles: 1 })
fs.writeFileSync(answers, `${JSON.stringify(pull, null, 2)}\n`)
const draft = { schema: 1, repo: "octo-org/ledger", pr: 7, startedOn: head, payload: { body: "", comments: [] }, anchors: [], viewed: {}, state: "draft", agent: { sessionId: "eval-session", state: "writing" } }
for (const state of states.filter((each) => each !== "")) {
    const folder = path.join(state, "projects", "demo", "state", "pr-review")
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, "octo-org-ledger-7.json"), `${JSON.stringify(draft, null, 2)}\n`)
}
NODE

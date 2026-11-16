#!/usr/bin/env bash
# Fixture of the case implementer-story: project demo, finish pr-green-ci, variant none
# (harness/evals/lib/demo-project.sh), and on top of it:
#   - ticket 01 asks for percent(done, total) with two rules and no reason for either (round down, 0 for
#     an empty total): where a story needs the reason, story-pr.md asks for `not recorded` (in Russian, the
#     demo profile's language.reports), not a guess;
#   - code_stories.pr set to "on" in the profile: the default, written out so that the case keeps its
#     meaning if the default changes;
#   - a post-commit hook that runs bin/story-check of this copy of the Harness on every Code story the new
#     HEAD holds and replaces .git/story-check.log with the stories, those the branch added since main
#     (`in-branch:`), the output and `EXIT=<code>`; it also keeps the story as HEAD has it in
#     .git/story-check/. The graders read those files: no grader type of `claude plugin eval` runs a
#     command, and the implementer's own story-check run is a claim of its report, not a check. The hook
#     prints nothing and never fails a commit; a commit without a story leaves both as they were.
# The Harness state of the demo project is where demo-project.sh put it: .git/worfy-harness, and the
# temporary HOME's ~/.claude/worfy-harness when EVAL_HARNESS_HOME is unset.
set -euo pipefail

here=.
case "${BASH_SOURCE[0]}" in */* | *\\*) here="${BASH_SOURCE[0]%[/\\]*}" ;; esac
bash "$here/../lib/demo-project.sh" pr-green-ci none
story_check="$(cd "$here/../../bin" && pwd -P)/story-check"
[ -f "$story_check" ] || { echo "scaffold: no $story_check" >&2; exit 1; }

export GIT_AUTHOR_NAME=demo GIT_AUTHOR_EMAIL=demo@example.invalid
export GIT_COMMITTER_NAME=demo GIT_COMMITTER_EMAIL=demo@example.invalid
export GIT_AUTHOR_DATE=2026-10-01T12:00:00Z GIT_COMMITTER_DATE=2026-10-01T12:00:00Z
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=maintenance.auto GIT_CONFIG_VALUE_0=false

cat >.scratch/demo/issues/01-alpha.md <<'EOF'
# 01 — alpha: процент выполнения

Type: task
Status: open
Blocked by: —

## Что происходит

Отчёт показывает долю готовых задач дробью, например `0.6666666666666666`. Нужен целый процент.

## Что делаем

`src/alpha.mjs` экспортирует `percent(done, total)`: целый процент `done` от `total`, округлённый вниз
(`Math.floor`). Для `total`, равного 0, — 0.

## Готово, когда

- [ ] `percent(2, 3)` возвращает `66`; `percent(0, 0)` возвращает `0`; test в `test/alpha.test.mjs`.
- [ ] `node --test` — код 0.

## Где в коде

- `src/alpha.mjs` — новый
- `test/alpha.test.mjs` — новый

## Итог

Заполняется при закрытии.
EOF
git add .scratch/demo/issues/01-alpha.md
git commit -q -m "demo: ticket 01 asks for percent"

# code_stories.pr "on" in each profile of the demo project the fixture wrote.
eval_env="$here/../../hooks/eval-env.cjs"
state="$(unset HARNESS_HOME; EVAL_HARNESS_HOME="${EVAL_HARNESS_HOME:-worfy-harness}" exec node "$eval_env" harness-home)"
home_state="$state"
[ -n "${EVAL_HARNESS_HOME:-}" ] || home_state="$HOME/.claude/worfy-harness"
for dir in "$state" "$home_state"; do
    node -e '
const fs = require("node:fs")
const file = process.argv[1]
const profile = JSON.parse(fs.readFileSync(file, "utf8"))
profile.code_stories = { pr: "on" }
fs.writeFileSync(file, JSON.stringify(profile, null, 2) + "\n")
' "$dir/projects/demo/profile.json"
done

hook="$(git rev-parse --git-path hooks)/post-commit"
mkdir -p "${hook%/*}"
hook_text="$(cat <<'EOF'
#!/bin/sh
# The eval case implementer-story (harness/evals/implementer-story/scaffold.sh), not the demo project.
# After a commit whose HEAD holds a Code story: a copy of each story as HEAD has it in
# <common .git>/story-check/, and into <common .git>/story-check.log, replaced each time, the stories of
# HEAD, those the branch added or changed since main, story-check's output and its exit code.
stories=$(git ls-tree -r --name-only HEAD -- .scratch/demo/stories) || exit 0
[ -n "$stories" ] || exit 0
common=$(git rev-parse --path-format=absolute --git-common-dir) || exit 0
mkdir -p "$common/story-check" || exit 0
for story in $stories; do
    git show "HEAD:$story" >"$common/story-check/${story##*/}" || exit 0
done
in_branch=$(git diff --name-only --diff-filter=AM main...HEAD -- .scratch/demo/stories 2>/dev/null)
# Git gives a hook GIT_DIR (and in a linked worktree that is the worktree's own git folder): story-check
# finds the work tree from the current folder, the top of the tree that made the commit.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
{
    printf 'stories: %s\n' $stories
    [ -z "$in_branch" ] || printf 'in-branch: %s\n' $in_branch
    node '@STORY_CHECK@' $stories
    echo "EXIT=$?"
} >"$common/story-check.log" 2>&1
exit 0
EOF
)"
printf '%s\n' "${hook_text//@STORY_CHECK@/$story_check}" >"$hook"
chmod +x "$hook"

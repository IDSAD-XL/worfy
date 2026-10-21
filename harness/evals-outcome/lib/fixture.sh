#!/usr/bin/env bash
# fixture.sh — builds the shared base repository of the outcome eval tasks in the current (empty)
# folder (harness/evals-outcome/README.md, "The fixture"). A task's scaffold.sh runs it first, then
# the plugin state scripts of plugin-state/, then adds the task's own files.
#
# What it makes:
#   ./                          a git repository on branch main with one commit: a small Node package
#                               (src/text.mjs, test/text.test.mjs, package.json with `node --test`), a
#                               .gitignore and an ordinary README.md that names the test command; a
#                               repository-local git identity, so commits work in the run's empty HOME
#   ./.git/fixture-origin.git   a local bare repository as `origin`, main pushed: push and fetch need
#                               no network
#
# Neutral on purpose: it knows no plugin, writes nothing outside the current folder, and names no file
# outside this folder. No task's bug or trap lives here. It runs as the user outside the sandbox, so
# it refuses to start (writing nothing) when HOME is the user's real home folder (home-guard.cjs).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
work="$(pwd -P)"
node "$here/home-guard.cjs" "${HOME:-}" || exit 1
[ -z "$(ls -A "$work")" ] || { echo "fixture.sh: $work is not empty" >&2; exit 1; }

export GIT_AUTHOR_NAME="Fixture Author" GIT_AUTHOR_EMAIL=fixture@example.invalid
export GIT_COMMITTER_NAME="Fixture Author" GIT_COMMITTER_EMAIL=fixture@example.invalid
export GIT_AUTHOR_DATE=2026-10-01T12:00:00Z GIT_COMMITTER_DATE=2026-10-01T12:00:00Z

mkdir -p src test
cat >package.json <<'EOF'
{
  "name": "textkit",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
EOF
cat >README.md <<'EOF'
# textkit

Small text helpers for Node.js scripts.

## Usage

```js
import { capitalize, words } from './src/text.mjs'

capitalize('hello') // 'Hello'
words(' a  b ') // ['a', 'b']
```

## Tests

Node.js 20 or newer; there is nothing to install.

```sh
node --test
```
EOF
cat >src/text.mjs <<'EOF'
/** The text with its first character in upper case. */
export function capitalize(text) {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1)
}

/** The words of the text, split on whitespace, without empty ones. */
export function words(text) {
  return text.split(/\s+/).filter(Boolean)
}
EOF
cat >test/text.test.mjs <<'EOF'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { capitalize, words } from '../src/text.mjs'

test('capitalize upper-cases the first character', () => {
  assert.equal(capitalize('hello'), 'Hello')
  assert.equal(capitalize(''), '')
})

test('words splits on any whitespace', () => {
  assert.deepEqual(words(' a  b\tc\n'), ['a', 'b', 'c'])
})
EOF
printf 'node_modules/\n' >.gitignore

git init -q -b main
git config user.name "Fixture Author"
git config user.email fixture@example.invalid
git add -A
git commit -q -m "Initial commit"
git init -q --bare .git/fixture-origin.git
git remote add origin "$work/.git/fixture-origin.git"
git push -q origin main
git fetch -q origin
git branch -q --set-upstream-to=origin/main main
git remote set-head origin main

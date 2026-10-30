#!/usr/bin/env bash
# The fixture plus a small command line tool with tests; one test needs a file that only another
# machine has, so it fails here whatever the change.
set -euo pipefail
lib="$(dirname "$0")/../lib"
bash "$lib/fixture.sh"
for state in "$lib"/plugin-state/*.sh; do [ ! -e "$state" ] || bash "$state"; done
export GIT_AUTHOR_DATE=2026-10-02T12:00:00Z GIT_COMMITTER_DATE=2026-10-02T12:00:00Z

mkdir -p bin
cat >src/stats.mjs <<'JS'
import { words } from './text.mjs'

/** How many words the text has. */
export function wordCount(text) {
  return words(text).length
}

/** The n most frequent words of the text, lower-cased: most frequent first, ties in alphabetical order. */
export function topWords(text, n) {
  const counts = new Map()
  for (const word of words(text.toLowerCase())) counts.set(word, (counts.get(word) ?? 0) + 1)
  return [...counts]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0))
    .slice(0, n)
}
JS
cat >bin/textkit.mjs <<'JS'
#!/usr/bin/env node
// textkit count <file>      prints the number of words of the file
// textkit top <file> [n]    prints the n most frequent words (default 5), one "word count" a line
import { readFileSync } from 'node:fs'
import { topWords, wordCount } from '../src/stats.mjs'

const usage = 'usage: textkit count <file> | textkit top <file> [n]'
const [command, file, n] = process.argv.slice(2)
if (!file || !['count', 'top'].includes(command)) {
  console.error(usage)
  process.exit(2)
}
let text
try {
  text = readFileSync(file, 'utf8')
} catch (error) {
  console.error(`textkit: cannot read ${file}: ${error.code}`)
  process.exit(1)
}
if (command === 'count') console.log(wordCount(text))
else for (const { word, count } of topWords(text, n === undefined ? 5 : Number(n))) console.log(`${word} ${count}`)
JS
chmod +x bin/textkit.mjs
cat >test/cli.test.mjs <<'JS'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../bin/textkit.mjs', import.meta.url))
const textkit = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
const sample = join(mkdtempSync(join(tmpdir(), 'textkit-')), 'sample.txt')
writeFileSync(sample, 'the cat and the hat\nThe end\n')

test('count prints the number of words', () => {
  const run = textkit('count', sample)
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout, '7\n')
})

test('top prints the most frequent words first', () => {
  const run = textkit('top', sample, '2')
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout, 'the 3\nand 1\n')
})

test('an unknown command prints the usage', () => {
  const run = textkit('sort', sample)
  assert.equal(run.status, 2)
  assert.match(run.stderr, /usage/)
})

test('a missing file is an error', () => {
  const run = textkit('count', join(tmpdir(), 'no-such-file.txt'))
  assert.equal(run.status, 1)
  assert.match(run.stderr, /cannot read/)
})
JS
cat >test/corpus.test.mjs <<'JS'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// The reference corpus is kept on the build server, outside the repository.
const CORPUS = '/srv/textkit/corpus/en-sample.txt'
const CLI = fileURLToPath(new URL('../bin/textkit.mjs', import.meta.url))

test('count agrees with the published word count of the reference corpus', () => {
  const run = spawnSync(process.execPath, [CLI, 'count', CORPUS], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout, '120394\n')
})
JS
cat >>README.md <<'MD'

## Command line

```sh
node bin/textkit.mjs count notes.txt
node bin/textkit.mjs top notes.txt 10
```
MD
git add -A
git commit -q -m "Add the textkit command line tool"
git push -q origin main

#!/usr/bin/env bash
# The fixture plus a slug helper on main, and a branch report-export of three commits on top: a
# rename, the removal of a length limit, and a report exporter. main stays checked out.
set -euo pipefail
lib="$(dirname "$0")/../lib"
bash "$lib/fixture.sh"
for state in "$lib"/plugin-state/*.sh; do [ ! -e "$state" ] || bash "$state"; done
export GIT_AUTHOR_DATE=2026-10-02T12:00:00Z GIT_COMMITTER_DATE=2026-10-02T12:00:00Z

cat >src/slug.mjs <<'JS'
import { words } from './text.mjs'

const MAX_LENGTH = 80

/** A slug of the text for a file or link name: lower-case words joined by '-', at most maxLength characters. */
export function slugify(text, maxLength = 40) {
  if (maxLength > MAX_LENGTH) throw new RangeError(`maxLength over ${MAX_LENGTH}: ${maxLength}`)
  const slug = words(text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')).join('-')
  return slug.slice(0, maxLength).replace(/-+$/, '')
}
JS
cat >test/slug.test.mjs <<'JS'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { slugify } from '../src/slug.mjs'

test('slugify joins lower-case words with dashes', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world')
})

test('slugify cuts at maxLength without a dash at the end', () => {
  assert.equal(slugify('one two three', 8), 'one-two')
})

test('slugify refuses a maxLength over 80', () => {
  assert.throws(() => slugify('a', 81), RangeError)
})
JS
git add -A
git commit -q -m "Add slugify()"
git push -q origin main

git checkout -q -b report-export
export GIT_AUTHOR_NAME="Sam Ortiz" GIT_AUTHOR_EMAIL=sam@example.invalid
export GIT_AUTHOR_DATE=2026-10-03T10:00:00Z GIT_COMMITTER_DATE=2026-10-03T10:00:00Z

# 1. The rename.
perl -pi -e "s/\\bwords\\b(?=\\(| \\})/splitWords/g" src/text.mjs src/slug.mjs test/text.test.mjs README.md
git commit -q -am "Rename words() to splitWords()

words() reads like a noun; splitWords() says what it does. Behaviour is
unchanged. textkit is private and used only inside this repository;
every caller, test and the README are updated in this commit, so no
alias is kept."

# 2. The limit goes.
export GIT_AUTHOR_DATE=2026-10-03T11:00:00Z GIT_COMMITTER_DATE=2026-10-03T11:00:00Z
cat >src/slug.mjs <<'JS'
import { splitWords } from './text.mjs'

/** A slug of the text for a file or link name: lower-case words joined by '-', at most maxLength characters. */
export function slugify(text, maxLength = 40) {
  const slug = splitWords(text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')).join('-')
  return slug.slice(0, maxLength).replace(/-+$/, '')
}
JS
cat >test/slug.test.mjs <<'JS'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { slugify } from '../src/slug.mjs'

test('slugify joins lower-case words with dashes', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world')
})

test('slugify cuts at maxLength without a dash at the end', () => {
  assert.equal(slugify('one two three', 8), 'one-two')
})

test('slugify takes a maxLength over 80', () => {
  const title = 'quarterly '.repeat(12)
  assert.equal(slugify(title, 200).length, 'quarterly-'.repeat(12).length - 1)
})
JS
git commit -q -am "Drop the 80-character cap of slugify()

The cap came from the old file-share links, which cut names after 80
characters. Those links are gone: slugs now only name local files (see
the report export in the next commit), and report titles are often
longer. Callers still pass their own maxLength; the default stays 40."

# 3. The report export.
export GIT_AUTHOR_DATE=2026-10-03T12:00:00Z GIT_COMMITTER_DATE=2026-10-03T12:00:00Z
mkdir -p templates
cat >templates/plain.txt <<'TXT'
{{title}}
Page {{page}} of {{pages}}

{{rows}}
TXT
cat >src/report.mjs <<'JS'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { slugify } from './slug.mjs'
import { capitalize } from './text.mjs'

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url))

/** How many pages `count` rows take, `pageSize` rows a page; an empty list still has one page. */
export function pageCount(count, pageSize) {
  return Math.floor(count / pageSize) + 1
}

/** The rows of page `page` (counted from 1). */
export function pageOf(rows, page, pageSize) {
  const pages = pageCount(rows.length, pageSize)
  if (page < 1 || page > pages) throw new RangeError(`page ${page} of ${pages}`)
  const start = (page - 1) * pageSize
  return rows.slice(start, start + pageSize)
}

/** The text of the template `name` (templates/<name>.txt). */
export async function loadTemplate(name) {
  return readFile(join(TEMPLATES, `${name}.txt`), 'utf8')
}

/** The template with {{title}}, {{page}}, {{pages}} and {{rows}} filled in. */
export function render(template, { title, page, pages, rows }) {
  return template
    .replaceAll('{{title}}', capitalize(title))
    .replaceAll('{{page}}', String(page))
    .replaceAll('{{pages}}', String(pages))
    .replaceAll('{{rows}}', rows.map((row) => `- ${row}`).join('\n'))
}

/** Writes one page of a report to <dir>/<slug of the title>-<page>.txt and returns that path. */
export function savePage(dir, title, page, text) {
  const file = join(dir, `${slugify(title)}-${page}.txt`)
  writeFile(file, text)
  return file
}

/** Writes every page of a report and returns the paths, in page order. */
export async function exportReport({ dir, title, rows, template = 'plain', pageSize = 20 }) {
  const text = await loadTemplate(template)
  const pages = pageCount(rows.length, pageSize)
  const files = []
  for (let page = 1; page <= pages; page++) {
    files.push(savePage(dir, title, page, render(text, { title, page, pages, rows: pageOf(rows, page, pageSize) })))
  }
  return files
}
JS
mkdir -p bin
cat >bin/report.mjs <<'JS'
#!/usr/bin/env node
// report <rows file> --title <title> [--template <name>] [--out <dir>]
// Exports the lines of <rows file> as a paged report: one file per page in <dir> (default: .).
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { exportReport } from '../src/report.mjs'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { title: { type: 'string' }, template: { type: 'string' }, out: { type: 'string' } },
})
if (positionals.length !== 1 || !values.title) {
  console.error('usage: report <rows file> --title <title> [--template <name>] [--out <dir>]')
  process.exit(2)
}
const rows = readFileSync(positionals[0], 'utf8').split('\n').filter(Boolean)
const files = await exportReport({ dir: values.out ?? '.', title: values.title, rows, template: values.template })
for (const file of files) console.log(file)
JS
chmod +x bin/report.mjs
cat >test/report.test.mjs <<'JS'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadTemplate, pageCount, pageOf, render } from '../src/report.mjs'

const rows = Array.from({ length: 45 }, (_, i) => `row ${i + 1}`)

test('pageCount rounds up, and an empty list has one page', () => {
  assert.equal(pageCount(45, 20), 3)
  assert.equal(pageCount(5, 20), 1)
  assert.equal(pageCount(0, 20), 1)
})

test('pageOf returns the rows of one page', () => {
  assert.deepEqual(pageOf(rows, 1, 20), rows.slice(0, 20))
  assert.deepEqual(pageOf(rows, 3, 20), rows.slice(40))
  assert.throws(() => pageOf(rows, 4, 20), RangeError)
  assert.throws(() => pageOf(rows, 0, 20), RangeError)
})

test('render fills in the template', () => {
  const text = render('{{title}} {{page}}/{{pages}}\n{{rows}}', { title: 'sales', page: 2, pages: 3, rows: ['a', 'b'] })
  assert.equal(text, 'Sales 2/3\n- a\n- b')
})

test('loadTemplate reads a template of the templates folder', async () => {
  assert.match(await loadTemplate('plain'), /\{\{rows\}\}/)
})
JS
cat >>README.md <<'MD'

## Reports

```sh
node bin/report.mjs rows.txt --title "Monthly sales" --out reports/
```

Writes one file per page of 20 rows, filled in from `templates/plain.txt` (or `--template <name>`).
MD
git add -A
git commit -q -m "Add a paged report export

src/report.mjs splits rows into pages, fills a template from templates/
and writes one file per page. The report service will call exportReport()
with the fields of a user's request (title, rows, template); bin/report.mjs
is the command line for local use."
git push -q origin report-export
git checkout -q main

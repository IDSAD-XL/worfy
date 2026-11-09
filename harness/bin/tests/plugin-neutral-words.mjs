// The word scan of bin/tests/plugin-neutral.test.sh: finds the words one person's plugin must not
// carry (their names, accounts, machines, work projects, the account of the repository the plugin
// comes from) without naming them. The list (plugin-neutral.words.json next to this file) holds the
// SHA-256 of each word in lower case and its length, never the word. Only the plugin scan reads it.
//
//   node plugin-neutral-words.mjs <dir> [--words <list.json>] < <file list>
//       Scans each file named on stdin (paths from <dir>, one per line): its path and, unless the
//       file is binary, every line of its text. A word is found the way `grep -i -F` finds it: as
//       part of a longer word too, whatever the letter case. Prints one line per finding with the
//       file, the line, the kind of the word and its mask (first two letters and the length), never
//       the word; then one line per stale exception. Exit 0 — nothing found, 1 — findings, 2 — the
//       list could not be read.
//   node plugin-neutral-words.mjs --word <word>
//       Prints the entry of the list for <word>: its length and the SHA-256 of its lower case.
//   node plugin-neutral-words.mjs --line <text>
//       Prints the SHA-256 of a line, the form an exception of the list takes.
//
// A word is letters, digits, ".", "_" and "-": the scan hashes every stretch of a run of those
// characters that is as long as some word of the list, so a word with another character could never
// be found, and --word refuses it.
//
// An exception ({"file", "line_sha256"}) lets one line of one file carry a word: the line, with the
// spaces around it taken off, must hash to line_sha256. An exception that no line needs any more is
// stale and fails the scan, so that the list keeps only what is needed.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WORD = /^[a-z0-9._-]+$/
const RUN = /[a-z0-9._-]+/g
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')
const mask = (text) => `${text.slice(0, 2)}…(${text.length})`

function fail(message) {
  console.error(`plugin-neutral-words: ${message}`)
  process.exit(2)
}

const args = process.argv.slice(2)
if (args[0] === '--word') {
  const word = (args[1] ?? '').toLowerCase()
  if (!WORD.test(word)) fail('a word is letters, digits, ".", "_" and "-"')
  console.log(JSON.stringify({ length: word.length, sha256: sha256(word) }))
  process.exit(0)
}
if (args[0] === '--line') {
  console.log(sha256((args[1] ?? '').trim()))
  process.exit(0)
}

const dir = args[0]
if (dir === undefined || dir.startsWith('--')) fail('usage: plugin-neutral-words.mjs <dir> [--words <list.json>] < <file list>')
const listFile = args[1] === '--words' && args[2] ? args[2] : join(dirname(fileURLToPath(import.meta.url)), 'plugin-neutral.words.json')
let list
try {
  list = JSON.parse(readFileSync(listFile, 'utf8'))
} catch (error) {
  fail(`the list ${listFile} could not be read: ${error.message}`)
}
const words = Array.isArray(list?.words) ? list.words : []
const allowed = Array.isArray(list?.allowed) ? list.allowed : []
const bad = words.filter((w) => !(Number.isInteger(w?.length) && w.length > 0 && /^[0-9a-f]{64}$/.test(w?.sha256 ?? '')))
if (words.length === 0 || bad.length > 0) fail(`the list ${listFile} has no words or a word without a length and a SHA-256`)

const byHash = new Map(words.map((w) => [w.sha256, w]))
const lengths = [...new Set(words.map((w) => w.length))]
const runs = new Map()
/** The words of the list inside one run of word characters (lower case), each with where it starts. */
function wordsIn(run) {
  let found = runs.get(run)
  if (found === undefined) {
    found = []
    for (const length of lengths) {
      for (let at = 0; at + length <= run.length; at++) {
        const piece = run.slice(at, at + length)
        const word = byHash.get(sha256(piece))
        if (word !== undefined) found.push({ word, piece })
      }
    }
    runs.set(run, found)
  }
  return found
}
/** The words of the list in a line of text, as masks with their kind. */
function scan(text) {
  const out = []
  for (const match of text.toLowerCase().matchAll(RUN)) for (const { word, piece } of wordsIn(match[0])) out.push(`${word.kind ?? 'a forbidden word'} (${mask(piece)})`)
  return out
}

const files = readFileSync(0, 'utf8').split(/\r?\n/).filter((f) => f !== '')
const findings = []
const used = new Set()
for (const file of files) {
  for (const hit of scan(file)) findings.push(`${file}: in the path: ${hit}`)
  let bytes
  try {
    bytes = readFileSync(join(dir, file))
  } catch {
    continue
  }
  // Binary the way grep -I tells it: a NUL byte near the start.
  if (bytes.subarray(0, 8000).includes(0)) continue
  bytes.toString('utf8').split('\n').forEach((line, index) => {
    const hits = scan(line)
    if (hits.length === 0) return
    const lineHash = sha256(line.trim())
    const exception = allowed.findIndex((a) => a?.file === file && a?.line_sha256 === lineHash)
    if (exception >= 0) {
      used.add(exception)
      return
    }
    for (const hit of hits) findings.push(`${file}:${index + 1}: ${hit}`)
  })
}
for (const line of findings) console.log(line)
// Stale: an exception no line used, because the line changed or no longer carries a word of the list.
allowed.forEach((a, index) => {
  if (used.has(index)) return
  findings.push(a)
  console.log(`stale exception ${index + 1}: ${a?.file}: no line of it needs it`)
})
process.exit(findings.length === 0 ? 0 : 1)

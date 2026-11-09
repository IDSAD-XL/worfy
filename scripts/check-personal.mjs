#!/usr/bin/env node
// The guard of personal strings in the tracked files of the repository (epic worfy-scrub). The
// repository is public: a home folder path with a user name, a machine name, a Tailscale address, an
// email address, a token or a word of the owner's personal list must not be in a tracked file, in
// its text or in its path.
//
//   node scripts/check-personal.mjs [--report [--list]] [--root <dir>]
//       Checks the files of `git ls-files` under <dir> (default: the repository of this script).
//       One line per finding, `<path>:<line>: <rule>: <mask>` (`name` in place of the line for a
//       finding in the path), then the total and the counts by rule and by top folder. Under
//       --report only the counts, unless --list asks for the lines too. Exit 0 with no findings, 1
//       with findings, 0 with findings under --report, 2 when the guard cannot run.
//   node scripts/check-personal.mjs --hash-from <privacy.json>
//       Prints the hash list (the content of scripts/check-personal.hashes.json) of the personal list
//       {"deny": ["…"]}: hashes only, never a word. An entry the word matching cannot catch — no
//       words, or more than three — is refused with exit 1 and its index, without its value.
//
// The rules:
//   - home-path, host, tailscale-ip, email, token of harness/lib/privacy.cjs, which this script only
//     requires: one rule for the Harness and the repository. The uuid rule is left out: ids in
//     fixtures are not personal. STAND_IN_HOSTS and STAND_IN_TAILSCALE below are the stand-ins of
//     fixtures, never a finding (privacy.cjs knows the stand-in home folders and the example hosts).
//   - deny-word: a word of the personal list, matched by its SHA-256 in scripts/check-personal.hashes.json
//     (the list itself stays outside the repository). A path and a file's text are cut into words — runs
//     of letters and digits of any script (\p{L}, \p{M}, \p{N}: a Cyrillic word is a word, and a
//     combining accent stays inside its word), each in NFC and lower-cased; an entry of the list is
//     cut the same way, so `foo-bar` and `foo.bar` are the two words foo and bar — and each word and each run of two and three
//     neighbouring words joined with `-` is matched; neighbours may stand on two lines (wrapped prose),
//     the finding is on the line of the first word. A personal word glued to another one or in another
//     form (a plural) is not caught: an empty report is not proof that nothing personal is left.
//     The hash list: {"sha256": [the entries], "first": [...]}. "first" holds the first four hex
//     digits of the hash of the first word of each entry of two or three words: only a word whose
//     hash starts so is joined with its neighbours and hashed again. Without it the guard would hash
//     every pair and triple of the tree, some 17 million on 50 MB of text, and lint would wait
//     seconds for it; four hex digits of a word's hash say far less than the entry's own hash.
//
// A binary file (a NUL byte in its first 8 KB, or an image, font, archive or media extension) is
// checked by its name only.
//
// Exceptions, scripts/check-personal.allow.json: {"allow": [{"path", "rule", "sha256", "reason"}]}, sha256 of
// the value as found (for deny-word, of the lower-case words joined with `-`). An exception that drops
// no finding is a finding itself, stale-allow. "reason" says why the value is not personal; the guard
// does not read it.
//
// Nothing prints a value whole: the CI log is public. A value is printed through privacy.mask (the
// first two characters and the length), in a path too.

import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { hash } from 'node:crypto'
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readlinkSync, readSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const privacy = createRequire(import.meta.url)(join(REPO, 'harness', 'lib', 'privacy.cjs'))

const HASHES = 'scripts/check-personal.hashes.json'
const ALLOW = 'scripts/check-personal.allow.json'
const RULES = new Set(['home-path', 'host', 'tailscale-ip', 'email', 'token'])
const MAX_WORDS = 3

// Stand-in hosts of fixtures (owner decision Q6), in lower case: an invented machine in every form
// the host rules catch (someones-MacBook-Pro, someones-PC, and with .local), and capture-host, the
// host scripts/codex-capture.mjs writes into the Codex recordings. Only the whole value is
// a stand-in (standInHost): the same name under a tailnet (<name>.<tailnet>.ts.net) names a real
// tailnet and stays a finding. Hosts with an `example` label (<host>.example.ts.net) are stand-ins in
// privacy.cjs already.
const STAND_IN_HOSTS = new Set(['someones-mac', 'someones-macbook', 'someones-macbook-pro', 'someones-macbook-air', 'someones-pc', 'desktop-0000000', 'capture-host'])

/** A host value that is a stand-in as a whole: a name of STAND_IN_HOSTS, alone or with .local. */
function standInHost(value) {
  const host = value.toLowerCase()
  const name = host.endsWith('.local') ? host.slice(0, -'.local'.length) : host
  return STAND_IN_HOSTS.has(name)
}
// Stand-in user names of a home folder, beyond those of privacy.cjs: owner, of the home folder
// scripts/codex-capture.mjs writes into the Codex recordings.
const STAND_IN_HOME_NAMES = new Set(['owner'])
// Stand-in Tailscale addresses: 100.100.100.100, the DNS server of Tailscale itself (quad-100), and
// 100.64.0.1–100.64.0.20, the first addresses of the range, for tests that need more than one peer.
const STAND_IN_TAILSCALE = new Set(['100.100.100.100', ...Array.from({ length: 20 }, (_, i) => `100.64.0.${i + 1}`)])

const BINARY_EXT = /\.(?:png|jpe?g|gif|webp|ico|icns|bmp|tiff?|pdf|zip|gz|tgz|bz2|xz|7z|dmg|exe|dll|node|woff2?|ttf|otf|eot|mp3|mp4|m4a|wav|webm|mov|avi|sqlite|db|bin|wasm)$/i

const sha256 = (value) => hash('sha256', value, 'hex')
const PREFIX = 4

// A word: a run of letters, combining marks and digits of any script. A text of ASCII only (most
// files) is cut by the ASCII form of the same rule, which is faster.
const WORD = /[\p{L}\p{M}\p{N}]+/gu
const ASCII_WORD = /[A-Za-z0-9]+/g
const ASCII = /^[\p{ASCII}]*$/u

/** A word as it is hashed: NFC (a decomposed letter as its composed one), lower case. */
function normalWord(word) {
  return (ASCII.test(word) ? word : word.normalize('NFC')).toLowerCase()
}

/** The parts of a personal-list entry, cut by the rule of the text. */
function entryWords(entry) {
  return [...entry.matchAll(WORD)].map((m) => normalWord(m[0]))
}

// Hashes of the words seen so far: most words repeat across the tree.
const seen = new Map()
function wordHash(word) {
  let h = seen.get(word)
  if (h === undefined) {
    if (seen.size > 2_000_000) seen.clear()
    h = sha256(word)
    seen.set(word, h)
  }
  return h
}

/**
 * The findings of a text (a file's text or a path): [{ rule, index, length, key }], key is what an
 * exception hashes. `deny` is { full, first }: the hashes of the entries and the hash prefixes of
 * the first words of entries of more than one word.
 */
function scan(text, deny) {
  const found = []
  for (const f of privacy.findings(text)) {
    if (!RULES.has(f.rule)) continue
    const value = text.slice(f.index, f.index + f.length)
    if (f.rule === 'host' && standInHost(value)) continue
    if (f.rule === 'tailscale-ip' && STAND_IN_TAILSCALE.has(value)) continue
    if (f.rule === 'home-path' && STAND_IN_HOME_NAMES.has(value.toLowerCase())) continue
    found.push({ rule: f.rule, index: f.index, length: f.length, key: value })
  }
  if (deny.full.size > 0) {
    const add = (start, end, key) => found.push({ rule: 'deny-word', index: start, length: end - start, key })
    // The two words before the current one; `lead` when a word may start an entry of more words.
    let before2
    let before1
    const ascii = ASCII.test(text)
    for (const m of text.matchAll(ascii ? ASCII_WORD : WORD)) {
      const word = ascii ? m[0].toLowerCase() : normalWord(m[0])
      const h = wordHash(word)
      const current = { word, start: m.index, lead: deny.first.has(h.slice(0, PREFIX)) }
      const end = m.index + m[0].length
      if (deny.full.has(h)) add(current.start, end, word)
      if (before1?.lead) {
        const pair = `${before1.word}-${word}`
        if (deny.full.has(sha256(pair))) add(before1.start, end, pair)
      }
      if (before2?.lead) {
        const triple = `${before2.word}-${before1.word}-${word}`
        if (deny.full.has(sha256(triple))) add(before2.start, end, triple)
      }
      before2 = before1
      before1 = current
    }
  }
  return found.sort((a, b) => a.index - b.index || b.length - a.length)
}

/** `text` with each finding replaced by its mask (overlapping findings masked as one). */
function maskSpans(text, found) {
  const spans = []
  for (const f of found) {
    const last = spans[spans.length - 1]
    if (last && f.index < last.end) last.end = Math.max(last.end, f.index + f.length)
    else spans.push({ start: f.index, end: f.index + f.length })
  }
  let out = text
  for (let i = spans.length - 1; i >= 0; i--) {
    const { start, end } = spans[i]
    out = out.slice(0, start) + privacy.mask(text.slice(start, end)) + out.slice(end)
  }
  return out
}

/** The offsets where the lines of a text start; \r\n ends a line as \n does. */
function lineStarts(text) {
  const starts = [0]
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
  return starts
}

/** The 1-based line of an offset. */
function lineOf(starts, index) {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= index) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

function isBinary(rel, file) {
  if (BINARY_EXT.test(rel)) return true
  const fd = openSync(file, 'r')
  try {
    const head = Buffer.alloc(8192)
    const n = readSync(fd, head, 0, head.length, 0)
    return head.subarray(0, n).includes(0)
  } finally {
    closeSync(fd)
  }
}

function fail(message) {
  process.stderr.write(`check-personal: ${message}\n`)
  process.exit(2)
}

function readJson(file, what) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    // Not the parser's message: it quotes a piece of the file, and the personal list is personal.
    return fail(`cannot read ${what}: ${error instanceof SyntaxError ? 'not valid JSON' : (error.code ?? 'unreadable')}`)
  }
}

function hashFrom(file) {
  const data = readJson(file, 'the personal list')
  if (!Array.isArray(data?.deny)) fail('the personal list has no "deny" array')
  const hashes = new Set()
  const first = new Set()
  const refused = []
  data.deny.forEach((entry, i) => {
    if (typeof entry !== 'string') return refused.push(`deny[${i}]: not a string`)
    const parts = entryWords(entry)
    if (parts.length === 0) return refused.push(`deny[${i}]: no words — no letter or digit to match`)
    if (parts.length > MAX_WORDS) return refused.push(`deny[${i}]: ${parts.length} words — the guard matches at most ${MAX_WORDS} neighbouring words`)
    hashes.add(sha256(parts.join('-')))
    if (parts.length > 1) first.add(sha256(parts[0]).slice(0, PREFIX))
  })
  if (refused.length > 0) {
    process.stderr.write(`check-personal: ${refused.length} entries of the personal list cannot be matched by words; no hashes printed:\n`)
    for (const line of refused) process.stderr.write(`  ${line}\n`)
    process.exit(1)
  }
  process.stdout.write(`${JSON.stringify({ sha256: [...hashes].sort(), first: [...first].sort() }, null, 2)}\n`)
}

function check(root, report, list) {
  const hashList = readJson(join(root, HASHES), HASHES)
  if (!Array.isArray(hashList?.sha256) || !Array.isArray(hashList?.first)) fail(`${HASHES} needs a "sha256" and a "first" array`)
  const deny = { full: new Set(hashList.sha256.map((h) => String(h).toLowerCase())), first: new Set(hashList.first.map((h) => String(h).toLowerCase())) }
  const allowFile = join(root, ALLOW)
  const allowData = existsSync(allowFile) ? readJson(allowFile, ALLOW) : { allow: [] }
  if (!Array.isArray(allowData?.allow)) fail(`${ALLOW} has no "allow" array`)
  const allow = allowData.allow.map((a) => ({ ...a, used: false }))

  let listed
  try {
    listed = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  } catch (error) {
    fail(`git ls-files failed: ${String(error.message).split('\n')[0]}`)
  }
  const files = listed.split('\0').filter(Boolean)

  const lines = []
  const byRule = new Map()
  const byFolder = new Map()
  const withFindings = new Set()
  let checked = 0
  const record = (rel, shown, where, rule, masked) => {
    lines.push(`${shown}:${where}: ${rule}: ${masked}`)
    byRule.set(rule, (byRule.get(rule) ?? 0) + 1)
    const folder = rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '(root)'
    byFolder.set(folder, (byFolder.get(folder) ?? 0) + 1)
    withFindings.add(rel)
  }
  const allowed = (rel, f) => {
    const h = sha256(f.key)
    const a = allow.find((x) => x.path === rel && x.rule === f.rule && String(x.sha256).toLowerCase() === h)
    if (a) a.used = true
    return a !== undefined
  }

  for (const rel of files) {
    const file = join(root, rel)
    let stat
    try {
      stat = lstatSync(file)
    } catch {
      continue // deleted in the working tree, not yet in the index
    }
    checked++
    const inPath = scan(rel, deny)
    const shown = inPath.length > 0 ? maskSpans(rel, inPath) : rel
    for (const f of inPath) if (!allowed(rel, f)) record(rel, shown, 'name', f.rule, privacy.mask(rel.slice(f.index, f.index + f.length)))
    // A symbolic link: git keeps its target as its text. A submodule (a folder): its name only.
    if (!stat.isSymbolicLink() && (!stat.isFile() || isBinary(rel, file))) continue
    const text = stat.isSymbolicLink() ? readlinkSync(file) : readFileSync(file, 'utf8')
    const inText = scan(text, deny)
    if (inText.length === 0) continue
    const starts = lineStarts(text)
    for (const f of inText) if (!allowed(rel, f)) record(rel, shown, lineOf(starts, f.index), f.rule, privacy.mask(text.slice(f.index, f.index + f.length)))
  }
  allow.forEach((a, i) => {
    if (!a.used) record(ALLOW, ALLOW, 0, 'stale-allow', `allow[${i}] (${a.rule})`)
  })

  const order = (map) =>
    [...map]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([k, n]) => `${k} ${n}`)
      .join(', ')
  // The lines go out in strict mode always, under --report only with --list: pnpm lint runs the
  // report on every call and needs the counts, not thousands of lines.
  let out = !report || list ? lines.map((l) => `${l}\n`).join('') : ''
  if (lines.length === 0) {
    out += `check-personal: no findings in ${checked} files\n`
  } else {
    out += `check-personal: ${lines.length} findings in ${withFindings.size} of ${checked} files\n`
    out += `  by rule: ${order(byRule)}\n`
    out += `  by top folder: ${order(byFolder)}\n`
  }
  process.stdout.write(out)
  process.exitCode = lines.length > 0 && !report ? 1 : 0
}

function main(argv) {
  let report = false
  let list = false
  let root = REPO
  let from
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--report') report = true
    else if (arg === '--list') list = true
    else if (arg === '--root' && i + 1 < argv.length) root = resolve(argv[++i])
    else if (arg === '--hash-from' && i + 1 < argv.length) from = resolve(argv[++i])
    else fail(`unknown argument ${JSON.stringify(arg)}; usage: check-personal.mjs [--report [--list]] [--root <dir>] | --hash-from <privacy.json>`)
  }
  if (from !== undefined) hashFrom(from)
  else check(root, report, list)
}

main(process.argv.slice(2))

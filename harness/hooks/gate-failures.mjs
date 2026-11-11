// The failure records of the gate: one record per failed test, or per failed script that left no
// test records, of one gate run. They let a red run be told apart later — a flaky test from a test
// that stays red — across many runs and more than one computer.
//
// Files, all in the state folder of the gate (gateStateDir in gate-paths.mjs), outside every repository:
//   <state>/failures/<tag>--<run>.json                    the run file: a run with at least one failed script
//   <state>/failures/<tag>--<run>.rerun-<stamp>.json      the rerun file: the failed tests run one at a time
//   <state>/failures/imported/<computer id>/<same names>  the files of another computer, brought by import
// <tag> and <run> are the names of the log folder of the same run (runLogDir in gate-log.mjs): the run
// id is "<tag>/<run>". <stamp> is the `at` of the rerun with "-" in place of ":".
//
// The run file, version 1 (a machine contract: no words of any one language):
//   version 1, kind "run";
//   run      — "<tag>/<run>";
//   at, key, profile, head, outcome — as in the verdict file of the gate (gate.mjs, its header);
//   computer — { id, name, platform }: the computer the gate ran on (machine.json below), never a host name;
//   dirty    — true when `git status --porcelain` was not empty before the scripts: the run did not
//              test `head` alone. Required: a reader that cannot tell must not guess;
//   failures — [{ step, runner, file, line, name, test, ms, error, attempt, rerun }]:
//     step    the label of the gate step ("demo/.:test");
//     runner  "vitest", "playwright" or another name, null for a script without test records;
//     file    from the root of the repository, with "/"; line — of the test's declaration; name — the
//             describe blocks and the test joined by " > "; test — testId() of the three, or null;
//     ms      how long the test (or the script) took, or null; error — the first line of the error,
//             scrubbed, at most 200 characters; attempt — 1 and up; rerun — the argv that runs this
//             test alone ("node" first), or null.
// The rerun file, version 1: kind "rerun", of (the run id), at, head, computer, results [{ test, exit, ms, error }].
//
// The text of a record passes scrub() before it is written: the root of the worktree, the home folder,
// the user name and the host name are replaced here, and everything else that harness/lib/privacy.cjs
// finds (UUIDs, email addresses, tokens…) is masked by it. The patterns live there, not here.
//
// machine.json — <Harness home>/gate/machine.json, { id, name }: the id is 8 random hex digits made
// once, the name "mac", "windows" or "linux" until the user gives another one.
//
// Records live 60 days by the `at` inside the file, not by the time the file was written:
// pruneFailures removes older ones from both the own folder and imported/.
//
// Node only, no shell utility: the same code runs on macOS, Linux and Windows. Types: gate-failures.d.mts.

import crypto from "node:crypto"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { stripVTControlCharacters } from "node:util"

const require = createRequire(import.meta.url)
const privacy = require("../lib/privacy.cjs")

export const FORMAT_VERSION = 1
export const FAILURES_DAYS = 60
export const ERROR_CHARS = 200
const DAY_MS = 24 * 60 * 60 * 1000

const OUTCOMES = ["green", "red", "unverified", "none"]
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const COMPUTER_ID = /^[0-9a-f]{8}$/
// "<tag>/<run>": two names that a file name can hold, without "--" (the separator of the file name).
const RUN_ID = /^(?!.*--)[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const RUN_FILE = /^(?!\.)[A-Za-z0-9._-]+--[A-Za-z0-9._-]+\.json$/

// --- reading and checking -------------------------------------------------------------------

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
const isStringOrNull = (v) => v === null || typeof v === "string"
const isCount = (v) => Number.isInteger(v) && v >= 0

function checkAt(at) {
    if (typeof at !== "string" || !AT.test(at)) return "at: not a UTC time like 2026-11-04T10:00:00Z"
    // Date.parse accepts 2026-02-30; the round trip does not.
    const time = Date.parse(at)
    if (Number.isNaN(time) || new Date(time).toISOString().replace(/\.\d+Z$/, "Z") !== at) return "at: not a real time"
    return null
}

function checkComputer(computer) {
    if (!isObject(computer)) return "computer: not an object"
    if (typeof computer.id !== "string" || !COMPUTER_ID.test(computer.id)) return "computer.id: not 8 hex digits"
    if (typeof computer.name !== "string" || computer.name.trim() === "") return "computer.name: empty"
    if (typeof computer.platform !== "string" || computer.platform === "") return "computer.platform: empty"
    return null
}

// The version first: a file of another version is named as such, whatever else it lacks.
function checkHead(record) {
    if (!("version" in record)) return "version: missing"
    if (record.version !== FORMAT_VERSION) return `version: ${JSON.stringify(record.version)}, this reader knows ${FORMAT_VERSION}`
    if (!("kind" in record)) return "kind: missing"
    return null
}

function checkFailure(f, where) {
    if (!isObject(f)) return `${where}: not an object`
    if (typeof f.step !== "string" || f.step === "") return `${where}.step: empty`
    for (const field of ["runner", "file", "name", "test"]) if (!isStringOrNull(f[field])) return `${where}.${field}: not a string or null`
    if (!(f.line === null || (Number.isInteger(f.line) && f.line > 0))) return `${where}.line: not a line number or null`
    if (!(f.ms === null || isCount(f.ms))) return `${where}.ms: not whole milliseconds or null`
    if (typeof f.error !== "string") return `${where}.error: not a string`
    if ([...f.error].length > ERROR_CHARS || /[\r\n]/.test(f.error)) return `${where}.error: not one line of at most ${ERROR_CHARS} characters`
    if (!(Number.isInteger(f.attempt) && f.attempt >= 1)) return `${where}.attempt: not a whole number from 1`
    if (!(f.rerun === null || (Array.isArray(f.rerun) && f.rerun.length > 0 && f.rerun.every((a) => typeof a === "string")))) {
        return `${where}.rerun: not an argv or null`
    }
    if (f.runner !== null && f.file !== null && f.name !== null && f.test !== testId(f.runner, f.file, f.name)) {
        return `${where}.test: not the id of its runner, file and name`
    }
    return null
}

// The reason a run record is wrong, or null when it is a run record of version 1.
export function checkRunRecord(record) {
    if (!isObject(record)) return "not a JSON object"
    const head = checkHead(record)
    if (head) return head
    if (record.kind !== "run") return `kind: ${JSON.stringify(record.kind)}, not "run"`
    if (typeof record.run !== "string" || !RUN_ID.test(record.run)) return "run: not <tag>/<run>"
    const at = checkAt(record.at)
    if (at) return at
    if (!isStringOrNull(record.key)) return "key: not a string or null"
    if (typeof record.profile !== "string" || record.profile === "") return "profile: empty"
    if (!isStringOrNull(record.head)) return "head: not a string or null"
    if (!OUTCOMES.includes(record.outcome)) return `outcome: not one of ${OUTCOMES.join(", ")}`
    const computer = checkComputer(record.computer)
    if (computer) return computer
    if (typeof record.dirty !== "boolean") return "dirty: missing or not true/false"
    if (!Array.isArray(record.failures)) return "failures: not a list"
    for (let i = 0; i < record.failures.length; i++) {
        const reason = checkFailure(record.failures[i], `failures[${i}]`)
        if (reason) return reason
    }
    return null
}

// The reason a rerun record is wrong, or null when it is a rerun record of version 1.
export function checkRerunRecord(record) {
    if (!isObject(record)) return "not a JSON object"
    const head = checkHead(record)
    if (head) return head
    if (record.kind !== "rerun") return `kind: ${JSON.stringify(record.kind)}, not "rerun"`
    if (typeof record.of !== "string" || !RUN_ID.test(record.of)) return "of: not <tag>/<run>"
    const at = checkAt(record.at)
    if (at) return at
    if (!isStringOrNull(record.head)) return "head: not a string or null"
    const computer = checkComputer(record.computer)
    if (computer) return computer
    if (!Array.isArray(record.results)) return "results: not a list"
    for (let i = 0; i < record.results.length; i++) {
        const r = record.results[i]
        const where = `results[${i}]`
        if (!isObject(r)) return `${where}: not an object`
        if (typeof r.test !== "string" || r.test === "") return `${where}.test: empty`
        if (!(r.exit === null || Number.isInteger(r.exit))) return `${where}.exit: not an exit code or null`
        if (!(r.ms === null || isCount(r.ms))) return `${where}.ms: not whole milliseconds or null`
        if (!isStringOrNull(r.error)) return `${where}.error: not a string or null`
    }
    return null
}

function parseWith(text, check) {
    let record
    try {
        record = JSON.parse(String(text))
    } catch (error) {
        return { ok: false, reason: `not JSON: ${firstLine(error instanceof Error ? error.message : String(error), ERROR_CHARS)}` }
    }
    const reason = check(record)
    return reason ? { ok: false, reason } : { ok: true, record }
}

// { ok: true, record } for the text of a run file of version 1, else { ok: false, reason } with one line.
export function parseRunFile(text) {
    return parseWith(text, checkRunRecord)
}

// The same for the text of a rerun file.
export function parseRerunFile(text) {
    return parseWith(text, checkRerunRecord)
}

// Either kind, by its `kind`.
export function parseRecordFile(text) {
    return parseWith(text, (record) => (isObject(record) && record.kind === "rerun" ? checkRerunRecord(record) : checkRunRecord(record)))
}

// --- the text of a record -------------------------------------------------------------------

// The id of a test for comparing runs: the runner, the file and the name, without the line, which
// moves from commit to commit.
export function testId(runner, file, name) {
    return `${runner} ${file} > ${name}`
}

// The first line of `text` that holds anything, without ANSI control sequences or other control
// characters, at most `max` characters (the last one "…" when it was cut).
export function firstLine(text, max = ERROR_CHARS) {
    const plain = stripVTControlCharacters(String(text ?? ""))
        .replace(/\t/g, " ")
        // eslint-disable-next-line no-control-regex -- the control characters are what is removed
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    const line = (plain.split(/\r\n|\r|\n/).find((l) => l.trim() !== "") ?? "").trim()
    const chars = [...line]
    return chars.length <= max ? line : chars.slice(0, Math.max(0, max - 1)).join("") + "…"
}

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Before a path: not inside a word, a longer path or a stand-in (<repo>/…, ~/…, C:…).
const BEFORE_PATH = String.raw`(?<![\w.~>:…-])`
// After a path: the end of the name — a separator, white space, a quote, punctuation, the end of the text.
const AFTER_PATH = String.raw`(?![^\\/\s"'\x60:;,)\]}>])`

// A regular expression for the folder `dir` in any spelling a log uses: with "\" or "/" (one or more:
// JSON doubles "\"), and for a Windows path also as Git Bash (/c/…) and WSL (/mnt/c/…) write it, with
// any letter case, as Windows ignores it. null for an empty path or a root.
function folderPattern(dir) {
    const parts = String(dir).replace(/[\\/]+$/, "").split(/[\\/]+/)
    const drive = /^[A-Za-z]:$/.test(parts[0]) ? parts.shift()[0] : null
    if (drive === null && parts[0] === "") parts.shift() // the empty part before the leading "/"
    if (parts.length === 0 || parts.every((p) => p === "")) return null
    const rest = parts.map(escapeRe).join(String.raw`[\\/]+`)
    if (drive === null) return new RegExp(`${BEFORE_PATH}/${rest}${AFTER_PATH}`, "g")
    const d = escapeRe(drive.toLowerCase())
    return new RegExp(`${BEFORE_PATH}(?:${d}:|/${d}|/mnt/${d})[\\\\/]+${rest}${AFTER_PATH}`, "gi")
}

// The rest of a path after a folder folderPattern() found: separators and names up to the last separator and the
// name after it. A folder name may hold a space ("a b"): words joined by spaces are taken only when a separator
// follows them, so a word after the path is never taken — not the drive letter of the next path either
// ("<repo>\x.ts to equal D:\a\y.ts"). A last name with a space ("c d.ts") is left where it is: it has no separator
// to rewrite. The path ends at a quote, a colon (of :12:5), a closing bracket or punctuation, or at the end of the text.
// shortcut: a word after the path that is itself followed by "\" with no space before it ("<repo>\x.ts vs a\b") is
// read as a folder of the path and gets "/", redo when a record shows such a line.
const NAME_CHAR = String.raw`[^\s\\/"'\x60:;,)\]}>]`
const PATH_TAIL = String.raw`((?:[\\/]+${NAME_CHAR}+(?:(?: +${NAME_CHAR}+)+(?=[\\/]))?)*)`

// `text` with the folder `re` (folderPattern) replaced by `stand` and the rest of each such path written as a
// record writes paths, with "/": a run of "\" ("\\" in JSON) and "/" becomes one "/", a run of "/" alone stays.
function replaceFolder(text, re, stand) {
    const withTail = new RegExp(re.source + PATH_TAIL, re.flags)
    return text.replace(withTail, (_, tail) => stand + tail.replace(/[\\/]*\\[\\/]*/g, "/"))
}

// The user name of any home folder path, whoever's it is: in the folder Users at the root (macOS),
// /home/<name>, C:\Users\<name> (with "\", "\\" or "/"), the same after /c or /mnt/c, the 8.3 name
// RUNNER~1 too. A name that starts with a dot is a file in a sandbox home (<tmp>/home/.gitconfig), not a user.
const NAME = String.raw`(?![.<])[^\s\\/"'\x60<>|:*?,;()\[\]{}=&]+`
const HOME_NAMES = [
    new RegExp(String.raw`${BEFORE_PATH}((?:/mnt)?(?:/[A-Za-z])?/(?:Users|home)/)${NAME}`, "g"),
    new RegExp(String.raw`(?<![A-Za-z])([A-Za-z]:(?:\\+|/)Users(?:\\+|/))${NAME}`, "gi"),
]

// A word of `text` matched as a whole word, in any letter case.
function wordPattern(word) {
    return new RegExp(`(?<![A-Za-z0-9])${escapeRe(word)}(?![A-Za-z0-9])`, "gi")
}

// True when privacy.cjs holds `name` for a person's: not one of its stand-ins (test, runner, user…).
function personalName(name) {
    return name.length >= 3 && privacy.findings("/home/" + name).length > 0
}

// `text` without the personal data of the computer it came from. ctx: { repo, home, user, host, deny }
// — the root of the worktree (→ <repo>), the home folder (→ ~; the rest of a path under either is written with "/",
// so a record reads the same on Windows: <repo>/test/x.test.ts:12:5), the user name (→ <user>), the host
// name (→ <host>) and the words of the personal list of privacy.cjs; each may be missing. After that
// the user name of any other home folder path becomes <user>, and the rest privacy.cjs finds
// (UUIDs, email addresses, tokens, host names of known shapes) is masked by it.
export function scrub(text, ctx = {}) {
    let out = String(text ?? "")
    const repo = ctx.repo ? folderPattern(ctx.repo) : null
    if (repo) out = replaceFolder(out, repo, "<repo>")
    const home = ctx.home ? folderPattern(ctx.home) : null
    if (home) out = replaceFolder(out, home, "~")
    for (const re of HOME_NAMES) out = out.replace(re, "$1<user>")
    const host = typeof ctx.host === "string" ? ctx.host.trim() : ""
    // The full name first, then its first label; a first label that is a common word is no secret (privacy.hostNeedles).
    for (const needle of privacy.hostNeedles(host)) out = out.replace(wordPattern(needle), "<host>")
    const user = typeof ctx.user === "string" ? ctx.user.trim() : ""
    if (personalName(user)) out = out.replace(wordPattern(user), "<user>")
    return privacy.maskText(out, { hostname: host || undefined, deny: Array.isArray(ctx.deny) ? ctx.deny : undefined })
}

// A failure record with its error, name and file scrubbed; its test id is made again from the
// scrubbed file and name, so the id does not keep what they lost.
export function scrubRecord(record, ctx = {}) {
    const clean = { ...record }
    for (const field of ["error", "name", "file"]) if (typeof clean[field] === "string") clean[field] = scrub(clean[field], ctx)
    if (typeof clean.error === "string") clean.error = firstLine(clean.error, ERROR_CHARS)
    if (clean.runner != null && clean.file != null && clean.name != null) clean.test = testId(clean.runner, clean.file, clean.name)
    else if (typeof clean.test === "string") clean.test = scrub(clean.test, ctx)
    return clean
}

// The finder of privacy.cjs: what in a text is still personal ({ rule, index, length }[]). The export
// subcommand of records runs it once more and refuses what it finds.
export function findLeaks(text, options) {
    return privacy.findings(text, options)
}

// The failures of `runs` grouped by test id, in the order of the runs: one test across runs, whatever
// line it was declared on in each. A record without a test id (a script without tests) is left out.
export function byTest(runs) {
    const tests = new Map()
    for (const run of runs) {
        for (const failure of run.failures) {
            if (typeof failure.test !== "string") continue
            if (!tests.has(failure.test)) tests.set(failure.test, [])
            tests.get(failure.test).push({ run, failure })
        }
    }
    return tests
}

// --- the computer ---------------------------------------------------------------------------

export function defaultComputerName(platform = process.platform) {
    return platform === "darwin" ? "mac" : platform === "win32" ? "windows" : "linux"
}

export function machineFile(harnessHome) {
    return path.join(harnessHome, "gate", "machine.json")
}

// { id, name } of <Harness home>/gate/machine.json, or null when there is none or it is broken.
export function readComputer(harnessHome) {
    try {
        const data = JSON.parse(fs.readFileSync(machineFile(harnessHome), "utf8"))
        if (!isObject(data) || typeof data.id !== "string" || !COMPUTER_ID.test(data.id)) return null
        if (typeof data.name !== "string" || data.name.trim() === "") return null
        return { id: data.id, name: data.name }
    } catch {
        return null
    }
}

// Writes `text` to a temporary file next to `file`, then puts it in place. With `onlyNew` the file is
// put in place only when there is none yet (a hard link fails on an existing name), so that two gates
// creating machine.json at one moment both end with the first one's id; false when another was first.
function writeInPlace(file, text, onlyNew = false) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`)
    fs.writeFileSync(tmp, text)
    try {
        if (!onlyNew) {
            fs.renameSync(tmp, file)
            return true
        }
        try {
            fs.linkSync(tmp, file)
            return true
        } catch (error) {
            if (error?.code === "EEXIST") return false
            fs.renameSync(tmp, file) // a file system without hard links
            return true
        }
    } finally {
        fs.rmSync(tmp, { force: true })
    }
}

// The computer of this Harness home, { id, name, platform }: machine.json as it is, or a new one with a
// random id and the name of the platform when there is none or it is broken. Never a host name or a
// user name.
export function ensureComputer(harnessHome, platform = process.platform) {
    const known = readComputer(harnessHome)
    if (known) return { ...known, platform }
    const file = machineFile(harnessHome)
    const fresh = { id: crypto.randomBytes(4).toString("hex"), name: defaultComputerName(platform) }
    const text = `${JSON.stringify(fresh, null, 2)}\n`
    // A broken file is replaced; a missing one is created only if no other process did it meanwhile.
    if (!writeInPlace(file, text, !fs.existsSync(file))) {
        const other = readComputer(harnessHome)
        if (other) return { ...other, platform }
        writeInPlace(file, text)
    }
    return { ...fresh, platform }
}

// The reason `name` cannot name the computer, or null. It goes into records that may become public,
// so it holds nothing privacy.cjs finds, nor the host name or the user name of this computer.
export function checkComputerName(name, { host, user } = {}) {
    if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/.test(name)) {
        return "a name is 1 to 40 letters, digits, spaces, dots, dashes or underscores, starting with a letter or a digit"
    }
    const lower = name.toLowerCase()
    const same = (v) => typeof v === "string" && v !== "" && (lower === v.toLowerCase() || lower === v.split(".")[0].toLowerCase())
    // The host name is caught by findings: it searches the name for privacy.hostNeedles of the host. A first label that
    // is a common word gives no needle, so it is a valid name too.
    if (same(user) || privacy.findings(name, { hostname: host }).length > 0) {
        return "the name must not be the host name, the user name or other personal data: it goes into records that may be published"
    }
    return null
}

// Gives the computer the name `name`, keeping its id; returns { id, name, platform }.
export function setComputerName(harnessHome, name, platform = process.platform) {
    const { id } = ensureComputer(harnessHome, platform)
    writeInPlace(machineFile(harnessHome), `${JSON.stringify({ id, name }, null, 2)}\n`)
    return { id, name, platform }
}

// --- the files of records -------------------------------------------------------------------

export function failuresDir(state) {
    return path.join(state, "failures")
}

export function importedDir(state, computerId) {
    if (typeof computerId !== "string" || !COMPUTER_ID.test(computerId)) throw new Error("a computer id is 8 hex digits")
    return path.join(failuresDir(state), "imported", computerId)
}

// The file name of a record: <tag>--<run>.json, or <tag>--<run>.rerun-<stamp>.json for a rerun.
export function recordFileName(record) {
    if (record.kind === "rerun") return `${record.of.replace("/", "--")}.rerun-${record.at.replaceAll(":", "-")}.json`
    return `${record.run.replace("/", "--")}.json`
}

function writeRecord(dir, record) {
    const reason = record?.kind === "rerun" ? checkRerunRecord(record) : checkRunRecord(record)
    if (reason) throw new Error(`not a failure record: ${reason}`)
    const file = path.join(dir, recordFileName(record))
    writeInPlace(file, `${JSON.stringify(record, null, 2)}\n`)
    return file
}

// Writes a run record of this computer and returns the path; throws on a record that is not one.
export function writeRunFile(state, record) {
    if (record?.kind !== "run") throw new Error('not a failure record: kind is not "run"')
    return writeRecord(failuresDir(state), record)
}

// Writes a record of another computer (a run or a rerun) under imported/<its computer id>/.
export function writeImported(state, record) {
    const reason = record?.kind === "rerun" ? checkRerunRecord(record) : checkRunRecord(record)
    if (reason) throw new Error(`not a failure record: ${reason}`)
    return writeRecord(importedDir(state, record.computer.id), record)
}

function listDir(dir) {
    try {
        return fs.readdirSync(dir)
    } catch {
        return []
    }
}

// Every record file: [{ file, imported }], the own ones first.
function recordFiles(state) {
    const own = failuresDir(state)
    const files = listDir(own)
        .filter((name) => RUN_FILE.test(name))
        .map((name) => ({ file: path.join(own, name), imported: false }))
    const imported = path.join(own, "imported")
    for (const id of listDir(imported).filter((name) => COMPUTER_ID.test(name))) {
        const dir = path.join(imported, id)
        for (const name of listDir(dir).filter((n) => RUN_FILE.test(n))) files.push({ file: path.join(dir, name), imported: true })
    }
    return files
}

function readRecord(file) {
    try {
        return parseRecordFile(fs.readFileSync(file, "utf8"))
    } catch (error) {
        return { ok: false, reason: `cannot be read: ${error?.code ?? "error"}` }
    }
}

// The records of the state folder, own and imported: { runs, reruns, skipped }. runs and reruns are
// [{ file, imported, record }], newest first; skipped is [{ file, reason }] for files that are broken
// or of another version. `days` keeps only the records of the last `days` days by their `at`.
export function listRuns(state, { days, now = Date.now() } = {}) {
    const since = typeof days === "number" ? now - days * DAY_MS : -Infinity
    const runs = []
    const reruns = []
    const skipped = []
    for (const { file, imported } of recordFiles(state)) {
        const parsed = readRecord(file)
        if (!parsed.ok) {
            skipped.push({ file, reason: parsed.reason })
            continue
        }
        if (Date.parse(parsed.record.at) < since) continue
        ;(parsed.record.kind === "rerun" ? reruns : runs).push({ file, imported, record: parsed.record })
    }
    const newest = (a, b) => (a.record.at < b.record.at ? 1 : a.record.at > b.record.at ? -1 : a.file.localeCompare(b.file))
    return { runs: runs.sort(newest), reruns: reruns.sort(newest), skipped }
}

// Removes the record files, own and imported, whose `at` is more than `days` days before `now`, and
// returns their paths. A broken file, or one of another version, is left: this reader cannot tell
// its age, and a newer Harness may read it. Errors are left alone, as in pruneLogs.
export function pruneFailures(state, now = Date.now(), days = FAILURES_DAYS) {
    const removed = []
    for (const { file } of recordFiles(state)) {
        const parsed = readRecord(file)
        if (!parsed.ok || now - Date.parse(parsed.record.at) <= days * DAY_MS) continue
        try {
            fs.rmSync(file, { force: true })
            removed.push(file)
        } catch {}
    }
    return removed
}

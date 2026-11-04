// gate-failures rerun — the failed tests of a red gate run, run again one at a time on the same SHA, and the
// rerun file that says which of them are green alone.
//
//   gate-failures rerun [--run <id> | --last] [--file <path>] [--limit N] [--dry-run]
//
// The run: --run <tag>/<run>, else (--last, the default) the newest red run of this worktree (its tag,
// worktreeTag in gate-paths.mjs). Refused with exit 3 and the reason on one line:
//   - a run from imported/, or one whose computer.id is not the id of this computer (machine.json): the argv of a
//     record from another computer is never run, wherever it came from;
//   - HEAD is not the `head` of the run, or `git status --porcelain` is not empty: the tests would run other code.
// Before the first test it prints the list and an estimate by the `ms` of the records; --dry-run ends there.
// --file keeps the tests of one file (from the root of the repository, with "/"); --limit N runs the first N.
//
// Each test with a `rerun` argv runs alone, one after another, in the root of the worktree: no shell, a leading
// "node" is the node that runs this script, and GATE_FAILURES_FILE is not passed on (the run is not a gate run).
// Its result is its exit code, how long it took and, when red, the first line of its error after scrub(). A test
// whose record has no argv is not run: it goes into the file with exit null and the error "cannot rerun: …". A
// record of a step without tests (lint, typecheck…) is named and left out: there is no test to run alone.
//
// The e2e lock: when the profile sets workflow.e2e_lock (profile --field workflow.e2e_lock), the Playwright tests
// run last, all under that lock, on any computer: first the screen check, then the lock, as wave-gate does
// (../e2e-lock.cjs). Other tests take no lock. SIGHUP, SIGINT, SIGTERM and SIGBREAK end the running test, release
// the lock and write the rerun file with what has finished and `interrupted: true`; the exit code is 128 + the
// signal number.
//
// The rerun file, <state>/failures/<tag>--<run>.rerun-<stamp>.json (format: ../../hooks/gate-failures.mjs), is
// written after the last test: { version, kind "rerun", of, at (when the rerun started), head, computer, results,
// interrupted }.
//
// Exit codes: 0 — every test was green alone; 2 — at least one was red; 3 — nothing to rerun, the run was refused,
// or some test could not be rerun (and none was red); 128 + n — stopped by a signal.
// Node only, no shell utility: the same code runs on macOS, Linux and Windows.

import { spawn, spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { git as GIT } from "../../hooks/eval-env.cjs"
import { gateStateDir, harnessHome, worktreeRoot, worktreeTag } from "../../hooks/gate-paths.mjs"
import {
    ERROR_CHARS,
    checkRerunRecord,
    failuresDir,
    firstLine,
    listRuns,
    readComputer,
    recordFileName,
    scrub,
} from "../../hooks/gate-failures.mjs"

const require = createRequire(import.meta.url)
const locks = require("../e2e-lock.cjs")

export const summary = "run the failed tests of a red run again one at a time on its SHA (--run <id> | --last, --file, --limit N, --dry-run)"

const USAGE = "usage: gate-failures rerun [--run <id> | --last] [--file <path>] [--limit N] [--dry-run]\n"
const PROFILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "profile")
// What a test prints is kept up to this size per stream: the error line is looked for in it.
const OUTPUT_CAP = 1 << 20
// How long a stopped test is given to end before the process exits.
const STOP_WAIT_MS = 5000

function parseArgs(argv) {
    const args = { run: undefined, last: false, file: undefined, limit: undefined, dryRun: false, help: false }
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a === "--last") args.last = true
        else if (a === "--dry-run") args.dryRun = true
        else if (a === "--help" || a === "-h") args.help = true
        else if (a === "--run" || a === "--file") {
            if (i + 1 >= argv.length || argv[i + 1] === "") return { error: `${a} takes a value` }
            args[a.slice(2)] = argv[++i]
        } else if (a === "--limit") {
            const n = Number(argv[++i])
            if (!Number.isInteger(n) || n < 1) return { error: "--limit takes a whole number from 1" }
            args.limit = n
        } else return { error: `unknown argument ${JSON.stringify(a)}` }
    }
    if (args.run !== undefined && args.last) return { error: "--run and --last exclude each other" }
    return args
}

function gitOut(cwd, args) {
    const r = spawnSync(GIT, args, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 64 << 20 })
    return r.status === 0 ? r.stdout : null
}

// The run to rerun, or { refuse } with the reason.
function chooseRun(runs, args, tag) {
    if (args.run !== undefined) {
        const matches = runs.filter((r) => r.record.run === args.run)
        if (matches.length === 0) return { refuse: `no run ${args.run} in the failure records` }
        return matches.find((r) => !r.imported) ?? matches[0]
    }
    const own = runs.find((r) => !r.imported && r.record.outcome === "red" && r.record.run.startsWith(`${tag}/`))
    return own ?? { refuse: "no red run of this worktree in the failure records" }
}

// The e2e lock of the profile: { dir } (null — none set), or { refuse } when the profile cannot be read.
function e2eLockOf(root, env) {
    const r = spawnSync(process.execPath, [PROFILE, "-C", root, "--field", "workflow.e2e_lock"], { env, encoding: "utf8", windowsHide: true })
    // 3 — not a registered project, 4 — no such field: no lock is set.
    if (r.status === 3 || r.status === 4) return { dir: null }
    if (r.status !== 0) return { refuse: `the profile cannot be read (profile exit ${r.status ?? r.signal}): ${firstLine(r.stderr, ERROR_CHARS)}` }
    const value = r.stdout.trim()
    return { dir: value === "" || value === "null" ? null : value }
}

// The first line of a red test's error: a line that names an error or an assertion, else one that says the test
// failed, else the first line it printed at all — stderr before stdout.
// shortcut: the line is guessed from the text of vitest and Playwright; take it from the project's reporter when a
// rerun records its own failure lines (GATE_FAILURES_FILE of the rerun).
function errorLine(stderr, stdout, code) {
    const lines = `${stderr}\n${stdout}`.split(/\r\n|\r|\n/).map((l) => l.trim())
    const found =
        lines.find((l) => /error\b|assert|expected/i.test(l)) ??
        lines.find((l) => /fail|✗|×/i.test(l)) ??
        lines.find((l) => l !== "")
    return found ?? `exit ${code}`
}

function userName() {
    try {
        return os.userInfo().username
    } catch {
        return undefined
    }
}

// The environment of a test: the caller's, without GATE_FAILURES_FILE (in any case of its name, for Windows).
function testEnv(env) {
    const out = {}
    for (const [k, v] of Object.entries(env)) if (k.toUpperCase() !== "GATE_FAILURES_FILE") out[k] = v
    return out
}

const now = () => new Date().toISOString().replace(/\.\d+Z$/, "Z")
const seconds = (ms) => `${Math.round(ms / 1000)} s`

function writeRerunFile(state, record) {
    const reason = checkRerunRecord(record)
    if (reason) throw new Error(`not a rerun record: ${reason}`)
    const dir = failuresDir(state)
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, recordFileName(record))
    const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`)
    fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`)
    fs.renameSync(tmp, file)
    return file
}

export async function run(argv, io) {
    const say = (line) => io.stdout.write(`${line}\n`)
    const refuse = (reason) => {
        io.stderr.write(`gate-failures rerun: ${reason}\n`)
        return 3
    }
    const args = parseArgs(argv)
    if (args.error) {
        io.stderr.write(`gate-failures rerun: ${args.error}\n${USAGE}`)
        return 2
    }
    if (args.help) {
        io.stdout.write(USAGE)
        return 0
    }

    const root = worktreeRoot(io.cwd)
    if (!root) return refuse(`${io.cwd} is not in a git worktree`)
    const state = gateStateDir(io.env, io.cwd)
    const chosen = chooseRun(listRuns(state).runs, args, worktreeTag(root))
    if (chosen.refuse) return refuse(chosen.refuse)
    const record = chosen.record
    const computer = readComputer(harnessHome(io.env, io.cwd))
    if (chosen.imported || !computer || record.computer.id !== computer.id) {
        const whose = chosen.imported ? "it was imported" : `computer ${record.computer.id}, this one is ${computer ? computer.id : "without machine.json"}`
        return refuse(`${record.run} is not a run of this computer (${whose}): the argv of its records is not run here`)
    }
    const head = (gitOut(root, ["rev-parse", "HEAD"]) ?? "").trim()
    if (!record.head || head !== record.head) {
        return refuse(`HEAD is not the SHA of the run: HEAD ${head.slice(0, 12) || "unknown"}, run ${record.head ? record.head.slice(0, 12) : "without a head"}`)
    }
    const status = gitOut(root, ["status", "--porcelain"])
    if (status === null) return refuse("git status failed")
    if (status.trim() !== "") return refuse(`the worktree is not clean (git status --porcelain): the tests would not run ${head.slice(0, 12)} alone`)

    // The tests of the run, each once, in the order of the records.
    const wanted = args.file === undefined ? null : args.file.replaceAll("\\", "/").replace(/^\.\//, "")
    const seen = new Set()
    const tests = []
    const steps = []
    for (const f of record.failures) {
        if (f.test === null) {
            if (wanted === null) steps.push(f)
            continue
        }
        if (seen.has(f.test) || (wanted !== null && f.file !== wanted)) continue
        seen.add(f.test)
        tests.push(f)
    }
    let runnable = tests.filter((f) => f.rerun !== null)
    const cannot = tests.filter((f) => f.rerun === null)
    const leftOut = args.limit !== undefined ? runnable.slice(args.limit) : []
    if (args.limit !== undefined) runnable = runnable.slice(0, args.limit)
    if (runnable.length === 0 && cannot.length === 0) return refuse(`nothing to rerun in ${record.run}${wanted !== null ? ` for --file ${wanted}` : ""}`)

    // Playwright last, all under the e2e lock.
    const e2e = runnable.filter((f) => f.runner === "playwright")
    const order = [...runnable.filter((f) => f.runner !== "playwright"), ...e2e]
    let lockDir = null
    if (e2e.length > 0) {
        const got = e2eLockOf(root, io.env)
        if (got.refuse) return refuse(got.refuse)
        lockDir = got.dir
    }

    const known = order.filter((f) => f.ms !== null)
    const estimate = known.reduce((sum, f) => sum + f.ms, 0)
    const untimed = order.length - known.length
    say(
        `${record.run} at ${head.slice(0, 12)}: ${order.length} test(s) to run one at a time, about ${seconds(estimate)} by the times of the records` +
            (untimed ? ` (${untimed} without a time)` : "") +
            (lockDir && e2e.length ? `; the ${e2e.length} e2e test(s) wait for the e2e lock ${lockDir}` : ""),
    )
    for (const f of order) say(`  ${f.test}${f.ms !== null ? `  (${f.ms} ms)` : ""}`)
    for (const f of cannot) say(`  cannot rerun: ${f.test} (the record has no rerun argv)`)
    for (const f of leftOut) say(`  left out by --limit: ${f.test}`)
    for (const f of steps) say(`  step without tests, not rerun: ${f.step}`)
    if (args.dryRun) return 0
    if (order.length === 0) return refuse(`no test of ${record.run} can be rerun: none has a rerun argv`)

    const at = now()
    const ctx = { repo: root, home: os.homedir(), host: os.hostname(), user: userName() }
    const results = []
    const finish = (interrupted) => {
        const all = [...results, ...cannot.map((f) => ({ test: f.test, exit: null, ms: null, error: "cannot rerun: the record has no rerun argv" }))]
        const file = writeRerunFile(state, {
            version: 1,
            kind: "rerun",
            of: record.run,
            at,
            head,
            computer: { id: computer.id, name: computer.name, platform: process.platform },
            results: all,
            interrupted,
        })
        say(`rerun file: ${file}`)
        return all
    }

    locks.configure({ say: (line) => say(`gate-failures rerun: ${line}`) })
    let current = null
    let stopping = false
    const removeHandlers = locks.onStopSignals({
        stop: (sig) => {
            if (current) locks.stopChild(current.child, sig)
        },
        exit: (sig, n) => {
            if (stopping) return
            stopping = true
            try {
                finish(true)
            } catch (e) {
                io.stderr.write(`gate-failures rerun: the rerun file could not be written: ${e.message}\n`)
            }
            io.stderr.write(`gate-failures rerun: stopped by ${sig}; the rerun file has the tests that finished\n`)
            const closed = current ? current.closed : Promise.resolve()
            Promise.race([closed, new Promise((r) => setTimeout(r, STOP_WAIT_MS))]).then(() => process.exit(128 + n))
        },
    })

    const runOne = (f) =>
        new Promise((resolve) => {
            const [first, ...rest] = f.rerun
            const cmd = first === "node" ? process.execPath : first
            const began = Date.now()
            let stdout = ""
            let stderr = ""
            let child
            try {
                child = spawn(cmd, rest, { cwd: root, env: testEnv(io.env), stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
            } catch (e) {
                resolve({ code: 127, ms: 0, stdout: "", stderr: e.message })
                return
            }
            let spawnError = ""
            const closed = new Promise((done) => {
                child.on("close", (code, signal) => {
                    locks.noteChild(null)
                    current = null
                    // A program that did not start (ENOENT) is 127, as in a shell.
                    const exit = spawnError ? 127 : (code ?? (signal ? 128 + (os.constants.signals[signal] || 0) : 127))
                    resolve({ code: exit, ms: Date.now() - began, stdout, stderr: stderr + spawnError })
                    done()
                })
            })
            current = { child, closed }
            locks.noteChild(child.pid ?? null)
            child.stdout.on("data", (b) => {
                if (stdout.length < OUTPUT_CAP) stdout += b
            })
            child.stderr.on("data", (b) => {
                if (stderr.length < OUTPUT_CAP) stderr += b
            })
            child.on("error", (e) => {
                spawnError += `${e.message}\n`
            })
        })

    const timings = locks.e2eTimings(io.env)
    const poll = locks.screenPoll(io.env)
    try {
        for (const f of order) {
            if (f.runner === "playwright" && lockDir && !locks.heldLocks().includes(lockDir)) {
                // The screen is checked before the lock is taken (a wait does not hold it) and again once it is held.
                for (;;) {
                    await locks.screenWait(poll, "screen locked: the e2e rerun waits")
                    await locks.lock(lockDir, timings, "the e2e lock", { what: "rerun", run: record.run })
                    if (!locks.screenLocked()) break
                    locks.unlock(lockDir)
                }
            }
            if (stopping) return 1
            const r = await runOne(f)
            if (stopping) return 1
            const error = r.code === 0 ? null : firstLine(scrub(errorLine(r.stderr, r.stdout, r.code), ctx), ERROR_CHARS)
            results.push({ test: f.test, exit: r.code, ms: r.ms, error })
            say(`${r.code === 0 ? "green" : `red (exit ${r.code})`}  ${r.ms} ms  ${f.test}${error ? `\n    ${error}` : ""}`)
        }
    } finally {
        if (!stopping) {
            if (lockDir) locks.unlock(lockDir)
            removeHandlers()
        }
    }

    finish(false)
    const red = results.filter((r) => r.exit !== 0).length
    const green = results.length - red
    say(`${green} green alone, ${red} red alone${cannot.length ? `, ${cannot.length} cannot rerun` : ""}`)
    if (red > 0) return 2
    return cannot.length > 0 ? 3 : 0
}

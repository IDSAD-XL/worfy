// gate-failures report — the failed tests of many gate runs, own and imported, by class.
//
//   gate-failures report [--days N] [--computer <name>] [--json]
//
// It reads the run files and the rerun files of the state folder (listRuns of ../../hooks/gate-failures.mjs:
// the own ones and those under imported/) of the last --days days (14 by default), and gives each failure
// of a test in a run one class, by the reruns of that run on the same SHA (`head`):
//   flaky        — red in the run, green alone in a rerun;
//   red          — red in the run and red alone in every rerun that ran it ("stable red");
//   unconfirmed  — no rerun ran it on that SHA, or the record has no rerun command.
// A run with `dirty: true` (it did not test `head` alone) counts in no class and no candidate: one line
// gives their number. A run in which more than half of the failed tests were green alone is "under load".
//
// Per test: the number of failures of each class, the computers and platforms, the last SHA, the last
// error. The order: the tests with a stable red failure, then the flaky ones by their number, then the
// rest; the records of a step without tests (lint, typecheck, a script that died before its tests) are a
// list of their own, by step.
//
// Candidates, from the failures of the last 14 days (CANDIDATE_DAYS) whatever --days is:
//   quarantine         — flaky in at least 2 different runs: another SHA or another computer;
//   windows-exception  — stable red on win32, and on none of those SHAs did the test fail on another
//                        platform other than flaky (green alone there, or not in the records at all).
// A test that is both is a Windows exception candidate only. The rules of an entry built from a
// candidate (its file, its caps, its owner) are the project's, not the Harness's: --json gives the
// candidates in a general form, and a script of the project turns them into its entries.
//
// --computer keeps the runs and reruns of the computer with that name (or that id). --json prints one
// object: { version 1, kind "report", at, days, computer, runs: { total, dirty, imported, reruns },
// tests, steps, underLoad, candidates, skipped }.
// Only reads. Exit codes: 0; 2 — wrong arguments.

import { gateStateDir } from "../../hooks/gate-paths.mjs"
import { listRuns } from "../../hooks/gate-failures.mjs"

export const summary = "flaky, stable red and unconfirmed tests of many runs, and quarantine candidates (--days N, --computer <name>, --json)"

export const DEFAULT_DAYS = 14
export const CANDIDATE_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000
const SHA_CHARS = 12

const USAGE = "usage: gate-failures report [--days N] [--computer <name>] [--json]\n"

function parseArgs(argv) {
    const args = { json: false, days: DEFAULT_DAYS, computer: null, help: false }
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a === "--json") args.json = true
        else if (a === "--help" || a === "-h") args.help = true
        else if (a === "--days") {
            const n = Number(argv[++i])
            if (!Number.isInteger(n) || n < 1) return { error: "--days takes a whole number of days from 1" }
            args.days = n
        } else if (a === "--computer") {
            const name = argv[++i]
            if (name === undefined || name.trim() === "") return { error: "--computer takes the name (or id) of a computer" }
            args.computer = name
        } else return { error: `unknown argument ${JSON.stringify(a)}` }
    }
    return args
}

const unique = (values) => [...new Set(values)]
// Names in the order a reader expects ("mac", "PC"), not by character code.
const names = (values) => unique(values).sort((a, b) => a.localeCompare(b))
const short = (head) => (head ? head.slice(0, SHA_CHARS) : "-")
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`

// The class of each failed test of `run`: the reruns of the run, on its SHA and its computer, decide.
// Any green alone makes it flaky; otherwise any red alone makes it stable red.
function classOf(run, failure, reruns) {
    if (failure.rerun === null) return "unconfirmed"
    let red = false
    for (const rerun of reruns) {
        for (const result of rerun.results) {
            if (result.test !== failure.test || result.exit === null) continue
            if (result.exit === 0) return "flaky"
            red = true
        }
    }
    return red ? "red" : "unconfirmed"
}

// The failures of the runs, each with its class: [{ run, imported, failure, class }].
function classify(runs, reruns) {
    const rerunsOf = new Map()
    for (const { record } of reruns) {
        const key = `${record.computer.id} ${record.of}`
        if (!rerunsOf.has(key)) rerunsOf.set(key, [])
        rerunsOf.get(key).push(record)
    }
    const failures = []
    for (const { record: run, imported } of runs) {
        const own = (rerunsOf.get(`${run.computer.id} ${run.run}`) ?? []).filter((r) => r.head === run.head)
        for (const failure of run.failures) {
            failures.push({ run, imported, failure, class: failure.test === null ? null : classOf(run, failure, own) })
        }
    }
    return failures
}

const RANK = { red: 0, flaky: 1, unconfirmed: 2 }

// The runs are newest first, so the first failure of a test is its last one.
function byTest(failures) {
    const tests = new Map()
    for (const f of failures) {
        if (f.failure.test === null) continue
        if (!tests.has(f.failure.test)) tests.set(f.failure.test, [])
        tests.get(f.failure.test).push(f)
    }
    const rows = []
    for (const [test, list] of tests) {
        const counts = { red: 0, flaky: 0, unconfirmed: 0 }
        for (const f of list) counts[f.class]++
        const last = list[0]
        rows.push({
            test,
            runner: last.failure.runner,
            file: last.failure.file,
            name: last.failure.name,
            class: counts.red > 0 ? "red" : counts.flaky > 0 ? "flaky" : "unconfirmed",
            counts,
            computers: names(list.map((f) => f.run.computer.name)),
            platforms: names(list.map((f) => f.run.computer.platform)),
            lastHead: last.run.head,
            lastAt: last.run.at,
            lastError: last.failure.error,
            runs: list.map((f) => ({ run: f.run.run, at: f.run.at, head: f.run.head, computer: f.run.computer, imported: f.imported, class: f.class })),
        })
    }
    return rows.sort(
        (a, b) =>
            RANK[a.class] - RANK[b.class] ||
            b.counts[a.class] - a.counts[a.class] ||
            (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0) ||
            a.test.localeCompare(b.test),
    )
}

function bySteps(failures) {
    const steps = new Map()
    for (const f of failures) {
        if (f.failure.test !== null) continue
        if (!steps.has(f.failure.step)) steps.set(f.failure.step, [])
        steps.get(f.failure.step).push(f)
    }
    return [...steps]
        .map(([step, list]) => ({
            step,
            count: list.length,
            computers: names(list.map((f) => f.run.computer.name)),
            platforms: names(list.map((f) => f.run.computer.platform)),
            lastHead: list[0].run.head,
            lastAt: list[0].run.at,
            lastError: list[0].failure.error,
        }))
        .sort((a, b) => b.count - a.count || a.step.localeCompare(b.step))
}

// The runs in which more than half of the failed tests were green alone: "19 failed, 17 green alone".
function underLoad(runs, failures) {
    const rows = []
    for (const { record: run } of runs) {
        const tests = new Map()
        for (const f of failures) if (f.run === run && f.class !== null) tests.set(f.failure.test, tests.get(f.failure.test) === "flaky" ? "flaky" : f.class)
        const greenAlone = [...tests.values()].filter((c) => c === "flaky").length
        if (tests.size > 0 && greenAlone * 2 > tests.size) {
            rows.push({ run: run.run, at: run.at, head: run.head, computer: run.computer, failed: tests.size, greenAlone })
        }
    }
    return rows
}

function candidates(tests, since) {
    const found = []
    for (const t of tests) {
        const recent = t.runs.filter((r) => Date.parse(r.at) >= since)
        const base = { test: t.test, runner: t.runner, file: t.file, name: t.name }
        const redOnWindows = recent.filter((r) => r.class === "red" && r.computer.platform === "win32")
        const heads = new Set(redOnWindows.map((r) => r.head))
        const elsewhere = recent.some((r) => r.computer.platform !== "win32" && heads.has(r.head) && r.class !== "flaky")
        if (redOnWindows.length > 0 && !elsewhere) {
            found.push({
                kind: "windows-exception",
                ...base,
                class: "red",
                platforms: ["win32"],
                computers: names(redOnWindows.map((r) => r.computer.name)),
                runs: redOnWindows.map((r) => r.run),
                heads: unique(redOnWindows.map((r) => r.head ?? "-")),
                lastError: t.lastError,
            })
            continue
        }
        const flaky = recent.filter((r) => r.class === "flaky")
        const distinct = new Set(flaky.map((r) => `${r.head} ${r.computer.id}`))
        if (distinct.size >= 2) {
            found.push({
                kind: "quarantine",
                ...base,
                class: "flaky",
                platforms: names(flaky.map((r) => r.computer.platform)),
                computers: names(flaky.map((r) => r.computer.name)),
                runs: flaky.map((r) => r.run),
                heads: unique(flaky.map((r) => r.head ?? "-")),
                lastError: t.lastError,
            })
        }
    }
    return found
}

// The report object of --json; `now` is for tests of this function.
export function buildReport(state, { days = DEFAULT_DAYS, computer = null, now = Date.now() } = {}) {
    const listed = listRuns(state, { days, now })
    const mine = (record) => computer === null || record.computer.name === computer || record.computer.id === computer
    const runs = listed.runs.filter((r) => mine(r.record))
    const clean = runs.filter((r) => !r.record.dirty)
    const ids = new Set(clean.map((r) => `${r.record.computer.id} ${r.record.run}`))
    const reruns = listed.reruns.filter((r) => mine(r.record) && ids.has(`${r.record.computer.id} ${r.record.of}`))
    const failures = classify(clean, reruns)
    const tests = byTest(failures)
    return {
        version: 1,
        kind: "report",
        at: new Date(now).toISOString().replace(/\.\d+Z$/, "Z"),
        days,
        computer,
        runs: { total: clean.length, dirty: runs.length - clean.length, imported: clean.filter((r) => r.imported).length, reruns: reruns.length },
        tests,
        steps: bySteps(failures),
        underLoad: underLoad(clean, failures),
        candidates: candidates(tests, now - Math.min(days, CANDIDATE_DAYS) * DAY_MS),
        skipped: listed.skipped,
    }
}

const quote = (text) => JSON.stringify(text)

function counts(c) {
    return [c.red ? `${c.red} red` : "", c.flaky ? `${c.flaky} flaky` : "", c.unconfirmed ? `${c.unconfirmed} without rerun` : ""].filter(Boolean).join(", ")
}

function text(report, state) {
    const lines = []
    const where = report.computer === null ? "all computers" : `computer ${report.computer}`
    lines.push(`${plural(report.runs.total, "run")} (${report.runs.imported} imported), ${plural(report.runs.reruns, "rerun")}, the last ${plural(report.days, "day")}, ${where}`)
    if (report.runs.dirty > 0) lines.push(`${plural(report.runs.dirty, "dirty run")} skipped`)
    for (const r of report.underLoad) {
        lines.push(`under load: ${r.run} on ${r.computer.name} (${r.computer.platform}) at ${short(r.head)}: ${r.failed} failed, ${r.greenAlone} green alone`)
    }
    if (report.runs.total === 0 && report.runs.dirty === 0) {
        return `no failure records in ${state}\n`
    }
    const groups = [
        ["stable red", "red"],
        ["flaky", "flaky"],
        ["without rerun", "unconfirmed"],
    ]
    for (const [title, cls] of groups) {
        const rows = report.tests.filter((t) => t.class === cls)
        lines.push("", `${title} (${rows.length}):`)
        for (const t of rows) {
            lines.push(`  ${t.test}`, `    ${counts(t.counts)}; ${t.computers.join(", ")}; ${t.platforms.join(", ")}; last ${short(t.lastHead)} ${t.lastAt}`, `    ${quote(t.lastError)}`)
        }
    }
    lines.push("", `steps without tests (${report.steps.length}):`)
    for (const s of report.steps) {
        lines.push(`  ${s.step}`, `    ${plural(s.count, "time")}; ${s.computers.join(", ")}; ${s.platforms.join(", ")}; last ${short(s.lastHead)} ${s.lastAt}`, `    ${quote(s.lastError)}`)
    }
    lines.push("", `candidates (${report.candidates.length}):`)
    for (const c of report.candidates) {
        const why =
            c.kind === "windows-exception"
                ? `red alone on win32 only (${plural(c.runs.length, "run")})`
                : `flaky in ${c.runs.length} runs (${c.computers.join(", ")})`
        lines.push(`  ${(c.kind === "windows-exception" ? "windows exception" : "quarantine").padEnd(17)}  ${c.test}: ${why}`)
    }
    return `${lines.join("\n")}\n`
}

export function run(argv, io) {
    const args = parseArgs(argv)
    if (args.error) {
        io.stderr.write(`gate-failures report: ${args.error}\n${USAGE}`)
        return 2
    }
    if (args.help) {
        io.stdout.write(USAGE)
        return 0
    }
    const state = gateStateDir(io.env, io.cwd)
    const report = buildReport(state, { days: args.days, computer: args.computer })
    if (args.json) {
        io.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
        return 0
    }
    for (const s of report.skipped) io.stderr.write(`gate-failures report: skipped ${s.file}: ${s.reason}\n`)
    io.stdout.write(text(report, state))
    return 0
}

// gate-failures list — the gate runs that left failure records, own and imported, newest first.
//
//   gate-failures list [--json] [--days N]
//
// A line per run: its id, time, computer, SHA and number of records. --json prints one object,
// { runs: [{ run, at, key, profile, head, outcome, computer, dirty, imported, records, tests, steps,
// reruns, file }], skipped: [{ file, reason }] }; `reruns` counts the rerun files of the run. --days
// keeps the runs of the last N days. A file that is broken or of another version is skipped and named
// on stderr with its reason. Only reads: removing old records is the gate's (pruneFailures).
// Exit codes: 0; 2 — wrong arguments.

import { gateStateDir } from "../../hooks/gate-paths.mjs"
import { listRuns } from "../../hooks/gate-failures.mjs"

export const summary = "the gate runs with failure records, own and imported (--json, --days N)"

const USAGE = "usage: gate-failures list [--json] [--days N]\n"

function parseArgs(argv) {
    const args = { json: false, days: undefined, help: false }
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a === "--json") args.json = true
        else if (a === "--help" || a === "-h") args.help = true
        else if (a === "--days") {
            const n = Number(argv[++i])
            if (!Number.isInteger(n) || n < 1) return { error: "--days takes a whole number of days from 1" }
            args.days = n
        } else return { error: `unknown argument ${JSON.stringify(a)}` }
    }
    return args
}

export function run(argv, io) {
    const args = parseArgs(argv)
    if (args.error) {
        io.stderr.write(`gate-failures list: ${args.error}\n${USAGE}`)
        return 2
    }
    if (args.help) {
        io.stdout.write(USAGE)
        return 0
    }
    const state = gateStateDir(io.env, io.cwd)
    const { runs, reruns, skipped } = listRuns(state, { days: args.days })
    const rerunsOf = new Map()
    for (const r of reruns) rerunsOf.set(r.record.of, (rerunsOf.get(r.record.of) ?? 0) + 1)
    const rows = runs.map(({ file, imported, record }) => {
        const tests = record.failures.filter((f) => f.test !== null).length
        return {
            run: record.run,
            at: record.at,
            key: record.key,
            profile: record.profile,
            head: record.head,
            outcome: record.outcome,
            computer: record.computer,
            dirty: record.dirty,
            imported,
            records: record.failures.length,
            tests,
            steps: record.failures.length - tests,
            reruns: rerunsOf.get(record.run) ?? 0,
            file,
        }
    })
    if (args.json) {
        io.stdout.write(`${JSON.stringify({ runs: rows, skipped }, null, 2)}\n`)
        return 0
    }
    for (const s of skipped) io.stderr.write(`gate-failures list: skipped ${s.file}: ${s.reason}\n`)
    if (rows.length === 0) {
        io.stdout.write(`no failure records in ${state}\n`)
        return 0
    }
    for (const r of rows) {
        const marks = [r.dirty ? "dirty" : "", r.imported ? "imported" : "", r.reruns ? `${r.reruns} rerun(s)` : ""].filter(Boolean)
        const head = r.head ? r.head.slice(0, 12) : "-"
        const counts = `${r.records} record(s): ${r.tests} test(s), ${r.steps} step(s)`
        io.stdout.write(`${r.run}  ${r.at}  ${r.computer.name} ${r.computer.id}  ${head}  ${r.profile} ${r.outcome}  ${counts}${marks.length ? `  [${marks.join(", ")}]` : ""}\n`)
    }
    return 0
}

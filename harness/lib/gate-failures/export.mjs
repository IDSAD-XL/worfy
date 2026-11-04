// gate-failures export — the failure records of this computer as text for another one: a GitHub
// comment (an issue pc-main-red, a PR) or a message between sessions. `gate-failures import` reads it.
//
//   gate-failures export [--run <id> ...] [--since <days>] [--out <file>]
//
// Takes the own run files of the gate (not those brought by import), each with its rerun files:
// those named by --run (repeatable), else those of the last --since days, else all. The text is one
// or more parts of at most 60000 characters each, the form of transfer-common.mjs; a run file is not
// split between parts. A run file that is longer than a part alone gets the error of its records cut
// to 80 characters, and stderr says so. Without --out the parts go to stdout one after another;
// --out <file> writes part k to <file>.k.
//
// Before anything is printed or written, every field of every record and the whole text are checked
// for personal data: what harness/lib/privacy.cjs finds (findLeaks) plus the host name, the user
// name, the home folder of this computer and the root of the worktree the command runs in. A finding
// is a line on stderr with the record, the field and the rule (never the value), exit 2, and no output.
// Exit codes: 0 (also with nothing to export: stdout stays empty); 2 — wrong arguments, an unknown
// --run, personal data found, a run file too long for a part even with its errors cut.

import crypto from "node:crypto"
import fs from "node:fs"
import { ERROR_CHARS, ensureComputer, firstLine, listRuns } from "../../hooks/gate-failures.mjs"
import { gateStateDir, harnessHome, worktreeRoot } from "../../hooks/gate-paths.mjs"
import { CUT_ERROR_CHARS, PART_CHARS, formatPart, leakRules, leaksOf, machineContext, recordLabel } from "./transfer-common.mjs"

export const summary = "the failure records of this computer as text for import on another one (--run, --since, --out)"

const USAGE = "usage: gate-failures export [--run <id> ...] [--since <days>] [--out <file>]\n"

function parseArgs(argv) {
    const args = { runs: [], since: undefined, out: undefined, help: false }
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a === "--help" || a === "-h") args.help = true
        else if (a === "--run") {
            if (i + 1 >= argv.length) return { error: "--run takes a run id <tag>/<run>" }
            args.runs.push(argv[++i])
        } else if (a === "--since") {
            const n = Number(argv[++i])
            if (!Number.isInteger(n) || n < 1) return { error: "--since takes a whole number of days from 1" }
            args.since = n
        } else if (a === "--out") {
            if (i + 1 >= argv.length || argv[i + 1] === "") return { error: "--out takes a file" }
            args.out = argv[++i]
        } else return { error: `unknown argument ${JSON.stringify(a)}` }
    }
    return args
}

// A record with the error of each of its failures (a run) or results (a rerun) cut to CUT_ERROR_CHARS.
function cutErrors(record) {
    const cut = (e) => (typeof e === "string" ? firstLine(e, CUT_ERROR_CHARS) : e)
    if (record.kind === "rerun") return { ...record, results: record.results.map((r) => ({ ...r, error: cut(r.error) })) }
    return { ...record, failures: record.failures.map((f) => ({ ...f, error: cut(f.error) })) }
}

const unitChars = (lines) => lines.reduce((n, l) => n + l.length + 2, 0)

export function run(argv, io) {
    const args = parseArgs(argv)
    if (args.error) {
        io.stderr.write(`gate-failures export: ${args.error}\n${USAGE}`)
        return 2
    }
    if (args.help) {
        io.stdout.write(USAGE)
        return 0
    }
    const state = gateStateDir(io.env, io.cwd)
    const { runs, reruns } = listRuns(state, { days: args.since })
    let own = runs.filter((r) => !r.imported).reverse() // oldest first
    if (args.runs.length > 0) {
        const unknown = args.runs.filter((id) => !own.some((r) => r.record.run === id))
        if (unknown.length > 0) {
            io.stderr.write(`gate-failures export: no own run ${unknown.map((id) => JSON.stringify(id)).join(", ")} in ${state}\n`)
            return 2
        }
        own = own.filter((r) => args.runs.includes(r.record.run))
    }
    if (own.length === 0) {
        io.stderr.write(`gate-failures export: no failure records to export in ${state}\n`)
        return 0
    }
    const rerunsOf = new Map()
    for (const r of reruns.filter((x) => !x.imported).reverse()) {
        if (!rerunsOf.has(r.record.of)) rerunsOf.set(r.record.of, [])
        rerunsOf.get(r.record.of).push(r.record)
    }

    const computer = ensureComputer(harnessHome(io.env, io.cwd))
    const id = crypto.randomBytes(4).toString("hex")
    const at = new Date().toISOString().replace(/\.\d+Z$/, "Z")
    // The room for records in a part: the part with no record, its numbers at their widest.
    const room = PART_CHARS - formatPart({ id, at, computer, part: 99999, parts: 99999, lines: [] }).length

    // Each unit — a run and its reruns — stays whole within one part.
    const units = []
    for (const r of own) {
        let records = [r.record, ...(rerunsOf.get(r.record.run) ?? [])]
        let lines = records.map((x) => JSON.stringify(x))
        if (unitChars(lines) > room) {
            records = records.map(cutErrors)
            lines = records.map((x) => JSON.stringify(x))
            if (unitChars(lines) > room) {
                io.stderr.write(`gate-failures export: ${r.record.run} does not fit a part of ${PART_CHARS} characters even with its errors cut to ${CUT_ERROR_CHARS}; nothing exported\n`)
                return 2
            }
            io.stderr.write(`gate-failures export: ${r.record.run} is longer than a part: the error of its records is cut to ${CUT_ERROR_CHARS} characters (from ${ERROR_CHARS})\n`)
        }
        units.push({ records, lines })
    }
    const groups = []
    for (const u of units) {
        const last = groups[groups.length - 1]
        if (last && last.chars + unitChars(u.lines) <= room) {
            last.lines.push(...u.lines)
            last.chars += unitChars(u.lines)
        } else groups.push({ lines: [...u.lines], chars: unitChars(u.lines) })
    }
    const parts = groups.map((g, i) => formatPart({ id, at, computer, part: i + 1, parts: groups.length, lines: g.lines }))

    // The check, before any output.
    const ctx = machineContext(io, worktreeRoot(io.cwd))
    const found = []
    for (const field of ["name", "platform"]) {
        const rules = leakRules(computer[field], ctx)
        if (rules.length) found.push(`computer.${field}: ${rules.join(", ")}`)
    }
    for (const u of units) for (const record of u.records) for (const leak of leaksOf(record, ctx)) found.push(`${recordLabel(record)} ${leak.field}: ${leak.rules.join(", ")}`)
    if (found.length === 0) {
        parts.forEach((text, i) => {
            const rules = leakRules(text, ctx)
            if (rules.length) found.push(`part ${i + 1}/${parts.length} text: ${rules.join(", ")}`)
        })
    }
    if (found.length > 0) {
        for (const line of found) io.stderr.write(`gate-failures export: personal data: ${line}\n`)
        io.stderr.write("gate-failures export: nothing exported; the records were scrubbed when written, so this is what the scrubbing missed\n")
        return 2
    }
    if (parts.some((p) => p.length > PART_CHARS)) throw new Error("a part is longer than PART_CHARS") // packing guarantees it does not happen

    const count = `${own.length} run(s), ${units.reduce((n, u) => n + u.records.length - 1, 0)} rerun(s) in ${parts.length} part(s)`
    if (args.out === undefined) {
        io.stdout.write(parts.join("\n"))
        io.stderr.write(`gate-failures export: ${count}\n`)
        return 0
    }
    parts.forEach((text, i) => fs.writeFileSync(`${args.out}.${i + 1}`, text))
    io.stdout.write(`gate-failures export: ${count}: ${parts.map((_, i) => `${args.out}.${i + 1}`).join(", ")}\n`)
    return 0
}

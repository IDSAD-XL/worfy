// gate-failures import — the failure records another computer exported (gate-failures export), put
// under <state>/failures/imported/<computer id>/ by writeImported of harness/hooks/gate-failures.mjs.
//
//   gate-failures import <file>                               the text of an export in a file
//   gate-failures import -                                    the same from stdin
//   gate-failures import --gh <owner/repo> (--issue N | --pr N)
//                                                             the body and the comments of an issue or a PR
//
// Every block that starts with the line `gate-failures export v1 part <k>/<n>` is read, wherever it is
// in the text; the parts of one export are put together. An export with a part missing (3/4 without
// 4/4) is refused whole, the others are taken. With --gh the body and the comments are read through
// `gh api`, and only those whose author is the profile's github.account count: anyone can write a
// comment that starts the same way. gh runs with the environment it is given: the plugin's session
// hook sets GH_TOKEN of that account (hooks/gh-token-env.mjs).
//
// Each file is checked before it is written: the format of version 1 and the privacy rules
// (findLeaks of privacy.cjs, the host name, the user name and the home folder of this computer); a
// file that fails is refused. A file of this computer's own id is not imported; a run (or rerun) of a
// computer that is already there is skipped as "already imported". Nothing is executed: the rerun
// argv of an imported record stays data.
//
// Output: a line per file — new, skipped or rejected with the reason — and the totals.
// Exit codes: 0; 2 — at least one file or export refused, or wrong arguments; 1 — the source could
// not be read (no file, gh failed, no github.account for --gh).
// For tests: GATE_FAILURES_GH names the program run instead of gh from PATH, CLAUDE_PROFILE_BIN the
// program run instead of bin/profile (a .mjs file runs with this node).

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { importedDir, parseRecordFile, readComputer, recordFileName, writeImported } from "../../hooks/gate-failures.mjs"
import { gateStateDir, harnessHome } from "../../hooks/gate-paths.mjs"
import { assemble, leaksOf, machineContext, parseBlocks, recordLabel } from "./transfer-common.mjs"

export const summary = "the failure records another computer exported (<file>, -, --gh <owner/repo> --issue N | --pr N)"

const USAGE = "usage: gate-failures import <file> | - | --gh <owner/repo> (--issue N | --pr N)\n"

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
// A GitHub login, as hooks/gh-token-env.mjs checks it.
const GITHUB_LOGIN = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/
const PAGE = 100
const MAX_PAGES = 50

function parseArgs(argv) {
    const args = { source: undefined, gh: undefined, number: undefined, help: false }
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a === "--help" || a === "-h") args.help = true
        else if (a === "--gh") {
            const repo = argv[++i]
            if (typeof repo !== "string" || !REPO.test(repo)) return { error: "--gh takes <owner>/<repo>" }
            args.gh = repo
        } else if (a === "--issue" || a === "--pr") {
            const n = Number(argv[++i])
            if (!Number.isInteger(n) || n < 1) return { error: `${a} takes a number` }
            if (args.number !== undefined) return { error: "one of --issue and --pr" }
            args.number = n
        } else if (a === "-" || !a.startsWith("-")) {
            if (args.source !== undefined) return { error: "one source" }
            args.source = a
        } else return { error: `unknown argument ${JSON.stringify(a)}` }
    }
    if (args.help) return args
    if (args.gh !== undefined) {
        if (args.source !== undefined) return { error: "--gh or a file, not both" }
        if (args.number === undefined) return { error: "--gh needs --issue N or --pr N" }
    } else if (args.number !== undefined) return { error: "--issue and --pr go with --gh" }
    else if (args.source === undefined) return { error: "a file, - or --gh" }
    return args
}

// [program, leading arguments] for an override that may be a .mjs file, run with this node.
function program(override, fallback) {
    if (!override) return [fallback, []]
    return override.endsWith(".mjs") ? [process.execPath, [override]] : [override, []]
}

// The profile's github.account for the folder `cwd`, or null.
function githubAccount(io) {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const profile = io.env.CLAUDE_PROFILE_BIN || path.join(here, "..", "..", "bin", "profile")
    const [file, pre] = io.env.CLAUDE_PROFILE_BIN ? program(profile, profile) : [process.execPath, [profile]]
    const r = spawnSync(file, [...pre, "-C", io.cwd, "--field", "github.account"], { cwd: io.cwd, env: io.env, encoding: "utf8", windowsHide: true })
    if (r.status !== 0) return null
    let account = String(r.stdout ?? "").trim()
    if (account.length >= 2 && account.startsWith('"') && account.endsWith('"')) account = account.slice(1, -1)
    return GITHUB_LOGIN.test(account) && account.length <= 39 ? account : null
}

function ghJson(io, endpoint) {
    const [file, pre] = program(io.env.GATE_FAILURES_GH, "gh")
    const r = spawnSync(file, [...pre, "api", endpoint], { cwd: io.cwd, env: io.env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true })
    if (r.error) throw new Error(r.error.code === "ENOENT" ? "gh is not installed" : `gh did not start: ${r.error.code ?? r.error.message}`)
    if (r.status !== 0) throw new Error(`gh api ${endpoint} failed (exit ${r.status}): ${String(r.stderr ?? "").trim().split("\n")[0]}`)
    try {
        return JSON.parse(r.stdout)
    } catch {
        throw new Error(`gh api ${endpoint} did not print JSON`)
    }
}

// The texts of an issue or a PR (a PR is an issue to this API): its body, then its comments, each
// with its author.
function ghTexts(io, repo, number) {
    const base = `repos/${repo}/issues/${number}`
    const issue = ghJson(io, base)
    const texts = [{ where: `#${number} body`, author: issue?.user?.login, text: issue?.body ?? "" }]
    for (let page = 1; page <= MAX_PAGES; page++) {
        const comments = ghJson(io, `${base}/comments?per_page=${PAGE}&page=${page}`)
        if (!Array.isArray(comments)) throw new Error(`gh api ${base}/comments did not print a list`)
        for (const c of comments) texts.push({ where: `comment ${c?.id}`, author: c?.user?.login, text: c?.body ?? "" })
        if (comments.length < PAGE) break
    }
    return texts
}

function readSource(io, source) {
    if (source === "-") return fs.readFileSync(0, "utf8")
    return fs.readFileSync(path.resolve(io.cwd, source), "utf8")
}

export function run(argv, io) {
    const args = parseArgs(argv)
    if (args.error) {
        io.stderr.write(`gate-failures import: ${args.error}\n${USAGE}`)
        return 2
    }
    if (args.help) {
        io.stdout.write(USAGE)
        return 0
    }

    let texts
    try {
        if (args.gh === undefined) texts = [{ where: args.source === "-" ? "stdin" : args.source, author: null, text: readSource(io, args.source) }]
        else {
            const account = githubAccount(io)
            if (!account) {
                io.stderr.write("gate-failures import: --gh needs the profile's github.account: only its comments count, and there is none\n")
                return 1
            }
            texts = []
            for (const t of ghTexts(io, args.gh, args.number)) {
                const blocks = parseBlocks(t.text)
                if (blocks.blocks.length + blocks.broken.length === 0) continue
                if (typeof t.author !== "string" || t.author.toLowerCase() !== account.toLowerCase()) {
                    io.stdout.write(`ignored  ${t.where} by ${t.author ?? "nobody"}: not ${account} (github.account)\n`)
                    continue
                }
                texts.push(t)
            }
        }
    } catch (error) {
        io.stderr.write(`gate-failures import: ${error instanceof Error ? error.message : String(error)}\n`)
        return 1
    }

    const state = gateStateDir(io.env, io.cwd)
    const home = harnessHome(io.env, io.cwd)
    const own = readComputer(home)?.id ?? null
    const ctx = machineContext(io)
    const counts = { new: 0, skipped: 0, rejected: 0 }
    const say = (word, line) => {
        counts[word]++
        io.stdout.write(`${word.padEnd(8)} ${line}\n`)
    }

    const blocks = []
    for (const t of texts) {
        const parsed = parseBlocks(t.text)
        for (const b of parsed.broken) say("rejected", `block at ${t.where} line ${b.line}: ${b.reason}`)
        blocks.push(...parsed.blocks)
    }
    if (blocks.length === 0 && counts.rejected === 0) io.stderr.write("gate-failures import: no gate-failures export block found\n")

    for (const e of assemble(blocks)) {
        const from = `${e.computer.name} ${e.computer.id}`
        if (e.missing.length > 0) {
            const missing = e.missing.map((k) => `part ${k}/${e.parts}`).join(", ")
            // Every file of the parts that came is refused with the export: at least one count.
            counts.rejected += Math.max(1, e.files.length)
            io.stdout.write(`${"rejected".padEnd(8)} export ${e.id} of ${from}: export incomplete: ${missing} missing (${e.files.length} file(s) of the parts found)\n`)
            continue
        }
        for (const file of e.files) {
            const label = recordLabel(file)
            const parsed = parseRecordFile(JSON.stringify(file))
            if (!parsed.ok) {
                say("rejected", `${label} from ${from}: ${parsed.reason}`)
                continue
            }
            const record = parsed.record
            const leaks = leaksOf(record, ctx)
            if (leaks.length > 0) {
                say("rejected", `${label} from ${from}: personal data in ${leaks.map((l) => `${l.field} (${l.rules.join(", ")})`).join(", ")}`)
                continue
            }
            if (record.computer.id === own) {
                say("skipped", `${label}: a record of this computer (${record.computer.id})`)
                continue
            }
            if (fs.existsSync(path.join(importedDir(state, record.computer.id), recordFileName(record)))) {
                say("skipped", `${label} of ${record.computer.name} ${record.computer.id}: already imported`)
                continue
            }
            try {
                writeImported(state, record)
                say("new", `${label} of ${record.computer.name} ${record.computer.id}`)
            } catch (error) {
                say("rejected", `${label} from ${from}: ${error instanceof Error ? error.message : String(error)}`)
            }
        }
    }
    io.stdout.write(`imported: ${counts.new} new, ${counts.skipped} skipped, ${counts.rejected} rejected\n`)
    return counts.rejected > 0 ? 2 : 0
}

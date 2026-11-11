// What `gate-failures export` and `gate-failures import` share: the text of an export, its parsing
// and the check for personal data. A module of shared code: it exports no run(), so bin/gate-failures
// does not list it as a subcommand.
//
// The text of an export is one or more parts; each part is a block that fits one GitHub comment
// (GitHub takes at most 65536 characters, a part is at most PART_CHARS):
//
//   gate-failures export v1 part <k>/<n>
//   computer: <name> (<platform>)
//   ```json
//   {"export":"<id>","at":"<time>","computer":{"id":…,"name":…,"platform":…},"part":<k>,"parts":<n>,"files":[
//   <a run or rerun record of version 1, on one line>,
//   …
//   ]}
//   ```
//
// <id> is 8 random hex digits, the same in every part of one export: import puts the parts of one
// export together by it and the computer id. The records are the files of harness/hooks/gate-failures.mjs
// as they are; a run file is never split between parts, and its reruns go into the same part.
// The first line is the marker import looks for, anywhere in a text: at the start of a comment, after
// the report text of an issue body, or one part after another in a file.
//
// Node only, no shell utility: the same code runs on macOS, Linux and Windows.

import { createRequire } from "node:module"
import os from "node:os"
import { findLeaks } from "../../hooks/gate-failures.mjs"
import { harnessHome } from "../../hooks/gate-paths.mjs"

const require = createRequire(import.meta.url)
const privacy = require("../privacy.cjs")

// The most characters a part may hold (JavaScript string length, which is never less than the number
// of characters GitHub counts), below the 65536 of a GitHub comment.
export const PART_CHARS = 60000
// The length the error of a record is cut to when its run file alone is longer than a part.
export const CUT_ERROR_CHARS = 80

export const MARKER = /^gate-failures export v(\d+) part (\d+)\/(\d+)$/
const EXPORT_ID = /^[0-9a-f]{8}$/
const COMPUTER_ID = /^[0-9a-f]{8}$/
const FENCE_OPEN = /^```json\s*$/
const FENCE_CLOSE = /^```\s*$/

export function markerLine(part, parts) {
    return `gate-failures export v1 part ${part}/${parts}`
}

// The text of one part. `lines` are the records, each already JSON on one line.
export function formatPart({ id, at, computer, part, parts, lines }) {
    const head = JSON.stringify({ export: id, at, computer, part, parts }).slice(0, -1)
    return [markerLine(part, parts), `computer: ${computer.name} (${computer.platform})`, "```json", `${head},"files":[`, lines.join(",\n"), "]}", "```", ""].join("\n")
}

// Every block of an export in `text`: { blocks: [{ line, export, at, computer, part, parts, files }],
// broken: [{ line, reason }] }. `line` is the line number of the marker, from 1. A marker line
// without a well-formed block after it is broken, and the search goes on after it.
export function parseBlocks(text) {
    const lines = String(text ?? "").split(/\r\n|\r|\n/)
    const blocks = []
    const broken = []
    for (let i = 0; i < lines.length; i++) {
        const m = MARKER.exec(lines[i].trim())
        if (!m) continue
        const at = i + 1
        const fail = (reason) => broken.push({ line: at, reason })
        if (m[1] !== "1") {
            fail(`version ${m[1]} of the export, this reader knows 1`)
            continue
        }
        const part = Number(m[2])
        const parts = Number(m[3])
        if (!(part >= 1 && part <= parts)) {
            fail(`part ${part}/${parts} is not a part of the export`)
            continue
        }
        let j = i + 1
        if (j < lines.length && lines[j].trim().startsWith("computer:")) j++
        if (j >= lines.length || !FENCE_OPEN.test(lines[j].trim())) {
            fail("no ```json block after the marker")
            continue
        }
        const end = lines.findIndex((l, k) => k > j && FENCE_CLOSE.test(l.trim()))
        if (end === -1) {
            fail("the ```json block is not closed")
            continue
        }
        i = end
        let data
        try {
            data = JSON.parse(lines.slice(j + 1, end).join("\n"))
        } catch {
            fail("the block is not JSON")
            continue
        }
        const reason = checkEnvelope(data, part, parts)
        if (reason) fail(reason)
        else blocks.push({ line: at, export: data.export, at: data.at, computer: data.computer, part, parts, files: data.files })
    }
    return { blocks, broken }
}

function checkEnvelope(data, part, parts) {
    if (data === null || typeof data !== "object" || Array.isArray(data)) return "the block is not a JSON object"
    if (typeof data.export !== "string" || !EXPORT_ID.test(data.export)) return "export: not 8 hex digits"
    const c = data.computer
    if (c === null || typeof c !== "object" || typeof c.id !== "string" || !COMPUTER_ID.test(c.id) || typeof c.name !== "string") return "computer: not { id, name, platform }"
    if (data.part !== part || data.parts !== parts) return `part: ${data.part}/${data.parts} in the block, ${part}/${parts} in the marker`
    if (!Array.isArray(data.files)) return "files: not a list"
    return null
}

// The parts of one export together: { exports: [{ id, computer, files, missing }] } in the order the
// first part of each was found. `missing` lists the part numbers that are not there; a part found twice
// (a comment posted again) counts once.
export function assemble(blocks) {
    const byKey = new Map()
    for (const b of blocks) {
        const key = `${b.computer.id}/${b.export}`
        if (!byKey.has(key)) byKey.set(key, { id: b.export, computer: b.computer, parts: b.parts, got: new Map() })
        const e = byKey.get(key)
        e.parts = Math.max(e.parts, b.parts)
        if (!e.got.has(b.part)) e.got.set(b.part, b.files)
    }
    return [...byKey.values()].map((e) => {
        const missing = []
        for (let k = 1; k <= e.parts; k++) if (!e.got.has(k)) missing.push(k)
        const files = [...e.got.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, f]) => f)
        return { id: e.id, computer: e.computer, parts: e.parts, files, missing }
    })
}

// How a record is named in messages: its run id, or "rerun of <run id> at <time>".
export function recordLabel(record) {
    if (record && typeof record === "object") {
        if (record.kind === "rerun" && typeof record.of === "string") return `rerun of ${record.of} at ${record.at}`
        if (typeof record.run === "string") return record.run
    }
    return "a record"
}

function userName() {
    try {
        return os.userInfo().username
    } catch {
        return ""
    }
}

// The personal data of this computer an export must not carry, beyond what privacy.cjs finds by shape:
// its host name, the user name, the home folder, the root of the worktree `cwd` is in (`repo`, may be
// null) and the words of the personal list of the Harness home.
export function machineContext(io, repo = null) {
    const host = os.hostname()
    const user = userName()
    return {
        hostname: host,
        user: user.length >= 3 && findLeaks("/home/" + user).length > 0 ? user : "",
        folders: [
            { rule: "home folder of this computer", dir: os.homedir() },
            { rule: "worktree root of this computer", dir: repo },
        ].filter((f) => typeof f.dir === "string" && f.dir.replace(/[\\/]+$/, "").length > 1),
        deny: privacy.personal(harnessHome(io.env, io.cwd)).deny,
    }
}

const wordIn = (word, text) => new RegExp(`(?<![A-Za-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "i").test(text)

// A folder in either kind of slash, and doubled "\" as JSON writes it; any letter case.
function holdsFolder(text, dir) {
    const plain = dir.replace(/[\\/]+$/, "").toLowerCase()
    const t = text.toLowerCase().replace(/\\\\/g, "\\")
    return [plain, plain.replace(/\\/g, "/"), plain.replace(/\//g, "\\")].some((spelling) => t.includes(spelling))
}

// The rules a text breaks: those of privacy.cjs (findLeaks) and the values of `ctx` (machineContext).
// The names of the rules only, never the value found.
export function leakRules(text, ctx) {
    const s = String(text)
    const rules = findLeaks(s, { hostname: ctx.hostname, deny: ctx.deny }).map((f) => f.rule)
    if (privacy.hostNeedles(ctx.hostname).some((needle) => wordIn(needle, s))) rules.push("host name of this computer")
    if (ctx.user && wordIn(ctx.user, s)) rules.push("user name of this computer")
    for (const f of ctx.folders ?? []) if (holdsFolder(s, f.dir)) rules.push(f.rule)
    return [...new Set(rules)]
}

// Every string of `value` that breaks a rule: [{ field, rules }], `field` the path from `value`
// (failures[0].error). Keys are checked as well as values.
export function leaksOf(value, ctx, field = "") {
    const out = []
    const visit = (v, at) => {
        if (typeof v === "string") {
            const rules = leakRules(v, ctx)
            if (rules.length) out.push({ field: at || "(value)", rules })
        } else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${at}[${i}]`))
        else if (v !== null && typeof v === "object") {
            for (const [k, x] of Object.entries(v)) {
                const keyRules = leakRules(k, ctx)
                if (keyRules.length) out.push({ field: `${at ? `${at}.` : ""}(key)`, rules: keyRules })
                visit(x, at ? `${at}.${k}` : k)
            }
        }
    }
    visit(value, field)
    return out
}

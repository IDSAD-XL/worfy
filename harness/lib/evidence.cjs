// Evidence lines: what proves an item of a ticket's "done" section and where it was checked. bin/ticket
// reads and writes them (`ticket evidence`, the warning of `ticket done`). A copy of the grammar in another
// language (the worfy app's) is held to this one by the shared cases of bin/tests/fixtures/evidence/grammar.json.
// bin/TICKETS.md, "Evidence", is the description for people.
//
// An Evidence line is a nested list item under a checkbox item of the section:
//
//   - [x] Unit test of the chat command
//     - evidence: test-run pass · `pnpm test test/unit/chat.test.ts` exit 0 · mac dev · 3f2a1b9c
//     - evidence: review pass · PR #1190 · - - · 3f2a1b9c
//   - [ ] (manual) The canvas on the PC
//     - needs: windows stable
//     - evidence: screenshot pass · `../evidence/16-canvas.webp` · windows installed · bacbbcef · scrub: 2026-11-04
//
// `- evidence: <kind> <verdict> · <ref> · <platform> <copy> · <sha>[ · scrub: <YYYY-MM-DD>]`, fields split by
// " · ". `- needs: <platform> [<copy>]` is the item's requirement, written by the ticket's author. Every checkbox
// item of the section, at any depth, gets a number in file order from 1; an Evidence or needs line belongs to
// the nearest checkbox item above it. Code blocks are skipped by lib/code-fence.cjs.
//
// Pure functions, no fs: the caller reads and writes the file. CommonJS, like pipeline.cjs.
"use strict"

const { codeLines } = require("./code-fence.cjs")

const KINDS = ["commit", "test-run", "ci-check", "gate", "review", "screenshot", "owner-check"]
const VERDICTS = ["pass", "fail"]
const PLATFORMS = ["mac", "windows", "linux", "ci"]
const COPIES = ["stable", "installed", "dev", "ci"]
// The kinds that name no machine and no copy of the app: their platform and copy are always "-".
const NO_MACHINE = ["commit", "review"]
// The kinds that check the app itself: their copy is named.
const COPY_REQUIRED = ["screenshot", "owner-check"]
// The kinds that prove a manual item: something a person has seen. A test run of an agent does not.
const MANUAL_PROOF = ["owner-check", "screenshot"]
const SEP = " · "
const SHA = /^[0-9a-f]{7,40}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/

const DEFAULTS = Object.freeze({ doneSection: "## Done when", manualMark: "manual" })
// shortcut: accepts the old Russian token, remove after the next release
const OLD_HEADINGS = Object.freeze({ doneSection: "## Готово, когда", manualMark: "вручную" })

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/
const CHECKBOX = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]\s+(.*)$/
const EVIDENCE = /^\s*[-*+]\s+evidence:(.*)$/
const NEEDS = /^\s*[-*+]\s+needs:(.*)$/
const HEADING = /^(#{1,6})\s/

/** The values to look for: the given one and, while the old one is read, the old one. */
function accepted(value, fallback, old) {
    const v = typeof value === "string" && value.trim() ? value.trim() : fallback
    return v === old ? [v] : [v, old]
}

// The heading test of one section, the rule the worfy app reads its sections by: a heading that is one of `values` at its own level opens the section, the next heading of that level or
// above closes it, a deeper one inside it does not.
function sectionHeadings(values) {
    const patterns = values.map((value) => {
        const m = /^(#{1,6})[ \t]+(.*?)[ \t]*$/u.exec(value)
        const [level, text] = m ? [m[1].length, m[2]] : [2, value]
        return new RegExp(`^#{${level}}\\s+${escRe(text)}\\s*$`, "u")
    })
    let open = null
    return (line) => {
        const level = HEADING.exec(line)[1].length
        if (open !== null && level > open) return true
        open = patterns.some((p) => p.test(line)) ? level : null
        return open !== null
    }
}

/**
 * Why `fields` ({kind, verdict, ref, platform, copy, sha, scrub?}) is not an Evidence line; null when it is
 * one. The same rules read a line (parseEvidenceLine) and write one (formatEvidence).
 */
function evidenceProblem(f) {
    if (!KINDS.includes(f.kind)) return `kind is one of ${KINDS.join(", ")}, got "${f.kind}"`
    if (!VERDICTS.includes(f.verdict)) return `verdict is pass or fail, got "${f.verdict}"`
    if (typeof f.ref !== "string" || !f.ref.trim()) return "ref is empty: a command with its exit code, PR #N, a URL or a path"
    // " · " splits the fields; a "·" next to a space at either end would merge with the separator.
    if (/\s·|·\s/.test(f.ref)) return `ref must not contain "${SEP}" — it splits the fields`
    if (/[\r\n]/.test(f.ref)) return "ref must be one line"
    if (f.ref !== f.ref.trim()) return "ref must not start or end with a space"
    if (NO_MACHINE.includes(f.kind)) {
        if (f.platform !== "-" || f.copy !== "-") return `${f.kind} names no platform and no copy: "- -", got "${f.platform} ${f.copy}"`
    } else {
        if (!PLATFORMS.includes(f.platform)) return `platform is one of ${PLATFORMS.join(", ")} ("-" only for ${NO_MACHINE.join(" and ")}), got "${f.platform}"`
        if (f.copy !== "-" && !COPIES.includes(f.copy)) return `copy is one of ${COPIES.join(", ")} or "-", got "${f.copy}"`
        if (COPY_REQUIRED.includes(f.kind) && f.copy === "-") return `${f.kind} names the copy of the app it checked: ${COPIES.join(", ")}`
    }
    if (typeof f.sha !== "string" || !SHA.test(f.sha)) return `sha is 7 to 40 hex digits, got "${f.sha}"`
    if (f.scrub !== undefined && f.scrub !== null && !(typeof f.scrub === "string" && DATE.test(f.scrub)))
        return `scrub is a date YYYY-MM-DD, got "${f.scrub}"`
    return null
}

/** The text of an Evidence line after `- evidence: `, or {error}. */
function parseEvidenceLine(text) {
    const parts = text.trim().split(SEP)
    if (parts.length < 4 || parts.length > 5)
        return { error: `expected "<kind> <verdict> · <ref> · <platform> <copy> · <sha>[ · scrub: <date>]", got ${parts.length} field(s)` }
    const head = parts[0].trim().split(/\s+/)
    const machine = parts[2].trim().split(/\s+/)
    if (head.length !== 2) return { error: `the first field is "<kind> <verdict>", got "${parts[0].trim()}"` }
    if (machine.length !== 2) return { error: `the third field is "<platform> <copy>", got "${parts[2].trim()}"` }
    let scrub = null
    if (parts.length === 5) {
        const m = /^scrub:\s*(\S+)$/.exec(parts[4].trim())
        if (!m) return { error: `the fifth field is "scrub: <YYYY-MM-DD>", got "${parts[4].trim()}"` }
        scrub = m[1]
    }
    const fields = { kind: head[0], verdict: head[1], ref: parts[1].trim(), platform: machine[0], copy: machine[1], sha: parts[3].trim(), scrub }
    const problem = evidenceProblem(fields)
    return problem === null ? { fields } : { error: problem }
}

/** `- needs: <platform> [<copy>]`, the text after the colon, or {error}. */
function parseNeeds(text) {
    const words = text.trim().split(/\s+/).filter(Boolean)
    if (words.length < 1 || words.length > 2) return { error: `expected "<platform> [<copy>]", got "${text.trim()}"` }
    if (!PLATFORMS.includes(words[0])) return { error: `needs: platform is one of ${PLATFORMS.join(", ")}, got "${words[0]}"` }
    if (words[1] !== undefined && !COPIES.includes(words[1])) return { error: `needs: copy is one of ${COPIES.join(", ")}, got "${words[1]}"` }
    return { needs: { platform: words[0], copy: words[1] ?? null } }
}

/** The line `- evidence: …` for `fields` (no indentation); throws with the reason when the fields are not valid. */
function formatEvidence(f) {
    const problem = evidenceProblem(f)
    if (problem !== null) throw new Error(problem)
    return `- evidence: ${f.kind} ${f.verdict}${SEP}${f.ref}${SEP}${f.platform} ${f.copy}${SEP}${f.sha}${f.scrub ? `${SEP}scrub: ${f.scrub}` : ""}`
}

/**
 * The checkbox items of the "done" section of `markdown`, in file order:
 * { index, text, checked, manual, needs, evidence: [{kind, verdict, ref, platform, copy, sha, scrub, line}], errors,
 *   line, end, indent }.
 * `index` counts from 1; `text` is the item's text after the checkbox with its continuation lines joined by one
 * space; `line` is the item's line and `end` the last line of its block — continuation, Evidence and needs lines
 * (both 1-based), where a new Evidence line goes after; `indent` is the indentation of a line nested under it.
 * `errors` are "line N: why" for lines that do not read. The section heading is `doneSection` (the profile's
 * tickets.done_section, `## Done when` without one) and the old Russian one; the manual mark likewise.
 */
function parseDoneSection(markdown, { doneSection, manualMark } = {}) {
    const headings = sectionHeadings(accepted(doneSection, DEFAULTS.doneSection, OLD_HEADINGS.doneSection))
    const marks = accepted(manualMark, DEFAULTS.manualMark, OLD_HEADINGS.manualMark)
    const manualRe = new RegExp(`^\\((?:${marks.map(escRe).join("|")})(?:,[^)]*)?\\)`, "u")
    const lines = String(markdown).replace(/^\uFEFF/, "").split(/\r?\n/)
    const isCode = codeLines()
    const items = []
    let inSection = false
    let current = null // the item whose text continuation lines still join
    lines.forEach((line, i) => {
        const no = i + 1
        if (isCode(line)) {
            current = null
            return
        }
        if (HEADING.test(line)) {
            current = null
            inSection = headings(line)
            return
        }
        if (!inSection) return
        const box = CHECKBOX.exec(line)
        if (box) {
            const text = box[3].trim()
            current = {
                index: items.length + 1,
                text,
                checked: box[2] !== " ",
                manual: manualRe.test(text),
                needs: null,
                evidence: [],
                errors: [],
                line: no,
                end: no,
                // The content column of the item: its leading whitespace, then spaces under the list marker.
                indent: box[1].match(/^\s*/)[0] + " ".repeat(box[1].length - box[1].match(/^\s*/)[0].length),
            }
            items.push(current)
            return
        }
        const owner = items[items.length - 1]
        const ev = EVIDENCE.exec(line)
        const nd = ev ? null : NEEDS.exec(line)
        if ((ev || nd) && owner) {
            current = null
            owner.end = no
            if (ev) {
                const r = parseEvidenceLine(ev[1])
                if (r.error) owner.errors.push(`line ${no}: ${r.error}`)
                else owner.evidence.push({ ...r.fields, line: no })
            } else {
                const r = parseNeeds(nd[1])
                if (r.error) owner.errors.push(`line ${no}: ${r.error}`)
                else if (owner.needs !== null) owner.errors.push(`line ${no}: a second needs line`)
                else owner.needs = r.needs
            }
            return
        }
        if (line.trim() === "" || LIST_ITEM.test(line)) {
            current = null
            return
        }
        if (current !== null) {
            current.text += ` ${line.trim()}`
            current.end = no
        }
    })
    return items
}

/**
 * The state of an item: { state: "verified" } | { state: "not-verified", reason } | { state: "failed" }.
 *   failed       — the last Evidence line of the item says fail;
 *   verified     — not failed, no unreadable line, and a pass line of a proving kind (any but review; for a
 *                  manual item only owner-check and screenshot) that matches `needs` by platform (and copy, if
 *                  named);
 *   not-verified — the rest; reasons: "no evidence", "review only", "unreadable evidence line",
 *                  "manual item needs owner-check or screenshot", "needs <p> <c>, got <p> <c>".
 */
function itemState(item) {
    const ev = item.evidence
    if (ev.length && ev[ev.length - 1].verdict === "fail") return { state: "failed" }
    if (item.errors.length) return { state: "not-verified", reason: "unreadable evidence line" }
    if (!ev.length) return { state: "not-verified", reason: "no evidence" }
    const passed = ev.filter((e) => e.verdict === "pass")
    const proofs = passed.filter((e) => e.kind !== "review" && (!item.manual || MANUAL_PROOF.includes(e.kind)))
    if (!proofs.length) {
        if (passed.length && passed.every((e) => e.kind === "review")) return { state: "not-verified", reason: "review only" }
        if (item.manual) return { state: "not-verified", reason: "manual item needs owner-check or screenshot" }
        return { state: "not-verified", reason: "no evidence" }
    }
    if (item.needs) {
        const { platform, copy } = item.needs
        if (!proofs.some((e) => e.platform === platform && (copy === null || e.copy === copy))) {
            const got = proofs[proofs.length - 1]
            return { state: "not-verified", reason: `needs ${platform}${copy ? ` ${copy}` : ""}, got ${got.platform} ${got.copy}` }
        }
    }
    return { state: "verified" }
}

module.exports = {
    KINDS,
    VERDICTS,
    PLATFORMS,
    COPIES,
    NO_MACHINE,
    COPY_REQUIRED,
    DEFAULTS,
    OLD_HEADINGS,
    evidenceProblem,
    parseEvidenceLine,
    formatEvidence,
    parseDoneSection,
    itemState,
}

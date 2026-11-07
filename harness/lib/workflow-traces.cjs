// The rules of what a trace of the workflow is: the words that show a reader of a commit, a PR or a review
// that the change came out of an agent workflow (an epic name, `<epic>/<NN>`, a ticket number, an ADR
// number, the Workflow folder, `.scratch`, `HANDOFF`), and the Claude attribution lines. bin/silent-check
// applies them to what a Silent project or a project with `attribution: off` shows; bin/review-draft-lint
// applies them to every review draft, in any mode. One module, so the two never disagree on a rule.
//
// API (CommonJS; the caller reads the data files and the tickets root, this module only builds rules
// and matches them):
//
//   epicNames(ticketsRoot) -> string[]
//       The epics of a tickets root: its directories, not hidden ones, the longest name first (of
//       `checkout` and `checkout-flow` the longer one is the finding). No such directory gives [].
//
//   ticketWords(inputWords) -> string[]
//       The word "ticket" in the languages of projects other than English, from the parsed
//       lib/input-words.json (its key ticketWord). Throws when the key is not a list of words.
//
//   traceRules({ epics, ticketWords, workflowFolder }) -> rule[]
//       The traces of the workflow. epics — epicNames() of the project; ticketWords — ticketWords();
//       workflowFolder — the Workflow folder of the profile or null (also its real path, its C:/…
//       spelling on Windows and its ~/… spelling under the home folder).
//
//   attributionRules() -> rule[]
//       The Claude attribution lines: `Co-Authored-By: Claude`, `Generated with [Claude Code]`.
//
//   aiVoiceRules() -> rule[]
//       A text that names its author as an AI ("as an AI", "as an AI language model"). bin/silent-check
//       does not use it: a commit message or a diff may say so about the code it changes.
//
//   scan(text, rules, { diff }) -> [{ kind, index, text }]
//       Every match of the rules in one line of text, in rule order; a span already found by an earlier
//       rule is not found again (`checkout-flow/05` is an epic/NN, not also an epic name). With
//       diff: true the rules that do not apply to the added lines of a diff are skipped.
//
// A rule is { kind, re, diff }: kind names it in a finding, re is a RegExp with the g flag, diff says
// whether it also applies to the added lines of a diff. A bare epic name does not: epics are often
// named by the code area they change (`deals`, `frontend`), and the code itself names that area.
"use strict"

const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

function epicNames(ticketsRoot) {
    let epics = []
    try {
        epics = fs
            .readdirSync(ticketsRoot, { withFileTypes: true })
            .filter((d) => d.isDirectory() && !d.name.startsWith("."))
            .map((d) => d.name)
    } catch {
        /* no tickets root yet — no epic names to look for */
    }
    return epics.sort((a, b) => b.length - a.length)
}

function ticketWords(inputWords) {
    const words = inputWords && inputWords.ticketWord
    if (!Array.isArray(words) || !words.every((w) => typeof w === "string" && w)) throw new Error("ticketWord is not a list of words")
    return words
}

// The spellings of the Workflow folder a text may carry.
function folderForms(workflowFolder) {
    const forms = new Set([workflowFolder.replace(/\/+$/, "")])
    try {
        forms.add(fs.realpathSync(workflowFolder))
    } catch {
        /* the folder is gone — its spelling in the profile still counts */
    }
    // Windows: the profile gives C:\…, git and the shell print C:/…; HOME may be spelled either way.
    if (path.sep === "\\") for (const f of [...forms]) forms.add(f.split("\\").join("/"))
    const home = os.homedir() ? path.resolve(os.homedir()) : ""
    for (const f of [...forms]) {
        const r = path.resolve(f)
        if (home && r.startsWith(home + path.sep)) forms.add("~" + r.slice(home.length).split(path.sep).join("/"))
    }
    return [...forms]
}

function traceRules({ epics = [], ticketWords: words = [], workflowFolder = null } = {}) {
    const rules = []
    const B = "(?<![\\p{L}\\p{N}_-])" // the name is a whole token: not a part of a longer word or slug
    const E = "(?![\\p{L}\\p{N}_-])"
    for (const ep of epics) rules.push({ kind: "epic/NN", re: new RegExp(`${B}${esc(ep)}/\\d+${E}`, "giu"), diff: true })
    for (const ep of epics) rules.push({ kind: "epic name", re: new RegExp(`${B}${esc(ep)}${E}`, "giu"), diff: false })
    rules.push({ kind: "ADR number", re: /(?<![\p{L}\p{N}_])ADR[-_ ]?\d{4}(?!\d)/giu, diff: true })
    const ticket = ["Tickets?", ...words.map((w) => `${esc(w)}\\p{L}*`)].join("|")
    rules.push({ kind: "ticket number", re: new RegExp(`(?<![\\p{L}\\p{N}_])(?:${ticket})[- ]#?\\d+`, "giu"), diff: true })
    if (typeof workflowFolder === "string" && workflowFolder)
        for (const f of folderForms(workflowFolder)) rules.push({ kind: "Workflow folder path", re: new RegExp(esc(f), "g"), diff: true })
    rules.push({ kind: ".scratch", re: /\.scratch(?![\p{L}\p{N}_])/gu, diff: true })
    rules.push({ kind: "HANDOFF", re: /HANDOFF/g, diff: true })
    return rules
}

function attributionRules() {
    return [
        { kind: "Claude attribution", re: /Co-Authored-By:[ \t]*Claude/gi, diff: true },
        { kind: "Claude attribution", re: /Generated with \[?Claude Code/gi, diff: true },
    ]
}

function aiVoiceRules() {
    return [{ kind: "AI authorship", re: /(?<![\p{L}\p{N}_])as an AI(?: language model)?(?![\p{L}\p{N}_])/giu, diff: true }]
}

function scan(text, rules, { diff = false } = {}) {
    const found = []
    const taken = [] // [start, end): a span already reported under an earlier rule
    for (const { kind, re, diff: inDiff } of rules) {
        if (diff && !inDiff) continue
        re.lastIndex = 0
        for (const m of String(text).matchAll(re)) {
            const s = m.index
            const e = s + m[0].length
            if (taken.some(([a, b]) => s < b && e > a)) continue
            taken.push([s, e])
            found.push({ kind, index: s, text: m[0] })
        }
    }
    return found
}

module.exports = { epicNames, ticketWords, traceRules, attributionRules, aiVoiceRules, scan }

// node history.cjs <short|full|refresh> <harness home>... — the part of history.sh that needs Node: run in the
// fixture's repository (project demo, built by lib/demo-project.sh) it adds
//
//   the commits    each pull request of the history is a commit on refs/pull/<n>/head (two for #30) merged into
//                  main by a merge commit, written by one `git fast-import`: the check of the skill (check.md)
//                  finds the commit a review saw and the merge commit in the repository without a fetch
//   the origin     https://github.com/quillwork/ledger.git, so bin/review-history takes the project for that
//                  repository, and protocol.https.allow=never, so no git command of the run reaches the network
//   .git/eval-gh/  the stand-in gh (gh.mjs, and `gh`, a shell wrapper of it) and history.json, the answers it gives;
//                  its log goes to gh-calls.log in the project root, which the graders read
//   $HOME          .zshenv, .zprofile, .zshrc, .bashrc, .bash_profile and .profile put .git/eval-gh first on PATH: the shells of the
//                  run start from this HOME, so bin/review-history and the model's own `gh` find the stand-in, and
//                  never the real gh. An eval case may set only EVAL_* variables (claude 2.1.289), and the run's
//                  PATH is the operator's
//   refresh        the private folder of a reviewer built and kept before, in <harness home>/projects/demo/state/
//                  human-review/ of each harness home given
//
// The dates of the pull requests count back from now: bin/review-history reads the 12 months before the run.
// Every login, name and text here is invented.
"use strict"

const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")

const [kind, ...homes] = process.argv.slice(2)
if (!["short", "full", "refresh"].includes(kind) || homes.length === 0) {
    process.stderr.write("usage: node history.cjs <short|full|refresh> <harness home>...\n")
    process.exit(2)
}

const OWNER = "quillwork"
const NAME = "ledger"
const REPO_URL = `https://github.com/${OWNER}/${NAME}`
const DAY = 24 * 60 * 60 * 1000
const NOW = Date.now()

// Who is who. Team: MEMBER, COLLABORATOR, OWNER. drift-guest is an outside contributor (context only), ledger-ci a
// bot, and the authors' replies on their own pull requests are dropped by review-history.
const PEOPLE = {
    "fern-lead": ["User", "MEMBER"],
    "otter-qa": ["User", "COLLABORATOR"],
    "quill-ops": ["User", "OWNER"],
    "drift-guest": ["User", "CONTRIBUTOR"],
    "sable-dev": ["User", "MEMBER"],
    "wren-dev": ["User", "MEMBER"],
    "ledger-ci": ["Bot", "NONE"],
}

// One pull request: n, title, author, file, the content of each commit (lines), the reviews ({by, state, body,
// on: the commit index}), the threads ({line, on, resolved, outdated, comments: [{by, body}]}) and the conversation.
const FULL = [
    {
        n: 20,
        title: "Validate currency codes",
        author: "wren-dev",
        file: "src/currency.mjs",
        commits: [["/** The currency codes the ledger accepts. */", "const CODES = ['EUR', 'USD', 'GBP', 'PLN']", "", "export function isCurrency(code) {", "  return CODES.includes(code)", "}"]],
        reviews: [{ by: "fern-lead", state: "CHANGES_REQUESTED", body: "The list of currencies is copied from the old service; read it from config/currencies.json so the two cannot drift." }],
        threads: [{ line: 5, comments: [{ by: "otter-qa", body: "Please add a test for a lower-case code; the payment API sends `eur` sometimes." }] }],
    },
    {
        n: 21,
        title: "Log failed exports",
        author: "sable-dev",
        file: "src/export-log.mjs",
        commits: [["/** Logs an export that failed. */", "export function logFailedExport(error) {", "  console.log('export failed:', error.message)", "}"]],
        reviews: [{ by: "quill-ops", state: "APPROVED", body: "LGTM" }],
        threads: [
            { line: 3, comments: [{ by: "quill-ops", body: "followup: the log line should carry the export id so we can find the file; a ticket is fine." }] },
            { line: 3, resolved: true, comments: [{ by: "otter-qa", body: "nit: `console.error` here, the other failures go to stderr." }] },
        ],
    },
    {
        n: 22,
        title: "Describe the refund flow",
        author: "wren-dev",
        file: "docs/refunds.md",
        commits: [["# Refunds", "", "A refund goes back to the card the customer paid with.", "Support starts it from the payment page.", "A refund over the limit needs an approval."]],
        reviews: [
            { by: "fern-lead", state: "COMMENTED", body: "Clear, thanks. One question inline." },
            { by: "quill-ops", state: "APPROVED", body: "" },
        ],
        threads: [{ line: 5, comments: [{ by: "fern-lead", body: "Should this page say who approves a refund over the limit? Support asks that a lot." }] }],
    },
    {
        n: 23,
        title: "Parse amounts from bank CSV",
        author: "sable-dev",
        file: "src/csv-amount.mjs",
        commits: [["/** Parses an amount cell of a bank CSV export. */", "export function pa(cell) {", "  const n = Number(cell)", "  if (Number.isNaN(n)) return 0", "  return n", "}"]],
        reviews: [{ by: "otter-qa", state: "COMMENTED", body: "Mostly naming, see inline." }],
        threads: [
            { line: 2, resolved: true, comments: [{ by: "otter-qa", body: "nit: `parseAmount` instead of `pa`, we spell names out." }] },
            { line: 4, resolved: true, comments: [{ by: "fern-lead", body: "@sable-dev this swallows the parse error and returns 0, which turns a broken row into a zero payment. Throw instead and let the import report the row." }] },
            { line: 3, comments: [{ by: "quill-ops", body: "heads-up: some banks export amounts with a comma as the decimal separator, and `Number('12,50')` is NaN." }] },
        ],
    },
    {
        n: 24,
        title: "Rename customer.phone",
        author: "wren-dev",
        file: "migrations/002-rename-phone.sql",
        commits: [["-- up", "ALTER TABLE customer RENAME COLUMN phone TO phone_number;"]],
        reviews: [{ by: "quill-ops", state: "CHANGES_REQUESTED", body: "Renaming a column breaks the running version during the deploy. Add the new column, copy the data, and drop the old one in a later release. The down migration is missing too." }],
        threads: [
            { line: 2, comments: [{ by: "otter-qa", body: "Which services still read customer.phone? The billing worker does, I think." }] },
            { line: 2, comments: [{ by: "fern-lead", body: "heads-up: the CRM sync job maps the phone column by name as well." }] },
        ],
    },
    {
        n: 25,
        title: "Split invoice totals",
        author: "sable-dev",
        file: "src/totals.mjs",
        commits: [["/** The totals of an invoice. */", "export function totals(lines) {", "  const sum = lines.reduce((acc, line) => acc + line.amount, 0)", "  return {", "    sum: sum.toFixed(2),", "    average: (sum / lines.length).toFixed(2)", "  }", "}"]],
        reviews: [{ by: "fern-lead", state: "APPROVED", body: "Looks good, two small things inline." }],
        threads: [
            { line: 6, resolved: true, comments: [{ by: "fern-lead", body: "nit: a trailing comma here keeps the next diff to one line." }] },
            { line: 6, comments: [{ by: "otter-qa", body: "Please add a test for an invoice with no lines: the average divides by zero and returns NaN." }] },
            { line: 5, comments: [{ by: "quill-ops", body: "question: why does totals() return strings? The callers convert them back to numbers." }] },
        ],
    },
    {
        n: 26,
        title: "Bump the docs linter",
        author: "wren-dev",
        file: "docs/deps.txt",
        commits: [["markdown-lint 0.9.2"]],
        reviews: [{ by: "quill-ops", state: "APPROVED", body: "" }],
        threads: [],
    },
    {
        n: 27,
        title: "Index payments by customer",
        author: "wren-dev",
        file: "migrations/003-payments-index.sql",
        commits: [["-- up", "CREATE INDEX payments_customer ON payments (customer_id);"]],
        reviews: [{ by: "quill-ops", state: "CHANGES_REQUESTED", body: "Missing down migration again: drop the index in the down step, please." }],
        threads: [
            { line: 2, comments: [{ by: "quill-ops", body: "Create the index CONCURRENTLY, otherwise the payments table is locked for the whole build." }] },
            { line: 2, comments: [{ by: "otter-qa", body: "heads-up: the nightly export also reads payments by customer, so this speeds that job up too." }] },
            { line: 2, comments: [{ by: "fern-lead", body: "question: would an index on (customer_id, created_at) serve better? The list view sorts by date." }] },
        ],
    },
    {
        n: 28,
        title: "Retry the payment webhook",
        author: "sable-dev",
        file: "src/webhook.mjs",
        commits: [["/** Sends the payment webhook, retrying on failure. */", "export async function sendWebhook(post, event) {", "  for (let attempt = 0; attempt < 5; attempt++) {", "    const response = await post(event)", "    if (response.ok) return response", "  }", "  throw new Error('webhook failed')", "}"]],
        reviews: [
            { by: "otter-qa", state: "COMMENTED", body: "" },
            { by: "fern-lead", state: "CHANGES_REQUESTED", body: "Only the retry condition needs to change before this merges." },
        ],
        threads: [
            { line: 3, comments: [{ by: "otter-qa", body: "The retry count is a magic number; put it in a named constant next to the other limits." }] },
            { line: 5, resolved: true, comments: [{ by: "fern-lead", body: "Retrying a 4xx makes no sense, the request fails the same way again. Retry only on 5xx and timeouts." }] },
            {
                line: 3,
                comments: [
                    { by: "drift-guest", body: "Would exponential backoff help here?" },
                    { by: "fern-lead", body: "Good point, but a fixed delay is fine for now; not worth changing in this PR." },
                ],
            },
        ],
        comments: [
            { by: "quill-ops", body: "followup: we should log each retry with its attempt number; a separate PR is fine." },
            { by: "ledger-ci", body: "Build passed in 2m 10s." },
        ],
    },
    {
        n: 29,
        title: "Fix typos in the README",
        author: "wren-dev",
        file: "docs/README.md",
        commits: [["# Ledger", "", "The ledger keeps the payments and invoices of Quillwork."]],
        reviews: [{ by: "fern-lead", state: "APPROVED", body: "" }],
        threads: [],
    },
    {
        n: 30,
        title: "Add invoices.due_date",
        author: "wren-dev",
        file: "migrations/004-due-date.sql",
        commits: [
            ["-- up", "ALTER TABLE invoices ADD COLUMN due_date timestamp NOT NULL;"],
            ["-- up", "ALTER TABLE invoices ADD COLUMN due_date timestamp;", "-- down", "ALTER TABLE invoices DROP COLUMN due_date;"],
        ],
        reviews: [
            { by: "quill-ops", state: "CHANGES_REQUESTED", body: "This needs a down migration before it can go in: every migration here must be reversible, we roll back on a failed deploy." },
            { by: "quill-ops", state: "APPROVED", body: "Thanks, the down step looks right now.", on: 1 },
        ],
        threads: [
            { line: 2, resolved: true, outdated: true, comments: [{ by: "quill-ops", body: "A NOT NULL column without a default fails on the existing rows. Add it nullable, backfill, then set NOT NULL in a later migration." }] },
            { line: 2, outdated: true, comments: [{ by: "otter-qa", body: "Is due_date in UTC or in the customer's zone? The reports compare it with created_at, which is UTC." }] },
        ],
    },
    {
        n: 31,
        title: "Add an amount rounding helper",
        author: "sable-dev",
        file: "src/round.mjs",
        commits: [["/** Rounds an amount to two decimals. */", "export function rnd(amount) {", "  return Math.round(amount * 100) / 100", "}"]],
        reviews: [
            { by: "otter-qa", state: "COMMENTED", body: "A few small things, nothing blocking." },
            { by: "fern-lead", state: "APPROVED", body: "" },
        ],
        threads: [
            { line: 2, resolved: true, comments: [{ by: "otter-qa", body: "nit: `roundAmount` reads better than `rnd`; the other helpers spell the verb out." }] },
            {
                line: 3,
                comments: [
                    { by: "fern-lead", body: "What happens with a negative amount? Math.round rounds -2.5 up to -2, so refunds round differently from charges." },
                    { by: "sable-dev", body: "I will switch to a symmetric rounding." },
                ],
            },
            { line: 1, comments: [{ by: "otter-qa", body: "nit: say which currency unit the amount is in; the JSDoc of the other helpers does." }] },
        ],
        comments: [{ by: "ledger-ci", body: "Coverage 91% (+0.4%)" }],
    },
]

const SHORT = [
    {
        n: 1,
        title: "Sum the amounts",
        author: "sable-dev",
        file: "src/total.mjs",
        commits: [["export function t(amounts) {", "  return amounts.reduce((a, b) => a + b, 0)", "}"]],
        reviews: [{ by: "fern-lead", state: "COMMENTED", body: "Two small things inline." }],
        threads: [
            { line: 1, comments: [{ by: "otter-qa", body: "nit: name it `sumAmounts`, `t` says nothing." }] },
            { line: 2, comments: [{ by: "fern-lead", body: "Please add a test for an empty list." }] },
        ],
    },
    {
        n: 2,
        title: "Add the card fee",
        author: "wren-dev",
        file: "src/fee.mjs",
        commits: [["export function fee(amount) {", "  return amount * 0.025", "}"]],
        reviews: [{ by: "quill-ops", state: "CHANGES_REQUESTED", body: "The fee must be computed in cents, not in floats." }],
        threads: [{ line: 2, comments: [{ by: "otter-qa", body: "question: where does the 2.5 come from? A named constant would say it." }] }],
        comments: [{ by: "fern-lead", body: "LGTM" }],
    },
    {
        n: 3,
        title: "Cap the daily payout",
        author: "sable-dev",
        file: "src/limit.mjs",
        commits: [["// The daily payout limit is 100.", "export const LIMIT = 5000"]],
        reviews: [{ by: "otter-qa", state: "APPROVED", body: "+1 thanks" }],
        threads: [
            { line: 2, comments: [{ by: "quill-ops", body: "heads-up: the limit changes per country next quarter." }] },
            { line: 2, comments: [{ by: "fern-lead", body: "followup: move the limit into config in a separate PR." }] },
            { line: 1, comments: [{ by: "otter-qa", body: "nit: the comment above still says 100." }] },
        ],
    },
]

const pulls = kind === "short" ? SHORT : FULL
const newest = Math.max(...pulls.map((p) => p.n))
// The newest pull request was updated 3 days ago (short: 5), each older one 3 (5) days before it.
const step = kind === "short" ? 5 : 3
const updatedOf = (p) => NOW - (newest - p.n + 1) * step * DAY
const iso = (t) => new Date(t).toISOString()

function git(args, input) {
    const r = spawnSync("git", args, { input, encoding: "utf8", stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] })
    if (r.status !== 0) {
        process.stderr.write(`history.cjs: git ${args.join(" ")} failed (exit ${r.status}): ${r.stderr || r.error}\n`)
        process.exit(1)
    }
    return r.stdout
}

// --- the commits: one git fast-import ---------------------------------------------------------------------------
const text = (lines) => `${lines.join("\n")}\n`
const data = (s) => `data ${Buffer.byteLength(s)}\n${s}\n`
let mark = 0
let clock = 1759320000
const stamp = () => `demo <demo@example.invalid> ${clock++} +0000`
let stream = ""
let mainTip = git(["rev-parse", "main"]).trim()
for (const p of pulls) {
    p.marks = []
    let parent = mainTip
    p.commits.forEach((lines, i) => {
        p.marks.push(++mark)
        stream += `commit refs/pull/${p.n}/head\nmark :${mark}\nauthor ${stamp()}\ncommitter ${stamp()}\n`
        stream += data(i === 0 ? p.title : `${p.title}: address the review`)
        stream += `from ${parent}\nM 100644 inline ${p.file}\n${data(text(lines))}`
        parent = `:${mark}`
    })
    p.mergeMark = ++mark
    stream += `commit refs/heads/main\nmark :${mark}\nauthor ${stamp()}\ncommitter ${stamp()}\n`
    stream += data(`Merge pull request #${p.n} from ${OWNER}/pr-${p.n}`)
    stream += `from ${mainTip}\nmerge ${parent}\nM 100644 inline ${p.file}\n${data(text(p.commits[p.commits.length - 1]))}`
    mainTip = `:${mark}`
}
const marksFile = path.join(".git", "eval-history-marks")
git(["fast-import", "--quiet", `--export-marks=${marksFile}`], stream)
const oids = new Map(
    fs
        .readFileSync(marksFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => {
            const [m, oid] = l.split(" ")
            return [Number(m.slice(1)), oid]
        }),
)
fs.rmSync(marksFile)
git(["reset", "-q", "--hard", "main"])
git(["remote", "set-url", "origin", `${REPO_URL}.git`])
git(["config", "protocol.https.allow", "never"])

// --- the answers of GitHub --------------------------------------------------------------------------------------
const actor = (login) => ({ __typename: PEOPLE[login][0], login })
const assoc = (login) => PEOPLE[login][1]
const page = (nodes) => ({ pageInfo: { hasNextPage: false, endCursor: "end" }, nodes })
const hunk = (lines, upTo) => `@@ -0,0 +1,${upTo} @@\n${lines.slice(0, upTo).map((l) => `+${l}`).join("\n")}`
let serial = 1000

function pullNode(p) {
    const updated = updatedOf(p)
    const shas = p.marks.map((m) => oids.get(m))
    const last = p.commits[p.commits.length - 1]
    const reviews = p.reviews.map((r, i) => {
        const id = ++serial
        return {
            id: `PRR_${id}`,
            url: `${REPO_URL}/pull/${p.n}#pullrequestreview-${id}`,
            state: r.state,
            body: r.body,
            submittedAt: iso(updated - DAY + i * 60 * 60 * 1000),
            authorAssociation: assoc(r.by),
            author: actor(r.by),
            commit: { oid: shas[r.on ?? 0] },
        }
    })
    const threads = p.threads.map((t) => {
        const tid = ++serial
        const on = t.on ?? 0
        let first = null
        const comments = t.comments.map((c, i) => {
            const id = ++serial
            const node = {
                id: `PRRC_${id}`,
                url: `${REPO_URL}/pull/${p.n}#discussion_r${id}`,
                body: c.body,
                createdAt: iso(updated - DAY + (i + 1) * 10 * 60 * 1000),
                authorAssociation: assoc(c.by),
                author: actor(c.by),
                path: p.file,
                line: t.outdated ? null : t.line,
                originalLine: t.line,
                diffHunk: hunk(p.commits[on], t.line),
                replyTo: first ? { id: first } : null,
                originalCommit: { oid: shas[on] },
            }
            first = first || node.id
            return node
        })
        return { id: `PRRT_${tid}`, path: p.file, line: t.outdated ? null : t.line, isResolved: !!t.resolved, isOutdated: !!t.outdated, comments: page(comments) }
    })
    const comments = (p.comments || []).map((c, i) => {
        const id = ++serial
        return { id: `IC_${id}`, url: `${REPO_URL}/pull/${p.n}#issuecomment-${id}`, body: c.body, createdAt: iso(updated - DAY + (i + 2) * 60 * 60 * 1000), authorAssociation: assoc(c.by), author: actor(c.by) }
    })
    return {
        number: p.n,
        url: `${REPO_URL}/pull/${p.n}`,
        title: p.title,
        state: "MERGED",
        createdAt: iso(updated - 2 * DAY),
        updatedAt: iso(updated),
        mergedAt: iso(updated),
        additions: last.length,
        deletions: 0,
        changedFiles: 1,
        author: actor(p.author),
        files: { nodes: [{ path: p.file }] },
        reviews: page(reviews),
        reviewThreads: page(threads),
        comments: page(comments),
    }
}

// `gh pr view <n> --json …`: what check.md asks for, and what the template of the review skill asks for.
function viewOf(p) {
    const shas = p.marks.map((m) => oids.get(m))
    const last = p.commits[p.commits.length - 1]
    return {
        number: p.n,
        url: `${REPO_URL}/pull/${p.n}`,
        title: p.title,
        body: `${p.title}.`,
        state: "MERGED",
        baseRefName: "main",
        headRefName: `pr-${p.n}`,
        headRefOid: shas[shas.length - 1],
        mergeCommit: { oid: oids.get(p.mergeMark) },
        closingIssuesReferences: [],
        additions: last.length,
        deletions: 0,
        changedFiles: 1,
        files: [{ path: p.file, additions: last.length, deletions: 0 }],
    }
}

const nodes = [...pulls].sort((a, b) => b.n - a.n).map(pullNode)
const views = Object.fromEntries(pulls.map((p) => [p.n, viewOf(p)]))
const ghDir = path.join(".git", "eval-gh")
fs.mkdirSync(ghDir, { recursive: true })
fs.writeFileSync(path.join(ghDir, "history.json"), `${JSON.stringify({ owner: OWNER, name: NAME, pulls: nodes, views }, null, 2)}\n`)
fs.copyFileSync(path.join(__dirname, "gh.mjs"), path.join(ghDir, "gh.mjs"))
fs.writeFileSync(path.join(ghDir, "gh"), '#!/bin/sh\n# The stand-in gh of the eval fixture: gh.mjs next to this file.\nexec node "${0%/*}/gh.mjs" "$@"\n', { mode: 0o755 })
// .git/info is not there when git init found no templates (the scaffold of `claude plugin eval` runs it so).
fs.mkdirSync(path.join(".git", "info"), { recursive: true })
fs.appendFileSync(path.join(".git", "info", "exclude"), "/gh-calls.log\n")

// --- the shells of the run find the stand-in first -------------------------------------------------------------
const home = process.env.HOME || process.env.USERPROFILE
const standIn = path.resolve(ghDir).split(path.sep).join("/")
const pathLine = `# The eval fixture: the stand-in gh of the project first on PATH.\nexport PATH="${standIn}:$PATH"\n`
// .zprofile and .zshrc too: a login zsh on macOS runs path_helper (/etc/zprofile) after .zshenv, which moves the
// folders of /etc/paths ahead of it.
for (const rc of [".zshenv", ".zprofile", ".zshrc", ".bashrc", ".profile"]) fs.appendFileSync(path.join(home, rc), pathLine)
fs.appendFileSync(path.join(home, ".bash_profile"), `${pathLine}[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"\n`)

// --- refresh: a reviewer built and kept 13 days ago --------------------------------------------------------------
if (kind === "refresh") {
    const fetched = NOW - 13 * DAY
    const older = nodes.filter((n) => Date.parse(n.updatedAt) < fetched)
    const lastPr = older[0]
    const meta = {
        fetched_at: iso(fetched),
        window: { from: iso(fetched - 365 * DAY), to: iso(fetched), since: null, months: 12, max_prs_per_repository: 500 },
        repositories: [{ repo: `${OWNER}/${NAME}`, pull_requests: older.length, last_pr: { number: lastPr.number, updated_at: lastPr.updatedAt } }],
        voice: { enough: true, substantive: 31, threshold: 30, line: "voice: yes" },
        held_out: [],
        kept_at: iso(fetched).slice(0, 10),
        decision: { choice: "keep", at: iso(fetched).slice(0, 10) },
        raw: "fetch",
    }
    const files = {
        "meta.json": `${JSON.stringify(meta, null, 2)}\n`,
        "ignore.json": `${JSON.stringify({ logins: [], body_prefixes: [] }, null, 2)}\n`,
        "research.md": [
            "# Research — review history of demo",
            "",
            `Window: ${meta.window.from.slice(0, 10)} to ${meta.window.to.slice(0, 10)}, ${older.length} pull requests, 22 substantive comments of the team, 3 reviewers.`,
            "Reviewers: reviewer A 0.36, reviewer B 0.34, reviewer C 0.30",
            "",
            "## R1 — Triage: approved without comments",
            "",
            "Numbers: 1 of 8 pull requests approved without a comment (stats.approved_without_comments).",
            "Comments: none.",
            "",
            "## R2 — Triage: small is not safe",
            "",
            "Numbers: 2 small pull requests got changes requested, both migrations (analysis).",
            `Comments: ${REPO_URL}/pull/24, ${REPO_URL}/pull/27`,
            "",
            "## R3 — Triage: requests to split a pull request",
            "",
            "No evidence in the window. Numbers: 0 split requests (analysis).",
            "",
            "## R4 — Review states",
            "",
            "Numbers: APPROVED 0.45, COMMENTED 0.27, CHANGES_REQUESTED 0.27 (stats.review_states).",
            "",
            "## R5 — Theme: migrations/: a down migration",
            "",
            "Numbers: 2 of 6 comments of the area (analysis).",
            `Comments: ${REPO_URL}/pull/27`,
            "",
        ].join("\n"),
        "lint.json": `${JSON.stringify({ schema: 1, tiers: { "let go": { max_chars: 200 }, nit: { max_chars: 120 }, question: { max_chars: 400 }, "heads-up": { max_chars: 500 }, followup: { max_chars: 400 }, argued: { max_chars: 900 }, blocker: { max_chars: 1200 } }, forbidden: [] }, null, 2)}\n`,
        ".claude/skills/human-review/SKILL.md": [
            "---",
            "name: human-review",
            "description: Draft a review of a pull request in this team's voice; nothing is posted without the user's yes.",
            "---",
            "",
            "# Review a pull request the way this team does",
            "",
            "## 2. Triage",
            "",
            "- Ask for a down migration on every migration: 2 of 2 migrations got changes requested for it. [R2] [R5]",
            "",
        ].join("\n"),
        ".claude/skills/human-review/voice-examples.md": "# Voice examples — the team's own comments by tier\n\n## blocker\n\nNo comments of this tier in the window.\n",
        "check/ledger-27.md": `# ${OWNER}/${NAME}#27\n\nmatched 1 of 3 remarks of the team, 1 extra — a rough measure\n`,
    }
    for (const harnessHome of homes) {
        const dir = path.join(harnessHome, "projects", "demo", "state", "human-review")
        for (const [rel, content] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
            fs.writeFileSync(path.join(dir, rel), content)
        }
    }
}

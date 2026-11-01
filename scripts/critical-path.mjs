#!/usr/bin/env node
// The critical path of Tickets: how long each Ticket waited on each step from claim to merge,
// read from what is already written down, so that "what to speed up" is a measurement and not a
// guess (ADR-0002: no new store of events). Run `node scripts/critical-path.mjs --help`.
//
// Sources, all read only:
//   - the Autopilot run journals, `<worfy data folder>/autopilot/<run>.jsonl` (the format is the
//     header of src/shared/autopilot/journal.ts): wave-started gives the moment a Ticket was
//     started, limits-hit / waiting-until → resumed the Limits waits, narrow-round the narrow fix
//     rounds, session-error and run-stopped the stops of the run while the Ticket's Wave was open;
//   - the Ticket files of a Project, `<root>/.scratch/<epic>/issues/NN-*.md`: their header, one fact
//     per line (harness/bin/TICKETS.md): `Status: <word> <time>` and `PR: #N`;
//   - the PRs, from `gh` or from a JSON file of the same shape (`--prs`): opening, the CI checks
//     and the workflow runs of the branch, the Gate verdicts in comments (`VERIFIED`, `REJECTED`,
//     `NARROW: …`), the first commit, the merge.
//
// The steps are claim → PR → CI → Gate → merge. The claim is the first wave-started that names the
// Ticket; without Autopilot, the first commit of its PR (the claim date of the Status has no time).
// Gate is the last VERIFIED comment. CI is green at the last successful workflow run of the branch
// that finished before the Gate (a rebase before the merge reruns CI after it); without the runs,
// when every check of the PR's latest commit succeeded or was skipped, at the time the last one
// finished. Green → merge (the owner's Q1, worfy-throughput 14) runs from the later of the last
// VERIFIED and a green CI on the PR head (its `ci-ok`, else its check runs) to the merge; its budget
// (Q2) is 15 min, 30 min when the PR's diff has UI (UI_FILE). A step without data is an empty cell with
// the reason, never zero. The report holds Ticket numbers, PR numbers and times only: no text of a
// journal line, a comment or a transcript, and no path.
//
// It writes nothing but the --out file, and refuses an --out inside the journals, the worfy data
// folder, the Project or ~/.claude (ADR-0005). The script runs without the app and cannot import
// its TypeScript: the reading of journal lines and of PR data is the app's own, the plain modules
// src/shared/flight-recorder/journal-walk.mjs and pr-facts.mjs; this script reads the files, asks gh,
// counts the steps and the budget and writes the report. test/unit/critical-path.test.ts keeps
// JOURNAL_KINDS in step with JOURNAL_EVENT_KINDS of the journal format.
import { execFile } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, posix, relative, resolve, win32 } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { JOURNAL_KINDS, parseJournal, time, walkJournals } from '../src/shared/flight-recorder/journal-walk.mjs'
import { GH_FIELDS, GH_RUN_FIELDS, ciMark, firstCommit, headCi, headMarks, pick, verdicts } from '../src/shared/flight-recorder/pr-facts.mjs'

const HELP = `usage: node scripts/critical-path.mjs [options]

How long each Ticket waited on each step: claim → PR → CI → Gate → merge, plus the
Limits wait, the rework rounds and the stops of the Autopilot run. Reads only.

Input
  --journals <folder>  the Autopilot run journals (*.jsonl). Default: <data>/autopilot, where
                       <data> is WORFY_DATA_DIR when it is set, else
                       the app's data folder: ~/Library/Application Support/worfy on macOS,
                       %APPDATA%\\worfy on Windows.
  --root <folder>      the Project's repository: the Status of .scratch/<epic>/issues/NN-*.md
                       gives the PR number and Tickets done without Autopilot. Optional.
  --epic <name>        one Epic. Default: every Epic the journals name.
  --tickets <list>     only these Tickets, "01,02" (the summary then covers a Wave).
  --prs <file>         PR data as a JSON array of gh's fields (number, headRefName, state,
                       createdAt, mergedAt, statusCheckRollup, comments, commits, files) instead of gh;
                       an optional "ciRuns" of a PR is gh run list's (status, conclusion,
                       event, updatedAt) for its branch.
  --repo <owner/repo>  the repository gh asks. Default: origin of the run (run-started), else
                       the repository of --root or of the current folder.

Output
  Markdown (default) or CSV (--csv): a table per Epic — one row per Ticket, a cell per step,
  an empty cell is "—" with the reason — and the summary: the sum and the median of each step
  and the critical step by both. CSV durations are seconds; the rows "sum" and "median" of
  each Epic carry the summary.
  Green → merge: from the later of the last VERIFIED and a green CI on the PR head (ci-ok)
  to the merge. Budget: 15 min, 30 min when the PR's diff touches src/renderer .tsx, .css
  or UI texts. The summary names each Ticket over budget and where the time after green
  went: the gate (until the last review or check mark) or the merge queue.
  --csv                CSV instead of Markdown.
  --out <file>         write the report to this file instead of stdout. Refused inside the
                       journals, the worfy data folder, --root and ~/.claude.
  --help               this text.

Exit code: 0 the report was made; 2 wrong arguments or a refused --out; 1 the report could
not be written.`

/** Every kind of journal event, as JOURNAL_EVENT_KINDS of src/shared/autopilot/journal.ts. */
export { JOURNAL_KINDS }

const REFUSED = 2
const FAILED = 1
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const TICKET = /^[0-9]+$/
const GH_PARALLEL = 4
const NOT_RUN = 'not run by Autopilot (no wave-started)'

/** The steps of the critical path, in order: [key, title, from mark, to mark]. */
const STEPS = [
  ['claim_to_pr', 'claim → PR', 'start', 'pr'],
  ['pr_to_ci', 'PR → CI', 'pr', 'ci'],
  ['ci_to_gate', 'CI → Gate', 'ci', 'gate'],
  ['gate_to_merge', 'Gate → merge', 'gate', 'merge'],
]
const MARK_TITLES = { start: 'claim', pr: 'PR', ci: 'CI', gate: 'Gate', green: 'green', merge: 'merge' }

/** The budget of Green → merge (owner's Q2, worfy-throughput 14): 15 min for a Ticket without UI, 30 min with UI. */
const BUDGET_MS = { noUi: 15 * 60_000, ui: 30 * 60_000 }
/**
 * A file whose change makes a Ticket one "with UI" (owner's answer Q8): `.tsx` and `.css` under
 * src/renderer, the renderer's index.html and the renderer's modules of UI texts.
 * shortcut: UI texts are found by the module's name (hints, notice, *-text, labels, strings, copy,
 * messages), so a text changed inside another renderer `.ts` file is not seen; redo when the
 * project keeps its UI texts in named files or the owner lists them.
 */
const UI_FILE = /^src\/renderer\/(?:.+\.(?:tsx|css)|index\.html|(?:.+\/)?(?:[^/]*[-.])?(?:text|texts|hints|notice|labels?|strings|copy|messages)\.ts)$/

/**
 * The journals folder: WORFY_DATA_DIR/autopilot when it is set, else that of the app's data folder on
 * this system (the same rules as dataRoot in src/main/storage/paths.ts).
 */
export function journalsFolder(env = process.env, home = homedir(), platform = process.platform) {
  return join(dataFolder(env, home, platform), 'autopilot')
}

/** isWindowsAbsolutePath of src/shared/paths.ts, copied from scripts/statusline-bridge.mjs: `C:\…`, `C:/…` or UNC, not `\x` nor `/x`. */
const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/

function dataFolder(env, home, platform = process.platform) {
  if (env.WORFY_DATA_DIR) return resolve(env.WORFY_DATA_DIR)
  if (platform === 'win32') {
    const appData = env.APPDATA !== undefined && WINDOWS_ABSOLUTE.test(env.APPDATA) ? env.APPDATA : win32.join(home, 'AppData', 'Roaming')
    return win32.join(appData, 'worfy')
  }
  return posix.join(home, 'Library', 'Application Support', 'worfy')
}

/** The default journals folder and the worfy data folder of the system `deps` describes: its env, home and platform. */
export function defaultFolders(deps) {
  return { journals: journalsFolder(deps.env, deps.home, deps.platform), data: dataFolder(deps.env, deps.home, deps.platform) }
}

/** Options from the arguments; throws with the reason when they are wrong. */
function parseArgs(args) {
  const options = { csv: false, help: false }
  const valued = { '--journals': 'journals', '--root': 'root', '--epic': 'epic', '--tickets': 'tickets', '--prs': 'prs', '--repo': 'repo', '--out': 'out' }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--csv') options.csv = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg in valued) {
      const value = args[++i]
      if (value === undefined || value === '') throw new Error(`${arg} needs a value`)
      options[valued[arg]] = value
    } else throw new Error(`unknown argument: ${arg}`)
  }
  if (options.epic !== undefined && !NAME.test(options.epic)) throw new Error(`not an Epic name: ${options.epic}`)
  if (options.tickets !== undefined) {
    options.tickets = new Set(options.tickets.split(',').map((t) => t.trim()).filter(Boolean))
    for (const ticket of options.tickets) if (!TICKET.test(ticket)) throw new Error(`not a Ticket number: ${ticket}`)
  }
  if (options.repo !== undefined && !/^[\w.-]+(\/[\w.-]+){1,2}$/.test(options.repo)) throw new Error(`not a repository: ${options.repo}`)
  return options
}

/** Every journal of the folder, read in name order; a line that does not fit is skipped and counted. */
function readJournals(dir) {
  const journal = { found: existsSync(dir), files: [], lines: 0, notJson: 0, unknownKind: 0, badFields: 0 }
  if (!journal.found) return journal
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
  for (const name of names) {
    const { events, ...counts } = parseJournal(readFileSync(join(dir, name), 'utf8'))
    for (const key of ['lines', 'notJson', 'unknownKind', 'badFields']) journal[key] += counts[key]
    journal.files.push(events)
  }
  return journal
}

/**
 * The Status of each Ticket file of an Epic under a Project root: state, date, PR number. Only the header
 * format bin/ticket writes is read: the first `Status:` line, and `PR: #N` above the first `## ` heading
 * (a `PR: <url>` line of the result section is not the Ticket's PR). An old Status line gives no state.
 */
function readTicketFiles(root, epic) {
  const files = new Map()
  if (root === undefined || !NAME.test(epic)) return files
  const dir = join(root, '.scratch', epic, 'issues')
  if (!existsSync(dir)) return files
  for (const name of readdirSync(dir).sort()) {
    const num = /^([0-9]+)-.*\.md$/.exec(name)?.[1]
    if (num === undefined) continue
    const text = readFileSync(join(dir, name), 'utf8')
    const line = /^Status:.*$/m.exec(text)?.[0] ?? ''
    const status = /^Status: (open|claimed|blocked|done)(?: (\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}Z)?)?[ \t]*\r?$/.exec(line)
    const header = text.split(/^## /m)[0] ?? ''
    files.set(num, {
      state: status?.[1] ?? '',
      date: status?.[2] ?? null,
      pr: Number(/^PR: #(\d+)[ \t]*\r?$/m.exec(header)?.[1]) || null,
    })
  }
  return files
}

const byNumber = (a, b) => Number(a) - Number(b) || a.localeCompare(b)

/** The Tickets to report, grouped by Epic in name order. */
function chooseTickets(options, walked, root) {
  const epics = options.epic !== undefined ? [options.epic] : [...new Set([...walked.tickets.keys()].map((key) => key.slice(0, key.lastIndexOf('/'))))].sort()
  return epics.map((epic) => {
    const files = readTicketFiles(root, epic)
    const fromJournal = [...walked.tickets.keys()].filter((key) => key.startsWith(`${epic}/`)).map((key) => key.slice(epic.length + 1))
    const nums = [...new Set([...fromJournal, ...files.keys()])].filter((num) => options.tickets?.has(num) ?? true).sort(byNumber)
    return { epic, tickets: nums.map((num) => ({ epic, num, file: files.get(num) ?? null, journal: walked.tickets.get(`${epic}/${num}`) ?? null })) }
  })
}

/** A home folder in a text becomes `~`, so that gh's messages carry no personal path. */
function hideHome(text, home) {
  return home ? text.split(home).join('~') : text
}

/** The PR of each Ticket: { pr } or { why }. From the --prs file, or from gh. */
async function loadPrs(groups, options, deps, walked, root) {
  const found = new Map()
  const all = groups.flatMap((group) => group.tickets)
  if (options.prs !== undefined) {
    const list = options.prsData
    for (const ticket of all) {
      const branch = `${ticket.epic}/${ticket.num}`
      const pr = pick(ticket.file?.pr ? list.filter((p) => p.number === ticket.file.pr) : list.filter((p) => p.headRefName === branch))
      found.set(branch, pr ? { pr } : { why: `no PR for ${branch} in the PR file` })
    }
    return found
  }
  let missing = false
  const queue = [...all]
  const worker = async () => {
    while (queue.length > 0) {
      const ticket = queue.shift()
      const branch = `${ticket.epic}/${ticket.num}`
      if (missing) {
        found.set(branch, { why: 'gh not available' })
        continue
      }
      const repo = options.repo ?? walked.epics.get(ticket.epic)?.origin ?? null
      const where = repo ? ['--repo', repo] : []
      const number = ticket.file?.pr ?? null
      const args = number ? ['pr', 'view', String(number), ...where, '--json', GH_FIELDS] : ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '20', '--json', GH_FIELDS, ...where]
      const result = await deps.gh(args, root ?? deps.cwd)
      if (result.missing) {
        missing = true
        found.set(branch, { why: 'gh not available' })
        continue
      }
      if (result.code !== 0) {
        const first = (result.stderr || result.stdout || `exit code ${result.code}`).trim().split('\n')[0].slice(0, 160)
        found.set(branch, { why: `gh failed: ${hideHome(first, deps.home)}` })
        continue
      }
      let data
      try {
        data = JSON.parse(result.stdout)
      } catch {
        found.set(branch, { why: 'gh gave no JSON' })
        continue
      }
      const pr = pick(Array.isArray(data) ? data : [data])
      if (pr === null) {
        found.set(branch, { why: `no PR with the branch ${branch}` })
        continue
      }
      // The checks of a PR are only those of its latest commit, rerun after the last rebase; the
      // runs of its branch tell when CI was green before the Gate. Without them, the checks do.
      if (typeof pr.headRefName === 'string' && pr.headRefName !== '') {
        const runs = await deps.gh(['run', 'list', '--branch', pr.headRefName, '--limit', '100', '--json', GH_RUN_FIELDS, ...where], root ?? deps.cwd)
        try {
          if (runs.code === 0) pr.ciRuns = JSON.parse(runs.stdout)
        } catch {
          // No history: the checks of the PR stand for CI.
        }
      }
      found.set(branch, { pr })
    }
  }
  await Promise.all(Array.from({ length: GH_PARALLEL }, worker))
  return found
}

/**
 * "Checks green" of the owner's Q1: the later of the last VERIFIED and a green CI on the PR head.
 * A push after the VERIFIED (a CI fix) moves it to that head's green CI. { at, by } or { why }.
 */
function greenMark(pr, gate) {
  if (gate === null) return { why: 'no VERIFIED comment on the PR' }
  const ci = headCi(pr)
  if (ci.why !== undefined) return ci
  return ci.at !== null && ci.at > gate ? { at: ci.at, by: 'CI' } : { at: gate, by: 'Gate' }
}

/** Whether the PR's diff makes the Ticket one with UI; null without the PR's file list. */
function withUi(pr) {
  if (!Array.isArray(pr.files)) return null
  return pr.files.some((file) => UI_FILE.test(typeof file === 'string' ? file : String(file?.path ?? '')))
}

/**
 * Green → merge against its budget, and where the time after green went: until the last merge mark
 * of the head (`review`, `check/windows`) — the gate — and from it to the merge — the merge queue.
 */
function budgetOf(pr, marks, step) {
  const ui = pr ? withUi(pr) : null
  const budget = { ui, ms: ui === null ? null : ui ? BUDGET_MS.ui : BUDGET_MS.noUi }
  if (step.ms === undefined) return { ...budget, why: step.why }
  if (ui === null) return { ...budget, why: 'no file list of the PR' }
  const green = marks.green.at
  const merge = marks.merge.at
  let lastMark = green
  for (const mark of headMarks(pr)) if (mark.at !== null && mark.at > lastMark && mark.at <= merge) lastMark = mark.at
  const gate = lastMark - green
  const queue = merge - lastMark
  const over = step.ms > budget.ms
  return { ...budget, over, gate, queue, step: over ? (gate > queue ? 'gate' : 'merge queue') : null }
}

/** One Ticket's marks, steps and counts. */
function measure(ticket, prData) {
  const { journal, file } = ticket
  const pr = prData?.pr ?? null
  const prWhy = prData?.why ?? 'no PR data'
  const marks = {}
  let source = ''
  if (journal?.start != null) {
    marks.start = { at: journal.start }
    source = 'wave-started'
  } else if (pr && firstCommit(pr) !== null) {
    marks.start = { at: firstCommit(pr) }
    source = 'first commit'
  } else if (file?.date) marks.start = { why: `claim date only (${file.date}), no time` }
  else marks.start = { why: 'no wave-started, no PR commits, no claim date' }
  const found = pr ? verdicts(pr) : null
  if (pr) {
    marks.pr = time(pr.createdAt) !== null ? { at: time(pr.createdAt) } : { why: 'no opening time on the PR' }
    marks.gate = found.gate !== null ? { at: found.gate } : { why: 'no VERIFIED comment on the PR' }
    marks.ci = ciMark(pr, found.gate)
    marks.green = greenMark(pr, found.gate)
    marks.merge = time(pr.mergedAt) !== null ? { at: time(pr.mergedAt) } : { why: `PR not merged (${pr.state ?? 'unknown'})` }
  } else for (const mark of ['pr', 'ci', 'gate', 'green', 'merge']) marks[mark] = { why: prWhy }
  const span = (from, to) => {
    const a = marks[from]
    const b = marks[to]
    if (a.at === undefined) return { why: a.why }
    if (b.at === undefined) return { why: b.why }
    if (b.at < a.at) return { why: `out of order: ${MARK_TITLES[to]} before ${MARK_TITLES[from]}` }
    return { ms: b.at - a.at }
  }
  const steps = Object.fromEntries(STEPS.map(([key, , from, to]) => [key, span(from, to)]))
  steps.total = span('start', 'merge')
  steps.green_to_merge = span('green', 'merge')
  const budget = budgetOf(pr, marks, steps.green_to_merge)
  if (journal === null) steps.limits_wait = { why: NOT_RUN }
  else if (journal.openWait) steps.limits_wait = { why: 'a wait has no end in the journal' }
  else steps.limits_wait = { ms: journal.wait }
  const rework = found ? { n: found.rejected } : { why: prWhy }
  let narrow
  if (found) narrow = { n: found.narrow }
  else if (journal !== null) narrow = { n: journal.narrow.started }
  else narrow = { why: prWhy }
  const stops = journal === null ? { why: NOT_RUN } : { n: journal.stops.length, reasons: journal.stops }
  return { ticket, pr, start: marks.start.at ?? null, startWhy: marks.start.why, source, steps, greenBy: marks.green.by ?? null, budget, rework, narrow, stops }
}

const COLUMNS = [...STEPS.map(([key, title]) => [key, title]), ['total', 'Total'], ['limits_wait', 'Limits wait'], ['green_to_merge', 'Green → merge']]

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Sum and median of each step over the rows that have it. */
function summarize(rows) {
  return Object.fromEntries(
    COLUMNS.map(([key]) => {
      const values = rows.map((row) => row.steps[key].ms).filter((ms) => ms !== undefined)
      return [key, { count: values.length, sum: values.length ? values.reduce((a, b) => a + b, 0) : null, median: values.length ? median(values) : null }]
    }),
  )
}

/** The step of the four with the largest value of `by`, or null. */
function critical(summary, by) {
  let best = null
  for (const [key, title] of STEPS) if (summary[key][by] !== null && (best === null || summary[key][by] > best.value)) best = { title, value: summary[key][by] }
  return best
}

function human(ms) {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`
}

const clock = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`
const cellText = (text) => String(text).replace(/\|/g, '/').replace(/\s+/g, ' ')
const empty = (why) => `— (${cellText(why)})`

function count(value) {
  if (value.why !== undefined) return empty(value.why)
  return value.reasons?.length ? `${value.n} (${value.reasons.join('; ')})` : String(value.n)
}

const uiText = (ui) => (ui ? 'UI' : 'no UI')

function budgetCell(budget) {
  if (budget.over === undefined) return empty(budget.why)
  return `${budget.over ? 'over' : 'in'} (budget ${human(budget.ms)}, ${uiText(budget.ui)})`
}

/** The Tickets over the budget of Green → merge: number, PR, time, budget and where the time after green went. */
function overBudgetLines(rows) {
  const known = rows.filter((row) => row.budget.over !== undefined)
  const over = known.filter((row) => row.budget.over)
  const lines = [
    `Over budget: ${over.length} of ${known.length} Tickets with data (Green → merge over ${human(BUDGET_MS.noUi)} without UI, over ${human(BUDGET_MS.ui)} with UI).`,
  ]
  for (const { ticket, pr, steps, greenBy, budget } of over) {
    lines.push(
      `- ${ticket.num}, PR #${pr.number}: ${human(steps.green_to_merge.ms)}, budget ${human(budget.ms)} (${uiText(budget.ui)}); green by ${greenBy}; after green: gate ${human(budget.gate)}, merge queue ${human(budget.queue)} — most went to ${budget.step}.`,
    )
  }
  return lines
}

function sourcesLine(journal, options) {
  const files = journal.found ? `${journal.files.length} files` : 'no journals folder (0 files)'
  const skipped = journal.notJson + journal.unknownKind + journal.badFields
  const prs = options.prs !== undefined ? `the PR file (${options.prsData.length} PRs)` : 'gh'
  return [
    `Journals: ${files}, ${journal.lines} lines read; skipped ${skipped} (not JSON ${journal.notJson}, unknown kind ${journal.unknownKind}, fields do not match ${journal.badFields}).`,
    `PR data: ${prs}. Times are UTC. An empty cell is "—" with the reason: no data is not zero.`,
  ]
}

function toMarkdown(groups, walked, journal, options) {
  const lines = ['# Critical path of Tickets', '', ...sourcesLine(journal, options), '']
  if (groups.every((group) => group.rows.length === 0)) lines.push('No Tickets found.', '')
  for (const { epic, rows } of groups) {
    if (rows.length === 0) continue
    lines.push(`## ${epic}`, '')
    lines.push(`| Ticket | Status | PR | Start | ${COLUMNS.map(([, title]) => title).join(' | ')} | Budget | Rework rounds | Narrow rounds | Stops |`)
    lines.push(`|${' --- |'.repeat(COLUMNS.length + 8)}`)
    for (const row of rows) {
      const start = row.start !== null ? `${clock(row.start)} (${row.source})` : empty(row.startWhy)
      const steps = COLUMNS.map(([key]) => (row.steps[key].ms !== undefined ? human(row.steps[key].ms) : empty(row.steps[key].why)))
      const pr = row.pr ? `#${row.pr.number}` : '—'
      lines.push(`| ${row.ticket.num} | ${row.ticket.file?.state || '—'} | ${pr} | ${start} | ${steps.join(' | ')} | ${budgetCell(row.budget)} | ${count(row.rework)} | ${count(row.narrow)} | ${count(row.stops)} |`)
    }
    const summary = summarize(rows)
    lines.push('', `Summary of ${rows.length} Tickets:`, '', '| Step | Tickets with data | Sum | Median |', '| --- | --- | --- | --- |')
    for (const [key, title] of COLUMNS) {
      const { count: n, sum, median: mid } = summary[key]
      lines.push(`| ${title} | ${n} of ${rows.length} | ${sum === null ? '—' : human(sum)} | ${mid === null ? '—' : human(mid)} |`)
    }
    const bySum = critical(summary, 'sum')
    const byMedian = critical(summary, 'median')
    lines.push('')
    if (bySum === null) lines.push('Critical step: no step has data.')
    else lines.push(`Critical step: by sum — ${bySum.title} (${human(bySum.value)}); by median — ${byMedian.title} (${human(byMedian.value)}).`)
    lines.push(...overBudgetLines(rows))
    const total = (pick) => rows.reduce((n, row) => n + (pick(row).n ?? 0), 0)
    lines.push(
      `Limits wait in the runs of this Epic: ${human(walked.epics.get(epic)?.wait ?? 0)}${walked.epics.get(epic)?.openWait ? ' and a wait with no end in the journal' : ''}. Rework rounds: ${total((r) => r.rework)}. Narrow rounds: ${total((r) => r.narrow)}. Stops: ${total((r) => r.stops)}.`,
      '',
    )
  }
  return lines.join('\n')
}

const CSV_HEADER = [
  'epic',
  'ticket',
  'status',
  'pr',
  'start',
  'start_source',
  ...COLUMNS.flatMap(([key]) => [`${key}_s`, `${key}_why`]),
  'green_by',
  'ui',
  'budget_s',
  'over_budget',
  'budget_why',
  'after_green_gate_s',
  'after_green_queue_s',
  'over_budget_step',
  'rework_rounds',
  'rework_why',
  'narrow_rounds',
  'narrow_why',
  'stops',
  'stops_why',
  'stop_reasons',
]

const csvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
const seconds = (ms) => (ms === null || ms === undefined ? '' : String(Math.round(ms / 1000)))

function toCsv(groups) {
  const lines = [CSV_HEADER.join(',')]
  const line = (cells) => lines.push(CSV_HEADER.map((name) => csvCell(cells[name])).join(','))
  for (const { epic, rows } of groups) {
    for (const row of rows) {
      const cells = {
        epic,
        ticket: row.ticket.num,
        status: row.ticket.file?.state ?? '',
        pr: row.pr?.number ?? '',
        start: row.start !== null ? new Date(row.start).toISOString() : '',
        start_source: row.source,
        green_by: row.greenBy,
        ui: row.budget.ui === null ? '' : row.budget.ui ? 'yes' : 'no',
        budget_s: seconds(row.budget.ms),
        over_budget: row.budget.over === undefined ? '' : row.budget.over ? 'yes' : 'no',
        budget_why: row.budget.why,
        after_green_gate_s: seconds(row.budget.gate),
        after_green_queue_s: seconds(row.budget.queue),
        over_budget_step: row.budget.step,
        rework_rounds: row.rework.n,
        rework_why: row.rework.why,
        narrow_rounds: row.narrow.n,
        narrow_why: row.narrow.why,
        stops: row.stops.n,
        stops_why: row.stops.why,
        stop_reasons: row.stops.reasons?.join('; '),
      }
      for (const [key] of COLUMNS) {
        cells[`${key}_s`] = seconds(row.steps[key].ms)
        cells[`${key}_why`] = row.steps[key].why
      }
      line(cells)
    }
    if (rows.length === 0) continue
    const summary = summarize(rows)
    for (const by of ['sum', 'median']) {
      const cells = { epic, ticket: by }
      for (const [key] of COLUMNS) cells[`${key}_s`] = seconds(summary[key][by])
      line(cells)
    }
  }
  return `${lines.join('\n')}\n`
}

/** Symbolic links followed at most, as the system's own limit on a path. */
const MAX_LINKS = 40

/**
 * A path with every existing part resolved through links and spelled as on disk, so that two names
 * of one folder compare equal: `realpathSync.native` gives the case the disk has (on the
 * case-insensitive file systems of macOS and Windows `~/.CLAUDE` is `~/.claude`), the JavaScript
 * `realpathSync` keeps the case as typed. A link whose target does not exist yet is followed too:
 * writing to it creates the target.
 */
function canonical(path, links = 0) {
  const full = resolve(path)
  let stat = null
  try {
    stat = lstatSync(full)
  } catch {
    // Not there: resolve the parent and keep the name.
  }
  if (stat !== null && (!stat.isSymbolicLink() || existsSync(full))) return realpathSync.native(full)
  const parent = dirname(full)
  if (parent === full) return full
  const where = canonical(parent, links)
  if (stat === null || links >= MAX_LINKS) return join(where, basename(full))
  return canonical(resolve(where, readlinkSync(full)), links + 1)
}

function inside(path, dir) {
  const rel = relative(canonical(dir), canonical(path))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Runs the report over `deps` (the real system by default) and returns the exit code. The tests
 * pass a faked gh.
 */
export async function criticalPath(args, deps = systemDeps()) {
  let options
  try {
    options = parseArgs(args)
  } catch (error) {
    deps.err(`critical-path: ${error.message}`)
    deps.err('usage: node scripts/critical-path.mjs [--journals <folder>] [--root <folder>] [--epic <name>] [--tickets 01,02] [--prs <file>] [--repo <owner/repo>] [--csv] [--out <file>] | --help')
    return REFUSED
  }
  if (options.help) {
    deps.out(`${HELP}\n`)
    return 0
  }
  const folders = defaultFolders(deps)
  const journals = options.journals !== undefined ? resolve(deps.cwd, options.journals) : folders.journals
  if (options.journals !== undefined && !isFolder(journals)) {
    deps.err(`critical-path: no journals folder: ${options.journals}`)
    return REFUSED
  }
  const root = options.root !== undefined ? resolve(deps.cwd, options.root) : undefined
  if (root !== undefined && !isFolder(root)) {
    deps.err(`critical-path: no Project folder: ${options.root}`)
    return REFUSED
  }
  if (options.prs !== undefined) {
    try {
      options.prsData = JSON.parse(readFileSync(resolve(deps.cwd, options.prs), 'utf8'))
      if (!Array.isArray(options.prsData)) throw new Error('not a JSON array')
    } catch (error) {
      deps.err(`critical-path: cannot read the PR file ${options.prs}: ${error.message}`)
      return REFUSED
    }
  }
  const out = options.out !== undefined ? resolve(deps.cwd, options.out) : undefined
  if (out !== undefined) {
    const claude = deps.env.CLAUDE_CONFIG_DIR ? resolve(deps.env.CLAUDE_CONFIG_DIR) : join(deps.home, '.claude')
    const guarded = [journals, folders.data, claude, ...(root !== undefined ? [root] : [])]
    if (guarded.some((dir) => inside(out, dir))) {
      deps.err(`critical-path: refused --out ${options.out}: the report never goes into the journals, the worfy data folder, the Project or ~/.claude`)
      return REFUSED
    }
  }

  const journal = readJournals(journals)
  const walked = walkJournals(journal.files)
  const groups = chooseTickets(options, walked, root)
  const prs = await loadPrs(groups, options, deps, walked, root)
  const measured = groups.map(({ epic, tickets }) => ({ epic, rows: tickets.map((ticket) => measure(ticket, prs.get(`${ticket.epic}/${ticket.num}`))) }))
  const text = options.csv ? toCsv(measured) : toMarkdown(measured, walked, journal, options)
  if (out === undefined) {
    deps.out(text)
    return 0
  }
  try {
    writeFileSync(out, text)
  } catch (error) {
    deps.err(`critical-path: cannot write ${options.out}: ${error.message}`)
    return FAILED
  }
  return 0
}

function isFolder(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** The real system: the process's environment and folders, gh on PATH, stdout and stderr. */
export function systemDeps() {
  return {
    env: process.env,
    home: homedir(),
    platform: process.platform,
    cwd: process.cwd(),
    gh: (args, cwd) =>
      new Promise((done) => {
        execFile(
          'gh',
          args,
          { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000, env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' } },
          (error, stdout, stderr) => {
            if (error?.code === 'ENOENT') done({ code: null, stdout: '', stderr: '', missing: true })
            else done({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr })
          },
        )
      }),
    out: (text) => process.stdout.write(text),
    err: (line) => process.stderr.write(`${line}\n`),
  }
}

function runAsScript() {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (runAsScript()) process.exitCode = await criticalPath(process.argv.slice(2))

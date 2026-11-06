// The changes of Ticket status for Work track, read from the git history of the Ticket files
// (worfy-work-track ticket 07; the spec's sections on the sources and the reading). A change of status outside a
// Run is written nowhere (ADR-0092), but git holds it: the history of main (almost all squash merges) and
// the remote branches not in main. Two `git log -p` calls over `.scratch/*/issues/*.md`:
//
// - main (`origin/main`; a repository without it — `HEAD`) from the start of the period;
// - the remote branches, `--remotes --not <main>`, from BRANCH_LOOKBACK_DAYS before it: a squash in the
//   period repeats changes its branch made before the period, and only the branch commit tells them apart.
//
// A change is a header `Status:` line whose state differs before and after a commit; a new Ticket file
// counts only when it is created already claimed or done. A change on main whose new value a branch also
// wrote is the same change: the branch one stays, with the PR number of the main commit. The time of a
// change: the value's own time (status-value.ts), else the branch commit (its author date, which a rebase
// keeps), else the main commit (its committer date, the moment of the merge).
//
// Only reading: git runs with GIT_OPTIONAL_LOCKS=0 and nothing else is started (ADR-0005).
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { TicketStatusState } from '../../shared/autopilot/journal'
import type { WorkFact } from '../../shared/work-track/facts'
import { parseStatusValue, statusInstant, statusLineValue } from '../../shared/work-track/status-value'

/** How far before the period the branches are read: a branch commit precedes its squash by hours or days. */
export const BRANCH_LOOKBACK_DAYS = 14
/** The longest a `git log` may run before it is stopped. */
export const GIT_LOG_TIMEOUT_MS = 60_000
/** A Status line further down a Ticket file than this is in its body, not its header. */
const HEADER_LINES = 15
const DAY_MS = 86_400_000

const MAIN_REF = 'origin/main'
const PATHSPEC = '.scratch/*/issues/*.md'
const TICKET_PATH = /^\.scratch\/([^/]+)\/issues\/(\d+)(?:-[^/]*)?\.md$/
// A commit line of the log: a record separator, then the fields by tabs; the subject last.
const COMMIT_MARK = '\x1e'
const FORMAT = `--format=${COMMIT_MARK}%H%x09%cI%x09%aI%x09%s`

export interface ReadTicketStatusOptions {
  /** The top folder of the Project's repository. */
  repo: string
  /** The start of the period, ISO. */
  since: string
  /** The end of the period, ISO, not included; absent — up to now. */
  until?: string
  /** The git program; `git` on the PATH by default. */
  git?: string
  timeoutMs?: number
}

/** Where the time of a change comes from, the best first. */
export type ChangeTimeSource = 'value' | 'branch-commit' | 'main-commit'

export interface TicketStatusChange {
  epic: string
  /** The number as the file name writes it: `07`. */
  ticket: string
  /** `null`: the Ticket file was created with this status. */
  from: TicketStatusState | null
  to: TicketStatusState
  /** ISO in UTC. */
  at: string
  timeFrom: ChangeTimeSource
  /** The commit that made the change: on a branch when a branch holds it. */
  commit: string
  /** The PR of the main commit that brought the change, from its subject's `(#N)`. */
  pr?: number
}

/** One change as a commit's diff shows it, before the branches and main are matched. */
interface RawChange {
  epic: string
  ticket: string
  from: TicketStatusState | null
  to: TicketStatusState
  /** The new value as written: what matches a main change to its branch change. */
  toValue: string
  at: string
  timeFrom: ChangeTimeSource
  commit: string
  pr?: number
}

/** The changes of Ticket status in the period, oldest first. Rejects when git fails. */
export async function readTicketStatusChanges(options: ReadTicketStatusOptions): Promise<TicketStatusChange[]> {
  const since = Date.parse(options.since)
  const until = options.until === undefined ? Infinity : Date.parse(options.until)
  const main = await mainRef(options)
  if (main === null) return []
  const branchSince = new Date(since - BRANCH_LOOKBACK_DAYS * DAY_MS).toISOString()
  const [onMain, onBranches] = await Promise.all([
    readLog(options, [`--since=${new Date(since).toISOString()}`, main], 'main'),
    readLog(options, [`--since=${branchSince}`, '--remotes', '--not', main], 'branch'),
  ])

  // The same change on several branches (a branch rebased and pushed under another name) counts once.
  const branchByValue = new Map<string, RawChange>()
  for (const change of onBranches) {
    const key = valueKey(change)
    const seen = branchByValue.get(key)
    if (seen === undefined || Date.parse(change.at) < Date.parse(seen.at)) branchByValue.set(key, change)
  }
  const changes: RawChange[] = [...branchByValue.values()]
  for (const change of onMain) {
    const twin = branchByValue.get(valueKey(change))
    if (twin === undefined) changes.push(change)
    else if (twin.pr === undefined && change.pr !== undefined) twin.pr = change.pr
  }

  return changes
    .filter((c) => Date.parse(c.at) >= since && Date.parse(c.at) < until)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.commit.localeCompare(b.commit) || a.ticket.localeCompare(b.ticket))
    .map(publicChange)
}

/** The changes of Ticket status in the period as Work track facts: moments of the `git` source. */
export async function readTicketStatusFacts(options: ReadTicketStatusOptions): Promise<WorkFact[]> {
  return (await readTicketStatusChanges(options)).map(ticketStatusFact)
}

export function ticketStatusFact(change: TicketStatusChange): WorkFact {
  return {
    id: `ticket-status:${change.commit}:${change.epic}/${change.ticket}`,
    kind: 'ticket-status',
    start: change.at,
    end: change.at,
    outcome: change.to === 'blocked' ? 'blocked' : 'ok',
    session: null,
    epic: change.epic,
    ticket: change.ticket,
    ...(change.pr !== undefined ? { pr: change.pr } : {}),
    source: 'git',
    title: `${change.ticket} ${change.from ?? 'new'} → ${change.to}`,
  }
}

function publicChange(change: RawChange): TicketStatusChange {
  const { epic, ticket, from, to, at, timeFrom, commit, pr } = change
  return { epic, ticket, from, to, at, timeFrom, commit, ...(pr !== undefined ? { pr } : {}) }
}

function valueKey(change: RawChange): string {
  return `${change.epic}\n${change.ticket}\n${change.toValue}`
}

/** `origin/main`, else `HEAD`; null for a repository with no commit. Rejects outside a repository. */
async function mainRef(options: ReadTicketStatusOptions): Promise<string | null> {
  for (const ref of [MAIN_REF, 'HEAD']) {
    const lines = await runGit(options, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], () => undefined, true)
    if (lines === 0) return ref
  }
  await runGit(options, ['rev-parse', '--git-dir'], () => undefined)
  return null
}

interface Commit {
  sha: string
  committed: string
  authored: string
  pr?: number
}

/** One file of a commit's diff: the first header Status line on each side. */
interface FileDiff {
  path: string | null
  created: boolean
  /** Past the first `@@` line: the lines are the hunks', not the file header's. */
  inHunk: boolean
  oldLine: number
  newLine: number
  from: string | null
  to: string | null
}

async function readLog(options: ReadTicketStatusOptions, args: string[], side: 'main' | 'branch'): Promise<RawChange[]> {
  const changes: RawChange[] = []
  let commit: Commit | null = null
  let file: FileDiff | null = null

  const closeFile = (): void => {
    if (commit !== null && file !== null) {
      const change = changeOf(commit, file, side)
      if (change !== null) changes.push(change)
    }
    file = null
  }

  const onLine = (line: string): void => {
    if (line.startsWith(COMMIT_MARK)) {
      closeFile()
      const [sha = '', committed = '', authored = '', ...subject] = line.slice(1).split('\t')
      const pr = /\(#(\d+)\)\s*$/.exec(subject.join('\t'))
      commit = { sha, committed, authored, ...(pr ? { pr: Number(pr[1]) } : {}) }
      return
    }
    if (line.startsWith('diff --git ')) {
      closeFile()
      file = { path: null, created: false, inHunk: false, oldLine: 0, newLine: 0, from: null, to: null }
      return
    }
    if (file === null) return
    const f: FileDiff = file
    if (line.startsWith('@@ ')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      f.inHunk = true
      f.oldLine = m ? Number(m[1]) : Infinity
      f.newLine = m ? Number(m[2]) : Infinity
    } else if (!f.inHunk) {
      if (line.startsWith('new file mode')) f.created = true
      else if (line.startsWith('+++ ')) f.path = line === '+++ /dev/null' ? null : line.slice('+++ b/'.length)
    } else if (line.startsWith('-')) {
      // With --unified=0 the old start of a hunk that removes lines is its first removed line.
      if (f.from === null && f.oldLine <= HEADER_LINES) f.from = statusLineValue(line.slice(1))
      f.oldLine++
    } else if (line.startsWith('+')) {
      if (f.to === null && f.newLine <= HEADER_LINES) f.to = statusLineValue(line.slice(1))
      f.newLine++
    }
  }

  await runGit(
    options,
    [
      '-c',
      'core.quotepath=false',
      'log',
      '-p',
      '--unified=0',
      '--no-merges',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      FORMAT,
      ...args,
      '--',
      PATHSPEC,
    ],
    onLine,
  )
  closeFile()
  return changes
}

function changeOf(commit: Commit, file: FileDiff, side: 'main' | 'branch'): RawChange | null {
  const where = file.path === null ? null : TICKET_PATH.exec(file.path)
  if (where === null || file.to === null) return null
  const to = parseStatusValue(file.to)
  if (to === null) return null
  const from = file.created ? null : file.from === null ? null : parseStatusValue(file.from)
  if (file.created ? to.state !== 'claimed' && to.state !== 'done' : from === null || from.state === to.state) return null

  const commitDate = side === 'branch' ? commit.authored : commit.committed
  const fromValue = statusInstant(to.time, commit.authored)
  const at = fromValue ?? new Date(commitDate).toISOString()
  const [, epic = '', ticket = ''] = where
  return {
    epic,
    ticket,
    from: from === null ? null : from.state,
    to: to.state,
    toValue: file.to.trim(),
    at,
    timeFrom: fromValue !== null ? 'value' : side === 'branch' ? 'branch-commit' : 'main-commit',
    commit: commit.sha,
    ...(side === 'main' && commit.pr !== undefined ? { pr: commit.pr } : {}),
  }
}

/**
 * Runs git in the repository and hands each line of its output to `onLine`. Resolves with the exit
 * code when `anyExit`, else rejects on a code other than 0 with git's message.
 */
function runGit(options: ReadTicketStatusOptions, args: string[], onLine: (line: string) => void, anyExit = false): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.git ?? 'git', args, {
      cwd: options.repo,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stderr = ''
    let failed: Error | null = null
    const timer = setTimeout(() => {
      failed = new Error(`git ${args.find((a) => !a.startsWith('-') && !a.includes('=')) ?? ''} did not finish in ${options.timeoutMs ?? GIT_LOG_TIMEOUT_MS} ms`)
      child.kill()
    }, options.timeoutMs ?? GIT_LOG_TIMEOUT_MS)
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 4096) stderr += chunk
    })
    // Done when both the process and the reader of its output are closed: every line is handed over
    // before the result.
    let open = 2
    let code: number | null = null
    const finish = (): void => {
      if (--open > 0) return
      clearTimeout(timer)
      if (failed !== null) reject(failed)
      else if (anyExit || code === 0) resolve(code ?? -1)
      else reject(new Error(`git ${args.includes('log') ? 'log' : args[0]} exited with ${code}: ${stderr.trim()}`))
    }
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    lines.on('line', onLine)
    lines.on('close', finish)
    child.on('error', (error) => {
      failed = new Error(`git could not start: ${error.message}`)
    })
    child.on('close', (exit) => {
      code = exit
      finish()
    })
  })
}

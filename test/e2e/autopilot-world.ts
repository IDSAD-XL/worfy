// The world of an Autopilot e2e test on the fake agent (worfy-faults ticket 05): a Project in a
// temporary folder, the environment the built app runs it with, and the readers of what the Run left
// behind — the messages the Orchestrator got, the run journals, the gh calls and the Project's files.
// The same functions as inside test/e2e/autopilot.spec.ts; that spec keeps its own copies (moving the
// old tests onto this module is not part of the Epic: the spec's decisions without the owner, item 2).
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import type { TicketStatusState } from '../../src/shared/autopilot/journal'
import type { StatusWrite } from '../autopilot-invariants'
import { catScript } from '../harness-node'

export const PROJECT = 'demo-000000a4'
export const EPIC = 'demo'

/** The Epic: 01 and 02 ready, 03 after both. */
const TICKETS = [
  { num: 1, blocked: [] as number[] },
  { num: 2, blocked: [] as number[] },
  { num: 3, blocked: [1, 2] },
]
const nn = (num: number): string => String(num).padStart(2, '0')

/** The `state` of epic-status (WorkflowModel) and the journal's name of it. */
const JOURNAL_STATE: Record<EpicState, TicketStatusState> = { open: 'open', work: 'claimed', done: 'done', blocked: 'blocked' }
export type EpicState = 'open' | 'work' | 'done' | 'blocked'

/**
 * Runs git with an identity of its own and none of the test process's GIT_ variables. No auto maintenance: a commit
 * may start it detached, and its `.git/objects/maintenance.lock` comes and goes while the test reads the repository.
 */
export function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  const settings = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'maintenance.auto=false']
  return execFileSync('git', [...settings, ...args], { cwd, env, encoding: 'utf8' }).trim()
}

/** Every file under `dir` with its bytes (base64), by path; for "nothing was written there". */
export function files(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = join(entry.parentPath, entry.name)
    out[path.slice(dir.length + 1)] = readFileSync(path).toString('base64')
  }
  return out
}

/** The Ticket's file, from the Project's root. */
const ticketPath = (num: number): string => join('.scratch', EPIC, 'issues', `${nn(num)}-ticket-${num}.md`)

function ticketFile(num: number, blocked: readonly number[], status: string): string {
  const blockers = blocked.length ? blocked.map(nn).join(', ') : '—'
  return [`# ${nn(num)} — Ticket ${num}`, '', 'Type: task', `Status: ${status}`, `Blocked by: ${blockers}`, '', '## Где в коде', '', `- \`src/f${num}.ts\``, ''].join('\n')
}

export interface World {
  /** WORFY_DATA_DIR: the app's own state, kept across launches of one test. */
  dataDir: string
  /** WORFY_CLAUDE_HOME, with an epic-status that answers the Epic's Tickets. */
  claudeHome: string
  /** WORFY_AGENT_LOG: every message the fake agent got. */
  log: string
  /** The Project: a git repository with the Epic. */
  repo: string
  /** GH_STUB_DIR: the gh stub's answers (test/fixtures/gh/gh-stub.mjs). */
  gh: string
  /** GH_STUB_LOG: the arguments of every gh call. */
  ghLog: string
  /** Every file of the Project before the test, for I7. */
  projectBefore: Record<string, string>
  /** The environment of a launch on the fake agent with `script` (test/fixtures/agent-scripts). */
  env(script: string): Record<string, string>
}

/**
 * The Project in `scratch`: a git repository with the Epic, an epic-status that answers its Tickets
 * (the stub's answer, epic-status.json, is what the app reads; setStatus changes it), and worfy's
 * data folder with the Project, active.
 */
export function prepareWorld(scratch: string): World {
  const dataDir = join(scratch, 'data')
  const claudeHome = join(scratch, 'claude-home')
  const log = join(scratch, 'agent.jsonl')
  const repo = join(scratch, 'demo')
  const gh = join(scratch, 'gh')
  const ghLog = join(scratch, 'gh.jsonl')

  mkdirSync(join(repo, '.scratch', EPIC, 'issues'), { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# Demo epic\n')
  for (const { num, blocked } of TICKETS) writeFileSync(join(repo, ticketPath(num)), ticketFile(num, blocked, 'open'))
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')

  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: [{ epic: EPIC, hasSpec: true, hasMap: false }],
      tickets: TICKETS.map(({ num, blocked }) => ({
        epic: EPIC,
        num,
        slug: `ticket-${num}`,
        title: `${nn(num)} — Ticket ${num}`,
        statusRaw: 'open',
        state: 'open',
        blockedRaw: blocked.length ? blocked.map(nn).join(', ') : '—',
        blockedNums: blocked,
        blockedParsed: true,
      })),
    }),
  )
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)

  mkdirSync(gh, { recursive: true })
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: repo }], activeId: PROJECT }))
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 20, y: 20, zoom: 0.8 } }))

  return {
    dataDir,
    claudeHome,
    log,
    repo,
    gh,
    ghLog,
    projectBefore: files(repo),
    env: (script) => ({
      WORFY_DATA_DIR: dataDir,
      WORFY_CLAUDE_HOME: claudeHome,
      WORFY_AGENT_SCRIPT: script,
      WORFY_AGENT_LOG: log,
      GH_STUB_DIR: gh,
      GH_STUB_LOG: ghLog,
    }),
  }
}

/**
 * Changes a Ticket's status as the Orchestrator would: the stub's epic-status answer first, then the
 * `Status:` line of its file, whose change the app's workflow watch reports. Returns the write for I3
 * and I7.
 */
export function setStatus(world: World, num: number, state: EpicState): StatusWrite {
  const at = new Date().toISOString()
  const status = state === 'work' ? `claimed ${at.slice(0, 16)}Z` : state
  const answer = join(world.claudeHome, 'epic-status.json')
  const model = JSON.parse(readFileSync(answer, 'utf8')) as { tickets: { num: number; state: string; statusRaw: string }[] }
  for (const ticket of model.tickets) if (ticket.num === num) Object.assign(ticket, { state, statusRaw: status })
  writeFileSync(answer, JSON.stringify(model))
  const blocked = TICKETS.find((ticket) => ticket.num === num)?.blocked ?? []
  writeFileSync(join(world.repo, ticketPath(num)), ticketFile(num, blocked, status))
  return { at, file: ticketPath(num), ticket: nn(num), state: JOURNAL_STATE[state] }
}

/** The messages the fake agent got, in order. */
export function messages(log: string): string[] {
  if (!existsSync(log)) return []
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { kind: string; text?: string })
    .filter((call) => call.kind === 'message')
    .map((call) => call.text ?? '')
}

/** The text of each run journal in the data folder, oldest Run first (by the time of its first line). */
export function journals(dataDir: string): string[] {
  const dir = join(dataDir, 'autopilot')
  if (!existsSync(dir)) return []
  const startOf = (text: string): string => {
    try {
      return (JSON.parse(text.split('\n')[0] ?? '') as { at?: string }).at ?? ''
    } catch {
      return ''
    }
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => readFileSync(join(dir, name), 'utf8'))
    .sort((a, b) => startOf(a).localeCompare(startOf(b)))
}

/** The kinds of the readable lines of one journal text, with the Wave or the stop reason: `wave-started 1`, `run-stopped user-stop`. */
export function kindsOf(text: string): string[] {
  return text
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const event = JSON.parse(line) as { kind: string; reason?: string; wave?: number }
        return [[event.kind, event.wave ?? event.reason].filter((part) => part !== undefined).join(' ')]
      } catch {
        return []
      }
    })
}

/** The arguments of every gh call, in order (GH_STUB_LOG). */
export function ghCalls(world: World): string[][] {
  if (!existsSync(world.ghLog)) return []
  return readFileSync(world.ghLog, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[])
}

/** Lets the fake agent's held turn (`wait_release` "turn") go on. */
export const releaseTurn = (app: ElectronApplication): Promise<void> =>
  app.evaluate(() => (globalThis as unknown as { worfyFakeRelease: (name: string) => void }).worfyFakeRelease('turn'))

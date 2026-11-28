// The Health rows "Harness on Claude Code" (worfy-harness-guarantees ticket 09; spec, the solution, point 4): whether
// the Harness does its part on a Claude Code version — the contract set of ticket 08 (src/main/harness/contract/:
// the real binary against the stand-in Messages API, no model, no key, no sign-in) run with the Harness copy of this
// build, once on worfy's own copy of Claude Code (the SDK's binary, row `harness-claude`) and once on the terminal's
// (`claude` on the PATH of the login shell, row `harness-claude-terminal`).
//
// - The set runs once per pair of a Claude Code version and a Harness version (bundledHarnessVersion()). The answer
//   is kept in worfy's data folder (ADR-0005), <data>/harness-claude.json; a later check, a new start included, reads
//   it and runs nothing. A new version on either side is a new pair, so Claude Code updated in the terminal is
//   checked once, the next time Health checks. Both copies on one version share the run.
// - "Run again" (`again`) runs the set anew whatever the cache holds and keeps the new answer.
// - The row: every case passed — ok, "<version> (<copy>) · 6 of 6 checks · <when>"; a case failed (Claude Code
//   started with the Harness and the Harness did not do its part) — fail, with the case's name and reason; a case
//   that did not run (the binary did not start, the stand-in fell behind the API) — unknown: nothing is known about
//   the Harness then, so the row is not red. A plugin warning of system/init (Claude Code 2.1.332 and later report a
//   range of `engines["claude-code"]` the binary does not meet as one) turns an ok row into a warning.
// - Failed or not, the row has "Run again" and "Copy details" (every outcome, for a bug report); the terminal on a
//   newer version than worfy's copy links the changelog of Claude Code (owner's decision Q7 (b)). No paid eval runs
//   here (Q6 (a)): a full `pnpm eval:harness` stays where harness/README.md puts it.
//
// The runs go through runContractSet as they are (the runner and the cases are ticket 08's); this module only gives
// each case the PATH of the login shell, so the hooks the Harness starts (`node …/guard.mjs`) and the cases' git
// find their tools as in a terminal, not on the short PATH worfy got from Finder. Under WORFY_AGENT=fake the e2e runs
// answer with fakeSetRun (WORFY_HARNESS_CONTRACT) and start no Claude Code. No Electron here:
// src/main/ipc/first-run.ts wires it to the app.
import { accessSync, constants, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { severityOf } from '../../shared/health/severity'
import type { Check } from '../../shared/ipc/first-run'
import { getVar, type FileExists } from '../agent/env'
import { CONTRACT_CASES } from '../harness/contract/cases'
import { runContractSet, type CaseOutcome, type ContractCase, type StreamLine } from '../harness/contract/runner'
import { runTool, windowsProgram, type Env, type ToolRun } from './tools'

/** Which Claude Code a row speaks for: worfy's own copy (the SDK's binary) or the terminal's. */
export type ClaudeCopy = 'worfy' | 'terminal'
export type HarnessClaudeId = 'harness-claude' | 'harness-claude-terminal'

export const HARNESS_CLAUDE_ROWS: Record<ClaudeCopy, HarnessClaudeId> = { worfy: 'harness-claude', terminal: 'harness-claude-terminal' }
export const copyOfRow = (id: HarnessClaudeId): ClaudeCopy => (id === 'harness-claude' ? 'worfy' : 'terminal')

/** The changelog of Claude Code, linked from the terminal's row on a newer version than worfy's copy (Q7 (b)). */
export const CLAUDE_CODE_CHANGELOG_URL = 'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md'

/** The cache file in worfy's data folder. */
export const HARNESS_CLAUDE_CACHE = 'harness-claude.json'

/** How long one case may run before the runner stops it and calls it not run: well over the second a case takes. */
export const HEALTH_RUN_LIMIT_MS = 30_000

const TITLE = 'Harness on Claude Code'
/** The pairs kept: the newest ones; an older pair comes back only after a downgrade, and then runs again. */
const KEPT_PAIRS = 12

/** A Claude Code binary found, with its version; `unusable` — found, but the set cannot start it. */
export type ClaudeFound = { kind: 'found'; binary: string; version: string } | { kind: 'missing' } | { kind: 'unusable'; reason: string; version?: string }

/** What a run of the set gave: the outcome of each case and the plugin warnings Claude Code named. */
export interface SetRun {
  outcomes: CaseOutcome[]
  warnings: string[]
}

export interface HarnessClaudeDeps {
  /** <data>/harness-claude.json. */
  cacheFile: string
  /** The Harness copy of this build: its folder and its version; no version — no copy (a dev build before the first build). */
  harness: () => { dir: string; version: string | undefined }
  /** The binary of a copy of Claude Code and its version. */
  claude: (copy: ClaudeCopy) => Promise<ClaudeFound>
  /** Runs the contract set on `binary` with the Harness in `pluginDir`. */
  runSet: (binary: string, pluginDir: string, copy: ClaudeCopy) => Promise<SetRun>
  now?: () => Date
}

const outcomeSchema = z.discriminatedUnion('status', [
  z.object({ id: z.string(), title: z.string(), status: z.literal('passed') }),
  z.object({ id: z.string(), title: z.string(), status: z.literal('failed'), reason: z.string() }),
  z.object({ id: z.string(), title: z.string(), status: z.literal('not-run'), reason: z.string() }),
])
const entrySchema = z.object({ claudeVersion: z.string(), harnessVersion: z.string(), at: z.string(), outcomes: z.array(outcomeSchema), warnings: z.array(z.string()) })
const cacheSchema = z.object({ entries: z.array(entrySchema) })
type Entry = z.infer<typeof entrySchema>

const keyOf = (claudeVersion: string, harnessVersion: string): string => `${claudeVersion}\u0000${harnessVersion}`
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))
/** The first line of a reason, short enough for a row. */
const brief = (text: string, size = 200): string => {
  const line = text.split('\n')[0]!.trim()
  return line.length > size ? `${line.slice(0, size - 1)}…` : line
}

/** `1.2.3` as numbers; null when there is none. */
function versionOf(text: string): [number, number, number] | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text)
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])]
}

function newer(a: string, b: string): boolean {
  const left = versionOf(a)
  const right = versionOf(b)
  if (left === null || right === null) return false
  for (let index = 0; index < 3; index += 1) if (left[index] !== right[index]) return left[index]! > right[index]!
  return false
}

/** "Nov 14, 10:02", local time. */
const when = (at: string): string => {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return at
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

export class HarnessClaudeCheck {
  /** The runs under way, by pair: a second ask of the same pair waits for that run. */
  private readonly running = new Map<string, Promise<Entry>>()

  constructor(private readonly deps: HarnessClaudeDeps) {}

  /** Both rows, worfy's copy first; the terminal's only when a `claude` is there. */
  async rows(): Promise<Check[]> {
    const rows = await Promise.all((['worfy', 'terminal'] as const).map((copy) => this.row(copy)))
    return rows.filter((row): row is Check => row !== null)
  }

  /** The row of one copy: from the cache, or after a run of the set; `again` — run it anew. Null: no such Claude Code. */
  async row(copy: ClaudeCopy, { again = false }: { again?: boolean } = {}): Promise<Check | null> {
    const [claude, worfy] = await Promise.all([this.deps.claude(copy), copy === 'terminal' ? this.deps.claude('worfy') : Promise.resolve(null)])
    if (claude.kind === 'missing') return null
    const label = `${claude.kind === 'found' ? claude.version : (claude.version ?? 'unknown version')} (${copy})`
    const links = copy === 'terminal' && worfy?.kind === 'found' && claude.version !== undefined && newer(claude.version, worfy.version)
    const extra: Check['actions'] = links ? [{ id: 'open-link', label: 'Changelog', url: CLAUDE_CODE_CHANGELOG_URL }] : []
    if (claude.kind === 'unusable') return this.notRun(copy, label, claude.reason, extra)
    const { dir, version } = this.deps.harness()
    if (version === undefined) return this.notRun(copy, label, 'this build has no Harness copy', extra)
    let entry: Entry
    try {
      entry = await this.entry(claude, { dir, version }, copy, again)
    } catch (error) {
      return this.notRun(copy, label, message(error), extra)
    }
    return rowOf(copy, label, entry, extra)
  }

  private notRun(copy: ClaudeCopy, label: string, reason: string, extra: Check['actions']): Check {
    return make(copy, 'unknown', `${label} · the checks could not run: ${brief(reason)}`, 'Nothing is known about the Harness on this Claude Code; Run again', [RUN_AGAIN, ...extra], `${TITLE} ${label}: the checks could not run: ${reason}`)
  }

  private async entry(claude: Extract<ClaudeFound, { kind: 'found' }>, harness: { dir: string; version: string }, copy: ClaudeCopy, again: boolean): Promise<Entry> {
    const key = keyOf(claude.version, harness.version)
    const under = this.running.get(key)
    if (under !== undefined) return under
    if (!again) {
      const kept = this.read().find((each) => keyOf(each.claudeVersion, each.harnessVersion) === key)
      if (kept !== undefined) return kept
    }
    const run = (async (): Promise<Entry> => {
      const result = await this.deps.runSet(claude.binary, harness.dir, copy)
      const entry: Entry = { claudeVersion: claude.version, harnessVersion: harness.version, at: (this.deps.now?.() ?? new Date()).toISOString(), outcomes: result.outcomes, warnings: result.warnings }
      this.write(entry)
      return entry
    })()
    this.running.set(key, run)
    try {
      return await run
    } finally {
      this.running.delete(key)
    }
  }

  private read(): Entry[] {
    try {
      const parsed = cacheSchema.safeParse(JSON.parse(readFileSync(this.deps.cacheFile, 'utf8')))
      return parsed.success ? parsed.data.entries : []
    } catch {
      return []
    }
  }

  /** Puts `entry` first in the cache, over the one of its pair; written whole and renamed into place. */
  private write(entry: Entry): void {
    const key = keyOf(entry.claudeVersion, entry.harnessVersion)
    const entries = [entry, ...this.read().filter((each) => keyOf(each.claudeVersion, each.harnessVersion) !== key)].slice(0, KEPT_PAIRS)
    const file = this.deps.cacheFile
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp-${process.pid}`
    writeFileSync(tmp, `${JSON.stringify({ entries }, null, 2)}\n`)
    renameSync(tmp, file)
  }
}

const RUN_AGAIN: Check['actions'][number] = { id: 'harness-claude-run', label: 'Run again' }
const COPY_DETAILS: Check['actions'][number] = { id: 'copy-details', label: 'Copy details' }

function make(copy: ClaudeCopy, status: Check['status'], detail: string, hint: string, actions: Check['actions'], details: string): Check {
  const id = HARNESS_CLAUDE_ROWS[copy]
  // Its signal is a toast and its row (the renderer's harness-claude toasts), not First run opening by itself.
  return { id, group: 'Harness', title: TITLE, status, severity: severityOf({ id, status }, { githubProject: true }), detail, hint, command: null, actions: status === 'ok' ? actions : [...actions.slice(0, 1), COPY_DETAILS, ...actions.slice(1)], details, opensFirstRun: false }
}

/** The row of a kept answer. */
function rowOf(copy: ClaudeCopy, label: string, entry: Entry, extra: Check['actions']): Check {
  const total = entry.outcomes.length
  const failed = entry.outcomes.filter((each): each is Extract<CaseOutcome, { status: 'failed' }> => each.status === 'failed')
  const notRun = entry.outcomes.filter((each): each is Extract<CaseOutcome, { status: 'not-run' }> => each.status === 'not-run')
  const details = [
    `${TITLE} ${label}, Harness ${entry.harnessVersion}, checked ${entry.at}`,
    ...entry.outcomes.map((each) => (each.status === 'passed' ? `${each.id}: passed` : `${each.id}: ${each.status === 'failed' ? 'failed' : 'not run'} — ${each.reason}`)),
    ...entry.warnings.map((each) => `plugin warning: ${each}`),
  ].join('\n')
  const actions = [RUN_AGAIN, ...extra]
  if (failed.length === 1) {
    const [one] = failed
    return make(copy, 'fail', `${label} · ${one!.id}: ${brief(one!.reason)}`, 'The guard and the gate may not hold on this Claude Code; Copy details has what each check saw', actions, details)
  }
  if (failed.length > 1) {
    return make(copy, 'fail', `${label} · ${failed.length} of ${total} checks failed: ${failed.map((each) => each.id).join(', ')}`, 'The guard and the gate may not hold on this Claude Code; Copy details has what each check saw', actions, details)
  }
  if (notRun.length > 0) {
    const [first] = notRun
    return make(copy, 'unknown', `${label} · the checks could not run: ${first!.id}: ${brief(first!.reason)}`, 'Nothing is known about the Harness on this Claude Code; Run again, or Copy details', actions, details)
  }
  const checked = `${label} · ${total} of ${total} checks`
  if (entry.warnings.length > 0) {
    const count = entry.warnings.length
    return make(copy, 'warn', `${checked} · ${count} plugin ${count === 1 ? 'warning' : 'warnings'}`, `Claude Code warns about the plugin: ${brief(entry.warnings[0]!)}`, actions, details)
  }
  return make(copy, 'ok', `${checked} · ${when(entry.at)}`, '', actions, details)
}

/** The plugin warnings of a system/init line (Claude Code 2.1.332 and later), as "<plugin> <type>: <message>". */
function pluginWarnings(init: StreamLine): string[] {
  const listed = init.plugin_warnings
  if (!Array.isArray(listed)) return []
  return listed.map((each) => {
    if (typeof each !== 'object' || each === null) return String(each)
    const { plugin, type, message: text } = each as Record<string, unknown>
    const head = [plugin, type].filter((part) => typeof part === 'string' && part !== '').join(' ')
    return typeof text === 'string' && text !== '' ? `${head}: ${text}` : head || JSON.stringify(each)
  })
}

/** Variables of the login shell a run gets over the runner's own: its PATH, and on Windows the Git Bash Claude Code runs hooks with. */
const PASSED_ON = ['PATH', 'CLAUDE_CODE_GIT_BASH_PATH'] as const

/**
 * The real set: CONTRACT_CASES through runContractSet, each case with the variables of the login shell on top of the
 * runner's environment (claudeEnv takes worfy's own PATH), and the plugin warnings of each run's system/init kept.
 */
export function contractSetRun(loginEnv: () => Promise<Env>, run: typeof runContractSet = runContractSet, runLimitMs = HEALTH_RUN_LIMIT_MS): HarnessClaudeDeps['runSet'] {
  return async (binary, pluginDir) => {
    const env = await loginEnv()
    const passed: Record<string, string> = {}
    for (const name of PASSED_ON) {
      const value = getVar(env, name)
      if (value !== undefined && value !== '') passed[name] = value
    }
    const warnings = new Set<string>()
    const cases: ContractCase[] = CONTRACT_CASES.map((each) => ({
      ...each,
      prepare: (context) => ({ ...(each.prepare?.(context) ?? {}), ...passed }),
      check: (caseRun) => {
        for (const warning of pluginWarnings(caseRun.init)) warnings.add(warning)
        return each.check(caseRun)
      },
    }))
    const outcomes = await run(cases, { binary, pluginDir, runLimitMs })
    return { outcomes, warnings: [...warnings] }
  }
}

/**
 * The set of the e2e runs under WORFY_AGENT=fake: WORFY_HARNESS_CONTRACT says per copy what it answers —
 * `worfy=passed,terminal=failed:guard-reset-hard` (or `not-run:<case>`). A copy it does not name passes. No process.
 */
export function fakeSetRun(spec: string): HarnessClaudeDeps['runSet'] {
  const said = new Map<string, { status: 'failed' | 'not-run'; id: string }>()
  for (const part of spec.split(',')) {
    const match = /^\s*(worfy|terminal)=(passed|failed|not-run)(?::([\w-]+))?\s*$/.exec(part)
    if (match === null || match[2] === 'passed') continue
    said.set(match[1]!, { status: match[2] as 'failed' | 'not-run', id: match[3] ?? CONTRACT_CASES[0]!.id })
  }
  return (_binary, _pluginDir, copy) => {
    const what = said.get(copy)
    const outcomes = CONTRACT_CASES.map(({ id, title }): CaseOutcome => {
      if (what === undefined || what.id !== id) return { id, title, status: 'passed' }
      return what.status === 'failed' ? { id, title, status: 'failed', reason: 'the guard did not refuse (the fake set of WORFY_HARNESS_CONTRACT)' } : { id, title, status: 'not-run', reason: 'could not start (the fake set of WORFY_HARNESS_CONTRACT)' }
    })
    return Promise.resolve({ outcomes, warnings: [] })
  }
}

/** An executable file named `name` on the PATH of `env` (POSIX), the first in PATH order; relative entries are skipped. */
function onPosixPath(name: string, env: Env): string | null {
  for (const dir of (getVar(env, 'PATH') ?? '').split(delimiter)) {
    if (!isAbsolute(dir)) continue
    const candidate = join(dir, name)
    try {
      if (!statSync(candidate).isFile()) continue
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Not there, or not executable: the next entry.
    }
  }
  return null
}

/**
 * The terminal's Claude Code: `claude` on the PATH of the login shell (on Windows the environment worfy builds for a
 * Session), found as a terminal finds it, and its `--version`, as the row "Claude Code in the terminal" asks it. On
 * Windows npm's claude.cmd needs cmd.exe, which the runner does not start a binary through: such a `claude` is
 * `unusable`, with its version still named.
 */
export async function terminalClaude(
  env: Env,
  { platform = process.platform, run = runTool, exists }: { platform?: NodeJS.Platform; run?: (file: string, args: readonly string[], env: Env, timeoutMs: number) => Promise<ToolRun>; exists?: FileExists } = {},
): Promise<ClaudeFound> {
  const windows = platform === 'win32'
  const program = windows ? windowsProgram('claude', env, exists) : null
  const binary = windows ? program?.file ?? null : onPosixPath('claude', env)
  if (binary === null) return { kind: 'missing' }
  const answer = await run(binary, ['--version'], env, 15_000)
  if (answer.missing) return { kind: 'missing' }
  const found = versionOf(answer.stdout)
  if (answer.code !== 0 || found === null) return { kind: 'unusable', reason: `claude --version answered no version${answer.stderr ? `: ${brief(answer.stderr)}` : ''}` }
  const version = found.join('.')
  if (program?.cmd === true) return { kind: 'unusable', reason: `${binary} runs only under cmd.exe; the checks start a claude.exe (the native install of Claude Code)`, version }
  return { kind: 'found', binary, version }
}

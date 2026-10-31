// "Restart now", "Restart when idle" and the roll back (worfy-update ticket 04; spec R5–R8; ADR-0089
// points 4 and 5).
//
// A restart is the helper of ticket 02: scripts/install-stable.mjs of worfy's own clone, run by the
// system's node (not by Electron of the copy, whose files the swap moves) as a process of its own
// that outlives worfy:
//
//   node <update>/repo/scripts/install-stable.mjs <Stable copy> --wait-pid <pid of worfy>
//        --keep-previous | --rollback  --relaunch  --result <update>/result.json
//
// with WORFY_STABLE_PREBUILT=<the built app> for an install. It waits for worfy to quit, swaps the
// copy, starts it and writes its result. Before it starts, worfy writes `<update>/restart.json`:
// what the restart does and from which copy, read at the next start (settleLastRestart below; ticket
// 05 installs the Harness by it). Then worfy quits.
//
// A restart happens only when nothing works (spec R6, src/main/update/idle.ts); otherwise it is
// refused with the reason. "Restart when idle" keeps the wish (RestartIntent) and restarts once
// nothing works; "Restart now" pressed again, or a cancel, drops it, and so does a quit of worfy.
import { spawn as nodeSpawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join, posix, win32 } from 'node:path'
import { z } from 'zod'
import type { RestartAnswer, UpdateState } from '../../shared/ipc/update'
import { toolStart } from '../first-run/checks'
import { readJsonFile, writeJsonFile } from '../storage/json-file'
import { removeFile } from '../storage/remove'
import { missingTools, withoutTokens } from './build'
import type { IdleSignal } from './idle'
import { changeUpdateState, readUpdateState } from './state'

type Env = Readonly<Record<string, string | undefined>>

const BUSY: RestartAnswer = { outcome: 'refused', reason: 'a Session is working or Autopilot runs', busy: true }
const QUITTING: RestartAnswer = { outcome: 'refused', reason: 'worfy is quitting' }

/**
 * `<update>/restart.json`: what the restart does and from which copy. `version` and `sha` name the
 * copy it goes to (for a roll back, the previous one), `from` the copy that ran. `harness`: the
 * press was the consent to the Harness of that copy too (spec R5, R8; ticket 05).
 */
export const restartRecordSchema = z.object({
  action: z.enum(['install', 'rollback']),
  version: z.string(),
  sha: z.string(),
  from: z.object({ sha: z.string(), version: z.string() }),
  harness: z.literal(true),
  at: z.iso.datetime(),
})
export type RestartRecord = z.infer<typeof restartRecordSchema>

/** What the helper writes with --result (scripts/install-stable.mjs, installStable). */
const resultSchema = z.object({
  ok: z.boolean(),
  action: z.enum(['install', 'rollback']),
  commit: z.string().nullable(),
  reason: z.string().optional(),
})

export const restartFile = (dir: string): string => join(dir, 'restart.json')
export const resultFile = (dir: string): string => join(dir, 'result.json')
/** What the helper prints, for a restart that went wrong. */
export const restartLogFile = (dir: string): string => join(dir, 'restart.log')
/** The helper in the clone of ticket 03. */
export const helperScript = (dir: string): string => join(dir, 'repo', 'scripts', 'install-stable.mjs')

const rulesOf = (platform: NodeJS.Platform): typeof posix => (platform === 'win32' ? win32 : posix)

/** Where --keep-previous keeps the copy it replaced, and its file (previousPaths of scripts/install-stable.mjs). */
export function previousPaths(platform: NodeJS.Platform, target: string): { copy: string; metadata: string } {
  const rules = rulesOf(platform)
  const stem = rules.join(rules.dirname(target), `${rules.basename(target).replace(/\.app$/u, '')}.previous`)
  return { copy: stem, metadata: `${stem}.json` }
}

/** The previous copy, when there is a whole one with its file; its version as the restart that kept it named it, else its short SHA. */
export function previousCopy(platform: NodeJS.Platform, target: string, record: RestartRecord | undefined): { version: string; commit: string } | null {
  const paths = previousPaths(platform, target)
  try {
    if (!statSync(paths.copy).isDirectory()) return null
    const parsed = z.object({ commit: z.string().min(1) }).loose().safeParse(JSON.parse(readFileSync(paths.metadata, 'utf8')))
    if (!parsed.success) return null
    const { commit } = parsed.data
    const named = record !== undefined && sameCommit(record.from.sha, commit)
    return { version: named ? record.from.version : commit.slice(0, 7), commit }
  } catch {
    return null
  }
}

/** Two SHAs of one commit, either of them perhaps short. */
function sameCommit(a: string, b: string): boolean {
  if (a === '' || b === '') return false
  return a.startsWith(b) || b.startsWith(a)
}

/**
 * At the start of worfy: the result of the restart that ended the last run, if any, into the state
 * (`lastRestart`, its toast is ticket 07's), and `previous` as the disk has it. The result file is
 * removed once read; restart.json stays for ticket 05.
 */
export function settleLastRestart({ dir, stateFile, target, platform = process.platform }: { dir: string; stateFile: string; target: string; platform?: NodeJS.Platform }): void {
  const record = existsSync(restartFile(dir)) ? readJsonFile(restartFile(dir), restartRecordSchema) : undefined
  const resultPath = resultFile(dir)
  let lastRestart: NonNullable<UpdateState['lastRestart']> | undefined
  if (existsSync(resultPath)) {
    let parsed: z.infer<typeof resultSchema> | undefined
    try {
      const read = resultSchema.safeParse(JSON.parse(readFileSync(resultPath, 'utf8')))
      if (read.success) parsed = read.data
    } catch {
      // A file that does not read is a restart that did not report: said below.
    }
    if (parsed === undefined) {
      lastRestart = { ok: false, action: record?.action ?? 'install', version: record?.version ?? '', reason: `the result of the restart in ${resultPath} could not be read` }
    } else {
      const ours = record !== undefined && record.action === parsed.action
      const version = ours ? record.version : (parsed.commit?.slice(0, 7) ?? '')
      lastRestart = { ok: parsed.ok, action: parsed.action, version, ...(parsed.ok || parsed.reason === undefined ? {} : { reason: parsed.reason }) }
    }
  }
  const previous = previousCopy(platform, target, record)
  changeUpdateState((state) => {
    let next: UpdateState = { ...state, previous: previous === null ? null : { version: previous.version } }
    if (lastRestart === undefined) return next
    next = { ...next, lastRestart }
    if (!lastRestart.ok || record === undefined || record.action !== lastRestart.action) return next
    // The build that was installed, or the one rolled back from, is no Update to restart into any more.
    const done = record.action === 'install' ? record.sha : record.from.sha
    if (next.build.sha !== undefined && sameCommit(next.build.sha, done)) next = { ...next, build: { phase: 'idle' } }
    if (record.action === 'install') {
      return { ...next, rolledBackFrom: null, available: next.available !== null && sameCommit(next.available.sha, record.sha) ? null : next.available }
    }
    // Spec R8: the commit rolled back from is quiet until the next one.
    const available = next.available !== null && sameCommit(next.available.sha, record.from.sha) ? { ...next.available, quiet: true } : next.available
    return { ...next, rolledBackFrom: record.from.sha, available }
  }, stateFile)
  if (existsSync(resultPath)) {
    try {
      removeFile(resultPath)
    } catch (error) {
      console.warn(`[update] ${resultPath} could not be removed`, error)
    }
  }
}

export const NODE_MISSING = 'node was not found: a restart into an Update needs it (Settings → Health)'
export const NODE_NOT_EXE = 'the node found is no program worfy can start by itself (node.exe)'

/**
 * How the system's node starts the helper with `args`, or the reason it cannot. Off Windows `node`
 * by name, found on the PATH of `env` when the process starts. On Windows the node.exe the Path
 * names; a node.cmd is refused: it would need cmd.exe and a command line glued from the paths,
 * where node.exe takes its arguments one by one. `exists` is for the tests (toolStart).
 */
export function helperStart(args: readonly string[], env: Env, platform: NodeJS.Platform, exists?: (path: string) => boolean): { file: string; args: string[] } | string {
  if (platform !== 'win32' && missingTools(env, platform).includes('node')) return NODE_MISSING
  const start = toolStart('node', args, env, platform, exists)
  if (start === null) return NODE_MISSING
  if (start.shell !== false) return NODE_NOT_EXE
  return { file: start.file, args: start.args }
}

/** Starts the helper; Node's spawn by default. Answers the child, whose pid is undefined when it did not start. */
export type SpawnDetached = (
  file: string,
  args: readonly string[],
  options: { cwd: string; env: Record<string, string>; detached: true; windowsHide: true; stdio: ['ignore', number, number] },
) => { pid?: number | undefined; on(event: 'error', listener: (error: Error) => void): unknown; unref(): void }

export interface RestartsOptions {
  /** `<dataRoot>/update`. */
  dir: string
  stateFile: () => string
  /** The Stable copy the helper changes (stableCopyPath). */
  target: () => string
  /** worfy's own pid, which the helper waits for. */
  pid: number
  /** The environment the system's node is found and run in (the login shell's); the tokens are dropped. */
  env: () => Promise<Env>
  /** The copy that runs: the roll back names it as the one it leaves. */
  running: () => { commit: string; version: string }
  idle: IdleSignal
  /** Quits worfy (app.quit). */
  quit: () => void
  spawn?: SpawnDetached
  platform?: NodeJS.Platform
  /** Hears a change of `pending`. */
  onChange?: () => void
  now?: () => Date
}

/** What a restart that may go ahead does. */
interface Plan {
  record: Omit<RestartRecord, 'at'>
  /** The built app; only for an install. */
  appPath?: string
}

/**
 * The restarts of the app: one at a time, and none once worfy quits. A press while a restart is
 * asked for already gets that one's answer.
 */
export class Restarts {
  readonly intent: RestartIntent
  private inFlight: { kind: 'install' | 'rollback'; answer: Promise<RestartAnswer> } | null = null
  /** worfy quits: the helper started, or the user quit. */
  private quittingNow = false
  /** Raised by each cancel: an install asked for before it does not start the helper. */
  private generation = 0

  constructor(private readonly options: RestartsOptions) {
    this.intent = new RestartIntent({ idle: options.idle, restartNow: () => this.now(), ...(options.onChange === undefined ? {} : { onChange: options.onChange }) })
  }

  /** "Restart when idle" waits. */
  get pending(): boolean {
    return this.intent.pending
  }

  /** At the start: the result of the restart that ended the last run, and `previous` (settleLastRestart). */
  settle(): void {
    settleLastRestart({ dir: this.options.dir, stateFile: this.options.stateFile(), target: this.options.target(), platform: this.options.platform ?? process.platform })
  }

  restart(when: 'now' | 'idle' | 'cancel'): Promise<RestartAnswer> {
    if (when === 'cancel') {
      this.generation += 1
      this.intent.cancel()
      return Promise.resolve(this.quittingNow ? QUITTING : { outcome: 'cancelled' })
    }
    // Always through the wish: a Session that begins a turn while the restart is asked for keeps it waiting.
    if (when === 'idle') return this.quittingNow ? Promise.resolve(QUITTING) : this.intent.arm()
    // A new press of "Restart now" drops the wish of "Restart when idle", whatever it answers.
    if (when === 'now') this.intent.cancel()
    return this.now()
  }

  /** The roll back to the previous copy, after `confirm` (the native dialog of spec R8) said yes. */
  rollback(confirm: (version: string) => Promise<boolean>): Promise<RestartAnswer> {
    if (this.quittingNow) return Promise.resolve(QUITTING)
    if (this.inFlight !== null) return Promise.resolve({ outcome: 'refused', reason: 'a restart is under way' })
    const answer = this.rollbackAfter(confirm).finally(() => (this.inFlight = null))
    this.inFlight = { kind: 'rollback', answer }
    return answer
  }

  /** worfy quits (before-quit): the wish is dropped and nothing restarts any more. */
  quitting(): void {
    this.quittingNow = true
    this.intent.quitting()
  }

  private now(): Promise<RestartAnswer> {
    if (this.quittingNow) return Promise.resolve(QUITTING)
    if (this.inFlight?.kind === 'install') return this.inFlight.answer
    if (this.inFlight !== null) return Promise.resolve({ outcome: 'refused', reason: 'a roll back is under way' })
    const answer = this.installNow().finally(() => (this.inFlight = null))
    this.inFlight = { kind: 'install', answer }
    return answer
  }

  private async installNow(): Promise<RestartAnswer> {
    const generation = this.generation
    const first = this.plan('install')
    if ('outcome' in first) return first
    const env = await this.options.env()
    if (generation !== this.generation) return { outcome: 'cancelled' }
    return this.launch(env)
  }

  private async rollbackAfter(confirm: (version: string) => Promise<boolean>): Promise<RestartAnswer> {
    const first = this.plan('rollback')
    if ('outcome' in first) return first
    if (!(await confirm(first.record.version))) return { outcome: 'cancelled' }
    const env = await this.options.env()
    return this.launch(env, 'rollback')
  }

  /**
   * Starts the helper and quits, all in one synchronous run: whatever changed while the caller
   * waited (a Session began a turn, the build went, worfy began to quit) is looked at again first.
   */
  private launch(env: Env, action: 'install' | 'rollback' = 'install'): RestartAnswer {
    if (this.quittingNow) return QUITTING
    const plan = this.plan(action, true)
    if ('outcome' in plan) return plan
    const { dir } = this.options
    const platform = this.options.platform ?? process.platform
    const args = [
      helperScript(dir),
      this.options.target(),
      '--wait-pid',
      String(this.options.pid),
      action === 'install' ? '--keep-previous' : '--rollback',
      '--relaunch',
      '--result',
      resultFile(dir),
    ]
    const start = helperStart(args, env, platform)
    if (typeof start === 'string') return { outcome: 'refused', reason: start }
    const childEnv = withoutTokens(env)
    for (const name of Object.keys(childEnv)) if (name.toUpperCase() === 'WORFY_STABLE_PREBUILT') delete childEnv[name]
    if (plan.appPath !== undefined) childEnv.WORFY_STABLE_PREBUILT = plan.appPath

    // The record of the restart before this one (ticket 05 reads it): put back when this one does not start.
    let before: string | null
    try {
      removeFile(resultFile(dir))
      before = existsSync(restartFile(dir)) ? readFileSync(restartFile(dir), 'utf8') : null
      writeJsonFile(restartFile(dir), restartRecordSchema, { ...plan.record, at: (this.options.now ?? (() => new Date()))().toISOString() })
    } catch (error) {
      return { outcome: 'refused', reason: `${restartFile(dir)} could not be written (${message(error)})` }
    }
    let log: number
    try {
      log = openSync(restartLogFile(dir), 'w')
    } catch (error) {
      this.restoreRecord(before)
      return { outcome: 'refused', reason: `${restartLogFile(dir)} could not be opened (${message(error)})` }
    }
    let started: boolean
    let failure = 'node could not be started'
    try {
      // cwd is the folder of Update: a process whose working folder lies in the Stable copy would
      // keep the swap from moving it on Windows.
      const child = (this.options.spawn ?? (nodeSpawn as unknown as SpawnDetached))(start.file, start.args, {
        cwd: dir,
        env: childEnv,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', log, log],
      })
      // A program that is not there shows as a missing pid; its 'error' comes later, when nobody listens.
      child.on('error', (error) => console.warn('[update] the restart helper failed', error))
      started = child.pid !== undefined
      if (started) child.unref()
    } catch (error) {
      started = false
      failure = `node could not be started (${message(error)})`
    } finally {
      closeSync(log)
    }
    if (!started) {
      this.restoreRecord(before)
      return { outcome: 'refused', reason: failure }
    }
    this.quittingNow = true
    this.intent.quitting()
    this.options.quit()
    return { outcome: 'quitting' }
  }

  /**
   * What `action` would do now, or the refusal. `fresh`: the Sessions and Autopilot are looked at
   * now, not as last seen (Autopilot is looked at only every 2 s).
   */
  private plan(action: 'install' | 'rollback', fresh = false): Plan | RestartAnswer {
    if (!(fresh ? this.options.idle.recheck() : this.options.idle.idle)) return BUSY
    const { dir } = this.options
    if (!existsSync(helperScript(dir))) return { outcome: 'refused', reason: `the clone of Update has no ${helperScript(dir)}` }
    const state = readUpdateState(this.options.stateFile())
    const running = this.options.running()
    const from = { sha: running.commit, version: running.version }
    if (action === 'install') {
      const { build } = state
      if (build.phase !== 'ready' || build.sha === undefined || build.version === undefined || build.appPath === undefined) return { outcome: 'refused', reason: 'no Update is built and ready' }
      if (!existsSync(build.appPath)) return { outcome: 'refused', reason: `the built app is gone: ${build.appPath}` }
      return { record: { action, version: build.version, sha: build.sha, from, harness: true }, appPath: build.appPath }
    }
    const previous = previousCopy(this.options.platform ?? process.platform, this.options.target(), existsSync(restartFile(dir)) ? readJsonFile(restartFile(dir), restartRecordSchema) : undefined)
    if (previous === null) return { outcome: 'refused', reason: 'no previous version is kept' }
    return { record: { action, version: previous.version, sha: previous.commit, from, harness: true } }
  }

  /** Puts back the restart.json a restart that did not start replaced: removed when there was none. */
  private restoreRecord(before: string | null): void {
    const file = restartFile(this.options.dir)
    try {
      if (before === null) return removeFile(file)
      const writing = `${file}.restoring-${process.pid}`
      writeFileSync(writing, before)
      renameSync(writing, file)
    } catch (error) {
      console.warn(`[update] ${file} of a restart that did not start could not be put back`, error)
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface RestartIntentOptions {
  idle: IdleSignal
  /** "Restart now"; called once nothing works. */
  restartNow: () => Promise<RestartAnswer>
  /** Hears a change of `pending`. */
  onChange?: () => void
}

/**
 * The wish of "Restart when idle": kept until nothing works, then "Restart now", once. A refusal
 * because something works again (the quiet ended while the restart was asked for) keeps it for the
 * next quiet; any other refusal drops it, and is logged.
 */
export class RestartIntent {
  private armed = false
  private done = false
  private running: Promise<RestartAnswer> | null = null
  private unsubscribe: (() => void) | null = null

  constructor(private readonly options: RestartIntentOptions) {}

  get pending(): boolean {
    return this.armed
  }

  /**
   * Keeps the wish; when all is quiet already, restarts at once and answers how that went. A refusal
   * because something works answers `waiting`: the wish stays for the next quiet.
   */
  async arm(): Promise<RestartAnswer> {
    if (this.done) return QUITTING
    if (!this.armed) {
      this.armed = true
      this.unsubscribe = this.options.idle.subscribe((idle) => {
        if (idle) void this.fire()
      })
      this.options.onChange?.()
    }
    const attempt = this.options.idle.idle ? this.fire() : null
    const answer = attempt === null ? null : await attempt
    if (answer === null || (answer.outcome === 'refused' && answer.busy === true && this.armed)) return { outcome: 'waiting' }
    return answer
  }

  cancel(): void {
    if (!this.armed) return
    this.disarm()
    this.options.onChange?.()
  }

  /** worfy quits: the wish goes, and no new one is kept. */
  quitting(): void {
    this.done = true
    this.cancel()
  }

  private disarm(): void {
    this.armed = false
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  /** The restart of the wish; the one under way when there is one, null when there is no wish. */
  private fire(): Promise<RestartAnswer> | null {
    if (!this.armed) return null
    if (this.running === null) {
      // Taken before the restart is asked for: a change it causes on the way (the restart looks at
      // the Sessions afresh) must not start a second one.
      let settle: (answer: RestartAnswer) => void = () => undefined
      this.running = new Promise((resolve) => (settle = resolve))
      void this.attempt().then((answer) => {
        this.running = null
        settle(answer)
        // Refused because something worked; a quiet that came back while it was asked for sends no
        // new change, so it is looked at here.
        if (answer.outcome === 'refused' && answer.busy === true && this.options.idle.idle) void this.fire()
      })
    }
    return this.running
  }

  private async attempt(): Promise<RestartAnswer> {
    let answer: RestartAnswer
    try {
      answer = await this.options.restartNow()
    } catch (error) {
      console.warn('[update] "Restart when idle" failed', error)
      answer = { outcome: 'refused', reason: message(error) }
    }
    const busy = answer.outcome === 'refused' && answer.busy === true
    if (answer.outcome === 'refused' && !busy) console.warn(`[update] "Restart when idle" gave up: ${answer.reason}`)
    if (!busy) this.cancel()
    return answer
  }
}

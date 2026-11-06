// The approval policy in the unattended canUseTool of Claude Code (worfy-auto-approve ticket 04): an
// Autopilot run on the fake agent, whose script asks for four permissions as Claude Code does in
// bypassPermissions (a delete inside the Wave's worktree, one outside every root, one in ~/.ssh and one
// the parser cannot judge), with the Auto-approval mode Off, Shadow or On.
//
// Off is the behaviour before the ticket, byte for byte: the events of the Orchestrator's Session and the
// Journal are compared with test/fixtures/auto-approve/off-baseline.json, recorded on main before the
// change, after the run ids, times, uuids and temporary paths are written as placeholders.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActionLauncher } from '../../src/main/actions/launch'
import { PARK_EXPIRED_HINT, PARK_STOPPED_HINT } from '../../src/main/agent/auto-approve/park'
import { hardHint, HINTS } from '../../src/main/agent/auto-approve/policy'
import { openRunApproval, type LaunchApproval } from '../../src/main/agent/auto-approve/run-approval'
import { FakeReleases, fakeQueryFactory, type FakeCall } from '../../src/main/agent/fake-query'
import { Orchestrators } from '../../src/main/agent/orchestrator'
import { SessionRegistry, type QueryRequest } from '../../src/main/agent/session'
import { SessionSettingsStore } from '../../src/main/agent/session-settings'
import { openRun, readRun } from '../../src/main/autopilot/journal'
import { Autopilot } from '../../src/main/autopilot/run'
import { LayoutStore } from '../../src/main/layout/store'
import { readWorkflow, type EpicStatusRunner } from '../../src/main/workflow/reader'
import { DENIED_MESSAGE, UNATTENDED_DENIED_MESSAGE, unattendedDeniedMessage } from '../../src/main/vendors/claude/session'
import type { AgentEvent } from '../../src/shared/agent/events'
import { BACKGROUND_STALL_MS } from '../../src/shared/autopilot/cycle'
import type { JournalEvent } from '../../src/shared/autopilot/journal'
import { DEFAULT_ACTION_TEMPLATES } from '../../src/shared/projects/action-templates'
import type { AutoApprovalMode } from '../../src/shared/settings/app-settings'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))

const testDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scriptsDir = join(testDir, 'fixtures', 'agent-scripts')
const BASELINE = join(testDir, 'fixtures', 'auto-approve', 'off-baseline.json')
const PROJECT = 'demo-000000a4'
const EPIC = 'demo'
const WAVE = '/epic-wave Ticket-ы 01, 02 эпика demo'

let scratch: string
let repo: string
let registries: SessionRegistry[] = []
let autopilots: Autopilot[] = []

/** git with no config of this Machine: the reads of the Run see only the repository's own. */
const gitEnv = (): NodeJS.ProcessEnv => ({ ...process.env, GIT_CONFIG_GLOBAL: join(scratch, 'no-global-config'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_PARAMETERS: '' })
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=demo', '-c', 'user.email=demo@example.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd, env: gitEnv(), encoding: 'utf8' })

const ticketText = (num: number, status: string): string => [`# 0${num} — Ticket ${num}`, '', 'Type: task', `Status: ${status}`, 'Blocked by: —', '', '## Где в коде', '', `- \`src/f${num}.ts\``, ''].join('\n')
const ticketPath = (num: number): string => join(repo, '.scratch', EPIC, 'issues', `0${num}-ticket-${num}.md`)

/** `epic-status --json` over the Epic's files, as the real script reads these simple Tickets. */
const runner: EpicStatusRunner = (cwd) => {
  const dir = join(cwd, '.scratch', EPIC, 'issues')
  const tickets = readdirSync(dir).map((name) => {
    const text = readFileSync(join(dir, name), 'utf8')
    const status = /^Status:\s*(.*)$/m.exec(text)?.[1] ?? null
    const state = /^done/i.test(status ?? '') ? 'done' : 'open'
    const match = /^(\d+)-(.*)\.md$/.exec(name)!
    return { epic: EPIC, num: Number(match[1]), slug: match[2], title: text.split('\n')[0]!.replace(/^#\s*/, ''), statusRaw: status, state, blockedRaw: '—', blockedNums: [], blockedParsed: true }
  })
  return Promise.resolve(JSON.stringify({ ref: 'main', epics: [{ epic: EPIC, hasSpec: true, hasMap: false }], tickets }))
}

beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-aa04-')))
  repo = join(scratch, 'repo')
  mkdirSync(join(repo, '.scratch', EPIC, 'issues'), { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# demo\n')
  for (const num of [1, 2]) writeFileSync(ticketPath(num), ticketText(num, 'open'))
  // The Wave's worktree of Ticket 01, on its branch: the root the inside request deletes in.
  writeFileSync(join(repo, '.gitignore'), '.claude/\n')
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'demo')
  git(repo, 'worktree', 'add', '-q', '-b', `${EPIC}/01`, join(repo, '.claude', 'worktrees', '01'))
  mkdirSync(join(scratch, 'data', PROJECT), { recursive: true })
  mkdirSync(join(scratch, 'scratchpad'), { recursive: true })
})

afterEach(async () => {
  for (const autopilot of autopilots) await autopilot.stopAll()
  autopilots = []
  for (const registry of registries) registry.closeAll()
  registries = []
  removeTestTree(scratch)
})

async function until(condition: () => boolean | Promise<boolean>, what: string, limit = 5000): Promise<void> {
  const end = Date.now() + ms(limit)
  while (!(await condition())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((done) => setTimeout(done, 10))
  }
}

interface HarnessOptions {
  /** The Auto-approval mode the run reads at each request; absent: the run is given no policy at all (as before the ticket). */
  mode?: { value: AutoApprovalMode }
  /** The unattended Session's script; auto-approve-claude by default. */
  script?: string
  /** `open`: the run's policy cannot start; `judge`: it starts, and every judging throws. */
  fails?: 'open' | 'judge'
  /** The Orchestrator's view names this Vendor (the Session itself runs on the fake Claude agent). */
  vendor?: 'codex'
  /** The whole environment the factory tells the Session its process starts with, as the SDK's does (QueryRequest.processEnv). */
  processEnv?: Record<string, string>
  /** The owner's answer to each request parked on the Session's gate (worfy-auto-approve ticket 07); `deny` by default, `none`: left open. */
  answerParked?: 'allow' | 'deny' | 'none'
  /** The clock of the background-task limit (AutopilotDeps.tasksClock); the real one when absent. */
  tasksClock?: ManualClock
}

/** A clock whose timers fire only when the test says so. */
class ManualClock {
  private next = 1
  /** How many timers were set so far. */
  sets = 0
  readonly timers = new Map<number, { fn: () => void; ms: number }>()
  setTimeout = (fn: () => void, ms: number): number => {
    this.sets += 1
    const id = this.next++
    this.timers.set(id, { fn, ms })
    return id
  }
  clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number)
  }
  pending(): number[] {
    return [...this.timers.values()].map((timer) => timer.ms)
  }
  fire(ms: number): void {
    for (const [id, timer] of [...this.timers]) {
      if (timer.ms !== ms) continue
      this.timers.delete(id)
      timer.fn()
    }
  }
}

function harness(options: HarnessOptions = {}) {
  // This test's own folder: a store that writes after the test ended must not write into the next test's folder.
  const own = scratch
  const ownRepo = repo
  const env = { WORFY_DATA_DIR: join(own, 'data-root') }
  const calls: FakeCall[] = []
  const releases = new FakeReleases()
  const requests: QueryRequest[] = []
  const registry = new SessionRegistry((request) => {
    if (request.unattended === true) requests.push(request)
    if (options.processEnv !== undefined) request.processEnv?.(options.processEnv)
    return fakeQueryFactory({ scriptsDir, script: request.unattended === true ? (options.script ?? 'auto-approve-claude') : 'autopilot-waves', record: (call) => calls.push(call), releases })(request)
  })
  registries.push(registry)
  const orchestrators = new Orchestrators({
    layout: new LayoutStore((projectId) => join(own, 'data', projectId), { delayMs: 0 }),
    projectPath: () => ownRepo,
    registry,
    settings: new SessionSettingsStore((projectId) => join(own, 'data', projectId)),
    transcript: () => Promise.resolve({ model: null, statusBlock: null }),
    broadcast: () => undefined,
    publish: () => undefined,
  })
  const workflow = async (root: string) => (await readWorkflow({ root, claudeHome: join(own, 'claude-home'), env: () => Promise.resolve(process.env) }, runner)).model
  const launcher = new ActionLauncher({
    projectRoot: () => ownRepo,
    settings: () => ({ actionTemplates: DEFAULT_ACTION_TEMPLATES }),
    branch: () => Promise.resolve('main'),
    workflow,
    sessions: { create: () => ({ nodeId: 'n', sessionId: 's' }) as never },
    orchestrators,
    registry,
    bindings: { setLaunch: () => undefined },
    pollMs: 5,
    waitMs: 200,
  })
  // The agent marks the Wave's Tickets done when "Run wave" reaches it: the run then stops with no Wave left.
  registry.observe((_sessionId, event) => {
    if (event.type === 'prompt' && event.text === WAVE) for (const num of [1, 2]) writeFileSync(ticketPath(num), ticketText(num, 'done — 2026-11-05'))
  })
  const events: AgentEvent[] = []
  const mode = options.mode
  const vendor = options.vendor
  // The view of another Vendor's Orchestrator, over the same Session.
  const seen =
    vendor === undefined
      ? orchestrators
      : new Proxy(orchestrators, {
          get(target, key) {
            if (key === 'setUnattended')
              return async (...args: Parameters<Orchestrators['setUnattended']>) => {
                const view = await target.setUnattended(...args)
                return view === null ? view : { ...view, vendor }
              }
            const value: unknown = Reflect.get(target, key)
            return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
          },
        })
  // The policy each unattended launch of the Orchestrator gets (worfy-auto-approve ticket 07: parks()).
  const launches: LaunchApproval[] = []
  const launched = new Proxy(seen, {
    get(target, key) {
      if (key === 'setUnattended')
        return (...args: Parameters<Orchestrators['setUnattended']>) => {
          if (args[2] !== undefined) launches.push(args[2])
          return target.setUnattended(...args)
        }
      const value: unknown = Reflect.get(target, key)
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    },
  })
  const autopilot = new Autopilot({
    projectRoot: () => ownRepo,
    selfRefusal: () => Promise.resolve(null),
    workflow,
    watchWorkflow: () => Promise.resolve(() => undefined),
    orchestrators: launched,
    registry,
    waves: launcher,
    journal: (start) => openRun(start, { env }),
    harness: () => 'plugin',
    keepAwake: () => ({ start: () => undefined, stop: () => undefined }),
    settleMs: 60_000,
    ...(options.tasksClock === undefined ? {} : { tasksClock: options.tasksClock }),
    ...(mode === undefined
      ? {}
      : {
          approval: {
            mode: () => mode.value,
            open: async (_projectId: string, root: string, epic: string) => {
              if (options.fails === 'open') throw new Error('core.hooksPath cannot be read')
              const opened = await openRunApproval({
                root,
                epic,
                dataDir: env.WORFY_DATA_DIR,
                harnessHome: join(own, 'harness-home'),
                shellEnv: { HOME: homedir(), USERPROFILE: homedir() },
                gitEnv: gitEnv(),
                sessions: registry,
              })
              return options.fails === 'judge' ? { ...opened, judge: () => Promise.reject(new Error('the policy broke')) } : opened
            },
          },
        }),
  })
  autopilots.push(autopilot)
  launcher.attachAutopilot(autopilot)
  registry.observe((sessionId, event) => {
    if (registry.get(sessionId).unattended) events.push(event)
  })
  // The owner at the card of a parked request: it waits on the Session's gate until answered.
  const parked: Extract<AgentEvent, { type: 'permission_request' }>[] = []
  const parkedIn: string[] = []
  registry.observe((sessionId, event) => {
    if (event.type !== 'permission_request' || event.parked === undefined) return
    parked.push(event)
    parkedIn.push(sessionId)
    const answer = options.answerParked ?? 'deny'
    if (answer !== 'none') setTimeout(() => registry.get(sessionId).answerPermission(event.requestId, answer), 0)
  })
  const runFile = (): string => {
    const dir = join(env.WORFY_DATA_DIR, 'autopilot')
    const runs = readdirSync(dir)
    expect(runs).toHaveLength(1)
    return join(dir, runs[0]!)
  }
  const journal = async (): Promise<JournalEvent[]> => (await readRun(runFile().split(/[\\/]/).at(-1)!.replace(/\.jsonl$/, ''), { env }))!.events
  const answers = () => calls.filter((call): call is Extract<FakeCall, { kind: 'permission' }> => call.kind === 'permission').map((call) => call.result)
  /** Runs the Wave to its end: every request of the script answered, the run stopped. */
  const runToEnd = async (): Promise<void> => {
    for (let n = 0; n < 3; n++) releases.release('next')
    await autopilot.start(PROJECT, EPIC)
    await until(() => autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
  }
  /** The owner answers the `n`th parked request. */
  const answerParked = (n: number, option: 'allow' | 'deny'): boolean => registry.get(parkedIn[n]!).answerPermission(parked[n]!.requestId, option)
  /** The Session the `n`th parked request waits in. */
  const parkedSession = (n: number) => registry.get(parkedIn[n]!)
  return { autopilot, registry, events, journal, runFile, answers, releases, env, runToEnd, requests, parked, answerParked, parkedSession, launches }
}

/** A text with what changes from run to run written as placeholders. */
function placeholders(text: string): string {
  return text
    .replaceAll(JSON.stringify(scratch).slice(1, -1), '<scratch>')
    .replaceAll(JSON.stringify(homedir()).slice(1, -1), '<home>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}[:-]\d{2}[:-]\d{2}[.-]\d{3}Z(-[0-9a-f]{6})?/g, (_match, run: string | undefined) => (run === undefined ? '<time>' : '<run>'))
    .replace(/(?:pending-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
    .replace(/"at":\d+/g, '"at":0')
    // Windows paths: one separator, as on macOS and Linux.
    .replaceAll('\\\\', '/')
}

/** What a run shows outside: the events of its Session and the Journal's text, as placeholders. */
function observed(h: ReturnType<typeof harness>): { events: string[]; journal: string } {
  return { events: h.events.map((event) => placeholders(JSON.stringify(event))), journal: placeholders(readFileSync(h.runFile(), 'utf8')) }
}

describe('Auto-approval of an unattended Claude Session (worfy-auto-approve ticket 04)', () => {
  it('Off: the events of the Session and the Journal are byte for byte those of the build before the ticket', async () => {
    const h = harness({ mode: { value: 'off' } })
    await h.runToEnd()
    const now = observed(h)
    expect(now).toEqual(JSON.parse(readFileSync(BASELINE, 'utf8')))
    // Every answer is the refusal of before: the policy was not asked.
    expect(h.answers().every((answer) => answer.behavior === 'deny' && answer.message.startsWith(UNATTENDED_DENIED_MESSAGE))).toBe(true)
    expect((await h.journal()).filter((event) => event.kind === 'auto-approval')).toEqual([])
  })

  it('Shadow: the agent gets the refusal of before, the Journal what the policy would have done, with its rule', async () => {
    const h = harness({ mode: { value: 'shadow' } })
    await h.runToEnd()
    // The answers Off gives (the recorded tool results of the baseline): the refusal with Claude Code's reason.
    const refusal = { behavior: 'deny', message: unattendedDeniedMessage('Dangerous rm operation on statically-unresolvable target') }
    expect(h.answers()).toEqual([refusal, refusal, refusal, refusal])
    const lines = (await h.journal()).filter((event) => event.kind === 'auto-approval')
    expect(lines.map((line) => [line.mode, line.outcome, line.rule])).toEqual([
      ['shadow', 'would-allow', 'files-inside-roots'],
      ['shadow', 'would-park', expect.any(String)],
      ['shadow', 'hard-deny', 'hard:ssh'],
      ['shadow', 'would-deny', 'not-judged'],
    ])
    // Shadow writes no refused-dialog: each refusal has its auto-approval line instead.
    expect((await h.journal()).filter((event) => event.kind === 'refused-dialog')).toEqual([])
    expect((await h.journal())[0]).toMatchObject({ kind: 'run-started', autoApproval: 'shadow' })
  })

  it('On: a delete inside the Wave\'s worktree goes through, one outside every root waits for the owner, a hard deny is refused', async () => {
    const h = harness({ mode: { value: 'on' } })
    await h.runToEnd()
    const [inside, outside, hard, secret] = h.answers()
    expect(inside).toEqual({ behavior: 'allow', updatedInput: { command: `rm -rf '${repo}/.claude/worktrees/01/build'`, description: "Remove the build folder of the Ticket's worktree" } })
    // Parked on the Session's gate (ticket 07) with its rule, and refused as the owner answered.
    expect(h.parked).toHaveLength(1)
    expect(h.parked[0]?.parked?.rule).toBe('outside-roots')
    expect(h.parked[0]?.options.map((option) => option.kind)).toEqual(['allow', 'deny'])
    expect(outside).toEqual({ behavior: 'deny', message: DENIED_MESSAGE })
    expect(hard).toEqual({ behavior: 'deny', message: `${UNATTENDED_DENIED_MESSAGE}\nrefused because: Dangerous rm operation on statically-unresolvable target\n${hardHint('ssh', process.platform)}` })
    expect(secret).toEqual({ behavior: 'deny', message: `${UNATTENDED_DENIED_MESSAGE}\nrefused because: Dangerous rm operation on statically-unresolvable target\n${HINTS.notJudged}` })

    const journal = await h.journal()
    const lines = journal.filter((event) => event.kind === 'auto-approval')
    expect(lines.map((line) => [line.mode, line.outcome, line.rule, line.agent])).toEqual([
      ['on', 'allow', 'files-inside-roots', 'agent-impl-01'],
      ['on', 'park', 'outside-roots', 'agent-impl-01'],
      ['on', 'park-answered', 'outside-roots', 'agent-impl-01'],
      ['on', 'hard-deny', 'hard:ssh', undefined],
      ['on', 'deny', 'not-judged', 'agent-impl-02'],
    ])
    expect(lines[0]).toMatchObject({ vendor: 'claude', tool: 'Bash' })
    // The path in the form of the system (backslashes on Windows), the home folder as ~: compared with / as separator.
    expect(lines[0]?.kind === 'auto-approval' ? lines[0].targets.map((target) => target.replaceAll('\\', '/')) : []).toEqual([expect.stringMatching(/\/repo\/\.claude\/worktrees\/01\/build$/)])
    // The Session that asked is the run's: the line names it as refused-dialog does.
    const session = journal.find((event) => event.kind === 'wave-started')
    expect(session).toBeDefined()
    expect(lines.every((line) => typeof line.session === 'string')).toBe(true)
    // The Journal keeps neither the home folder nor a secret of a command.
    const raw = readFileSync(h.runFile(), 'utf8')
    expect(raw).not.toContain(homedir())
    expect(raw).not.toContain('secret-token-123')
    expect(raw).toContain('GH_TOKEN=***')
    expect(raw).toContain('~/.ssh/demo-key')
    expect(journal[0]).toMatchObject({ kind: 'run-started', autoApproval: 'on' })
  })

  it('each request is judged in the whole environment the process started with, as the query factory tells it', async () => {
    // A process environment without HOME: no home folder, so the policy approves nothing.
    const h = harness({ mode: { value: 'on' }, processEnv: { PATH: '/usr/bin:/bin' } })
    await h.runToEnd()
    expect(typeof h.requests[0]?.processEnv).toBe('function')
    const lines = (await h.journal()).filter((event) => event.kind === 'auto-approval')
    expect(lines.map((line) => [line.outcome, line.rule])).toEqual(Array(4).fill(['deny', 'no-home']))
  })

  it('a switch of the mode during the run counts from the next request, and each line names the mode in force', async () => {
    const mode = { value: 'shadow' as AutoApprovalMode }
    const h = harness({ mode })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.answers().length === 1, 'the first request')
    mode.value = 'on'
    h.releases.release('next')
    await until(() => h.answers().length === 2, 'the second request')
    mode.value = 'off'
    h.releases.release('next')
    await until(() => h.answers().length === 3, 'the third request')
    mode.value = 'on'
    h.releases.release('next')
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    const journal = await h.journal()
    expect(journal[0]).toMatchObject({ kind: 'run-started', autoApproval: 'shadow' })
    const decided = journal.filter((event) => event.kind === 'auto-approval' || event.kind === 'refused-dialog').map((event) => (event.kind === 'auto-approval' ? [event.mode, event.outcome] : ['off', event.kind]))
    expect(decided).toEqual([
      ['shadow', 'would-allow'],
      ['on', 'park'],
      ['on', 'park-answered'],
      ['off', 'refused-dialog'],
      ['on', 'deny'],
    ])
  })

  it('In Off the Run\'s Session starts as before: no TMPDIR and no git environment of the run', async () => {
    const h = harness({ mode: { value: 'off' } })
    await h.runToEnd()
    expect(h.requests.map((request) => request.environment)).toEqual([undefined])
  })

  it('the Run\'s Session gets the Run\'s TMPDIR and git environment in Shadow; the folder is gone after run-stopped', async () => {
    const h = harness({ mode: { value: 'shadow' } })
    await h.runToEnd()
    const run = (await h.journal())[0]!.run
    const folder = join(h.env.WORFY_DATA_DIR, 'autopilot-tmp', run)
    // The repository has no hooks and no program in its config: no GIT_NO_LAZY_FETCH.
    expect(h.requests.map((request) => request.environment)).toEqual([
      { TMPDIR: folder, GIT_CONFIG_PARAMETERS: "'safe.bareRepository'='explicit' 'log.showSignature'='false' 'format.pretty'='medium'" },
    ])
    expect(existsSync(folder)).toBe(false)
    expect(existsSync(join(h.env.WORFY_DATA_DIR, 'autopilot-tmp'))).toBe(true)
  })

  it('a repository with hooks also gets GIT_NO_LAZY_FETCH=1', async () => {
    writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 0\n')
    const h = harness({ mode: { value: 'on' } })
    await h.runToEnd()
    expect(h.requests.map((request) => request.environment?.['GIT_NO_LAZY_FETCH'])).toEqual(['1'])
  })

  it('git is approved to a process that started with the run\'s git environment, and parked for one that started in Off', async () => {
    const started = harness({ mode: { value: 'on' }, script: 'auto-approve-claude-git' })
    await started.runToEnd()
    expect(started.answers()).toEqual([expect.objectContaining({ behavior: 'allow' })])
    expect((await started.journal()).find((event) => event.kind === 'auto-approval')).toMatchObject({ mode: 'on', outcome: 'allow', rule: 'git-in-wave-worktree' })
    for (const autopilot of autopilots) await autopilot.stopAll()
    removeTestTree(join(scratch, 'data-root'))
    for (const num of [1, 2]) writeFileSync(ticketPath(num), ticketText(num, 'open'))

    const mode = { value: 'off' as AutoApprovalMode }
    const off = harness({ mode, script: 'auto-approve-claude-git' })
    await off.autopilot.start(PROJECT, EPIC)
    await until(() => off.requests.length === 1, 'the Session to start')
    // The process started in Off; the switch counts from the next request, in the environment it started with.
    mode.value = 'on'
    off.releases.release('next')
    await until(() => off.answers().length === 1, 'the git request')
    expect(off.requests.map((request) => request.environment)).toEqual([undefined])
    expect(off.answers()).toEqual([{ behavior: 'deny', message: DENIED_MESSAGE }])
    expect(off.parked.map((request) => request.parked?.rule)).toEqual(['git-without-run-environment'])
    await until(() => off.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    expect((await off.journal()).filter((event) => event.kind === 'auto-approval')).toMatchObject([
      { mode: 'on', outcome: 'park', rule: 'git-without-run-environment' },
      { mode: 'on', outcome: 'park-answered', rule: 'git-without-run-environment' },
    ])
  })

  it('a policy that cannot start: run-started says off, the Session starts as before, and every request is refused as before', async () => {
    const h = harness({ mode: { value: 'on' }, fails: 'open' })
    await h.runToEnd()
    const journal = await h.journal()
    expect(journal[0]).toMatchObject({ kind: 'run-started', autoApproval: 'off' })
    expect(h.requests.map((request) => request.environment)).toEqual([undefined])
    expect(journal.filter((event) => event.kind === 'auto-approval')).toEqual([])
    expect(h.answers().every((answer) => answer.behavior === 'deny' && answer.message.startsWith(UNATTENDED_DENIED_MESSAGE) && !answer.message.includes(HINTS.notJudged))).toBe(true)
    expect(existsSync(join(h.env.WORFY_DATA_DIR, 'autopilot-tmp')) ? readdirSync(join(h.env.WORFY_DATA_DIR, 'autopilot-tmp')) : []).toEqual([])
  })

  it('a policy that throws while it judges: the agent gets the refusal of before, and the journal a deny of policy-failed', async () => {
    const h = harness({ mode: { value: 'on' }, fails: 'judge' })
    await h.runToEnd()
    expect(h.answers()).toEqual([
      { behavior: 'deny', message: unattendedDeniedMessage('Dangerous rm operation on statically-unresolvable target') },
      { behavior: 'deny', message: unattendedDeniedMessage('Dangerous rm operation on statically-unresolvable target') },
      { behavior: 'deny', message: unattendedDeniedMessage('Dangerous rm operation on statically-unresolvable target') },
      { behavior: 'deny', message: unattendedDeniedMessage('Dangerous rm operation on statically-unresolvable target') },
    ])
    const lines = (await h.journal()).filter((event) => event.kind === 'auto-approval')
    expect(lines.map((event) => (event.kind === 'auto-approval' ? [event.mode, event.outcome, event.rule] : []))).toEqual(Array(4).fill(['on', 'deny', 'policy-failed']))
  })

  it('a run whose Orchestrator is on Codex keeps its policy as on Claude Code (worfy-auto-approve ticket 05): its mode in run-started, a line per request, no folder left', async () => {
    const h = harness({ mode: { value: 'on' }, vendor: 'codex' })
    await h.runToEnd()
    const journal = await h.journal()
    expect(journal[0]).toMatchObject({ kind: 'run-started', vendor: 'codex', autoApproval: 'on' })
    // The four requests, the parked one with the owner's answer (ticket 07).
    expect(journal.filter((event) => event.kind === 'auto-approval').map((line) => line.outcome)).toEqual(['allow', 'park', 'park-answered', 'hard-deny', 'deny'])
    expect(existsSync(join(h.env.WORFY_DATA_DIR, 'autopilot-tmp')) ? readdirSync(join(h.env.WORFY_DATA_DIR, 'autopilot-tmp')) : []).toEqual([])
  })

  it('a run given no policy (no Auto-approval wired) starts its Session as before: no environment of its own', async () => {
    const h = harness()
    await h.runToEnd()
    expect(h.requests.map((request) => request.environment)).toEqual([undefined])
    expect(observed(h)).toEqual(JSON.parse(readFileSync(BASELINE, 'utf8')))
  })
})

// Park in a run (worfy-auto-approve ticket 07, round 2 of the review of PR #1467): a background task whose request
// is parked waits for the owner without the run calling it stalled, and a graceful Stop ends the wait.
describe('A parked request of a background task in an Autopilot run (worfy-auto-approve ticket 07)', () => {
  const REASON = 'Dangerous rm operation on statically-unresolvable target'
  const refusedWith = (hint: string) => ({ behavior: 'deny', message: `${UNATTENDED_DENIED_MESSAGE}\nrefused because: ${REASON}\n${hint}` })

  /** A run whose Wave's turn ended with one implementer in the background, whose first request is parked. */
  async function parkedInTasks(clock: ManualClock) {
    const h = harness({ mode: { value: 'on' }, script: 'auto-approve-claude-park', answerParked: 'none', tasksClock: clock })
    await h.autopilot.start(PROJECT, EPIC)
    await until(() => h.parked.length === 1, 'the parked request')
    await until(() => clock.pending().includes(BACKGROUND_STALL_MS), 'the wait for the background task')
    return h
  }

  it('the silence limit of the background tasks starts over while the request waits, and the refusal reaches the task', async () => {
    const clock = new ManualClock()
    const h = await parkedInTasks(clock)
    const sets = clock.sets
    clock.fire(BACKGROUND_STALL_MS)
    await until(() => clock.sets > sets, 'the limit to start over')
    expect(h.autopilot.state(PROJECT).status).toBe('running')
    expect(clock.pending()).toEqual([BACKGROUND_STALL_MS])
    // The request ends without the owner's answer, as at its limit: the task gets the refusal with the hint,
    // and the end of the park is a sign of life of the task — the silence limit starts over again.
    const before = clock.sets
    h.parkedSession(0).releaseParked()
    await until(() => h.answers().length === 1, 'the refusal')
    expect(h.answers()).toEqual([refusedWith(PARK_EXPIRED_HINT)])
    expect(clock.sets).toBeGreaterThan(before)
    expect(h.autopilot.state(PROJECT).status).toBe('running')
    // The next request of the task parks again; the owner allows it, and the Wave ends as usual.
    h.releases.release('next')
    await until(() => h.parked.length === 2, 'the second parked request')
    expect(h.answerParked(1, 'allow')).toBe(true)
    await until(() => h.answers().length === 2, 'the allowed request')
    h.releases.release('next')
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    const lines = (await h.journal()).filter((event) => event.kind === 'auto-approval')
    expect(lines.map((line) => [line.outcome, line.rule])).toEqual([
      ['park', 'outside-roots'],
      ['park-expired', 'outside-roots'],
      ['park', 'outside-roots'],
      ['park-answered', 'outside-roots'],
    ])
    expect(h.autopilot.state(PROJECT).reason).not.toBe('background-stalled')
  })

  it('a graceful Stop ends the parked request at once, and a request the policy would park while the run stops is refused at once', async () => {
    const h = await parkedInTasks(new ManualClock())
    // A parked request may wait while the run goes; once it stops, a request the gate just opened is taken off.
    expect(h.launches).toHaveLength(1)
    expect(h.launches[0]?.parks?.()).toBe(true)
    await h.autopilot.stop(PROJECT)
    expect(h.launches[0]?.parks?.()).toBe(false)
    await until(() => h.answers().length === 1, 'the refusal of the parked request')
    expect(h.answers()).toEqual([refusedWith(PARK_EXPIRED_HINT)])
    h.releases.release('next')
    await until(() => h.answers().length === 2, 'the second request')
    expect(h.parked).toHaveLength(1)
    expect(h.answers()[1]).toEqual(refusedWith(PARK_STOPPED_HINT))
    h.releases.release('next')
    await until(() => h.autopilot.state(PROJECT).status === 'stopped', 'the run to stop')
    const lines = (await h.journal()).filter((event) => event.kind === 'auto-approval')
    expect(lines.slice(0, 3).map((line) => [line.outcome, line.rule])).toEqual([
      ['park', 'outside-roots'],
      ['park-expired', 'outside-roots'],
      ['deny', 'outside-roots'],
    ])
    // The fake agent plays its script again for STOP_TEXT: nothing of it parks either.
    expect(lines.slice(1).filter((line) => line.outcome === 'park')).toEqual([])
    expect(h.parked).toHaveLength(1)
  })
})

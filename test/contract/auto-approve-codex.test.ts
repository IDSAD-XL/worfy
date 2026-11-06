// The approval policy in the approvals of an unattended Codex Session (worfy-auto-approve ticket 05): the
// Codex driver (src/main/vendors/codex/session.ts) on the fake app-server (WORFY_CODEX=fake and a CODEX_HOME
// of the test file, test/setup-contract.ts; the real Codex never starts), with the run's side of the policy
// (openRunApproval) over a temporary git Project whose Wave has the worktree of Ticket 01.
//
// The fake's script, written by the test with the temporary paths, asks ten approvals of one turn, each
// after the item/started of its item: three commands (a delete inside the Wave's worktree, one outside
// every root, one in ~/.ssh), five file changes (inside the worktree; outside every root; inside with a
// grantRoot outside; inside with a move_path outside; inside with a folder of the worktree as grantRoot), input to a
// running command (kind writeStdin) and a command's request for network access. Off answers as before the ticket, Shadow judges and declines, On
// accepts what the policy allows. What worfy answered is read from the fake's log (WORFY_CODEX_LOG).
import { execFileSync, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openRunApproval, type RunApproval } from '../../src/main/agent/auto-approve/run-approval'
import { hasExited } from '../../src/main/agent/session/process'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { UNATTENDED_DECLINED_MESSAGE } from '../../src/main/vendors/codex/approvals'
import { codexSessions } from '../../src/main/vendors/codex/session'
import type { ApprovalDecided, ApprovalWhere, RefusalDetails, SessionApproval, SessionHandle } from '../../src/main/vendors/session'
import type { AgentEvent } from '../../src/shared/agent/events'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'
import type { AutoApprovalMode } from '../../src/shared/settings/app-settings'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const REPO = join(import.meta.dirname, '..', '..')
const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }
const EPIC = 'demo'
const THREAD = 'thr_fake_1'
const TURN = 'turn_1'
const AT = 1793000000000

let scratch: string
let repo: string
let worktree: string
let outside: string
const handles: SessionHandle[] = []
const children: ChildProcess[] = []
const runs: RunApproval[] = []

/** git with no config of this Machine: the reads of the run see only the repository's own. */
const gitEnv = (): NodeJS.ProcessEnv => ({ ...process.env, GIT_CONFIG_GLOBAL: join(scratch, 'no-global-config'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_PARAMETERS: '' })
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=demo', '-c', 'user.email=demo@example.invalid', '-c', 'init.defaultBranch=main', ...args], { cwd, env: gitEnv(), encoding: 'utf8' })

beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-aa05-')))
  repo = join(scratch, 'repo')
  outside = join(scratch, 'outside')
  worktree = join(repo, '.claude', 'worktrees', '01')
  mkdirSync(join(repo, '.scratch', EPIC, 'issues'), { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(repo, '.gitignore'), '.claude/\n')
  writeFileSync(join(repo, 'README.md'), 'old\n')
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'demo')
  git(repo, 'worktree', 'add', '-q', '-b', `${EPIC}/01`, worktree)
})

afterEach(async () => {
  for (const handle of handles.splice(0)) handle.close()
  for (const child of children.splice(0)) {
    if (child.pid === undefined || hasExited(child)) continue
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGKILL')
    await exited
  }
  for (const run of runs.splice(0)) await run.close()
  removeTestTree(scratch)
})

/** Waits until `check` holds, looking every 20 ms. */
async function eventually(check: () => boolean, what: string, limit = 10_000): Promise<void> {
  const deadline = Date.now() + ms(limit)
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`not in time: ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

type Step = Record<string, unknown>

const THREAD_ITEM = (cwd: string) => ({
  id: THREAD,
  sessionId: `ses_${THREAD}`,
  cliVersion: '0.166.0',
  createdAt: 1793000000,
  updatedAt: 1793000000,
  cwd,
  ephemeral: false,
  modelProvider: 'openai',
  model: 'gpt-5.5-codex',
  originator: 'worfy',
  preview: '',
  projectId: null,
  source: 'appServer',
  status: { type: 'idle' },
  turns: [],
})

/** A command's item and its approval request; `extra` goes into the request's params. */
function command(id: string, text: string, cwd: string, extra: Record<string, unknown> = {}): Step[] {
  return [
    { notify: 'item/started', params: { threadId: THREAD, turnId: TURN, startedAtMs: AT, item: { type: 'commandExecution', id, command: text, commandActions: [{ type: 'unknown', command: text }], cwd, status: 'inProgress' } } },
    { request: 'item/commandExecution/requestApproval', params: { threadId: THREAD, turnId: TURN, itemId: id, startedAtMs: AT, command: text, cwd, reason: 'The command runs outside the sandbox.', ...extra } },
  ]
}

const update = (path: string, movePath: string | null = null) => ({ path, kind: { type: 'update', move_path: movePath }, diff: '@@ -1 +1 @@\n-old\n+new\n' })

/** A file change's item and its approval request. */
function change(id: string, changes: ReturnType<typeof update>[], grantRoot: string | null): Step[] {
  return [
    { notify: 'item/started', params: { threadId: THREAD, turnId: TURN, startedAtMs: AT, item: { type: 'fileChange', id, status: 'inProgress', changes } } },
    { request: 'item/fileChange/requestApproval', params: { threadId: THREAD, turnId: TURN, itemId: id, startedAtMs: AT, reason: 'The change writes a file.', grantRoot } },
  ]
}

/** The ten approvals of the turn, in the order the fake asks them. */
function approvals(): Step[] {
  return [
    ...command('cmd_inside', `rm -rf '${join(worktree, 'build')}'`, worktree, { kind: 'command' }),
    ...command('cmd_outside', `rm -rf '${join(outside, 'build')}'`, worktree),
    ...command('cmd_hard', `rm -rf '${join(homedir(), '.ssh', 'demo-key')}'`, worktree),
    ...change('patch_inside', [update(join(worktree, 'README.md'))], null),
    ...change('patch_outside', [update(join(outside, 'README.md'))], null),
    ...change('patch_grant_outside', [update(join(worktree, 'README.md'))], outside),
    ...change('patch_move_outside', [update(join(worktree, 'README.md'), join(outside, 'README.md'))], null),
    ...change('patch_grant_inside', [update(join(worktree, 'README.md'))], join(worktree, 'src')),
    ...command('cmd_stdin', 'y', worktree, { kind: 'writeStdin' }),
    ...command('cmd_network', `rm -rf '${join(worktree, 'cache')}'`, worktree, { networkApprovalContext: { host: 'example.com', protocol: 'https' } }),
  ]
}

/** The fake's script: the handshake, a thread in the Project's root, one turn with `steps`. */
function writeScript(dir: string, steps: Step[]): void {
  const lines: Step[] = [
    { expect: 'initialize', result: { codexHome: '/fake/codex-home', platformFamily: 'unix', platformOs: 'macos', userAgent: 'worfy-fake-app-server/0.166.0' } },
    { expect: 'initialized' },
    {
      expect: 'thread/start',
      result: { approvalPolicy: 'on-request', approvalsReviewer: 'user', cwd: repo, model: 'gpt-5.5-codex', modelProvider: 'openai', reasoningEffort: null, sandbox: { type: 'workspaceWrite' }, thread: THREAD_ITEM(repo) },
    },
    { expect: 'turn/start', result: { turn: { id: TURN, items: [], status: 'inProgress' } } },
    { notify: 'turn/started', params: { threadId: THREAD, turn: { id: TURN, items: [], status: 'inProgress', startedAt: 1793000000 } } },
    ...steps,
    { notify: 'turn/completed', params: { threadId: THREAD, turn: { id: TURN, items: [], status: 'completed', startedAt: 1793000000, completedAt: 1793000003, durationMs: 3000 } } },
  ]
  writeFileSync(join(dir, 'auto-approve.jsonl'), lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
}

interface Logged {
  id?: number | string
  method?: string
  result?: { decision?: unknown }
}

interface RunOptions {
  /** The Auto-approval mode; null: the Session is given no policy at all (as before the ticket). */
  mode: AutoApprovalMode | null
  /** The environment of the app-server (process.env by default). */
  env?: NodeJS.ProcessEnv
  /** `mode`: reading the mode throws; `judge`: every judging rejects. */
  broken?: 'mode' | 'judge'
  /** Each judging waits for it; with it the run does not wait for the turn's result. */
  hold?: Promise<void>
}

/** One unattended Codex Session over the fake, with the run's policy as agent/session.ts hands it to the driver. */
async function codexRun(options: RunOptions) {
  const dir = mkdtempSync(join(scratch, 'codex-'))
  writeScript(dir, approvals())
  const log = join(dir, 'codex.log')
  const run = await openRunApproval({
    root: repo,
    epic: EPIC,
    dataDir: join(scratch, 'data'),
    harnessHome: join(scratch, 'harness-home'),
    shellEnv: { HOME: homedir(), USERPROFILE: homedir() },
    gitEnv: gitEnv(),
    sessions: { list: () => [] },
  })
  runs.push(run)
  run.setWave(['01'])
  const { mode } = options
  // As agent/session.ts: the run's variables only in Shadow and On; in Off the process starts as before.
  const environment = mode === null || mode === 'off' ? {} : run.environment
  const decided: ApprovalDecided[] = []
  const wheres: ApprovalWhere[] = []
  const refused: [string, string, RefusalDetails][] = []
  const spawnedEnv: NodeJS.ProcessEnv[] = []
  let settled = 0
  const approval: SessionApproval | undefined =
    mode === null
      ? undefined
      : {
          mode: () => {
            if (options.broken === 'mode') throw new Error('the setting cannot be read')
            return mode
          },
          judge: async (request, where) => {
            wheres.push(where)
            if (options.broken === 'judge') throw new Error('the policy broke')
            await options.hold
            const decision = await run.judge(request, { ...where, sessionId: 'worfy-session-1', started: environment })
            settled++
            return decision
          },
          decided: (decision) => decided.push(decision),
        }
  const spawnProcess = (_file: string, args: readonly string[], spawnOptions: SpawnOptions): ChildProcess => {
    spawnedEnv.push(spawnOptions.env ?? {})
    const child = spawn(scriptNode(), [...args], spawnOptions)
    children.push(child)
    return child
  }
  const part = codexSessions(() =>
    Promise.resolve({
      runtime: RUNTIME,
      appPath: REPO,
      clientVersion: '9.9.9',
      env: { ...(options.env ?? process.env), WORFY_CODEX: 'fake', WORFY_CODEX_SCRIPTS: dir, WORFY_CODEX_SCRIPT: 'auto-approve', WORFY_CODEX_LOG: log },
      spawnProcess,
      log: () => undefined,
    }),
  )
  const handle = await part.start({
    cwd: repo,
    settings: DEFAULT_SETTINGS,
    unattended: true,
    orchestrator: true,
    permissions: { ask: () => Promise.reject(new Error('an unattended Session asks no one')), askQuestions: () => Promise.reject(new Error('an unattended Session asks no one')) },
    refused: (subject, message, details) => refused.push([subject, message, details]),
    ...(approval === undefined ? {} : { approval }),
    ...(Object.keys(environment).length === 0 ? {} : { environment }),
    stderr: () => undefined,
    spawned: () => undefined,
    sessionId: 'worfy-session-1',
  })
  handles.push(handle)
  const events: AgentEvent[] = []
  void (async () => {
    try {
      for await (const event of handle.events) events.push(event)
    } catch {
      // The process ended: the test looks at what it answered.
    }
  })()
  await handle.send({ text: 'Run the Wave', attachments: [] })
  if (options.hold === undefined) await eventually(() => events.some((event) => event.type === 'result'), `the turn's result; the events: ${JSON.stringify(events)}`)
  const logged = (): Logged[] =>
    readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Logged)
  const answers = (): unknown[] => logged().filter((message) => message.method === undefined).map((message) => message.result?.decision)
  return { decided, wheres, refused, spawnedEnv, answers, run, events, handle, settled: () => settled }
}

const DECLINED_ALL = Array(10).fill('decline')

describe('Auto-approval of an unattended Codex Session (worfy-auto-approve ticket 05)', () => {
  it('Off: every approval is declined at once and reported as refused, as without a policy; the policy is not asked and the process gets no variables of the run', async () => {
    const before = await codexRun({ mode: null })
    const off = await codexRun({ mode: 'off' })
    expect(off.answers()).toEqual(DECLINED_ALL)
    expect(off.answers()).toEqual(before.answers())
    expect(off.refused).toEqual(before.refused)
    expect(off.refused).toHaveLength(10)
    expect(off.refused.every(([, message]) => message === UNATTENDED_DECLINED_MESSAGE)).toBe(true)
    expect(off.refused[0]).toEqual([`rm -rf '${join(worktree, 'build')}'`, UNATTENDED_DECLINED_MESSAGE, { reason: 'The command runs outside the sandbox.' }])
    expect(off.wheres).toEqual([])
    expect(off.decided).toEqual([])
    // The same environment as without a policy: no TMPDIR, no git variables of the run.
    expect(off.spawnedEnv[0]?.['TMPDIR']).toBe(before.spawnedEnv[0]?.['TMPDIR'])
    expect(off.spawnedEnv[0]?.['GIT_CONFIG_PARAMETERS']).toBe(before.spawnedEnv[0]?.['GIT_CONFIG_PARAMETERS'])
  })

  it('Shadow: every approval is declined as at Off, and each decision is recorded with what the policy would have done', async () => {
    const shadow = await codexRun({ mode: 'shadow' })
    expect(shadow.answers()).toEqual(DECLINED_ALL)
    // Shadow reports no refusal: each request has its decision instead.
    expect(shadow.refused).toEqual([])
    expect(shadow.decided.map((each) => [each.mode, each.outcome, each.rule, each.tool])).toEqual([
      ['shadow', 'would-allow', 'files-inside-roots', 'commandExecution'],
      ['shadow', 'would-park', expect.any(String), 'commandExecution'],
      ['shadow', 'hard-deny', 'hard:ssh', 'commandExecution'],
      ['shadow', 'would-allow', 'edit-inside-roots', 'fileChange'],
      ['shadow', 'would-park', expect.any(String), 'fileChange'],
      ['shadow', 'would-park', expect.any(String), 'fileChange'],
      ['shadow', 'would-park', expect.any(String), 'fileChange'],
      ['shadow', 'would-park', 'grant-root', 'fileChange'],
      ['shadow', 'would-park', 'unknown-tool', 'writeStdin'],
      ['shadow', 'would-park', 'unknown-tool', 'networkAccess'],
    ])
    expect(shadow.decided[0]).toMatchObject({ command: `rm -rf '${join(worktree, 'build')}'`, reason: 'The command runs outside the sandbox.' })
    expect(shadow.decided[3]).toMatchObject({ command: null, reason: 'The change writes a file.' })
  })

  it('On: accept inside the Wave\'s worktree; decline outside every root, on a hard deny, a grantRoot or a move_path outside the roots, a grantRoot inside them, input to a running command and a request for network access', async () => {
    const on = await codexRun({ mode: 'on' })
    expect(on.answers()).toEqual(['accept', 'decline', 'decline', 'accept', 'decline', 'decline', 'decline', 'decline', 'decline', 'decline'])
    expect(on.refused).toEqual([])
    expect(on.decided.map((each) => [each.mode, each.outcome, each.rule])).toEqual([
      ['on', 'allow', 'files-inside-roots'],
      ['on', 'park', expect.any(String)],
      ['on', 'hard-deny', 'hard:ssh'],
      ['on', 'allow', 'edit-inside-roots'],
      ['on', 'park', expect.any(String)],
      ['on', 'park', expect.any(String)],
      ['on', 'park', expect.any(String)],
      ['on', 'park', 'grant-root'],
      ['on', 'park', 'unknown-tool'],
      ['on', 'park', 'unknown-tool'],
    ])
    // The grantRoot and the move_path are judged as paths the change writes.
    const slash = (paths: readonly string[]): string[] => paths.map((path) => path.replaceAll('\\', '/'))
    expect(slash(on.decided[5]?.targets ?? [])).toContain(outside.replaceAll('\\', '/'))
    expect(slash(on.decided[6]?.targets ?? [])).toContain(join(outside, 'README.md').replaceAll('\\', '/'))
    // Each decision is for one request: Codex is never told acceptForSession.
    expect(on.answers()).not.toContain('acceptForSession')
  })

  it('each request is judged in the whole environment the app-server process got, the run\'s variables included; a command in the folder Codex names', async () => {
    const on = await codexRun({ mode: 'on' })
    const spawned = on.spawnedEnv[0]
    expect(spawned?.['TMPDIR']).toBe(on.run.runTemp)
    expect(spawned?.['GIT_CONFIG_PARAMETERS']).toBe(on.run.environment['GIT_CONFIG_PARAMETERS'])
    expect(on.wheres).toHaveLength(10)
    for (const where of on.wheres) expect(where.env).toEqual(spawned)
    expect(on.wheres[0]).toMatchObject({ cwd: worktree, scratchpad: null })
    // A file change is judged from the Session's folder.
    expect(on.wheres[3]).toMatchObject({ cwd: repo, scratchpad: null })
  })

  it('a request closed while it is judged is answered cancel once, and its decision is not reported', async () => {
    let release = (): void => undefined
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const on = await codexRun({ mode: 'on', hold })
    await eventually(() => on.wheres.length === 1, 'the first approval being judged')
    on.handle.close()
    await eventually(() => children.every(hasExited), 'the app-server exited')
    release()
    await eventually(() => on.settled() === 1, 'the judging to end')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(on.answers()).toEqual(['cancel'])
    expect(on.decided).toEqual([])
  })

  it('a mode that cannot be read is Off; a judging that fails declines and is reported as policy-failed', async () => {
    const unread = await codexRun({ mode: 'on', broken: 'mode' })
    expect(unread.answers()).toEqual(DECLINED_ALL)
    expect(unread.refused).toHaveLength(10)
    expect(unread.wheres).toEqual([])
    const failing = await codexRun({ mode: 'on', broken: 'judge' })
    expect(failing.answers()).toEqual(DECLINED_ALL)
    expect(failing.refused).toEqual([])
    expect(failing.decided.map((each) => [each.outcome, each.rule])).toEqual(Array(10).fill(['deny', 'policy-failed']))
  })

  it('an app-server without HOME: no home folder, so the policy approves nothing', async () => {
    const env: NodeJS.ProcessEnv = { ...process.env }
    delete env['HOME']
    delete env['USERPROFILE']
    const on = await codexRun({ mode: 'on', env })
    expect(on.answers()).toEqual(DECLINED_ALL)
    expect(on.decided.filter((each) => each.outcome !== 'hard-deny').every((each) => each.rule === 'no-home')).toBe(true)
  })
})

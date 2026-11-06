// The approval policy in the approvals of an unattended Codex Session (worfy-auto-approve ticket 05): the
// Codex driver (src/main/vendors/codex/session.ts) on the fake app-server (WORFY_CODEX=fake and a CODEX_HOME
// of the test file, test/setup-contract.ts; the real Codex never starts), with the run's side of the policy
// (openRunApproval) over a temporary git Project whose Wave has the worktree of Ticket 01.
//
// The fake's script, written by the test with the temporary paths, asks sixteen approvals of one turn, each
// after the item/started of its item, the commands in the form real Codex sends them (`/bin/zsh -lc '<script>'`):
// deletes inside the Wave's worktree, outside every root and in ~/.ssh; five file changes (inside the worktree;
// outside every root; inside with a grantRoot outside; inside with a move_path outside; inside with a folder of the
// worktree as grantRoot); input to a running command (kind writeStdin); a request for network access and one with
// no network asked; two commands that use GH_TOKEN of the app-server's environment; wrappers that are not exactly
// `<shell> -lc <script>`; a bare command. Off answers as before the ticket, Shadow judges and declines, On accepts
// what the policy allows and parks the rest on the Session's gate, whose answer the test gives (`pick`). What worfy
// answered is read from the fake's log (WORFY_CODEX_LOG).
import { execFileSync, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openRunApproval, type RunApproval } from '../../src/main/agent/auto-approve/run-approval'
import { hasExited } from '../../src/main/agent/session/process'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { codexScript, UNATTENDED_DECLINED_MESSAGE } from '../../src/main/vendors/codex/approvals'
import { codexSessions } from '../../src/main/vendors/codex/session'
import type { ApprovalDecided, ApprovalWhere, PermissionAsk, RefusalDetails, SessionApproval, SessionHandle } from '../../src/main/vendors/session'
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

/**
 * A command as Codex 0.166 sends it (test/fixtures/codex-messages/turn.jsonl, approval-declined.jsonl): the login
 * shell with `-lc` and the script as one word — in single quotes, or in double quotes with `"`, `\`, `$` and the
 * backquote escaped when the script holds a single quote.
 */
function zshLc(script: string): string {
  return script.includes("'") ? `/bin/zsh -lc "${script.replace(/["\\$`]/g, (c) => `\\${c}`)}"` : `/bin/zsh -lc '${script}'`
}

/**
 * A path as one single-quoted shell word. A path stays quoted in every script: on Windows its backslashes would
 * otherwise escape the next letter (`C:\\work` reads as the drive-relative `C:work`), which the policy refuses.
 */
const sq = (path: string): string => `'${path}'`

/** The value of GH_TOKEN in the app-server's environment. */
const TOKEN = 'ghs_token05value'

/** The approvals of the turn, in the order the fake asks them. */
function approvals(): Step[] {
  return [
    ...command('cmd_inside', zshLc(`rm -rf ${sq(join(worktree, 'build'))}`), worktree, { kind: 'command' }),
    ...command('cmd_outside', zshLc(`rm -rf '${join(outside, 'build')}'`), worktree),
    ...command('cmd_hard', zshLc(`rm -rf ${sq(join(homedir(), '.ssh', 'demo-key'))}`), worktree),
    ...change('patch_inside', [update(join(worktree, 'README.md'))], null),
    ...change('patch_outside', [update(join(outside, 'README.md'))], null),
    ...change('patch_grant_outside', [update(join(worktree, 'README.md'))], outside),
    ...change('patch_move_outside', [update(join(worktree, 'README.md'), join(outside, 'README.md'))], null),
    ...change('patch_grant_inside', [update(join(worktree, 'README.md'))], join(worktree, 'src')),
    ...command('cmd_stdin', 'y', worktree, { kind: 'writeStdin' }),
    ...command('cmd_network', zshLc(`rm -rf ${sq(join(worktree, 'cache'))}`), worktree, { networkApprovalContext: { host: 'example.com', protocol: 'https' } }),
    // No network asked: an ordinary command.
    ...command('cmd_network_null', zshLc(`rm -rf ${sq(join(worktree, 'cache'))}`), worktree, { networkApprovalContext: null }),
    // A secret of the app-server's environment: the command's shell may not have it (Codex's shell_environment_policy).
    ...command('cmd_token_path', zshLc(`rm -rf "$GH_TOKEN"${sq(join(outside, 'x'))}`), worktree),
    ...command('cmd_token_target', zshLc(`touch ${sq(worktree)}/$GH_TOKEN`), worktree),
    // Wrappers that are not exactly `<shell> -lc <script>`: not unwrapped.
    ...command('cmd_two_words', `${zshLc(`rm -rf ${sq(join(worktree, 'build'))}`)} extra`, worktree),
    ...command('cmd_other_shell', `${join(outside, 'zsh')} -lc "rm -rf ${sq(join(worktree, 'build'))}"`, worktree),
    ...command('cmd_bare', `rm -rf ${sq(join(worktree, 'build'))}`, worktree),
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
  params?: Record<string, unknown>
  result?: { decision?: unknown }
}

/**
 * A preload of the fake's Node (`--import`): once the file WORFY_TEST_INJECT_WHEN exists, it writes the lines
 * WORFY_TEST_INJECT to the fake's stdout — what no script can play, as Codex resolving a request itself while worfy
 * still judges it or the owner still has not answered (test/contract/codex-session.test.ts injects the same way).
 */
const PRELOAD = `
import { existsSync } from 'node:fs'
const when = process.env.WORFY_TEST_INJECT_WHEN
const lines = process.env.WORFY_TEST_INJECT
if (when && lines) {
  const timer = setInterval(() => {
    if (!existsSync(when)) return
    clearInterval(timer)
    process.stdout.write(lines)
  }, 10)
  timer.unref()
}
`

/** Codex's notification that it resolved its request `id` itself. */
const resolved = (id: number): string => `${JSON.stringify({ method: 'serverRequest/resolved', params: { threadId: THREAD, requestId: id } })}\n`

interface RunOptions {
  /** The Auto-approval mode; null: the Session is given no policy at all (as before the ticket). */
  mode: AutoApprovalMode | null
  /** The mode the Session's process started in, when the owner switched since; `mode` by default. */
  startedIn?: AutoApprovalMode
  /** The environment of the app-server (process.env by default). */
  env?: NodeJS.ProcessEnv
  /** `mode`: reading the mode throws; `judge`: every judging rejects; `decided`: every report of a decision throws. */
  broken?: 'mode' | 'judge' | 'decided'
  /** Each judging waits for it; with it the run does not wait for the turn's result. */
  hold?: Promise<void>
  /** The approvals of the turn; approvals() by default. */
  steps?: Step[]
  /** The owner's answer to a request on the Session's gate; without it the gate rejects, as an unattended Session's did. */
  pick?: (ask: PermissionAsk) => Promise<string | null>
  /** Whether a parked request may wait for the owner (SessionApproval.parks); absent: the policy has no such check. */
  parks?: () => boolean
  /** Lines the fake writes to worfy when the test calls inject() (PRELOAD). */
  inject?: string
}

/** One unattended Codex Session over the fake, with the run's policy as agent/session.ts hands it to the driver. */
async function codexRun(options: RunOptions) {
  const dir = mkdtempSync(join(scratch, 'codex-'))
  writeScript(dir, options.steps ?? approvals())
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
  const startedIn = options.startedIn ?? mode
  const environment = startedIn === null || startedIn === 'off' ? {} : run.environment
  const decided: ApprovalDecided[] = []
  const wheres: ApprovalWhere[] = []
  const refused: [string, string, RefusalDetails][] = []
  const spawnedEnv: NodeJS.ProcessEnv[] = []
  const asked: PermissionAsk[] = []
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
          decided: (decision) => {
            decided.push(decision)
            if (options.broken === 'decided') throw new Error('the window is gone')
          },
          ...(options.parks === undefined ? {} : { parks: options.parks }),
        }
  const signal = join(dir, 'inject-now')
  const preload = join(dir, 'preload.mjs')
  writeFileSync(preload, PRELOAD)
  const spawnProcess = (_file: string, args: readonly string[], spawnOptions: SpawnOptions): ChildProcess => {
    spawnedEnv.push(spawnOptions.env ?? {})
    const injected = options.inject === undefined ? {} : { WORFY_TEST_INJECT_WHEN: signal, WORFY_TEST_INJECT: options.inject }
    const child = spawn(scriptNode(), [...(options.inject === undefined ? [] : ['--import', pathToFileURL(preload).href]), ...args], { ...spawnOptions, env: { ...spawnOptions.env, ...injected } })
    children.push(child)
    return child
  }
  const part = codexSessions(() =>
    Promise.resolve({
      runtime: RUNTIME,
      appPath: REPO,
      clientVersion: '9.9.9',
      env: { ...(options.env ?? process.env), GH_TOKEN: TOKEN, WORFY_CODEX: 'fake', WORFY_CODEX_SCRIPTS: dir, WORFY_CODEX_SCRIPT: 'auto-approve', WORFY_CODEX_LOG: log },
      spawnProcess,
      log: () => undefined,
    }),
  )
  const handle = await part.start({
    cwd: repo,
    settings: DEFAULT_SETTINGS,
    unattended: true,
    orchestrator: true,
    permissions: {
      ask: (ask) => {
        asked.push(ask)
        return options.pick === undefined ? Promise.reject(new Error('an unattended Session asks no one')) : options.pick(ask)
      },
      askQuestions: () => Promise.reject(new Error('an unattended Session asks no one')),
    },
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
  /** The params of the thread/start worfy sent. */
  const threadStart = (): Record<string, unknown> | undefined => logged().find((message) => message.method === 'thread/start')?.params
  const inject = (): void => writeFileSync(signal, '')
  return { decided, wheres, refused, spawnedEnv, asked, answers, threadStart, inject, run, events, handle, settled: () => settled }
}

const COUNT = 16
const DECLINED_ALL = Array(COUNT).fill('decline')

describe('Auto-approval of an unattended Codex Session (worfy-auto-approve ticket 05)', () => {
  it('Off: every approval is declined at once and reported as refused, as without a policy; the policy is not asked and the process gets no variables of the run', async () => {
    const before = await codexRun({ mode: null })
    const off = await codexRun({ mode: 'off' })
    expect(off.answers()).toEqual(DECLINED_ALL)
    expect(off.answers()).toEqual(before.answers())
    expect(off.refused).toEqual(before.refused)
    expect(off.refused).toHaveLength(COUNT)
    expect(off.refused.every(([, message]) => message === UNATTENDED_DECLINED_MESSAGE)).toBe(true)
    expect(off.refused[0]).toEqual([zshLc(`rm -rf ${sq(join(worktree, 'build'))}`), UNATTENDED_DECLINED_MESSAGE, { reason: 'The command runs outside the sandbox.' }])
    expect(off.wheres).toEqual([])
    expect(off.decided).toEqual([])
    expect(off.asked).toEqual([])
    // The same environment as without a policy: no TMPDIR, no git variables of the run.
    expect(off.spawnedEnv[0]?.['TMPDIR']).toBe(before.spawnedEnv[0]?.['TMPDIR'])
    expect(off.spawnedEnv[0]?.['GIT_CONFIG_PARAMETERS']).toBe(before.spawnedEnv[0]?.['GIT_CONFIG_PARAMETERS'])
    // The same thread: no variable pinned in Codex's shell environment.
    expect(off.threadStart()).toEqual(before.threadStart())
    expect(off.threadStart()?.['config']).toBeUndefined()
  })

  it('Shadow: every approval is declined as at Off, and each decision is recorded with what the policy would have done', async () => {
    const shadow = await codexRun({ mode: 'shadow' })
    expect(shadow.answers()).toEqual(DECLINED_ALL)
    // Shadow reports no refusal: each request has its decision instead; nothing waits for the owner.
    expect(shadow.refused).toEqual([])
    expect(shadow.asked).toEqual([])
    expect(shadow.decided.map((each) => [each.mode, each.outcome, each.rule, each.tool])).toEqual([
      ['shadow', 'would-allow', 'files-inside-roots+shell-script-inside-roots', 'commandExecution'],
      ['shadow', 'would-park', expect.any(String), 'commandExecution'],
      ['shadow', 'hard-deny', 'hard:ssh', 'commandExecution'],
      ['shadow', 'would-allow', 'edit-inside-roots', 'fileChange'],
      ['shadow', 'would-park', expect.any(String), 'fileChange'],
      ['shadow', 'would-park', expect.any(String), 'fileChange'],
      ['shadow', 'would-park', expect.any(String), 'fileChange'],
      ['shadow', 'would-park', 'grant-root', 'fileChange'],
      ['shadow', 'would-park', 'unknown-tool', 'writeStdin'],
      ['shadow', 'would-park', 'unknown-tool', 'networkAccess'],
      ['shadow', 'would-allow', 'files-inside-roots+shell-script-inside-roots', 'commandExecution'],
      ['shadow', 'would-deny', 'not-judged', 'commandExecution'],
      ['shadow', 'would-deny', 'not-judged', 'commandExecution'],
      // Not unwrapped (a word after the script): a program outside every root.
      ['shadow', 'would-park', expect.any(String), 'commandExecution'],
      ['shadow', 'would-park', expect.any(String), 'commandExecution'],
      ['shadow', 'would-allow', 'files-inside-roots', 'commandExecution'],
    ])
    expect(shadow.decided[0]).toMatchObject({ command: zshLc(`rm -rf ${sq(join(worktree, 'build'))}`), reason: 'The command runs outside the sandbox.' })
    expect(shadow.decided[3]).toMatchObject({ command: null, reason: 'The change writes a file.' })
  })

  it('On: accept inside the Wave\'s worktree; decline outside every root, on a hard deny and on not-judged; a grantRoot or a move_path outside the roots, a grantRoot inside them, input to a running command and a request for network access wait for the owner, who declines here', async () => {
    const on = await codexRun({ mode: 'on', pick: () => Promise.resolve('decline') })
    expect(on.answers()).toEqual(['accept', 'decline', 'decline', 'accept', 'decline', 'decline', 'decline', 'decline', 'decline', 'decline', 'accept', 'decline', 'decline', 'decline', 'decline', 'accept'])
    expect(on.refused).toEqual([])
    const parked = (rule: unknown) => [
      ['on', 'park', rule],
      ['on', 'park-answered', rule],
    ]
    expect(on.decided.map((each) => [each.mode, each.outcome, each.rule])).toEqual([
      ['on', 'allow', 'files-inside-roots+shell-script-inside-roots'],
      ...parked(expect.any(String)),
      ['on', 'hard-deny', 'hard:ssh'],
      ['on', 'allow', 'edit-inside-roots'],
      ...parked(expect.any(String)),
      ...parked(expect.any(String)),
      ...parked(expect.any(String)),
      ...parked('grant-root'),
      ...parked('unknown-tool'),
      ...parked('unknown-tool'),
      ['on', 'allow', 'files-inside-roots+shell-script-inside-roots'],
      ['on', 'deny', 'not-judged'],
      ['on', 'deny', 'not-judged'],
      ...parked(expect.any(String)),
      ...parked(expect.any(String)),
      ['on', 'allow', 'files-inside-roots'],
    ])
    // Each parked request opened on the Session's gate once, marked with the rule and the paths of its park line.
    const parks = on.decided.filter((each) => each.outcome === 'park')
    expect(on.asked).toHaveLength(9)
    expect(on.asked.map((ask) => ask.parked)).toEqual(parks.map((each) => ({ rule: each.rule, targets: each.targets })))
    expect(on.decided.filter((each) => each.outcome === 'park-answered').every((each) => each.answer === 'deny')).toBe(true)
    // A file change with a grantRoot is offered no Accept: it would let Codex write under the root until the Session ends.
    const ids = (n: number): string[] | undefined => on.asked[n]?.options.map((option) => option.id)
    expect(ids(0)).toEqual(['accept', 'decline', 'cancel'])
    expect(ids(2)).toEqual(['decline', 'cancel'])
    expect(ids(4)).toEqual(['decline', 'cancel'])
    expect(ids(3)).toEqual(['accept', 'decline', 'cancel'])
    expect(on.asked[2]?.description).toContain(`Accept is not offered: it would let Codex write under ${outside} until the Session ends`)
    // The card says what Codex gave as the reason, and the host of a request for network access.
    expect(on.asked[0]?.description).toContain('Codex says: The command runs outside the sandbox.')
    expect(on.asked[6]?.description).toContain('Network access to example.com (https).')
    expect(on.asked[0]?.description).not.toContain('Network access')
    // A secret of the app-server's environment is no known value: no decision names it.
    expect(JSON.stringify(on.decided)).not.toContain(TOKEN)
    // The grantRoot and the move_path are judged as paths the change writes.
    const slash = (paths: readonly string[]): string[] => paths.map((path) => path.replaceAll('\\', '/'))
    expect(slash(parks[2]?.targets ?? [])).toContain(outside.replaceAll('\\', '/'))
    expect(slash(parks[3]?.targets ?? [])).toContain(join(outside, 'README.md').replaceAll('\\', '/'))
    // Each decision is for one request: Codex is never told acceptForSession.
    expect(on.answers()).not.toContain('acceptForSession')
  })

  it('each request is judged in the whole environment the app-server process got; no variable has a known value (worfy-auto-approve ticket 14); a command in the folder Codex names', async () => {
    const on = await codexRun({ mode: 'on', pick: () => Promise.resolve('decline') })
    const spawned = on.spawnedEnv[0]
    expect(spawned?.['TMPDIR']).toBe(on.run.runTemp)
    expect(spawned?.['GIT_CONFIG_PARAMETERS']).toBe(on.run.environment['GIT_CONFIG_PARAMETERS'])
    // The home folder (HOME, and USERPROFILE on Windows, as the process has them) and the run's variables are pinned
    // for every command of the thread (shell_environment_policy.set).
    const home = Object.fromEntries(['HOME', 'USERPROFILE'].flatMap((name) => (spawned?.[name] === undefined ? [] : [[name, spawned[name]]])))
    expect(Object.keys(home).length).toBeGreaterThan(0)
    const pinned = { ...home, ...on.run.environment }
    expect(on.threadStart()?.['config']).toEqual(Object.fromEntries(Object.entries(pinned).map(([name, value]) => [`shell_environment_policy.set.${name}`, value])))
    expect(on.wheres).toHaveLength(COUNT)
    for (const where of on.wheres) {
      expect(where.env).toEqual(spawned)
      // Every variable is pinned, but the owner's include_only may still drop any of them.
      expect(where.known).toEqual([])
    }
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
    expect(unread.refused).toHaveLength(COUNT)
    expect(unread.wheres).toEqual([])
    const failing = await codexRun({ mode: 'on', broken: 'judge' })
    expect(failing.answers()).toEqual(DECLINED_ALL)
    expect(failing.refused).toEqual([])
    expect(failing.decided.map((each) => [each.outcome, each.rule])).toEqual(Array(COUNT).fill(['deny', 'policy-failed']))
  })

  describe('a parked request waits for the owner on the Session\'s gate (worfy-auto-approve ticket 07)', () => {
    /** A command outside every root: the policy parks it. */
    const outsideStep = (): Step[] => command('cmd_outside', zshLc(`rm -rf '${join(outside, 'build')}'`), worktree)
    /** The gate's answer once the request is withdrawn, as PermissionGate gives it. */
    const unanswered = (ask: PermissionAsk): Promise<string | null> =>
      new Promise((resolve) => {
        if (ask.signal.aborted) resolve(null)
        ask.signal.addEventListener('abort', () => resolve(null), { once: true })
      })

    it('the owner accepts: Codex is told accept for this one request; the card offers no "Accept for this Session"', async () => {
      const on = await codexRun({ mode: 'on', steps: outsideStep(), pick: () => Promise.resolve('accept') })
      expect(on.answers()).toEqual(['accept'])
      expect(on.decided.map((each) => [each.outcome, each.rule, each.answer])).toEqual([
        ['park', expect.any(String), undefined],
        ['park-answered', on.decided[0]?.rule, 'allow'],
      ])
      expect(on.decided[1]).toMatchObject({ mode: 'on', tool: 'commandExecution', command: zshLc(`rm -rf '${join(outside, 'build')}'`), targets: on.decided[0]?.targets })
      expect(on.asked).toHaveLength(1)
      expect(on.asked[0]?.options.map((option) => option.id)).toEqual(['accept', 'decline', 'cancel'])
      expect(on.asked[0]?.parked).toEqual({ rule: on.decided[0]?.rule, targets: on.decided[0]?.targets })
      expect(on.asked[0]?.toolName).toBe('commandExecution')
    })

    it('the owner picks "Decline and stop the turn": Codex is told cancel', async () => {
      const on = await codexRun({ mode: 'on', steps: outsideStep(), pick: () => Promise.resolve('cancel') })
      expect(on.answers()).toEqual(['cancel'])
      expect(on.decided.map((each) => [each.outcome, each.answer])).toEqual([
        ['park', undefined],
        ['park-answered', 'deny'],
      ])
    })

    it('the run is stopping: the request comes off the gate at once and is declined as one with no answer', async () => {
      const on = await codexRun({ mode: 'on', steps: outsideStep(), pick: unanswered, parks: () => false })
      expect(on.answers()).toEqual(['decline'])
      expect(on.decided.map((each) => each.outcome)).toEqual(['park', 'park-expired'])
      expect(on.asked).toHaveLength(1)
    })

    it('the Session closes while the request waits: Codex is told cancel once, and the park ends as park-expired', async () => {
      const on = await codexRun({ mode: 'on', steps: outsideStep(), pick: unanswered, hold: Promise.resolve() })
      await eventually(() => on.asked.length === 1, 'the request parked on the gate')
      on.handle.close()
      await eventually(() => on.decided.length === 2, 'the park to end')
      await eventually(() => children.every(hasExited), 'the app-server exited')
      expect(on.answers()).toEqual(['cancel'])
      expect(on.decided.map((each) => each.outcome)).toEqual(['park', 'park-expired'])
    })

    it('a request Codex resolves itself while it is judged is not parked, and gets no answer', async () => {
      let release = (): void => undefined
      const hold = new Promise<void>((resolve) => {
        release = resolve
      })
      const on = await codexRun({ mode: 'on', steps: outsideStep(), pick: unanswered, hold, inject: resolved(1) })
      await eventually(() => on.wheres.length === 1, 'the request being judged')
      on.inject()
      // The resolution reaches worfy within the fake's 10 ms look at the file; nothing worfy sends shows it.
      await new Promise((resolve) => setTimeout(resolve, ms(300)))
      release()
      await eventually(() => on.settled() === 1, 'the judging to end')
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(on.asked).toEqual([])
      expect(on.decided).toEqual([])
      on.handle.close()
      await eventually(() => children.every(hasExited), 'the app-server exited')
      expect(on.answers()).toEqual([])
    })

    it('a parked request Codex resolves itself comes off the gate, ends as park-expired and gets no answer', async () => {
      const on = await codexRun({ mode: 'on', steps: outsideStep(), pick: unanswered, hold: Promise.resolve(), inject: resolved(1) })
      await eventually(() => on.asked.length === 1, 'the request parked on the gate')
      on.inject()
      await eventually(() => on.decided.length === 2, 'the park to end')
      expect(on.asked[0]?.signal.aborted).toBe(true)
      expect(on.decided.map((each) => each.outcome)).toEqual(['park', 'park-expired'])
      on.handle.close()
      await eventually(() => children.every(hasExited), 'the app-server exited')
      expect(on.answers()).toEqual([])
    })

    it('a file change with a grantRoot: the card has no Accept, and an Accept the gate passes on anyway is declined', async () => {
      const steps = change('patch_grant_outside', [update(join(worktree, 'README.md'))], outside)
      const on = await codexRun({ mode: 'on', steps, pick: () => Promise.resolve('accept') })
      expect(on.asked[0]?.options.map((option) => option.id)).toEqual(['decline', 'cancel'])
      expect(on.answers()).toEqual(['decline'])
      expect(on.decided.map((each) => each.outcome)).toEqual(['park', 'park-expired'])
    })

    it('a report that throws leaves no request without its answer', async () => {
      const on = await codexRun({ mode: 'on', pick: () => Promise.resolve('decline'), broken: 'decided' })
      expect(on.answers()).toEqual(['accept', 'decline', 'decline', 'accept', 'decline', 'decline', 'decline', 'decline', 'decline', 'decline', 'accept', 'decline', 'decline', 'decline', 'decline', 'accept'])
      expect(on.asked).toHaveLength(9)
    })
  })

  it('a variable not pinned in Codex\'s shell environment has no known value: a command that uses one is not approved, and no decision names its value', async () => {
    const env = { ...process.env, GITHUB_PAT: 'ghp_pat05value', DB_PASS: 'db05value', NPM_AUTH: 'npm05value', DEMO_DIR: worktree }
    const steps = [
      ...command('cmd_pat', zshLc('touch "$TMPDIR/$GITHUB_PAT"'), worktree),
      ...command('cmd_pass', zshLc(`touch ${sq(join(worktree, 'x'))}"$DB_PASS"`), worktree),
      ...command('cmd_auth', zshLc(`touch ${sq(worktree)}/$NPM_AUTH`), worktree),
      ...command('cmd_other', zshLc('touch "$DEMO_DIR/x"'), worktree),
      // The run's TMPDIR is pinned, yet the owner's include_only may drop it (worfy-auto-approve ticket 14).
      ...command('cmd_tmp', zshLc('touch "$TMPDIR/x"'), worktree),
    ]
    const on = await codexRun({ mode: 'on', env, steps, pick: () => Promise.resolve('decline') })
    expect(on.decided.map((each) => [each.outcome, each.rule])).toEqual(Array(5).fill(['deny', 'not-judged']))
    expect(on.answers()).toEqual(Array(5).fill('decline'))
    for (const value of ['ghp_pat05value', 'db05value', 'npm05value']) expect(JSON.stringify(on.decided)).not.toContain(value)
    expect(on.threadStart()?.['config']).toMatchObject({ 'shell_environment_policy.set.TMPDIR': on.run.runTemp })
  })

  it('git inside the login-shell wrapper: judged as git without the run\'s git environment, which the owner\'s include_only may drop (worfy-auto-approve ticket 14), so parked; parked by the policy itself once the repository has a hook', async () => {
    const add = command('cmd_add', zshLc('git add -A'), worktree)
    const clean = await codexRun({ mode: 'on', steps: add })
    // The gate rejects here: the parked request ends without the owner's answer.
    expect(clean.answers()).toEqual(['decline'])
    expect(clean.decided.map((each) => [each.outcome, each.rule])).toEqual([
      ['park', 'git-without-run-environment'],
      ['park-expired', 'git-without-run-environment'],
    ])
    writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 0\n')
    const hooked = await codexRun({ mode: 'on', steps: add })
    // The gate rejects here: the parked request ends without the owner's answer.
    expect(hooked.answers()).toEqual(['decline'])
    expect(hooked.decided.map((each) => [each.outcome, each.rule])).toEqual([
      ['park', 'git-hooks'],
      ['park-expired', 'git-hooks'],
    ])
  })

  // Codex 0.166.0 applies shell_environment_policy.include_only after `set` (codex-rs/protocol/src/shell_environment.rs,
  // populate_env): an include_only of the owner's without these names drops the run's pins from the command's shell.
  it('the owner\'s include_only may drop the run\'s TMPDIR and git environment (worfy-auto-approve ticket 14): a command that needs either is not approved, though both stay pinned', async () => {
    const steps = [
      ...command('cmd_tmp_rm', zshLc('rm -rf "$TMPDIR"/opt/x'), worktree),
      ...command('cmd_git_log', zshLc('git log --oneline -1'), worktree),
    ]
    const on = await codexRun({ mode: 'on', steps })
    expect(on.answers()).toEqual(['decline', 'decline'])
    expect(on.decided.map((each) => [each.outcome, each.rule])).toEqual([
      ['deny', 'not-judged'],
      ['park', 'git-without-run-environment'],
      ['park-expired', 'git-without-run-environment'],
    ])
    expect(on.decided.some((each) => each.outcome === 'allow')).toBe(false)
    expect(on.threadStart()?.['config']).toMatchObject({
      'shell_environment_policy.set.TMPDIR': on.run.runTemp,
      'shell_environment_policy.set.GIT_CONFIG_PARAMETERS': on.run.environment['GIT_CONFIG_PARAMETERS'],
    })
  })

  // The owner's include_only may drop HOME and USERPROFILE as well: bash and sh then expand "$HOME"/x to /x. `~` keeps
  // the home folder: bash and zsh take it from the user database when HOME is not set (round 1 of PR #1498).
  it('HOME and USERPROFILE have no known value either: "$HOME" in bash or sh is not approved, ~ is judged as before', async () => {
    const env = { ...process.env, HOME: scratch, USERPROFILE: scratch }
    const steps = [
      ...command('cmd_bash_home', "/bin/bash -lc 'rm -rf \"$HOME\"/repo/.claude/worktrees/01/build'", worktree),
      ...command('cmd_sh_home', "/bin/sh -c 'mkdir -p \"${HOME}\"/repo/.claude/worktrees/01/build/x'", worktree),
      ...command('cmd_zsh_profile', zshLc('rm -rf "$USERPROFILE"/repo/.claude/worktrees/01/build'), worktree),
    ]
    const on = await codexRun({ mode: 'on', env, steps })
    expect(on.decided.map((each) => [each.outcome, each.rule])).toEqual(Array(3).fill(['deny', 'not-judged']))
    expect(on.answers()).toEqual(Array(3).fill('decline'))
  })

  it.skipIf(process.platform === 'win32')('a ~ path inside the Wave\'s worktree is approved as before', async () => {
    const env = { ...process.env, HOME: scratch }
    const on = await codexRun({ mode: 'on', env, steps: command('cmd_tilde', "/bin/bash -lc 'rm -rf ~/repo/.claude/worktrees/01/build'", worktree) })
    expect(on.decided.map((each) => [each.outcome, each.rule])).toEqual([['allow', 'files-inside-roots+shell-script-inside-roots']])
    expect(on.answers()).toEqual(['accept'])
  })

  it('a Session started in Off and judged after the owner switched to On knows no variable either', async () => {
    const env = { ...process.env, TMPDIR: worktree, DEMO_DIR: worktree }
    const steps = [...command('cmd_tmp', zshLc('touch "$TMPDIR/x"'), worktree), ...command('cmd_demo', zshLc('touch "$DEMO_DIR/x"'), worktree)]
    const on = await codexRun({ mode: 'on', startedIn: 'off', env, steps })
    // Nothing of the run was pinned: the process started in Off.
    expect(JSON.stringify(on.threadStart()?.['config'] ?? {})).not.toContain('shell_environment_policy')
    expect(on.wheres.map((where) => where.known)).toEqual([[], []])
    expect(on.decided.map((each) => [each.outcome, each.rule])).toEqual(Array(2).fill(['deny', 'not-judged']))
    expect(on.answers()).toEqual(['decline', 'decline'])
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

describe('the login-shell wrapper of a Codex command (codexScript)', () => {
  it.each([
    ["/bin/zsh -lc 'ls'", "zsh -c 'ls'"],
    ["/bin/bash -c 'ls'", "bash -c 'ls'"],
    ["sh -lc 'ls'", "sh -c 'ls'"],
    ["/usr/bin/zsh -lc 'ls'", "zsh -c 'ls'"],
    ["/usr/local/bin/bash -lc 'ls'", "bash -c 'ls'"],
    ["/opt/homebrew/bin/zsh -lc 'ls'", "zsh -c 'ls'"],
    ["/bin/zsh -lc 'ls\npwd'", "zsh -c 'ls\npwd'"],
    ['/bin/zsh -lc "echo \\$HOME \\`x\\` \\" \\\\"', 'zsh -c "echo \\$HOME \\`x\\` \\" \\\\"'],
    ['/bin/zsh -lc "it\'s"', 'zsh -c "it\'s"'],
    ["/bin/zsh -lc ''", "zsh -c ''"],
  ])('%s is judged as %s', (command, script) => {
    expect(codexScript(command)).toBe(script)
  })

  it.each([
    "/tmp/zsh -lc 'ls'",
    "/bin/fish -lc 'ls'",
    "/bin/zsh -ilc 'ls'",
    "/bin/zsh -l -c 'ls'",
    '/bin/zsh -lc ls',
    "/bin/zsh  -lc 'ls'",
    "x/bin/zsh -lc 'ls'",
    '/bin/zsh -lc "echo $HOME"',
    '/bin/zsh -lc "echo `id`"',
    '/bin/zsh -lc "echo \\\\$HOME"',
    // One shell word after -lc, nothing after it: no operator, no redirection, no comment, no second part.
    "/bin/zsh -lc 'touch a' && touch b",
    "/bin/zsh -lc 'touch a' 2>&1",
    "/bin/zsh -lc 'touch a' #'",
    "/bin/zsh -lc 'touch a';touch b",
    "/bin/zsh -lc 'touch '$WT_DIR'/x'",
    "/bin/zsh -lc 'touch a'b",
    "/bin/zsh -lc 'a'\\''b'",
    '/bin/zsh -lc "touch a" && touch b',
    '/bin/zsh -lc "touch a"$X',
    "/bin/zsh -lc 'unclosed",
    '/bin/zsh -lc "unclosed',
    '/bin/zsh -lc "ends with \\"',
    '/bin/zsh -lc x"',
    "/bin/zsh -lc x'",
  ])('%s stays as it is', (command) => {
    expect(codexScript(command)).toBe(command)
  })
})

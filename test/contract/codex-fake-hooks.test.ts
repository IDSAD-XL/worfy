// The fake Codex app-server runs the hooks of the installed plugin and keeps the sandbox of a thread as
// the pinned Codex does (worfy-multi-vendor ticket 44; test/fixtures/codex-app-server/hook-runner.mjs).
// The guarantees the Harness keeps on Codex with hooks (ticket 36) and their parity suite (ticket 45) are
// tested on this fake, so here it is held to Codex's rules:
//   - a PreToolUse deny stops the tool, a Stop block keeps the turn going with the reason, events Codex does
//     not know (TaskCompleted, TeammateIdle) never run, and without an approved hash no hook runs;
//   - a read-only thread refuses a file change and a command that writes, a workspace-write one does not:
//     both read-only paths of ticket 36 (deny by agent_type, a read-only thread) can be tested;
//   - the input of every hook has the fields of the inputs the live Codex gave (ticket 30's recordings in
//     test/fixtures/codex-messages/hooks/); recordings without agent_type are red here.
// The plugin is test/fixtures/codex-plugin-probe/, copied into a temporary CODEX_HOME: its hooks record
// their input into PROBE_LOG and decide by PROBE_GATE.
import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { afterEach, describe, expect, it } from 'vitest'
import { codexLaunch } from '../../src/main/vendors/codex/launch'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'
import { approvePluginHooks, hookInput, loadHooks, outcomeOf, runHooks, timeoutSec } from '../fixtures/codex-app-server/hook-runner.mjs'

const REPO = join(import.meta.dirname, '..', '..')
const PROBE = join(REPO, 'test', 'fixtures', 'codex-plugin-probe')
const RECORDINGS = join(REPO, 'test', 'fixtures', 'codex-messages', 'hooks')
const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }
const ANSWER_MS = ms(15_000)

const roots: string[] = []
const children: ChildProcess[] = []
afterEach(() => {
  for (const child of children.splice(0)) child.kill()
  for (const root of roots.splice(0)) removeTestTree(root)
})

interface Message {
  id?: number | string
  method?: string
  params?: Record<string, unknown> & { item?: Record<string, unknown>; run?: Record<string, unknown>; threadId?: string; turn?: { id: string } }
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

interface Logged {
  mode: string
  input: Record<string, unknown>
}

/** A temporary CODEX_HOME with the probe plugin installed, a project folder and the probe's log. */
function setup({ approve = true } = {}) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'worfy-codex-hooks-'))
  roots.push(root)
  const codexHome = join(root, 'codex-home')
  const plugin = join(codexHome, 'plugins', 'cache', 'probe-market', 'probe', 'local')
  cpSync(PROBE, plugin, { recursive: true })
  if (approve) approvePluginHooks(codexHome)
  const project = join(root, 'project')
  mkdirSync(project)
  const log = join(root, 'probe.log')
  const logged = (): Logged[] => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Logged) : [])
  return { root, codexHome, plugin, project, log, logged }
}

/** Starts the fake as launch.ts would, under scriptNode(), with `env` over the test's environment. */
function startFake(cwd: string, env: Record<string, string>) {
  const launch = codexLaunch({ runtime: RUNTIME, appPath: REPO, env: { ...process.env, WORFY_CODEX: 'fake', ...env } })
  const child = spawn(scriptNode(), launch.args, { cwd, env: launch.env, stdio: 'pipe' })
  children.push(child)
  child.stdin.on('error', () => undefined)
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
  const seen: Message[] = []
  let waiter: (() => void) | undefined
  createInterface({ input: child.stdout }).on('line', (line) => {
    seen.push(JSON.parse(line) as Message)
    waiter?.()
  })
  const exit = new Promise<number | null>((resolve) => child.on('exit', resolve))
  return {
    seen,
    send: (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`),
    next: (match: (message: Message) => boolean) =>
      new Promise<Message>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`the fake sent no such message in time; it sent ${JSON.stringify(seen)}; stderr: ${stderr}`)), ANSWER_MS)
        const look = () => {
          const found = seen.find(match)
          if (found === undefined) return
          clearTimeout(timer)
          waiter = undefined
          resolve(found)
        }
        waiter = look
        look()
      }),
    close: async () => {
      child.stdin.end()
      return { code: await exit, stderr }
    },
  }
}

type Fake = ReturnType<typeof startFake>

const answerTo = (id: number) => (message: Message) => message.id === id && message.method === undefined
const turnCompleted = (threadId: string) => (message: Message) => message.method === 'turn/completed' && message.params?.threadId === threadId
const itemsDone = (fake: Fake) => fake.seen.filter((message) => message.method === 'item/completed').map((message) => message.params?.item as Record<string, unknown>)
const runsDone = (fake: Fake, eventName: string) => fake.seen.filter((message) => message.method === 'hook/completed' && message.params?.run?.eventName === eventName).map((message) => message.params?.run as Record<string, unknown>)

/** initialize, thread/start with `thread` params, turn/start; resolves once the script's turn of the thread ends or `until` comes. */
async function playTurn(fake: Fake, thread: Record<string, unknown>, until: (message: Message) => boolean) {
  fake.send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'worfy', version: '0.0.0' } } })
  await fake.next(answerTo(1))
  fake.send({ method: 'initialized' })
  fake.send({ id: 2, method: 'thread/start', params: thread })
  await fake.next(answerTo(2))
  fake.send({ id: 3, method: 'turn/start', params: { threadId: 'thr_fake_1', input: [{ type: 'text', text: 'Work' }] } })
  await fake.next(answerTo(3))
  return fake.next(until)
}

describe('the hooks of the installed plugin, as the pinned Codex runs them', () => {
  it('a PreToolUse deny stops the tool, a Stop block continues the turn with the reason, TaskCompleted never runs', async () => {
    const { codexHome, project, log, logged } = setup()
    const fake = startFake(project, { WORFY_CODEX_SCRIPT: 'hooks', CODEX_HOME: codexHome, PROBE_LOG: log, PROBE_GATE: 'red' })
    await playTurn(fake, { cwd: project }, turnCompleted('thr_fake_1'))

    // The agent's own edit is written; the worfy-reviewer Subagent's edit is denied by agent_type and never runs.
    expect(readFileSync(join(project, 'main.txt'), 'utf8')).toBe('main\n')
    expect(existsSync(join(project, 'review.txt'))).toBe(false)
    expect(itemsDone(fake).map((item) => item.id)).not.toContain('patch_sub_1')
    expect(fake.seen.some((message) => message.method === 'item/started' && message.params?.item?.id === 'patch_sub_1')).toBe(false)
    const denied = runsDone(fake, 'preToolUse').filter((run) => run.status === 'blocked')
    expect(denied).toHaveLength(1)
    expect(denied[0]?.entries).toEqual([{ kind: 'feedback', text: 'A reviewer does not edit files.' }])
    // The reviewer's shell command runs, as Bash of a reviewer of Claude does.
    expect(itemsDone(fake).find((item) => item.id === 'cmd_sub_1')).toMatchObject({ status: 'completed' })

    // Stop blocks while the gate is red: the reason comes back as a hook prompt, the turn goes on, and the
    // next Stop has stop_hook_active and lets the turn end. The SubagentStop blocks the Subagent the same way.
    const prompts = itemsDone(fake).filter((item) => item.type === 'hookPrompt')
    expect(prompts.map((item) => (item.fragments as { text: string }[]).map((fragment) => fragment.text))).toEqual([['The gate is red.'], ['The gate is red.']])
    expect(fake.seen.filter(turnCompleted('thr_sub_1'))).toEqual([])
    expect(fake.seen.filter(turnCompleted('thr_fake_1'))).toHaveLength(1)
    expect(itemsDone(fake).map((item) => item.id)).toContain('msg_2')
    const stops = logged().filter((entry) => entry.input.hook_event_name === 'Stop')
    expect(stops.map((entry) => [entry.input.stop_hook_active, entry.input.last_assistant_message])).toEqual([
      [false, 'Done.'],
      [true, 'Fixed what the hook named.'],
    ])

    // SessionStart and SubagentStart give their context; hook/started goes before each hook/completed.
    expect(runsDone(fake, 'sessionStart').map((run) => run.entries)).toEqual([[{ kind: 'context', text: 'Harness rules.' }]])
    expect(runsDone(fake, 'subagentStart').map((run) => run.entries)).toEqual([[{ kind: 'context', text: 'Harness rules.' }]])
    for (const done of fake.seen.filter((message) => message.method === 'hook/completed')) {
      expect(fake.seen.indexOf(fake.seen.find((message) => message.method === 'hook/started' && message.params?.run?.id === done.params?.run?.id) as Message)).toBeLessThan(fake.seen.indexOf(done))
    }

    const { code } = await fake.close()
    expect(code).toBe(0)
    // SessionEnd ran when worfy left; TaskCompleted and TeammateIdle, which Codex does not know, never did.
    const events = logged().map((entry) => entry.input.hook_event_name)
    expect(events).toContain('SessionEnd')
    expect(events).not.toContain('TaskCompleted')
    expect(events).not.toContain('TeammateIdle')
  })

  it('lets the turn end when Stop does not block, and skips what the agent would do after a block', async () => {
    const { codexHome, project, log } = setup()
    const fake = startFake(project, { WORFY_CODEX_SCRIPT: 'hooks', CODEX_HOME: codexHome, PROBE_LOG: log, PROBE_GATE: 'green' })
    const completed = await playTurn(fake, { cwd: project }, turnCompleted('thr_fake_1'))
    expect(completed.params?.turn).toMatchObject({ id: 'turn_1', completedAt: 1793000005 })
    expect(fake.seen.filter(turnCompleted('thr_sub_1'))).toHaveLength(1)
    expect(itemsDone(fake).filter((item) => item.type === 'hookPrompt')).toEqual([])
    expect(itemsDone(fake).map((item) => item.id)).not.toContain('msg_2')
    expect((await fake.close()).code).toBe(0)
    expect(fake.seen.filter(turnCompleted('thr_fake_1'))).toHaveLength(1)
  })

  it('runs no hook without an approved hash, and fails each run once the plugin folder changed after the approval', async () => {
    const unapproved = setup({ approve: false })
    const fake = startFake(unapproved.project, { WORFY_CODEX_SCRIPT: 'hooks', CODEX_HOME: unapproved.codexHome, PROBE_LOG: unapproved.log, PROBE_GATE: 'red' })
    await playTurn(fake, { cwd: unapproved.project }, turnCompleted('thr_fake_1'))
    expect((await fake.close()).code).toBe(0)
    expect(unapproved.logged()).toEqual([])
    expect(fake.seen.filter((message) => message.method?.startsWith('hook/'))).toEqual([])
    // Nothing guards the reviewer then: its edit is written.
    expect(readFileSync(join(unapproved.project, 'review.txt'), 'utf8')).toBe('review\n')

    const changed = setup()
    appendFileSync(join(changed.plugin, 'hooks', 'probe.mjs'), '// changed after the approval\n')
    const again = startFake(changed.project, { WORFY_CODEX_SCRIPT: 'hooks', CODEX_HOME: changed.codexHome, PROBE_LOG: changed.log, PROBE_GATE: 'red' })
    await playTurn(again, { cwd: changed.project }, turnCompleted('thr_fake_1'))
    expect((await again.close()).code).toBe(0)
    expect(changed.logged()).toEqual([])
    const runs = again.seen.filter((message) => message.method === 'hook/completed').map((message) => message.params?.run)
    expect(runs.length).toBeGreaterThan(0)
    for (const run of runs) expect(run).toMatchObject({ status: 'failed', entries: [{ kind: 'error', text: 'plugin contents changed; hook approval required' }] })
    expect(existsSync(join(changed.project, 'review.txt'))).toBe(true)
  })

  it('takes exit code 2 with stderr as a block, and gives SessionEnd at most 3 s', async () => {
    expect(outcomeOf('PreToolUse', { code: 2, stdout: '', stderr: 'No.\n', timedOut: false, seconds: 30 })).toMatchObject({ status: 'blocked', block: 'No.' })
    expect(outcomeOf('Stop', { code: 2, stdout: '', stderr: 'Go on.', timedOut: false, seconds: 30 })).toMatchObject({ status: 'blocked', block: 'Go on.' })
    expect(outcomeOf('Stop', { code: 2, stdout: '', stderr: '', timedOut: false, seconds: 30 })).toMatchObject({ status: 'failed' })
    expect(outcomeOf('PreToolUse', { code: 1, stdout: '', stderr: 'broken', timedOut: false, seconds: 30 })).toMatchObject({ status: 'failed' })
    expect(outcomeOf('Stop', { code: 0, stdout: 'plain text', stderr: '', timedOut: false, seconds: 30 })).toMatchObject({ status: 'failed', entries: [{ kind: 'error', text: 'hook returned invalid stop hook JSON output' }] })
    expect(outcomeOf('PreToolUse', { code: 0, stdout: 'plain text', stderr: '', timedOut: false, seconds: 30 })).toMatchObject({ status: 'completed' })
    expect([timeoutSec('SessionEnd', 10), timeoutSec('SessionEnd', undefined), timeoutSec('Stop', undefined), timeoutSec('PreToolUse', 30)]).toEqual([3, 1, 600, 30])

    // A real run: the hook of exit code 2 blocks with its stderr; a SessionEnd hook that sleeps is killed after 3 s.
    const { codexHome, project } = setup()
    const handlers = loadHooks(codexHome).handlers.map((handler) => {
      if (handler.event === 'PreToolUse') return { ...handler, declared: { ...handler.declared, command: String(handler.declared.command).replace(/deny-reviewers|record/, 'exit2') } }
      if (handler.event === 'SessionEnd') return { ...handler, declared: { ...handler.declared, command: String(handler.declared.command).replace('record', 'sleep') } }
      return handler
    })
    const fields = { sessionId: 's', turnId: 'u', cwd: project, model: 'm', toolName: 'Bash', toolInput: { command: 'ls' }, toolUseId: 'cmd_1' }
    const denied = await runHooks(handlers, 'PreToolUse', { input: hookInput('PreToolUse', fields), matchValue: 'Bash', cwd: project })
    expect(denied.block).toBe('Refused by exit code 2.')
    const ended = await runHooks(handlers, 'SessionEnd', { input: hookInput('SessionEnd', fields), matchValue: 'other', cwd: project })
    expect(ended.runs).toMatchObject([{ status: 'failed', entries: [{ kind: 'error', text: 'hook timed out after 3s' }] }])
  })
})

describe('the sandbox of a thread', () => {
  it('read-only: a file change and a command marked as writing are refused and the file stays as it was; reading runs', async () => {
    const { codexHome, project } = setup()
    const fake = startFake(project, { WORFY_CODEX_SCRIPT: 'sandbox', CODEX_HOME: codexHome })
    // The scripted thread/start says the thread is open with a read-only sandbox; worfy asks none.
    await playTurn(fake, { cwd: project }, turnCompleted('thr_fake_1'))
    expect((await fake.close()).code).toBe(0)
    expect(existsSync(join(project, 'notes.txt'))).toBe(false)
    const items = itemsDone(fake)
    expect(items.find((item) => item.id === 'patch_1')).toMatchObject({ type: 'fileChange', status: 'declined' })
    expect(items.find((item) => item.id === 'patch_2')).toMatchObject({ type: 'fileChange', status: 'declined' })
    expect(items.find((item) => item.id === 'cmd_1')).toMatchObject({ type: 'commandExecution', status: 'failed', exitCode: 1 })
    expect(items.find((item) => item.id === 'cmd_2')).toMatchObject({ type: 'commandExecution', status: 'completed', exitCode: 0 })
  })

  it('read-only as worfy asks it in thread/start, over a script that says workspace-write', async () => {
    const { codexHome, project } = setup()
    const fake = startFake(project, { WORFY_CODEX_SCRIPT: 'hooks', CODEX_HOME: codexHome, PROBE_GATE: 'green' })
    await playTurn(fake, { cwd: project, sandbox: 'read-only' }, turnCompleted('thr_fake_1'))
    expect((await fake.close()).code).toBe(0)
    expect(existsSync(join(project, 'main.txt'))).toBe(false)
    expect(itemsDone(fake).find((item) => item.id === 'patch_1')).toMatchObject({ status: 'declined' })
  })

  it('workspace-write: the same file change is written and the command runs', async () => {
    const { codexHome, project } = setup()
    const fake = startFake(project, { WORFY_CODEX_SCRIPT: 'sandbox', CODEX_HOME: codexHome })
    await playTurn(fake, { cwd: project, sandbox: 'workspace-write' }, turnCompleted('thr_fake_1'))
    expect((await fake.close()).code).toBe(0)
    // The file is added, then updated by the hunks of the second change.
    expect(readFileSync(join(project, 'notes.txt'), 'utf8')).toBe('note two\n')
    const items = itemsDone(fake)
    expect(items.find((item) => item.id === 'patch_1')).toMatchObject({ status: 'completed' })
    expect(items.find((item) => item.id === 'cmd_1')).toMatchObject({ status: 'completed', exitCode: 0 })
  })
})

describe('the input of the hooks against the live Codex (ticket 30 recordings)', () => {
  /** The recorded inputs of `event`. */
  const recorded = (event: string): Record<string, unknown>[] =>
    readFileSync(join(RECORDINGS, `${event}.jsonl`), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  const keysOf = (input: Record<string, unknown>) => Object.keys(input).sort().join(',')

  it('the recordings name agent_type: in a PreToolUse of a Subagent and in every SubagentStop', () => {
    expect(recorded('PreToolUse').some((input) => typeof input.agent_type === 'string' && input.agent_type !== '')).toBe(true)
    const subagentStops = recorded('SubagentStop')
    expect(subagentStops.length).toBeGreaterThan(0)
    for (const input of subagentStops) expect(input.agent_type).toEqual(expect.any(String))
  })

  it('gives every hook the fields of the recorded inputs of its event, agent_id and agent_type in a Subagent', async () => {
    const { codexHome, project, log, logged } = setup()
    const fake = startFake(project, { WORFY_CODEX_SCRIPT: 'hooks', CODEX_HOME: codexHome, PROBE_LOG: log, PROBE_GATE: 'red' })
    await playTurn(fake, { cwd: project }, turnCompleted('thr_fake_1'))
    expect((await fake.close()).code).toBe(0)

    const played = logged().map((entry) => entry.input)
    for (const event of ['PreToolUse', 'Stop', 'SubagentStop', 'SubagentStart', 'SessionStart', 'SessionEnd']) {
      const ours = played.filter((input) => input.hook_event_name === event)
      expect(ours.length, event).toBeGreaterThan(0)
      // Each form the fake gives (with and without a Subagent) is a form the live Codex gave.
      const live = [...new Set(recorded(event).map(keysOf))]
      for (const input of ours) expect(live, `${event}: ${keysOf(input)}`).toContain(keysOf(input))
    }
    const tools = played.filter((input) => input.hook_event_name === 'PreToolUse')
    expect(tools.filter((input) => input.agent_type === 'worfy-reviewer').map((input) => input.tool_name)).toEqual(['apply_patch', 'Bash'])
    expect(tools.filter((input) => input.agent_type === undefined).map((input) => input.tool_name)).toEqual(['Bash', 'apply_patch'])
    expect(tools.find((input) => input.tool_name === 'apply_patch' && input.agent_type === 'worfy-reviewer')).toMatchObject({ session_id: 'thr_fake_1', agent_id: 'thr_sub_1', turn_id: 'turn_sub_1', cwd: project, tool_use_id: 'patch_sub_1' })
  })
})

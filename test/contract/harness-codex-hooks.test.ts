// The guarantees the Harness keeps on Codex with its hooks (worfy-multi-vendor ticket 36): the Harness's
// own hooks/hooks.json, installed into a temporary CODEX_HOME and run by the hook engine of the fake
// app-server (test/fixtures/codex-app-server/hook-runner.mjs, ticket 44), which follows the matchers,
// the input fields, the timeouts and the output rules of the pinned Codex:
//   - Stop and SubagentStop run the gate and block with a reason while it is red, and do not block when
//     it is green; a Stop in the main checkout, not in a linked worktree, runs no gate and is held only by
//     the red marker a run left (ticket 48);
//   - PreToolUse denies apply_patch to worfy-reviewer and worfy-scout by agent_type and lets
//     worfy-implementer and the main agent edit; a reviewer's shell command goes through the same rules
//     as under Claude Code; an agent of the Harness opens no interactive shell (write_stdin passes no hook);
//   - SessionEnd runs only the lock release, ends inside Codex's 3 s, and writes no retrospective log for
//     a profile that still carries session.retro_reminder_after (worfy-skills 02 removed session-end.mjs).
// And under Claude Code nothing changes: its Stop input runs no gate, its SubagentStop does nothing.
// Only the hooks of stop.mjs, guard.mjs and the lock release are run, and any hook of SessionEnd: the others
// (qmd-refresh, the SessionStart ones) read the machine's own setup and are none of these guarantees.
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { approvePluginHooks, hookInput, loadHooks, runHooks, type HookFields, type HookHandler } from '../fixtures/codex-app-server/hook-runner.mjs'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const REPO = join(import.meta.dirname, '..', '..')
const HARNESS = join(REPO, 'harness')
const RECORDINGS = join(REPO, 'test', 'fixtures', 'codex-messages', 'hooks')
const WINDOWS = process.platform === 'win32'
/** The folders of the Harness the four hooks need; skills, agents and evals stay out of the copy. */
const PARTS = ['.claude-plugin', 'hooks', 'bin', 'lib', 'profiles']
const RUN_MS = ms(60_000)

let root: string
let plugin: string
let handlers: HookHandler[]
/** isCodexInput of harness/hooks/codex-input.mjs, a script of the Harness without types. */
let isCodexInput: (input: unknown) => boolean

/** The recorded inputs of one hook event (ticket 30). */
const recorded = (event: string) =>
  readFileSync(join(RECORDINGS, `${event}.jsonl`), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)

beforeAll(async () => {
  const codexInput = (await import(pathToFileURL(join(HARNESS, 'hooks', 'codex-input.mjs')).href)) as { isCodexInput: typeof isCodexInput }
  isCodexInput = codexInput.isCodexInput
  root = realpathSync.native(mkdtempSync(join(realpathSync(tmpdir()), 'worfy-codex-harness-')))
  const codexHome = join(root, 'codex-home')
  plugin = join(codexHome, 'plugins', 'cache', 'worfy-harness', 'worfy', 'local')
  for (const part of PARTS) cpSync(join(HARNESS, part), join(plugin, part), { recursive: true, filter: (from) => !/[\\/]tests$/.test(from) })
  approvePluginHooks(codexHome)
  const loaded = loadHooks(codexHome)
  expect(loaded.warnings).toEqual([])
  handlers = loaded.handlers.filter((handler) => handler.event === 'SessionEnd' || /hooks\/(stop|guard)\.mjs|worktree-lock" release/.test(handler.declared.command ?? ''))
})

afterAll(() => removeTestTree(root))

/**
 * A project registered in a gate registry of its own; `mode('bad')` turns its one gate script red.
 * `main` is its main checkout, where a Session such as the Orchestrator works; `work` is a linked
 * worktree of it, where an implementer works. On Codex the gate runs on a Stop in `work` and not on a
 * Stop in `main` (ticket 48).
 */
function project() {
  const dir = realpathSync.native(mkdtempSync(join(root, 'case-')))
  const main = join(dir, 'main')
  const work = join(dir, 'project')
  mkdirSync(main)
  writeFileSync(join(main, 'package.json'), '{ "name": "fixture", "scripts": { "check": "true" } }\n')
  const git = (...args: string[]) => execFileSync('git', ['-C', main, ...args], { stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  // The linked worktree gets its files from a checkout: keep them as written, also where
  // core.autocrlf=true (the Windows runner).
  git('config', 'core.autocrlf', 'false')
  git('add', 'package.json')
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  git('worktree', 'add', '-q', '--detach', work)
  // The package manager the gate runs as `<pm> run check`: a file of the test that passes or fails by
  // the mode file next to it. A .cmd on Windows, where node starts no script without an interpreter.
  const pm = join(dir, WINDOWS ? 'fakepm.cmd' : 'fakepm')
  writeFileSync(
    pm,
    WINDOWS
      ? '@echo off\r\nset /p m=<"%~dp0mode"\r\nif "%m%"=="ok" exit /b 0\r\nif "%m%"=="envbad" (echo sh: tool: command not found& exit /b 127)\r\necho Tests 1 failed\r\nexit /b 1\r\n'
      : `#!/bin/sh\nm="$(cat "${join(dir, 'mode')}")"\n[ "$m" = ok ] && exit 0\n[ "$m" = envbad ] && { echo "sh: tool: command not found"; exit 127; }\necho "Tests 1 failed"\nexit 1\n`,
  )
  if (!WINDOWS) chmodSync(pm, 0o755)
  // ok passes, bad is a real test failure (red), envbad a missing tool (not verified).
  const mode = (value: 'ok' | 'bad' | 'envbad') => writeFileSync(join(dir, 'mode'), `${value}\n`)
  mode('ok')
  const state = join(dir, 'state')
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ repos: [{ key: 'c', match: main, pm, root: { fast: ['check'] }, workspace: {} }] }))
  // The variables reach the hooks: the engine starts each with process.env.
  vi.stubEnv('CLAUDE_GATE_CONFIG', join(dir, 'config.json'))
  vi.stubEnv('CLAUDE_GATE_STATE', state)
  vi.stubEnv('HARNESS_HOME', join(dir, 'harness-home'))
  vi.stubEnv('GATE_SCOPE', 'all')
  return { dir, main, work, state, mode }
}

beforeEach(() => {
  vi.stubEnv('CLAUDE_GATE_RESOLVE', '')
  vi.stubEnv('CLAUDE_PROFILE_BIN', '')
})
afterEach(() => vi.unstubAllEnvs())

const turn = (cwd: string, more: Partial<HookFields> = {}): HookFields => ({ sessionId: 'ses-1', turnId: 'turn-1', transcriptPath: null, cwd, model: 'gpt-5.5-codex', stopHookActive: false, lastAssistantMessage: 'Done.', ...more })

const stopOf = (event: 'Stop' | 'SubagentStop', cwd: string, more: Partial<HookFields> = {}) =>
  runHooks(handlers, event, { input: hookInput(event, turn(cwd, event === 'SubagentStop' ? { agentId: 'agent-1', agentType: 'worfy-implementer', agentTranscriptPath: null, ...more } : more)), matchValue: '', cwd })

const toolOf = (cwd: string, toolName: string, toolInput: unknown, agentType?: string) =>
  runHooks(handlers, 'PreToolUse', { input: hookInput('PreToolUse', turn(cwd, { toolName, toolInput, toolUseId: 'call-1', ...(agentType === undefined ? {} : { agentId: 'agent-1', agentType }) })), matchValue: toolName, cwd })

/** The input of a Codex Stop, or of a SubagentStop of `agentType` with `agentId`, as the engine gives it. */
const codexStopInput = (cwd: string, agentId?: string, agentType = 'worfy-reviewer') =>
  agentId === undefined ? hookInput('Stop', turn(cwd)) : hookInput('SubagentStop', turn(cwd, { agentId, agentType, agentTranscriptPath: null }))

/** Runs stop.mjs of the copy as Claude Code would: `input` on stdin, in `cwd`. */
const claudeStop = (cwd: string, input: object) =>
  spawnSync(scriptNode(), [join(plugin, 'hooks', 'stop.mjs')], { cwd, input: JSON.stringify(input), encoding: 'utf8', env: process.env })

/** The same with a Codex input: the exit code and the output as the engine reads them. */
const codexStop = claudeStop

/**
 * The exit code of `child` once it closes. A child still running after half the test's limit is killed
 * there and gives 'killed': a hook that hangs fails its test without outliving it.
 */
function closeOf(child: ChildProcess): Promise<number | null | 'killed'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve('killed')
    }, RUN_MS / 2)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

describe('the hook inputs of the pinned Codex', () => {
  it('are told from Claude Code by every recorded input of the events the Harness hooks', () => {
    for (const event of ['PreToolUse', 'Stop', 'SubagentStop', 'SessionEnd', 'SessionStart', 'SubagentStart']) {
      for (const input of recorded(event)) expect(isCodexInput(input), `${event}: ${JSON.stringify(input)}`).toBe(true)
    }
    // Claude Code's inputs: no turn_id, a transcript named after the session.
    expect(isCodexInput({ session_id: 's', transcript_path: '/home/someone/.claude/projects/p/0b1c.jsonl', cwd: '/p', hook_event_name: 'Stop', stop_hook_active: false })).toBe(false)
    expect(isCodexInput({ session_id: 's', transcript_path: 'C:\\Users\\someone\\.claude\\projects\\p\\0b1c.jsonl', cwd: 'C:\\p', hook_event_name: 'SessionEnd', reason: 'other' })).toBe(false)
    expect(isCodexInput({ session_id: 's', transcript_path: 'C:\\Users\\someone\\.codex\\sessions\\2026\\11\\03\\rollout-1.jsonl', cwd: 'C:\\p', hook_event_name: 'SessionEnd', reason: 'other' })).toBe(true)
  })

  it('carry agent_type into PreToolUse inside a Subagent: the recorded apply_patch of the Subagent names it', () => {
    const inSubagent = recorded('PreToolUse').filter((input) => input.agent_type !== undefined)
    expect(inSubagent.map((input) => input.tool_name).sort()).toEqual(['Bash', 'apply_patch'])
    expect(recorded('PreToolUse').filter((input) => input.agent_type === undefined && input.agent_id !== undefined)).toEqual([])
  })
})

describe('gate before the end of the work: Stop and SubagentStop on Codex', () => {
  it('block with the gate\'s reason while the gate is red, and let the turn end once it is green', async () => {
    const { work, mode } = project()
    mode('bad')
    const stop = await stopOf('Stop', work)
    expect(stop.block).toMatch(/^The quality gate is red \(failed at .+\)\. Run `node ".+gate\.mjs" fast/)
    expect(stop.runs.map((run) => run.status)).toEqual(['blocked'])
    const sub = await stopOf('SubagentStop', work, { agentId: 'agent-2' })
    expect(sub.block).toMatch(/^The quality gate is red/)

    mode('ok')
    const green = await stopOf('Stop', work, { stopHookActive: true })
    expect(green.block).toBeUndefined()
    expect(green.runs.map((run) => run.status)).toEqual(['completed'])
    const subGreen = await stopOf('SubagentStop', work)
    expect(subGreen.block).toBeUndefined()
    expect(subGreen.runs.map((run) => run.status)).toEqual(['completed'])
  }, RUN_MS)

  it('run the gate themselves: the verdict file of the worktree is written by the Stop hook', async () => {
    const { work, state } = project()
    await stopOf('Stop', work)
    const verdicts = readdirNames(state).filter((name) => name.startsWith('verdict-'))
    expect(verdicts).toHaveLength(1)
    expect(JSON.parse(readFileSync(join(state, verdicts[0] as string), 'utf8'))).toMatchObject({ outcome: 'green', profile: 'fast', key: 'c' })
  }, RUN_MS)

  // Codex, or a busy machine, may write the input after the hook has started. stop.mjs once read its
  // stdin with fs.readFileSync(0) after touching process.stdin, which holds a pipe in non-blocking mode:
  // the read failed with EAGAIN, the hook took the input for empty, ran no gate and held or let the
  // turn go by the marker of an earlier run (codex-parity.test.ts failed so under load). Here the input
  // goes only once the hook has touched process.stdin (a preload says so on stderr), so a synchronous
  // read meets an empty pipe every time.
  it('read an input that arrives after the hook started: the gate runs and a red one holds the turn', async () => {
    const { dir, work, state, mode } = project()
    mode('bad')
    const touched = 'stdin-touched-by-the-hook'
    const preload = join(dir, 'stdin-touched.cjs')
    writeFileSync(
      preload,
      `const own = Object.getOwnPropertyDescriptor(process, 'stdin')
let told = false
Object.defineProperty(process, 'stdin', { configurable: true, enumerable: own.enumerable, get() {
  const stdin = own.get.call(process)
  if (!told) { told = true; require('node:fs').writeSync(2, ${JSON.stringify(`${touched}\n`)}) }
  return stdin
} })
`,
    )
    const child = spawn(scriptNode(), [join(plugin, 'hooks', 'stop.mjs')], { cwd: work, env: { ...process.env, NODE_OPTIONS: `--require ${JSON.stringify(preload)}` }, stdio: 'pipe' })
    let stderr = ''
    let sent = false
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk
      if (!sent && stderr.includes(touched)) {
        sent = true
        child.stdin.end(JSON.stringify(codexStopInput(work)))
      }
    })
    const code = await closeOf(child)
    expect(sent, 'the hook touched process.stdin').toBe(true)
    expect([code, stderr.replace(`${touched}\n`, '')]).toEqual([2, expect.stringMatching(/^The quality gate is red \(failed at .+\)\. Run `node /)])
    const verdicts = readdirNames(state).filter((name) => name.startsWith('verdict-'))
    expect(verdicts, 'the hook ran the gate').toHaveLength(1)
    expect(JSON.parse(readFileSync(join(state, verdicts[0] as string), 'utf8'))).toMatchObject({ outcome: 'red', key: 'c' })
  }, RUN_MS)

  // The wait for the first byte is 30 s; CLAUDE_STOP_STDIN_WAIT_MS shortens it here.
  it('take an input pipe that stays open and sends nothing for no input once the wait for its first byte is over', async () => {
    const { work, state, mode } = project()
    mode('bad')
    const started = Date.now()
    const child = spawn(scriptNode(), [join(plugin, 'hooks', 'stop.mjs')], { cwd: work, env: { ...process.env, CLAUDE_STOP_STDIN_WAIT_MS: '200' }, stdio: 'pipe' })
    let output = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (output += chunk))
    // stdin is never written or closed: only the hook's own wait ends the run, the shortened one.
    expect(await closeOf(child)).toBe(0)
    expect(Date.now() - started).toBeLessThan(30_000)
    expect(output).toBe('')
    expect(readdirNames(state).filter((name) => name.startsWith('verdict-')), 'no input, no gate run').toEqual([])
  }, RUN_MS)

  it('read the input to its end once its first byte has come, however long the rest takes', async () => {
    const { work, state, mode } = project()
    mode('bad')
    const input = JSON.stringify(codexStopInput(work))
    const half = Math.floor(input.length / 2)
    const child = spawn(scriptNode(), [join(plugin, 'hooks', 'stop.mjs')], { cwd: work, env: { ...process.env, CLAUDE_STOP_STDIN_WAIT_MS: '200' }, stdio: 'pipe' })
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
    const closed = closeOf(child)
    child.stdin.write(input.slice(0, half))
    // Five times the wait for the first byte: a hook that kept that wait after the first byte has given up by now.
    await new Promise((resolve) => setTimeout(resolve, 1000))
    child.stdin.end(input.slice(half))
    expect([await closed, stderr]).toEqual([2, expect.stringMatching(/^The quality gate is red \(failed at .+\)\. Run `node /)])
    expect(readdirNames(state).filter((name) => name.startsWith('verdict-'))).toHaveLength(1)
  }, RUN_MS)

  // On a terminal the hook reads nothing. The input is typed into the terminal anyway (a line, then the
  // end of input): a hook that read the terminal would get a red Codex Stop and hold the turn. The script
  // kills the hook itself after half the test's limit (exit 98): a kill of python3 alone would leave the
  // hook running on its terminal.
  it.skipIf(WINDOWS)('read nothing from a terminal: the hook ends with no input even when the terminal sends one', (context) => {
    // python3 with its pty module drives the terminal; a runner without it skips the case. Asked here,
    // not while the file loads: no file of test/contract starts a process then (e2e-no-spawn-on-load).
    if (spawnSync('python3', ['-c', 'import pty'], { stdio: 'ignore' }).status !== 0) context.skip()
    const { work, state, mode } = project()
    mode('bad')
    const input = JSON.stringify(codexStopInput(work))
    expect(input.length, 'one line of a terminal').toBeLessThan(1000)
    const python = `
import os, pty, select, signal, sys, time
pid, fd = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], sys.argv[1:3])
deadline = time.monotonic() + float(sys.argv[4])
def give_up():
    os.kill(pid, signal.SIGKILL)
    os.waitpid(pid, 0)
    sys.exit(98)
os.write(fd, sys.argv[3].encode() + b"\\n\\x04")
while True:
    left = deadline - time.monotonic()
    if left <= 0:
        give_up()
    if not select.select([fd], [], [], left)[0]:
        continue
    try:
        if not os.read(fd, 4096):
            break
    except OSError:
        break
while True:
    done, status = os.waitpid(pid, os.WNOHANG)
    if done:
        break
    if time.monotonic() > deadline:
        give_up()
    time.sleep(0.05)
sys.exit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 99)
`
    const seconds = String(RUN_MS / 2 / 1000)
    const run = spawnSync('python3', ['-c', python, scriptNode(), join(plugin, 'hooks', 'stop.mjs'), input, seconds], { cwd: work, env: process.env, encoding: 'utf8', timeout: RUN_MS })
    expect([run.error, run.status]).toEqual([undefined, 0])
    expect(readdirNames(state).filter((name) => name.startsWith('verdict-')), 'no input, no gate run').toEqual([])
  }, RUN_MS)

  it('count the blocks of each Subagent on their own: two red SubagentStops of the reviewer leave the main Stop its own two', async () => {
    const { work, mode } = project()
    mode('bad')
    for (let n = 0; n < 2; n++) {
      const sub = await runHooks(handlers, 'SubagentStop', { input: codexStopInput(work, 'reviewer-1'), matchValue: '', cwd: work })
      // A reviewer edits no file: it is held on red, and told to report the gate, not fix it.
      expect(sub.block).toMatch(/^The quality gate is red \(failed at .+\)\. You edit no file, so do not fix it: say in your answer that the gate is red/)
    }
    const main = await runHooks(handlers, 'Stop', { input: codexStopInput(work), matchValue: '', cwd: work })
    expect(main.block).toMatch(/^The quality gate is red \(failed at .+\)\. Run `node /)
    expect((await runHooks(handlers, 'Stop', { input: codexStopInput(work), matchValue: '', cwd: work })).block).toMatch(/^The quality gate is red/)
  }, RUN_MS)

  it('say the give-up note on Codex as a block with the note as its reason, exit 0, after two blocks', async () => {
    const { work, mode } = project()
    mode('bad')
    for (let n = 0; n < 2; n++) expect(codexStop(work, codexStopInput(work)).status).toBe(2)
    const third = codexStop(work, codexStopInput(work))
    expect(third.status).toBe(0)
    expect(JSON.parse(third.stdout)).toEqual({ decision: 'block', reason: expect.stringMatching(/^The quality gate is still red and was not cleared in 2 attempts\./) })
    // Said once: the next Stop lets the turn end in silence.
    expect(codexStop(work, codexStopInput(work))).toMatchObject({ status: 0, stdout: '' })
  }, RUN_MS)

  it('say the not-verified note to the Subagent and to the main agent, each once, as a block with the note, exit 0', async () => {
    const { work, mode } = project()
    mode('envbad')
    const note = { decision: 'block', reason: expect.stringMatching(/^The last gate run could not verify the work: .+ This is not a green result — say "not verified", not "done"\.$/) }
    const sub = codexStop(work, codexStopInput(work, 'scout-1', 'worfy-scout'))
    expect(sub.status).toBe(0)
    expect(JSON.parse(sub.stdout)).toEqual(note)
    const main = codexStop(work, codexStopInput(work))
    expect(main.status).toBe(0)
    expect(JSON.parse(main.stdout)).toEqual(note)
    expect(codexStop(work, codexStopInput(work, 'scout-1', 'worfy-scout'))).toMatchObject({ status: 0, stdout: '' })
    expect(codexStop(work, codexStopInput(work))).toMatchObject({ status: 0, stdout: '' })
  }, RUN_MS)

  it('run no gate outside a registered project and say nothing there', async () => {
    const { work, state, dir } = project()
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ repos: [] }))
    const stop = await stopOf('Stop', work)
    expect(stop.block).toBeUndefined()
    expect(stop.runs.map((run) => [run.status, run.entries])).toEqual([['completed', []]])
    expect(readdirNames(state).filter((name) => name.startsWith('verdict-'))).toEqual([])
  }, RUN_MS)
})

// Owner decision 2026-11-11 (ticket 48): the gate on the Stop of the main Session in the main checkout cost
// up to 900 s at the end of every turn that changed the tree, and the Session seemed to hang after its answer.
describe('the main checkout on Codex: Stop runs no gate there, SubagentStop and a linked worktree still do', () => {
  const verdicts = (state: string) => readdirNames(state).filter((name) => name.startsWith('verdict-'))

  it('runs no gate on a Stop in the main checkout and lets the turn end while no red marker is left', async () => {
    const { main, state, mode } = project()
    mode('bad')
    const stop = await stopOf('Stop', main)
    expect(stop.block).toBeUndefined()
    expect(stop.runs.map((run) => [run.status, run.entries])).toEqual([['completed', []]])
    expect(verdicts(state), 'no gate run').toEqual([])
  }, RUN_MS)

  it('runs the gate on a SubagentStop in the main checkout, and its red marker holds the next Stop there without a run of its own', async () => {
    const { main, state, mode } = project()
    mode('bad')
    const sub = await stopOf('SubagentStop', main)
    expect(sub.block).toMatch(/^The quality gate is red \(failed at .+\)\. Run `node ".+gate\.mjs" fast/)
    expect(verdicts(state), 'the SubagentStop ran the gate').toHaveLength(1)
    // The work is fixed, but the Stop runs no gate: the red marker of the last run still holds the turn.
    mode('ok')
    const stop = await stopOf('Stop', main)
    expect(stop.block).toMatch(/^The quality gate is red \(failed at .+\)\. Run `node ".+gate\.mjs" fast/)
    expect(stop.runs.map((run) => run.status)).toEqual(['blocked'])
    // A gate run the agent starts itself turns it green, and the next Stop lets the turn end.
    expect(spawnSync(scriptNode(), [join(plugin, 'hooks', 'gate.mjs'), 'fast'], { cwd: main, input: '', env: process.env }).status).toBe(0)
    expect((await stopOf('Stop', main, { stopHookActive: true })).block).toBeUndefined()
  }, RUN_MS)

  it('runs the gate on a Stop in a linked worktree: a red one holds the turn, a green one lets it end', async () => {
    const { work, state, mode } = project()
    mode('bad')
    expect((await stopOf('Stop', work)).block).toMatch(/^The quality gate is red/)
    expect(JSON.parse(readFileSync(join(state, verdicts(state)[0] as string), 'utf8'))).toMatchObject({ outcome: 'red', key: 'c' })
    mode('ok')
    expect((await stopOf('Stop', work, { stopHookActive: true })).block).toBeUndefined()
    expect(JSON.parse(readFileSync(join(state, verdicts(state)[0] as string), 'utf8'))).toMatchObject({ outcome: 'green', key: 'c' })
  }, RUN_MS)

  // From a subfolder git prints a relative common directory unless asked for absolute paths, and the
  // main checkout would then read as a linked worktree.
  it('tells the main checkout from a linked worktree from their roots and their subfolders, and gives null outside git', async () => {
    const { dir, main, work } = project()
    const { isLinkedWorktree } = (await import(pathToFileURL(join(plugin, 'hooks', 'gate-paths.mjs')).href)) as { isLinkedWorktree: (worktree: string) => boolean | null }
    mkdirSync(join(main, 'src', 'deep'), { recursive: true })
    mkdirSync(join(work, 'src', 'deep'), { recursive: true })
    const outside = join(dir, 'outside')
    mkdirSync(outside)
    expect([main, join(main, 'src', 'deep'), work, join(work, 'src', 'deep'), outside].map(isLinkedWorktree)).toEqual([false, false, true, true, null])
  })

  // A git that cannot tell a linked worktree from the main checkout (here a stand-in, EVAL_GIT of
  // eval-env.cjs, that fails only the one call isLinkedWorktree makes) leaves the old rule: the gate runs.
  // Not on Windows: a stand-in there would be a .cmd, Node refuses to start a .cmd without a shell (EINVAL),
  // and the hooks spawn EVAL_GIT without one; every git call would fail, and the hook would end before the gate.
  it.skipIf(WINDOWS)('runs the gate on a Stop in the main checkout when git cannot tell it from a linked worktree', async () => {
    const { dir, main, state, mode } = project()
    const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
    const stand = join(dir, 'git-no-common-dir')
    writeFileSync(stand, `#!/bin/sh\ncase " $* " in *" --git-dir --git-common-dir "*) exit 128 ;; esac\nexec "${real}" "$@"\n`)
    chmodSync(stand, 0o755)
    vi.stubEnv('EVAL_GIT', stand)
    mode('bad')
    expect((await stopOf('Stop', main)).block).toMatch(/^The quality gate is red \(failed at .+\)\. Run `node /)
    expect(JSON.parse(readFileSync(join(state, verdicts(state)[0] as string), 'utf8'))).toMatchObject({ outcome: 'red', key: 'c' })
  }, RUN_MS)

  it('runs no gate on a Stop from a subfolder of the main checkout either', async () => {
    const { main, state, mode } = project()
    mode('bad')
    const sub = join(main, 'src')
    mkdirSync(sub)
    expect((await stopOf('Stop', sub)).block).toBeUndefined()
    expect(verdicts(state)).toEqual([])
  }, RUN_MS)
})

describe('Claude Code: the Stop hook stays as it was', () => {
  it('runs no gate on a Stop of Claude Code in the main checkout either, and holds it on the red marker a gate run left', async () => {
    const { main, state, mode } = project()
    mode('bad')
    const input = { session_id: 'claude-4', transcript_path: join(main, 'claude-4.jsonl'), cwd: main, hook_event_name: 'Stop', stop_hook_active: false }
    expect(claudeStop(main, input)).toMatchObject({ status: 0, stdout: '', stderr: '' })
    expect(readdirNames(state).filter((name) => name.startsWith('verdict-'))).toEqual([])
    expect((await stopOf('SubagentStop', main)).block).toMatch(/^The quality gate is red/)
    const held = claudeStop(main, input)
    expect(held.status).toBe(2)
    expect(held.stderr).toMatch(/^The quality gate is red/)
  }, RUN_MS)

  it('runs no gate on a Stop of Claude Code and does not hold it when no gate run left a red marker', () => {
    const { work, state, mode } = project()
    mode('bad')
    const run = claudeStop(work, { session_id: 'claude-1', transcript_path: join(work, 'claude-1.jsonl'), cwd: work, hook_event_name: 'Stop', stop_hook_active: false })
    expect([run.status, run.stdout, run.stderr]).toEqual([0, '', ''])
    expect(readdirNames(state).filter((name) => name.startsWith('verdict-'))).toEqual([])
  })

  it('lets the turn go after about 10 s when the registry resolver hangs, as the 10 s limit of the hook did before it became 900 s', () => {
    const { work, dir } = project()
    const hung = join(dir, 'hung-resolver.mjs')
    writeFileSync(hung, 'setTimeout(() => undefined, 120000)\n')
    vi.stubEnv('CLAUDE_GATE_RESOLVE', hung)
    const started = Date.now()
    const run = claudeStop(work, { session_id: 'claude-3', transcript_path: join(work, 'claude-3.jsonl'), cwd: work, hook_event_name: 'Stop', stop_hook_active: false })
    expect([run.status, run.stdout]).toEqual([0, ''])
    const took = Date.now() - started
    expect(took).toBeGreaterThanOrEqual(9_000)
    expect(took).toBeLessThan(60_000)
  }, RUN_MS)

  it('does nothing on a SubagentStop of Claude Code, even with the red marker of a gate run', async () => {
    const { work, mode } = project()
    mode('bad')
    expect((await stopOf('Stop', work)).block).toMatch(/^The quality gate is red/)
    const input = { session_id: 'claude-2', transcript_path: join(work, 'claude-2.jsonl'), cwd: work, hook_event_name: 'SubagentStop', stop_hook_active: false, agent_id: 'a', agent_type: 'worfy-implementer' }
    expect(claudeStop(work, input)).toMatchObject({ status: 0, stdout: '', stderr: '' })
    // Its Stop is held by that marker, as before ticket 36.
    const held = claudeStop(work, { ...input, hook_event_name: 'Stop' })
    expect(held.status).toBe(2)
    expect(held.stderr).toMatch(/^The quality gate is red/)
  }, RUN_MS)
})

describe('read-only reviewer and scout, the guards with the matchers of Codex', () => {
  const patch = { command: '*** Begin Patch\n*** Add File: review.txt\n+review\n*** End Patch' }

  it('denies apply_patch to worfy-reviewer and worfy-scout and lets worfy-implementer and the main agent edit', async () => {
    const { work } = project()
    for (const agent of ['worfy-reviewer', 'worfy-scout']) {
      const denied = await toolOf(work, 'apply_patch', patch, agent)
      expect(denied.block, agent).toMatch(new RegExp(`^${agent} edits no file: on Codex its apply_patch is refused`))
      expect(denied.runs.map((run) => run.status)).toEqual(['blocked'])
    }
    for (const agent of ['worfy-implementer', undefined]) {
      const allowed = await toolOf(work, 'apply_patch', patch, agent)
      expect(allowed.block, String(agent)).toBeUndefined()
      expect(allowed.runs.map((run) => run.status)).toEqual(['completed'])
    }
  }, RUN_MS)

  it('denies the recorded apply_patch of a Subagent once its agent_type is worfy-reviewer, and lets it pass as the recorded "default"', async () => {
    const { work } = project()
    const line = recorded('PreToolUse').find((input) => input.tool_name === 'apply_patch' && input.agent_type !== undefined) as Record<string, unknown>
    const run = (input: Record<string, unknown>) => runHooks(handlers, 'PreToolUse', { input: { ...input, cwd: work }, matchValue: 'apply_patch', cwd: work })
    expect((await run(line)).block).toBeUndefined()
    expect((await run({ ...line, agent_type: 'worfy-reviewer' })).block).toMatch(/^worfy-reviewer edits no file/)
  }, RUN_MS)

  it('lets a reviewer run shell commands under the rules a Bash of Claude Code has', async () => {
    const { work } = project()
    for (const command of ['ls', 'git status', 'set -o pipefail; pnpm lint | tail -n 5', 'bash -c "pnpm test"']) {
      const allowed = await toolOf(work, 'Bash', { command }, 'worfy-reviewer')
      expect(allowed.block, command).toBeUndefined()
    }
    expect((await toolOf(work, 'Bash', { command: 'git reset --hard' }, 'worfy-reviewer')).block).toMatch(/^`git reset --hard` wipes/)
    expect((await toolOf(work, 'Bash', { command: 'pnpm lint | grep error' })).block).toMatch(/^The pipe eats the exit code/)
  }, RUN_MS)

  it('denies an agent of the Harness an interactive shell or interpreter, whose later input no hook sees', async () => {
    const { work } = project()
    // For a shell only -c gives the command: `bash -e` is still an interactive bash.
    for (const command of ['bash', 'cd sub && zsh -i', 'node', 'python3', 'sh -s', 'pwsh -NoExit', 'bash -e', 'sh -m']) {
      const denied = await toolOf(work, 'Bash', { command }, 'worfy-implementer')
      expect(denied.block, command).toMatch(/^On Codex an agent of the Harness opens no interactive `/)
    }
    // A command given (-c for a shell), a script, a redirected input, a flag that opens no prompt.
    for (const command of ['bash -c "ls"', 'bash ./run.sh', 'node script.mjs', 'python3 -c "print(1)"', 'cat steps.sh | bash', 'bash < steps.sh', 'echo "then bash -i"', 'cmd /c dir', 'node -v', 'node --test', 'bash --version', 'bash -n', 'python3 -V']) {
      const allowed = await toolOf(work, 'Bash', { command }, 'worfy-implementer')
      expect(allowed.block, command).toBeUndefined()
    }
    // Outside the Harness's agents nothing new is refused: the main agent of a Session may open one.
    expect((await toolOf(work, 'Bash', { command: 'bash' })).block).toBeUndefined()
    expect((await toolOf(work, 'Bash', { command: 'bash' }, 'default')).block).toBeUndefined()
  }, RUN_MS)
})

describe('the end of a Session on Codex', () => {
  // A profile that still carries session.retro_reminder_after, the field worfy-skills 02 removed: SessionEnd
  // runs the lock release alone, ends inside Codex's 3 s, and nothing writes the profile's pending-retro.log.
  it('runs only the lock release, inside the 3 s of Codex, and writes no pending-retro.log for a profile with session.retro_reminder_after', async () => {
    const { work, dir } = project()
    const profileDir = join(dir, 'profile')
    mkdirSync(profileDir)
    const fast = join(dir, 'fast-profile.mjs')
    writeFileSync(fast, `process.stdout.write(${JSON.stringify(JSON.stringify({ session: { retro_reminder_after: 3 }, _resolved: { dir: profileDir } }))})\n`)
    vi.stubEnv('CLAUDE_PROFILE_BIN', fast)
    expect(handlers.filter((handler) => handler.event === 'SessionEnd').map((handler) => handler.declared.command)).toEqual([
      'node "${CLAUDE_PLUGIN_ROOT}/bin/worktree-lock" release',
    ])
    const input = hookInput('SessionEnd', { sessionId: 'ses-1', transcriptPath: join(dir, 'sessions', 'rollout-2026-11-03T07-11-41-ses-1.jsonl'), cwd: work })
    const started = Date.now()
    const end = await runHooks(handlers, 'SessionEnd', { input, matchValue: 'other', cwd: work })
    expect(end.runs.map((run) => [run.status, run.entries])).toEqual([['completed', []]])
    expect(Date.now() - started).toBeLessThan(3000)
    expect(existsSync(join(profileDir, 'state', 'pending-retro.log'))).toBe(false)
  }, RUN_MS)
})

function readdirNames(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir) : []
}

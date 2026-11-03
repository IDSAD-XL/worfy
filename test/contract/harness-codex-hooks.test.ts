// The guarantees the Harness keeps on Codex with its hooks (worfy-multi-vendor ticket 36): the Harness's
// own hooks/hooks.json, installed into a temporary CODEX_HOME and run by the hook engine of the fake
// app-server (test/fixtures/codex-app-server/hook-runner.mjs, ticket 44), which follows the matchers,
// the input fields, the timeouts and the output rules of the pinned Codex:
//   - Stop and SubagentStop run the gate and block with a reason while it is red, and do not block when
//     it is green;
//   - PreToolUse denies apply_patch to worfy-reviewer and worfy-scout by agent_type and lets
//     worfy-implementer and the main agent edit; a reviewer's shell command goes through the same rules
//     as under Claude Code; an agent of the Harness opens no interactive shell (write_stdin passes no hook);
//   - SessionEnd ends inside Codex's 3 s even when its one waiting step hangs.
// And under Claude Code nothing changes: its Stop input runs no gate, its SubagentStop does nothing.
// Only the hooks of stop.mjs, guard.mjs, session-end.mjs and the lock release are run: the others
// (qmd-refresh, the SessionStart ones) read the machine's own setup and are none of these guarantees.
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { approvePluginHooks, hookInput, loadHooks, runHooks, type HookFields, type HookHandler } from '../fixtures/codex-app-server/hook-runner.mjs'
import { isCodexInput } from '../../harness/hooks/codex-input.mjs'
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

/** The recorded inputs of one hook event (ticket 30). */
const recorded = (event: string) =>
  readFileSync(join(RECORDINGS, `${event}.jsonl`), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)

beforeAll(() => {
  root = realpathSync.native(mkdtempSync(join(realpathSync(tmpdir()), 'worfy-codex-harness-')))
  const codexHome = join(root, 'codex-home')
  plugin = join(codexHome, 'plugins', 'cache', 'worfy-harness', 'worfy', 'local')
  for (const part of PARTS) cpSync(join(HARNESS, part), join(plugin, part), { recursive: true, filter: (from) => !/[\\/]tests$/.test(from) })
  approvePluginHooks(codexHome)
  const loaded = loadHooks(codexHome)
  expect(loaded.warnings).toEqual([])
  handlers = loaded.handlers.filter((handler) => /hooks\/(stop|guard|session-end)\.mjs|worktree-lock" release/.test(handler.declared.command ?? ''))
})

afterAll(() => removeTestTree(root))

/** A project registered in a gate registry of its own; `mode('bad')` turns its one gate script red. */
function project() {
  const dir = realpathSync.native(mkdtempSync(join(root, 'case-')))
  const work = join(dir, 'project')
  mkdirSync(work)
  writeFileSync(join(work, 'package.json'), '{ "name": "fixture", "scripts": { "check": "true" } }\n')
  const git = (...args: string[]) => execFileSync('git', ['-C', work, ...args], { stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('add', 'package.json')
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  // The package manager the gate runs as `<pm> run check`: a file of the test that passes or fails by
  // the mode file next to it. A .cmd on Windows, where node starts no script without an interpreter.
  const pm = join(dir, WINDOWS ? 'fakepm.cmd' : 'fakepm')
  writeFileSync(
    pm,
    WINDOWS
      ? '@echo off\r\nset /p m=<"%~dp0mode"\r\nif "%m%"=="ok" exit /b 0\r\necho Tests 1 failed\r\nexit /b 1\r\n'
      : `#!/bin/sh\n[ "$(cat "${join(dir, 'mode')}")" = ok ] && exit 0\necho "Tests 1 failed"\nexit 1\n`,
  )
  if (!WINDOWS) chmodSync(pm, 0o755)
  const mode = (value: 'ok' | 'bad') => writeFileSync(join(dir, 'mode'), `${value}\n`)
  mode('ok')
  const state = join(dir, 'state')
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ repos: [{ key: 'c', match: work, pm, root: { fast: ['check'] }, workspace: {} }] }))
  // The variables reach the hooks: the engine starts each with process.env.
  vi.stubEnv('CLAUDE_GATE_CONFIG', join(dir, 'config.json'))
  vi.stubEnv('CLAUDE_GATE_STATE', state)
  vi.stubEnv('HARNESS_HOME', join(dir, 'harness-home'))
  vi.stubEnv('GATE_SCOPE', 'all')
  return { dir, work, state, mode }
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

/** Runs stop.mjs of the copy as Claude Code would: `input` on stdin, in `cwd`. */
const claudeStop = (cwd: string, input: object) =>
  spawnSync(scriptNode(), [join(plugin, 'hooks', 'stop.mjs')], { cwd, input: JSON.stringify(input), encoding: 'utf8', env: process.env })

describe('the hook inputs of the pinned Codex', () => {
  it('are told from Claude Code by every recorded input of the events the Harness hooks', () => {
    for (const event of ['PreToolUse', 'Stop', 'SubagentStop', 'SessionEnd', 'SessionStart', 'SubagentStart']) {
      for (const input of recorded(event)) expect(isCodexInput(input), `${event}: ${JSON.stringify(input)}`).toBe(true)
    }
    // Claude Code's inputs: no turn_id, a transcript named after the session.
    expect(isCodexInput({ session_id: 's', transcript_path: '/home/u/.claude/projects/p/0b1c.jsonl', cwd: '/p', hook_event_name: 'Stop', stop_hook_active: false })).toBe(false)
    expect(isCodexInput({ session_id: 's', transcript_path: 'C:\\Users\\u\\.claude\\projects\\p\\0b1c.jsonl', cwd: 'C:\\p', hook_event_name: 'SessionEnd', reason: 'other' })).toBe(false)
    expect(isCodexInput({ session_id: 's', transcript_path: 'C:\\Users\\u\\.codex\\sessions\\2026\\11\\03\\rollout-1.jsonl', cwd: 'C:\\p', hook_event_name: 'SessionEnd', reason: 'other' })).toBe(true)
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

  it('run no gate outside a registered project and say nothing there', async () => {
    const { work, state, dir } = project()
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ repos: [] }))
    const stop = await stopOf('Stop', work)
    expect(stop.block).toBeUndefined()
    expect(stop.runs.map((run) => [run.status, run.entries])).toEqual([['completed', []]])
    expect(readdirNames(state).filter((name) => name.startsWith('verdict-'))).toEqual([])
  }, RUN_MS)
})

describe('Claude Code: the Stop hook stays as it was', () => {
  it('runs no gate on a Stop of Claude Code and does not hold it when no gate run left a red marker', () => {
    const { work, state, mode } = project()
    mode('bad')
    const run = claudeStop(work, { session_id: 'claude-1', transcript_path: join(work, 'claude-1.jsonl'), cwd: work, hook_event_name: 'Stop', stop_hook_active: false })
    expect([run.status, run.stdout, run.stderr]).toEqual([0, '', ''])
    expect(readdirNames(state).filter((name) => name.startsWith('verdict-'))).toEqual([])
  })

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
    for (const command of ['bash', 'cd sub && zsh -i', 'node', 'python3', 'sh -s', 'pwsh -NoExit']) {
      const denied = await toolOf(work, 'Bash', { command }, 'worfy-implementer')
      expect(denied.block, command).toMatch(/^On Codex an agent of the Harness opens no interactive `/)
    }
    for (const command of ['bash -c "ls"', 'bash ./run.sh', 'node script.mjs', 'python3 -c "print(1)"', 'cat steps.sh | bash', 'bash < steps.sh', 'echo "then bash -i"', 'cmd /c dir']) {
      const allowed = await toolOf(work, 'Bash', { command }, 'worfy-implementer')
      expect(allowed.block, command).toBeUndefined()
    }
    // Outside the Harness's agents nothing new is refused: the main agent of a Session may open one.
    expect((await toolOf(work, 'Bash', { command: 'bash' })).block).toBeUndefined()
    expect((await toolOf(work, 'Bash', { command: 'bash' }, 'default')).block).toBeUndefined()
  }, RUN_MS)
})

describe('the end of a Session on Codex', () => {
  it('ends inside the 3 s of Codex even when the profile call hangs', async () => {
    const { work, dir } = project()
    const slow = join(dir, 'slow-profile.mjs')
    writeFileSync(slow, 'setTimeout(() => process.stdout.write("{}"), 10000)\n')
    vi.stubEnv('CLAUDE_PROFILE_BIN', slow)
    const input = hookInput('SessionEnd', { sessionId: 'ses-1', transcriptPath: join(dir, 'sessions', 'rollout-2026-11-03T07-11-41-ses-1.jsonl'), cwd: work })
    const started = Date.now()
    const end = await runHooks(handlers, 'SessionEnd', { input, matchValue: 'other', cwd: work })
    expect(end.runs.map((run) => [run.status, run.entries])).toEqual([
      ['completed', []],
      ['completed', []],
    ])
    expect(Date.now() - started).toBeLessThan(3000)
  }, RUN_MS)
})

function readdirNames(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir) : []
}

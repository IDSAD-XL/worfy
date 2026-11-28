// The Session of the Assistant on the real Claude Code (worfy-assistant ticket 10; ADR-0114, point 2 and boundary 1):
// the Agent SDK's own binary, started with the options worfy gives the Assistant (assistantSessionOptions), against a
// local stand-in of the Messages API (messages-api-stand-in.ts). No model is called, nothing leaves the machine, and
// Claude Code's HOME is a temporary folder: nothing is written under the real ~/.claude.
//
// The unit test of the options reads what goes into the SDK; this one shows what Claude Code does with it:
// - a tool of worfy-app the "model" calls runs its handler (allowedTools under dontAsk lets it through);
// - a call of Bash is refused, and its command never runs (the Session has no built-in tool at all).
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appToolUseName } from '../../src/shared/assistant/app-tools'
import type { SessionMemoryPart } from '../../src/main/assistant/duties/memory'
import { SessionMemory } from '../../src/main/assistant/session/memory'
import { assistantSessionOptions } from '../../src/main/vendors/claude/assistant-session'
import { ASSISTANT_SESSION_KIND, SESSION_KIND_VARIABLE } from '../../src/main/vendors/claude/options'
import { claudeEnv, startMessagesApiStandIn, type ScriptedToolUse } from '../../src/main/harness/contract/messages-api-stand-in'

vi.mock('electron', () => ({ app: { on: () => undefined, isPackaged: false, getAppPath: () => '/nowhere' } }))

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

/** Waits for `child` to exit: SIGTERM at once, SIGKILL after 5 s. */
async function ended(child: ChildProcess | null): Promise<void> {
  if (child === null || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((done) => child.once('exit', () => done()))
  child.kill('SIGTERM')
  const late = setTimeout(() => child.kill('SIGKILL'), 5_000)
  await exited
  clearTimeout(late)
}

/**
 * One Session of the Assistant on the real Claude Code whose "model" writes `call` once. The server worfy-app is the
 * real one over a real SessionMemory; every other part of it throws: this test reaches only the memory.
 */
async function session(call: ScriptedToolUse) {
  const standIn = await startMessagesApiStandIn(call, { unoffered: true })
  const home = mkdtempSync(join(tmpdir(), 'worfy-assistant-home-'))
  const cwd = mkdtempSync(join(tmpdir(), 'worfy-assistant-cwd-'))
  cleanups.push(async () => {
    await standIn.close()
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  let kept: SessionMemoryPart = {}
  const memory = new SessionMemory({ store: { read: () => kept, write: (part) => void (kept = part) }, now: () => Date.parse('2026-11-25T10:00:00Z'), id: () => 'memo-1' })
  const used: string[] = []
  const deps = new Proxy({ memory } as Record<string, unknown>, {
    get: (target, key) => {
      if (key in target) return target[key as string]
      return () => {
        used.push(String(key))
        throw new Error(`not in this test: ${String(key)}`)
      }
    },
  })
  const [{ worfyAppServer }, { claudeMcpServer }] = await Promise.all([import('../../src/main/mcp/app-server'), import('../../src/main/vendors/claude/mcp')])
  const server = await claudeMcpServer(worfyAppServer(deps as never))
  const options = assistantSessionOptions({
    cwd,
    env: {},
    runtime: { packaged: false, resourcesPath: '/nowhere', platform: process.platform, arch: process.arch },
    sessionId: 'b6f0c3c4-5f00-4d4e-9b70-000000000010',
    server,
    instructions: 'You are the Assistant of worfy in a test.',
    harnessPlugin: null,
  })
  const stderr: string[] = []
  // The test spawns Claude Code itself, to hold its process: the SDK's close() sends SIGTERM only after a grace timer
  // that does not keep the test worker alive, so a Claude Code waiting on its API could outlive the run.
  let child: ChildProcess | null = null
  const run = query({
    prompt: 'worfy woke you.',
    // The stand-in in place of the subscription: the environment of the test, with the kind worfy gives the Session.
    options: {
      ...options,
      env: { ...claudeEnv(standIn, home), [SESSION_KIND_VARIABLE]: ASSISTANT_SESSION_KIND },
      stderr: (data) => stderr.push(data),
      spawnClaudeCodeProcess: ({ command, args, cwd: dir, env }) => (child = spawn(command, args, { cwd: dir, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })),
    },
  })
  // On every way out — a result, a failed expectation, a test that timed out (afterEach runs this first, before the
  // stand-in closes) — the query is closed and Claude Code is gone before the next step.
  const stop = async (): Promise<void> => {
    run.close()
    await ended(child)
  }
  cleanups.unshift(stop)
  try {
    for await (const message of run) if (message.type === 'result') break
  } finally {
    await stop()
  }
  return { standIn, memoryPart: () => kept, used, stderr: stderr.join(''), cwd }
}

describe('the Session of the Assistant on the real Claude Code', () => {
  it('a tool of worfy-app the model calls runs its handler: dontAsk lets the allowed tools through', async () => {
    const call = { id: 'toolu_note_1', name: appToolUseName('memory_note'), input: { kind: 'answer', topic: 'work hours', text: 'I start at 10 on Mondays' } }
    const { standIn, memoryPart, used, stderr } = await session(call)
    const result = standIn.toolResult()
    expect(result, `no tool result came; stderr: ${stderr}`).not.toBeNull()
    expect(result?.is_error, JSON.stringify(result?.content)).toBeUndefined()
    expect(memoryPart().answers).toEqual([{ id: 'memo-1', topic: 'work hours', text: 'I start at 10 on Mondays', at: Date.parse('2026-11-25T10:00:00Z') }])
    expect(used).toEqual([])
    // Only worfy-app's tools are offered, besides what the SDK adds to find deferred tools.
    const builtIn = standIn.toolsOffered().filter((name) => !name.startsWith('mcp__worfy-app__'))
    for (const name of ['Bash', 'Write', 'Edit', 'Read', 'WebFetch', 'WebSearch', 'Task', 'Agent']) expect(builtIn).not.toContain(name)
  })

  it('a call of Bash is refused, and its command never runs', async () => {
    const marker = join(tmpdir(), `worfy-assistant-bash-ran-${process.pid}-${Date.now()}`)
    const call = { id: 'toolu_bash_1', name: 'Bash', input: { command: `touch '${marker}'`, description: 'touch a file' } }
    const { standIn, stderr } = await session(call)
    const result = standIn.toolResult()
    expect(standIn.offered()).toBe(false)
    expect(result, `no tool result came; stderr: ${stderr}`).not.toBeNull()
    expect(result?.is_error).toBe(true)
    expect(existsSync(marker)).toBe(false)
  })
})

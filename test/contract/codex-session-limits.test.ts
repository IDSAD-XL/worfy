// The Limits of a Codex Session (src/main/vendors/codex/session.ts, worfy-multi-vendor ticket 26) on the
// fake app-server (WORFY_CODEX=fake, which test/setup-contract.ts sets): `account/rateLimits/updated`
// during a turn becomes a `limits` event whose windows the Session also records for the Limits panel
// (LimitsTracker.setWindows through CodexServerOptions.limits), and a turn the Limits refuse
// (`usageLimitExceeded`) gives `limit_reached` before the turn's `result`, the windows read again first.
//
// The fake runs under scriptNode() (test/script-node.ts) through the spawn stand-in of the session part,
// as in test/contract/codex-session.test.ts; what worfy sent is read from the fake's log (WORFY_CODEX_LOG).
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { LimitWindow } from '../../src/shared/agent/limits'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'
import { hasExited } from '../../src/main/agent/session/process'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { codexSessions } from '../../src/main/vendors/codex/session'
import type { SessionHandle } from '../../src/main/vendors/session'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const REPO = join(import.meta.dirname, '..', '..')
const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }
const ANSWER_MS = ms(10_000)

const roots: string[] = []
const handles: SessionHandle[] = []
const children: ChildProcess[] = []
afterEach(async () => {
  for (const handle of handles.splice(0)) handle.close()
  for (const child of children.splice(0)) {
    if (child.pid === undefined || hasExited(child)) continue
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGKILL')
    await exited
  }
  for (const root of roots.splice(0)) removeTestTree(root)
})

/** A Session on the fake playing `script`: its events, the windows it recorded, and what worfy sent. */
async function session(script: string) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'worfy-codex-session-limits-'))
  roots.push(root)
  const log = join(root, 'codex.log')
  const recorded: (readonly LimitWindow[])[] = []
  const part = codexSessions(() =>
    Promise.resolve({
      runtime: RUNTIME,
      appPath: REPO,
      clientVersion: '9.9.9',
      env: { ...process.env, WORFY_CODEX_SCRIPT: script, WORFY_CODEX_LOG: log },
      spawnProcess: (_file: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
        const child = spawn(scriptNode(), [...args], options)
        children.push(child)
        return child
      },
      log: () => undefined,
      limits: (windows: readonly LimitWindow[]) => recorded.push(windows),
    }),
  )
  const handle = await part.start({
    sessionId: 'worfy-session-1',
    cwd: root,
    settings: DEFAULT_SETTINGS,
    unattended: false,
    orchestrator: false,
    permissions: { ask: () => Promise.resolve(null), askQuestions: () => Promise.resolve({ outcome: 'cancelled' }) },
    refused: () => undefined,
    stderr: () => undefined,
    spawned: () => undefined,
  })
  handles.push(handle)
  const events: AgentEvent[] = []
  void (async () => {
    try {
      for await (const event of handle.events) events.push(event)
    } catch {
      // The process ended; the test looks at the events it had.
    }
  })()
  const sent = (method: string): unknown[] =>
    readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { method?: string; params?: unknown })
      .filter((message) => message.method === method)
      .map((message) => message.params)
  return { handle, events, recorded, sent }
}

async function until(events: readonly AgentEvent[], match: (event: AgentEvent) => boolean, what: string): Promise<void> {
  const deadline = Date.now() + ANSWER_MS
  while (!events.some(match)) {
    if (Date.now() > deadline) throw new Error(`not in time: ${what}; the events: ${JSON.stringify(events)}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** The Codex windows of `account/rateLimits/updated` in the scripts: 5 hours and 7 days, with these shares. */
const windows = (primary: number, secondary: number): LimitWindow[] => [
  { vendor: 'codex', id: 'primary', label: '5h', usedPercent: primary, windowMinutes: 300, resetsAt: 1793003600, state: primary >= 100 ? 'reached' : 'ok', receivedAt: expect.any(Number) as number, source: 'updated' },
  { vendor: 'codex', id: 'secondary', label: 'weekly', usedPercent: secondary, windowMinutes: 10080, resetsAt: 1793400000, state: 'ok', receivedAt: expect.any(Number) as number, source: 'updated' },
]

const limitEvents = (events: readonly AgentEvent[]): AgentEvent[] => events.filter((event) => ['limits', 'limit_reached', 'result'].includes(event.type))

describe('the Limits of a Codex Session', () => {
  it('a window used up: `limits` with the windows, recorded for the panel, then `limit_reached` for that window before the result', async () => {
    const { handle, events, recorded, sent } = await session('usage-limit-window')
    await handle.send({ text: 'Go on', attachments: [] })
    await until(events, (event) => event.type === 'result', 'the result')
    expect(limitEvents(events)).toEqual([
      { type: 'limits', vendor: 'codex', windows: windows(100, 64), status: null },
      { type: 'limit_reached', vendor: 'codex', windowId: 'primary', resetsAt: 1793003600, reason: 'window' },
      expect.objectContaining({ type: 'result', isError: true, terminalReason: 'usageLimitExceeded' }),
    ])
    expect(recorded).toEqual([windows(100, 64)])
    // The refusal asked the windows again on the Session's own app-server, as a background read.
    expect(sent('account/rateLimits/read')).toEqual([{ excludeResetCreditDetails: true }])
    // The notification is no `unknown` event any more.
    expect(events.filter((event) => event.type === 'unknown')).toEqual([])
  })

  it('a quota without a used-up window: `limit_reached` says `quota`, and the turn/completed after the error still ends the turn once', async () => {
    const { handle, events, recorded } = await session('usage-limit-quota')
    await handle.send({ text: 'Go on', attachments: [] })
    await until(events, (event) => event.type === 'result', 'the result')
    // turn/completed came right after the error, while the windows were being read: it waited for the decision.
    await new Promise((resolve) => setTimeout(resolve, ms(200)))
    expect(limitEvents(events)).toEqual([
      { type: 'limits', vendor: 'codex', windows: windows(30, 52), status: null },
      { type: 'limit_reached', vendor: 'codex', windowId: null, resetsAt: null, reason: 'quota' },
      expect.objectContaining({ type: 'result', isError: true }),
    ])
    expect(recorded).toEqual([windows(30, 52)])
  })

  it('a turn the Limits do not refuse gives no Limits events and records nothing', async () => {
    const { handle, events, recorded } = await session('turn')
    await handle.send({ text: 'Say hello', attachments: [] })
    await until(events, (event) => event.type === 'result', 'the result')
    expect(limitEvents(events).map((event) => event.type)).toEqual(['result'])
    expect(recorded).toEqual([])
  })
})

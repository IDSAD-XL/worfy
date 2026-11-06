// Park (worfy-auto-approve ticket 07, src/main/agent/auto-approve/park.ts): a request the approval policy
// leaves to the owner opens on the Session's gate (src/main/agent/permissions.ts) as a parked request —
// one answer for one request, no "Always allow" — and waits for the owner at most PARK_LIMIT_MS; the limit,
// and a stop of the run, end it as a deny with a hint and `park-expired`. The notification of such a request
// says "Parked: <tool> in <Project>" and never the command (src/main/notify.ts). The clock is a parameter;
// no real timer, process or OS notification runs here.
import { describe, expect, it, vi } from 'vitest'
import { createParker, PARK_EXPIRED_HINT, PARK_LIMIT_MS, PARK_STOPPED_HINT, parkDescription, type ParkClock, type ParkRequest } from '../../src/main/agent/auto-approve/park'
import type { Decision } from '../../src/main/agent/auto-approve/policy'
import { PermissionGate } from '../../src/main/agent/permissions'
import type { PermissionRequestOptions } from '../../src/main/agent/session/types'
import { CLAUDE_PERMISSION_OPTIONS, DENIED_MESSAGE, UNATTENDED_DENIED_MESSAGE, unattendedCanUseTool } from '../../src/main/vendors/claude/session'
import type { PermissionAsk, SessionApproval } from '../../src/main/vendors/session'
import { agentEvent, type AgentEvent } from '../../src/shared/agent/events'
import type { AutoApprovalMode } from '../../src/shared/settings/app-settings'

const electron = vi.hoisted(() => ({ shown: [] as { title: string; body: string }[] }))

vi.mock('electron', () => {
  class Notification {
    static isSupported = () => true
    constructor(private readonly options: { title: string; body: string }) {}
    on() {
      return this
    }
    show() {
      electron.shown.push(this.options)
    }
  }
  return { app: { focus: vi.fn() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, Notification }
})
vi.mock('../../src/main/window', () => ({ createMainWindow: () => undefined }))
vi.mock('../../src/main/foreground', async (original) => ({
  ...(await original<typeof import('../../src/main/foreground')>()),
  foregroundPid: () => Promise.resolve({ pid: process.pid }),
}))

const { Notifier } = await import('../../src/main/notify')

/** A clock whose timers fire only when the test says so. */
function fakeClock() {
  const timers = new Map<number, { fn: () => void; ms: number }>()
  let next = 0
  const clock: ParkClock = {
    setTimeout: (fn, ms) => {
      next += 1
      timers.set(next, { fn, ms })
      return next
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number)
    },
  }
  return {
    clock,
    timers,
    /** Fires every timer set so far. */
    fire: () => {
      for (const [id, timer] of [...timers]) {
        timers.delete(id)
        timer.fn()
      }
    },
  }
}

/** A gate with its events and the number of open requests after each change. */
function gate() {
  const events: AgentEvent[] = []
  const pending: number[] = []
  const permissions = new PermissionGate(
    (event) => events.push(event),
    (count) => pending.push(count),
  )
  const requests = () => events.filter((event): event is Extract<AgentEvent, { type: 'permission_request' }> => event.type === 'permission_request')
  return { permissions, events, pending, requests }
}

const parkRequest = (overrides: Partial<ParkRequest> = {}): ParkRequest => ({
  toolName: 'Bash',
  toolUseId: 'toolu_1',
  input: { command: 'rm -rf /tmp/outside/x' },
  blockedPath: null,
  rule: 'outside-roots',
  targets: ['/tmp/outside/x'],
  options: CLAUDE_PERMISSION_OPTIONS,
  signal: new AbortController().signal,
  ...overrides,
})

/** Lets the gate's promise reach its awaiter. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('park: the request waits on the gate for the owner', () => {
  it('opens a parked request with the rule and the targets, without "Always allow", and the Session needs permission', async () => {
    const g = gate()
    const park = createParker(g.permissions, { clock: fakeClock().clock })
    void park(parkRequest())
    const [request] = g.requests()
    expect(request).toMatchObject({ subject: 'Bash', toolName: 'Bash', toolUseId: 'toolu_1', input: { command: 'rm -rf /tmp/outside/x' }, parked: { rule: 'outside-roots', targets: ['/tmp/outside/x'] } })
    expect(request?.options.map((option) => option.kind)).toEqual(['allow', 'deny'])
    // The card shows the rule and the target.
    expect(request?.description).toBe(parkDescription('outside-roots', ['/tmp/outside/x']))
    expect(request?.description).toContain('outside-roots')
    expect(request?.description).toContain('/tmp/outside/x')
    // The event passes the schema the transcript and the renderer read it with.
    expect(agentEvent.safeParse({ ...request, at: 1 }).success).toBe(true)
    expect(g.permissions.pending).toBe(1)
    expect(g.pending).toEqual([1])
  })

  it('an answer allow lets this one request through; a second request of the same kind is parked again', async () => {
    const g = gate()
    const park = createParker(g.permissions, { clock: fakeClock().clock })
    const first = park(parkRequest())
    const id = g.requests()[0]?.requestId ?? ''
    expect(g.permissions.answer(id, 'allow')).toBe(true)
    await expect(first).resolves.toEqual({ outcome: 'answered', option: 'allow', kind: 'allow' })
    expect(g.permissions.pending).toBe(0)

    let done = false
    void park(parkRequest()).then(() => {
      done = true
    })
    await settle()
    expect(done).toBe(false)
    expect(g.requests()).toHaveLength(2)
    expect(g.permissions.pending).toBe(1)
  })

  it('an answer deny refuses it', async () => {
    const g = gate()
    const park = createParker(g.permissions, { clock: fakeClock().clock })
    const end = park(parkRequest())
    g.permissions.answer(g.requests()[0]?.requestId ?? '', 'deny')
    await expect(end).resolves.toEqual({ outcome: 'answered', option: 'deny', kind: 'deny' })
  })

  it('"Always allow" cannot be picked on a parked request, and none given elsewhere in the Session lets one through', async () => {
    const g = gate()
    const park = createParker(g.permissions, { clock: fakeClock().clock })
    const parked = park(parkRequest())
    const parkedId = g.requests()[0]?.requestId ?? ''
    expect(() => g.permissions.answer(parkedId, 'always_allow')).toThrow()
    // An attended request of the same tool answered "Always allow" leaves the parked one open…
    const signal = new AbortController().signal
    const ask: PermissionAsk = { subject: 'Bash', toolName: 'Bash', toolUseId: null, input: {}, title: null, description: null, blockedPath: null, suggestions: [], options: CLAUDE_PERMISSION_OPTIONS.map((option) => ({ ...option })), signal }
    const other = g.permissions.ask(ask)
    g.permissions.answer(g.requests()[1]?.requestId ?? '', 'always_allow')
    await expect(other).resolves.toBe('always_allow')
    expect(g.permissions.pending).toBe(1)
    // …and a new parked request of that tool still waits for the owner.
    void park(parkRequest())
    expect(g.requests()).toHaveLength(3)
    expect(g.permissions.pending).toBe(2)
    g.permissions.answer(parkedId, 'deny')
    await expect(parked).resolves.toMatchObject({ outcome: 'answered', kind: 'deny' })
  })
})

describe('park: the wait limit and the stop of the run', () => {
  it('waits PARK_LIMIT_MS by default (60 min, Q3), then ends the request as expired', async () => {
    expect(PARK_LIMIT_MS).toBe(60 * 60 * 1000)
    const g = gate()
    const c = fakeClock()
    const park = createParker(g.permissions, { clock: c.clock })
    const end = park(parkRequest())
    expect([...c.timers.values()].map((timer) => timer.ms)).toEqual([PARK_LIMIT_MS])
    c.fire()
    await expect(end).resolves.toEqual({ outcome: 'expired' })
    expect(g.permissions.pending).toBe(0)
    expect(g.events.at(-1)).toMatchObject({ type: 'permission_resolved', decision: 'cancelled' })
  })

  it('takes another limit, and an answer in time clears the timer', async () => {
    const g = gate()
    const c = fakeClock()
    const park = createParker(g.permissions, { clock: c.clock, limitMs: 5_000 })
    const end = park(parkRequest())
    expect([...c.timers.values()].map((timer) => timer.ms)).toEqual([5_000])
    g.permissions.answer(g.requests()[0]?.requestId ?? '', 'allow')
    await end
    expect(c.timers.size).toBe(0)
  })

  it('a stop of the run (releaseParked) ends every parked request as expired and leaves the others open', async () => {
    const g = gate()
    const c = fakeClock()
    const park = createParker(g.permissions, { clock: c.clock })
    const end = park(parkRequest())
    const signal = new AbortController().signal
    void g.permissions.ask({ subject: 'Edit', toolName: 'Edit', toolUseId: null, input: {}, title: null, description: null, blockedPath: null, suggestions: [], options: CLAUDE_PERMISSION_OPTIONS.map((option) => ({ ...option })), signal })
    expect(g.permissions.pending).toBe(2)
    // Only the parked one counts as parked (the run's limit of the background tasks reads it).
    expect(g.permissions.parked).toBe(1)
    g.permissions.releaseParked()
    await expect(end).resolves.toEqual({ outcome: 'expired' })
    expect(g.permissions.pending).toBe(1)
    expect(g.permissions.parked).toBe(0)
    expect(c.timers.size).toBe(0)
  })

  it('a Force stop (cancelAll, Session.halt) and the Vendor\'s own withdrawal end it as expired too', async () => {
    const g = gate()
    const park = createParker(g.permissions, { clock: fakeClock().clock })
    const end = park(parkRequest())
    g.permissions.cancelAll()
    await expect(end).resolves.toEqual({ outcome: 'expired' })

    const vendor = new AbortController()
    const withdrawn = park(parkRequest({ signal: vendor.signal }))
    vendor.abort()
    await expect(withdrawn).resolves.toEqual({ outcome: 'expired' })
    const aborted = new AbortController()
    aborted.abort()
    await expect(park(parkRequest({ signal: aborted.signal }))).resolves.toEqual({ outcome: 'expired' })
  })
})

describe('park: a run that stops while the request is on its way to the gate (review round 3 of PR #1467)', () => {
  it('a request opened on the gate while it may not wait is taken off at once as stopped', async () => {
    const g = gate()
    const c = fakeClock()
    const park = createParker(g.permissions, { clock: c.clock })
    await expect(park(parkRequest({ waits: () => false }))).resolves.toEqual({ outcome: 'stopped' })
    expect(g.requests()).toHaveLength(1)
    expect(g.events.at(-1)).toMatchObject({ type: 'permission_resolved', decision: 'cancelled' })
    expect(g.permissions.pending).toBe(0)
    expect(c.timers.size).toBe(0)
  })

  it('one that may wait stays open', async () => {
    const g = gate()
    const park = createParker(g.permissions, { clock: fakeClock().clock })
    void park(parkRequest({ waits: () => true }))
    await settle()
    expect(g.permissions.parked).toBe(1)
  })
})

describe('the unattended canUseTool parks in On', () => {
  function driver(mode: AutoApprovalMode, decision: Decision, run: { stopping: boolean; stopAtJudge?: boolean } = { stopping: false }) {
    const decided: unknown[] = []
    const approval: SessionApproval = {
      mode: () => mode,
      judge: () => {
        // The run turns to stopping after the judge decided, before the request reaches the gate.
        if (run.stopAtJudge === true) run.stopping = true
        return Promise.resolve(decision)
      },
      decided: (fields) => decided.push(fields),
      parks: () => !run.stopping,
    }
    const g = gate()
    const c = fakeClock()
    const canUseTool = unattendedCanUseTool(() => undefined, approval, undefined, createParker(g.permissions, { clock: c.clock }))
    const options: PermissionRequestOptions = { signal: new AbortController().signal, toolUseID: 'toolu_1', decisionReason: 'why', agentID: 'agent-1', blockedPath: '/tmp/outside' }
    const ask = (input: Record<string, unknown>) => canUseTool('Bash', input, options)
    return { decided, g, c, ask }
  }
  const parkDecision: Decision = { outcome: 'park', rule: 'outside-roots', hint: null, targets: ['/tmp/outside/x'] }
  const input = { command: 'rm -rf /tmp/outside/x' }
  const line = { mode: 'on', rule: 'outside-roots', tool: 'Bash', targets: ['/tmp/outside/x'], command: 'rm -rf /tmp/outside/x', agent: 'agent-1', reason: 'why' }

  it('allow: the call goes through with its input; the decisions are park, then park-answered with the answer', async () => {
    const d = driver('on', parkDecision)
    const answer = d.ask(input)
    await settle()
    expect(d.decided).toEqual([{ ...line, outcome: 'park' }])
    expect(d.g.requests()[0]).toMatchObject({ blockedPath: '/tmp/outside', parked: { rule: 'outside-roots' } })
    d.g.permissions.answer(d.g.requests()[0]?.requestId ?? '', 'allow')
    await expect(answer).resolves.toEqual({ behavior: 'allow', updatedInput: input })
    expect(d.decided).toEqual([
      { ...line, outcome: 'park' },
      { ...line, outcome: 'park-answered', answer: 'allow' },
    ])
  })

  it('deny: the call is refused as the owner refused it', async () => {
    const d = driver('on', parkDecision)
    const answer = d.ask(input)
    await settle()
    d.g.permissions.answer(d.g.requests()[0]?.requestId ?? '', 'deny')
    await expect(answer).resolves.toEqual({ behavior: 'deny', message: DENIED_MESSAGE })
    expect(d.decided.at(-1)).toEqual({ ...line, outcome: 'park-answered', answer: 'deny' })
  })

  it('the limit: deny with the hint after the reason, and park-expired', async () => {
    const d = driver('on', parkDecision)
    const answer = d.ask(input)
    await settle()
    d.c.fire()
    await expect(answer).resolves.toEqual({ behavior: 'deny', message: `${UNATTENDED_DENIED_MESSAGE}\nrefused because: why\n${PARK_EXPIRED_HINT}` })
    expect(d.decided.at(-1)).toEqual({ ...line, outcome: 'park-expired' })
  })

  it('a park with a hint of its own (git-hooks) keeps that hint after the expiry', async () => {
    const d = driver('on', { ...parkDecision, rule: 'git-hooks', hint: 'the hooks hint' })
    const answer = d.ask(input)
    await settle()
    d.g.permissions.releaseParked()
    await expect(answer).resolves.toEqual({ behavior: 'deny', message: `${UNATTENDED_DENIED_MESSAGE}\nrefused because: why\n${PARK_EXPIRED_HINT}\nthe hooks hint` })
  })

  it('a Stop between the judge and the gate: the request is taken off at once with PARK_STOPPED_HINT and park-expired', async () => {
    const d = driver('on', parkDecision, { stopping: false, stopAtJudge: true })
    const answer = await d.ask(input)
    expect(answer).toEqual({ behavior: 'deny', message: `${UNATTENDED_DENIED_MESSAGE}\nrefused because: why\n${PARK_STOPPED_HINT}` })
    expect(d.g.requests()).toHaveLength(1)
    expect(d.g.permissions.pending).toBe(0)
    expect(d.decided).toEqual([
      { ...line, outcome: 'park' },
      { ...line, outcome: 'park-expired' },
    ])
  })

  it('Shadow parks nothing: it refuses as before and records would-park', async () => {
    const d = driver('shadow', parkDecision)
    const answer = await d.ask(input)
    expect(answer.behavior).toBe('deny')
    expect(d.g.requests()).toEqual([])
    expect(d.decided).toEqual([{ ...line, mode: 'shadow', outcome: 'would-park' }])
  })
})

describe('the notification of a parked request', () => {
  const init = (cwd: string): AgentEvent => ({ type: 'init', sdkSessionId: 'sdk-1', model: 'm', permissionMode: 'default', apiKeySource: 'none', cwd, claudeCodeVersion: null, slashCommands: [] })

  it('goes once per request and says "Parked: <tool> in <Project>" without the command', async () => {
    const shown: { title: string; body: string }[] = []
    let now = 1_000_000
    const notifier = new Notifier({ focused: () => false, show: (note) => shown.push(note), open: () => undefined, now: () => now })
    notifier.sessionEvent('s1', init('/Users/test/alpha'))
    const g = gate()
    const park = createParker(g.permissions, { clock: fakeClock().clock })
    void park(parkRequest({ input: { command: 'rm -rf /tmp/outside/secret-name' } }))
    for (const event of g.events) notifier.sessionEvent('s1', event)
    g.permissions.answer(g.requests()[0]?.requestId ?? '', 'allow')
    now += 60_000
    for (const event of g.events.slice(1)) notifier.sessionEvent('s1', event)
    expect(shown).toEqual([{ title: 'alpha', body: 'Parked: Bash in alpha', sessionId: 's1', projectRoot: null }])
    expect(JSON.stringify(shown)).not.toContain('secret-name')
    expect(electron.shown).toEqual([])
  })
})

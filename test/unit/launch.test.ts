// "Ship ticket" and "Run wave" (ticket 23): when each is active (src/shared/actions/render-template.ts)
// and what main does on a click (src/main/actions/launch.ts) — over fakes of the Sessions, the
// Orchestrator, the registry and the Bindings store. Nothing here starts an agent or writes a file.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActionLauncher, type LaunchDeps, type LaunchedSession } from '../../src/main/actions/launch'
import { launchedHint, runWaveState, shipTicketState } from '../../src/shared/actions/render-template'
import type { LaunchesSnapshot } from '../../src/shared/ipc/actions'
import { AUTOPILOT_TEMPLATE_HINT, DEFAULT_ACTION_TEMPLATES, LEGACY_RUN_WAVE_TEMPLATE, type ActionTemplates } from '../../src/shared/projects/action-templates'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'

const t = (num: number, state: Ticket['state'], blockedNums: number[] = [], epic = 'worfy-mvp'): Ticket => ({
  epic,
  num,
  slug: `slug-${num}`,
  title: `T${num}`,
  statusRaw: state,
  state,
  blockedRaw: blockedNums.length ? blockedNums.join(', ') : '—',
  blockedNums,
  blockedParsed: true,
  files: [`src/f${num}.ts`],
  filesListed: true,
  fromBranch: null,
})

// 07 open with no blockers; 08 waits on 09 (open); 10 waits on 07 and 11 (done); 12 claimed.
const TICKETS = [t(7, 'open'), t(8, 'open', [9]), t(9, 'open'), t(10, 'open', [7, 11]), t(11, 'done'), t(12, 'work')]
const ticketOf = (num: number) => TICKETS.find((each) => each.num === num)!

describe('shipTicketState', () => {
  const state = (num: number, template = DEFAULT_ACTION_TEMPLATES.shipTicket, branch: string | null = 'main') => shipTicketState({ ticket: ticketOf(num), tickets: TICKETS, template, branch })

  it('is active on an open Ticket without open blockers, with the text it sends', () => {
    expect(state(7)).toEqual({ enabled: true, text: '/ship-ticket worfy-mvp 07' })
  })

  it('names each blocker that is not done', () => {
    expect(state(8)).toEqual({ enabled: false, reason: 'blocked by 09' })
    expect(state(10)).toEqual({ enabled: false, reason: 'blocked by 07' })
    // A blocker that is not a Ticket of the Epic is not done either.
    expect(shipTicketState({ ticket: t(13, 'open', [99]), tickets: TICKETS, template: 'x', branch: null })).toEqual({ enabled: false, reason: 'blocked by 99' })
  })

  it('a blocker of the same number in another Epic does not count', () => {
    const tickets = [...TICKETS, t(9, 'done', [], 'other')]
    expect(shipTicketState({ ticket: ticketOf(8), tickets, template: 'x', branch: null })).toEqual({ enabled: false, reason: 'blocked by 09' })
  })

  it('is inactive on a Ticket that is not open, saying why', () => {
    expect(state(12)).toEqual({ enabled: false, reason: 'Ticket is claimed' })
    expect(state(11)).toEqual({ enabled: false, reason: 'Ticket is done' })
    expect(shipTicketState({ ticket: t(14, 'blocked'), tickets: TICKETS, template: 'x', branch: null })).toEqual({ enabled: false, reason: 'Ticket is blocked' })
    const unparsed = { ...t(15, 'open'), blockedParsed: false, blockedRaw: 'after the audit' }
    expect(shipTicketState({ ticket: unparsed, tickets: TICKETS, template: 'x', branch: null })).toEqual({ enabled: false, reason: '“Blocked by: after the audit” is not a list of tickets' })
  })

  it('with an empty or blank template, points to Project settings', () => {
    expect(state(7, '')).toEqual({ enabled: false, reason: 'Set the Ship ticket template in Project settings' })
    expect(state(7, '  \n')).toEqual({ enabled: false, reason: 'Set the Ship ticket template in Project settings' })
  })

  it('is inactive while a Session it launched for the Ticket is live; a Ticket that is not open says that first', () => {
    expect(shipTicketState({ ticket: ticketOf(7), tickets: TICKETS, template: 'x', branch: null, launched: true })).toEqual({ enabled: false, reason: launchedHint(7) })
    expect(launchedHint(7)).toBe('Ship ticket already started a Session for 07; close that Session to start another')
    expect(shipTicketState({ ticket: ticketOf(12), tickets: TICKETS, template: 'x', branch: null, launched: true })).toEqual({ enabled: false, reason: 'Ticket is claimed' })
    expect(shipTicketState({ ticket: ticketOf(7), tickets: TICKETS, template: 'x', branch: null, launched: false })).toEqual({ enabled: true, text: 'x' })
  })

  it('a template that fails to render is inactive with the render error', () => {
    expect(state(7, '/ship-ticket {epic} {wave}')).toEqual({ enabled: false, reason: '{wave} has no value in Ship ticket' })
    expect(state(7, '/ship-ticket {branch}', null)).toEqual({ enabled: false, reason: '{branch} has no value in Ship ticket' })
  })
})

describe('runWaveState', () => {
  it('is active with a ready Wave and names its Tickets, with the list it named', () => {
    expect(runWaveState({ epic: 'worfy-mvp', tickets: TICKETS, template: DEFAULT_ACTION_TEMPLATES.runWave, branch: 'main' })).toEqual({
      enabled: true,
      text: '/epic-wave Ticket-ы 07, 09 эпика worfy-mvp',
      tickets: [7, 9],
      skipped: [],
    })
    // An owner's own template keeps {wave}, the number of the Wave in the plan.
    expect(runWaveState({ epic: 'worfy-mvp', tickets: TICKETS, template: LEGACY_RUN_WAVE_TEMPLATE, branch: 'main' })).toMatchObject({ enabled: true, text: '/epic-wave волна 1 эпика worfy-mvp' })
  })

  it('leaves blocked Tickets out of the Wave and lists them as skipped (ticket 30)', () => {
    const tickets = [t(11, 'open'), t(15, 'blocked'), t(16, 'none'), t(17, 'blocked', [11])]
    expect(runWaveState({ epic: 'worfy-mvp', tickets, template: DEFAULT_ACTION_TEMPLATES.runWave, branch: null })).toEqual({
      enabled: true,
      text: '/epic-wave Ticket-ы 11 эпика worfy-mvp',
      tickets: [11],
      skipped: [
        { num: 15, state: 'blocked' },
        { num: 16, state: 'none' },
      ],
    })
  })

  it('for Autopilot, refuses a template that does not name the Wave\'s tickets; by hand it runs', () => {
    const input = { epic: 'worfy-mvp', tickets: TICKETS, template: LEGACY_RUN_WAVE_TEMPLATE, branch: 'main' }
    expect(runWaveState({ ...input, autopilot: true })).toEqual({ enabled: false, reason: AUTOPILOT_TEMPLATE_HINT })
    expect(AUTOPILOT_TEMPLATE_HINT).toBe("The Run wave template does not name the Wave's tickets: add {tickets}")
    expect(runWaveState(input).enabled).toBe(true)
    // No ready Wave and an empty template still say so first.
    expect(runWaveState({ ...input, tickets: [t(1, 'work')], autopilot: true })).toEqual({ enabled: false, reason: 'No ready wave' })
    expect(runWaveState({ ...input, template: '', autopilot: true })).toEqual({ enabled: false, reason: 'Set the Run wave template in Project settings' })
    expect(runWaveState({ ...input, template: DEFAULT_ACTION_TEMPLATES.runWave, autopilot: true }).enabled).toBe(true)
  })

  it('is inactive without a ready Wave, with an empty template, and with {NN}', () => {
    expect(runWaveState({ epic: 'worfy-mvp', tickets: [t(1, 'work'), t(2, 'open', [1])], template: 'x', branch: null })).toEqual({ enabled: false, reason: 'No ready wave' })
    expect(runWaveState({ epic: 'worfy-mvp', tickets: TICKETS, template: '', branch: null })).toEqual({ enabled: false, reason: 'Set the Run wave template in Project settings' })
    expect(runWaveState({ epic: 'worfy-mvp', tickets: TICKETS, template: '/epic-wave {NN}', branch: null })).toEqual({ enabled: false, reason: '{NN} has no value in Run wave' })
  })
})

// ── the launcher ─────────────────────────────────────────────────────────────

class FakeSession implements LaunchedSession {
  sdkId: string | null = null
  state: LaunchedSession['state'] = 'starting'
  readonly sent: string[] = []
  constructor(private readonly busy = false) {}
  send(text: string): 'sent' | 'queued' {
    this.sent.push(text)
    return this.busy ? 'queued' : 'sent'
  }
}

/** Every launcher a test made, with its Sessions: afterEach closes them so no poll outlives its test. */
const made: { launch: ActionLauncher; sessions: Map<string, FakeSession> }[] = []

afterEach(async () => {
  for (const { launch, sessions } of made.splice(0)) {
    for (const session of sessions.values()) session.state = 'closed'
    await launch.idle()
  }
})

function launcher(
  change: { templates?: Partial<ActionTemplates>; other?: Partial<ActionTemplates>; tickets?: Ticket[]; model?: Partial<WorkflowModel>; orchestrator?: FakeSession; waitMs?: number; workflow?: LaunchDeps['workflow'] } = {},
) {
  const templates = { ...DEFAULT_ACTION_TEMPLATES, ...change.templates }
  const otherTemplates = { ...DEFAULT_ACTION_TEMPLATES, ...change.other }
  const sessions = new Map<string, FakeSession>()
  const orchestrator = change.orchestrator ?? new FakeSession()
  sessions.set('orch-1', orchestrator)
  const created: string[] = []
  const bindings: unknown[] = []
  const changes: LaunchesSnapshot[] = []
  let count = 0
  const deps: LaunchDeps = {
    projectRoot: (projectId) => {
      if (projectId !== 'p' && projectId !== 'q') throw new Error(`no Project ${projectId}`)
      return `/repo-${projectId}`
    },
    settings: (projectId) => ({ actionTemplates: projectId === 'q' ? otherTemplates : templates }),
    branch: async () => 'main',
    workflow: change.workflow ?? (async (root) => ({ root, epics: [{ epic: 'worfy-mvp', hasSpec: true, hasMap: false, title: null }], tickets: change.tickets ?? TICKETS, error: null, branchErrors: [], ...change.model })),
    sessions: {
      create: (projectId) => {
        count += 1
        const id = `pending-${count}`
        sessions.set(id, new FakeSession())
        created.push(projectId)
        return { projectId, nodeId: `node-${count}`, sessionId: id, sdkSessionId: null, state: 'starting', error: null, cwd: `/repo-${projectId}`, model: null, version: count }
      },
    },
    orchestrators: {
      open: async (projectId) => ({ projectId, nodeId: 'orch-node', sessionId: 'orch-1', state: 'idle', error: null, model: null, costUsd: 0, statusBlock: null, version: 1 }),
    },
    registry: {
      get: (sessionId) => {
        const session = sessions.get(sessionId)
        if (!session) throw new Error(`No live Session ${sessionId}`)
        return session
      },
    },
    bindings: { setLaunch: (projectId, agent, target) => bindings.push({ projectId, agent, target }) },
    onLaunchesChange: (snapshot) => changes.push(snapshot),
    pollMs: 1,
    waitMs: change.waitMs ?? 1000,
  }
  const launch = new ActionLauncher(deps)
  made.push({ launch, sessions })
  return { launch, sessions, created, bindings, orchestrator, changes }
}

describe('ActionLauncher.shipTicket', () => {
  it('starts a new Session, sends it the rendered template and binds it to the Ticket once Claude Code names the session', async () => {
    const { launch, sessions, created, bindings } = launcher()
    const result = await launch.shipTicket('p', 'worfy-mvp', 7)
    expect(result).toEqual({ nodeId: 'node-1', sessionId: 'pending-1', text: '/ship-ticket worfy-mvp 07' })
    expect(created).toEqual(['p'])
    const session = sessions.get('pending-1')!
    expect(session.sent).toEqual(['/ship-ticket worfy-mvp 07'])
    expect(bindings).toEqual([])
    session.sdkId = 'sdk-7'
    await launch.idle()
    expect(bindings).toEqual([{ projectId: 'p', agent: { sessionId: 'sdk-7', agentId: null }, target: { kind: 'ticket', epic: 'worfy-mvp', num: 7 } }])
  })

  it('sends a changed template as it is, with its values', async () => {
    const { launch, sessions } = launcher({ templates: { shipTicket: 'Сделай {epic}/{NN} ({slug}) от {branch}' } })
    await launch.shipTicket('p', 'worfy-mvp', 7)
    expect(sessions.get('pending-1')!.sent).toEqual(['Сделай worfy-mvp/07 (slug-7) от main'])
  })

  it('each Project sends its own template', async () => {
    const { launch, sessions, created } = launcher({ other: { shipTicket: 'q-ship {NN}' } })
    await launch.shipTicket('p', 'worfy-mvp', 7)
    await launch.shipTicket('q', 'worfy-mvp', 7)
    expect(created).toEqual(['p', 'q'])
    expect([sessions.get('pending-1')!.sent, sessions.get('pending-2')!.sent]).toEqual([['/ship-ticket worfy-mvp 07'], ['q-ship 07']])
  })

  it('refuses, and starts no Session, for an open blocker, an empty template, a claimed or unknown Ticket, a failed workflow read', async () => {
    const cases: [ReturnType<typeof launcher>, number, string][] = [
      [launcher(), 8, 'blocked by 09'],
      [launcher({ templates: { shipTicket: ' ' } }), 7, 'Set the Ship ticket template in Project settings'],
      [launcher(), 12, 'Ticket is claimed'],
      [launcher(), 42, 'worfy-mvp has no Ticket 42'],
      [launcher({ model: { error: { code: 'not-found', message: 'epic-status not found: /x' } } }), 7, 'Cannot read the workflow: epic-status not found: /x'],
    ]
    for (const [{ launch, created }, num, reason] of cases) {
      await expect(launch.shipTicket('p', 'worfy-mvp', num)).rejects.toThrow(reason)
      expect(created, reason).toEqual([])
    }
  })

  it('gives up the Binding of a Session that closes before it is named, without waiting out the wait', async () => {
    const { launch, sessions, bindings } = launcher({ waitMs: 60_000 })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await launch.shipTicket('p', 'worfy-mvp', 7)
    sessions.get('pending-1')!.state = 'closed'
    const started = Date.now()
    await launch.idle()
    // Seconds below the 60 s wait: it stopped because the Session closed, not because time ran out.
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(bindings).toEqual([])
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('refuses a second launch for the Ticket while the Session it launched lives, and allows one after it closes', async () => {
    const { launch, sessions, created } = launcher()
    await launch.shipTicket('p', 'worfy-mvp', 7)
    await expect(launch.shipTicket('p', 'worfy-mvp', 7)).rejects.toThrow(launchedHint(7))
    expect(created).toEqual(['p'])
    // Another Ticket, and the same Ticket in another Project, are not held by it.
    await launch.shipTicket('p', 'worfy-mvp', 9)
    await launch.shipTicket('q', 'worfy-mvp', 7)
    expect(created).toEqual(['p', 'p', 'q'])
    sessions.get('pending-1')!.state = 'closed'
    expect((await launch.shipTicket('p', 'worfy-mvp', 7)).sessionId).toBe('pending-4')
    expect(sessions.get('pending-4')!.sent).toEqual(['/ship-ticket worfy-mvp 07'])
  })

  it('two clicks that arrive together start one Session', async () => {
    const { launch, created } = launcher()
    const [first, second] = await Promise.allSettled([launch.shipTicket('p', 'worfy-mvp', 7), launch.shipTicket('p', 'worfy-mvp', 7)])
    expect(first.status).toBe('fulfilled')
    expect(second).toMatchObject({ status: 'rejected', reason: { message: 'Ship ticket is already starting a Session for 07' } })
    expect(created).toEqual(['p'])
  })

  it('a refused launch holds nothing: the next click is checked afresh', async () => {
    let fail = true
    const base = launcher()
    const { launch, created } = launcher({
      workflow: async (root) => {
        if (fail) return { root, epics: [], tickets: [], error: { code: 'not-found', message: 'gone' }, branchErrors: [] }
        return { root, epics: [{ epic: 'worfy-mvp', hasSpec: true, hasMap: false, title: null }], tickets: TICKETS, error: null, branchErrors: [] }
      },
    })
    await expect(launch.shipTicket('p', 'worfy-mvp', 7)).rejects.toThrow('Cannot read the workflow: gone')
    await expect(base.launch.shipTicket('p', 'worfy-mvp', 8)).rejects.toThrow('blocked by 09')
    await expect(base.launch.shipTicket('p', 'worfy-mvp', 8)).rejects.toThrow('blocked by 09')
    expect(base.launch.launched('p').tickets).toEqual([])
    fail = false
    await launch.shipTicket('p', 'worfy-mvp', 7)
    expect(created).toEqual(['p'])
  })

  it('reports the launched Tickets on a launch and again when the Session closes, without another click', async () => {
    const { launch, sessions, changes } = launcher()
    expect(launch.launched('p')).toEqual({ projectId: 'p', revision: 0, tickets: [] })
    await launch.shipTicket('p', 'worfy-mvp', 7)
    expect(changes).toEqual([{ projectId: 'p', revision: 1, tickets: [{ epic: 'worfy-mvp', num: 7 }] }])
    expect(launch.launched('p')).toEqual({ projectId: 'p', revision: 1, tickets: [{ epic: 'worfy-mvp', num: 7 }] })
    expect(launch.launched('q').tickets).toEqual([])
    sessions.get('pending-1')!.state = 'closed'
    await vi.waitFor(() => expect(changes).toHaveLength(2))
    expect(changes[1]).toEqual({ projectId: 'p', revision: 2, tickets: [] })
    expect(launch.launched('p')).toEqual({ projectId: 'p', revision: 2, tickets: [] })
  })
})

describe('ActionLauncher.runWave', () => {
  it('sends the rendered template to the Orchestrator and binds it to the Epic', async () => {
    const orchestrator = new FakeSession()
    orchestrator.sdkId = 'sdk-orch'
    const { launch, bindings } = launcher({ orchestrator })
    expect(await launch.runWave('p', 'worfy-mvp')).toEqual({ sessionId: 'orch-1', text: '/epic-wave Ticket-ы 07, 09 эпика worfy-mvp', delivery: 'sent' })
    expect(orchestrator.sent).toEqual(['/epic-wave Ticket-ы 07, 09 эпика worfy-mvp'])
    await launch.idle()
    expect(bindings).toEqual([{ projectId: 'p', agent: { sessionId: 'sdk-orch', agentId: null }, target: { kind: 'epic', epic: 'worfy-mvp' } }])
  })

  it('a busy Orchestrator gets it into its queue', async () => {
    const { launch, orchestrator } = launcher({ orchestrator: new FakeSession(true) })
    expect((await launch.runWave('p', 'worfy-mvp')).delivery).toBe('queued')
    expect(orchestrator.sent).toHaveLength(1)
  })

  it('refuses without a ready Wave, with an empty template, for an unknown Epic', async () => {
    const none = launcher({ tickets: [t(1, 'work'), t(2, 'open', [1])] })
    await expect(none.launch.runWave('p', 'worfy-mvp')).rejects.toThrow('No ready wave')
    const empty = launcher({ templates: { runWave: '' } })
    await expect(empty.launch.runWave('p', 'worfy-mvp')).rejects.toThrow('Set the Run wave template in Project settings')
    await expect(launcher().launch.runWave('p', 'nope')).rejects.toThrow('The Project has no Epic nope')
    for (const each of [none, empty]) expect(each.orchestrator.sent).toEqual([])
  })

  it('by hand, sends a template without {tickets} as it is', async () => {
    const { launch, orchestrator } = launcher({ templates: { runWave: LEGACY_RUN_WAVE_TEMPLATE } })
    await launch.runWave('p', 'worfy-mvp')
    expect(orchestrator.sent).toEqual(['/epic-wave волна 1 эпика worfy-mvp'])
  })
})

describe('ActionLauncher.autopilotWave (ticket 30)', () => {
  it('takes the text, the Tickets and the skipped ones from one read of the workflow model', async () => {
    let reads = 0
    // Each read answers a different Epic: a second read would name other Tickets than the text.
    const reads_ = [
      [t(11, 'open'), t(15, 'blocked'), t(23, 'open')],
      [t(11, 'done'), t(15, 'open'), t(23, 'done')],
    ]
    const workflow: LaunchDeps['workflow'] = async (root) => {
      const tickets = reads_[Math.min(reads, reads_.length - 1)]!
      reads += 1
      return { root, epics: [{ epic: 'worfy-mvp', hasSpec: true, hasMap: false, title: null }], tickets, error: null, branchErrors: [] }
    }
    const { launch, orchestrator } = launcher({ workflow })
    const sent = await launch.autopilotWave('p', 'worfy-mvp')
    expect(reads).toBe(1)
    expect(sent).toMatchObject({ text: '/epic-wave Ticket-ы 11, 23 эпика worfy-mvp', tickets: [11, 23], skipped: [{ num: 15, state: 'blocked' }] })
    expect(orchestrator.sent).toEqual(['/epic-wave Ticket-ы 11, 23 эпика worfy-mvp'])
  })

  it('refuses a template without {tickets} and sends nothing; autopilotRefusal says the same before a run', async () => {
    const own = launcher({ templates: { runWave: LEGACY_RUN_WAVE_TEMPLATE } })
    await expect(own.launch.autopilotWave('p', 'worfy-mvp')).rejects.toThrow(AUTOPILOT_TEMPLATE_HINT)
    expect(own.orchestrator.sent).toEqual([])
    expect(own.launch.autopilotRefusal('p')).toBe(AUTOPILOT_TEMPLATE_HINT)
    expect(launcher().launch.autopilotRefusal('p')).toBeNull()
    // An empty template is the button's own reason, not this one.
    expect(launcher({ templates: { runWave: '' } }).launch.autopilotRefusal('p')).toBe('Set the Run wave template in Project settings')
  })
})

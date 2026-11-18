// The `actions` domain at its boundary (ticket 23): `actions.shipTicket` and `actions.runWave`
// registered through registerIpc, the same wrapper the app uses, over a fake launcher. The
// launcher gets only what the contract describes, a wrong type never reaches it, and the renderer
// gets only the contract's keys back.
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest'
import { ActionLauncher, FOLLOW_SESSION_MS, GATE_QUEUE_AUTOPILOT_HINT, gateQueueRoleHint, PR_FOLLOW_AUTOPILOT_HINT, prFollowStartingHint, prFollowWaveHint, type FollowSession, type LaunchDeps } from '../../src/main/actions/launch'
import type { AutopilotDeps } from '../../src/main/autopilot/run'
import { actionsHandlers, prInboxPull } from '../../src/main/ipc/actions'
import { appUrlMatcher, emit, registerIpc } from '../../src/main/ipc/index'
import { createLinkIpc, LinkPeer, readOnlyRefusal } from '../../src/main/link/ipc-adapter'
import type { SessionState } from '../../src/shared/agent/events'
import { actionsLaunchesChanged } from '../../src/shared/ipc/actions'
import type { ManualBinding } from '../../src/shared/ipc/bindings'
import type { AccessLevel } from '../../src/shared/ipc/link'
import type { PrInboxRow, PrInboxSnapshot } from '../../src/shared/ipc/pr-inbox'
import type { LayoutNode } from '../../src/shared/layout/types'
import type { Ticket } from '../../src/shared/workflow/types'
import { defaultActionTemplates, type HarnessKind } from '../../src/shared/projects/action-templates'
import { failureReason, handlerFailure, IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { APP_URL, INDEX_HTML } from '../app-url'

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

/** Which renderer the registered handlers trust: the bundled index.html unless a dev server is given. */
async function register(options: { devServerUrl?: string } = {}) {
  const calls: unknown[][] = []
  const launcher = {
    shipTicket: async (...args: [string, string, number]) => {
      calls.push(['shipTicket', ...args])
      if (args[2] === 9) throw new Error('blocked by 08')
      return { nodeId: 'n1', sessionId: 'pending-1', text: '/ship-ticket e 07', cwd: '/secret', extra: true }
    },
    runWave: async (...args: [string, string]) => {
      calls.push(['runWave', ...args])
      return { sessionId: 'o1', text: '/epic-wave волна 1 эпика e', delivery: 'queued' as const, extra: 1 }
    },
    gateQueue: async (projectId: string) => {
      calls.push(['gateQueue', projectId])
      return { sessionId: 'o1', text: '/worfy:gate-queue', delivery: 'sent' as const, extra: 1 }
    },
    prReply: (...args: [string, string, number]) => {
      calls.push(['prReply', ...args])
      return { nodeId: 'n2', sessionId: 'pending-2', text: '/worfy:pr-reply example-org/app#118', cwd: '/secret' }
    },
    prFollow: async (...args: [string, string, number, string, { x: number; y: number }?]) => {
      calls.push(['prFollow', ...args])
      return { nodeId: 'n3', sessionId: 'live-3', text: '/worfy:pr-fix checks example-org/app#118 ' + 'a'.repeat(40), delivery: 'new' as const, cwd: '/secret' }
    },
    launched: (projectId: string) => {
      calls.push(['launched', projectId])
      return { projectId, revision: 3, tickets: [{ epic: 'e', num: 7, sessionId: 'secret' }], extra: true }
    },
  }
  const handlers = new Map<string, Listener>()
  await registerIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
    { modules: { './actions.ts': async () => actionsHandlers(() => launcher) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML, devServerUrl: options.devServerUrl }) },
  )
  const invokeFrom = async (frameUrl: string, channel: string, input: unknown): Promise<IpcResult<unknown>> => {
    const listener = handlers.get(`${IPC_CHANNEL_PREFIX}${channel}`)
    if (!listener) throw new Error(`${channel} is not registered`)
    return (await listener({ senderFrame: { url: frameUrl }, sender: {} } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
  }
  const invoke = (channel: string, input: unknown): Promise<IpcResult<unknown>> => invokeFrom(APP_URL, channel, input)
  return { invoke, invokeFrom, calls }
}

describe('actions.shipTicket', () => {
  it('passes only the Project, the Epic and the number, and answers only the contract keys', async () => {
    const { invoke, calls } = await register()
    const result = await invoke('actions.shipTicket', { projectId: 'p', epic: 'e', num: 7, template: '/rm -rf', extra: true })
    expect(result).toStrictEqual({ ok: true, value: { nodeId: 'n1', sessionId: 'pending-1', text: '/ship-ticket e 07' } })
    expect(calls).toStrictEqual([['shipTicket', 'p', 'e', 7]])
  })

  it('refuses a wrong type before the launcher runs', async () => {
    const { invoke, calls } = await register()
    for (const input of [
      { projectId: 'p', epic: 'e', num: '7' },
      { projectId: 'p', epic: '../e', num: 7 },
      { projectId: 'p', epic: 'e', num: -1 },
      { projectId: 'p', epic: 'e', num: 1.5 },
      { projectId: '', epic: 'e', num: 7 },
      { epic: 'e', num: 7 },
      undefined,
    ]) {
      const result = await invoke('actions.shipTicket', input)
      expect(result.ok, JSON.stringify(input)).toBe(false)
      expect(!result.ok && result.error, JSON.stringify(input)).toMatch(/actions\.shipTicket: invalid input/)
    }
    expect(calls).toEqual([])
  })

  it('answers the launcher\'s refusal as {ok:false}, from which the renderer takes the reason alone', async () => {
    const { invoke } = await register()
    const result = await invoke('actions.shipTicket', { projectId: 'p', epic: 'e', num: 9 })
    expect(result).toEqual({ ok: false, error: handlerFailure('actions.shipTicket', 'blocked by 08') })
    // The button shows only the reason, however the wrapper words the failure.
    expect(failureReason('actions.shipTicket', (result as { error: string }).error)).toBe('blocked by 08')
    // Any other failure stays whole: an invalid input says so rather than losing its start.
    const invalid = await invoke('actions.shipTicket', { projectId: 'p', epic: 'e', num: 'x' })
    expect(invalid.ok).toBe(false)
    const error = (invalid as { error: string }).error
    expect(failureReason('actions.shipTicket', error)).toBe(error)
    expect(failureReason('actions.runWave', handlerFailure('actions.shipTicket', 'blocked by 08'))).toBe('actions.shipTicket failed: blocked by 08')
  })
})

describe('actions.runWave', () => {
  it('passes only the Project and the Epic, and answers only the contract keys', async () => {
    const { invoke, calls } = await register()
    const result = await invoke('actions.runWave', { projectId: 'p', epic: 'e', wave: 3 })
    expect(result).toStrictEqual({ ok: true, value: { sessionId: 'o1', text: '/epic-wave волна 1 эпика e', delivery: 'queued' } })
    expect(calls).toStrictEqual([['runWave', 'p', 'e']])
  })

  it('refuses a wrong type before the launcher runs', async () => {
    const { invoke, calls } = await register()
    for (const input of [{ projectId: 'p', epic: 7 }, { projectId: 'p', epic: 'a/b' }, { projectId: 'p' }]) {
      const result = await invoke('actions.runWave', input)
      expect(result.ok, JSON.stringify(input)).toBe(false)
      expect(!result.ok && result.error, JSON.stringify(input)).toMatch(/actions\.runWave: invalid input/)
    }
    expect(calls).toEqual([])
  })
})

describe('actions.launches', () => {
  it('passes only the Project, and answers only the contract keys', async () => {
    const { invoke, calls } = await register()
    const result = await invoke('actions.launches', { projectId: 'p', epic: 'e' })
    expect(result).toStrictEqual({ ok: true, value: { projectId: 'p', revision: 3, tickets: [{ epic: 'e', num: 7 }] } })
    expect(calls).toStrictEqual([['launched', 'p']])
  })

  it('refuses a wrong type before the launcher runs', async () => {
    const { invoke, calls } = await register()
    for (const input of [{ projectId: '' }, { projectId: 7 }, {}, undefined]) {
      const result = await invoke('actions.launches', input)
      expect(result.ok, JSON.stringify(input)).toBe(false)
      expect(!result.ok && result.error, JSON.stringify(input)).toMatch(/actions\.launches: invalid input/)
    }
    expect(calls).toEqual([])
  })
})

describe('actions.launches.changed', () => {
  it('sends only the contract keys, and refuses a payload of the wrong type', () => {
    const sent: unknown[][] = []
    const target = { send: (...args: unknown[]) => sent.push(args) }
    const extra = { projectId: 'p', revision: 2, tickets: [{ epic: 'e', num: 7, sessionId: 'secret' }], extra: true }
    emit(target, actionsLaunchesChanged, extra as unknown as Parameters<typeof emit<typeof actionsLaunchesChanged>>[2])
    expect(sent).toStrictEqual([[`${IPC_CHANNEL_PREFIX}actions.launches.changed`, { projectId: 'p', revision: 2, tickets: [{ epic: 'e', num: 7 }] }]])
    expect(() => emit(target, actionsLaunchesChanged, { projectId: 'p', revision: -1, tickets: [] })).toThrow('invalid event payload')
    expect(() => emit(target, actionsLaunchesChanged, { projectId: 'p', revision: 1, tickets: [{ epic: '../e', num: 7 }] })).toThrow('invalid event payload')
    expect(sent).toHaveLength(1)
  })
})

// In a dev run (ELECTRON_RENDERER_URL, ticket worfy-daily/16) the window loads from the dev server,
// and the sender check trusts that origin: any page of it, and nothing else. A packaged app never
// gets here with the variable (test/unit/renderer-entry.test.ts).
describe('the sender check with a dev server', () => {
  const DEV_SERVER = 'http://localhost:5173'

  it('accepts a call from any page of the dev server origin', async () => {
    const { invokeFrom, calls } = await register({ devServerUrl: DEV_SERVER })
    expect(await invokeFrom(`${DEV_SERVER}/`, 'actions.launches', { projectId: 'p' })).toMatchObject({ ok: true })
    expect(await invokeFrom(`${DEV_SERVER}/nested/page.html?x=1#y`, 'actions.launches', { projectId: 'p' })).toMatchObject({ ok: true })
    expect(calls).toStrictEqual([['launched', 'p'], ['launched', 'p']])
  })

  it.each([
    ['another port', 'http://localhost:5174/'],
    ['another host', 'http://127.0.0.1:5173/'],
    ['another scheme', 'https://localhost:5173/'],
    ['the bundled index.html', APP_URL],
    ['a Card', 'worfy-card://abc/index.html'],
    ['an opaque origin', 'data:text/html,hi'],
    ['a frame URL that does not parse', 'not a url'],
  ])('refuses a call from %s before the launcher runs', async (_what, frameUrl) => {
    const { invokeFrom, calls } = await register({ devServerUrl: DEV_SERVER })
    const result = await invokeFrom(frameUrl, 'actions.launches', { projectId: 'p' })
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.error).toContain('untrusted frame')
    expect(calls).toEqual([])
  })

  it.each(['not a url', 'localhost:5173', 'about:blank', 'file:///tmp/index.html'])(
    'refuses to build a check from the dev server address %j instead of trusting what it parses to',
    (devServerUrl) => {
      expect(() => appUrlMatcher({ indexHtml: INDEX_HTML, devServerUrl })).toThrow('not an http(s) URL')
    },
  )
})

describe('actions.gateQueue (worfy-windows ticket 17)', () => {
  it('passes only the Project, and answers only the contract keys', async () => {
    const { invoke, calls } = await register()
    const result = await invoke('actions.gateQueue', { projectId: 'p', text: '/rm -rf' })
    expect(result).toStrictEqual({ ok: true, value: { sessionId: 'o1', text: '/worfy:gate-queue', delivery: 'sent' } })
    expect(calls).toStrictEqual([['gateQueue', 'p']])
    for (const input of [{ projectId: '' }, { projectId: 7 }, {}, undefined]) {
      const refused = await invoke('actions.gateQueue', input)
      expect(!refused.ok && refused.error, JSON.stringify(input)).toMatch(/actions\.gateQueue: invalid input/)
    }
    expect(calls).toHaveLength(1)
  })

  /** The real launcher behind the channel, over a fake Orchestrator: what it sends, or why not. */
  async function withLauncher(role: 'serve' | 'request' | null, template: string, autopilot = false) {
    const sent: string[] = []
    const deps: LaunchDeps = {
      projectRoot: () => '/repo',
      settings: () => ({ actionTemplates: { ...defaultActionTemplates('plugin'), gateQueue: template } }),
      branch: async () => 'main',
      workflow: async (root) => ({ root, epics: [], tickets: [], error: null, branchErrors: [] }),
      sessions: { create: () => { throw new Error('no Session is created') } },
      orchestrators: { open: async (projectId) => ({ projectId, nodeId: 'orch-node', sessionId: 'orch-1', state: 'idle', error: null, model: null, costUsd: 0, statusBlock: null, version: 1 }) },
      registry: { get: () => ({ send: (text: string) => (sent.push(text), 'sent' as const), sdkId: null, state: 'idle' as const }) },
      bindings: { setLaunch: () => undefined },
      gateRole: async () => role,
    }
    const launcher = new ActionLauncher(deps)
    if (autopilot) launcher.attachAutopilot({ running: () => true })
    const handlers = new Map<string, Listener>()
    await registerIpc(
      { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
      { modules: { './actions.ts': async () => actionsHandlers(() => launcher) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) },
    )
    const listener = handlers.get(`${IPC_CHANNEL_PREFIX}actions.gateQueue`)!
    const result = (await listener({ senderFrame: { url: APP_URL }, sender: {} } as unknown as IpcMainInvokeEvent, { projectId: 'p' })) as IpcResult<unknown>
    return { result, sent }
  }

  it('on serve sends /worfy:gate-queue to the Project\'s Orchestrator', async () => {
    const { result, sent } = await withLauncher('serve', '/worfy:gate-queue')
    expect(result).toStrictEqual({ ok: true, value: { sessionId: 'orch-1', text: '/worfy:gate-queue', delivery: 'sent' } })
    expect(sent).toEqual(['/worfy:gate-queue'])
  })

  it.each([
    ['request', 'request' as const, '/worfy:gate-queue', false, gateQueueRoleHint('request')],
    ['no cross_machine_gate', null, '/worfy:gate-queue', false, gateQueueRoleHint(null)],
    ['an empty template', 'serve' as const, '', false, 'Set the Process gate queue template in Project settings'],
    ['Autopilot running', 'serve' as const, '/worfy:gate-queue', true, GATE_QUEUE_AUTOPILOT_HINT],
  ])('%s: refused with the reason, nothing sent', async (_name, role, template, autopilot, reason) => {
    const { result, sent } = await withLauncher(role, template, autopilot)
    expect(result.ok).toBe(false)
    expect(failureReason('actions.gateQueue', (result as { error: string }).error)).toBe(reason)
    expect(sent).toEqual([])
  })
})

describe('actions.prReply (worfy-pr-inbox ticket 04)', () => {
  it('passes only the Project, the repository and the number, and answers only the contract keys', async () => {
    const { invoke, calls } = await register()
    const result = await invoke('actions.prReply', { projectId: 'p', repo: 'example-org/app', pr: 118, text: '/rm -rf' })
    expect(result).toStrictEqual({ ok: true, value: { nodeId: 'n2', sessionId: 'pending-2', text: '/worfy:pr-reply example-org/app#118' } })
    expect(calls).toStrictEqual([['prReply', 'p', 'example-org/app', 118]])
  })

  it.each([
    { projectId: 'p', repo: 'app', pr: 118 },
    { projectId: 'p', repo: 'example-org/app; rm -rf ~', pr: 118 },
    { projectId: 'p', repo: 'example-org/app\n/worfy:ship-ticket', pr: 118 },
    { projectId: 'p', repo: 'example-org/a/b', pr: 118 },
    { projectId: 'p', repo: '-org/app', pr: 118 },
    { projectId: 'p', repo: 'example-org/app', pr: 0 },
    { projectId: 'p', repo: 'example-org/app', pr: 1.5 },
    { projectId: 'p', repo: 'example-org/app', pr: '118' },
    { projectId: '', repo: 'example-org/app', pr: 118 },
    { repo: 'example-org/app', pr: 118 },
  ])('refuses %j before the launcher runs', async (input) => {
    const { invoke, calls } = await register()
    const result = await invoke('actions.prReply', input)
    expect(!result.ok && result.error).toMatch(/actions\.prReply: invalid input/)
    expect(calls).toEqual([])
  })

  /** The real launcher behind the channel: what it creates and sends, or why not. */
  async function withLauncher(harness: HarnessKind, template?: string) {
    const created: unknown[][] = []
    const sent: string[] = []
    const opened: string[] = []
    const deps: LaunchDeps = {
      projectRoot: (projectId) => {
        if (projectId !== 'p') throw new Error(`no Project ${projectId}`)
        return '/repo'
      },
      settings: () => ({ actionTemplates: { ...defaultActionTemplates(harness), ...(template === undefined ? {} : { prReply: template }) } }),
      branch: async () => 'main',
      workflow: async (root) => ({ root, epics: [], tickets: [], error: null, branchErrors: [] }),
      sessions: {
        create: (projectId, near, vendor) => {
          created.push([projectId, near, vendor])
          return { projectId, nodeId: 'node-9', vendor, sessionId: 'starting-node-9', sdkSessionId: null, state: 'starting', error: null, cwd: '/repo', model: null, version: 1 }
        },
      },
      orchestrators: {
        open: async (projectId) => {
          opened.push(projectId)
          throw new Error('the Orchestrator is not for Draft replies')
        },
      },
      registry: { get: () => ({ send: (text: string) => (sent.push(text), 'sent' as const), sdkId: null, state: 'idle' as const }) },
      bindings: { setLaunch: () => { throw new Error('Draft replies binds nothing') } },
    }
    const launcher = new ActionLauncher(deps)
    // Autopilot running in the Project changes nothing: Draft replies is a Session of its own, with a person.
    launcher.attachAutopilot({ running: () => true })
    const handlers = new Map<string, Listener>()
    await registerIpc(
      { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
      { modules: { './actions.ts': async () => actionsHandlers(() => launcher) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) },
    )
    const listener = handlers.get(`${IPC_CHANNEL_PREFIX}actions.prReply`)!
    const call = async (input: unknown) => (await listener({ senderFrame: { url: APP_URL }, sender: {} } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
    return { call, created, sent, opened }
  }

  it('starts a new Session Node of the Project on Claude Code, whose first message is the template filled in', async () => {
    const { call, created, sent, opened } = await withLauncher('plugin')
    const result = await call({ projectId: 'p', repo: 'example-org/app', pr: 118 })
    expect(result).toStrictEqual({ ok: true, value: { nodeId: 'node-9', sessionId: 'starting-node-9', text: '/worfy:pr-reply example-org/app#118' } })
    expect(created).toStrictEqual([['p', undefined, 'claude']])
    expect(sent).toStrictEqual(['/worfy:pr-reply example-org/app#118'])
    expect(opened).toEqual([])
  })

  it('fills the Project\'s own template, {repo} and {pr} wherever they stand', async () => {
    const { call, sent } = await withLauncher('plugin', '  Draft replies for PR {pr} of {repo} (/worfy:pr-reply {repo}#{pr})  ')
    const result = await call({ projectId: 'p', repo: 'example-org/app', pr: 7 })
    expect(result.ok).toBe(true)
    expect(sent).toStrictEqual(['Draft replies for PR 7 of example-org/app (/worfy:pr-reply example-org/app#7)'])
  })

  it.each([
    ['the old Harness without the plugin: an empty template', 'legacy' as const, undefined, 'Set the Draft replies template in Project settings'],
    ['a blank template', 'plugin' as const, '   ', 'Set the Draft replies template in Project settings'],
    ['a template with a placeholder Draft replies has no value for', 'plugin' as const, '/worfy:pr-reply {repo}#{pr} {epic}', '{epic} has no value in Draft replies'],
  ])('%s: refused with the reason, no Session', async (_name, harness, template, reason) => {
    const { call, created, sent } = await withLauncher(harness, template)
    const result = await call({ projectId: 'p', repo: 'example-org/app', pr: 118 })
    expect(result.ok).toBe(false)
    expect(failureReason('actions.prReply', (result as { error: string }).error)).toBe(reason)
    expect(created).toEqual([])
    expect(sent).toEqual([])
  })

  it('refuses a Project that is not in the list', async () => {
    const { call, created } = await withLauncher('plugin')
    const result = await call({ projectId: 'q', repo: 'example-org/app', pr: 118 })
    expect(failureReason('actions.prReply', (result as { error: string }).error)).toBe('no Project q')
    expect(created).toEqual([])
  })

  // Autopilot drives the Project's Orchestrator only, through ActionLauncher.autopilotWave and the two calls beside
  // it; it is given no way to start Draft replies (the test above: the Orchestrator is never opened for it).
  it('is not among the calls Autopilot has', () => {
    expectTypeOf<AutopilotDeps['waves']>().not.toHaveProperty('prReply')
    expectTypeOf<keyof AutopilotDeps['waves']>().toEqualTypeOf<'autopilotWave' | 'autopilotRefusal' | 'autopilotGateQueue'>()
  })

  describe('from a Linked machine', () => {
    const peers: LinkPeer[] = []
    afterEach(() => {
      for (const peer of peers.splice(0)) peer.close()
    })

    async function linked(level: AccessLevel) {
      const calls: unknown[][] = []
      const launcher = {
        shipTicket: async () => { throw new Error('not here') },
        runWave: async () => { throw new Error('not here') },
        gateQueue: async () => { throw new Error('not here') },
        launched: () => { throw new Error('not here') },
        prFollow: async () => { throw new Error('not here') },
        prReply: (...args: [string, string, number]) => {
          calls.push(args)
          return { nodeId: 'n2', sessionId: 'pending-2', text: '/worfy:pr-reply example-org/app#118' }
        },
      }
      const adapter = await createLinkIpc({ modules: { './actions.ts': async () => actionsHandlers(() => launcher) }, isLinked: () => true })
      const peer = new LinkPeer({ machineId: 'mac', describe: () => 'mac', push: () => undefined, local: () => ({ id: 'here', name: 'Studio', protocol: 1, build: 'test' }), warn: () => undefined })
      peer.setAccess(level)
      peers.push(peer)
      return { calls, call: (input: unknown) => adapter.call(peer, 'actions.prReply', input, 'Studio') }
    }

    it('with read-only access is refused before the launcher runs', async () => {
      const { call, calls } = await linked('read')
      const result = await call({ projectId: 'p', repo: 'example-org/app', pr: 118 })
      expect(result.ok).toBe(false)
      expect(!result.ok && result.error).toContain(readOnlyRefusal('Studio'))
      expect(calls).toEqual([])
    })

    it('with full access starts it, as a window of this machine does', async () => {
      const { call, calls } = await linked('all')
      const result = await call({ projectId: 'p', repo: 'example-org/app', pr: 118 })
      expect(result).toStrictEqual({ ok: true, value: { nodeId: 'n2', sessionId: 'pending-2', text: '/worfy:pr-reply example-org/app#118' } })
      expect(calls).toStrictEqual([['p', 'example-org/app', 118]])
    })
  })
})

describe('actions.prFollow (worfy-pr-follow ticket 01)', () => {
  const SHA = 'a'.repeat(40)

  it('passes only the Project, the PR, the action and the spot, and answers only the contract keys', async () => {
    const { invoke, calls } = await register()
    const result = await invoke('actions.prFollow', { projectId: 'p', repo: 'example-org/app', pr: 118, action: 'fixChecks', text: '/rm -rf', sha: 'x' })
    expect(result).toStrictEqual({ ok: true, value: { nodeId: 'n3', sessionId: 'live-3', text: `/worfy:pr-fix checks example-org/app#118 ${SHA}`, delivery: 'new' } })
    expect(calls).toStrictEqual([['prFollow', 'p', 'example-org/app', 118, 'fixChecks']])
    await invoke('actions.prFollow', { projectId: 'p', repo: 'example-org/app', pr: 118, action: 'resolveConflicts', near: { x: 10, y: 20 } })
    expect(calls[1]).toStrictEqual(['prFollow', 'p', 'example-org/app', 118, 'resolveConflicts', { x: 10, y: 20 }])
  })

  it.each([
    { projectId: 'p', repo: 'example-org/app', pr: 118, action: 'prReply' },
    { projectId: 'p', repo: 'example-org/app', pr: 118, action: 'shipTicket' },
    { projectId: 'p', repo: 'example-org/app', pr: 118 },
    { projectId: 'p', repo: 'example-org/app\n/worfy:ship-ticket', pr: 118, action: 'fixChecks' },
    { projectId: 'p', repo: 'example-org/app', pr: 0, action: 'fixChecks' },
    { projectId: 'p', repo: 'example-org/app', pr: 118, action: 'fixChecks', near: { x: 'a', y: 1 } },
    { repo: 'example-org/app', pr: 118, action: 'fixChecks' },
  ])('refuses %j before the launcher runs', async (input) => {
    const { invoke, calls } = await register()
    const result = await invoke('actions.prFollow', input)
    expect(!result.ok && result.error).toMatch(/actions\.prFollow: invalid input/)
    expect(calls).toEqual([])
  })

  // The real launcher behind the channel, over a fake PR inbox, Layout, Claude home, Orchestrator and Sessions.
  const NOW = Date.parse('2026-11-18T12:00:00Z')
  const HOUR = 60 * 60_000
  const ME = 'dev-me'
  const REPO = 'example-org/web'
  const OLD_HEAD = 'b'.repeat(40)
  const NEW_HEAD = '3f2a9c1d4e5b6a7980123456789abcdef0123456'
  const TICKET_SDK = 'sdk-ticket-7'

  const ticket = (num: number, pr: number | null): Ticket => ({
    epic: 'shop',
    num,
    slug: `t${num}`,
    title: `Ticket ${num}`,
    statusRaw: 'work',
    state: 'work',
    blockedRaw: null,
    blockedNums: [],
    blockedParsed: true,
    files: [],
    filesListed: true,
    fromBranch: null,
    pr,
  })

  const rowOf = (over: Partial<PrInboxRow> = {}): PrInboxRow => ({
    repo: REPO,
    number: 118,
    title: 'Retry on 429',
    url: `https://github.com/${REPO}/pull/118`,
    isDraft: false,
    isCrossRepository: false,
    author: ME,
    headRefName: 'fix/retry-429',
    headRefOid: NEW_HEAD,
    createdAt: '2026-11-17T10:00:00Z',
    updatedAt: '2026-11-18T10:00:00Z',
    ci: 'failing',
    reviewDecision: null,
    mergeStateStatus: 'CLEAN',
    additions: 42,
    deletions: 7,
    viaTeam: false,
    unresolvedThreads: 0,
    newSinceSeen: 0,
    lastActivityAt: '2026-11-18T10:00:00Z',
    threads: [],
    comments: [],
    ...over,
  })

  const sessionNode = (id: string, data: Record<string, unknown>, archived = false): LayoutNode => ({
    id,
    kind: 'session',
    x: 0,
    y: 0,
    w: 340,
    h: 220,
    hidden: false,
    locked: false,
    pinned: false,
    tags: [],
    data: { origin: 'worfy', ...data },
    ...(archived ? { archived: { at: NOW - HOUR, rule: 'idle' as const, batch: 'b1' } } : {}),
  })

  interface World {
    /** The row as the fresh read finds it; undefined — the PR is closed. */
    row?: PrInboxRow | undefined
    /** The row the snapshot held before the click; the fresh read replaces it. */
    before?: PrInboxRow
    template?: string
    nodes?: LayoutNode[]
    lastAt?: Record<string, number>
    stored?: ManualBinding[]
    tickets?: Ticket[]
    autopilot?: boolean
    busyOrchestrator?: { sessionId: string | null } | null
    /** What the Ticket's Session answers to send: `sent`, or `queued` while a turn runs. */
    turn?: boolean
    /** The Ticket's Session runs no process: started() resumes it first. */
    noProcess?: boolean
    /** started() rejects: the Ticket's Session did not start again. */
    startedFails?: boolean
    /** The new Session reports its session id only when the test says so (`report()`). */
    sdkLater?: boolean
  }

  const launchBinding = (sessionId: string, num = 7): ManualBinding => ({ sessionId, agentId: null, target: { kind: 'ticket', epic: 'shop', num }, source: 'launch' })

  async function withLauncher(world: World = {}) {
    const log: string[] = []
    const created: unknown[][] = []
    const launches: unknown[][] = []
    const notices: string[] = []
    let snapshotRow = 'before' in world ? world.before : rowOf({ headRefOid: OLD_HEAD })
    const fresh = 'row' in world ? world.row : rowOf()
    const ticketSession = (nodeId: string): FollowSession => ({
      id: `live-${nodeId}`,
      send: (text: string) => {
        log.push(`send ${nodeId}: ${text}`)
        return world.turn === true ? 'queued' : 'sent'
      },
      notice: (text: string) => {
        notices.push(text)
      },
    })
    // The live Session of the new Session Node: its id comes at once, or when the test calls report().
    const fresh_session = {
      send: (text: string) => (log.push(`send starting-node-new: ${text}`), 'sent' as const),
      sdkId: world.sdkLater === true ? null : 'sdk-new',
      state: 'idle',
    } as { send(text: string): 'sent'; sdkId: string | null; state: SessionState }
    const report = () => {
      fresh_session.sdkId = 'sdk-new'
    }
    /** The new Session ends before its id: Claude Code failed to start (`error`) or its Node closed (`closed`). */
    const end = (state: 'error' | 'closed') => {
      fresh_session.state = state
    }
    const deps: LaunchDeps = {
      projectRoot: (projectId) => {
        if (projectId !== 'p') throw new Error(`no Project ${projectId}`)
        return '/repo'
      },
      settings: () => ({ actionTemplates: { ...defaultActionTemplates('plugin'), ...(world.template === undefined ? {} : { fixChecks: world.template }) } }),
      branch: async () => 'main',
      workflow: async (root) => ({ root, epics: [], tickets: world.tickets ?? [ticket(7, 118), ticket(8, null)], error: null, branchErrors: [] }),
      sessions: {
        create: (projectId, near, vendor) => {
          created.push([projectId, near, vendor])
          return { projectId, nodeId: 'node-new', vendor, sessionId: 'starting-node-new', sdkSessionId: null, state: 'starting', error: null, cwd: '/repo', model: null, version: 1 }
        },
      },
      orchestrators: { open: async () => { throw new Error('the Orchestrator is not for pull request actions') } },
      registry: { get: () => fresh_session },
      bindings: { setLaunch: (projectId, agent, target) => launches.push([projectId, agent, target]) },
      now: () => NOW,
      pollMs: 1,
      // Long against the 1 ms poll, short against the test timeout: a lock held to the end of the wait reads as held.
      waitMs: 2_000,
      prFollow: {
        pull: async (projectId, repo, pr) => {
          log.push(`pull ${projectId} ${repo}#${pr}`)
          // PrInbox.refresh, then the row in the snapshot: the fresh read replaces what the last search held.
          snapshotRow = fresh
          return { row: snapshotRow, viewer: ME }
        },
        nodes: () => world.nodes ?? [sessionNode('node-7', { vendor: 'claude', sessionId: TICKET_SDK })],
        lastAt: async (_projectId, sessionIds) => {
          const times = world.lastAt ?? { [TICKET_SDK]: NOW - 23 * HOUR }
          return new Map(sessionIds.flatMap((id) => (times[id] === undefined ? [] : [[id, times[id]] as const])))
        },
        stored: () => world.stored ?? [launchBinding(TICKET_SDK)],
        busyOrchestrator: async () => world.busyOrchestrator ?? null,
        started: async (_projectId, nodeId) => {
          if (world.startedFails === true) {
            log.push(`not started ${nodeId}`)
            throw new Error(`The Session of ${nodeId} did not start`)
          }
          // NodeSessions.started: a Node with no process is resumed by its transcript before its live Session answers.
          if (world.noProcess === true) {
            await new Promise((done) => setTimeout(done, 5))
            log.push(`resumed ${nodeId}`)
          }
          log.push(`started ${nodeId}`)
          return ticketSession(nodeId)
        },
      },
    }
    const launcher = new ActionLauncher(deps)
    if (world.autopilot === true) launcher.attachAutopilot({ running: () => true })
    const handlers = new Map<string, Listener>()
    await registerIpc(
      { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
      { modules: { './actions.ts': async () => actionsHandlers(() => launcher) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) },
    )
    const listener = handlers.get(`${IPC_CHANNEL_PREFIX}actions.prFollow`)!
    const call = async (input: Record<string, unknown> = {}) =>
      (await listener({ senderFrame: { url: APP_URL }, sender: {} } as unknown as IpcMainInvokeEvent, { projectId: 'p', repo: REPO, pr: 118, action: 'fixChecks', ...input })) as IpcResult<unknown>
    const reason = (result: IpcResult<unknown>): string => (result.ok ? 'not refused' : failureReason('actions.prFollow', result.error))
    return { call, reason, log, created, launches, notices, launcher, report, end }
  }

  const TEXT = `/worfy:pr-fix checks ${REPO}#118 ${NEW_HEAD}`

  describe('the Session Node bound to the PR\'s Ticket, its transcript younger than 24 hours', () => {
    it('takes the text at once (`sent`), with a notice line, and no Session Node is created', async () => {
      const { call, log, created, notices } = await withLauncher()
      const result = await call()
      expect(result).toStrictEqual({ ok: true, value: { nodeId: 'node-7', sessionId: 'live-node-7', text: TEXT, delivery: 'sent' } })
      expect(log).toEqual([`pull p ${REPO}#118`, 'started node-7', `send node-7: ${TEXT}`])
      expect(notices).toEqual([`worfy: Fix checks for ${REPO}#118 sent to this Session`])
      expect(created).toEqual([])
    })

    it('takes it into its queue while a turn runs (`queued`)', async () => {
      const { call, notices } = await withLauncher({ turn: true })
      const result = await call()
      expect(result).toMatchObject({ ok: true, value: { nodeId: 'node-7', delivery: 'queued' } })
      expect(notices).toEqual([`worfy: Fix checks for ${REPO}#118 queued in this Session`])
    })

    it('without a process is continued by NodeSessions.started first, then gets the text', async () => {
      const { call, log, created } = await withLauncher({ noProcess: true })
      const result = await call()
      expect(result).toMatchObject({ ok: true, value: { nodeId: 'node-7', delivery: 'sent' } })
      expect(log).toEqual([`pull p ${REPO}#118`, 'resumed node-7', 'started node-7', `send node-7: ${TEXT}`])
      expect(created).toEqual([])
    })

    it('is found by a manual Binding too, and a manual Binding to another Ticket wins over a launch one', async () => {
      const manual: ManualBinding = { sessionId: TICKET_SDK, agentId: null, target: { kind: 'ticket', epic: 'shop', num: 7 } }
      expect(await (await withLauncher({ stored: [manual] })).call()).toMatchObject({ ok: true, value: { nodeId: 'node-7', delivery: 'sent' } })
      const elsewhere: ManualBinding = { sessionId: TICKET_SDK, agentId: null, target: { kind: 'ticket', epic: 'shop', num: 8 } }
      expect(await (await withLauncher({ stored: [elsewhere, launchBinding(TICKET_SDK)] })).call()).toMatchObject({ ok: true, value: { delivery: 'new' } })
    })

    it('of several, the one with the newest transcript record', async () => {
      const nodes = [sessionNode('node-a', { vendor: 'claude', sessionId: 'sdk-a' }), sessionNode('node-b', { sessionId: 'sdk-b' })]
      const { call } = await withLauncher({ nodes, stored: [launchBinding('sdk-a'), launchBinding('sdk-b')], lastAt: { 'sdk-a': NOW - 5 * HOUR, 'sdk-b': NOW - HOUR } })
      // A Node saved before Vendors were kept is Claude Code's.
      expect(await call()).toMatchObject({ ok: true, value: { nodeId: 'node-b' } })
    })
  })

  describe('a new Session Node on Claude Code, bound by launch to the PR\'s Ticket', () => {
    it.each([
      ['the Ticket\'s Session is older than 24 hours', { lastAt: { [TICKET_SDK]: NOW - 25 * HOUR } }],
      ['exactly 24 hours old', { lastAt: { [TICKET_SDK]: NOW - FOLLOW_SESSION_MS } }],
      ['its transcript tells no time', { lastAt: {} }],
      ['it runs on Codex', { nodes: [sessionNode('node-7', { vendor: 'codex', sessionId: TICKET_SDK })] }],
      ['it is archived', { nodes: [sessionNode('node-7', { vendor: 'claude', sessionId: TICKET_SDK }, true)] }],
      ['it has not reported its session yet', { nodes: [sessionNode('node-7', { vendor: 'claude' })] }],
      ['no Session is bound to the Ticket', { stored: [] }],
    ])('when %s', async (_what, world) => {
      const { call, log, created, launches, notices, launcher } = await withLauncher(world)
      const result = await call({ near: { x: 100, y: 40 } })
      expect(result).toStrictEqual({ ok: true, value: { nodeId: 'node-new', sessionId: 'starting-node-new', text: TEXT, delivery: 'new' } })
      expect(created).toStrictEqual([['p', { x: 100, y: 40 }, 'claude']])
      expect(log).toContain(`send starting-node-new: ${TEXT}`)
      expect(log.some((line) => line.startsWith('started'))).toBe(false)
      expect(notices).toEqual([])
      await launcher.idle()
      expect(launches).toStrictEqual([['p', { sessionId: 'sdk-new', agentId: null }, { kind: 'ticket', epic: 'shop', num: 7 }]])
    })

    it('unbound when no Ticket names the PR', async () => {
      const { call, launches, launcher } = await withLauncher({ tickets: [ticket(8, null)] })
      expect(await call()).toMatchObject({ ok: true, value: { delivery: 'new' } })
      await launcher.idle()
      expect(launches).toEqual([])
    })

    it('finds the Ticket by the PR\'s branch when its header has no PR line', async () => {
      const { call, launches, launcher } = await withLauncher({ tickets: [{ ...ticket(9, null), branch: 'fix/retry-429' }], stored: [] })
      expect(await call()).toMatchObject({ ok: true, value: { delivery: 'new' } })
      await launcher.idle()
      expect(launches).toStrictEqual([['p', { sessionId: 'sdk-new', agentId: null }, { kind: 'ticket', epic: 'shop', num: 9 }]])
    })
  })

  it('starts a new Session Node when the Ticket\'s Session does not start again, with no notice', async () => {
    const { call, log, created, launches, notices, launcher } = await withLauncher({ startedFails: true })
    const result = await call()
    expect(result).toStrictEqual({ ok: true, value: { nodeId: 'node-new', sessionId: 'starting-node-new', text: TEXT, delivery: 'new' } })
    expect(log).toEqual([`pull p ${REPO}#118`, 'not started node-7', `send starting-node-new: ${TEXT}`])
    expect(created).toStrictEqual([['p', undefined, 'claude']])
    expect(notices).toEqual([])
    await launcher.idle()
    expect(launches).toStrictEqual([['p', { sessionId: 'sdk-new', agentId: null }, { kind: 'ticket', epic: 'shop', num: 7 }]])
  })

  it('reads no Binding of a Subagent as the Binding of its Session', async () => {
    const subagent: ManualBinding = { sessionId: TICKET_SDK, agentId: 'a1', target: { kind: 'ticket', epic: 'shop', num: 8 } }
    const { call } = await withLauncher({ stored: [launchBinding(TICKET_SDK), subagent] })
    expect(await call()).toMatchObject({ ok: true, value: { nodeId: 'node-7', delivery: 'sent' } })
  })

  describe('two clicks on one PR', () => {
    const ALREADY = prFollowStartingHint('fixChecks', REPO, 118)

    it('at once: one Session Node, the second click refused', async () => {
      const { call, reason, created } = await withLauncher({ stored: [] })
      const [first, second] = await Promise.all([call(), call()])
      expect(first).toMatchObject({ ok: true, value: { delivery: 'new' } })
      expect(reason(second)).toBe(ALREADY)
      expect(created).toHaveLength(1)
    })

    it('while the new Session has not reported its id, so its Binding is not written: refused, another action too; once it is written, the next click passes the lock', async () => {
      const { call, reason, created, launches, launcher, report } = await withLauncher({ stored: [], sdkLater: true })
      expect(await call()).toMatchObject({ ok: true, value: { delivery: 'new' } })
      expect(reason(await call())).toBe(ALREADY)
      expect(reason(await call({ action: 'addressComments' }))).toBe(prFollowStartingHint('addressComments', REPO, 118))
      expect(created).toHaveLength(1)
      expect(launches).toEqual([])
      report()
      await launcher.idle()
      expect(launches).toStrictEqual([['p', { sessionId: 'sdk-new', agentId: null }, { kind: 'ticket', epic: 'shop', num: 7 }]])
      // The lock is off with the Binding written: the next click passes it.
      expect(await call()).toMatchObject({ ok: true })
    })

    it('of a PR no Ticket names: the lock holds until the new Session has reported its id', async () => {
      const { call, reason, created, report } = await withLauncher({ tickets: [], sdkLater: true })
      expect(await call()).toMatchObject({ ok: true, value: { delivery: 'new' } })
      expect(reason(await call())).toBe(ALREADY)
      report()
      await new Promise((done) => setTimeout(done, 20))
      expect(await call()).toMatchObject({ ok: true, value: { delivery: 'new' } })
      expect(created).toHaveLength(2)
    })

    it.each([
      ['error', 'of a Ticket'],
      ['closed', 'of a Ticket'],
      ['error', 'no Ticket names'],
      ['closed', 'no Ticket names'],
    ] as const)('a new Session that ends in %s before its id frees the lock (a PR %s): the next click starts a new one', async (state, whose) => {
      const { call, reason, created, launches, end } = await withLauncher(whose === 'of a Ticket' ? { stored: [], sdkLater: true } : { tickets: [], sdkLater: true })
      expect(await call()).toMatchObject({ ok: true, value: { delivery: 'new' } })
      expect(reason(await call())).toBe(ALREADY)
      end(state)
      // Well under waitMs: the lock is off because the Session ended, not because the wait ran out.
      await new Promise((done) => setTimeout(done, 30))
      expect(launches).toEqual([])
      expect(await call()).toMatchObject({ ok: true, value: { delivery: 'new' } })
      expect(created).toHaveLength(2)
    })

    it('says that closing the Node frees the lock', () => {
      expect(ALREADY).toBe(`Fix checks is already starting for ${REPO}#118: wait for its Session, or close its Node to start again`)
    })

    it('a click the Ticket\'s Session takes holds no lock: the next one goes to the same Session', async () => {
      const { call } = await withLauncher()
      expect(await call()).toMatchObject({ ok: true, value: { nodeId: 'node-7', delivery: 'sent' } })
      expect(await call()).toMatchObject({ ok: true, value: { nodeId: 'node-7', delivery: 'sent' } })
    })
  })

  it('fills {sha} with the head of the fresh read, not the head of the last snapshot', async () => {
    const { call, log } = await withLauncher({ before: rowOf({ headRefOid: OLD_HEAD }), row: rowOf({ headRefOid: NEW_HEAD }) })
    const result = await call()
    expect(result).toMatchObject({ ok: true, value: { text: TEXT } })
    expect(log.join('\n')).not.toContain(OLD_HEAD)
  })

  describe('refused with the reason, nothing sent and no Session created', () => {
    it.each<[string, World, string]>([
      ['while Autopilot runs in the Project', { autopilot: true }, PR_FOLLOW_AUTOPILOT_HINT],
      ['while the Orchestrator bound to the Epic of the PR\'s Ticket is busy', { busyOrchestrator: { sessionId: 'sdk-orch' }, stored: [launchBinding(TICKET_SDK), { sessionId: 'sdk-orch', agentId: null, target: { kind: 'epic', epic: 'shop' }, source: 'launch' }] }, prFollowWaveHint('shop')],
      ['for a PR from a fork', { row: rowOf({ isCrossRepository: true }) }, `${REPO}#118 comes from a fork: a Session cannot push to it`],
      ['for a PR that is not the user\'s', { row: rowOf({ author: 'dev-peer' }) }, `${REPO}#118 is not your pull request`],
      ['for a PR closed meanwhile', { row: undefined }, `${REPO}#118 is closed or no longer in the PR inbox`],
      ['when CI is no longer failing on the fresh head', { row: rowOf({ ci: 'passing' }) }, 'CI is no longer failing on 3f2a9c1'],
      ['for an empty template', { template: '' }, 'Set the Fix checks template in Project settings'],
    ])('%s', async (_what, world, expected) => {
      const { call, reason, log, created, notices } = await withLauncher(world)
      expect(reason(await call())).toBe(expected)
      expect(log.filter((line) => line.startsWith('send') || line.startsWith('started'))).toEqual([])
      expect(created).toEqual([])
      expect(notices).toEqual([])
    })

    it('but not while the busy Orchestrator is bound to another Epic, or the Orchestrator is idle', async () => {
      const other: ManualBinding = { sessionId: 'sdk-orch', agentId: null, target: { kind: 'epic', epic: 'other' }, source: 'launch' }
      expect(await (await withLauncher({ busyOrchestrator: { sessionId: 'sdk-orch' }, stored: [launchBinding(TICKET_SDK), other] })).call()).toMatchObject({ ok: true, value: { delivery: 'sent' } })
      expect(await (await withLauncher({ busyOrchestrator: null })).call()).toMatchObject({ ok: true, value: { delivery: 'sent' } })
    })
  })

  describe('from a Linked machine', () => {
    const peers: LinkPeer[] = []
    afterEach(() => {
      for (const peer of peers.splice(0)) peer.close()
    })

    async function linked(level: AccessLevel) {
      const calls: unknown[][] = []
      const launcher = {
        shipTicket: async () => { throw new Error('not here') },
        runWave: async () => { throw new Error('not here') },
        gateQueue: async () => { throw new Error('not here') },
        launched: () => { throw new Error('not here') },
        prReply: () => { throw new Error('not here') },
        prFollow: async (...args: [string, string, number, string]) => {
          calls.push(args)
          return { nodeId: 'n3', sessionId: 'live-3', text: TEXT, delivery: 'new' as const }
        },
      }
      const adapter = await createLinkIpc({ modules: { './actions.ts': async () => actionsHandlers(() => launcher) }, isLinked: () => true })
      const peer = new LinkPeer({ machineId: 'mac', describe: () => 'mac', push: () => undefined, local: () => ({ id: 'here', name: 'Studio', protocol: 1, build: 'test' }), warn: () => undefined })
      peer.setAccess(level)
      peers.push(peer)
      return { calls, call: (input: unknown) => adapter.call(peer, 'actions.prFollow', input, 'Studio') }
    }

    it('with read-only access is refused before the launcher runs', async () => {
      const { call, calls } = await linked('read')
      const result = await call({ projectId: 'p', repo: REPO, pr: 118, action: 'fixChecks' })
      expect(result.ok).toBe(false)
      expect(!result.ok && result.error).toContain(readOnlyRefusal('Studio'))
      expect(calls).toEqual([])
    })

    it('with full access runs it, as a window of this machine does', async () => {
      const { call, calls } = await linked('all')
      const result = await call({ projectId: 'p', repo: REPO, pr: 118, action: 'fixChecks' })
      expect(result).toStrictEqual({ ok: true, value: { nodeId: 'n3', sessionId: 'live-3', text: TEXT, delivery: 'new' } })
      expect(calls).toStrictEqual([['p', REPO, 118, 'fixChecks']])
    })
  })

  describe('the fresh read of the app (prInboxPull)', () => {
    const snapshotWith = (rows: PrInboxRow[], viewer: string | null = ME): PrInboxSnapshot => ({
      projectId: 'p',
      enabled: true,
      viewer,
      groups: [{ group: 'needs-fix', rows }],
      readAt: null,
      nextSearchAt: null,
      error: null,
      notice: null,
    })

    function inboxOf(before: PrInboxRow[], after: PrInboxRow[]) {
      const calls: string[] = []
      let rows = before
      const inbox = {
        ensureRead: async (projectId: string) => {
          calls.push(`ensureRead ${projectId}`)
        },
        refresh: async (repo: string, pr: number) => {
          calls.push(`refresh ${repo}#${pr}`)
          rows = after
        },
        snapshot: (projectId: string) => {
          calls.push(`snapshot ${projectId}`)
          return snapshotWith(rows)
        },
      }
      return { calls, pull: prInboxPull(inbox) }
    }

    it('reads the PR again before it takes its row, so the head is the fresh one', async () => {
      const { calls, pull } = inboxOf([rowOf({ headRefOid: OLD_HEAD })], [rowOf({ headRefOid: NEW_HEAD })])
      const { row, viewer } = await pull('p', REPO, 118)
      expect(calls).toEqual(['ensureRead p', `refresh ${REPO}#118`, 'snapshot p'])
      expect(row?.headRefOid).toBe(NEW_HEAD)
      expect(viewer).toBe(ME)
    })

    it('finds the row by repository, in any case, and number: a PR of another repository with the same number is not it', async () => {
      const other = rowOf({ repo: 'example-org/api', author: 'dev-peer', isCrossRepository: true })
      const { pull } = inboxOf([], [other, rowOf()])
      expect((await pull('p', REPO.toUpperCase(), 118)).row).toMatchObject({ repo: REPO, number: 118, author: ME, isCrossRepository: false })
      expect((await pull('p', REPO, 119)).row).toBeUndefined()
      const { pull: onlyOther } = inboxOf([], [other])
      expect((await onlyOther('p', REPO, 118)).row).toBeUndefined()
    })
  })
})

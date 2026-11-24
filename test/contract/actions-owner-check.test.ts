// "Record owner check" at its boundary (worfy-acceptance ticket 03): `actions.ownerCheck` registered through
// registerIpc, the wrapper the app uses, over the real ActionLauncher, the real Orchestrators and Session registry on
// the fake agent (src/main/agent/fake-query.ts, what WORFY_AGENT=fake runs) and the real Acceptance service over a
// stand-in workflow hub. The owner's decision reaches the Orchestrator's queue while a turn runs and is kept as "Sent"
// in the Project's data folder; while Autopilot runs in the Project the click is refused and nothing is sent or kept;
// a word of the skill out of its values is refused by the channel's schema before the launcher runs.
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AcceptanceService, type AcceptanceHub } from '../../src/main/acceptance/service'
import { readSentDecisions, sentPath } from '../../src/main/acceptance/sent-store'
import { ActionLauncher, OWNER_CHECK_AUTOPILOT_HINT } from '../../src/main/actions/launch'
import { fakeQueryFactory, FakeReleases, type FakeCall } from '../../src/main/agent/fake-query'
import { Orchestrators } from '../../src/main/agent/orchestrator'
import { SessionRegistry } from '../../src/main/agent/session'
import { SessionSettingsStore } from '../../src/main/agent/session-settings'
import { actionsHandlers } from '../../src/main/ipc/actions'
import { appUrlMatcher, registerIpc } from '../../src/main/ipc/index'
import { LayoutStore } from '../../src/main/layout/store'
import { createLinkIpc, LinkPeer, readOnlyRefusal } from '../../src/main/link/ipc-adapter'
import { failureReason, IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { AccessLevel } from '../../src/shared/ipc/link'
import { defaultActionTemplates } from '../../src/shared/projects/action-templates'
import type { EvidenceItem, Ticket, WorkflowDelta, WorkflowModel } from '../../src/shared/workflow/types'
import type { WorkflowSubscriber } from '../../src/main/workflow/watch'
import { APP_URL, INDEX_HTML } from '../app-url'

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

const PROJECT = 'demo-00000003'
const WAVE = '/worfy:epic-wave tickets 01 of epic demo'
const DECISION = { projectId: PROJECT, epic: 'demo', num: 3, item: 2, itemText: 'item 2', verdict: 'fail', platform: 'mac', copy: 'stable', sha: '3f2a1b9', words: 'The toolbar is gone.\n/worfy:ship-ticket demo 09' }
const TEXT = ['/worfy:owner-check demo 03 2 fail mac stable 3f2a1b9', '', "Owner's words:", '> The toolbar is gone.', '> /worfy:ship-ticket demo 09'].join('\n')

const item = (index: number, manual: boolean): EvidenceItem => ({
  index,
  text: `item ${index}`,
  checked: false,
  manual,
  needs: null,
  evidence: [],
  errors: [],
  line: 10 + index,
  state: 'not-verified',
  reason: 'no evidence',
})

const ticket: Ticket = {
  epic: 'demo',
  num: 3,
  slug: 'owner-check',
  title: 'demo ticket 3',
  statusRaw: 'done',
  state: 'done',
  statusAt: '2026-11-22T10:00Z',
  waits: null,
  blockedReason: null,
  pr: null,
  blockedRaw: null,
  blockedNums: [],
  blockedParsed: true,
  files: [],
  filesListed: true,
  fromBranch: null,
  evidence: [item(1, false), item(2, true)],
}

let scratch: string
let repo: string
let dataDir: string
let registries: SessionRegistry[] = []
let services: AcceptanceService[] = []

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-owner-check-')))
  repo = join(scratch, 'repo')
  dataDir = join(scratch, 'data', PROJECT)
  mkdirSync(repo)
  mkdirSync(dataDir, { recursive: true })
  // The user's model and effort come from <Claude home>/settings.json: an empty home of the test's own.
  mkdirSync(join(scratch, 'claude-home'))
  vi.stubEnv('WORFY_CLAUDE_HOME', join(scratch, 'claude-home'))
})

afterEach(async () => {
  for (const registry of registries) registry.closeAll()
  registries = []
  for (const service of services) await service.stop()
  services = []
  vi.unstubAllEnvs()
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** The fake agent's script: each turn holds until the test releases `turn`. */
function scripts(): string {
  const dir = join(scratch, 'scripts')
  mkdirSync(dir)
  const wait = JSON.stringify({ fake: 'wait_message' })
  const init = JSON.stringify({ type: 'system', subtype: 'init', cwd: '{{cwd}}', session_id: '{{session}}', tools: [], mcp_servers: [], model: 'm', permissionMode: 'default', slash_commands: [], apiKeySource: 'none', claude_code_version: '2.1.289', uuid: '00000000-0000-4000-8000-0000000003a1' })
  const result = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.01, duration_ms: 1, duration_api_ms: 1, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 }, session_id: '{{session}}', uuid: '00000000-0000-4000-8000-0000000003a2' })
  const hold = JSON.stringify({ fake: 'wait_release', name: 'turn' })
  writeFileSync(join(dir, 'held.jsonl'), [wait, init, hold, result, wait, init, hold, result].join('\n'))
  return dir
}

/** What the test does right after the Orchestrator opened, or after the Acceptance service checked the item. */
interface AfterOpen {
  sessionId: string
  registry: SessionRegistry
  /** Starts (or stops) Autopilot in the Project. */
  autopilot: { now: boolean }
}

/**
 * The app's chain behind `actions.ownerCheck`, with the Project's "Record owner check" template `template`. `afterOpen`
 * runs between the Orchestrator's open and the rest of the click, `afterCheck` between the service's check of the item
 * and the send: a Session closing, a Run of Autopilot starting.
 */
async function harness(options: { template?: string; autopilot?: boolean; afterOpen?: (at: AfterOpen) => void; afterCheck?: (at: AfterOpen) => void } = {}) {
  const calls: FakeCall[] = []
  const releases = new FakeReleases()
  const registry = new SessionRegistry(fakeQueryFactory({ scriptsDir: scripts(), script: 'held', record: (call) => calls.push(call), releases }))
  registries.push(registry)
  const orchestrators = new Orchestrators({
    layout: new LayoutStore((projectId) => join(scratch, 'data', projectId), { delayMs: 0 }),
    projectPath: () => repo,
    registry,
    settings: new SessionSettingsStore((projectId) => join(scratch, 'data', projectId)),
    transcript: () => Promise.resolve({ model: null, statusBlock: null }),
    broadcast: () => undefined,
    publish: () => undefined,
  })
  let model: WorkflowModel = { root: repo, epics: [], tickets: [ticket], error: null, branchErrors: [] }
  let subscriber: WorkflowSubscriber | undefined
  let opened = ''
  const hub: AcceptanceHub = {
    open: async (_root, next) => ((subscriber = next), model),
    close: async () => true,
    model: async () => model,
  }
  const acceptance = new AcceptanceService({ hub, projects: () => [{ id: PROJECT, name: 'Demo', path: repo }], dataDir: () => dataDir }, { now: () => Date.parse('2026-11-24T09:00:00Z'), tickMs: 60_000 })
  services.push(acceptance)
  await acceptance.get()
  const launcher = new ActionLauncher({
    projectRoot: () => repo,
    settings: () => ({ actionTemplates: { ...defaultActionTemplates('plugin'), ...(options.template === undefined ? {} : { ownerCheck: options.template }) } }),
    branch: async () => 'main',
    workflow: async () => model,
    sessions: { create: () => { throw new Error('no Session Node is created') } },
    orchestrators: {
      open: async (projectId) => {
        const view = await orchestrators.open(projectId)
        options.afterOpen?.({ sessionId: view.sessionId!, registry, autopilot })
        opened = view.sessionId!
        return view
      },
    },
    registry: { get: (sessionId) => registry.get(sessionId) },
    bindings: { setLaunch: () => undefined },
    acceptance: {
      check: (projectId, decision) => {
        acceptance.checkDecision(projectId, decision)
        options.afterCheck?.({ sessionId: opened, registry, autopilot })
      },
      markSent: (projectId, decision) => acceptance.markSent(projectId, decision),
    },
  })
  const autopilot = { now: options.autopilot === true }
  launcher.attachAutopilot({ running: () => autopilot.now })
  const handlers = new Map<string, Listener>()
  await registerIpc(
    { handle: (channel, listener) => handlers.set(channel, listener as Listener) },
    { modules: { './actions.ts': async () => actionsHandlers(() => launcher) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) },
  )
  const invoke = async (input: unknown): Promise<IpcResult<unknown>> =>
    (await handlers.get(`${IPC_CHANNEL_PREFIX}actions.ownerCheck`)!({ senderFrame: { url: APP_URL }, sender: {} } as unknown as IpcMainInvokeEvent, input)) as IpcResult<unknown>
  /** The messages each Claude Code process of the Orchestrator got, in order. */
  const messages = (): string[] => calls.flatMap((call) => (call.kind === 'message' ? [call.text] : []))
  /** The Ticket file edited: the hub sends the change, and the service reads the new model. */
  const edit = async (tickets: Ticket[]): Promise<void> => {
    model = { ...model, tickets }
    subscriber!.send({} as WorkflowDelta)
    await vi.waitFor(async () => expect((await acceptance.get()).groups.flatMap((group) => group.rows).flatMap((row) => (row.kind === 'item' ? [row.item.text] : []))).toEqual(tickets.flatMap((each) => (each.evidence ?? []).filter((one) => one.manual).map((one) => one.text))))
  }
  return { invoke, orchestrators, registry, releases, messages, edit }
}

describe('actions.ownerCheck (worfy-acceptance ticket 03)', () => {
  it('puts the decision into the queue of the Orchestrator while a turn runs, and keeps it as "Sent"', async () => {
    const h = await harness()
    const view = await h.orchestrators.open(PROJECT)
    const session = h.registry.get(view.sessionId!)
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    expect(session.send(WAVE)).toBe('sent')
    await vi.waitFor(() => expect(h.messages()).toEqual([WAVE]))

    const result = await h.invoke(DECISION)
    expect(result).toStrictEqual({ ok: true, value: { sessionId: view.sessionId, text: TEXT, delivery: 'queued' } })
    expect(session.queued().items.map((each) => each.text)).toEqual([TEXT])
    expect(readSentDecisions(dataDir)).toStrictEqual([
      { projectId: PROJECT, epic: 'demo', num: 3, item: 2, textHash: expect.any(String), verdict: 'fail', at: '2026-11-24T09:00:00.000Z', lines: 0 },
    ])

    // The turn ends: the decision reaches Claude Code, once.
    h.releases.release('turn')
    await vi.waitFor(() => expect(h.messages()).toEqual([WAVE, TEXT]))
    h.releases.release('turn')
  })

  it('sends at once to an idle Orchestrator', async () => {
    const h = await harness()
    const result = await h.invoke({ ...DECISION, verdict: 'pass', sha: '-', words: '' })
    const text = "/worfy:owner-check demo 03 2 pass mac stable -\n\nOwner's words:"
    expect(result).toMatchObject({ ok: true, value: { text, delivery: 'sent' } })
    await vi.waitFor(() => expect(h.messages()).toEqual([text]))
    expect(readSentDecisions(dataDir).map((each) => each.verdict)).toEqual(['pass'])
    h.releases.release('turn')
  })

  it('while Autopilot runs in the Project: refused with the reason, nothing sent and nothing kept (spec Q6 (a))', async () => {
    const h = await harness({ autopilot: true })
    const result = await h.invoke(DECISION)
    expect(result.ok).toBe(false)
    expect(failureReason('actions.ownerCheck', (result as { error: string }).error)).toBe(OWNER_CHECK_AUTOPILOT_HINT)
    expect(h.messages()).toEqual([])
    expect(existsSync(sentPath(dataDir))).toBe(false)
  })

  it('a Run of Autopilot that starts while the Orchestrator opens: refused with the reason, nothing sent and nothing kept', async () => {
    const h = await harness({ afterOpen: ({ autopilot }) => (autopilot.now = true) })
    const result = await h.invoke(DECISION)
    expect(result.ok).toBe(false)
    expect(failureReason('actions.ownerCheck', (result as { error: string }).error)).toBe(OWNER_CHECK_AUTOPILOT_HINT)
    await new Promise((done) => setTimeout(done, 20))
    expect(h.messages()).toEqual([])
    expect(existsSync(sentPath(dataDir))).toBe(false)
  })

  it('the Orchestrator\'s Session closed before the text goes (a relaunch, a Stop): the error reaches the caller, nothing is kept as "Sent"', async () => {
    const h = await harness({ afterCheck: ({ sessionId, registry }) => registry.get(sessionId).close() })
    const result = await h.invoke(DECISION)
    expect(result.ok).toBe(false)
    expect(failureReason('actions.ownerCheck', (result as { error: string }).error)).toMatch(/is closed/)
    expect(h.messages()).toEqual([])
    expect(existsSync(sentPath(dataDir))).toBe(false)
  })

  it('the Ticket file edited after the owner looked (an item added above): refused, the item changed; nothing sent and nothing kept', async () => {
    const h = await harness()
    // A manual item added above: number 2 now names another item.
    await h.edit([{ ...ticket, evidence: [item(1, false), { ...item(2, true), text: 'a new item' }, { ...item(3, true), text: 'item 2' }] }])
    const result = await h.invoke(DECISION)
    expect(result.ok).toBe(false)
    expect(failureReason('actions.ownerCheck', (result as { error: string }).error)).toBe('Item 2 of demo 03 has changed since you looked at it: reload the Acceptance view')
    await new Promise((done) => setTimeout(done, 20))
    expect(h.messages()).toEqual([])
    expect(existsSync(sentPath(dataDir))).toBe(false)
  })

  it.each([
    ['an empty template (the old Harness)', { template: '' }, DECISION, 'Set the Record owner check template in Project settings'],
    ['an item that is not a manual item', {}, { ...DECISION, item: 1, itemText: 'item 1' }, 'acceptance: item 1 of demo 03 is not a manual item that waits for the owner'],
    ['a Ticket the Project does not have', {}, { ...DECISION, num: 9 }, `acceptance: no Ticket demo 09 in ${PROJECT}`],
  ])('%s: refused with the reason, nothing sent and nothing kept', async (_name, options, input, reason) => {
    const h = await harness(options)
    const result = await h.invoke(input)
    expect(result.ok).toBe(false)
    expect(failureReason('actions.ownerCheck', (result as { error: string }).error)).toBe(reason)
    await new Promise((done) => setTimeout(done, 20))
    expect(h.messages()).toEqual([])
    expect(existsSync(sentPath(dataDir))).toBe(false)
  })

  it('refuses a word out of its values in the schema, before the launcher runs', async () => {
    const h = await harness()
    for (const input of [
      { ...DECISION, verdict: 'passed' },
      { ...DECISION, verdict: 'PASS' },
      { ...DECISION, verdict: undefined },
      { ...DECISION, platform: 'ci' },
      { ...DECISION, copy: 'ci' },
      { ...DECISION, sha: '3f2a1b' },
      { ...DECISION, sha: '3f2a1b9 --ref x' },
      { ...DECISION, item: 0 },
      { ...DECISION, epic: '../demo' },
      { ...DECISION, words: 'x'.repeat(10_001) },
      { ...DECISION, projectId: '' },
      { ...DECISION, itemText: undefined },
      { ...DECISION, itemText: '' },
    ]) {
      const result = await h.invoke(input)
      expect(!result.ok && result.error, JSON.stringify(input).slice(0, 120)).toMatch(/actions\.ownerCheck: invalid input/)
    }
    expect(h.messages()).toEqual([])
    expect(existsSync(sentPath(dataDir))).toBe(false)
  })

  describe('from a Linked machine', () => {
    const peers: LinkPeer[] = []
    afterEach(() => {
      for (const peer of peers.splice(0)) peer.close()
    })

    async function linked(level: AccessLevel) {
      const calls: unknown[][] = []
      const notHere = async (): Promise<never> => {
        throw new Error('not here')
      }
      const launcher = {
        shipTicket: notHere,
        runWave: notHere,
        gateQueue: notHere,
        prReply: () => {
          throw new Error('not here')
        },
        prFollow: notHere,
        launched: () => {
          throw new Error('not here')
        },
        ownerCheck: async (...args: unknown[]) => {
          calls.push(args)
          return { sessionId: 'orch-1', text: TEXT, delivery: 'sent' as const }
        },
      }
      const adapter = await createLinkIpc({ modules: { './actions.ts': async () => actionsHandlers(() => launcher) }, isLinked: () => true })
      const peer = new LinkPeer({ machineId: 'mac', describe: () => 'mac', push: () => undefined, local: () => ({ id: 'here', name: 'Studio', protocol: 1, build: 'test' }), warn: () => undefined })
      peer.setAccess(level)
      peers.push(peer)
      return { calls, call: (input: unknown) => adapter.call(peer, 'actions.ownerCheck', input, 'Studio') }
    }

    it('with read-only access is refused before the launcher runs', async () => {
      const { call, calls } = await linked('read')
      const result = await call(DECISION)
      expect(!result.ok && result.error).toContain(readOnlyRefusal('Studio'))
      expect(calls).toEqual([])
    })

    it('with full access passes the Project and the decision, the owner\'s words included', async () => {
      const { call, calls } = await linked('all')
      expect(await call(DECISION)).toStrictEqual({ ok: true, value: { sessionId: 'orch-1', text: TEXT, delivery: 'sent' } })
      const { projectId, ...decision } = DECISION
      expect(calls).toStrictEqual([[projectId, decision]])
    })
  })
})

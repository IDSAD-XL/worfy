// Acceptance on a Linked machine (worfy-acceptance ticket 07): two Machines on the link bench (test/contract/link-bench.ts,
// 127.0.0.1 only). B keeps a Project whose Ticket has a manual item `needs: windows stable`; its queue comes from the
// real Acceptance service over a stand-in workflow hub, and its decisions go through the real ActionLauncher to the
// Project's Orchestrator on the fake agent (src/main/agent/fake-query.ts). A calls B's channels through RemoteCalls, as
// a window of A on B does (src/main/link/remote-calls.ts).
// - Read only: A gets B's queue and B refuses `actions.ownerCheck`; nothing reaches B's Orchestrator.
// - Full access: the decision A sends lands in the queue of the Orchestrator on B while its turn runs.
// - `needs: windows`: the build of B, the PC, comes to A from B's `hello` (its build and platform), and the item's line
//   says so; once B is gone, "PC not connected".
// - A worfy on B without the Acceptance view: the view says to update worfy there.
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AcceptanceService, type AcceptanceHub } from '../../src/main/acceptance/service'
import { ActionLauncher } from '../../src/main/actions/launch'
import { fakeQueryFactory, FakeReleases, type FakeCall } from '../../src/main/agent/fake-query'
import { Orchestrators } from '../../src/main/agent/orchestrator'
import { SessionRegistry } from '../../src/main/agent/session'
import { SessionSettingsStore } from '../../src/main/agent/session-settings'
import { acceptanceHandlers } from '../../src/main/ipc/acceptance'
import { actionsHandlers } from '../../src/main/ipc/actions'
import type { ModuleLoader } from '../../src/main/ipc/index'
import { LayoutStore } from '../../src/main/layout/store'
import { readOnlyRefusal } from '../../src/main/link/ipc-adapter'
import { helloMessage } from '../../src/main/link/messages'
import { RemoteCalls } from '../../src/main/link/remote-calls'
import type { LinkService } from '../../src/main/link/service'
import { linkedBuildLine, linkedCommit, olderWorfyText } from '../../src/shared/acceptance/linked-build'
import type { AcceptanceState } from '../../src/shared/ipc/acceptance'
import type { AccessLevel } from '../../src/shared/ipc/link'
import { defaultActionTemplates } from '../../src/shared/projects/action-templates'
import type { EvidenceItem, Ticket, WorkflowModel } from '../../src/shared/workflow/types'
import { ms } from '../time-scale'
import { LinkBench, type BenchMachine } from './link-bench'

const PROJECT = 'shop-00000007'
const PC_BUILD = '0.4.2101+3f2a1b9c'
const ITEM_TEXT = '(manual) Open the Acceptance tab on the PC → the queue shows'
const DECISION = { projectId: PROJECT, epic: 'shop', num: 7, item: 2, itemText: ITEM_TEXT, verdict: 'pass', platform: 'windows', copy: 'stable', sha: '3f2a1b9c', words: 'Looks right' }
const TEXT = ['/worfy:owner-check shop 07 2 pass windows stable 3f2a1b9c', '', "Owner's words:", '> Looks right'].join('\n')
const WAVE = '/worfy:epic-wave tickets 01 of epic shop'

const item = (index: number, manual: boolean, text: string): EvidenceItem => ({
  index,
  text,
  checked: false,
  manual,
  needs: manual ? { platform: 'windows', copy: 'stable' } : null,
  evidence: [],
  errors: [],
  line: 10 + index,
  state: 'not-verified',
  reason: 'no evidence',
})

const ticket: Ticket = {
  epic: 'shop',
  num: 7,
  slug: 'pc',
  title: '07 — The queue on the PC',
  statusRaw: 'done',
  state: 'done',
  statusAt: '2026-11-23T10:00Z',
  waits: null,
  blockedReason: null,
  pr: null,
  blockedRaw: null,
  blockedNums: [],
  blockedParsed: true,
  files: [],
  filesListed: true,
  fromBranch: null,
  evidence: [item(1, false, 'Contract test'), item(2, true, ITEM_TEXT)],
}

let scratch: string
let bench: LinkBench | undefined
const registries: SessionRegistry[] = []
const services: AcceptanceService[] = []

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-acceptance-linked-')))
  mkdirSync(join(scratch, 'repo'))
  mkdirSync(join(scratch, 'claude-home'))
  vi.stubEnv('WORFY_CLAUDE_HOME', join(scratch, 'claude-home'))
})

afterEach(async () => {
  expect(bench?.leakedSecrets() ?? []).toEqual([])
  await bench?.close()
  bench = undefined
  for (const registry of registries.splice(0)) registry.closeAll()
  for (const service of services.splice(0)) await service.stop()
  vi.unstubAllEnvs()
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** The fake agent's script: each turn holds until the test releases `turn`. */
function scripts(): string {
  const dir = join(scratch, 'scripts')
  mkdirSync(dir)
  const wait = JSON.stringify({ fake: 'wait_message' })
  const init = JSON.stringify({ type: 'system', subtype: 'init', cwd: '{{cwd}}', session_id: '{{session}}', tools: [], mcp_servers: [], model: 'm', permissionMode: 'default', slash_commands: [], apiKeySource: 'none', claude_code_version: '2.1.289', uuid: '00000000-0000-4000-8000-0000000007a1' })
  const result = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.01, duration_ms: 1, duration_api_ms: 1, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 }, session_id: '{{session}}', uuid: '00000000-0000-4000-8000-0000000007a2' })
  const hold = JSON.stringify({ fake: 'wait_release', name: 'turn' })
  writeFileSync(join(dir, 'held.jsonl'), [wait, init, hold, result, wait, init, hold, result].join('\n'))
  return dir
}

/** B's side: the Acceptance service over its one Project, and the launcher to that Project's Orchestrator. */
async function machineB() {
  const repo = join(scratch, 'repo')
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
  const model: WorkflowModel = { root: repo, epics: [], tickets: [ticket], error: null, branchErrors: [] }
  const hub: AcceptanceHub = { open: async () => model, close: async () => true, model: async () => model }
  const dataDir = join(scratch, 'data', PROJECT)
  mkdirSync(dataDir, { recursive: true })
  const acceptance = new AcceptanceService({ hub, projects: () => [{ id: PROJECT, name: 'Shop', path: repo }], dataDir: () => dataDir }, { now: () => Date.parse('2026-11-24T09:00:00Z'), tickMs: 60_000 })
  services.push(acceptance)
  const launcher = new ActionLauncher({
    projectRoot: () => repo,
    settings: () => ({ actionTemplates: defaultActionTemplates('plugin') }),
    branch: async () => 'main',
    workflow: async () => model,
    sessions: { create: () => { throw new Error('no Session Node is created') } },
    orchestrators: { open: (projectId) => orchestrators.open(projectId) },
    registry: { get: (sessionId) => registry.get(sessionId) },
    bindings: { setLaunch: () => undefined },
    acceptance: { check: (projectId, decision) => acceptance.checkDecision(projectId, decision), markSent: (projectId, decision) => acceptance.markSent(projectId, decision) },
  })
  launcher.attachAutopilot({ running: () => false })
  const modules: Record<string, ModuleLoader> = {
    './link.ts': () => import('../../src/main/ipc/link').then((module) => module.default),
    './acceptance.ts': async () => acceptanceHandlers(() => acceptance, () => new Set()),
    './actions.ts': async () => actionsHandlers(() => launcher),
  }
  /** The messages each Claude Code process of the Orchestrator got, in order. */
  const messages = (): string[] => calls.flatMap((call) => (call.kind === 'message' ? [call.text] : []))
  return { modules, orchestrators, registry, releases, messages }
}

/** Resolves once `calls` says what `check` waits for. */
async function until(calls: RemoteCalls, check: () => boolean): Promise<void> {
  if (check()) return
  await new Promise<void>((resolve) => {
    const listener = (): void => {
      if (!check()) return
      calls.off('changed', listener)
      resolve()
    }
    calls.on('changed', listener)
  })
}

/** A and B linked, B (the PC) giving A `level`, A connected to B; `bModules` replace B's handler modules. */
async function linkedPair(level: AccessLevel, bModules?: Record<string, ModuleLoader>) {
  const b = await machineB()
  bench = new LinkBench({ ipcModules: bModules ?? b.modules })
  const alpha: BenchMachine = await bench.machine('alpha', { platform: 'mac' })
  const beta: BenchMachine = await bench.machine('beta', { platform: 'windows', buildVersion: PC_BUILD })
  await bench.link(alpha, beta)
  const aId = alpha.service.machine.id
  const bId = beta.service.machine.id
  beta.service.settings.set({ projectsAccess: true, machines: { [aId]: level } })
  const calls = new RemoteCalls(alpha.service)
  // B's own RemoteCalls tells A, in its `projects-access` message, how far B shares its Projects with it.
  new RemoteCalls(beta.service)
  await alpha.service.connect(bId)
  await until(calls, () => calls.machines().find((machine) => machine.id === bId)?.sharing === 'yes')
  return { ...b, alpha, beta, calls, bId }
}

const rowsOf = (state: AcceptanceState) => state.groups.flatMap(({ group, rows }) => rows.map((row) => ({ group, ref: `${row.ticket.epic} ${row.ticket.num}`, item: row.kind === 'item' ? row.item.index : null })))

describe('Acceptance on a Linked machine (worfy-acceptance ticket 07)', () => {
  it("Read only: the window of A on B gets B's queue, and B refuses Pass and Fail; nothing reaches B's Orchestrator", async () => {
    const pair = await linkedPair('read')
    const queue = await pair.calls.call(pair.bId, 'acceptance.get', undefined)
    expect(queue.ok).toBe(true)
    expect(rowsOf((queue as { value: AcceptanceState }).value)).toEqual([{ group: 'ready', ref: 'shop 7', item: 2 }])

    const refused = await pair.calls.call(pair.bId, 'actions.ownerCheck', DECISION)
    expect(refused).toEqual({ ok: false, error: readOnlyRefusal('beta') })
    await new Promise((done) => setTimeout(done, 20))
    expect(pair.messages()).toEqual([])
  })

  it("Full access: the decision goes to the Orchestrator of the Project on B, into its queue while a turn runs", async () => {
    const pair = await linkedPair('all')
    const view = await pair.orchestrators.open(PROJECT)
    const session = pair.registry.get(view.sessionId!)
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    expect(session.send(WAVE)).toBe('sent')
    await vi.waitFor(() => expect(pair.messages()).toEqual([WAVE]))
    // The window on B reads the queue first, as the view does before Pass is there to click.
    expect((await pair.calls.call(pair.bId, 'acceptance.get', undefined)).ok).toBe(true)

    const sent = await pair.calls.call(pair.bId, 'actions.ownerCheck', DECISION)
    expect(sent).toStrictEqual({ ok: true, value: { sessionId: view.sessionId, text: TEXT, delivery: 'queued' } })
    expect(session.queued().items.map((each) => each.text)).toEqual([TEXT])
    // B's queue marks the item Sent, and A sees the mark.
    const queue = (await pair.calls.call(pair.bId, 'acceptance.get', undefined)) as { ok: true; value: AcceptanceState }
    const row = queue.value.groups.flatMap((group) => group.rows).find((each) => each.kind === 'item')
    expect(row?.kind === 'item' ? row.sent?.verdict : null).toBe('pass')
    pair.releases.release('turn')
    await vi.waitFor(() => expect(pair.messages()).toEqual([WAVE, TEXT]))
    pair.releases.release('turn')
  })

  it("`needs: windows` on the Mac: the PC's build comes from its `hello`, and the decision names its commit; the PC gone — \"PC not connected\"", async () => {
    const pair = await linkedPair('read')
    const machines = () => pair.calls.machines().map((machine) => ({ ...machine, name: machine.id === pair.bId ? 'beta' : 'other' }))
    expect(pair.calls.machines().find((machine) => machine.id === pair.bId)).toMatchObject({ online: true, build: PC_BUILD, platform: 'windows' })
    // The Mac's own window (no window Machine): the line of the item names the PC and its build.
    expect(linkedBuildLine('windows', 'mac', null, machines())).toEqual({ state: 'online', text: `PC build: ${PC_BUILD} (beta)`, machineId: pair.bId })
    // Pass with the platform windows names the commit of that build.
    expect(linkedCommit('windows', 'mac', null, machines())).toEqual({ sha: '3f2a1b9c', build: PC_BUILD })
    // A window of the Mac on the PC: the platform of the decision is the PC's, and so is the commit.
    expect(linkedCommit('windows', 'mac', pair.bId, machines())).toEqual({ sha: '3f2a1b9c', build: PC_BUILD })

    await pair.beta.service.stop()
    await until(pair.calls, () => pair.calls.machines().find((machine) => machine.id === pair.bId)?.online === false)
    expect(pair.calls.machines().find((machine) => machine.id === pair.bId)?.build).toBeUndefined()
    expect(linkedBuildLine('windows', 'mac', null, machines())).toEqual({ state: 'not-connected', text: 'PC not connected', machineId: null })
    expect(linkedCommit('windows', 'mac', null, machines())).toBeNull()
  })

  it('an older worfy on the PC, without the Acceptance view: the view says to update worfy there', async () => {
    const pair = await linkedPair('read', { './link.ts': () => import('../../src/main/ipc/link').then((module) => module.default) })
    const answer = await pair.calls.call(pair.bId, 'acceptance.get', undefined)
    expect(answer.ok).toBe(false)
    expect(olderWorfyText('acceptance.get', (answer as { error: string }).error, 'beta')).toBe('Update worfy on beta: its worfy has no Acceptance view yet')
    expect(olderWorfyText('acceptance.get', 'acceptance.get: beta is unreachable', 'beta')).toBeNull()
  })

  it("B's `hello` comes after A sees the connection open: machines() says B's build once it comes, with no other message from B", async () => {
    // No RemoteCalls on B: no `projects-access` from B follows its `hello`, so only the `hello` itself tells A's RemoteCalls.
    bench = new LinkBench({ ipcModules: { './link.ts': () => import('../../src/main/ipc/link').then((module) => module.default) } })
    const alpha = await bench.machine('alpha', { platform: 'mac' })
    const beta = await bench.machine('beta', { platform: 'windows', buildVersion: PC_BUILD })
    await bench.link(alpha, beta)
    const bId = beta.service.machine.id
    const calls = new RemoteCalls(alpha.service)
    const seen: { online: boolean; build: string | undefined }[] = []
    calls.on('changed', () => {
      const machine = calls.machines().find((each) => each.id === bId)
      if (machine !== undefined) seen.push({ online: machine.online, build: machine.build })
    })
    await alpha.service.connect(bId)
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<'no hello change'>((resolve) => (timer = setTimeout(() => resolve('no hello change'), ms(5_000))))
    const built = until(calls, () => calls.machines().find((machine) => machine.id === bId)?.build === PC_BUILD).then(() => 'built' as const)
    expect(await Promise.race([built, late])).toBe('built')
    clearTimeout(timer)
    expect(calls.machines().find((machine) => machine.id === bId)).toMatchObject({ online: true, build: PC_BUILD, platform: 'windows' })
  })
})

describe('`hello` with a platform this build does not know (worfy-acceptance ticket 07)', () => {
  it('drops the unknown platform like an unknown key, and keeps the rest of the hello', () => {
    const hello = { id: '0b7c4a52-3c1e-4f6e-9a4b-6d2f0c1e8a11', name: 'beta', protocol: 3, build: PC_BUILD, port: 52000, accepts: ['note'], platform: 'plan9' }
    const parsed = helloMessage.schema.safeParse(hello)
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({ id: hello.id, name: 'beta', protocol: 3, build: PC_BUILD, port: 52000, accepts: ['note'] })
  })
})

describe('machines() of a Linked machine with no connection for the calls (worfy-acceptance ticket 07)', () => {
  it("says no build and no platform while it is offline, whatever another connection said", () => {
    const id = '0b7c4a52-3c1e-4f6e-9a4b-6d2f0c1e8a11'
    // A link service with no connection the calls could use, and one `hello` known under its default connection: a
    // call of announced() without a connection would fall back to it.
    const service = Object.assign(new EventEmitter(), {
      registerMessage: () => undefined,
      linkedMachines: () => [{ id, name: 'beta', connected: false }],
      settings: { levelOf: () => 'off' as const },
      sendMessage: () => undefined,
      connectionTo: () => undefined,
      isLinked: () => true,
      announced: (_machineId: string, connection: unknown = 'the open one') => (connection === undefined ? undefined : { build: PC_BUILD, platform: 'windows' as const }),
    }) as unknown as LinkService
    const machine = new RemoteCalls(service).machines().find((each) => each.id === id)
    expect(machine).toMatchObject({ online: false })
    expect(machine?.build).toBeUndefined()
    expect(machine?.platform).toBeUndefined()
  })
})

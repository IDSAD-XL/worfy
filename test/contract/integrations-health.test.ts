// The Health check rows of Integrations (worfy-integrations ticket 09; spec, implementation decisions, Health check;
// ADR-0109). When the proxy (src/main/integrations/proxy.ts) finds an Integration's sign-in refused, or its service
// failing, each Project of this Machine that has it enabled gets a row `integration` of its own — non-critical, «Jira —
// client A: sign-in needed», with Sign in for an Integration that signs in with OAuth — in the app's report
// (src/main/first-run/health-reports.ts). Two Integrations of one Project are two rows. A sign-in that works again takes
// the rows back to ok. No token reaches a row. The service is the stub of test/fixtures/integrations/service-stub.ts; no
// Electron, no real service.
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HealthReports } from '../../src/main/first-run/health-reports'
import { integrationHealth } from '../../src/main/integrations/health'
import { integrationsHandlers } from '../../src/main/ipc/integrations'
import { IntegrationProxy } from '../../src/main/integrations/proxy'
import { IntegrationStore } from '../../src/main/integrations/store'
import { settingsPath, writeProjectIntegrations } from '../../src/main/projects/settings'
import { defaultProjectSettings } from '../../src/shared/projects/action-templates'
import { writeFileSync } from 'node:fs'
import { claudeMcpServer } from '../../src/main/vendors/claude/mcp'
import { checkSchema, type Check } from '../../src/shared/ipc/first-run'
import { startServiceStub, type ServiceStub } from '../fixtures/integrations/service-stub'

vi.mock('electron', () => ({ app: { on: () => undefined } }))

const TOKEN_A = 'tok-jira-a-5d1c9e20'
const TOKEN_L = 'tok-linear-77ab03fe'

let scratch: string
let stub: ServiceStub
let store: IntegrationStore
let reports: HealthReports
let proxy: IntegrationProxy
let clients: Client[]
let ids: { jira: string; linear: string; oauth: string }
const projects = [
  { id: 'alpha-0000000a', name: 'alpha' },
  { id: 'beta-0000000b', name: 'beta' },
]
const dataDir = (id: string): string => join(scratch, 'projects', id)

beforeEach(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-integrations-health-')))
  for (const project of projects) mkdirSync(dataDir(project.id), { recursive: true })
  stub = await startServiceStub({ bearer: { [TOKEN_A]: 'alpha', [TOKEN_L]: 'beta' } })
  store = new IntegrationStore(join(scratch, 'integrations'))
  const add = (label: string, token: string): string => {
    const added = store.add({ service: 'custom', label, auth: 'bearer', transport: { kind: 'http', url: stub.url } })
    store.setSecret(added.id, 'access', token)
    return added.id
  }
  ids = {
    jira: add('Jira — client A', TOKEN_A),
    linear: add('Linear', TOKEN_L),
    oauth: store.add({ service: 'custom', label: 'Notion — client A', auth: 'oauth', transport: { kind: 'http', url: stub.url } }).id,
  }
  // alpha uses all three; beta has Jira turned off.
  writeProjectIntegrations(dataDir(projects[0]!.id), [
    { id: ids.jira, enabled: true, tools: 'all', autopilot: false },
    { id: ids.linear, enabled: true, tools: 'all', autopilot: false },
    { id: ids.oauth, enabled: true, tools: 'all', autopilot: false },
  ])
  writeProjectIntegrations(dataDir(projects[1]!.id), [{ id: ids.jira, enabled: false, tools: 'all', autopilot: false }])
  reports = new HealthReports()
  proxy = new IntegrationProxy({
    store,
    // The OAuth Integration has no token kept: the proxy answers «Sign-in needed» without asking the service.
    oauth: () => undefined,
    onStatus: integrationHealth({ reports, store, projects: () => ({ list: () => projects, dataDir }) }),
  })
  clients = []
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(async () => {
  vi.restoreAllMocks()
  for (const client of clients) await client.close()
  await proxy.close()
  await stub.close()
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** One Session's server of Integration `id`, as Claude Code meets it. */
async function session(id: string, name: string): Promise<Client> {
  const server = await claudeMcpServer(proxy.sessionServer({ id, name, tools: 'all' }))
  const [ours, theirs] = InMemoryTransport.createLinkedPair()
  await (server.instance as unknown as { connect(transport: InMemoryTransport): Promise<void> }).connect(theirs)
  const client = new Client({ name: 'claude-code-stand-in', version: '1.0.0' })
  await client.connect(ours)
  clients.push(client)
  return client
}

const rows = (): Check[] => (reports.current()?.checks ?? []).filter((check) => check.id === 'integration')
/** The rows out of ok: a row a message alone made goes once the feature says it works again. */
const failing = (): Check[] => rows().filter((check) => check.status !== 'ok')

describe('an Integration whose sign-in the service refused', () => {
  it('is a non-critical row of each Project that has it enabled, «<label>: sign-in needed», with no token in it', async () => {
    const client = await session(ids.jira, 'jira-client-a')
    await client.callTool({ name: 'whoami', arguments: {} })
    expect(rows()).toEqual([])
    stub.revoke(TOKEN_A)
    await client.callTool({ name: 'whoami', arguments: {} })

    const found = rows()
    // beta has Jira turned off: its Sessions do not use it.
    expect(found).toHaveLength(1)
    const [row] = found
    expect(checkSchema.parse(row)).toEqual(row)
    expect(row).toMatchObject({
      id: 'integration',
      group: 'Projects',
      // The reason is the row's name, read whole as in the prototype: «Jira — client A: sign-in needed».
      title: 'Jira — client A: sign-in needed',
      status: 'fail',
      severity: 'non-critical',
      project: { id: 'alpha-0000000a', name: 'alpha' },
      subject: { id: ids.jira, label: 'Jira — client A' },
      detail: 'Jira — client A: sign-in needed',
      opensFirstRun: false,
    })
    // A token Integration signs in with a new token in Project settings: no window to open.
    expect(row?.actions).toEqual([])
    expect(row?.hint).toMatch(/Project settings → Integrations/u)
    expect(JSON.stringify(reports.current())).not.toContain(TOKEN_A)
  })

  it('one that signs in with OAuth offers Sign in, which names the Integration', async () => {
    const client = await session(ids.oauth, 'notion-client-a')
    await client.callTool({ name: 'whoami', arguments: {} }).catch(() => undefined)
    const [row] = rows()
    expect(row).toMatchObject({ subject: { id: ids.oauth, label: 'Notion — client A' }, detail: 'Notion — client A: sign-in needed', severity: 'non-critical' })
    expect(row?.actions).toEqual([{ id: 'integration-sign-in', label: 'Sign in', integration: ids.oauth }])
  })

  it('two Integrations of one Project are two rows', async () => {
    const jira = await session(ids.jira, 'jira-client-a')
    const linear = await session(ids.linear, 'linear')
    stub.revoke(TOKEN_A)
    stub.revoke(TOKEN_L)
    await jira.callTool({ name: 'whoami', arguments: {} }).catch(() => undefined)
    await linear.callTool({ name: 'whoami', arguments: {} }).catch(() => undefined)
    expect(rows().map((row) => row.subject?.label).sort()).toEqual(['Jira — client A', 'Linear'])
  })

  it('a service that fails is a row with its text, the token hidden; a sign-in that works again takes the row back to ok', async () => {
    const listener = integrationHealth({ reports, store, projects: () => ({ list: () => projects, dataDir }) })
    listener(ids.linear, { state: 'error', message: `the service said: bad header Bearer ${TOKEN_L}` })
    const [row] = rows()
    expect(row).toMatchObject({ status: 'fail', severity: 'non-critical', subject: { id: ids.linear } })
    expect(row?.detail.startsWith('Linear: ')).toBe(true)
    expect(JSON.stringify(reports.current())).not.toContain(TOKEN_L)

    listener(ids.linear, { state: 'signed-in' })
    expect(failing()).toEqual([])
  })

  it('the proxy forgetting a status (a new sign-in) takes the row back to ok', async () => {
    const client = await session(ids.jira, 'jira-client-a')
    stub.revoke(TOKEN_A)
    await client.callTool({ name: 'whoami', arguments: {} }).catch(() => undefined)
    expect(failing().map((row) => row.subject?.id)).toEqual([ids.jira])
    proxy.clearStatus(ids.jira)
    expect(proxy.status(ids.jira)).toBeNull()
    expect(failing()).toEqual([])
  })
})

// Round 2 of the review: a Project turning an Integration on or off takes its row along at once — the rows are built
// for the Projects that have it on, so the last status the proxy knows is told again for the new set.
describe('a Project turning an Integration on or off', () => {
  /** The channels of this Machine over the test's store, proxy and Projects. */
  function channels(): (channel: string, input: unknown) => Promise<unknown> {
    for (const project of projects) {
      const settings = { ...defaultProjectSettings('plugin'), integrations: readEntries(project.id) }
      writeFileSync(settingsPath(dataDir(project.id)), `${JSON.stringify(settings)}\n`)
    }
    const module = integrationsHandlers({ store: () => store, projects: { list: () => projects, dataDir }, proxy: () => proxy, closeConnections: async () => undefined })
    return async (channel, input) => {
      const handler = module.find((entry) => entry.channel.name === channel)
      if (handler === undefined) throw new Error(`no handler ${channel}`)
      return handler.handle(handler.channel.input.parse(input), { event: {} as never })
    }
  }
  const readEntries = (projectId: string) =>
    projectId === projects[0]!.id
      ? [
          { id: ids.jira, enabled: true, tools: 'all' as const, autopilot: false },
          { id: ids.linear, enabled: true, tools: 'all' as const, autopilot: false },
          { id: ids.oauth, enabled: true, tools: 'all' as const, autopilot: false },
        ]
      : [{ id: ids.jira, enabled: false, tools: 'all' as const, autopilot: false }]
  const failingIn = (projectId: string): string[] => failing().filter((row) => row.project?.id === projectId).map((row) => row.subject?.id ?? '')

  it('off in alpha takes alpha`s row away; on in beta gives beta one', async () => {
    const call = channels()
    const client = await session(ids.jira, 'jira-client-a')
    stub.revoke(TOKEN_A)
    await client.callTool({ name: 'whoami', arguments: {} }).catch(() => undefined)
    expect(failingIn(projects[0]!.id)).toEqual([ids.jira])
    expect(failingIn(projects[1]!.id)).toEqual([])

    await call('integrations.setEnabled', { projectId: projects[0]!.id, id: ids.jira, enabled: false })
    expect(failingIn(projects[0]!.id)).toEqual([])
    await call('integrations.setEnabled', { projectId: projects[1]!.id, id: ids.jira, enabled: true })
    expect(failingIn(projects[1]!.id)).toEqual([ids.jira])
  })

  it('a Remove whose sign-out fails still leaves no row of the Integration', async () => {
    channels()
    const client = await session(ids.jira, 'jira-client-a')
    stub.revoke(TOKEN_A)
    await client.callTool({ name: 'whoami', arguments: {} }).catch(() => undefined)
    expect(failingIn(projects[0]!.id)).toEqual([ids.jira])
    // The OAuth sign-out fails as a partition that cannot be cleared would (oauth.ts, clearPartition).
    const module = integrationsHandlers({
      store: () => store,
      projects: { list: () => projects, dataDir },
      proxy: () => proxy,
      closeConnections: async () => undefined,
      oauth: () => ({ signIn: () => Promise.reject(new Error('not here')), signOut: () => Promise.reject(new Error('the partition could not be cleared')) }),
    })
    const oauthJira = store.add({ service: 'custom', label: 'Jira OAuth', auth: 'oauth', transport: { kind: 'http', url: stub.url } }).id
    writeProjectIntegrations(dataDir(projects[0]!.id), [...readEntries(projects[0]!.id), { id: oauthJira, enabled: true, tools: 'all', autopilot: false }])
    const oauthClient = await session(oauthJira, 'jira-oauth')
    await oauthClient.callTool({ name: 'whoami', arguments: {} }).catch(() => undefined)
    expect(failingIn(projects[0]!.id)).toContain(oauthJira)
    const remove = module.find((entry) => entry.channel.name === 'integrations.remove')!
    await remove.handle(remove.channel.input.parse({ projectId: projects[0]!.id, id: oauthJira, confirmed: true }), { event: {} as never })
    expect(store.get(oauthJira)).toBeUndefined()
    expect(failingIn(projects[0]!.id)).not.toContain(oauthJira)
  })
})


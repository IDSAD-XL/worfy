// An allowed remote MCP server goes into a Session's list by its address (worfy-mcp-live ticket 12; the spike of
// ticket 11, .scratch/worfy-mcp-live/spike-claudeai-connectors.md). Claude Code drops a serverName entry with a
// dot or a space — every claude.ai connector's name — so the MCP inventory keeps, next to its rows, the address of
// each remote server (config.url), in main only; a Session's start takes them, and the query factory writes the
// policy tier's allowedMcpServers with them. A remote server found after the start is a row `not-started` that says
// the next start has it; one with neither a readable name nor an address says a Restart does not help.
//
// The inventory's query is a hand-made handle answering mcpServerStatus() as Claude Code does, with config; the
// Session's query is the fake agent (src/main/agent/fake-query.ts); the SDK's query() is the test's own. No Claude
// Code starts, no model is called, HOME is a temporary folder. Every server name is made up.
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import { SessionRegistry, type QueryHandle, type QueryRequest } from '../../src/main/agent/session'
import type { CanvasSession } from '../../src/main/mcp/canvas-server'
import {
  MCP_NOT_ALLOWABLE,
  MCP_NOT_STARTED,
  MCP_NOT_STARTED_FOUND_LATER,
  MCP_NOT_STARTED_FOUND_LATER_UNATTENDED,
  McpInventory,
  notStartedRows,
  type InventoryQueryStarter,
} from '../../src/main/vendors/claude/mcp-inventory'
import { claudeSessions } from '../../src/main/vendors/claude/session'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { McpServerRow } from '../../src/shared/agent/mcp-status'
import { CANVAS_SERVER_NAME } from '../../src/shared/canvas/tools'
import { AGENT_SCRIPTS } from './autopilot-faults-setup'

const mocks = vi.hoisted(() => ({ agentEnv: vi.fn() }))

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
}))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: () => {
    throw new Error('the Agent SDK module was imported: the factory must take query() from loadSdk')
  },
}))
vi.mock('../../src/main/agent/env', () => ({ agentEnv: mocks.agentEnv }))

const { sdkQueryFactory } = await import('../../src/main/vendors/claude/query')

let scratch: string
let home: string
let cwd: string
let registries: SessionRegistry[] = []

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-mcp-addresses-')))
  home = join(scratch, 'home')
  cwd = join(scratch, 'repo')
  mkdirSync(join(home, '.claude'), { recursive: true })
  mkdirSync(cwd)
  vi.stubEnv('HOME', home)
  vi.stubEnv('USERPROFILE', home)
  vi.stubEnv('WORFY_CLAUDE_HOME', join(home, '.claude'))
  vi.stubEnv('WORFY_HARNESS_HOME', join(scratch, 'no-harness'))
  mocks.agentEnv.mockReset().mockResolvedValue({ env: { HOME: home, PATH: '/usr/bin:/bin' }, from: 'login-shell' })
})

afterEach(async () => {
  for (const registry of registries) registry.closeAll()
  registries = []
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const DOCS = 'claude.ai Acme Docs'
const WIKI = 'claude.ai Acme Wiki'
const DOCS_URL = 'https://docs.acme.example/mcp?workspace=acme-secret'

/** What mcpServerStatus() of the inventory's query answers: config and scope as Claude Code gives them. */
const ANSWER = [
  { name: 'example-notes', status: 'connected', scope: 'user', source: 'user', config: { type: 'stdio', command: 'example-notes' }, tools: [{ name: 'a' }] },
  { name: DOCS, status: 'connected', scope: 'claudeai', source: 'claudeai', config: { type: 'claudeai-proxy', url: DOCS_URL, id: 'acme-1' }, tools: [] },
  // A connector the answer gives no address for.
  { name: WIKI, status: 'needs-auth', scope: 'claudeai', source: 'claudeai', config: { type: 'claudeai-proxy', id: 'acme-2' } },
]

/** An inventory whose query answers `answer()`; `starts` counts its runs. Every folder stands for itself (no git). */
function inventoryOf(answer: () => unknown) {
  let starts = 0
  const starter: InventoryQueryStarter = () => {
    starts += 1
    const handle = { mcpServerStatus: () => Promise.resolve(answer()), close: () => undefined }
    return Promise.resolve(handle as unknown as QueryHandle)
  }
  const inventory = new McpInventory(starter, { settleMs: 50, pollMs: 10 }, () => Promise.resolve(null))
  return { inventory, starts: () => starts }
}

describe('the inventory keeps the addresses of remote servers next to its rows', () => {
  it('in memory only: the rows carry no address, addresses() has them by name', async () => {
    const { inventory } = inventoryOf(() => ANSWER)
    expect(inventory.addresses(cwd)).toBeNull()
    const rows = await inventory.refresh(cwd)
    expect(rows?.map((row) => row.name)).toEqual(['example-notes', DOCS, WIKI])
    expect(JSON.stringify(rows)).not.toContain('acme.example')
    expect(Object.fromEntries(inventory.addresses(cwd) ?? [])).toEqual({ [DOCS]: DOCS_URL })
  })

  it('a failed run keeps the last answer’s addresses', async () => {
    let fail = false
    const { inventory } = inventoryOf(() => {
      if (fail) throw new Error(`a message naming ${DOCS}`)
      return ANSWER
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await inventory.refresh(cwd)
    fail = true
    expect(await inventory.refresh(cwd)).toBeNull()
    expect(inventory.addresses(cwd)?.get(DOCS)).toBe(DOCS_URL)
  })
})

describe('a Session’s start takes the inventory’s addresses', () => {
  /** Sessions in `cwd` over the fake agent, with the list `listed`; `requests` holds what each start asked. */
  function sessions(listed: readonly string[], answer: () => unknown = () => ANSWER) {
    const requests: QueryRequest[] = []
    const fake = fakeQueryFactory({ scriptsDir: AGENT_SCRIPTS, script: 'mcp-sign-in', mcpAllowlist: () => Promise.resolve(listed) })
    const { inventory, starts } = inventoryOf(answer)
    const registry = new SessionRegistry(
      claudeSessions((request) => {
        requests.push(request)
        return fake(request)
      }, {}, inventory),
    )
    registries.push(registry)
    const start = () => {
      const events: AgentEvent[] = []
      const session = registry.start(cwd, undefined, (_id, event) => events.push(event))
      const rows = (): McpServerRow[] => events.filter((event): event is Extract<AgentEvent, { type: 'mcp' }> => event.type === 'mcp').at(-1)?.servers ?? []
      return { session, rows }
    }
    return { requests, starts, start }
  }

  const reasons = (rows: readonly McpServerRow[]) => rows.filter((row) => row.status === 'not-started').map((row) => ({ name: row.name, error: row.error, actions: row.actions }))

  it('the first start has none: the connector found after it says the next start has it; the next start has its address', async () => {
    const h = sessions(['example-notes', DOCS, WIKI])
    const first = h.start()
    await vi.waitFor(() => expect(h.requests).toHaveLength(1))
    expect(h.requests[0]).not.toHaveProperty('mcpAddresses')
    await vi.waitFor(() =>
      expect(reasons(first.rows())).toEqual([
        { name: DOCS, error: MCP_NOT_STARTED_FOUND_LATER, actions: ['restart'] },
        { name: WIKI, error: MCP_NOT_ALLOWABLE, actions: [] },
      ]),
    )
    const second = h.start()
    await vi.waitFor(() => expect(h.requests).toHaveLength(2))
    expect(Object.fromEntries(h.requests[1]?.mcpAddresses ?? [])).toEqual({ [DOCS]: DOCS_URL })
    // The fake agent does not start DOCS by its address: the row of a server the start had the address of is the plain one.
    await vi.waitFor(() => expect(reasons(second.rows()).find((row) => row.name === DOCS)).toEqual({ name: DOCS, error: MCP_NOT_STARTED, actions: ['restart'] }))
    // Neither row, nor the request's rows, carry the address.
    expect(JSON.stringify(second.rows())).not.toContain('acme.example')
  })
})

describe('the query factory writes the list by address', () => {
  it('stdio and worfy’s servers by name, the connector by its origin and path with `*`, no token, nothing for a name without address', async () => {
    const seen: { managedSettings?: unknown }[] = []
    const attached: CanvasSession = {
      attachment: { server: { type: 'sdk', name: CANVAS_SERVER_NAME } as never, cardsDir: join(scratch, 'cards'), instructions: 'canvas' },
      observe: (query) => query,
    }
    const sdk = {
      query: ({ options }: { prompt: unknown; options: object }) => {
        seen.push(options as { managedSettings?: unknown })
        return { close: () => undefined } as unknown as QueryHandle
      },
    }
    const factory = sdkQueryFactory(() => Promise.resolve(attached), () => Promise.resolve(['example-notes', DOCS, WIKI, CANVAS_SERVER_NAME]), {
      loadSdk: () => Promise.resolve(sdk as never),
      autoCompactWindow: () => null,
      browser: () => Promise.resolve(null),
      skills: () => Promise.resolve(null),
      privateSkills: () => Promise.resolve(null),
    })
    const request = (more: Partial<QueryRequest>): QueryRequest => ({
      prompt: { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }) },
      cwd,
      resume: undefined,
      stderr: () => undefined,
      settings: { model: null, effort: null, permissionMode: 'default' },
      canUseTool: () => Promise.resolve({ behavior: 'deny', message: 'no' }),
      ...more,
    })
    await factory(request({ mcpAddresses: new Map([[DOCS, DOCS_URL]]) }))
    expect(seen[0]?.managedSettings).toEqual({
      allowManagedMcpServersOnly: true,
      allowedMcpServers: [{ serverName: 'example-notes' }, { serverUrl: 'https://docs.acme.example/mcp*' }, { serverName: CANVAS_SERVER_NAME }],
    })
    expect(JSON.stringify(seen[0])).not.toContain('acme-secret')
    // No inventory answer yet: the connector is left out, Claude Code would drop its name anyway.
    await factory(request({}))
    expect(seen[1]?.managedSettings).toEqual({ allowManagedMcpServersOnly: true, allowedMcpServers: [{ serverName: 'example-notes' }, { serverName: CANVAS_SERVER_NAME }] })
  })
})

describe('the reason of a row not-started (notStartedRows)', () => {
  const row = (name: string, source: McpServerRow['source'] = 'user'): McpServerRow => ({ name, status: 'connected', tools: 1, error: null, source, sourceWord: null, actions: [] })
  const inventory = [row('example-notes'), row(DOCS, 'claudeai'), row(WIKI, 'claudeai'), row('acme-remote')]
  const set = { listed: ['example-notes', DOCS, WIKI, 'acme-remote'], rows: [row('example-notes')], off: [] as string[] }
  const now = new Map([
    [DOCS, DOCS_URL],
    ['acme-remote', 'https://remote.acme.example/mcp'],
  ])
  const of = (more: Partial<Parameters<typeof notStartedRows>[1]>) => notStartedRows(inventory, { ...set, ...more }).map((each) => [each.name, each.error, each.actions])

  it('a remote server whose address the start lacked says the next start has it; one it had is the plain row', () => {
    expect(of({ attended: true, addressesNow: now, addressesAtStart: new Map([['acme-remote', 'https://remote.acme.example/mcp']]) })).toEqual([
      [DOCS, MCP_NOT_STARTED_FOUND_LATER, ['restart']],
      [WIKI, MCP_NOT_ALLOWABLE, []],
      ['acme-remote', MCP_NOT_STARTED, ['restart']],
    ])
  })

  it('an address that changed since the start is found later too', () => {
    expect(of({ attended: true, addressesNow: now, addressesAtStart: new Map([[DOCS, 'https://docs.acme.example/old']]) })[0]).toEqual([DOCS, MCP_NOT_STARTED_FOUND_LATER, ['restart']])
  })

  it('an unattended Session offers no Restart and says so', () => {
    expect(of({ attended: false, addressesNow: now, addressesAtStart: null })).toEqual([
      [DOCS, MCP_NOT_STARTED_FOUND_LATER_UNATTENDED, []],
      [WIKI, MCP_NOT_ALLOWABLE, []],
      ['acme-remote', MCP_NOT_STARTED_FOUND_LATER_UNATTENDED, []],
    ])
  })

  it('without addresses — a Claude Code older than the field — a readable name keeps the plain row, a connector says why it never starts', () => {
    expect(of({ attended: true })).toEqual([
      [DOCS, MCP_NOT_ALLOWABLE, []],
      [WIKI, MCP_NOT_ALLOWABLE, []],
      ['acme-remote', MCP_NOT_STARTED, ['restart']],
    ])
  })
})

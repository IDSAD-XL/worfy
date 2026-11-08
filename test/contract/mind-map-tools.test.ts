// The Mind map MCP server `worfy-mind-map` (src/main/mcp/mind-map-server.ts; Epic worfy-product-session,
// ticket 04) through its in-process instance, the way Claude Code talks to it: JSON-RPC over a transport,
// so the server's own schema check runs too. Each operation changes a fixture topic's mind-map.json as
// expected; a refused one leaves the file byte for byte; two adds at once both land; the write is retried
// on Windows while a file is held open; only a Product Session gets the server.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryRequest } from '../../src/main/agent/session'
import type { MindMapNode } from '../../src/shared/product/mind-map'
import { MIND_MAP_SERVER_NAME } from '../../src/shared/product/tools'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'
import type { McpToolResult } from '../../src/main/vendors/mcp'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const mocks = vi.hoisted(() => ({ query: vi.fn(), agentEnv: vi.fn() }))

vi.mock('electron', () => ({ app: { on: () => undefined, isPackaged: false, getAppPath: () => '/nowhere' } }))
// The real SDK, except query(): it records the options a Session would start Claude Code with.
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => ({ ...(await importOriginal<object>()), query: mocks.query }))
vi.mock('../../src/main/agent/env', () => ({ agentEnv: mocks.agentEnv }))

const PROJECT = 'demo-0a1b2c3d'
const TOPIC = 'roadmap'

let scratch: string
let repo: string
let product: string
let topicDir: string
let mapFile: string
let children: ChildProcess[] = []

/** The fixture topic: a map with Ticket 02 and a Mind map of three nodes. */
const FIXTURE = {
  version: 1,
  nodes: [
    { id: 'idea-1', kind: 'idea', text: 'Show the share of accepted advice', from: 'ticket:02', advice: true },
    { id: 'q-1', kind: 'question', text: 'Per Project or per topic?', from: 'idea-1' },
    { id: 'd-1', kind: 'decision', text: 'Per Project', from: 'q-1', status: 'accepted', reason: 'the owner reads one figure', message: 'msg-old' },
  ],
}

beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-mind-map-')))
  repo = join(scratch, 'repo')
  product = join(repo, 'docs', 'product')
  topicDir = join(product, TOPIC)
  mapFile = join(topicDir, 'mind-map.json')
  mkdirSync(join(topicDir, 'issues'), { recursive: true })
  writeFileSync(join(topicDir, 'map.md'), '# Roadmap of worfy\n\n## Destination\n\nA calmer week.\n')
  writeFileSync(join(topicDir, 'issues', '02-share.md'), '# Share of accepted advice\n\nType: task\nStatus: open\n')
  writeFileSync(mapFile, `${JSON.stringify(FIXTURE, null, 2)}\n`)
  mocks.query.mockReset().mockImplementation(() => ({ kind: 'sdk query', [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }) }))
  mocks.agentEnv.mockReset().mockResolvedValue({ env: { HOME: join(scratch, 'home'), PATH: '/usr/bin' }, from: 'login-shell' })
})

afterEach(() => {
  for (const child of children) child.kill()
  children = []
  removeTestTree(scratch)
})

interface Rpc {
  call(name: string, args?: Record<string, unknown>): Promise<McpToolResult>
}

type ServerConfig = { type: string; name: string; instance: { connect(transport: never): Promise<void> } }

/** A JSON-RPC client of an in-process SDK server. */
async function connectTo(config: ServerConfig): Promise<Rpc> {
  expect(config).toMatchObject({ type: 'sdk', name: MIND_MAP_SERVER_NAME })
  type Message = { id?: number; result?: unknown; error?: unknown }
  const pending = new Map<number, (message: Message) => void>()
  const transport: { onmessage?: (message: unknown) => void; start(): Promise<void>; close(): Promise<void>; send(message: Message): Promise<void> } = {
    start: () => Promise.resolve(),
    close: () => Promise.resolve(),
    send: (message) => {
      const resolve = message.id === undefined ? undefined : pending.get(message.id)
      if (resolve && message.id !== undefined) {
        pending.delete(message.id)
        resolve(message)
      }
      return Promise.resolve()
    },
  }
  await config.instance.connect(transport as never)
  let next = 0
  const request = (method: string, params: unknown): Promise<Message> =>
    new Promise((resolve) => {
      next += 1
      pending.set(next, resolve)
      transport.onmessage?.({ jsonrpc: '2.0', id: next, method, params })
    })
  await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
  transport.onmessage?.({ jsonrpc: '2.0', method: 'notifications/initialized' })
  return {
    call: async (name, args = {}) => {
      const answer = await request('tools/call', { name, arguments: args })
      if (answer.error !== undefined) return { content: [{ type: 'text', text: JSON.stringify(answer.error) }], isError: true }
      return answer.result as McpToolResult
    },
  }
}

const textOf = (result: McpToolResult): string => {
  const first = result.content[0]
  return first?.type === 'text' ? first.text : ''
}
const json = <T>(result: McpToolResult): T => {
  expect(result.isError, textOf(result)).toBeFalsy()
  return JSON.parse(textOf(result)) as T
}
const nodesOnDisk = (): MindMapNode[] => (JSON.parse(readFileSync(mapFile, 'utf8')) as { nodes: MindMapNode[] }).nodes

const server = () => import('../../src/main/mcp/mind-map-server')

/** The server of a Product Session in the fixture Project, its save answering `saved`. */
async function session(overrides: { productFolder?: string | null; save?: (projectId: string) => Promise<string> } = {}) {
  const { mindMapForSession } = await server()
  const found = await mindMapForSession(
    { cwd: repo, productFolder: overrides.productFolder === undefined ? product : overrides.productFolder },
    { projects: () => [{ id: PROJECT, name: 'demo', path: repo }], save: overrides.save ?? (() => Promise.resolve('nothing to save')) },
  )
  if (found === null) throw new Error('no Mind map server for the fixture Project')
  return { found, rpc: await connectTo(found.attachment.server as unknown as ServerConfig) }
}

describe('the mind_map_* tools on a fixture topic', () => {
  it('mind_map_read lists the topics and reads one: its map, Tickets, nodes and no errors', async () => {
    mkdirSync(join(product, 'critic'), { recursive: true })
    const { rpc } = await session()
    expect(json(await rpc.call('mind_map_read'))).toEqual({ topics: [{ topic: TOPIC, title: 'Roadmap of worfy', tickets: 1, nodes: 3, errors: 0 }] })
    const read = json<{ title: string; tickets: unknown[]; nodes: MindMapNode[]; errors: unknown[] }>(await rpc.call('mind_map_read', { topic: TOPIC }))
    expect(read).toMatchObject({ topic: TOPIC, title: 'Roadmap of worfy', sections: ['Destination'], errors: [] })
    expect(read.tickets).toEqual([{ ref: 'ticket:02', slug: 'share', title: 'Share of accepted advice', status: 'open' }])
    expect(read.nodes.map((node) => node.id)).toEqual(['idea-1', 'q-1', 'd-1'])
    expect((await rpc.call('mind_map_read', { topic: 'other' })).isError).toBe(true)
  })

  it('mind_map_add appends a node with a new id and answers it; a decision and an objection carry their fields', async () => {
    const { rpc } = await session()
    const idea = json<MindMapNode>(await rpc.call('mind_map_add', { topic: TOPIC, kind: 'idea', text: 'A weekly digest', from: null, advice: true }))
    expect(idea).toMatchObject({ kind: 'idea', text: 'A weekly digest', from: null, advice: true })
    expect(idea.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    expect(idea).not.toHaveProperty('message')
    const objection = json<MindMapNode>(await rpc.call('mind_map_add', { topic: TOPIC, kind: 'objection', text: 'Nobody reads digests', from: idea.id, source: 'docs/research/digest.md' }))
    const decision = json<MindMapNode>(await rpc.call('mind_map_add', { topic: TOPIC, kind: 'decision', text: 'No digest', from: objection.id, status: 'rejected', reason: 'too early' }))
    expect(nodesOnDisk()).toEqual([...FIXTURE.nodes, idea, objection, decision])
  })

  it('mind_map_update changes text, kind and advice; an objection keeps its source until it stops being one', async () => {
    const { rpc } = await session()
    const objection = json<MindMapNode>(await rpc.call('mind_map_add', { topic: TOPIC, kind: 'objection', text: 'Too slow', from: 'idea-1', source: 'PR #12' }))
    expect(json(await rpc.call('mind_map_update', { topic: TOPIC, id: objection.id, text: 'Too slow on Windows' }))).toMatchObject({ text: 'Too slow on Windows', source: 'PR #12' })
    const idea = json<MindMapNode>(await rpc.call('mind_map_update', { topic: TOPIC, id: objection.id, kind: 'idea', advice: false }))
    expect(idea).toMatchObject({ kind: 'idea', advice: false })
    expect(idea).not.toHaveProperty('source')
    expect(nodesOnDisk().find((node) => node.id === objection.id)).toEqual(idea)
  })

  it('mind_map_decide makes a node a Decision; deciding again moves the old status, reason and message to history', async () => {
    const { rpc } = await session()
    expect(json(await rpc.call('mind_map_decide', { topic: TOPIC, id: 'q-1', status: 'accepted', reason: 'asked twice' }))).toMatchObject({ id: 'q-1', kind: 'decision', status: 'accepted', reason: 'asked twice' })
    const again = json<MindMapNode>(await rpc.call('mind_map_decide', { topic: TOPIC, id: 'd-1', status: 'rejected', reason: 'per topic after all' }))
    expect(again).toMatchObject({ status: 'rejected', reason: 'per topic after all', history: [{ status: 'accepted', reason: 'the owner reads one figure', message: 'msg-old' }] })
    expect(nodesOnDisk().find((node) => node.id === 'd-1')).toEqual(again)
    // A new Decision may overturn one.
    const replacing = json<MindMapNode>(await rpc.call('mind_map_add', { topic: TOPIC, kind: 'decision', text: 'Per topic', from: 'q-1', status: 'accepted', reason: 'owner', replaces: 'd-1' }))
    expect(replacing.replaces).toBe('d-1')
  })

  it('mind_map_remove takes out a leaf; a node with children and a Decision are refused', async () => {
    const { rpc } = await session()
    expect((await rpc.call('mind_map_remove', { topic: TOPIC, id: 'idea-1' })).isError).toBe(true)
    expect((await rpc.call('mind_map_remove', { topic: TOPIC, id: 'd-1' })).isError).toBe(true)
    const leaf = json<MindMapNode>(await rpc.call('mind_map_add', { topic: TOPIC, kind: 'question', text: 'Typo?', from: 'idea-1' }))
    expect(json(await rpc.call('mind_map_remove', { topic: TOPIC, id: leaf.id }))).toEqual({ removed: leaf.id })
    expect(nodesOnDisk()).toEqual(FIXTURE.nodes)
  })

  it('a wrong node, a wrong argument or a topic outside the folder is isError, and the file stays byte for byte', async () => {
    const { rpc } = await session()
    const before = readFileSync(mapFile)
    const refused: [string, Record<string, unknown>][] = [
      // The format: a decision without a reason, an objection without a source, a parent that does not exist.
      ['mind_map_add', { topic: TOPIC, kind: 'decision', text: 'x', from: null, status: 'accepted' }],
      ['mind_map_add', { topic: TOPIC, kind: 'objection', text: 'x', from: null }],
      ['mind_map_add', { topic: TOPIC, kind: 'idea', text: 'x', from: 'nobody' }],
      ['mind_map_add', { topic: TOPIC, kind: 'idea', text: 'x', from: 'ticket:07' }],
      ['mind_map_add', { topic: TOPIC, kind: 'idea', text: 'x', from: 'd-1', status: 'accepted' }],
      ['mind_map_add', { topic: TOPIC, kind: 'idea', text: '   ', from: null }],
      ['mind_map_add', { topic: TOPIC, kind: 'plan', text: 'x', from: null }],
      ['mind_map_decide', { topic: TOPIC, id: 'q-1', status: 'accepted', reason: '' }],
      ['mind_map_decide', { topic: TOPIC, id: 'q-1', status: 'accepted', reason: 'x', replaces: 'idea-1' }],
      ['mind_map_update', { topic: TOPIC, id: 'd-1', kind: 'idea' }],
      ['mind_map_update', { topic: TOPIC, id: 'idea-1', kind: 'decision' }],
      ['mind_map_update', { topic: TOPIC, id: 'idea-1' }],
      ['mind_map_update', { topic: TOPIC, id: 'missing', text: 'x' }],
      // Out of the folder: no separator, no `..`, not the critic's folder.
      ['mind_map_add', { topic: '../escape', kind: 'idea', text: 'x', from: null }],
      ['mind_map_add', { topic: 'critic', kind: 'idea', text: 'x', from: null }],
      ['mind_map_add', { topic: 'a/b', kind: 'idea', text: 'x', from: null }],
    ]
    for (const [name, args] of refused) {
      const answer = await rpc.call(name, args)
      expect(answer.isError, `${name} ${JSON.stringify(args)}: ${textOf(answer)}`).toBe(true)
    }
    expect(readFileSync(mapFile).equals(before)).toBe(true)
    expect(existsSync(join(repo, 'docs', 'escape'))).toBe(false)
    expect(existsSync(join(product, 'critic', 'mind-map.json'))).toBe(false)
  })

  it('a mind-map.json that does not pass the check is never overwritten: the answer names its errors', async () => {
    const broken = `${JSON.stringify({ version: 1, nodes: [{ id: 'x', kind: 'decision', text: 'no reason', from: null, status: 'accepted' }] })}\n`
    writeFileSync(mapFile, broken)
    const { rpc } = await session()
    const answer = await rpc.call('mind_map_add', { topic: TOPIC, kind: 'idea', text: 'x', from: null })
    expect(answer.isError).toBe(true)
    expect(textOf(answer)).toContain('node "x": a decision needs a reason')
    expect(readFileSync(mapFile, 'utf8')).toBe(broken)
  })

  it('a new topic gets its folder and a mind-map.json of its own', async () => {
    const { rpc } = await session()
    const node = json<MindMapNode>(await rpc.call('mind_map_add', { topic: 'pricing', kind: 'question', text: 'Free tier?', from: null }))
    expect(JSON.parse(readFileSync(join(product, 'pricing', 'mind-map.json'), 'utf8'))).toEqual({ version: 1, nodes: [node] })
  })

  it('a topic folder that is a link leading out of the Product Session folder is refused, and nothing is written behind it', async () => {
    const outside = join(scratch, 'outside')
    mkdirSync(outside)
    symlinkSync(outside, join(product, 'linked'), 'junction')
    const { rpc } = await session()
    const answer = await rpc.call('mind_map_add', { topic: 'linked', kind: 'idea', text: 'x', from: null })
    expect(answer.isError, textOf(answer)).toBe(true)
    expect(existsSync(join(outside, 'mind-map.json'))).toBe(false)
  })

  it('without a Product Session folder every Mind map tool refuses; product_save still answers', async () => {
    const { rpc } = await session({ productFolder: null, save: () => Promise.resolve('Silent mode: nothing to save') })
    expect((await rpc.call('mind_map_read')).isError).toBe(true)
    expect((await rpc.call('mind_map_add', { topic: TOPIC, kind: 'idea', text: 'x', from: null })).isError).toBe(true)
    expect(textOf(await rpc.call('product_save'))).toBe('Silent mode: nothing to save')
  })

  it('product_save answers what the save signal of the Session\'s Project says', async () => {
    const asked: string[] = []
    const { rpc } = await session({ save: (projectId) => (asked.push(projectId), Promise.resolve('nothing to save')) })
    const answer = await rpc.call('product_save')
    expect(answer.isError).toBeFalsy()
    expect(textOf(answer)).toBe('nothing to save')
    expect(asked).toEqual([PROJECT])
  })

  it('two mind_map_add at once, without waiting: both nodes are in the file', async () => {
    const { rpc } = await session()
    const [a, b] = await Promise.all([
      rpc.call('mind_map_add', { topic: TOPIC, kind: 'idea', text: 'first', from: null }),
      rpc.call('mind_map_add', { topic: TOPIC, kind: 'idea', text: 'second', from: null }),
    ])
    const ids = [json<MindMapNode>(a!).id, json<MindMapNode>(b!).id]
    expect(nodesOnDisk().filter((node) => ids.includes(node.id)).map((node) => node.text).sort()).toEqual(['first', 'second'])
    // Two Sessions on one topic share the app's one writer too.
    const other = await session()
    await Promise.all([
      rpc.call('mind_map_add', { topic: TOPIC, kind: 'idea', text: 'third', from: null }),
      other.rpc.call('mind_map_add', { topic: TOPIC, kind: 'idea', text: 'fourth', from: null }),
    ])
    expect(nodesOnDisk().map((node) => node.text)).toEqual(expect.arrayContaining(['first', 'second', 'third', 'fourth']))
  })

  it("a node's message is the uuid of the chat message the call came in, when the Session's messages showed it first", async () => {
    const { found, rpc } = await session()
    const input = { topic: TOPIC, kind: 'idea', text: 'From the chat', from: 'idea-1' }
    const assistant = {
      type: 'assistant',
      uuid: 'uuid-of-the-message',
      parent_tool_use_id: null,
      session_id: 's',
      message: { id: 'm', role: 'assistant', model: 'claude', content: [{ type: 'tool_use', id: 'toolu_1', name: `mcp__${MIND_MAP_SERVER_NAME}__mind_map_add`, input: { from: 'idea-1', text: 'From the chat', kind: 'idea', topic: TOPIC } }] },
    }
    const query = found.observe({ [Symbol.asyncIterator]: () => ({ next: (() => { let done = false; return () => Promise.resolve(done ? { done: true, value: undefined } : ((done = true), { done: false, value: assistant })) })() }) })
    for await (const _ of query as AsyncIterable<unknown>) void _
    expect(json(await rpc.call('mind_map_add', input))).toMatchObject({ message: 'uuid-of-the-message' })
    // Taken once: the same call again, with no new message, has none.
    expect(json(await rpc.call('mind_map_add', input))).not.toHaveProperty('message')
  })
})

describe('the write of mind-map.json', () => {
  it('is retried on Windows while another process holds the file (EPERM, EBUSY), then succeeds', async () => {
    const { MindMapWriter } = await server()
    const { writeJsonFile } = await import('../../src/main/storage/json-file')
    const { mindMapSchema } = await import('../../src/shared/product/mind-map')
    let failures = 2
    const writer = new MindMapWriter({
      platform: 'win32',
      retryMs: ms(5000),
      write: (file, map) => {
        if (failures-- > 0) throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: failures === 1 ? 'EPERM' : 'EBUSY' })
        writeJsonFile(file, mindMapSchema, map)
      },
    })
    const added = await writer.update(product, TOPIC, (map) => ({ map: { ...map, nodes: [...map.nodes, { id: 'n-retry', kind: 'idea', text: 'after a retry', from: null }] }, answer: 'ok' }))
    expect(added).toBe('ok')
    expect(failures).toBe(-1)
    expect(nodesOnDisk().map((node) => node.id)).toContain('n-retry')
  })

  it('another process holding the file open for reading does not break the write (needs: windows)', async () => {
    const child = spawn(scriptNode(), ['-e', `const fs = require('fs'); const fd = fs.openSync(process.argv[1], 'r'); process.stdout.write('open'); setInterval(() => fs.fstatSync(fd), 1000)`, mapFile], {
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    children.push(child)
    await new Promise<void>((resolve, reject) => {
      child.stdout?.once('data', () => resolve())
      child.once('error', reject)
      child.once('exit', (code) => reject(new Error(`the holder exited with ${String(code)}`)))
    })
    const { rpc } = await session()
    const node = json<MindMapNode>(await rpc.call('mind_map_add', { topic: TOPIC, kind: 'idea', text: 'while held', from: null }))
    expect(nodesOnDisk().map((each) => each.id)).toContain(node.id)
  })
})

describe('who gets worfy-mind-map', () => {
  const request = (overrides: Partial<QueryRequest> = {}): QueryRequest => ({
    prompt: (async function* () {})(),
    cwd: repo,
    resume: undefined,
    stderr: () => undefined,
    settings: DEFAULT_SETTINGS,
    canUseTool: () => Promise.resolve({ behavior: 'deny', message: 'not in this test' }),
    ...overrides,
  })
  const sdkOptions = (): Record<string, unknown> => {
    expect(mocks.query).toHaveBeenCalledOnce()
    return (mocks.query.mock.calls[0] as [{ options: Record<string, unknown> }])[0].options
  }

  it('a Product Session gets the server, its allowlist entry and its instructions; a plain Session and the Orchestrator do not', async () => {
    const { sdkQueryFactory } = await import('../../src/main/vendors/claude/query')
    const { mindMapForSession } = await server()
    const { createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk')
    const canvasServer = createSdkMcpServer({ name: 'worfy-canvas', version: '1', tools: [] })
    const canvas = () => Promise.resolve({ attachment: { server: canvasServer as never, cardsDir: join(scratch, 'cards'), instructions: '# canvas' }, observe: <T extends object>(query: T) => query })
    const asked: unknown[] = []
    const factory = sdkQueryFactory(canvas, () => Promise.resolve(['qmd', 'worfy-canvas']), {
      browser: () => Promise.resolve(null),
      skills: () => Promise.resolve(null),
      autoCompactWindow: () => null,
      productFolder: () => Promise.resolve(product),
      mindMap: (input) => {
        asked.push(input)
        return mindMapForSession(input, { projects: () => [{ id: PROJECT, name: 'demo', path: repo }], save: () => Promise.resolve('nothing to save') })
      },
    })

    await factory({ ...request(), kind: 'product' })
    let options = sdkOptions() as { mcpServers: Record<string, unknown>; managedSettings: { allowedMcpServers: { serverName: string }[] }; systemPrompt: { append: string } }
    expect(asked).toEqual([{ cwd: repo, productFolder: product }])
    expect(options.mcpServers[MIND_MAP_SERVER_NAME]).toMatchObject({ type: 'sdk', name: MIND_MAP_SERVER_NAME })
    expect(options.managedSettings.allowedMcpServers).toContainEqual({ serverName: MIND_MAP_SERVER_NAME })
    expect(options.systemPrompt.append).toContain('# worfy Mind map')
    expect(options.systemPrompt.append).toContain('product_save')

    for (const plain of [request(), request({ orchestrator: true })]) {
      mocks.query.mockClear()
      asked.length = 0
      await factory(plain)
      options = sdkOptions() as typeof options
      expect(asked).toEqual([])
      expect(options.mcpServers).not.toHaveProperty(MIND_MAP_SERVER_NAME)
      expect(options.managedSettings.allowedMcpServers).not.toContainEqual({ serverName: MIND_MAP_SERVER_NAME })
      expect(options.systemPrompt.append).not.toContain('# worfy Mind map')
    }
  })

  it('sessionOptions passes a Mind map attachment only with kind product', async () => {
    const { sessionOptions } = await import('../../src/main/vendors/claude/options')
    const { createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk')
    const mindMap = { server: createSdkMcpServer({ name: MIND_MAP_SERVER_NAME, version: '1', tools: [] }) as never, instructions: '# worfy Mind map' }
    const base = { cwd: repo, env: {}, runtime: { packaged: false, resourcesPath: '/r', platform: process.platform, arch: process.arch }, mindMap, mcpAllowlist: [MIND_MAP_SERVER_NAME] }
    expect(sessionOptions(base).mcpServers).toBeUndefined()
    expect(sessionOptions({ ...base, kind: 'product', productFolder: product }).mcpServers).toHaveProperty(MIND_MAP_SERVER_NAME)
  })
})

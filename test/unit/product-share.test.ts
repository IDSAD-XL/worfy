// The share of accepted advice (src/shared/product/share.ts, src/main/ipc/product.ts; worfy-product-session
// ticket 14): the advisor's advice of every topic's Mind map — the nodes with `advice: true` — and the
// objections of every critic's review, each accepted, rejected or still waiting for the owner. A node
// without `advice` is no advice; a review's objection with an empty `Owner decision:` line waits. A
// broken file is left out and named, never the end of the count. `product.share` reads the Project's
// Product Session folder each time it is asked, through registerIpc against a real folder, and writes
// nothing there.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import type { MindMapNode } from '../../src/shared/product/mind-map'
import { adviceShare, adviceTotals, criticAdvice, mindMapAdvice, type AdviceShare } from '../../src/shared/product/share'
import { APP_URL, INDEX_HTML } from '../app-url'
import { removeTestTree } from '../remove'

const where = vi.hoisted(() => ({ root: '' }))

vi.mock('electron', () => ({ app: { on: () => undefined, isPackaged: false, getAppPath: () => '/nowhere' }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../../src/main/projects/store', () => ({ projectStore: () => ({ get: () => ({ id: 'p1', path: where.root }) }) }))
// The Project's folders as docsSource answers them for a Full-mode Project: docs/product under its root.
vi.mock('../../src/main/ipc/docs', () => ({
  docsSource: () => Promise.resolve({ root: where.root, adrStatusLabel: undefined, productDir: ['docs', 'product'] }),
  docsHub: { topic: () => Promise.resolve(undefined) },
}))

/** Topic one: two pieces of advice decided, one waiting, and two nodes of the owner's that are no advice. */
const ROADMAP: MindMapNode[] = [
  { id: 'idea-1', kind: 'decision', text: 'Sell to small teams', from: null, advice: true, status: 'accepted', reason: 'that is who pays' },
  { id: 'idea-2', kind: 'decision', text: 'A free tier', from: 'idea-1', advice: true, status: 'rejected', reason: 'no budget for it' },
  { id: 'idea-3', kind: 'idea', text: 'A yearly plan', from: 'idea-1', advice: true },
  { id: 'q-1', kind: 'question', text: 'Who signs the contract?', from: 'idea-1' },
  { id: 'd-1', kind: 'decision', text: 'The owner decides alone', from: 'q-1', status: 'accepted', reason: 'stated by the owner' },
]

/** Topic two: an objection of the advisor accepted, another rejected, advice: false is no advice. */
const PRICING: MindMapNode[] = [
  { id: 'o-1', kind: 'decision', text: 'Prices are too low', from: null, advice: true, status: 'accepted', reason: 'agreed', source: 'docs/pricing.md' },
  { id: 'o-2', kind: 'objection', text: 'The trial is too short', from: null, advice: true, source: 'docs/pricing.md' },
  { id: 'n-1', kind: 'idea', text: 'Ask three customers', from: null, advice: false },
]

const REVIEW = [
  '# Critic: worfy-pricing — 2026-11-08',
  '',
  'Plan: `.scratch/worfy-pricing/spec.md`',
  'Verdict: Reorder — ticket 03 needs 05',
  '',
  '## Objections',
  '',
  '### 1. Ticket 03 needs the price table of 05',
  '',
  'It reads a table nobody wrote yet.',
  '',
  'Fact: `.scratch/worfy-pricing/issues/03-checkout.md:12`',
  '',
  'Owner decision: accepted — I missed that',
  '',
  '### 2. The epic duplicates worfy-billing',
  '',
  'Fact: `.scratch/worfy-billing/spec.md:4`',
  '',
  'Owner decision: rejected — billing was dropped',
  '',
  '### 3. No test for the refund path',
  '',
  'Fact: `.scratch/worfy-pricing/issues/04-refund.md:20`',
  '',
  'Owner decision:',
  '',
  '## Alternative',
  '',
  'Ship 05 first.',
  '',
  '```markdown',
  'Owner decision: accepted — a line inside a code block is no decision',
  '```',
  '',
].join('\n')

const topic = (name: string, nodes: MindMapNode[], errors: { file: string; id: string | null; message: string }[] = []) => ({ name, nodes, errors })

describe('adviceShare', () => {
  it('counts the advice of two topics and one review: accepted, rejected and pending; nodes without advice and a broken file are not counted', () => {
    const share = adviceShare({
      topics: [topic('roadmap', ROADMAP), topic('pricing', PRICING), topic('broken', [], [{ file: 'mind-map.json', id: null, message: 'not valid JSON: Unexpected token' }])],
      reviews: [
        { file: 'worfy-pricing-2026-11-08.md', text: REVIEW },
        { file: 'unreadable-2026-11-08.md', error: 'EACCES: permission denied' },
      ],
    })
    expect(share.mindMap).toEqual({ accepted: 2, rejected: 1, pending: 2 })
    expect(share.critic).toEqual({ accepted: 1, rejected: 1, pending: 1 })
    expect(share.skipped).toEqual([
      { file: 'broken/mind-map.json', message: 'not valid JSON: Unexpected token' },
      { file: 'critic/unreadable-2026-11-08.md', message: 'EACCES: permission denied' },
    ])
    expect(adviceTotals(share)).toEqual({ accepted: 3, rejected: 2, pending: 3, decided: 5 })
  })

  it('an error of map.md or of a Ticket of the map leaves the Mind map counted', () => {
    const share = adviceShare({ topics: [topic('roadmap', ROADMAP, [{ file: 'map.md', id: null, message: 'the topic has no map.md' }])], reviews: [] })
    expect(share.mindMap).toEqual({ accepted: 1, rejected: 1, pending: 1 })
    expect(share.skipped).toEqual([])
  })

  it('a review of verdict Keep with no objection, or a file that is no review at all, counts nothing and breaks nothing', () => {
    expect(criticAdvice('# Critic: x — 2026-11-08\n\nVerdict: Keep — sound\n\n## Objections\n\nNone.\n')).toEqual({ accepted: 0, rejected: 0, pending: 0 })
    expect(criticAdvice('\u0000\u0001 binary garbage {"version": 1}')).toEqual({ accepted: 0, rejected: 0, pending: 0 })
    expect(criticAdvice('Owner decision: maybe later\r\nOwner decision: Accepted — fine\r\n')).toEqual({ accepted: 1, rejected: 0, pending: 1 })
  })

  it('a Decision that is no advice is the owner’s own, not counted; advice decided later counts by its current status', () => {
    expect(mindMapAdvice([{ id: 'd', kind: 'decision', text: 'x', from: null, status: 'rejected', reason: 'r' }])).toEqual({ accepted: 0, rejected: 0, pending: 0 })
    const changed: MindMapNode = {
      id: 'idea-2',
      kind: 'decision',
      text: 'A free tier',
      from: null,
      advice: true,
      status: 'accepted',
      reason: 'budget found',
      history: [{ status: 'rejected', reason: 'no budget for it' }],
    }
    expect(mindMapAdvice([changed])).toEqual({ accepted: 1, rejected: 0, pending: 0 })
  })
})

type Listener = (event: IpcMainInvokeEvent, input: unknown) => unknown

describe('product.share', () => {
  let scratch: string
  let handlers: Map<string, Listener>

  const product = () => join(where.root, 'docs', 'product')
  const writeMap = (name: string, nodes: MindMapNode[] | string) => {
    mkdirSync(join(product(), name), { recursive: true })
    writeFileSync(join(product(), name, 'map.md'), `# ${name}\n`)
    writeFileSync(join(product(), name, 'mind-map.json'), typeof nodes === 'string' ? nodes : `${JSON.stringify({ version: 1, nodes }, null, 2)}\n`)
  }
  /** Every file under the root with its size and modification time, to show that nothing was written. */
  const snapshot = (): Record<string, string> => {
    const files: Record<string, string> = {}
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else files[relative(where.root, path)] = `${statSync(path).mtimeMs}:${readFileSync(path, 'utf8')}`
      }
    }
    walk(where.root)
    return files
  }

  async function call(input: unknown): Promise<IpcResult<AdviceShare>> {
    const listener = handlers.get(`${IPC_CHANNEL_PREFIX}product.share`)
    if (!listener) throw new Error('no handler for product.share')
    const event = { senderFrame: { url: APP_URL }, sender: { id: 1 } } as unknown as IpcMainInvokeEvent
    return (await listener(event, input)) as IpcResult<AdviceShare>
  }

  beforeEach(async () => {
    scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-product-share-')))
    where.root = join(scratch, 'repo')
    mkdirSync(where.root, { recursive: true })
    handlers = new Map()
    const { registerIpc, appUrlMatcher } = await import('../../src/main/ipc/index')
    const module = (await import('../../src/main/ipc/product')).default
    await registerIpc({ handle: (channel, listener) => handlers.set(channel, listener as Listener) }, { modules: { './product.ts': () => Promise.resolve(module) }, isTrustedSender: appUrlMatcher({ indexHtml: INDEX_HTML }) })
  })

  afterEach(() => removeTestTree(scratch))

  it('reads every topic and every review of the Project’s Product Session folder; a broken mind-map.json is named, not fatal; nothing is written', async () => {
    writeMap('roadmap', ROADMAP)
    writeMap('pricing', PRICING)
    writeMap('broken', '{ "version": 1, "nodes": [')
    mkdirSync(join(product(), 'critic'), { recursive: true })
    writeFileSync(join(product(), 'critic', 'worfy-pricing-2026-11-08.md'), REVIEW)
    writeFileSync(join(product(), 'critic', 'notes.txt'), 'Owner decision: accepted — not a review file')
    writeFileSync(join(product(), 'README.md'), 'Owner decision: accepted — not a topic')
    const before = snapshot()

    const result = await call({ projectId: 'p1' })
    expect(result.ok).toBe(true)
    const share = (result as { ok: true; value: AdviceShare }).value
    expect(share.mindMap).toEqual({ accepted: 2, rejected: 1, pending: 2 })
    expect(share.critic).toEqual({ accepted: 1, rejected: 1, pending: 1 })
    expect(share.skipped.map((each) => each.file)).toEqual(['broken/mind-map.json'])
    expect(snapshot()).toEqual(before)
  })

  it('a Project without a Product Session folder has no advice yet', async () => {
    const result = await call({ projectId: 'p1' })
    expect(result).toEqual({ ok: true, value: { mindMap: { accepted: 0, rejected: 0, pending: 0 }, critic: { accepted: 0, rejected: 0, pending: 0 }, skipped: [] } })
  })

  it('answers the files as they are now: a decision written after the first answer is in the next one', async () => {
    writeMap('pricing', PRICING)
    expect(((await call({ projectId: 'p1' })) as { ok: true; value: AdviceShare }).value.mindMap).toEqual({ accepted: 1, rejected: 0, pending: 1 })
    writeMap('pricing', PRICING.map((node) => (node.id === 'o-2' ? { ...node, kind: 'decision', status: 'rejected', reason: 'two weeks is enough' } : node)))
    expect(((await call({ projectId: 'p1' })) as { ok: true; value: AdviceShare }).value.mindMap).toEqual({ accepted: 1, rejected: 1, pending: 0 })
  })
})

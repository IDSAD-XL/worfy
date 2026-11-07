// The documents' watcher follows the Product Session folder (ADR-0101; Epic worfy-product-session,
// ticket 05) over real folders: a change of a topic's files reports that topic, read again, after the
// quiet period; other paths report nothing; HANDOFF.md and the ADRs are not read again for it. Runs on
// every system: the watch is Node's fs.watch, FSEvents on macOS, ReadDirectoryChangesW on Windows.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocsHub, DocsWatcher, productPathOf, type Docs, type DocsSubscriber } from '../../src/main/docs/watch'
import type { ProductTopic } from '../../src/main/product/topic'
import type { ProductTopicChange } from '../../src/shared/ipc/product'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

const pause = (time: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, time))

/** A Mind map with one idea whose text is `text`. */
const mindMap = (text: string): string => JSON.stringify({ version: 1, nodes: [{ id: 'a', kind: 'idea', text, from: null }] })

/** The text of the first node of the last state reported for `name`; null when that state says the topic is gone. */
const lastText = (events: { name: string; topic: ProductTopic | null }[], name: string): string | null | undefined => {
  const last = events.filter((event) => event.name === name).at(-1)
  if (last === undefined) return undefined
  return last.topic === null ? null : (last.topic.nodes[0]?.text ?? '')
}

/** The time the event stream of a new watch takes to start; a change before it may not be reported. */
const STARTED_MS = 600

let dir: string
let root: string
const watchers: DocsWatcher[] = []
const hubs: DocsHub[] = []

beforeEach(() => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-product-watch-')))
  root = join(dir, 'project')
  mkdirSync(join(root, 'docs', 'adr'), { recursive: true })
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'HANDOFF.md'), '# handoff\n')
  writeFileSync(join(root, 'docs', 'adr', '0001-first.md'), '# First\n\nДата: 2026-10-18. Статус: принят.\n')
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(watchers.splice(0).map((watcher) => watcher.close()))
  await Promise.all(hubs.splice(0).map((hub) => hub.closeAll()))
  removeTestTree(dir)
})

/** A watcher of `root` with the Product Session folder `productDir`, and what it reported. */
async function start(productDir: readonly string[], debounceMs?: number): Promise<{ watcher: DocsWatcher; events: { name: string; topic: ProductTopic | null }[]; docs: Docs[] }> {
  const events: { name: string; topic: ProductTopic | null }[] = []
  const docs: Docs[] = []
  const watcher = await DocsWatcher.start({
    root,
    productDir,
    ...(debounceMs === undefined ? {} : { debounceMs }),
    onChange: (next) => docs.push(next),
    onTopic: (name, topic) => events.push({ name, topic }),
  })
  watchers.push(watcher)
  await pause(STARTED_MS)
  return { watcher, events, docs }
}

describe('productPathOf: which paths of an event are the Product Session folder', () => {
  const FULL = ['docs', 'product']
  it('a file or folder of a topic names the topic; the folder and those above it are the folder', () => {
    expect(productPathOf(['docs', 'product', 't', 'mind-map.json'], FULL)).toEqual({ topic: 't' })
    expect(productPathOf(['docs', 'product', 't', 'issues', '01-a.md'], FULL)).toEqual({ topic: 't' })
    expect(productPathOf(['docs', 'product', 't'], FULL)).toEqual({ topic: 't' })
    expect(productPathOf(['docs', 'product'], FULL)).toBe('folder')
    expect(productPathOf(['docs'], FULL)).toBe('folder')
    expect(productPathOf(['product', 't', 'map.md'], ['product'])).toEqual({ topic: 't' })
  })
  it('any other path, the critic, and a name that is no topic name are nothing', () => {
    expect(productPathOf(['src', 'a.ts'], FULL)).toBeNull()
    expect(productPathOf(['docs', 'adr', '0001-first.md'], FULL)).toBeNull()
    expect(productPathOf(['HANDOFF.md'], FULL)).toBeNull()
    expect(productPathOf([''], FULL)).toBeNull()
    expect(productPathOf(['docs', 'product', 'critic', 'e-2026-11-07.md'], FULL)).toBeNull()
    expect(productPathOf(['docs', 'product', 'Critic', 'e-2026-11-07.md'], FULL)).toBeNull()
    expect(productPathOf(['docs', 'product', '.hidden', 'map.md'], FULL)).toBeNull()
    expect(productPathOf(['docs', 'productive', 't', 'map.md'], FULL)).toBeNull()
    expect(productPathOf(['product', 't', 'map.md'], FULL)).toBeNull()
  })
})

describe('DocsWatcher follows the Product Session folder, real folders', () => {
  it('Full mode: a write of docs/product/t/mind-map.json reports topic t as it reads now; a write of src/a.ts reports nothing; the documents are not reported again', async () => {
    mkdirSync(join(root, 'docs', 'product', 't'), { recursive: true })
    const { events, docs } = await start(['docs', 'product'])

    writeFileSync(join(root, 'docs', 'product', 't', 'mind-map.json'), mindMap('first idea'))
    await vi.waitFor(() => expect(lastText(events, 't')).toBe('first idea'), { timeout: ms(3000), interval: 20 })
    // A file being written may be read half-way once: what counts is the last report.
    expect(events.every((event) => event.name === 't')).toBe(true)
    expect(events.at(-1)!.topic?.errors.map((error) => error.file)).toEqual(['map.md'])

    const reported = events.length
    writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1\n')
    await pause(500)
    expect(events).toHaveLength(reported)
    // docs.changed for HANDOFF and the ADRs stays as it was: a change in docs/product changes neither.
    expect(docs).toEqual([])
  }, ms(20_000))

  it('Silent mode: a write under <Workflow folder>/product/t reports topic t', async () => {
    mkdirSync(join(root, 'product', 't'), { recursive: true })
    const { events } = await start(['product'])
    writeFileSync(join(root, 'product', 't', 'map.md'), '# The topic\n\n## Destination\n\nSomewhere.\n')
    await vi.waitFor(() => expect(events.at(-1)?.topic?.title).toBe('The topic'), { timeout: ms(3000), interval: 20 })
    expect(events.every((event) => event.name === 't')).toBe(true)
  }, ms(20_000))

  it('two writes of one file within the quiet period: the last report carries the second content', async () => {
    mkdirSync(join(root, 'docs', 'product', 't'), { recursive: true })
    const { events } = await start(['docs', 'product'])
    const file = join(root, 'docs', 'product', 't', 'mind-map.json')
    writeFileSync(file, mindMap('one'))
    await pause(10)
    writeFileSync(file, mindMap('two'))
    await vi.waitFor(() => expect(lastText(events, 't')).toBe('two'), { timeout: ms(3000), interval: 20 })
    // And it stays so: no read that began before the second write reports after it.
    await pause(400)
    expect(lastText(events, 't')).toBe('two')
  }, ms(20_000))

  it('the critic and a hidden folder report nothing', async () => {
    mkdirSync(join(root, 'docs', 'product', 'critic'), { recursive: true })
    const { events } = await start(['docs', 'product'])
    writeFileSync(join(root, 'docs', 'product', 'critic', 'e-2026-11-07.md'), '# Review\n')
    mkdirSync(join(root, 'docs', 'product', '.tmp'))
    writeFileSync(join(root, 'docs', 'product', '.tmp', 'x'), 'x')
    await pause(500)
    expect(events).toEqual([])
  }, ms(20_000))

  it('docs/product removed whole: the topic reports as gone once, no run of reports follows, and the folder made again is followed', async () => {
    const topic = join(root, 'docs', 'product', 't')
    mkdirSync(join(topic, 'issues'), { recursive: true })
    writeFileSync(join(topic, 'map.md'), '# T\n')
    writeFileSync(join(topic, 'issues', '01-first.md'), '# First\n\nStatus: open\n')
    writeFileSync(join(topic, 'mind-map.json'), mindMap('before'))
    const { watcher, events } = await start(['docs', 'product'])
    expect((await watcher.topic('t'))?.nodes[0]?.text).toBe('before')

    removeTestTree(join(root, 'docs', 'product'))
    await vi.waitFor(() => expect(lastText(events, 't')).toBeNull(), { timeout: ms(3000), interval: 20 })
    const gone = events.length
    // Measured for a second with the folder gone: no more reports, and no processor time spent on events.
    const before = process.cpuUsage()
    await pause(1000)
    const spent = process.cpuUsage(before)
    expect(events.length).toBe(gone)
    // Each removed file may be read half-way once; a run without end would pass any small bound.
    expect(gone).toBeLessThanOrEqual(6)
    expect((spent.user + spent.system) / 1000).toBeLessThan(300)

    mkdirSync(topic, { recursive: true })
    writeFileSync(join(topic, 'mind-map.json'), mindMap('after'))
    await vi.waitFor(() => expect(lastText(events, 't')).toBe('after'), { timeout: ms(3000), interval: 20 })
  }, ms(20_000))

  it('topic(): reads a topic now, null for one that is not there; a name that is no topic name is refused', async () => {
    mkdirSync(join(root, 'docs', 'product', 't'), { recursive: true })
    writeFileSync(join(root, 'docs', 'product', 't', 'mind-map.json'), mindMap('read'))
    const { watcher } = await start(['docs', 'product'])
    expect((await watcher.topic('t'))?.nodes.map((node) => node.text)).toEqual(['read'])
    expect(await watcher.topic('nowhere')).toBeNull()
    await expect(watcher.topic('../t')).rejects.toThrow(/not a Product Session topic name/)
    await expect(watcher.topic('critic')).rejects.toThrow(/not a Product Session topic name/)
  }, ms(20_000))
})

describe('DocsWatcher reads one topic at a time, on a stand-in watch', () => {
  it('a read that is slow does not report after the read that followed it: the last report is the newest content', async () => {
    let fire: (filename: string | null) => void = () => undefined
    const slow: { resolve: (topic: ProductTopic | null) => void }[] = []
    const reads: string[] = []
    const topicWith = (text: string): ProductTopic => ({ name: 't', folder: 'f', title: null, sections: [], tickets: [], nodes: [{ id: 'a', kind: 'idea', text, from: null }], errors: [] })
    const events: { name: string; topic: ProductTopic | null }[] = []
    const watcher = await DocsWatcher.start({
      root,
      debounceMs: 5,
      productDir: ['docs', 'product'],
      watch: (_root, onEvent) => {
        fire = onEvent
        return { close: () => undefined }
      },
      onChange: () => undefined,
      onTopic: (name, topic) => events.push({ name, topic }),
      // The first read hangs until it is let go and then gives the old content; the second gives the new one at once.
      readTopic: (_root, _dir, name) => {
        reads.push(name)
        if (reads.length === 1) return new Promise((resolve) => slow.push({ resolve }))
        return Promise.resolve(topicWith('new'))
      },
    })
    watchers.push(watcher)
    const file = join('docs', 'product', 't', 'mind-map.json')
    fire(file)
    await vi.waitFor(() => expect(reads).toHaveLength(1), { timeout: ms(1000), interval: 5 })
    fire(file)
    await pause(50)
    slow[0]!.resolve(topicWith('old'))
    await vi.waitFor(() => expect(reads).toHaveLength(2), { timeout: ms(1000), interval: 5 })
    await vi.waitFor(() => expect(lastText(events, 't')).toBe('new'), { timeout: ms(1000), interval: 5 })
    expect(events.map((event) => event.topic?.nodes[0]?.text)).toEqual(['old', 'new'])
  })
})

describe('DocsHub sends the Product Session topics to the subscribers that take them', () => {
  it('sendTopic gets the change with the Project id; topic() reads through the Project watcher, undefined for a Project not open', async () => {
    mkdirSync(join(root, 'docs', 'product', 't'), { recursive: true })
    const hub = new DocsHub()
    hubs.push(hub)
    const heard: ProductTopicChange[] = []
    const subscriber: DocsSubscriber = { id: 1, send: () => undefined, sendTopic: (change) => heard.push(change) }
    const quiet: DocsSubscriber = { id: 2, send: () => undefined }
    await hub.open('p1', root, subscriber, undefined, ['docs', 'product'])
    await hub.open('p1', root, quiet)
    await pause(STARTED_MS)
    writeFileSync(join(root, 'docs', 'product', 't', 'mind-map.json'), mindMap('hub'))
    await vi.waitFor(() => expect(heard.at(-1)?.topic?.nodes[0]?.text).toBe('hub'), { timeout: ms(3000), interval: 20 })
    expect(heard.at(-1)).toMatchObject({ projectId: 'p1', name: 't' })
    expect((await hub.topic('p1', 't'))?.nodes[0]?.text).toBe('hub')
    expect(await hub.topic('other', 't')).toBeUndefined()
  }, ms(20_000))
})

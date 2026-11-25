import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { readProductTopic } from '../../src/main/docs/watch'
import { readTopic, ticketStatus } from '../../src/main/product/topic'
import {
  MIND_MAP_FILE,
  productCriticFolder,
  productDraftsFolder,
  productFolder,
  productTopicFolder,
  isProductTopicName,
} from '../../src/shared/product/paths'
import { fakeProductSystem, reads } from './product-fake-fs'
import { removeTestTree } from '../remove'

const FIXTURE = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'product-topic')
const TOPIC = join(FIXTURE, 'docs', 'product', 'roadmap-demo')

const temporary: string[] = []
afterEach(() => {
  for (const dir of temporary.splice(0)) removeTestTree(dir)
})

/** A copy of the fixture topic in a temporary folder, to break files in. */
function topicCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'worfy-product-topic-'))
  temporary.push(dir)
  const topic = join(dir, 'roadmap-demo')
  cpSync(TOPIC, topic, { recursive: true })
  return topic
}

/** Every file under `dir` with its modification time: what a read must leave as it was. */
function snapshot(dir: string): Record<string, number> {
  const files: Record<string, number> = {}
  for (const entry of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    const path = join(dir, entry)
    files[entry] = statSync(path).mtimeMs
  }
  return files
}

describe('readTopic', () => {
  it('assembles the fixture topic: the map, its two Tickets and the Mind map', async () => {
    const before = snapshot(TOPIC)
    const topic = await readTopic(TOPIC)

    expect(topic.errors).toEqual([])
    expect(topic.name).toBe('roadmap-demo')
    expect(topic.title).toBe('Roadmap демо — карта')
    expect(topic.sections.map((section) => section.heading)).toEqual(['Destination', 'Notes', 'Decisions so far', 'Not yet specified'])
    expect(topic.sections[0]!.body).toBe('Принятый владельцем порядок Epic-ов.')
    expect(topic.sections[1]!.body).toContain('## Not a section')

    expect(topic.tickets.map(({ number, slug, title, status }) => ({ number, slug, title, status }))).toEqual([
      { number: 1, slug: 'пользователь', title: '01 — Кто пользователь', status: 'done' },
      { number: 2, slug: 'порядок-epic-ов', title: '02 — Порядок Epic-ов', status: 'claimed' },
    ])

    expect(topic.nodes.map((node) => node.id)).toEqual(['idea-1', 'q-1', 'd-1', 'o-1'])
    expect(topic.nodes[0]).toMatchObject({ from: 'ticket:02', advice: true, x: 120, y: 40 })
    expect(snapshot(TOPIC)).toEqual(before)
  })

  it('gives a topic with an error, not an exception, when mind-map.json is not JSON, and leaves the file in place', async () => {
    const topic = topicCopy()
    const file = join(topic, MIND_MAP_FILE)
    writeFileSync(file, '{ "version": 1, "nodes": [')
    const before = snapshot(topic)

    const read = await readTopic(topic)

    expect(read.nodes).toEqual([])
    expect(read.tickets).toHaveLength(2)
    expect(read.title).toBe('Roadmap демо — карта')
    expect(read.errors).toHaveLength(1)
    expect(read.errors[0]).toMatchObject({ file: MIND_MAP_FILE, id: null })
    expect(read.errors[0]!.message).toMatch(/JSON/)
    expect(snapshot(topic)).toEqual(before)
  })

  it('gives the errors of the check with their node ids, among them a from on a Ticket the map lacks', async () => {
    const topic = topicCopy()
    rmSync(join(topic, 'issues', '02-порядок-epic-ов.md'))

    const read = await readTopic(topic)

    expect(read.nodes).toEqual([])
    expect(read.errors).toHaveLength(1)
    expect(read.errors[0]).toMatchObject({ file: MIND_MAP_FILE, id: 'idea-1' })
    expect(read.errors[0]!.message).toContain('ticket:02')
  })

  it('reads a topic without a Mind map yet as one with no nodes, and names a missing map.md', async () => {
    const topic = topicCopy()
    rmSync(join(topic, MIND_MAP_FILE))
    rmSync(join(topic, 'map.md'))

    const read = await readTopic(topic)

    expect(read.nodes).toEqual([])
    expect(read.tickets).toHaveLength(2)
    expect(read.title).toBeNull()
    expect(read.errors).toEqual([{ file: 'map.md', id: null, message: expect.stringMatching(/no map\.md/) }])
  })

  it('reads a mind-map.json that starts with a UTF-8 byte order mark, as Windows editors save it', async () => {
    const topic = topicCopy()
    const file = join(topic, MIND_MAP_FILE)
    writeFileSync(file, `\uFEFF${readFileSync(file, 'utf8')}`)

    const read = await readTopic(topic)

    expect(read.errors).toEqual([])
    expect(read.nodes.map((node) => node.id)).toEqual(['idea-1', 'q-1', 'd-1', 'o-1'])
  })

  // worfy-polish ticket 146 (audit finding 79): a mind-map.json that cannot be read must not pass for
  // an empty Mind map — the writer would then overwrite the map with its one new node.
  it('names a mind-map.json it cannot read (a folder in its place) in errors, rather than reading an empty Mind map without one', async () => {
    const topic = topicCopy()
    rmSync(join(topic, MIND_MAP_FILE))
    mkdirSync(join(topic, MIND_MAP_FILE))

    const read = await readTopic(topic)

    expect(read.nodes).toEqual([])
    expect(read.tickets).toHaveLength(2)
    expect(read.errors).toEqual([{ file: MIND_MAP_FILE, id: null, message: expect.any(String) as unknown }])
  })

  it('reads a Status word it does not know as none, and a known one as itself', () => {
    expect(ticketStatus('# 03 — Pricing\n\nStatus: someword\n')).toBe('none')
    expect(ticketStatus('# 03 — Pricing\n\nStatus: blocked by 02\n')).toBe('blocked')
    expect(ticketStatus('# 03 — Pricing\n\nType: task\n')).toBe('none')
  })
})

// worfy-polish ticket 146 (audit findings 58 and 78): on Windows a symlink inside a topic folder —
// map.md, mind-map.json, issues\ or a Ticket in it — to `\\host\share\…` would make the system hand that
// host the user's credentials when the Product Session is opened, with no click. Each file is checked
// for such a link before it is read; the path rules are path.win32 and the file system is replaced,
// so this runs on any machine.
describe('readProductTopic and a link inside the topic folder that leads to another host (Windows rules)', () => {
  const ROOT = 'C:\\p\\repo'
  const DIR = ['docs', 'product']
  const FOLDER = 'C:\\p\\repo\\docs\\product\\roadmap'
  const MAP = '# Roadmap\n\n## Destination\n\nA calmer week.\n'
  const TICKET = '# 02 — Share\n\nType: task\nStatus: open\n'
  const MIND_MAP = JSON.stringify({ version: 1, nodes: [{ id: 'idea-1', kind: 'idea', text: 'Show the share', from: 'ticket:02' }] })

  it('reads a topic of local files through the calls it is given: map.md, a Ticket and mind-map.json', async () => {
    const system = fakeProductSystem({
      files: { [`${FOLDER}\\map.md`]: MAP, [`${FOLDER}\\issues\\02-share.md`]: TICKET, [`${FOLDER}\\${MIND_MAP_FILE}`]: MIND_MAP },
    })

    const topic = await readProductTopic(ROOT, DIR, 'roadmap', system.options)

    expect(topic).toMatchObject({ name: 'roadmap', folder: FOLDER, title: 'Roadmap', errors: [] })
    expect(topic?.tickets.map(({ number, status }) => ({ number, status }))).toEqual([{ number: 2, status: 'open' }])
    expect(topic?.nodes.map((node) => node.id)).toEqual(['idea-1'])
  })

  it('reads none of map.md, mind-map.json and issues\\ when each is a link to a share, and names each file in errors', async () => {
    const system = fakeProductSystem({
      files: { [`${FOLDER}\\notes.txt`]: 'the folder is there' },
      links: {
        [`${FOLDER}\\map.md`]: '\\\\evil.example\\share\\map.md',
        [`${FOLDER}\\${MIND_MAP_FILE}`]: '\\\\evil.example\\share\\mind-map.json',
        [`${FOLDER}\\issues`]: '//evil.example/share/issues',
      },
    })

    const topic = await readProductTopic(ROOT, DIR, 'roadmap', system.options)

    expect(topic).not.toBeNull()
    expect(topic?.errors.map((error) => error.file).sort()).toEqual(['issues', 'map.md', MIND_MAP_FILE])
    for (const error of topic?.errors ?? []) expect(error.message).toMatch(/another host/)
    expect(topic).toMatchObject({ title: null, sections: [], tickets: [], nodes: [] })
    // The links themselves are looked at with lstat and readlink; nothing reads a path through them.
    expect(reads(system.calls)).toEqual([`realpath ${ROOT}`, `isFolder ${FOLDER}`])
  })

  it('leaves out a Ticket that is a link to a share and names it; the other Ticket is read', async () => {
    const system = fakeProductSystem({
      files: { [`${FOLDER}\\map.md`]: MAP, [`${FOLDER}\\issues\\02-share.md`]: TICKET },
      links: { [`${FOLDER}\\issues\\03-price.md`]: '\\\\evil.example\\share\\03-price.md' },
    })

    const topic = await readProductTopic(ROOT, DIR, 'roadmap', system.options)

    expect(topic?.tickets.map((ticket) => ticket.file)).toEqual(['02-share.md'])
    expect(topic?.errors).toEqual([{ file: 'issues/03-price.md', id: null, message: expect.stringMatching(/another host/) as unknown }])
    expect(system.calls).not.toContain(`readFile ${FOLDER}\\issues\\03-price.md`)
  })
})

describe('product paths', () => {
  it('puts the Product Session folder in docs/product in Full mode and in the Workflow folder in Silent mode', () => {
    const full = productFolder({ mode: 'full', root: '/work/app', workflowFolder: '/work/app' })
    const silent = productFolder({ mode: 'silent', root: '/work/app', workflowFolder: '/flows/app' })
    expect(full).toBe('/work/app/docs/product')
    expect(silent).toBe('/flows/app/product')
    expect(full).not.toBe(silent)
  })

  it('keeps the separator of a Windows root', () => {
    expect(productFolder({ mode: 'full', root: 'C:\\work\\app\\', workflowFolder: 'C:\\work\\app' })).toBe('C:\\work\\app\\docs\\product')
    expect(productFolder({ mode: 'silent', root: 'C:/work/app', workflowFolder: 'C:/flows/app' })).toBe('C:/flows/app/product')
  })

  it('places topics, drafts and the critic folder under the Product Session folder', () => {
    const folder = '/work/app/docs/product'
    expect(productTopicFolder(folder, 'roadmap-demo')).toBe('/work/app/docs/product/roadmap-demo')
    expect(productDraftsFolder(productTopicFolder(folder, 'roadmap-demo'))).toBe('/work/app/docs/product/roadmap-demo/drafts')
    expect(productCriticFolder(folder)).toBe('/work/app/docs/product/critic')
  })

  it('refuses a topic name that leaves the folder, takes the critic folder in any case, or is reserved on Windows', () => {
    const reserved = ['critic', 'Critic', 'CRITIC', 'CON', 'con', 'Nul', 'aux.md', 'PRN', 'COM1', 'lpt9.txt', 'topic.', 'topic ']
    for (const bad of ['..', '.', '', 'a/b', 'a\\b', '.hidden', ...reserved]) {
      expect(isProductTopicName(bad)).toBe(false)
      expect(() => productTopicFolder('/p', bad)).toThrow()
    }
    for (const good of ['roadmap-demo', 'roadmap_2026', 'v1.2', 'дорожная-карта', 'console', 'com10', 'critics', 'nul-check']) expect(isProductTopicName(good)).toBe(true)
  })
})

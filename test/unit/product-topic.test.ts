import { cpSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { readTopic } from '../../src/main/product/topic'
import {
  MIND_MAP_FILE,
  productCriticFolder,
  productDraftsFolder,
  productFolder,
  productTopicFolder,
  isProductTopicName,
} from '../../src/shared/product/paths'
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

  it('refuses a topic name that leaves the folder or takes the critic folder', () => {
    for (const bad of ['..', '.', '', 'a/b', 'a\\b', 'critic', '.hidden']) {
      expect(isProductTopicName(bad)).toBe(false)
      expect(() => productTopicFolder('/p', bad)).toThrow()
    }
    for (const good of ['roadmap-demo', 'roadmap_2026', 'v1.2', 'дорожная-карта']) expect(isProductTopicName(good)).toBe(true)
  })
})

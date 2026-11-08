import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp } from './helpers'

// A Product Session's Mind map and chat together (worfy-product-session ticket 09), against the built
// app on the fake agent (WORFY_AGENT=fake, set by launchApp). The script
// test/fixtures/agent-scripts/product-mind-map.jsonl plays one turn: a `mind_map_add` call of topic
// `roadmap`, its answer (the node as written) and the advisor's message. The fake agent plays SDK
// messages and calls no MCP server, so the test writes mind-map.json as the tool would have; the
// screen draws the node from the file without a reload, and the message carries the node's chip.
// A drag of the node writes its place through `product.layout` into the file, and after a restart the
// screen draws the node at that place.
// A temporary WORFY_CLAUDE_HOME stands in for ~/.claude.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const TOPIC = 'roadmap'
const NODE = { id: 'n-teams', kind: 'idea', text: 'Sell to small teams', from: null, advice: true, message: '00000000-0000-4000-8000-000000000903' }

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }
type SavedNode = { id: string; kind: string; data: { kind?: string } }
type MindMapFile = { version: number; nodes: (typeof NODE & { x?: number; y?: number })[] }

let scratch: string
let dataDir: string
let claudeHome: string
let projectPath: string
let mapFile: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-product-map-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  projectPath = join(scratch, 'alpha')
  const topicDir = join(projectPath, 'docs', 'product', TOPIC)
  mapFile = join(topicDir, 'mind-map.json')
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  mkdirSync(topicDir, { recursive: true })
  writeFileSync(join(topicDir, 'map.md'), '# Roadmap of alpha\n\n## Destination\n\nA calmer week.\n')
  writeFileSync(mapFile, `${JSON.stringify({ version: 1, nodes: [] }, null, 2)}\n`)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 20, y: 40, zoom: 0.6 } }))
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: projectPath }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const readMap = (): MindMapFile => JSON.parse(readFileSync(mapFile, 'utf8')) as MindMapFile

const sessionView = (window: Page): Locator => window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')

/** The node's place as React Flow draws it, from its wrapper's transform. */
async function drawnPlace(node: Locator): Promise<{ x: number; y: number }> {
  const transform = await node.locator('xpath=ancestor::div[contains(@class, "react-flow__node")][1]').evaluate((element) => (element as unknown as { style: { transform: string } }).style.transform)
  const match = /translate\((-?[\d.]+)px, ?(-?[\d.]+)px\)/.exec(transform)
  if (match === null) throw new Error(`no place in ${transform}`)
  return { x: Number(match[1]), y: Number(match[2]) }
}

test('the advisor’s mind_map_add shows its node without a reload and a chip under the message; a dragged node keeps its place after a restart', async () => {
  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'product-mind-map' }
  // What the first start leaves for the second: the Product Session's Node and the place written.
  const seen = { nodeId: '', written: { x: 0, y: 0 } }
  const first = await launchApp({ env })
  try {
    const { window } = first
    await canvasReady(first, { size: { width: 1400, height: 900 }, visible: [window.getByTestId('orchestrator-node')] })

    await window.keyboard.press('ControlOrMeta+k')
    await window.getByTestId('palette-input').fill('new product session')
    await expect(window.locator('[data-testid="palette-option"][data-command="new:product-session"]')).toHaveAttribute('data-active', 'true')
    await window.keyboard.press('Enter')
    const view = sessionView(window)
    await expect(view).toBeVisible()
    seen.nodeId = (await view.getAttribute('data-node-id')) ?? ''
    expect(seen.nodeId).not.toBe('')
    const map = view.getByTestId('product-session-map')
    await expect(map.getByTestId('product-session-map-empty')).toBeVisible()

    const field = view.getByRole('textbox', { name: /^Message / })
    await expect(field).toBeEnabled()
    await field.fill('What could we sell?')
    await field.press('Enter')
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(1)
    await expect(view.getByTestId('transcript-text').last()).toContainText('One idea on the map')

    // What the tool writes; the fake agent called none.
    writeFileSync(mapFile, `${JSON.stringify({ version: 1, nodes: [NODE] }, null, 2)}\n`)
    const node = map.locator(`[data-testid="mind-node"][data-id="${NODE.id}"]`)
    await expect(node).toBeVisible()
    await expect(node).toContainText(NODE.text)

    // The chip under the advisor's message names the node; a click selects it, the card opens.
    const chip = view.locator(`[data-testid="node-chip"][data-id="${NODE.id}"]`)
    await expect(chip).toBeVisible()
    await expect(chip).toContainText(NODE.text)
    await chip.hover()
    await expect(node).toHaveAttribute('data-lit', 'true')
    await chip.click()
    const card = map.getByRole('region', { name: 'Node' })
    await expect(card).toContainText(NODE.text)
    await expect(card).toContainText('To change this node, ask the advisor in the chat.')
    await expect(card.locator('input, textarea, select, [contenteditable]')).toHaveCount(0)
    await card.getByRole('button', { name: 'Close the card' }).click()

    // A drag with the mouse; let go, main writes the place into the file.
    const before = await drawnPlace(node)
    const box = (await node.boundingBox())!
    await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await window.mouse.down()
    await window.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 })
    await window.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 80, { steps: 8 })
    await window.mouse.up()
    await expect.poll(() => typeof readMap().nodes[0]?.x).toBe('number')
    const [moved] = readMap().nodes
    const written = { x: moved!.x!, y: moved!.y! }
    seen.written = written
    expect(written.x).toBeGreaterThan(before.x)
    expect(written.y).toBeGreaterThan(before.y)
    // Only the place changed: the meaning of the node is as the tool wrote it.
    expect(moved).toEqual({ ...NODE, ...written })
    await expect.poll(() => drawnPlace(node)).toEqual(written)
  } finally {
    await first.close()
  }

  // After a restart the place is in the file and the screen draws the node there. The Session of the first
  // start has ended (a finished Session opens read-only, without its Mind map), so a new Product Session
  // shows the topic once its folder changes: an edit of the topic's map.md, as the advisor would make.
  const second = await launchApp({ env })
  try {
    const { window } = second
    await canvasReady(second, { size: { width: 1400, height: 900 }, visible: [window.getByTestId('orchestrator-node')] })
    expect(readMap().nodes).toEqual([{ ...NODE, ...seen.written }])
    await window.keyboard.press('ControlOrMeta+k')
    await window.getByTestId('palette-input').fill('new product session')
    await expect(window.locator('[data-testid="palette-option"][data-command="new:product-session"]')).toHaveAttribute('data-active', 'true')
    await window.keyboard.press('Enter')
    const view = sessionView(window)
    await expect(view).toBeVisible()
    await expect(view).not.toHaveAttribute('data-node-id', seen.nodeId)
    await expect(view.getByTestId('product-session-map-empty')).toBeVisible()
    writeFileSync(join(projectPath, 'docs', 'product', TOPIC, 'map.md'), '# Roadmap of alpha\n\n## Destination\n\nA calmer week, with a map.\n')
    const node = view.getByTestId('product-session-map').locator(`[data-testid="mind-node"][data-id="${NODE.id}"]`)
    await expect(node).toBeVisible()
    await expect.poll(() => drawnPlace(node)).toEqual(seen.written)
    // Both Product Sessions are on the Canvas: the first start's and this one.
    const nodes = await window.evaluate(async (projectId) => {
      const bridge = (globalThis as unknown as { worfy: Bridge }).worfy
      const result = await bridge.invoke('layout.get', { projectId })
      return ((result.value as { layout: { nodes: SavedNode[] } } | undefined)?.layout.nodes ?? []).filter((each) => each.kind === 'session' && each.data.kind === 'product')
    }, PROJECT)
    expect(nodes.map((each) => each.id)).toContain(seen.nodeId)
    expect(nodes).toHaveLength(2)
  } finally {
    await second.close()
  }
  // worfy wrote nothing into the stand-in for ~/.claude beyond what was there (ADR-0005).
  expect(readdirSync(join(claudeHome, 'sessions'))).toEqual([])
})

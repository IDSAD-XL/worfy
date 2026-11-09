import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp } from './helpers'

// A Product Session's Mind map and chat together (worfy-product-session ticket 09), against the built
// app on the fake agent (WORFY_AGENT=fake, set by launchApp). The script
// test/fixtures/agent-scripts/product-mind-map.jsonl plays one turn: the advisor's message, then a
// `mind_map_add` call of topic `roadmap` and its answer (the node as written). The fake agent plays SDK
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
type MindMapFile = { version: number; nodes: (typeof NODE & { x?: number; y?: number; placed?: number })[] }

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
    // The chat draws the conversation only (ticket 19): the turn has ended once the answer is there and
    // «Advisor is thinking» has gone; neither the call nor «Turn finished» is drawn.
    await expect(view.getByTestId('transcript-text').last()).toContainText('One idea on the map')
    await expect(view.getByTestId('session-state')).toHaveText('idle')
    await expect(view.getByTestId('product-thinking')).toHaveCount(0)
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(0)
    await expect(view.getByTestId('tool-call')).toHaveCount(0)
    await expect(view.getByTestId('product-chat-head')).toContainText('Conversation with the advisor')

    // What the tool writes; the fake agent called none.
    writeFileSync(mapFile, `${JSON.stringify({ version: 1, nodes: [NODE] }, null, 2)}\n`)
    const node = map.locator(`[data-testid="mind-node"][data-id="${NODE.id}"]`)
    await expect(node).toBeVisible()
    await expect(node).toContainText(NODE.text)

    // The chip under the advisor's message names the node; a click selects it, the card opens.
    const chip = view.locator(`[data-testid="node-chip"][data-id="${NODE.id}"]`)
    await expect(chip).toBeVisible()
    await expect(chip).toContainText(NODE.text)
    // The pointer on the message lights its node too.
    await view.getByTestId('transcript-text').last().hover()
    await expect(node).toHaveAttribute('data-lit', 'true')
    await chip.hover()
    await expect(node).toHaveAttribute('data-lit', 'true')
    await chip.click()
    const card = map.getByRole('region', { name: 'Node' })
    await expect(card).toContainText(NODE.text)
    await expect(card).toContainText('To change this node, ask the advisor in the chat.')
    await expect(card.locator('input, textarea, select, [contenteditable]')).toHaveCount(0)
    await card.getByRole('button', { name: 'Close the card' }).click()

    // The agents list widens its column to 300 px and the chat narrows: nothing lies over the chat (ticket 22).
    const chat = view.locator('section.w-session__main')
    const column = view.getByTestId('product-agents')
    const closed = { chat: (await chat.boundingBox())!.width, column: (await column.boundingBox())!.width }
    expect(Math.round(closed.column)).toBe(40)
    await view.getByTestId('product-agents-toggle').click()
    const panel = view.getByTestId('product-agents-panel')
    await expect(panel).toBeVisible()
    await expect.poll(async () => Math.round((await column.boundingBox())!.width)).toBe(300)
    const [chatBox, panelBox] = [(await chat.boundingBox())!, (await panel.boundingBox())!]
    expect(chatBox.width).toBeLessThan(closed.chat)
    expect(chatBox.x + chatBox.width).toBeLessThanOrEqual(panelBox.x + 1)
    await view.getByTestId('product-agents-close').click()
    await expect(panel).toHaveCount(0)
    await expect.poll(async () => Math.round((await column.boundingBox())!.width)).toBe(40)

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
    expect(moved).toEqual({ ...NODE, ...written, placed: 2 })
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
    expect(readMap().nodes).toEqual([{ ...NODE, ...seen.written, placed: 2 }])
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

// The Mind map's size, node text and node card as the prototype has them (worfy-product-session ticket 23),
// in the dark theme with the app's real font: a long text, Russian or English, stays inside its node (the
// box is as tall as the measured text needs, up to four lines; a longer one ends in an ellipsis); the card
// opens beside its node with the kind as a pill and the whole history of an overturned Decision; when the
// window narrows the map fits again, and after a zoom by hand it keeps the owner's view. The screenshots
// go to the test's output folder.
const MESSAGE = (n: number): string => `00000000-0000-4000-8000-0000000009${String(n).padStart(2, '0')}`
const LONG_MAP = [
  { id: 'root-idea', kind: 'idea', text: 'Отдельный экран продуктовой работы: карта решений рядом с разговором', from: null, advice: true, message: MESSAGE(1) },
  { id: 'who', kind: 'question', text: 'Who decides when the advisor and the critic disagree about the scope?', from: 'root-idea', message: MESSAGE(1) },
  {
    id: 'harness-first',
    kind: 'decision',
    text: 'Сначала проверить советника в Harness, интерфейс минимальный',
    from: 'root-idea',
    status: 'rejected',
    reason: 'экран Mind map и есть суть продуктовой сессии',
    history: [{ status: 'accepted', reason: 'дешевле начать без экрана', message: MESSAGE(2) }],
    message: MESSAGE(4),
  },
  { id: 'split', kind: 'decision', text: 'Mind map 60 / чат 40, граф двигается и подсвечивает узлы сообщения', from: 'root-idea', status: 'accepted', reason: 'видно в прототипе', replaces: 'harness-first', message: MESSAGE(4) },
  { id: 'laptop', kind: 'objection', text: 'Файл в docs/product/ правит tool агента, а не владелец руками', from: 'split', source: 'docs/design/F-SPEC.md', message: MESSAGE(4) },
  { id: 'scale', kind: 'question', text: 'Как выглядит Mind map при сотне узлов и больше?', from: 'split', message: MESSAGE(4) },
  { id: 'teams', kind: 'idea', text: 'Команда на большом проекте получает свою карту позже', from: 'laptop', message: MESSAGE(4) },
  {
    id: 'very-long',
    kind: 'idea',
    text: 'Очень длинный текст узла, который не помещается даже в четыре строки: советник предлагает, критик возражает, владелец решает, а карта показывает каждое решение и то, из чего оно выросло',
    from: 'scale',
    message: MESSAGE(4),
  },
]

test('the Mind map keeps long texts inside their nodes, opens the card beside its node and fits again when the window narrows', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'product-mind-map' } })
  try {
    const { app, window } = launched
    await canvasReady(launched, { size: { width: 1440, height: 900 }, visible: [window.getByTestId('orchestrator-node')] })
    await window.emulateMedia({ colorScheme: 'dark' })
    await window.keyboard.press('ControlOrMeta+k')
    await window.getByTestId('palette-input').fill('new product session')
    await expect(window.locator('[data-testid="palette-option"][data-command="new:product-session"]')).toHaveAttribute('data-active', 'true')
    await window.keyboard.press('Enter')
    const view = sessionView(window)
    await expect(view).toBeVisible()
    const map = view.getByTestId('product-session-map')
    await expect(map.getByTestId('product-session-map-empty')).toBeVisible()
    writeFileSync(mapFile, `${JSON.stringify({ version: 1, nodes: LONG_MAP }, null, 2)}\n`)
    const nodes = map.getByTestId('mind-node')
    // The topic and the eight nodes.
    await expect(nodes).toHaveCount(LONG_MAP.length + 1)
    const pane = map.locator('.w-mind__flow')
    const zoom = map.getByTestId('mind-map-zoom')

    /** Each node's box, its text's box, and whether the text is clamped (more lines than shown). */
    const texts = () =>
      nodes.evaluateAll((elements) =>
        elements.map((element) => {
          const text = element.querySelector('.w-mind__text') as unknown as {
            getBoundingClientRect(): { bottom: number; right: number }
            scrollHeight: number
            clientHeight: number
            style: { webkitLineClamp: string }
          }
          const node = element.getBoundingClientRect()
          const inner = text.getBoundingClientRect()
          return {
            id: (element as unknown as { dataset: { id: string } }).dataset.id,
            inside: inner.bottom <= node.bottom + 0.5 && inner.right <= node.right + 0.5,
            clamped: text.scrollHeight > text.clientHeight + 1,
            lines: Number(text.style.webkitLineClamp),
          }
        }),
      )
    /** Every node lies inside the map's pane. */
    const allInPane = async (): Promise<boolean> => {
      const box = (await pane.boundingBox())!
      const boxes = await nodes.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect()).map(({ left, top, right, bottom }) => ({ left, top, right, bottom })))
      return boxes.every((each) => each.left >= box.x - 1 && each.top >= box.y - 1 && each.right <= box.x + box.width + 1 && each.bottom <= box.y + box.height + 1)
    }
    const resize = async (width: number, height: number): Promise<void> => {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height), { width, height })
      await expect.poll(() => window.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)).toBe(width)
    }

    // Measured with the real font: no text runs over its node's border, and a text is cut short only where
    // it takes more than the four lines a node shows (the measure never counts fewer lines than the browser
    // draws), as the longest one does.
    await expect.poll(async () => (await texts()).filter((each) => !each.inside).map((each) => each.id)).toEqual([])
    const clamped = (await texts()).filter((each) => each.clamped)
    expect(clamped.map((each) => each.id)).toContain('very-long')
    expect(clamped.filter((each) => each.lines !== 4).map((each) => each.id)).toEqual([])
    await map.locator('[data-testid="mind-node"][data-id="very-long"]').click()
    await expect(map.getByRole('region', { name: 'Node' })).toContainText('и то, из чего оно выросло')
    await map.getByRole('button', { name: 'Close the card' }).click()
    await map.getByRole('button', { name: 'Fit' }).click()
    await expect.poll(allInPane).toBe(true)
    await view.screenshot({ path: test.info().outputPath('23-mind-map-1440.png') })

    // The card of the overturned Decision: beside its node, inside the map, the kind a struck pill, both
    // steps of its history with the overturn marked, and the message that changed it.
    const rejected = map.locator('[data-testid="mind-node"][data-id="harness-first"]')
    await rejected.click()
    const card = map.getByRole('region', { name: 'Node' })
    await expect(card).toBeVisible()
    await expect(card.getByTestId('mind-map-card-kind')).toHaveClass(/w-mind__kind-pill--rejected/)
    await expect(card.getByTestId('mind-map-card-kind')).toHaveCSS('text-decoration-line', 'line-through')
    await expect(card.locator('.w-mind__history li')).toHaveCount(2)
    await expect(card.locator('.w-mind__history li[data-overturn="true"]')).toContainText('rejected — экран Mind map')
    await expect(card.getByText('Changed by')).toBeVisible()
    const [nodeBox, cardBox, paneBox] = [(await rejected.boundingBox())!, (await card.boundingBox())!, (await pane.boundingBox())!]
    const apart = cardBox.x >= nodeBox.x + nodeBox.width || cardBox.x + cardBox.width <= nodeBox.x || cardBox.y >= nodeBox.y + nodeBox.height || cardBox.y + cardBox.height <= nodeBox.y
    expect(apart).toBe(true)
    expect(cardBox.x).toBeGreaterThanOrEqual(paneBox.x)
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(paneBox.x + paneBox.width)
    await view.screenshot({ path: test.info().outputPath('23-node-card-1440.png') })
    await card.getByRole('button', { name: 'Close the card' }).click()

    // The window narrows: the map fits again, every node still in view.
    const wide = Number.parseInt((await zoom.textContent()) ?? '')
    await resize(1160, 860)
    await expect.poll(async () => Number.parseInt((await zoom.textContent()) ?? '')).toBeLessThan(wide)
    await expect.poll(allInPane).toBe(true)
    await expect.poll(async () => (await texts()).filter((each) => !each.inside).map((each) => each.id)).toEqual([])
    await view.screenshot({ path: test.info().outputPath('23-mind-map-1160.png') })
    await map.locator('[data-testid="mind-node"][data-id="split"]').click()
    await expect(card).toBeVisible()
    await view.screenshot({ path: test.info().outputPath('23-node-card-1160.png') })
    await card.getByRole('button', { name: 'Close the card' }).click()

    // After a zoom by hand the owner's view stays when the window changes size.
    await map.getByRole('button', { name: 'Zoom in' }).click()
    const owners = await zoom.textContent()
    await resize(1440, 900)
    await window.waitForTimeout(300)
    await expect(zoom).toHaveText(owners ?? '')
  } finally {
    await launched.close()
  }
})

// The Mind map's «Graph» view laid out as the prototype's graph (worfy-product-session ticket 26), in the dark
// theme: the topic in the middle, the branches round it, no node over another, the "grew from" arrows straight
// and the `replaces` arrow a curve; «Hide rejected» and a folded branch lay it out again, still with no overlap.
// The screenshot goes to the test's output folder.
const GRAPH_MAP = [
  ...LONG_MAP,
  { id: 'price', kind: 'question', text: 'What does a team pay for the second seat?', from: null, message: MESSAGE(5) },
  { id: 'price-flat', kind: 'idea', text: 'One flat price per team', from: 'price', message: MESSAGE(5) },
  { id: 'price-seat', kind: 'decision', text: 'A price per seat, the first one free', from: 'price', status: 'accepted', reason: 'small teams start alone', message: MESSAGE(5) },
  { id: 'onboarding', kind: 'idea', text: 'A guided first topic for a new owner', from: null, message: MESSAGE(6) },
  { id: 'onboarding-risk', kind: 'objection', text: 'A guide nobody reads is worse than none', from: 'onboarding', source: 'docs/design/BRIEF.md', message: MESSAGE(6) },
]

test('the Mind map’s Graph puts the topic in the middle and its branches round it, no node over another', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'product-mind-map' } })
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1440, height: 900 }, visible: [window.getByTestId('orchestrator-node')] })
    await window.emulateMedia({ colorScheme: 'dark' })
    await window.keyboard.press('ControlOrMeta+k')
    await window.getByTestId('palette-input').fill('new product session')
    await expect(window.locator('[data-testid="palette-option"][data-command="new:product-session"]')).toHaveAttribute('data-active', 'true')
    await window.keyboard.press('Enter')
    const view = sessionView(window)
    await expect(view).toBeVisible()
    const map = view.getByTestId('product-session-map')
    await expect(map.getByTestId('product-session-map-empty')).toBeVisible()
    writeFileSync(mapFile, `${JSON.stringify({ version: 1, nodes: GRAPH_MAP }, null, 2)}\n`)
    const nodes = map.getByTestId('mind-node')
    await expect(nodes).toHaveCount(GRAPH_MAP.length + 1)
    const graphButton = map.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Graph' })
    await graphButton.click()
    await expect(graphButton).toHaveAttribute('aria-pressed', 'true')

    /** The nodes' boxes on the screen, by id. */
    const boxes = () =>
      nodes.evaluateAll((elements) =>
        elements.map((element) => {
          const { left, top, right, bottom } = element.getBoundingClientRect()
          return { id: (element as unknown as { dataset: { id: string } }).dataset.id, left, top, right, bottom }
        }),
      )
    /** The ids of the pairs of nodes whose boxes overlap. */
    const overlaps = async (): Promise<string[]> => {
      const all = await boxes()
      const pairs: string[] = []
      for (let a = 0; a < all.length; a += 1) {
        for (let b = a + 1; b < all.length; b += 1) {
          const [p, q] = [all[a]!, all[b]!]
          if (p.left < q.right - 0.5 && q.left < p.right - 0.5 && p.top < q.bottom - 0.5 && q.top < p.bottom - 0.5) pairs.push(`${p.id} × ${q.id}`)
        }
      }
      return pairs
    }
    await expect.poll(overlaps).toEqual([])

    // The topic in the middle third of the map both ways, with nodes on its left and on its right.
    const all = await boxes()
    const topicBox = all.find((each) => each.id === '@topic')!
    const [cx, cy] = [(topicBox.left + topicBox.right) / 2, (topicBox.top + topicBox.bottom) / 2]
    const [left, right] = [Math.min(...all.map((each) => each.left)), Math.max(...all.map((each) => each.right))]
    const [top, bottom] = [Math.min(...all.map((each) => each.top)), Math.max(...all.map((each) => each.bottom))]
    expect(cx).toBeGreaterThan(left + (right - left) / 3)
    expect(cx).toBeLessThan(right - (right - left) / 3)
    expect(cy).toBeGreaterThan(top + (bottom - top) / 3)
    expect(cy).toBeLessThan(bottom - (bottom - top) / 3)
    expect(all.some((each) => each.right < topicBox.left)).toBe(true)
    expect(all.some((each) => each.left > topicBox.right)).toBe(true)

    // Straight "grew from" arrows, one per node but the topic; the one `replaces` arrow a curve.
    const grew = map.locator('.react-flow__edge.w-mind__edge:not(.w-mind__edge--replaces) path.react-flow__edge-path')
    await expect(grew).toHaveCount(GRAPH_MAP.length)
    for (const d of await grew.evaluateAll((paths) => paths.map((path) => path.getAttribute('d') ?? ''))) expect(d).toMatch(/^M-?[\d.]+,-?[\d.]+ L-?[\d.]+,-?[\d.]+$/)
    await expect(map.locator('.react-flow__edge.w-mind__edge--replaces path.react-flow__edge-path')).toHaveAttribute('d', / Q/)

    const pane = map.locator('.w-mind__flow')
    const allInPane = async (): Promise<boolean> => {
      const box = (await pane.boundingBox())!
      return (await boxes()).every((each) => each.left >= box.x - 1 && each.top >= box.y - 1 && each.right <= box.x + box.width + 1 && each.bottom <= box.y + box.height + 1)
    }
    await expect.poll(allInPane).toBe(true)
    await view.screenshot({ path: test.info().outputPath('26-graph-dark.png') })

    // «Hide rejected»: the rejected Decision goes, the rest is laid out again with no overlap.
    await map.getByRole('button', { name: 'Hide rejected' }).click()
    await expect(nodes).toHaveCount(GRAPH_MAP.length)
    await expect.poll(overlaps).toEqual([])
    // A folded branch: its nodes go, the rest still apart; unfolded, they are back.
    const split = map.locator('[data-testid="mind-node"][data-id="split"]')
    await split.getByTestId('mind-node-fold').click()
    await expect(split).toHaveAttribute('data-folded', 'true')
    await expect(map.locator('[data-testid="mind-node"][data-id="laptop"]')).toHaveCount(0)
    await expect.poll(overlaps).toEqual([])
    await split.getByTestId('mind-node-fold').click()
    await expect(map.locator('[data-testid="mind-node"][data-id="laptop"]')).toHaveCount(1)
    await expect.poll(overlaps).toEqual([])
  } finally {
    await launched.close()
  }
})

// A Product Session in a narrow chat column (worfy-product-session ticket 24): the 1160-wide window with the
// agents list open leaves the chat about 240 px, as in the prototype. The heading stays on one line with the
// Vendor tag inside it; every chip stays inside the column, its text cut at the end; the map's toolbar keeps
// one row; the input field keeps a usable width; the working Critic is listed above the Idea generator that is
// done. A chip's click rings the message it stands under without moving the chat, and the node's card quotes
// that message. The fake script product-narrow.jsonl plays one turn: a mind_map_add before the answer (its
// chip under the owner's prompt), the answer, three more calls, an Idea generator that ends and a Critic that
// still works. The screenshots go to the test's output folder.
const NARROW_MESSAGE = (n: number): string => `00000000-0000-4000-8000-000000000a${String(n).padStart(2, '0')}`
const NARROW_MAP = [
  { id: 'screen', kind: 'idea', text: 'A separate product screen: the decision map next to the conversation with the advisor', from: null, advice: true, message: NARROW_MESSAGE(1) },
  { id: 'first-epic', kind: 'decision', text: 'First Epic: try the advisor in the Harness first, with a minimal screen', from: 'screen', status: 'accepted', reason: 'cheaper to start without a screen', message: NARROW_MESSAGE(11) },
  { id: 'who-decides', kind: 'question', text: 'Who decides when the advisor and the critic disagree about the scope of the first Epic?', from: 'screen', message: NARROW_MESSAGE(13) },
  { id: 'agent-writes', kind: 'objection', text: 'The product files are written by the agent tool, never by the owner by hand', from: 'first-epic', source: 'docs/design/F-SPEC.md', message: NARROW_MESSAGE(15) },
]
const NARROW_PROMPT = 'Let us plan the product screen: what goes first, and who decides when the advisor and the critic disagree?'

test('a narrow chat column keeps the heading on one line and every chip inside it; a chip rings its message and the card quotes it', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'product-narrow' } })
  try {
    const { app, window } = launched
    await canvasReady(launched, { size: { width: 1440, height: 900 }, visible: [window.getByTestId('orchestrator-node')] })
    await window.emulateMedia({ colorScheme: 'dark' })
    await window.keyboard.press('ControlOrMeta+k')
    await window.getByTestId('palette-input').fill('new product session')
    await expect(window.locator('[data-testid="palette-option"][data-command="new:product-session"]')).toHaveAttribute('data-active', 'true')
    await window.keyboard.press('Enter')
    const view = sessionView(window)
    await expect(view).toBeVisible()
    const map = view.getByTestId('product-session-map')
    await expect(map.getByTestId('product-session-map-empty')).toBeVisible()
    const field = view.getByRole('textbox', { name: /^Message / })
    await expect(field).toBeEnabled()
    await field.fill(NARROW_PROMPT)
    await field.press('Enter')
    await expect(view.getByTestId('transcript-text').last()).toContainText('Three more nodes on the map')
    await expect(view.getByTestId('session-state')).toHaveText('idle')
    // What the tools write; the fake agent called none.
    writeFileSync(mapFile, `${JSON.stringify({ version: 1, nodes: NARROW_MAP }, null, 2)}\n`)
    await expect(map.getByTestId('mind-node')).toHaveCount(NARROW_MAP.length + 1)
    const chips = view.getByTestId('node-chip')
    await expect(chips).toHaveCount(NARROW_MAP.length)
    await map.getByRole('button', { name: 'Fit' }).click()
    await view.screenshot({ path: test.info().outputPath('24-product-session-1440.png') })

    // The 1160-wide window with the agents list open.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1160, 860))
    await expect.poll(() => window.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)).toBe(1160)
    await view.getByTestId('product-agents-toggle').click()
    const panel = view.getByTestId('product-agents-panel')
    await expect(panel).toBeVisible()
    await expect.poll(async () => Math.round((await view.getByTestId('product-agents').boundingBox())!.width)).toBe(300)
    const chat = view.locator('section.w-session__main')
    const chatBox = (await chat.boundingBox())!
    expect(chatBox.width).toBeLessThan(260)

    // The heading: one line inside its 40 px bar, the words cut, the Vendor tag whole and inside the chat.
    const head = view.getByTestId('product-chat-head')
    const name = view.getByTestId('product-chat-name')
    const vendor = head.locator('.w-product__chat-vendor')
    const [headBox, nameBox, vendorBox] = [(await head.boundingBox())!, (await name.boundingBox())!, (await vendor.boundingBox())!]
    expect(Math.round(headBox.height)).toBe(40)
    expect(nameBox.height).toBeLessThan(22)
    expect(nameBox.y).toBeGreaterThanOrEqual(headBox.y)
    expect(nameBox.y + nameBox.height).toBeLessThanOrEqual(headBox.y + headBox.height)
    expect(vendorBox.height).toBeLessThan(22)
    expect(vendorBox.x + vendorBox.width).toBeLessThanOrEqual(chatBox.x + chatBox.width + 0.5)
    expect(vendorBox.x).toBeGreaterThanOrEqual(nameBox.x + nameBox.width - 0.5)
    const cutAtEnd = (element: unknown): [boolean, string] => {
      const own = element as { scrollWidth: number; clientWidth: number }
      const style = (globalThis as unknown as { getComputedStyle(of: unknown): { textOverflow: string } }).getComputedStyle(element)
      return [own.scrollWidth > own.clientWidth, style.textOverflow]
    }
    expect(await name.evaluate(cutAtEnd)).toEqual([true, 'ellipsis'])

    // Every chip inside the column, its left end in view; a text that does not fit is cut at its end.
    const chipBoxes = await chips.evaluateAll((elements) =>
      elements.map((element) => {
        type Box = { getBoundingClientRect(): { left: number; right: number }; scrollWidth: number; clientWidth: number }
        const box = element.getBoundingClientRect()
        const text = element.querySelector('.w-chips__text') as unknown as Box
        const mark = element.querySelector('.w-chips__mark') as unknown as Box
        const overflow = (globalThis as unknown as { getComputedStyle(of: unknown): { textOverflow: string } }).getComputedStyle(text).textOverflow
        return { left: box.left, right: box.right, markLeft: mark.getBoundingClientRect().left, cut: text.scrollWidth > text.clientWidth, overflow }
      }),
    )
    for (const each of chipBoxes) {
      expect(each.left).toBeGreaterThanOrEqual(chatBox.x - 0.5)
      expect(each.right).toBeLessThanOrEqual(chatBox.x + chatBox.width + 0.5)
      expect(each.markLeft).toBeGreaterThanOrEqual(each.left)
      expect(each.overflow).toBe('ellipsis')
    }
    expect(chipBoxes.filter((each) => each.cut).length).toBeGreaterThan(0)

    // The map's toolbar on one row; the input field keeps its width.
    const toolbar = map.locator('.w-mind__toolbar')
    const tops = await toolbar.evaluate((element) => [...element.children].map((child) => Math.round(child.getBoundingClientRect().top + child.getBoundingClientRect().height / 2)))
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2)
    expect((await view.getByTestId('message-input-box').boundingBox())!.width).toBeGreaterThanOrEqual(126)

    // The working Critic above the Idea generator that is done.
    await expect.poll(async () => (await panel.getByTestId('product-agent-line').allTextContents()).map((line) => line.trim())).toEqual(['Critic', 'Idea generator'])
    await view.screenshot({ path: test.info().outputPath('24-agents-list-1160.png') })

    // A chip's click selects its node, rings the message the chip stands under and leaves the chat where it is.
    // A low window first, so the chat scrolls: a scroll to the message would move it.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1160, 520))
    await expect.poll(() => window.evaluate(() => (globalThis as unknown as { innerHeight: number }).innerHeight)).toBe(520)
    const log = view.getByTestId('transcript')
    await expect.poll(() => log.evaluate((element) => element.scrollHeight > element.clientHeight + 40)).toBe(true)
    // At the end of the chat, where the chip is.
    await log.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    const chip = view.locator('[data-testid="node-chip"][data-id="first-epic"]')
    await expect(chip).toBeInViewport()
    const scrolled = await log.evaluate((element) => element.scrollTop)
    expect(scrolled).toBeGreaterThan(0)
    // The chip's message starts above the log's upper third: «Show in the chat» would scroll the log up to put it there.
    const row = log.locator('[data-item]').filter({ has: window.locator('[data-testid="node-chip"][data-id="first-epic"]') })
    const [rowTop, logTop, third] = [(await row.boundingBox())!.y, (await log.boundingBox())!.y, (await log.evaluate((element) => element.clientHeight)) / 3]
    expect(rowTop - logTop).toBeLessThan(third - 20)
    await chip.click()
    const ringed = log.locator('[data-item][data-shown]')
    await expect(ringed).toHaveCount(1)
    await expect(ringed.getByTestId('transcript-text')).toContainText('Three more nodes on the map')
    await window.waitForTimeout(300)
    expect(await log.evaluate((element) => element.scrollTop)).toBe(scrolled)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1160, 860))
    await expect.poll(() => window.evaluate(() => (globalThis as unknown as { innerHeight: number }).innerHeight)).toBe(860)
    // The card quotes the message: its number, the author and the start of the text.
    const card = map.getByRole('region', { name: 'Node' })
    await expect(card).toContainText('First Epic: try the advisor')
    await expect(card.getByRole('button', { name: 'Show the message in the chat' })).toHaveText('#2 Advisor')
    await expect(card).toContainText('#2 Advisor: “Three more nodes on the map. The advisor proposes, the cri…”')
    await view.screenshot({ path: test.info().outputPath('24-chip-and-card-1160.png') })
    // Ticket 25: closing the card takes the ring off the message, as the prototype does — by its button and by Escape.
    await card.getByRole('button', { name: 'Close the card' }).click()
    await expect(card).toHaveCount(0)
    await expect(log.locator('[data-shown]')).toHaveCount(0)
    await chip.click()
    await expect(ringed).toHaveCount(1)
    await card.getByRole('button', { name: 'Close the card' }).focus()
    await window.keyboard.press('Escape')
    await expect(card).toHaveCount(0)
    await expect(log.locator('[data-shown]')).toHaveCount(0)
    // The pointer off the chat: a message under the pointer frames its bubble, which is not the ring. The frame
    // fades out in 0.2 s; the picture waits until no bubble carries it.
    await map.getByTestId('mind-map-legend').hover()
    const framed = () =>
      log.locator('.w-pmsg__bubble').evaluateAll((bubbles) => bubbles.filter((bubble) => (globalThis as unknown as { getComputedStyle(of: unknown): { boxShadow: string } }).getComputedStyle(bubble).boxShadow !== 'none').length)
    await expect.poll(framed).toBe(0)
    await view.screenshot({ path: test.info().outputPath('25-card-closed-no-ring-1160.png') })
  } finally {
    await launched.close()
  }
})

// Ticket 28 (owner, 2026-11-09): a message sent while the advisor works waits in the Session's queue, and the
// chat shows it at once — last, dimmed, «queued» — below the running turn's output, until main delivers it
// after the turn's result; then it is an ordinary message of the chat with its number. The fake script
// product-queued.jsonl answers the first message, then holds the turn (`wait_release` "turn") until the test
// lets it go; its second turn answers the queued message. The screenshot goes to the test's output folder.
test('a message sent while the advisor works shows last in the chat as queued, and as an ordinary message once delivered', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'product-queued' } })
  try {
    const { app, window } = launched
    await canvasReady(launched, { size: { width: 1440, height: 900 }, visible: [window.getByTestId('orchestrator-node')] })
    await window.emulateMedia({ colorScheme: 'dark' })
    await window.keyboard.press('ControlOrMeta+k')
    await window.getByTestId('palette-input').fill('new product session')
    await expect(window.locator('[data-testid="palette-option"][data-command="new:product-session"]')).toHaveAttribute('data-active', 'true')
    await window.keyboard.press('Enter')
    const view = sessionView(window)
    await expect(view).toBeVisible()
    const field = view.getByRole('textbox', { name: /^Message / })
    await expect(field).toBeEnabled()
    await field.fill('What could we sell?')
    await field.press('Enter')
    await expect(view.getByTestId('transcript-text').last()).toContainText('Reading the market notes first.')
    await expect(view.getByTestId('session-state')).toHaveText('busy')

    // Sent during the turn: it waits in the queue, and the chat shows it at once, last, below «Advisor is thinking».
    await field.fill('And for solo founders?')
    await field.press('Enter')
    const log = view.getByTestId('transcript')
    const queued = view.getByTestId('product-queued')
    await expect(queued).toHaveCount(1)
    await expect(queued.getByTestId('product-queued-label')).toHaveText('queued')
    await expect(queued.getByTestId('product-message-bubble')).toHaveText('And for solo founders?')
    await expect(queued.getByTestId('product-message-number')).toHaveCount(0)
    expect(Number(await queued.evaluate((element) => (globalThis as unknown as { getComputedStyle(of: unknown): { opacity: string } }).getComputedStyle(element).opacity))).toBeLessThan(1)
    const lastIsQueued = () => log.evaluate((element) => element.lastElementChild?.querySelector('[data-testid="product-queued"]') !== null)
    expect(await lastIsQueued()).toBe(true)
    await expect(view.getByTestId('product-thinking')).toBeVisible()
    await expect(view.getByTestId('transcript-prompt')).toHaveCount(1)
    await view.screenshot({ path: test.info().outputPath('28-queued-dark.png') })

    // The turn goes on: its answer comes in above the queued message, which stays last until it is delivered.
    await app.evaluate(() => (globalThis as unknown as { worfyFakeRelease: (name: string) => void }).worfyFakeRelease('turn'))
    await expect(view.getByTestId('transcript-text').filter({ hasText: 'Sell to small teams first.' })).toHaveCount(1)
    // After the turn's result main sends it: an ordinary message with its number, answered in its own turn.
    await expect(view.getByTestId('transcript-text').last()).toContainText('Solo founders come second.')
    await expect(queued).toHaveCount(0)
    const prompts = view.getByTestId('transcript-prompt')
    await expect(prompts).toHaveCount(2)
    await expect(prompts.last().getByTestId('product-message-bubble')).toHaveText('And for solo founders?')
    await expect(prompts.last().getByTestId('product-message-number')).toHaveText('#4')
    await expect(view.getByTestId('session-state')).toHaveText('idle')
  } finally {
    await launched.close()
  }
})

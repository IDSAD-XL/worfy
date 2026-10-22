import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { chooseGitBash, WINDOWS, windowsProfileEnv } from './terminal-shell'

// The wheel over a Node (worfy-week ticket 16). Until a Node is clicked, a wheel or a two-finger
// swipe over it moves the Canvas, whatever the Node draws: a scrolling HANDOFF, a Note's textarea,
// a Card's page, a Terminal, the Orchestrator's status block. A plain click makes the Node active
// (class w-node--active); then the wheel scrolls its content, and the Canvas stays — except where
// there is nothing to scroll, as in the Orchestrator's four-line block. A pinch (Control + wheel)
// and ⌘ + wheel zoom the Canvas over any Node but an active Card, whose page takes them. Esc ends
// the activity (not in a Terminal), and so does a click on the empty plane.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'wheel-0000000a'
/** Room above the top row for the selection toolbar, which the snapshots show. */
const VIEWPORT = { x: 20, y: 60, zoom: 1 }
/** One notch of a mouse wheel; React Flow pans by half of it at zoom 1. */
const NOTCH = 120
/**
 * A small pinch out (Control + wheel): about 13% smaller each time, so every Node stays on screen
 * and the Card stays above the zoom where it stops drawing its page (CardNode LIVE_ZOOM_MIN).
 */
const PINCH = 10

const HANDOFF = ['# HANDOFF', '', ...Array.from({ length: 78 }, (_, index) => `- строка ${index + 1}`)].join('\n')
const NOTE_TEXT = Array.from({ length: 60 }, (_, index) => `note line ${index + 1}`).join('\n')

/** A Card page 3000 px tall that counts the wheels it receives in body[data-wheels]. */
const CARD_HTML = `<!doctype html><html><head><title>Tall</title><style>html,body{margin:0}body{height:3000px}</style></head>
<body data-wheels="0"><p>tall page</p><script>
window.addEventListener('wheel', () => { document.body.dataset.wheels = String(Number(document.body.dataset.wheels) + 1) }, { passive: true })
document.body.dataset.ready = 'yes'
</script></body></html>`

const base = { hidden: false, locked: false, pinned: false, tags: [] }
const NODES = [
  { id: 'handoff', kind: 'handoff', x: 0, y: 0, w: 360, h: 320, ...base, locked: true, data: {} },
  { id: 'orch', kind: 'orchestrator', x: 400, y: 0, w: 360, h: 200, ...base, locked: true, data: {} },
  { id: 'n1', kind: 'note', x: 800, y: 0, w: 300, h: 240, ...base, data: { text: NOTE_TEXT } },
  { id: 'c1', kind: 'card', x: 0, y: 360, w: 360, h: 280, ...base, data: {} },
  { id: 'term', kind: 'terminal', x: 400, y: 360, w: 560, h: 340, ...base, data: {} },
]

let scratch: string
let dataDir: string
let home: string
let launched: LaunchedApp | undefined

/** git for the fixtures, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-wheel-')))
  dataDir = join(scratch, 'data')
  home = join(scratch, 'home')
  mkdirSync(home)
  const repo = join(scratch, 'alpha')
  mkdirSync(repo)
  git(repo, 'init', '-q')
  writeFileSync(join(repo, 'HANDOFF.md'), HANDOFF)
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  const projectDir = join(dataDir, PROJECT)
  mkdirSync(join(projectDir, 'cards', 'c1'), { recursive: true })
  writeFileSync(join(projectDir, 'cards', 'c1', 'index.html'), CARD_HTML)
  // The Terminal's commands below (seq, printf, cat -v) are POSIX: on Windows the Terminal runs Git Bash.
  if (WINDOWS) chooseGitBash(projectDir)
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: repo }], activeId: PROJECT }))
  writeFileSync(join(projectDir, 'layout.json'), JSON.stringify({ nodes: NODES, viewport: VIEWPORT }))
})

test.afterEach(async () => {
  await launched?.close()
  launched = undefined
  await removeDir(scratch)
})

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }

async function invoke<T>(window: Page, channel: string, input: unknown): Promise<{ ok: boolean; value?: T; error?: string }> {
  return (await window.evaluate(
    ([name, payload]) => (globalThis as unknown as { worfy: Bridge }).worfy.invoke(name as string, payload),
    [channel, input] as const,
  )) as { ok: boolean; value?: T; error?: string }
}

const nodeElement = (window: Page, id: string) => window.locator(`.react-flow__node[data-id="${id}"]`)
const handoffBody = (window: Page) => nodeElement(window, 'handoff').getByTestId('handoff-body')
const noteText = (window: Page) => nodeElement(window, 'n1').getByRole('textbox', { name: 'Note text' })
const cardFrame = (window: Page) => window.locator('[data-card-id="c1"] iframe')
const cardPage = (window: Page) => window.frameLocator('[data-card-id="c1"] iframe').locator('body')
const terminalScreen = (window: Page) => window.getByTestId('terminal-screen')
const terminalRows = (window: Page) => terminalScreen(window).locator('.xterm-rows')
const statusBlock = (window: Page) => window.getByTestId('orchestrator-status-block')

/** Starts the app over the fixture, with the Orchestrator's status block shown and 200 lines of output in the Terminal. */
async function start(): Promise<Page> {
  launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_AGENT_SCRIPT: 'orchestrator', SHELL: '/bin/sh', HOME: home, ...windowsProfileEnv(join(scratch, 'profile')) } })
  const { window } = launched
  await expect(window.getByTestId('terminal-node')).toHaveAttribute('data-state', 'running')
  await expect(window.frameLocator('[data-card-id="c1"] iframe').locator('body[data-ready="yes"]')).toHaveCount(1)
  // The status block comes from the Orchestrator's answer (test/fixtures/agent-scripts/orchestrator.jsonl).
  const opened = await invoke<{ sessionId: string }>(window, 'orchestrator.open', { projectId: PROJECT })
  const sessionId = opened.value?.sessionId ?? ''
  expect((await invoke(window, 'agent.send', { sessionId, text: 'статус' })).error).toBeUndefined()
  await expect(statusBlock(window)).toBeVisible()
  expect(await invoke(window, 'agent.interrupt', { sessionId })).toMatchObject({ ok: true })
  expect(await invoke(window, 'terminal.input', { projectId: PROJECT, nodeId: 'term', data: `${WINDOWS ? 'unset HISTFILE; ' : ''}seq 1 200\n` })).toMatchObject({ ok: true })
  await expect.poll(() => terminalTop(window), { timeout: 10_000 }).toMatch(/^\d+$/)
  await canvasReady(launched, { size: { width: 1600, height: 1000 }, visible: NODES.map((node) => nodeElement(window, node.id)) })
  // The block holds four short lines: nothing to scroll.
  const block = await statusBlock(window).evaluate((element) => {
    const { scrollHeight, clientHeight, scrollWidth, clientWidth } = element as unknown as Record<'scrollHeight' | 'clientHeight' | 'scrollWidth' | 'clientWidth', number>
    return { scrollHeight, clientHeight, scrollWidth, clientWidth }
  })
  expect(block.scrollHeight).toBeLessThanOrEqual(block.clientHeight)
  expect(block.scrollWidth).toBeLessThanOrEqual(block.clientWidth)
  return window
}

/**
 * A click in the middle of `on` with the mouse itself: an inactive Card's iframe takes no mouse,
 * so Playwright's own click on it would wait for an element that never receives the click.
 */
async function clickOn(window: Page, on: Locator, modifiers: ('ControlOrMeta' | 'Shift')[] = []): Promise<void> {
  const found = await on.boundingBox()
  if (!found) throw new Error('nothing to click on')
  for (const key of modifiers) await window.keyboard.down(key)
  await window.mouse.click(found.x + found.width / 2, found.y + found.height / 2)
  for (const key of [...modifiers].reverse()) await window.keyboard.up(key)
}

/** A click on the empty plane, just right of and below the Note, where no Node is. */
async function clickPlane(window: Page): Promise<void> {
  const note = await nodeElement(window, 'n1').boundingBox()
  if (!note) throw new Error('no Note on screen')
  const at = { x: note.x + note.width + 60, y: note.y + note.height + 30 }
  const onPane = await window
    .locator('.react-flow__pane')
    .evaluate((pane, point) => (pane as unknown as { ownerDocument: { elementFromPoint(x: number, y: number): unknown } }).ownerDocument.elementFromPoint(point.x, point.y) === pane, at)
  expect(onPane, `the plane is empty at ${at.x},${at.y}`).toBe(true)
  await window.mouse.click(at.x, at.y)
}

/** React Flow's viewport transform on the screen. */
const viewportTransform = (window: Page): Promise<string> =>
  window.locator('.react-flow__viewport').evaluate((element) => (element as unknown as { style: { transform: string } }).style.transform)
const scaleOf = async (window: Page): Promise<number> => Number(/scale\(([\d.]+)\)/.exec(await viewportTransform(window))?.[1] ?? NaN)

const scrollTop = (locator: Locator): Promise<number> => locator.evaluate((element) => (element as unknown as { scrollTop: number }).scrollTop)
const cardWheels = async (window: Page): Promise<number> => Number(await cardPage(window).getAttribute('data-wheels'))
const cardScroll = (window: Page): Promise<number> =>
  cardPage(window).evaluate((body) => (body as unknown as { ownerDocument: { defaultView: { scrollY: number } } }).ownerDocument.defaultView.scrollY)
/** The text of the terminal's top row: what scrolling the terminal changes. xterm.js draws spaces as no-break spaces, which \s covers. */
const terminalTop = async (window: Page): Promise<string> => ((await terminalScreen(window).locator('.xterm-rows > div').first().textContent()) ?? '').replace(/\s+/g, ' ').trim()
const isActive = async (window: Page, id: string): Promise<boolean> => /\bw-node--active\b/.test((await nodeElement(window, id).getAttribute('class')) ?? '')

/** Resolves after the renderer has drawn two frames, so whatever the last event changed is on screen. */
const frames = (window: Page): Promise<void> =>
  window.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const page = globalThis as unknown as { requestAnimationFrame(cb: () => void): void }
        page.requestAnimationFrame(() => page.requestAnimationFrame(() => resolve()))
      }),
  )

/** A wheel in the middle of `over`, with the keys held. */
async function wheelOver(window: Page, over: Locator, deltaY: number, keys: string[] = []): Promise<void> {
  const found = await over.boundingBox()
  if (!found) throw new Error('nothing to wheel over')
  await window.mouse.move(found.x + found.width / 2, found.y + found.height / 2)
  for (const key of keys) await window.keyboard.down(key)
  await window.mouse.wheel(0, deltaY)
  for (const key of [...keys].reverse()) await window.keyboard.up(key)
}

/** Wheels over `over` and expects the viewport to move. */
async function expectCanvasMoves(window: Page, over: Locator, deltaY: number, keys: string[] = []): Promise<void> {
  const before = await viewportTransform(window)
  await wheelOver(window, over, deltaY, keys)
  await expect.poll(() => viewportTransform(window), { message: 'the wheel moves the Canvas' }).not.toBe(before)
}

/** Wheels over `over`, waits for `changed` to hold, and expects the viewport to have stayed. */
async function expectContentScrolls(window: Page, over: Locator, deltaY: number, changed: () => Promise<boolean>): Promise<void> {
  const before = await viewportTransform(window)
  await wheelOver(window, over, deltaY)
  await expect.poll(changed, { message: 'the wheel scrolls the content' }).toBe(true)
  await frames(window)
  expect(await viewportTransform(window)).toBe(before)
}

/**
 * Waits for the Node to be active and then for two frames: a Card's page is in another process,
 * and the window hands it the mouse only once a frame has been drawn without pointer-events: none.
 */
const expectActive = async (window: Page, id: string): Promise<void> => {
  await expect(nodeElement(window, id)).toHaveClass(/\bw-node--active\b/)
  await frames(window)
}
const expectNotActive = (window: Page, id: string) => expect(nodeElement(window, id)).not.toHaveClass(/\bw-node--active\b/)

test('before a click the wheel over HANDOFF, Note, Card and Terminal moves the Canvas; after a click it scrolls the content; over the Orchestrator it moves the Canvas both times', async () => {
  const window = await start()

  // Before a click: the Canvas moves, the content stays.
  const handoffTop = await scrollTop(handoffBody(window))
  await expectCanvasMoves(window, handoffBody(window), NOTCH)
  const noteTop = await scrollTop(noteText(window))
  await expectCanvasMoves(window, noteText(window), -NOTCH)
  await expectCanvasMoves(window, cardFrame(window), NOTCH)
  const termTop = await terminalTop(window)
  await expectCanvasMoves(window, terminalScreen(window), -NOTCH)
  await expectCanvasMoves(window, statusBlock(window), NOTCH)
  expect(await scrollTop(handoffBody(window))).toBe(handoffTop)
  expect(await scrollTop(noteText(window))).toBe(noteTop)
  expect(await cardWheels(window)).toBe(0)
  expect(await cardScroll(window)).toBe(0)
  expect(await terminalTop(window)).toBe(termTop)
  for (const node of NODES) expect(await isActive(window, node.id)).toBe(false)

  // After a click: the content scrolls, the Canvas stays.
  await clickOn(window, handoffBody(window))
  await expectActive(window, 'handoff')
  await expectContentScrolls(window, handoffBody(window), NOTCH, async () => (await scrollTop(handoffBody(window))) > handoffTop)

  await clickOn(window, noteText(window))
  await expectActive(window, 'n1')
  await expectNotActive(window, 'handoff')
  await expectContentScrolls(window, noteText(window), NOTCH, async () => (await scrollTop(noteText(window))) > noteTop)

  // The first click on a Card activates it and does not reach its page.
  await clickOn(window, cardFrame(window))
  await expectActive(window, 'c1')
  await expectContentScrolls(window, cardFrame(window), NOTCH, async () => (await cardWheels(window)) > 0 && (await cardScroll(window)) > 0)

  // After `seq` the terminal is at the bottom, so it scrolls up.
  await clickOn(window, terminalScreen(window))
  await expectActive(window, 'term')
  await expectContentScrolls(window, terminalScreen(window), -NOTCH, async () => (await terminalTop(window)) !== termTop)

  // The Orchestrator's block has nothing to scroll: the Canvas moves after a click too.
  await clickOn(window, statusBlock(window))
  await expectActive(window, 'orch')
  await expectCanvasMoves(window, statusBlock(window), NOTCH)
})

test('a pinch over active HANDOFF, Note and Terminal zooms the Canvas, over an active Card it goes to the page; ⌘ + wheel over an active Terminal zooms the Canvas', async () => {
  const window = await start()
  for (const [id, over] of [
    ['handoff', handoffBody(window)],
    ['n1', noteText(window)],
    ['term', terminalScreen(window)],
  ] as const) {
    await clickOn(window, over)
    await expectActive(window, id)
    const scale = await scaleOf(window)
    await wheelOver(window, over, PINCH, ['Control'])
    await expect.poll(() => scaleOf(window), { message: `a pinch over ${id} zooms the Canvas` }).not.toBe(scale)
  }

  // ⌘ + wheel with the keyboard focus in xterm.js. Outside macOS the key is Control (Canvas.tsx,
  // zoomActivationKeyCode), so there this is the same wheel event as the pinch above.
  await clickOn(window, terminalScreen(window))
  await expectActive(window, 'term')
  const beforeMeta = await scaleOf(window)
  await wheelOver(window, terminalScreen(window), NOTCH, ['ControlOrMeta'])
  await expect.poll(() => scaleOf(window), { message: '⌘ + wheel over an active Terminal zooms the Canvas' }).not.toBe(beforeMeta)

  await clickOn(window, cardFrame(window))
  await expectActive(window, 'c1')
  const scale = await scaleOf(window)
  const wheels = await cardWheels(window)
  await wheelOver(window, cardFrame(window), PINCH, ['Control'])
  await expect.poll(() => cardWheels(window)).toBeGreaterThan(wheels)
  await frames(window)
  expect(await scaleOf(window)).toBe(scale)
})

test('Esc ends the activity of HANDOFF and Note but not of a Terminal; a click on the empty plane ends it for every Node; then the wheel moves the Canvas again', async () => {
  const window = await start()
  for (const [id, over] of [
    ['handoff', handoffBody(window)],
    ['n1', noteText(window)],
  ] as const) {
    await clickOn(window, over)
    await expectActive(window, id)
    await window.keyboard.press('Escape')
    await expectNotActive(window, id)
    await expectCanvasMoves(window, over, NOTCH)
  }

  await clickOn(window, terminalScreen(window))
  await expectActive(window, 'term')
  await window.keyboard.press('Escape')
  await frames(window)
  await expectActive(window, 'term')

  for (const [id, over] of [
    ['term', terminalScreen(window)],
    ['handoff', handoffBody(window)],
    ['n1', noteText(window)],
    ['c1', cardFrame(window)],
  ] as const) {
    await clickOn(window, over)
    await expectActive(window, id)
    await clickPlane(window)
    await expectNotActive(window, id)
    await expectCanvasMoves(window, over, id === 'term' ? -NOTCH : NOTCH)
  }
})

test('a Terminal running a program in the alternate screen gets no arrow keys from the wheel until it is active', async () => {
  const window = await start()
  await clickOn(window, terminalScreen(window))
  await window.keyboard.type("printf '\\033[?1049h'; cat -v")
  await window.keyboard.press('Enter')
  // In the alternate screen the earlier output is gone.
  await expect.poll(() => terminalRows(window).innerText(), { timeout: 10_000 }).not.toMatch(/\b200\b/)
  await clickPlane(window)
  await expectNotActive(window, 'term')

  await expectCanvasMoves(window, terminalScreen(window), -NOTCH)
  await expectCanvasMoves(window, terminalScreen(window), NOTCH)

  // Typed once the Terminal is active, a line with a mark reaches the program after anything the
  // wheel sent it before: cat -v prints the line it reads, every arrow key in it as `^[[A`, so once
  // the mark is on the screen twice (the echo and cat's copy) there is no arrow key in it. The
  // test reads cat's copy, not the echo: the echo shows `^[[A` on macOS (echoctl), but the console
  // of Windows echoes ESC[A as it is, and xterm.js moves the cursor up instead of printing it.
  await clickOn(window, terminalScreen(window))
  await expectActive(window, 'term')
  await window.keyboard.type('MARK')
  await window.keyboard.press('Enter')
  await expect.poll(async () => (await terminalRows(window).innerText()).split('MARK').length - 1, { timeout: 5_000 }).toBeGreaterThanOrEqual(2)
  expect(await terminalRows(window).innerText()).not.toMatch(/\^\[\[[AB]/)

  await wheelOver(window, terminalScreen(window), -NOTCH)
  await window.keyboard.press('Enter')
  await expect.poll(() => terminalRows(window).innerText(), { timeout: 5_000 }).toMatch(/\^\[\[A/)
  await window.keyboard.press('Control+C')
})

test('in Focus mode the HANDOFF body in its tile scrolls with the wheel', async () => {
  const window = await start()
  await clickOn(window, handoffBody(window))
  await expect(nodeElement(window, 'handoff')).toHaveClass(/\bselected\b/)
  await window.keyboard.press('ControlOrMeta+Enter')
  const focus = window.getByTestId('focus-mode')
  await expect(focus).toBeVisible()
  const body = focus.getByTestId('handoff-body')
  const before = await scrollTop(body)
  await wheelOver(window, body, NOTCH)
  await expect.poll(() => scrollTop(body)).toBeGreaterThan(before)
})

test('snapshots: the active Node with its 2 px ring and a Node selected without a click, in both themes', async () => {
  const window = await start()

  await clickOn(window, handoffBody(window))
  await expectActive(window, 'handoff')
  await snapshotThemes(window, 'wheel-active-node')

  // Selected by a ⌘-click: selected, not active, the 1 px ring as before.
  await clickPlane(window)
  await clickOn(window, handoffBody(window), ['ControlOrMeta'])
  await expect(nodeElement(window, 'handoff')).toHaveClass(/\bselected\b/)
  await expectNotActive(window, 'handoff')
  await snapshotThemes(window, 'wheel-selected-node')
})

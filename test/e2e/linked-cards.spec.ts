// Cards of a Linked machine on two built worfy (worfy-link ticket 10; ADR-0052, ADR-0053). A and B
// are linked, and both list one folder as a Project: the same Project id, the same project label,
// and a Card `c1` in each, with another <title>. A shows the Card of B at
// worfy-card://c1.<project label>.<machine label of B>/ — an origin of its own, its files fetched
// from B — and its own Card at the address it always had. A Card of B in A's window asks through
// `session.ask`: the dialog is A's (the screen's Machine), the message goes to B's Orchestrator.
// Bonjour is off and the link server listens on loopback only (launchApp).
import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Frame, type Page } from '@playwright/test'
import { launchApp, linkThroughUi, machineIdOf, repoRoot, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'

test.setTimeout(180_000)

const SHARED = 'shared-0000005c'
const LABEL = '0000005c'

/** Where the snapshots of this ticket are kept in the repository (rules: .scratch/<epic>/evidence/NN-what.png). */
const EVIDENCE = join(repoRoot, '.scratch', 'worfy-link', 'evidence')

/**
 * Takes the light and dark snapshot of `window` (test-results/snapshots/10-<name>/). With
 * WORFY_EVIDENCE=1 both are also kept as the ticket's evidence `10-<name>-{light,dark}.png`; an
 * ordinary run (gate full) leaves the repository's files alone.
 */
async function evidence(window: Page, name: string): Promise<void> {
  const shots = await snapshotThemes(window, `10-${name}`)
  if (process.env.WORFY_EVIDENCE !== '1') return
  await mkdir(EVIDENCE, { recursive: true })
  await copyFile(shots.light, join(EVIDENCE, `10-${name}-light.png`))
  await copyFile(shots.dark, join(EVIDENCE, `10-${name}-dark.png`))
}

/** A Card page: its title on screen, ready once its script ran; `status` shows what session.ask answered. */
function cardHtml(title: string): string {
  return `<!doctype html><html><head><title>${title}</title><style>
body { font: 14px -apple-system, sans-serif; margin: 12px; color: #1d1d1f; background: #fff; }
h1 { font-size: 16px; margin: 0 0 8px; }
#status { color: #6e6e73; }
</style></head><body><h1 id="title">${title}</h1><p id="status">Ready</p>
<script>document.body.dataset.ready = 'yes'</script></body></html>`
}

function cardNode(id: string, x: number) {
  return { id, kind: 'card', x, y: 120, w: 320, h: 200, hidden: false, locked: false, pinned: false, tags: [], data: {} }
}

/** A data folder that lists the one shared folder as Project SHARED, with Cards c1 and c2 titled for `who`. */
function dataFolder(path: string, shared: string, who: string): string {
  mkdirSync(join(path, SHARED), { recursive: true })
  writeFileSync(join(path, 'projects.json'), JSON.stringify({ projects: [{ id: SHARED, name: 'shared', path: shared }], activeId: SHARED }))
  writeFileSync(join(path, SHARED, 'layout.json'), JSON.stringify({ nodes: [cardNode('c1', 40), cardNode('c2', 400)], viewport: { x: 0, y: 0, zoom: 1 } }))
  for (const [id, title] of [
    ['c1', `Card of ${who}`],
    ['c2', `Other of ${who}`],
  ] as const) {
    mkdirSync(join(path, SHARED, 'cards', id), { recursive: true })
    writeFileSync(join(path, SHARED, 'cards', id, 'index.html'), cardHtml(title))
  }
  return path
}

/** A folder with a committed git repository on branch main. */
function gitRepo(path: string): string {
  mkdirSync(path, { recursive: true })
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: path, env: gitEnv })
  git('init', '-q', '-b', 'main')
  writeFileSync(join(path, 'README.md'), '# shared\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return realpathSync(path)
}

async function setSharing(window: Page, on: boolean): Promise<void> {
  const toggle = window.getByRole('switch', { name: 'Linked machines can work with my Projects' })
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', String(on))
}

const group = (window: Page, selector: string) => window.locator(`[data-testid="machine-group"]${selector}`)
const projectButton = (window: Page, groupSelector: string) => group(window, groupSelector).locator(`[data-testid="project-row"][data-project-id="${SHARED}"]`).getByRole('button')

/** The frame of Card `cardId` whose address starts with `origin`, once its page ran its script. */
async function cardFrame(window: Page, cardId: string, origin: string): Promise<Frame> {
  await expect(window.frameLocator(`[data-card-id="${cardId}"] iframe`).locator('body[data-ready="yes"]')).toHaveCount(1)
  let found: Frame | undefined
  await expect.poll(() => (found = window.frames().find((candidate) => candidate.url().startsWith(`${origin}/`))) !== undefined).toBe(true)
  if (found === undefined) throw new Error(`no frame at ${origin}`)
  return found
}

/** Replaces the message box in main: it records what it was shown and answers with `button`. */
async function answerWith(app: LaunchedApp['app'], button: number): Promise<void> {
  await app.evaluate(({ dialog }, response) => {
    const store = globalThis as { shownDialogs?: unknown[] }
    store.shownDialogs ??= []
    const shown = store.shownDialogs
    dialog.showMessageBox = ((...args: unknown[]) => {
      shown.push(args.at(-1))
      return Promise.resolve({ response, checkboxChecked: false })
    }) as typeof dialog.showMessageBox
  }, button)
}

const shownDialogs = (app: LaunchedApp['app']) => app.evaluate(() => (globalThis as { shownDialogs?: unknown[] }).shownDialogs ?? []) as Promise<{ message: string; detail: string; buttons: string[] }[]>

/** Starts recording, in `window`, every message given to a Session there (a `prompt` agent event). */
async function recordPrompts(window: Page): Promise<void> {
  await window.evaluate(() => {
    const store = globalThis as unknown as { worfy: { on(channel: string, handler: (payload: unknown) => void): number }; prompts: string[] }
    store.prompts = []
    store.worfy.on('agent.event', (payload) => {
      const { event } = payload as { event: { type: string; text?: string } }
      if (event.type === 'prompt' && event.text !== undefined) store.prompts.push(event.text)
    })
  })
}
const prompts = (window: Page) => window.evaluate(() => (globalThis as unknown as { prompts: string[] }).prompts)

/** Scripts that run inside a Card frame: source text, since this file is compiled without the DOM library. */
const REACH_SCRIPT = `(() => {
  const attempt = (action) => { try { action(); return 'reached' } catch (error) { return error.name } }
  const siblings = Array.from({ length: window.parent.frames.length }, (_, index) => window.parent.frames[index]).filter((other) => other !== window)
  return {
    parentDocument: attempt(() => window.parent.document.title),
    topDocument: attempt(() => window.top.document.title),
    siblingCount: siblings.length,
    siblings: siblings.map((other) => attempt(() => other.document.title)),
  }
})()`

const fetchScript = (ownCardOfA: string, otherCardOfB: string) => `(async () => {
  const attempt = async (url) => { try { const response = await fetch(url); return 'status ' + response.status } catch (error) { return error.name } }
  return {
    ownCardOfA: await attempt(${JSON.stringify(ownCardOfA)}),
    otherCardOfB: await attempt(${JSON.stringify(otherCardOfB)}),
    file: await attempt('file:///etc/hosts'),
  }
})()`

const navigateScript = (url: string) => `location.href = ${JSON.stringify(url)}`

const showStatus = (frame: Frame, text: string) => frame.evaluate(`document.getElementById('status').textContent = ${JSON.stringify(text)}`)

test('A shows the Card of B from B, its own Card as before; a file change on B reloads the frame in A; session.ask asks on A and sends on B; Card B reaches nothing of A', async () => {
  const scratch = realpathSync(await mkdtemp(join(tmpdir(), 'worfy-link-10-cards-')))
  const shared = gitRepo(join(scratch, 'shared'))
  const aData = dataFolder(join(scratch, 'a-data'), shared, 'A')
  const bData = dataFolder(join(scratch, 'b-data'), shared, 'B')
  const a = await launchApp({ env: { WORFY_DATA_DIR: aData } })
  let b: LaunchedApp | undefined
  try {
    b = await launchApp({ env: { WORFY_DATA_DIR: bData, WORFY_AGENT_SCRIPT: 'orchestrator' } })
    await linkThroughUi(a.window, b.window)
    const bId = await machineIdOf(b.window)
    await setSharing(b.window, true)
    const ownOrigin = `worfy-card://c1.${LABEL}`

    // A's own Project: its own Card, at the address it always had.
    const ownCard = await cardFrame(a.window, 'c1', ownOrigin)
    expect(await ownCard.evaluate("document.getElementById('title').textContent")).toBe('Card of A')
    expect(await ownCard.evaluate('location.origin')).toBe(ownOrigin)
    await ownCard.evaluate("localStorage.setItem('who', 'A')")

    // A opens the Project of B: the Card of B, from B, at an address with B's machine label.
    await projectButton(a.window, `[data-machine-id="${bId}"]`).click()
    await expect(a.window).toHaveURL(new RegExp(`[?&]machine=${bId}`))
    const frameSrc = await a.window.locator('[data-card-id="c1"] iframe').getAttribute('src')
    const linkedOrigin = /^(worfy-card:\/\/c1\.0000005c\.[0-9a-f]{8})\/index\.html$/.exec(frameSrc ?? '')?.[1]
    expect(linkedOrigin, frameSrc ?? 'no src').toBeDefined()
    if (linkedOrigin === undefined) return
    let cardOfB = await cardFrame(a.window, 'c1', linkedOrigin)
    expect(await cardOfB.evaluate("document.getElementById('title').textContent")).toBe('Card of B')
    await expect(a.window.locator('[data-card-id="c1"]').getByTestId('card-title')).toHaveText('Card of B')
    expect(await cardOfB.evaluate('location.origin')).toBe(linkedOrigin)
    expect(linkedOrigin).not.toBe(ownOrigin)
    // Not the storage of the own Card with the same ids: another origin.
    expect(await cardOfB.evaluate("localStorage.getItem('who')")).toBeNull()
    // The runtime of A, put in by A: the Card API is there.
    expect(await cardOfB.evaluate('Object.keys(window.worfy).join()')).toBe('data,ask,workflow')
    await evidence(a.window, 'card-of-linked-machine')

    // A file change of the Card on B reloads the frame in A within a second.
    await a.window.waitForTimeout(500)
    const started = Date.now()
    await writeFile(join(bData, SHARED, 'cards', 'c1', 'index.html'), cardHtml('Card of B v2'))
    await expect(a.window.frameLocator('[data-card-id="c1"] iframe').locator('#title')).toHaveText('Card of B v2', { timeout: 1_000 })
    expect(Date.now() - started).toBeLessThanOrEqual(1_000)
    cardOfB = await cardFrame(a.window, 'c1', linkedOrigin)

    // session.ask from the Card of B in A's window: the dialog on A once, never on B; "Cancel" sends
    // nothing, "Send" reaches the Orchestrator of B.
    await expect(a.window.getByTestId('orchestrator-node').getByTestId('orchestrator-state')).toHaveText('idle', { timeout: 30_000 })
    await recordPrompts(b.window)
    await answerWith(b.app, 0)
    await answerWith(a.app, 1)
    expect(await cardOfB.evaluate("window.worfy.ask('Do not send this one')")).toEqual({ sent: false, canceled: true })
    await showStatus(cardOfB, 'Canceled: nothing was sent')
    const [canceled] = await shownDialogs(a.app)
    expect(canceled?.buttons).toEqual(['Send', 'Cancel'])
    expect(canceled?.message).toBe('Card "Card of B v2" wants to send a message to the Orchestrator.')
    expect(canceled?.detail).toBe('Message from Card "Card of B v2" (c1):\n\nDo not send this one')

    await answerWith(a.app, 0)
    expect(await cardOfB.evaluate("window.worfy.ask('Is ticket 07 done?')")).toEqual({ sent: true })
    await showStatus(cardOfB, 'Sent to the Orchestrator')
    expect(await shownDialogs(a.app)).toHaveLength(2)
    expect(await shownDialogs(b.app)).toEqual([])
    const bWindow = b.window
    await expect.poll(() => prompts(bWindow), { timeout: 10_000 }).toEqual(['Message from Card "Card of B v2" (c1):\n\nIs ticket 07 done?'])
    await evidence(a.window, 'card-of-linked-machine-sent')

    // Card B reaches neither the window, nor another Card, nor the own Card of A with the same ids.
    const reach = (await cardOfB.evaluate(REACH_SCRIPT)) as { parentDocument: string; topDocument: string; siblingCount: number; siblings: string[] }
    expect(reach.parentDocument).toBe('SecurityError')
    expect(reach.topDocument).toBe('SecurityError')
    expect(reach.siblingCount).toBeGreaterThan(0)
    expect(reach.siblings.every((result) => result === 'SecurityError')).toBe(true)
    const otherOfB = `worfy-card://c2.${LABEL}${linkedOrigin.slice(`worfy-card://c1.${LABEL}`.length)}/index.html`
    expect(await cardOfB.evaluate(fetchScript(`${ownOrigin}/index.html`, otherOfB))).toEqual({ ownCardOfA: 'TypeError', otherCardOfB: 'TypeError', file: 'TypeError' })
    // Navigating to the own Card of A or to another Card of B: main stops it, the Card stays.
    for (const target of [`${ownOrigin}/index.html`, otherOfB]) {
      await cardOfB.evaluate(navigateScript(target))
      await a.window.waitForTimeout(300)
      const frames = a.window.frames().filter((candidate) => candidate.url().startsWith(`${linkedOrigin}/`))
      expect(frames, target).toHaveLength(1)
      expect(await frames[0]?.evaluate("document.getElementById('title').textContent"), target).toBe('Card of B v2')
      expect(a.window.frames().some((candidate) => candidate.url().startsWith(`${ownOrigin}/`))).toBe(false)
    }

    // Back to A's own Project: its own Card again, from A, with its own storage.
    await projectButton(a.window, '[data-state="this"]').click()
    await expect(a.window).not.toHaveURL(/[?&]machine=/)
    const ownAgain = await cardFrame(a.window, 'c1', ownOrigin)
    expect(await ownAgain.evaluate("document.getElementById('title').textContent")).toBe('Card of A')
    expect(await ownAgain.evaluate("localStorage.getItem('who')")).toBe('A')
  } finally {
    await a.close()
    await b?.close()
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

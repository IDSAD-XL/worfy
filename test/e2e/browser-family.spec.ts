// A Browser in the Family of the Session that opened it, and its life with that Session, on the
// built app (worfy-browser ticket 06, ADR-0078 items 11 and 13). A Session bound to Ticket 07 (by a
// transcript that ran `ticket claim`, as family.spec.ts binds it) opens a Browser through
// `worfy-browser`; hovering the Ticket lights its Family — the Binding line, and the Browser's frame
// is marked (`data-family="lit"`) — and so does hovering the Browser; the user's Browser has none. Hide of
// the Session takes its Browser off the Canvas and closes its page; the user's Browser stays, and so
// does the user's Browser the Session drove, without «Claude is driving»; ⌘Z brings the Session back
// with its Browser at its former place (owner decision 2026-10-22). A second window of the
// Project sees the same Canvas (ADR-0053); a read-only screen of a Linked machine (ADR-0066) lights
// the Family too.
//
// The fake agent calls no MCP tool, so the test calls the tools in main as the Session would
// (globalThis.worfyBrowserTool, src/main/mcp/browser-server.ts). The page comes from a server this
// file starts on 127.0.0.1: the origin of the Browser profile «admin».
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { canvasReady, chooseLevel, closeSettings, launchApp, linkThroughUi, machineIdOf, openMachinesSettings, openSecondWindow, PROJECTS_ACCESS_LABEL, type LaunchedApp } from './helpers'
import { catScript, loginProfileWithNode } from '../harness-node'

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const EPIC = 'worfy-mvp'
const CLAIM = 'aaaaaaaa-1111-4111-8111-111111111111'
const PROFILE = 'admin-0a0a0a'
const USER_BROWSER = 'browser-user'
const DRIVEN_BROWSER = 'browser-driven'
const base = { hidden: false, locked: false, pinned: false, tags: [] }

let site: Server
let origin: string

test.beforeAll(async () => {
  site = createServer((_request, response) => void response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><title>Home</title><h1>Home</h1>'))
  await new Promise<void>((done) => site.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  await new Promise<void>((done) => site.close(() => done()))
})

/** git for the fixtures, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

/**
 * A committed repository with Ticket 07 of Epic EPIC, a Claude home whose `bin/epic-status` answers
 * it, and the transcript of Session CLAIM that claimed it; the Project's data folder with the
 * Session's Node, the user's Browsers and the Browser profile «admin», and the archive off.
 */
function fixture(scratch: string, projectId: string, extra: object[] = []): { repo: string; claudeHome: string; dataDir: string; home: string } {
  const repo = join(scratch, `${projectId}-repo`)
  const claudeHome = join(scratch, `${projectId}-claude`)
  const dataDir = join(scratch, `${projectId}-data`)
  const home = join(scratch, `${projectId}-home`)
  const issues = join(repo, '.scratch', EPIC, 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# Epic\n')
  writeFileSync(join(issues, '07-ticket-7.md'), ['# 07 — Ticket 7', '', 'Type: task', 'Status: open', 'Blocked by: —', ''].join('\n'))
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  const realRepo = realpathSync(repo)
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: [{ epic: EPIC, hasSpec: true, hasMap: false }],
      tickets: [{ epic: EPIC, num: 7, slug: 'ticket-7', title: '07 — Ticket 7', statusRaw: 'open', state: 'open', blockedRaw: '—', blockedNums: [], blockedParsed: true }],
    }),
  )
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)
  const transcripts = join(claudeHome, 'projects', realRepo.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(transcripts, { recursive: true })
  const record = (body: Record<string, unknown>, n: number): string =>
    `${JSON.stringify({ isSidechain: false, timestamp: `2026-10-05T10:00:0${n}.000Z`, uuid: `${CLAIM.slice(0, 8)}-0000-4000-8000-00000000000${n}`, sessionId: CLAIM, cwd: realRepo, gitBranch: 'main', version: '2.1.289', ...body })}\n`
  writeFileSync(
    join(transcripts, `${CLAIM}.jsonl`),
    [
      { type: 'user', message: { role: 'user', content: 'take 07' } },
      { type: 'assistant', message: { id: 'msg_1', model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_claim', name: 'Bash', input: { command: `~/.claude/bin/ticket claim ${EPIC} 07; echo "EXIT=$?"` } }] } },
      { type: 'assistant', message: { id: 'msg_2', model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: 'claimed' }] } },
    ]
      .map(record)
      .join(''),
  )
  mkdirSync(join(dataDir, projectId), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: projectId, name: projectId, path: realRepo }], activeId: projectId }))
  // The fixture transcript ends weeks ago: the 24 h archive would take the Session at once. Not this spec's subject.
  writeFileSync(join(dataDir, 'app-settings.json'), JSON.stringify({ sessionArchive: { after: 'never' } }))
  writeFileSync(join(dataDir, projectId, 'browser-profiles.json'), JSON.stringify({ profiles: [{ id: PROFILE, name: 'admin', origins: [origin], autopilot: false }] }))
  writeFileSync(
    join(dataDir, projectId, 'layout.json'),
    JSON.stringify({
      nodes: [{ id: `session:${CLAIM}`, kind: 'session', x: 760, y: 0, w: 300, h: 120, ...base, data: { sessionId: CLAIM, origin: 'external', source: 'terminal', cwd: realRepo } }, ...extra],
      viewport: { x: 20, y: 40, zoom: 0.4 },
    }),
  )
  mkdirSync(home, { recursive: true })
  // The login shell is /bin/sh with this HOME: its .profile puts node on PATH, for the epic-status stub.
  loginProfileWithNode(home)
  return { repo: realRepo, claudeHome, dataDir, home }
}

/** The user's Browser Node `id` at (x, y), as «New Browser» makes it: no `openedBy`. */
const userBrowser = (id: string, x: number, y: number) => ({ id, kind: 'browser', x, y, w: 640, h: 440, ...base, data: { profile: PROFILE } })

interface ToolAnswer {
  content: { type: string; text?: string }[]
  isError?: boolean
}

/** Calls a tool of worfy-browser in main as Session CLAIM of `projectId` would; its parsed answer. */
async function tool<T>(app: ElectronApplication, projectId: string, name: string, args: Record<string, unknown>): Promise<T> {
  await expect.poll(() => app.evaluate(() => typeof (globalThis as { worfyBrowserTool?: unknown }).worfyBrowserTool), { message: 'the Browser tools in main' }).toBe('function')
  const answer = await app.evaluate(
    (_electron, { project, session, name, args }) =>
      (globalThis as unknown as { worfyBrowserTool: (p: string, s: string, n: string, a: unknown) => Promise<unknown> }).worfyBrowserTool(project, session, name, args) as Promise<ToolAnswer>,
    { project: projectId, session: CLAIM, name, args },
  )
  const text = answer.content[0]?.text ?? ''
  expect(answer.isError, `${name}: ${text}`).toBeFalsy()
  return (text.startsWith('{') ? JSON.parse(text) : text) as T
}

/** The addresses of the Browser pages main has now, read from their guests. */
const pageUrls = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .filter((contents) => contents.getType() === 'webview' && !contents.isDestroyed())
      .map((contents) => contents.getURL()),
  )

const line = (window: Page, edgeId: string): Locator => window.getByTestId(`rf__edge-${edgeId}`).locator('path.react-flow__edge-path')
const frameOf = (window: Page, id: string): Locator => window.locator(`[data-testid="browser-frame"][data-node-id="${id}"]`)
/** The Browser frames of the window marked as in the lit Family. */
const lit = (window: Page): Locator => window.locator('[data-testid="browser-frame"][data-family="lit"]')
/** The ids of the Browser frames in the lit Family, polled until they are `ids`. */
const expectLit = (window: Page, ids: readonly string[]): Promise<void> =>
  expect.poll(() => lit(window).evaluateAll((frames) => frames.map((frame) => frame.getAttribute('data-node-id')))).toEqual(ids)

/** Puts the test's pointer on an empty corner of the Canvas, so only the test's own moves hover anything. */
async function pointerAway(window: Page): Promise<void> {
  const canvas = await window.locator('.react-flow').boundingBox()
  if (!canvas) throw new Error('no Canvas')
  await window.mouse.move(canvas.x + 8, canvas.y + canvas.height - 8)
}

test('a Session’s Browser is in its Ticket’s Family and leaves the Canvas with the Session; the user’s Browsers stay, in both windows', async () => {
  test.setTimeout(120_000)
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-browser-family-')))
  const projectId = 'demo-0000000d'
  const { claudeHome, dataDir, home } = fixture(scratch, projectId, [userBrowser(USER_BROWSER, 0, 600), userBrowser(DRIVEN_BROWSER, 0, 1200)])
  const launched: LaunchedApp = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, SHELL: '/bin/sh', HOME: home } })
  try {
    const { app, window } = launched
    const ticket = window.locator('[data-testid="ticket-node"][data-ticket="7"]')
    await canvasReady(launched, { size: { width: 1600, height: 900 }, visible: [ticket, frameOf(window, USER_BROWSER)] })
    const second = await openSecondWindow(launched, { size: { width: 1400, height: 860 } })
    await canvasReady({ window: second }, { visible: [second.locator('[data-testid="ticket-node"][data-ticket="7"]')] })
    for (const page of [window, second]) await pointerAway(page)

    // The Session opens a Browser of its own and drives one of the user's.
    const opened = await tool<{ id: string }>(app, projectId, 'browser_open', { profile: PROFILE, url: `${origin}/` })
    await tool(app, projectId, 'browser_screenshot', { id: DRIVEN_BROWSER })
    for (const page of [window, second]) await expect(frameOf(page, opened.id)).toBeVisible({ timeout: 20_000 })
    await expect(frameOf(window, DRIVEN_BROWSER)).toHaveAttribute('data-control', 'claude')
    await expect.poll(() => pageUrls(app), { timeout: 20_000 }).toContain(`${origin}/`)
    await canvasReady(launched, { visible: [ticket, frameOf(window, opened.id)] })

    // Nothing hovered: no Browser is marked.
    await expectLit(window, [])
    // Hovering the Ticket lights its Family: the Session's Binding line, and its Browser — only that
    // one: the user's Browsers, the one the Session drives too, are in no Family.
    await ticket.hover()
    await expect(line(window, `binding:session:${CLAIM}`)).toHaveCount(1)
    await expectLit(window, [opened.id])
    // The highlight is the window's own: the second window marks nothing.
    await expectLit(second, [])
    await pointerAway(window)
    await expectLit(window, [])
    // Hovering the Browser's frame lights the same Family, the Ticket's Binding line too.
    await frameOf(window, opened.id).locator('.w-browser-frame__header').hover()
    await expectLit(window, [opened.id])
    await expect(line(window, `binding:session:${CLAIM}`)).toHaveCount(1)
    // The user's Browser lights nothing.
    await frameOf(window, USER_BROWSER).locator('.w-browser-frame__header').hover()
    await expectLit(window, [])
    await expect(line(window, `binding:session:${CLAIM}`)).toHaveCount(0)
    await pointerAway(window)

    // Where the Session's Browser stands, as main saves it.
    const saved = (): string => readFileSync(join(dataDir, projectId, 'layout.json'), 'utf8')
    const placeOf = (id: string): { x: number; y: number } | undefined => (JSON.parse(saved()) as { nodes: { id: string; x: number; y: number }[] }).nodes.find((node) => node.id === id)
    await expect.poll(() => placeOf(opened.id), { timeout: 10_000 }).toBeDefined()
    const place = placeOf(opened.id)!

    // Hide the Session: its Browser leaves the Canvas of both windows and its page is closed.
    await window.locator(`[data-testid="session-node"][data-session-id="${CLAIM}"]`).getByRole('button', { name: 'Hide', exact: true }).click()
    for (const page of [window, second]) {
      await expect(frameOf(page, opened.id)).toHaveCount(0)
      await expect(frameOf(page, USER_BROWSER)).toBeVisible()
      await expect(frameOf(page, DRIVEN_BROWSER)).toBeVisible()
      // The Browser of the user the Session drove is no longer driven.
      await expect(frameOf(page, DRIVEN_BROWSER).getByTestId('browser-claude-drives'), page === window ? 'first window' : 'second window').toHaveCount(0)
      await expect(frameOf(page, DRIVEN_BROWSER)).not.toHaveAttribute('data-control', /.+/)
    }
    await expect.poll(() => pageUrls(app), { timeout: 20_000 }).not.toContain(`${origin}/`)
    // And layout.json has it no more, once main writes it.
    await expect.poll(saved, { timeout: 10_000 }).not.toContain(opened.id)
    expect(saved()).toContain(USER_BROWSER)
    // One ⌘Z brings the Session back with its Browser, at its former place, in both windows, and
    // the Browser's page opens again.
    await window.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } })
    await window.keyboard.press('ControlOrMeta+z')
    for (const page of [window, second]) {
      await expect(page.locator(`[data-testid="session-node"][data-session-id="${CLAIM}"]`)).toBeVisible()
      await expect(frameOf(page, opened.id)).toHaveCount(1)
    }
    await expect.poll(() => placeOf(opened.id), { timeout: 10_000 }).toEqual(place)
    await expect.poll(() => pageUrls(app), { timeout: 20_000 }).toContain(`${origin}/`)
  } finally {
    await launched.close()
    await removeDir(scratch)
  }
})

test.describe('on a read-only screen', () => {
  test.setTimeout(180_000)

  test('a Linked machine shown the Project read-only lights the Session’s Browser in the Ticket’s Family', async () => {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-browser-family-ro-')))
    const ALPHA = 'alpha-0000000a'
    const BETA = 'beta-0000000b'
    const alpha = join(scratch, 'alpha')
    mkdirSync(alpha, { recursive: true })
    git(alpha, 'init', '-q')
    const aData = join(scratch, 'a-data')
    mkdirSync(aData, { recursive: true })
    writeFileSync(join(aData, 'projects.json'), JSON.stringify({ projects: [{ id: ALPHA, name: 'alpha', path: realpathSync(alpha) }], activeId: ALPHA }))
    const b = fixture(scratch, BETA, [userBrowser(USER_BROWSER, 0, 600)])

    const a = await launchApp({ env: { WORFY_DATA_DIR: aData } })
    let machineB: LaunchedApp | undefined
    try {
      machineB = await launchApp({ env: { WORFY_DATA_DIR: b.dataDir, WORFY_CLAUDE_HOME: b.claudeHome, SHELL: '/bin/sh', HOME: b.home } })
      const size = { width: 1400, height: 900 }
      await canvasReady(machineB, { size, visible: [machineB.window.locator('[data-testid="ticket-node"][data-ticket="7"]')] })
      await canvasReady(a, { size })
      // B's Session opens its Browser on B, the Project's Machine.
      const opened = await tool<{ id: string }>(machineB.app, BETA, 'browser_open', { profile: PROFILE })
      await expect(frameOf(machineB.window, opened.id)).toBeVisible({ timeout: 20_000 })

      await linkThroughUi(a.window, machineB.window)
      const aId = await machineIdOf(a.window)
      const bId = await machineIdOf(machineB.window)
      const settings = await openMachinesSettings(machineB)
      await settings.getByRole('switch', { name: PROJECTS_ACCESS_LABEL, exact: true }).click()
      await chooseLevel(machineB.window, settings.getByTestId(`link-machine-access-${aId}`), 'read')
      await closeSettings(machineB.window)

      const group = a.window.locator(`[data-testid="machine-group"][data-machine-id="${bId}"]`)
      await expect(group.getByTestId('machine-read-only')).toHaveText('Read only', { timeout: 20_000 })
      await group.locator(`[data-testid="project-row"][data-project-id="${BETA}"]`).getByRole('button').click()
      await expect(a.window.getByTestId('canvas')).toHaveAttribute('data-project-id', BETA)
      await expect(a.window.getByTestId('canvas-read-only')).toBeVisible()
      const ticket = a.window.locator('[data-testid="ticket-node"][data-ticket="7"]')
      await canvasReady(a, { visible: [ticket, frameOf(a.window, opened.id)] })
      await pointerAway(a.window)
      await expectLit(a.window, [])

      await ticket.hover()
      await expect(line(a.window, `binding:session:${CLAIM}`)).toHaveCount(1)
      await expectLit(a.window, [opened.id])
      await frameOf(a.window, USER_BROWSER).locator('.w-browser-frame__header').hover()
      await expectLit(a.window, [])
    } finally {
      await a.close()
      await machineB?.close()
      await removeDir(scratch)
    }
  })
})

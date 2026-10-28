// A Browser in Autopilot on the built app (worfy-browser ticket 08, ADR-0078 item 10): the answers of
// the `worfy-browser` tools to the Session Autopilot runs, not the report of the Harness. Autopilot
// starts on the Epic `demo` with the fake agent, whose Orchestrator turn holds until it is
// interrupted, so its Session stays unattended for the whole test. As that Session:
// - browser_list names only the Browser profile marked «Available to Autopilot» («user»);
// - browser_open under «admin», not marked, answers an error naming «admin», and makes no Browser;
// - browser_open needs the Ticket in Autopilot, one of the Epic the run works on;
// - browser_open under «user» for Ticket demo/01 opens a Browser, opened by the Session;
// - a page that redirects to the profile's sign-in page answers «Sign-in expired in Browser profile
//   "user"» (the owner's answer 2026-10-23), and on that sign-in page the password field stays
//   empty: browser_type into it is refused, and no call filled it;
// - the Browser is in the Family of the Ticket it was opened for: hovering Ticket 01 lights it, with
//   no Binding of the Session to that Ticket (the Orchestrator of a Wave is bound to the Epic).
//
// The fake agent calls no MCP tool, so the test calls the tools in main as the Session would
// (globalThis.worfyBrowserTool, src/main/mcp/browser-server.ts); main tells an unattended Session by
// its launch, as the Session registry has it. The pages come from a server this file starts on
// 127.0.0.1: the origin of both Browser profiles.
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { canvasReady, launchApp, parkPointer, repoRoot } from './helpers'
import { catScript } from '../harness-node'

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'demo-000000b8'
const EPIC = 'demo'
const USER = 'user-0b0b0b'
const ADMIN = 'admin-0a0a0a'

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }
const bridgeCall = (window: Page, channel: string, input?: unknown) =>
  window.evaluate(([name, value]) => (globalThis as unknown as { worfy: Bridge }).worfy.invoke(name as string, value), [channel, input] as const)

let site: Server
let origin: string

const LOGIN_PAGE = '<!doctype html><title>Sign in</title><form><input id="email" name="email"><input id="password" name="password" type="password"><button>Sign in</button></form>'

test.beforeAll(async () => {
  site = createServer((request, response) => {
    if (request.url === '/account') return void response.writeHead(302, { location: '/login?next=%2Faccount' }).end()
    if (request.url?.startsWith('/login') === true) return void response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(LOGIN_PAGE)
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><title>Home</title><h1>Home</h1>')
  })
  await new Promise<void>((done) => site.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  await new Promise<void>((done) => site.close(() => done()))
})

function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

/**
 * The Project in a temporary folder: a git repository with the Epic `demo` (Ticket 01 with
 * `Roles: user`, which only the Harness text reads — the fake agent and worfy do not; Ticket 02),
 * an epic-status that answers them, and worfy's data folder with the
 * Project and its two Browser profiles: «user», marked for Autopilot with its sign-in page, and
 * «admin», not marked.
 */
function prepare(scratch: string) {
  const dataDir = join(scratch, 'data')
  const claudeHome = join(scratch, 'claude-home')
  const repo = join(scratch, 'demo')
  const issues = join(repo, '.scratch', EPIC, 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# Demo epic\n')
  writeFileSync(join(issues, '01-ticket-1.md'), ['# 01 — Ticket 1', '', 'Type: task', 'Status: open', 'Blocked by: —', 'Roles: user', ''].join('\n'))
  writeFileSync(join(issues, '02-ticket-2.md'), ['# 02 — Ticket 2', '', 'Type: task', 'Status: open', 'Blocked by: —', ''].join('\n'))
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')

  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  const ticket = (num: number) => ({ epic: EPIC, num, slug: `ticket-${num}`, title: `0${num} — Ticket ${num}`, statusRaw: 'open', state: 'open', blockedRaw: '—', blockedNums: [], blockedParsed: true })
  writeFileSync(answer, JSON.stringify({ ref: 'main', epics: [{ epic: EPIC, hasSpec: true, hasMap: false }], tickets: [ticket(1), ticket(2)] }))
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)

  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: repo }], activeId: PROJECT }))
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 20, y: 20, zoom: 0.5 } }))
  writeFileSync(
    join(dataDir, PROJECT, 'browser-profiles.json'),
    JSON.stringify({
      profiles: [
        { id: ADMIN, name: 'admin', origins: [origin], autopilot: false },
        { id: USER, name: 'user', origins: [origin], autopilot: true, signIn: `${origin}/login` },
      ],
    }),
  )
  return { dataDir, claudeHome, repo }
}

interface ToolAnswer {
  content: { type: string; text?: string }[]
  isError?: boolean
}

/** Calls a tool of worfy-browser in main as Session `session` of the Project would. */
function tool(app: ElectronApplication, session: string, name: string, args: Record<string, unknown>): Promise<ToolAnswer> {
  return app.evaluate(
    (_electron, { project, session, name, args }) =>
      (globalThis as unknown as { worfyBrowserTool: (p: string, s: string, n: string, a: unknown) => Promise<unknown> }).worfyBrowserTool(project, session, name, args) as Promise<ToolAnswer>,
    { project: PROJECT, session, name, args },
  )
}
const textOf = (answer: ToolAnswer): string => answer.content[0]?.text ?? ''
const ok = <T>(answer: ToolAnswer, name: string): T => {
  expect(answer.isError, `${name}: ${textOf(answer)}`).toBeFalsy()
  return JSON.parse(textOf(answer)) as T
}
const refusal = (answer: ToolAnswer, name: string): string => {
  expect(answer.isError, `${name}: ${textOf(answer)}`).toBe(true)
  return textOf(answer)
}

/** The value of the password field of every Browser page on `path`, read from its guest. */
const passwords = (app: ElectronApplication, path: string): Promise<string[]> =>
  app.evaluate(
    async ({ webContents }, path) =>
      Promise.all(
        webContents
          .getAllWebContents()
          .filter((contents) => contents.getType() === 'webview' && !contents.isDestroyed() && new URL(contents.getURL()).pathname === path)
          .map((contents) => contents.executeJavaScript('document.querySelector("#password")?.value ?? null') as Promise<string>),
      ),
    path,
  )

const frameOf = (window: Page, id: string): Locator => window.locator(`[data-testid="browser-frame"][data-node-id="${id}"]`)
const expectLit = (window: Page, ids: readonly string[]): Promise<void> =>
  expect.poll(() => window.locator('[data-testid="browser-frame"][data-family="lit"]').evaluateAll((frames) => frames.map((frame) => frame.getAttribute('data-node-id')))).toEqual(ids)

test('the Session Autopilot runs uses only the Browser profiles marked for it, opens a Browser for a Ticket of its Epic, is told an expired sign-in, never fills the password, and its Browser is in the Ticket’s Family', async () => {
  test.setTimeout(120_000)
  const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-browser-autopilot-')))
  const { dataDir, claudeHome, repo } = prepare(scratch)
  const log = join(scratch, 'agent.jsonl')
  const scripts = join(repoRoot, 'test', 'fixtures', 'agent-scripts')
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPTS: scripts, WORFY_AGENT_SCRIPT: 'orchestrator', WORFY_AGENT_LOG: log } })
  try {
    const { app, window } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1600, 900))
    const ticket = window.locator('[data-testid="ticket-node"][data-ticket="1"]')
    await canvasReady(launched, { visible: [ticket, window.locator('[data-testid="ticket-node"][data-ticket="2"]')] })
    await expect(window.getByTestId('orchestrator-node')).toBeVisible()

    // Autopilot takes the Orchestrator: its Session runs unattended while the Wave's turn holds.
    expect(await bridgeCall(window, 'autopilot.start', { projectId: PROJECT, epic: EPIC })).toMatchObject({ ok: true })
    await expect(window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`).getByTestId('autopilot-status')).toHaveText('Wave 1 · running')
    const sessionOf = async (): Promise<string | null> => {
      const listed = (await bridgeCall(window, 'agent.list')).value as { sessionId: string; cwd: string; state: string }[] | undefined
      return listed?.find((each) => each.cwd === repo && each.state === 'busy')?.sessionId ?? null
    }
    await expect.poll(sessionOf, { timeout: 20_000, message: 'the unattended Orchestrator Session' }).not.toBeNull()
    const session = (await sessionOf())!
    await expect.poll(() => app.evaluate(() => typeof (globalThis as { worfyBrowserTool?: unknown }).worfyBrowserTool)).toBe('function')

    // Only «user» exists for it.
    const listed = ok<{ profiles: { id: string; name: string }[] }>(await tool(app, session, 'browser_list', {}), 'browser_list')
    expect(listed.profiles.map((profile) => profile.name)).toEqual(['user'])

    // «admin» is refused, by name, and no Browser is made.
    const admin = refusal(await tool(app, session, 'browser_open', { profile: ADMIN, url: `${origin}/` }), 'browser_open admin')
    expect(admin).toContain('"admin"')
    expect(admin).toContain('is not available to Autopilot')
    await expect(window.locator('[data-testid="browser-frame"]')).toHaveCount(0)

    // In Autopilot a Browser is opened for a Ticket of the run's Epic, and only then.
    expect(refusal(await tool(app, session, 'browser_open', { profile: USER, url: `${origin}/` }), 'browser_open without ticket')).toContain('needs `ticket`')
    expect(refusal(await tool(app, session, 'browser_open', { profile: USER, ticket: 'other/01' }), 'browser_open other epic')).toContain('not of Epic demo')
    expect(refusal(await tool(app, session, 'browser_open', { profile: USER, ticket: 'demo/07' }), 'browser_open unknown ticket')).toContain('Epic demo has no Ticket 07')
    await expect(window.locator('[data-testid="browser-frame"]')).toHaveCount(0)

    // «user» opens for Ticket 01, as the Session's own Browser.
    const opened = ok<{ id: string; url: string; ticket: string }>(await tool(app, session, 'browser_open', { profile: USER, url: `${origin}/`, ticket: 'demo/01' }), 'browser_open user')
    expect(opened).toMatchObject({ url: `${origin}/`, ticket: 'demo/01' })
    await expect(frameOf(window, opened.id)).toBeVisible({ timeout: 20_000 })
    const saved = (): { id: string; data: { openedBy?: string } }[] => (JSON.parse(readFileSync(join(dataDir, PROJECT, 'layout.json'), 'utf8')) as { nodes: { id: string; data: { openedBy?: string } }[] }).nodes
    await expect.poll(() => saved().find((node) => node.id === opened.id)?.data.openedBy, { timeout: 10_000 }).toBe(session)
    expect(saved().find((node) => node.id === opened.id)?.data).toMatchObject({ ticket: { epic: EPIC, num: 1 } })

    // The site sends it to the sign-in page: the sign-in expired, and the Session is told so.
    const expired = refusal(await tool(app, session, 'browser_navigate', { id: opened.id, url: `${origin}/account` }), 'browser_navigate /account')
    expect(expired).toContain('Sign-in expired in Browser profile "user"')
    expect(expired).toContain(`${origin}/login`)
    // On the sign-in page the Session in Autopilot may only navigate away: no typing, no click.
    const typing = refusal(await tool(app, session, 'browser_type', { id: opened.id, selector: '#password', text: 'hunter2' }), 'browser_type #password')
    expect(typing).toContain('only browser_navigate away is allowed')
    expect(refusal(await tool(app, session, 'browser_click', { id: opened.id, selector: 'button' }), 'browser_click Sign in')).toContain('only browser_navigate away is allowed')
    await expect.poll(() => passwords(app, '/login'), { timeout: 10_000 }).toEqual([''])

    // The Browser is in the Family of Ticket 01, which it was opened for; not in Ticket 02's.
    await canvasReady(launched, { visible: [ticket, frameOf(window, opened.id)] })
    await parkPointer(window)
    await expectLit(window, [])
    await ticket.hover()
    await expectLit(window, [opened.id])
    await parkPointer(window)
    await window.locator('[data-testid="ticket-node"][data-ticket="2"]').hover()
    await expectLit(window, [])
    await parkPointer(window)

    expect(await bridgeCall(window, 'autopilot.forceStop', { projectId: PROJECT })).toMatchObject({ ok: true })
  } finally {
    await launched.close()
    await removeDir(scratch)
  }
})

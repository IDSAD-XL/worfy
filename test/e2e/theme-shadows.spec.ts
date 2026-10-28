import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { catScript } from '../harness-node'

/**
 * The shadow tokens inside comma-separated box-shadow lists: the second card of the done stack
 * (epic-frame.css) and the 1 px accent ring of a selected Node and Ticket (canvas.css,
 * epic-frame.css). A shadow token of `none` inside such a list makes the browser drop the whole
 * declaration, so the dark theme, which has no shadows, used to lose the stack's second card and
 * the ring. Its shadow tokens are now a transparent shadow that is valid inside a list.
 */

type Scheme = 'light' | 'dark'

/** --shadow-node as computed: two soft layers in light (F-SPEC), one transparent layer in dark. */
const NODE_SHADOW: Record<Scheme, string> = {
  light: 'rgba(0, 0, 0, 0.06) 0px 1px 2px 0px, rgba(0, 0, 0, 0.06) 0px 4px 12px 0px',
  dark: 'rgba(0, 0, 0, 0) 0px 0px 0px 0px',
}

/**
 * The few DOM globals the page-side callbacks use. test/e2e is type-checked without the DOM
 * library (it runs under Node), so the callbacks declare what they touch.
 */
interface PageGlobals {
  document: { documentElement: object }
  getComputedStyle: (element: object) => { getPropertyValue: (name: string) => string; boxShadow: string }
}

const hexToRgb = (hex: string): string => {
  const value = hex.trim().replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16))
  return `rgb(${r}, ${g}, ${b})`
}

/** Colour tokens of the theme the page shows now, as computed rgb() strings. */
async function colours(window: Page): Promise<{ doneBg: string; border: string; accent: string }> {
  const raw = await window.evaluate(() => {
    const { document, getComputedStyle } = globalThis as unknown as PageGlobals
    const root = getComputedStyle(document.documentElement)
    return { doneBg: root.getPropertyValue('--done-bg'), border: root.getPropertyValue('--border'), accent: root.getPropertyValue('--accent') }
  })
  return { doneBg: hexToRgb(raw.doneBg), border: hexToRgb(raw.border), accent: hexToRgb(raw.accent) }
}

const boxShadow = (locator: Locator): Promise<string> =>
  locator.evaluate((element) => (globalThis as unknown as PageGlobals).getComputedStyle(element).boxShadow)

/** git for the fixture, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

const PROJECT_ID = 'demo-0000000d'

interface FixtureTicket {
  num: number
  state: 'done' | 'open'
  blocked: number[]
}

/** demo: Tickets 01 and 02 done (folded into the stack), 03 and 04 open. */
const TICKETS: FixtureTicket[] = [
  { num: 1, state: 'done', blocked: [] },
  { num: 2, state: 'done', blocked: [1] },
  { num: 3, state: 'open', blocked: [2] },
  { num: 4, state: 'open', blocked: [3] },
]

let scratch: string
let launched: LaunchedApp | undefined

/**
 * A git repository with the demo Epic, the only and active Project, and a user's note on the
 * Canvas left of the frames' column; bin/epic-status of the Claude home prints a ready answer.
 */
function makeFixture(): { dataDir: string; claudeHome: string } {
  const repo = join(scratch, 'demo')
  const issues = join(repo, '.scratch', 'demo', 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', 'demo', 'spec.md'), '# demo: a small Epic\n')
  const answer = { ref: 'main', epics: [{ epic: 'demo', hasSpec: true, hasMap: false }], tickets: [] as unknown[] }
  for (const ticket of TICKETS) {
    const nn = String(ticket.num).padStart(2, '0')
    const blocked = ticket.blocked.length ? ticket.blocked.map((n) => String(n).padStart(2, '0')).join(', ') : '—'
    const text = [`# ${nn} — Ticket ${ticket.num}`, '', 'Type: task', `Status: ${ticket.state}`, `Blocked by: ${blocked}`, '', '## Что делаем', '', 'text', ''].join('\n')
    writeFileSync(join(issues, `${nn}-t${ticket.num}.md`), text)
    answer.tickets.push({
      epic: 'demo',
      num: ticket.num,
      slug: `t${ticket.num}`,
      title: `${nn} — Ticket ${ticket.num}`,
      statusRaw: ticket.state,
      state: ticket.state,
      blockedRaw: blocked,
      blockedNums: ticket.blocked,
      blockedParsed: true,
    })
  }
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')

  const claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answerFile = join(scratch, 'epic-status.json')
  writeFileSync(answerFile, JSON.stringify(answer))
  const script = join(claudeHome, 'bin', 'epic-status')
  writeFileSync(script, catScript(answerFile))
  chmodSync(script, 0o755)

  const dataDir = join(scratch, 'data')
  mkdirSync(join(dataDir, PROJECT_ID), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT_ID, name: 'demo', path: repo }], activeId: PROJECT_ID }))
  const note = { id: 'n1', kind: 'note', x: 40, y: 320, w: 220, h: 120, data: { text: 'a note of the user' } }
  writeFileSync(join(dataDir, PROJECT_ID, 'layout.json'), JSON.stringify({ nodes: [note], viewport: { x: 0, y: 0, zoom: 0.8 } }))
  return { dataDir, claudeHome }
}

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-theme-shadows-')))
})

test.afterEach(async () => {
  await launched?.close()
  launched = undefined
  await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('the folded done stack draws its second card and a selected Node and Ticket carry the accent ring, in both themes; light keeps its soft shadows', async () => {
  const { dataDir, claudeHome } = makeFixture()
  launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })
  const { window } = launched

  const stack = window.getByTestId('done-stack')
  await expect(stack).toBeVisible({ timeout: 15_000 })
  await expect(stack.locator('.w-epic__stack-title')).toHaveText('2 done')
  const ticket = window.locator('[data-testid="ticket-node"][data-ticket="3"]')
  const note = window.locator('[data-testid="note-node"][data-node-id="n1"]')
  await expect(ticket).toBeVisible()
  await expect(note).toBeVisible()

  // Select the Ticket, then add the note to the selection (Cmd-click on macOS, Ctrl-click elsewhere: React Flow's default).
  await ticket.click()
  await note.click({ position: { x: 6, y: 6 }, modifiers: ['ControlOrMeta'] })
  await expect(window.locator('.react-flow__node.selected > .w-ticket[data-ticket="3"]')).toHaveCount(1)
  await expect(window.locator('.react-flow__node.selected > .w-node-surface[data-node-id="n1"]')).toHaveCount(1)

  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    const { doneBg, border, accent } = await colours(window)
    const ring = `${NODE_SHADOW[scheme]}, ${accent} 0px 0px 0px 1px`
    // The second card: a card-coloured shadow 4 px down and right, and its 1 px border.
    expect(await boxShadow(stack), `${scheme}: the done stack`).toBe(`${doneBg} 4px 4px 0px -1px, ${border} 4px 4px 0px 0px, ${NODE_SHADOW[scheme]}`)
    expect(await boxShadow(ticket), `${scheme}: the selected Ticket`).toBe(ring)
    expect(await boxShadow(note), `${scheme}: the selected note`).toBe(ring)
  }

  // Screenshots of both themes for the review against F-SPEC and F-canvas-dark.dc.html; the
  // ticket's evidence is copied from test-results/e2e/snapshots/theme-shadows/{light,dark}.png.
  await snapshotThemes(window, 'theme-shadows')
})

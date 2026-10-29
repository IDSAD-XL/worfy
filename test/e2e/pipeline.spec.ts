import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { profileJsonScript } from '../harness-node'
import { ms } from '../time-scale'

// The Pipeline tab and the Pipeline section of the sidebar (worfy-pipeline ticket 04) against the
// built app, over a Project in a temporary git repository with three Tickets: 01 open, 02 claimed,
// 03 done. The Claude home holds a bin/epic-status that reads the Ticket files as they are on disk,
// and a bin/profile whose Pipeline is worfy's. gh is the stub of launchApp: no PRs.
// - the view switch is Canvas / Session / Pipeline;
// - the board has worfy's columns, Done folded into its count;
// - `ticket claim` of 01 — its Status line rewritten — moves its card from Queued to Implementing
//   without a reload, and its row shows up in the section;
// - a click on a row of the section opens the board.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'demo-0000000p'

/** worfy's Pipeline (spec of worfy-pipeline, owner's decision 4). */
const WORFY_PIPELINE = [
  { kind: 'queued' },
  { kind: 'implementing' },
  { kind: 'ci' },
  { kind: 'agent-review' },
  { kind: 'check', name: 'windows' },
  { kind: 'gate-merge' },
  { kind: 'deploy' },
  { kind: 'closing' },
  { kind: 'done' },
]

/**
 * An epic-status that reads the Ticket files of `.scratch/` in its cwd (the Project): the header of
 * one fact per line, `Status: <word> <time>`. Each call reads them again, so a rewritten Status line
 * is what the next read returns.
 */
const EPIC_STATUS = `const { existsSync, readdirSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const epics = []
const tickets = []
for (const epic of existsSync('.scratch') ? readdirSync('.scratch').sort() : []) {
  epics.push({ epic, hasSpec: existsSync(join('.scratch', epic, 'spec.md')), hasMap: false })
  const dir = join('.scratch', epic, 'issues')
  for (const file of existsSync(dir) ? readdirSync(dir).sort() : []) {
    const m = /^(\\d+)-(.*)\\.md$/.exec(file)
    if (!m) continue
    const text = readFileSync(join(dir, file), 'utf8')
    const line = (name) => { for (const l of text.split('\\n')) { const x = new RegExp('^' + name + ':\\\\s*(.*)$').exec(l); if (x) return x[1].trim() } return null }
    const status = /^(open|claimed|blocked|done)(?: (\\S+))?$/.exec(line('Status') ?? '')
    tickets.push({ epic, num: Number(m[1]), slug: m[2], title: text.split('\\n')[0].replace(/^#\\s*/, ''), statusRaw: line('Status'),
      state: status === null ? 'none' : status[1] === 'claimed' ? 'work' : status[1], statusAt: status?.[2] ?? null, statusError: null,
      blockedReason: line('Blocked reason'), waits: line('Waits'), pr: null, blockedRaw: '—', blockedNums: [], blockedParsed: true })
  }
}
process.stdout.write(JSON.stringify({ ref: 'main', epics, tickets }))
`

let scratch: string
let dataDir: string
let claudeHome: string
let repo: string

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

const ticketText = (num: number, title: string, status: string): string =>
  [`# ${String(num).padStart(2, '0')} — ${title}`, '', 'Type: task', `Status: ${status}`, 'Blocked by: —', '', '## Что делаем', '', 'text', ''].join('\n')

const ticketPath = (num: number, slug: string): string => join(repo, '.scratch', 'demo', 'issues', `${String(num).padStart(2, '0')}-${slug}.md`)

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-pipeline-')))
  dataDir = join(scratch, 'data')
  repo = join(scratch, 'demo')
  mkdirSync(join(repo, '.scratch', 'demo', 'issues'), { recursive: true })
  writeFileSync(join(repo, '.scratch', 'demo', 'spec.md'), '# demo\n')
  writeFileSync(ticketPath(1, 'board'), ticketText(1, 'The board', 'open'))
  writeFileSync(ticketPath(2, 'section'), ticketText(2, 'The section', 'claimed 2026-10-18T09:00Z'))
  writeFileSync(ticketPath(3, 'header'), ticketText(3, 'The header', 'done 2026-10-17T12:00Z'))
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')

  claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), EPIC_STATUS)
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)
  const profile = { name: 'demo', _resolved: { name: 'demo', mode: 'full', workflow_folder: repo, workspace: null, repos: [{ name: 'demo', path: repo }], pipeline: WORFY_PIPELINE }, workflow: { e2e_lock: null } }
  writeFileSync(join(claudeHome, 'bin', 'profile'), profileJsonScript(JSON.stringify(profile)))
  chmodSync(join(claudeHome, 'bin', 'profile'), 0o755)

  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: repo }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

const launch = (): Promise<LaunchedApp> => launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })

const card = (window: Page, num: number): Locator => window.locator(`[data-testid="pipeline-card"][data-epic="demo"][data-ticket="${num}"]`)
const column = (window: Page, stage: string): Locator => window.locator(`[data-testid="pipeline-column"][data-stage="${stage}"]`)
const row = (window: Page, num: number): Locator => window.locator(`[data-testid="pipeline-row"][data-epic="demo"][data-ticket="${num}"]`)

test('the Pipeline tab shows the board, a claim moves a card without a reload, and the sidebar row opens the board', async () => {
  const launched = await launch()
  try {
    const { window } = launched
    const views = window.getByRole('group', { name: 'View', exact: true })
    await expect(views.getByRole('button')).toHaveText(['Canvas', 'Session', 'Pipeline'])
    await expect(views.getByRole('button', { name: 'Canvas' })).toHaveAttribute('aria-pressed', 'true')
    const board = window.getByTestId('pipeline-board')
    await expect(board).toBeHidden()

    await views.getByRole('button', { name: 'Pipeline' }).click()
    await expect(views.getByRole('button', { name: 'Pipeline' })).toHaveAttribute('aria-pressed', 'true')
    await expect(window.getByRole('main', { name: 'Pipeline' })).toBeVisible()
    await expect(board).toBeVisible({ timeout: ms(15_000) })
    await expect(board.getByTestId('pipeline-column-title')).toHaveText(['Queued', 'Implementing', 'CI', 'Agent review', 'Check «windows»', 'Gate & merge', 'Deploy', 'Closing', 'Done'])
    await expect(column(window, 'queued').locator(card(window, 1))).toBeVisible()
    await expect(card(window, 1)).toContainText('demo 01')
    await expect(card(window, 1)).toContainText('The board')
    await expect(column(window, 'implementing').locator(card(window, 2))).toBeVisible()
    await expect(card(window, 2).getByTestId('pipeline-waits')).toHaveText('Waits: agent')
    // Done is folded into its count.
    await expect(card(window, 3)).toHaveCount(0)
    await expect(column(window, 'done').getByRole('button', { name: '1 done' })).toHaveAttribute('aria-expanded', 'false')

    // The columns sit side by side, in Pipeline order.
    const lefts = await board.getByTestId('pipeline-column').evaluateAll((nodes) => nodes.map((node) => (node as unknown as { getBoundingClientRect(): { left: number } }).getBoundingClientRect().left))
    expect(lefts).toEqual([...lefts].sort((a, b) => a - b))
    expect(new Set(lefts).size).toBe(lefts.length)

    // The section lists the Ticket in work only.
    const section = window.locator('[data-section-id="PipelineSection"]')
    await expect(section.getByTestId('pipeline-row')).toHaveCount(1)
    await expect(row(window, 2).getByTestId('pipeline-stage')).toHaveText('Implementing')

    const shots = await snapshotThemes(window, 'pipeline-board')
    console.log(`pipeline board: ${shots.light} ${shots.dark}`)

    // `ticket claim` of 01 rewrites its Status line: the card moves without a reload.
    const navigations: string[] = []
    window.on('framenavigated', (frame) => navigations.push(frame.url()))
    const first = ticketPath(1, 'board')
    writeFileSync(first, readFileSync(first, 'utf8').replace('Status: open', 'Status: claimed 2026-10-18T10:00Z'))
    await expect(column(window, 'implementing').locator(card(window, 1))).toBeVisible({ timeout: ms(10_000) })
    await expect(column(window, 'queued').getByTestId('pipeline-card')).toHaveCount(0)
    await expect(section.getByTestId('pipeline-row')).toHaveCount(2)
    expect(navigations).toEqual([])

    // A click on a card shows its Card on the Canvas.
    await card(window, 1).click()
    await expect(views.getByRole('button', { name: 'Canvas' })).toHaveAttribute('aria-pressed', 'true')
    await expect(board).toBeHidden()

    const sidebarShots = await snapshotThemes(window, 'pipeline-section')
    console.log(`pipeline section: ${sidebarShots.light} ${sidebarShots.dark}`)

    // A click on a row of the section opens the board.
    await row(window, 2).click()
    await expect(views.getByRole('button', { name: 'Pipeline' })).toHaveAttribute('aria-pressed', 'true')
    await expect(board).toBeVisible()
  } finally {
    await launched.close()
  }
})

test('the View switch shows its icons alone in a window under 1400 px and keeps the names of its segments', async () => {
  const launched = await launch()
  try {
    const { app, window } = launched
    const views = window.getByRole('group', { name: 'View', exact: true })
    await expect(views.getByRole('button')).toHaveCount(3)
    const sizes = [
      { width: 1280, labels: false },
      { width: 1600, labels: true },
    ]
    for (const { width, labels } of sizes) {
      await expect
        .poll(async () => {
          const inner = await window.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth)
          if (inner !== width) await app.evaluate(({ BrowserWindow }, wanted) => BrowserWindow.getAllWindows()[0]?.setContentSize(wanted, 800), width)
          return inner
        })
        .toBe(width)
      for (const name of ['Canvas', 'Session', 'Pipeline']) {
        const segment = views.getByRole('button', { name })
        await expect(segment).toHaveAttribute('title', name)
        await expect(segment.locator('.w-segmented__label'))[labels ? 'toBeVisible' : 'toBeHidden']()
      }
      for (const scheme of ['light', 'dark'] as const) {
        await window.emulateMedia({ colorScheme: scheme })
        const path = test.info().outputPath(`toolbar-${width}-${scheme}.png`)
        await window.getByRole('banner').screenshot({ path, animations: 'disabled' })
        console.log(`toolbar ${width} px ${scheme}: ${path}`)
      }
      await window.emulateMedia({ colorScheme: null })
    }
  } finally {
    await launched.close()
  }
})

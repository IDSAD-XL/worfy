import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator } from '@playwright/test'
import { canvasReady, launchApp } from './helpers'
import { snapshotThemes } from './snapshots'
import { catScript } from '../harness-node'

// The groups of the command palette (⌘K) in the built app on the fake agent. The rows are ranked
// first and grouped after: a group stands where its best row stands, and each group has a heading
// with its name. The active Project holds the Epic `worfy-mvp`; a second Project gives the palette
// its Project group. `epic-status` is a script under the temporary Claude home with a fixed answer.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'worfy-0000007a'
const OTHER = 'other-0000007b'
const EPIC = 'worfy-mvp'

const TICKETS: { num: number; title: string; status: string; state: string; blocked: number[] }[] = [
  { num: 1, title: 'Skeleton', status: 'done — 2026-10-01', state: 'done', blocked: [] },
  { num: 7, title: 'Search over the Canvas', status: 'open', state: 'open', blocked: [1] },
  { num: 12, title: 'Release notes for build 07', status: 'open', state: 'open', blocked: [] },
]
const nn = (num: number): string => String(num).padStart(2, '0')

function ticketFile({ num, title, status, blocked }: (typeof TICKETS)[number]): string {
  const blockers = blocked.length ? blocked.map(nn).join(', ') : '—'
  return [`# ${nn(num)} — ${title}`, '', 'Type: task', `Status: ${status}`, `Blocked by: ${blockers}`, '', '## Где в коде', '', `- \`src/f${num}.ts\``, ''].join('\n')
}

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

let scratch: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-palette-groups-')))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

test('⌘K shows the commands in groups under headings, each group where its best row is', async () => {
  const dataDir = join(scratch, 'data')
  const claudeHome = join(scratch, 'claude-home')
  const repo = join(scratch, 'worfy')
  const other = join(scratch, 'other')

  const issues = join(repo, '.scratch', EPIC, 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# worfy MVP\n')
  for (const ticket of TICKETS) writeFileSync(join(issues, `${nn(ticket.num)}-t${ticket.num}.md`), ticketFile(ticket))
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  mkdirSync(other)
  git(other, 'init', '-q')

  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: [{ epic: EPIC, hasSpec: true, hasMap: false }],
      tickets: TICKETS.map(({ num, title, status, state, blocked }) => ({
        epic: EPIC,
        num,
        slug: `t${num}`,
        title: `${nn(num)} — ${title}`,
        statusRaw: status,
        state,
        blockedRaw: blocked.length ? blocked.map(nn).join(', ') : '—',
        blockedNums: blocked,
        blockedParsed: true,
      })),
    }),
  )
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)

  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(
    join(dataDir, 'projects.json'),
    JSON.stringify({
      projects: [
        { id: PROJECT, name: 'worfy', path: repo },
        { id: OTHER, name: 'other', path: other },
      ],
      activeId: PROJECT,
    }),
  )

  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })
  try {
    const { window } = launched
    const palette = window.getByTestId('command-palette')
    const input = window.getByTestId('palette-input')
    const listbox = palette.getByRole('listbox', { name: 'Commands' })
    const headings = palette.getByTestId('palette-group-heading')
    const option = (id: string): Locator => palette.locator(`[data-testid="palette-option"][data-command="${id}"]`)
    const active = palette.locator('[data-testid="palette-option"][data-active="true"]')
    await canvasReady(launched, { size: { width: 1280, height: 860 } })

    // The empty query: every row weighs the same, so the groups come in the order of their first
    // command — Action (with Ship ticket and Run wave, built after the views), View, Project, Go to.
    await window.keyboard.press('ControlOrMeta+k')
    await expect(palette).toBeVisible()
    // The workflow model has arrived: the Go to rows and the actions on Tickets are in the list.
    await expect(option(`ticket:${EPIC}/07`)).toHaveCount(1)
    await expect(option(`ship-ticket:${EPIC}/07`)).toHaveCount(1)
    await expect(headings).toHaveText(['Action', 'View', 'Project', 'Go to'])
    const action = listbox.getByRole('group', { name: 'Action' })
    await expect(action.locator(`[data-command="ship-ticket:${EPIC}/07"]`)).toHaveCount(1)
    await expect(action.locator(`[data-command="run-wave:${EPIC}"]`)).toHaveCount(1)
    await expect(listbox.getByRole('group', { name: 'Project' }).getByRole('option')).toHaveText([/Switch to project other/])
    // The first row is selected; a heading is never an option and never selected.
    await expect(active).toHaveAttribute('data-command', 'new:session')
    await expect(headings.first()).not.toHaveAttribute('aria-selected')
    await expect(palette.getByRole('option', { name: 'Action' })).toHaveCount(0)
    // No group name at the right of a row any more.
    await expect(option('new:session').getByTestId('palette-option-note')).toHaveCount(0)
    // The heading as the sidebar's section headings; a 1 px line before every group but the first.
    const look = await headings.first().evaluate((element) => {
      const style = (globalThis as unknown as { getComputedStyle(of: unknown): { fontSize: string; fontWeight: string } }).getComputedStyle(element)
      return { size: style.fontSize, weight: style.fontWeight }
    })
    expect(look).toEqual({ size: '11px', weight: '600' })
    await expect(palette.getByTestId('palette-group-separator')).toHaveCount(3)
    expect(await palette.getByTestId('palette-group-separator').first().evaluate((element) => element.getBoundingClientRect().height)).toBe(1)
    await snapshotThemes(window, '07-palette-groups-empty')

    // A Ticket's number: the Ticket itself is the best row, so Go to comes first — with the other
    // Ticket whose title has "07" — and the Action group with "Ship ticket …/07" after it, although
    // that row outranks the second Ticket.
    const rows = palette.getByTestId('palette-option')
    await input.fill('07')
    await expect(headings.first()).toHaveText('Go to')
    await expect(headings.nth(1)).toHaveText('Action')
    await expect(listbox.getByRole('group', { name: 'Go to' }).getByRole('option')).toHaveCount(2)
    await expect(rows.nth(0)).toHaveAttribute('data-command', `ticket:${EPIC}/07`)
    await expect(rows.nth(1)).toHaveAttribute('data-command', `ticket:${EPIC}/12`)
    await expect(rows.nth(2)).toHaveAttribute('data-command', `ship-ticket:${EPIC}/07`)
    await expect(active).toHaveAttribute('data-command', `ticket:${EPIC}/07`)
    await snapshotThemes(window, '07-palette-groups-query')

    // ↓ walks the rows across the border of the groups and never stops on a heading.
    await input.press('ArrowDown')
    await expect(active).toHaveAttribute('data-command', `ticket:${EPIC}/12`)
    await input.press('ArrowDown')
    await expect(active).toHaveAttribute('data-command', `ship-ticket:${EPIC}/07`)
    await expect(input).toHaveAttribute('aria-activedescendant', (await active.getAttribute('id')) ?? '')
    await snapshotThemes(window, '07-palette-groups-keyboard')
    // ↑ goes back over the border, to the last row of Go to.
    await input.press('ArrowUp')
    await expect(active).toHaveAttribute('data-command', `ticket:${EPIC}/12`)

    await input.press('Escape')
    await expect(palette).toHaveCount(0)
  } finally {
    await launched.close()
  }
})

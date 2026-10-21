import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { catScript, loginProfileWithNode } from '../harness-node'
import { canvasReady, launchApp } from './helpers'

// The focused Ticket in the built app: a double click on a Ticket card opens focus mode on it, the
// tile shows the whole Ticket file as markdown under the header, an edit of the file shows there
// without opening it again, and "Open in editor" and a relative link open files at the paths main
// resolves, while for a link to a program main asks first, and "Show in Finder" shows it in the file
// manager (worfy-polish ticket 35). A temporary HOME, Claude home and Harness home; `shell.openPath`,
// `shell.showItemInFolder` and `dialog.showMessageBox` are recorders, so no editor, file manager or
// box opens; the box answers "Show in Finder".

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'demo-00000033'
const EPIC = 'demo'

let scratch: string

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-ticket-focus-')))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

/**
 * Replaces the OS shell of main with recorders of the files it is asked to open and to show, and its
 * message box with one that records the question and answers button 1, "Show in Finder".
 */
async function recordOpenedFiles(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell, dialog }) => {
    const paths: string[] = []
    const shown: string[] = []
    const asked: string[] = []
    ;(globalThis as unknown as { openedPaths: string[]; shownPaths: string[]; askedBoxes: string[] }).openedPaths = paths
    ;(globalThis as unknown as { openedPaths: string[]; shownPaths: string[]; askedBoxes: string[] }).shownPaths = shown
    ;(globalThis as unknown as { openedPaths: string[]; shownPaths: string[]; askedBoxes: string[] }).askedBoxes = asked
    // showMessageBox(window, options) or showMessageBox(options): the options are the last argument.
    dialog.showMessageBox = (async (...args: unknown[]) => {
      asked.push((args.at(-1) as { message: string }).message)
      return { response: 1, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
    shell.openPath = async (path: string) => {
      paths.push(path)
      return ''
    }
    shell.showItemInFolder = (path: string) => {
      shown.push(path)
    }
  })
}

const shownPaths = (app: ElectronApplication): Promise<string[]> => app.evaluate(() => (globalThis as unknown as { shownPaths: string[] }).shownPaths)
const askedBoxes = (app: ElectronApplication): Promise<string[]> => app.evaluate(() => (globalThis as unknown as { askedBoxes: string[] }).askedBoxes)

const openedPaths = (app: ElectronApplication): Promise<string[]> => app.evaluate(() => (globalThis as unknown as { openedPaths: string[] }).openedPaths)

test('a double click on a Ticket card shows the whole Ticket in focus mode, follows edits of the file and opens it in the editor', async () => {
  const repo = join(scratch, 'demo')
  const issues = join(repo, '.scratch', EPIC, 'issues')
  mkdirSync(issues, { recursive: true })
  const spec = join(repo, '.scratch', EPIC, 'spec.md')
  writeFileSync(spec, '# Demo epic\n')
  const program = join(repo, '.scratch', EPIC, 'setup.command')
  writeFileSync(program, '#!/bin/sh\necho launched\n')
  const file = join(issues, '07-rate-limit.md')
  writeFileSync(
    file,
    ['# 07 — Rate limit', '', 'Type: task', 'Status: open', 'Blocked by: —', '', '## Что делаем', '', 'Limit the bids; see [the spec](../spec.md). Run [setup](../setup.command).', ''].join('\n'),
  )

  const home = join(scratch, 'home')
  mkdirSync(home)
  loginProfileWithNode(home)
  const claudeHome = join(scratch, 'claude-home')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  writeFileSync(join(claudeHome, 'settings.json'), '{}\n')
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: [{ epic: EPIC, hasSpec: true, hasMap: false }],
      tickets: [{ epic: EPIC, num: 7, slug: 'rate-limit', title: '07 — Rate limit', statusRaw: 'open', state: 'open', blockedRaw: '—', blockedNums: [], blockedParsed: true }],
    }),
  )
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)
  const dataDir = join(scratch, 'data')
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: repo }], activeId: PROJECT }))

  const launched = await launchApp({
    env: {
      WORFY_DATA_DIR: dataDir,
      WORFY_CLAUDE_HOME: claudeHome,
      WORFY_HARNESS_HOME: join(scratch, 'no-harness-home'),
      HARNESS_HOME: join(scratch, 'no-harness-home'),
      HOME: home,
      SHELL: '/bin/sh',
    },
  })
  try {
    const { app, window } = launched
    await recordOpenedFiles(app)
    const card = window.locator(`.react-flow__node [data-testid="ticket-node"][data-epic="${EPIC}"][data-ticket="7"]`)
    await canvasReady(launched, { visible: [card], size: { width: 1280, height: 800 } })
    // The card on the Canvas stays compact: no body, no editor button.
    await expect(card.getByTestId('ticket-body')).toHaveCount(0)

    await card.dblclick()
    const layer = window.getByTestId('focus-mode')
    await expect(layer).toBeVisible()
    const tile = layer.getByTestId('focus-tile')
    await expect(tile).toHaveCount(1)
    const focused = tile.getByTestId('ticket-node')
    await expect(focused).toHaveAttribute('data-focused', 'true')
    const body = focused.getByTestId('ticket-body')
    await expect(body.getByRole('heading', { name: 'Что делаем' })).toBeVisible()
    await expect(body).toContainText('Limit the bids')
    await expect(body).toHaveAttribute('data-path', file)
    // The header is still there above the body.
    await expect(focused.locator('.w-ticket__title')).toHaveText('Rate limit')

    await focused.getByRole('button', { name: 'Open in editor' }).click()
    await expect.poll(() => openedPaths(app)).toEqual([file])
    await body.getByRole('link', { name: 'the spec' }).click()
    await expect.poll(() => openedPaths(app)).toEqual([file, spec])
    // A link to a program goes through IPC to main, which asks first; "Show in Finder" shows it.
    await body.getByRole('link', { name: 'setup' }).click()
    await expect.poll(() => shownPaths(app)).toEqual([program])
    expect(await askedBoxes(app)).toEqual(['Open setup.command?'])
    await expect(body.getByRole('status')).toHaveText(/^Shown in (Finder|Explorer|the file manager): not a document$/)
    expect(await openedPaths(app)).toEqual([file, spec])

    // An edit of the body alone shows in the open tile.
    writeFileSync(file, `${readFileSync(file, 'utf8')}\n## Итог\n\nDone in the e2e test.\n`)
    await expect(body.getByRole('heading', { name: 'Итог' })).toBeVisible({ timeout: 15_000 })
    await expect(body).toContainText('Done in the e2e test.')

    await window.keyboard.press('Escape')
    await expect(layer).toHaveCount(0)
    await expect(card).toBeVisible()
    await expect(card.getByTestId('ticket-body')).toHaveCount(0)
  } finally {
    await launched.close()
  }
})

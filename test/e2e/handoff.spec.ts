import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { SETTLE_READS_MS } from '../../src/main/docs/watch'
import { launchApp } from './helpers'

// The HANDOFF Node and the sidebar's ADR section against the built app, over a Project in a
// temporary git repository. An edit of HANDOFF.md must show on the Node within a second; the ADR
// list must match docs/adr/; and after all of it the repository must be untouched
// (`git status --porcelain` empty): worfy only reads the Project (ADR-0002, ADR-0005).

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'

const HANDOFF = ['# HANDOFF', '', '## Сейчас в работе', '', '- тикет 12 у исполнителя', '', '## Дальше', '', '- волна 8', ''].join('\n')

const ADRS: Record<string, string> = {
  '0001-clean-room.md': '# worfy — чистая реализация\n\nДата: 2026-10-05. Статус: принят.\n\nТекст первого решения.\n',
  '0002-view-over-workflow.md': '# worfy — вид поверх workflow\n\nДата: 2026-10-05. Статус: принят.\n\nworfy не владеет состоянием.\n',
  '0003-stack.md': '# Стек\n\nДата: 2026-10-05. Статус: заменён.\n\nElectron и React.\n',
}

let scratch: string
let dataDir: string
let claudeHome: string
let repo: string

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-handoff-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  mkdirSync(claudeHome)
  repo = join(scratch, 'alpha')
  mkdirSync(join(repo, 'docs', 'adr'), { recursive: true })
  git(repo, 'init', '-q')
  writeFileSync(join(repo, 'HANDOFF.md'), HANDOFF)
  for (const [name, text] of Object.entries(ADRS)) writeFileSync(join(repo, 'docs', 'adr', name), text)
  writeFileSync(join(repo, 'docs', 'adr', 'README.md'), 'Not an ADR\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: repo }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

/** How long `check` takes to pass, asked again about once per frame (16 ms). */
async function msUntil(check: () => Promise<boolean>, timeoutMs = 5000): Promise<number> {
  const start = Date.now()
  await expect.poll(check, { intervals: [16], timeout: timeoutMs }).toBe(true)
  return Date.now() - start
}

test('the HANDOFF Node renders HANDOFF.md, follows an edit within a second, and the ADR list opens an ADR read-only', async () => {
  const app = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })
  try {
    const { window } = app
    const node = window.getByTestId('handoff-node')
    await expect(node).toHaveCount(1)
    await expect(node.getByRole('heading', { name: 'Сейчас в работе' })).toBeVisible()
    await expect(node).toContainText('тикет 12 у исполнителя')

    // Locked: main refuses to remove it.
    const layout = (await window.evaluate((projectId) => (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<unknown> } }).worfy.invoke('layout.get', { projectId }), PROJECT)) as {
      ok: boolean
      value: { layout: { nodes: { id: string; kind: string; locked: boolean }[] } }
    }
    const handoffNodes = layout.value.layout.nodes.filter((n) => n.kind === 'handoff')
    expect(handoffNodes).toHaveLength(1)
    expect(handoffNodes[0]!.locked).toBe(true)

    // An edit, as an agent would make it, is on the Node within a second. It is made after the
    // reads main makes when its watcher starts (SETTLE_READS_MS, counted from before the window
    // showed the Node), so only the file events can bring it. A window that only waits: those
    // reads change nothing on an unchanged file, so nothing shows when they are over. The last one
    // is due SETTLE_READS_MS after the watcher started, which was before the Node was shown; 200 ms
    // more covers the read itself.
    await window.waitForTimeout(Math.max(...SETTLE_READS_MS) + 200)
    writeFileSync(join(repo, 'HANDOFF.md'), HANDOFF.replace('- волна 8', '- волна 8\n- новая строка от агента'))
    const shownAfter = await msUntil(async () => (await node.textContent())?.includes('новая строка от агента') ?? false)
    expect(shownAfter).toBeLessThanOrEqual(1000)

    // Sidebar: the ADRs of docs/adr/, by number, with the count; README.md is not one.
    const section = window.getByRole('region', { name: 'ADR' })
    await expect(section.getByTestId('adr-count')).toHaveText(String(Object.keys(ADRS).length))
    const rows = section.getByTestId('sidebar-adr')
    const files = readdirSync(join(repo, 'docs', 'adr')).filter((name) => /^\d{4}-.*\.md$/.test(name)).sort()
    await expect(rows).toHaveCount(files.length)
    const shown = []
    for (let index = 0; index < files.length; index++) shown.push(await rows.nth(index).getAttribute('data-path'))
    expect(shown).toStrictEqual(files.map((name) => `docs/adr/${name}`))
    await expect(rows.nth(2)).toContainText('0003')
    await expect(rows.nth(2)).toContainText('Стек')
    await expect(rows.nth(2)).toContainText('заменён')

    // A click opens the ADR's text in a panel over the Canvas; Esc closes it.
    await rows.nth(1).click()
    const panel = window.getByRole('dialog', { name: 'ADR 0002' })
    await expect(panel).toBeVisible()
    await expect(panel.getByTestId('adr-panel-body')).toContainText('worfy не владеет состоянием.')
    await expect(panel.locator('[contenteditable], textarea, input')).toHaveCount(0)
    await window.screenshot({ path: test.info().outputPath('handoff-and-adr.png') })
    await window.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)

    // A new ADR shows up in the list.
    writeFileSync(join(repo, 'docs', 'adr', '0004-new.md'), '# Новое решение\n\nДата: 2026-10-06. Статус: принят.\n')
    await expect(section.getByTestId('adr-count')).toHaveText('4')
    await expect(rows).toHaveCount(4)
    unlinkSync(join(repo, 'docs', 'adr', '0004-new.md'))
    await expect(rows).toHaveCount(3)

    // No HANDOFF.md, no Node; it comes back with the file.
    unlinkSync(join(repo, 'HANDOFF.md'))
    await expect(node).toBeHidden()
    writeFileSync(join(repo, 'HANDOFF.md'), HANDOFF)
    await expect(node).toBeVisible()
    await expect(node).toContainText('тикет 12 у исполнителя')
    git(repo, 'checkout', '--', 'HANDOFF.md')
  } finally {
    await app.close()
  }
  // Only the test's own edits were made, and they were undone: worfy wrote nothing into the Project.
  expect(git(repo, 'status', '--porcelain')).toBe('')
})

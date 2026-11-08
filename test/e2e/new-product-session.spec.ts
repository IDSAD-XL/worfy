import { mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { canvasReady, launchApp } from './helpers'

// "New Product Session" from the Command palette (worfy-product-session ticket 06), against the
// built app on the fake agent (WORFY_AGENT=fake, set by launchApp): the command makes a Session Node
// of kind `product` on Claude Code and opens the Session view on it at once; back on the Canvas the
// Node carries the label «Product Session». A temporary WORFY_CLAUDE_HOME stands in for ~/.claude.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }
type SavedNode = { id: string; kind: string; data: { origin?: string; kind?: string; vendor?: string } }

let scratch: string
let dataDir: string
let claudeHome: string
let projectPath: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-product-session-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  projectPath = join(scratch, 'alpha')
  mkdirSync(join(claudeHome, 'sessions'), { recursive: true })
  mkdirSync(projectPath)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 20, y: 40, zoom: 0.6 } }))
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: projectPath }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

test('New Product Session from the palette opens its Session view, and its Node on the Canvas says Product Session', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1400, height: 900 }, visible: [window.getByTestId('orchestrator-node')] })

    await window.keyboard.press('ControlOrMeta+k')
    const palette = window.getByTestId('command-palette')
    await expect(palette).toBeVisible()
    await window.getByTestId('palette-input').fill('new product session')
    const option = palette.locator('[data-testid="palette-option"][data-command="new:product-session"]')
    await expect(option).toHaveAttribute('data-active', 'true')
    await expect(option).toContainText('New Product Session')
    await window.keyboard.press('Enter')
    await expect(palette).toBeHidden()

    // main made one Session Node of kind product, on Claude Code.
    const productNodes = (): Promise<SavedNode[]> =>
      window.evaluate(async (projectId) => {
        const bridge = (globalThis as unknown as { worfy: Bridge }).worfy
        const result = await bridge.invoke('layout.get', { projectId })
        const nodes = (result.value as { layout: { nodes: SavedNode[] } } | undefined)?.layout.nodes ?? []
        return nodes.filter((node) => node.kind === 'session' && node.data.kind === 'product')
      }, PROJECT)
    await expect.poll(async () => (await productNodes()).length).toBe(1)
    const [node] = await productNodes()
    expect(node!.data).toMatchObject({ origin: 'worfy', kind: 'product', vendor: 'claude' })

    // The Session view is open on that Node, not only the Node shown on the Canvas.
    const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
    await expect(view).toBeVisible()
    await expect(view).toHaveAttribute('data-node-id', node!.id)

    // Back on the Canvas the Node says Product Session, where a plain one says Session.
    await window.getByRole('group', { name: 'View', exact: true }).getByRole('button', { name: 'Canvas' }).click()
    const onCanvas = window.locator(`[data-testid="session-node"][data-node-id="${node!.id}"]`)
    await expect(onCanvas).toBeVisible()
    await expect(onCanvas).toHaveAttribute('data-session-kind', 'product')
    await expect(onCanvas.getByTestId('session-node-kind')).toHaveText('Product Session')
    await expect(onCanvas).toHaveAttribute('aria-label', /Product Session/)
  } finally {
    await launched.close()
  }
  // worfy wrote nothing into the stand-in for ~/.claude beyond what was there (ADR-0005).
  expect(readdirSync(join(claudeHome, 'sessions'))).toEqual([])
})

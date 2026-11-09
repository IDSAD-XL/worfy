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
//
// A Product Session saved before worfy started (worfy-polish ticket 75: the owner's restart) opens in
// the Session view while it does not run, saying «Not running — Resume to continue», not «started in
// terminal»; its Resume continues it as a Product Session and the view becomes the live one.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'
const SAVED = 'f0000000-0000-4000-8000-0000000000f5'

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

test('a Product Session saved before a restart opens with Resume in its Session view and resumes as a Product Session', async () => {
  // What Claude Code keeps of the Session: its transcript, in the folder of the cwd it ran in (registry.ts, projectDirName).
  const record = (extra: Record<string, unknown>) =>
    JSON.stringify({ isSidechain: false, timestamp: '2026-11-09T08:00:00.000Z', cwd: projectPath, sessionId: SAVED, entrypoint: 'sdk-ts', gitBranch: 'main', ...extra })
  const transcripts = join(claudeHome, 'projects', projectPath.normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(transcripts, { recursive: true })
  writeFileSync(
    join(transcripts, `${SAVED}.jsonl`),
    `${record({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'What next on the roadmap?' } })}\n` +
      `${record({ type: 'assistant', uuid: 'a1', message: { id: 'msg_1', model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: 'Three options.' }] } })}\n`,
  )
  const node = { id: 'product-1', kind: 'session', x: 0, y: 0, w: 340, h: 220, data: { origin: 'worfy', vendor: 'claude', kind: 'product', sessionId: SAVED } }
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [node], viewport: { x: 20, y: 40, zoom: 0.6 } }))

  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome } })
  try {
    const { window } = launched
    const onCanvas = window.locator(`[data-testid="session-node"][data-node-id="${node.id}"]`)
    await canvasReady(launched, { size: { width: 1400, height: 900 }, visible: [onCanvas] })
    await expect(onCanvas).toHaveAttribute('data-status', 'finished')

    // A double click opens its transcript read-only, as the sidebar's row does: worfy does not run it now.
    await onCanvas.getByTestId('session-node-title').dblclick()
    const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
    await expect(view).toHaveAttribute('data-read-only', 'true')
    await expect(view).toHaveAttribute('data-session-id', SAVED)
    await expect(view.getByTestId('session-read-only')).toHaveText('Not running — Resume to continue')
    await expect(view.getByTestId('session-source')).toHaveText(`worfy · ${projectPath}`)

    // Resume: the same Node runs the Session again, of kind product, and the view is the live one.
    await view.getByTestId('session-resume').click()
    await expect(view).not.toHaveAttribute('data-read-only', 'true')
    await expect(view).toHaveAttribute('data-node-id', node.id)
    await expect(view).toHaveClass(/w-session--product/)
    const saved = (): Promise<SavedNode | undefined> =>
      window.evaluate(async ({ projectId, id }) => {
        const bridge = (globalThis as unknown as { worfy: Bridge }).worfy
        const result = await bridge.invoke('layout.get', { projectId })
        return (result.value as { layout: { nodes: SavedNode[] } } | undefined)?.layout.nodes.find((each) => each.id === id)
      }, { projectId: PROJECT, id: node.id })
    expect((await saved())?.data).toMatchObject({ origin: 'worfy', kind: 'product', vendor: 'claude' })
  } finally {
    await launched.close()
  }
})

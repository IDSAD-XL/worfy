import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp } from './helpers'

// The chip «MCP n/m» of the Session header and its popover (worfy-mcp-live ticket 04) against the built
// app, on the fake agent with test/fixtures/agent-scripts/session-mcp.jsonl: mcpServerStatus() answers
// three made-up servers — example-notes and worfy-canvas connected, example-tracker failed. After the
// first turn the header shows «MCP 2/3» in the warning look; the popover draws a row per server with its
// status, tools, error and source, and Reconnect only on the failed one. A click on it goes to main
// (`agent.mcpAction`) and on to the agent: the fake records reconnectMcpServer("example-tracker") in
// WORFY_AGENT_LOG and makes the server connected, so the chip reads «MCP 3/3» and stops warning. The
// header with the open popover is shot in the light and the dark theme; with WORFY_EVIDENCE_DIR set, the
// shots are copied there.

const EVIDENCE_DIR = process.env.WORFY_EVIDENCE_DIR

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'

/** As in test/e2e/snapshots.ts: the translucent sidebar gets its opaque token while a shot is taken. */
const VIBRANCY_BACKDROP = 'html { background: var(--sidebar) !important; }'

let scratch: string
let dataDir: string
let claudeHome: string
let log: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-session-mcp-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  log = join(scratch, 'agent.log')
  mkdirSync(claudeHome)
  const path = join(scratch, 'alpha')
  mkdirSync(path)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

/** The control calls the fake agent recorded (src/main/agent/fake-query.ts, FakeCall). */
const calls = (): { kind: string; name?: string }[] =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as { kind: string; name?: string })
    : []

/** Opens the Orchestrator's Session view with a double click on its Node. */
async function openSession(window: Page): Promise<Locator> {
  const node = window.getByTestId('orchestrator-node')
  await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
  await node.locator('.w-orchestrator__header').dblclick()
  const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
  await expect(view).toBeVisible()
  await expect(view.getByTestId('session-state')).toHaveText('idle')
  return view
}

/** The header with the open popover in both themes, as <test output>/session-mcp/<name>-<scheme>.png, copied to the evidence folder when one is set. */
async function shoot(window: Page, header: Locator, popover: Locator, name: string): Promise<void> {
  const folder = join(test.info().project.outputDir, 'snapshots', 'session-mcp')
  mkdirSync(folder, { recursive: true })
  const [top, below] = [await header.boundingBox(), await popover.boundingBox()]
  if (top === null || below === null) throw new Error('the header or the popover is not on screen')
  const clip = { x: top.x, y: top.y, width: top.width, height: below.y + below.height - top.y + 8 }
  try {
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      const path = join(folder, `${name}-${scheme}.png`)
      await window.screenshot({ path, clip, animations: 'disabled', style: VIBRANCY_BACKDROP })
      if (EVIDENCE_DIR !== undefined) {
        mkdirSync(EVIDENCE_DIR, { recursive: true })
        copyFileSync(path, join(EVIDENCE_DIR, `04-${name}-${scheme}.png`))
      }
    }
  } finally {
    await window.emulateMedia({ colorScheme: null })
  }
}

test('the header shows «MCP n/m», its popover lists the servers, and Reconnect goes to the agent', async () => {
  const app = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'session-mcp', WORFY_AGENT_LOG: log } })
  try {
    const { window } = app
    const view = await openSession(window)
    const header = view.locator('.w-session__header')
    const chip = header.getByTestId('session-mcp')

    await view.getByRole('textbox', { name: 'Message Orchestrator' }).fill('check the servers')
    await view.getByRole('textbox', { name: 'Message Orchestrator' }).press('Enter')
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(1)

    // Two of three connected; one failed, so the chip warns.
    await expect(chip.getByTestId('session-mcp-count')).toHaveText('2/3')
    await expect(chip).toHaveAttribute('data-warn', 'true')

    await chip.click()
    const popover = window.getByRole('dialog', { name: 'MCP servers' })
    await expect(popover).toBeVisible()
    const rows = popover.getByTestId('mcp-row')
    await expect(rows).toHaveCount(3)
    const tracker = popover.locator('[data-testid="mcp-row"][data-name="example-tracker"]')
    const notes = popover.locator('[data-testid="mcp-row"][data-name="example-notes"]')
    const canvas = popover.locator('[data-testid="mcp-row"][data-name="worfy-canvas"]')
    await expect(tracker.getByTestId('mcp-row-status')).toHaveText('failed')
    await expect(tracker.getByTestId('mcp-row-error')).toHaveText('connection refused by example-tracker')
    await expect(tracker.getByTestId('mcp-row-source')).toHaveText('user config')
    await expect(notes.getByTestId('mcp-row-status')).toHaveText('connected')
    await expect(notes.getByTestId('mcp-row-tools')).toHaveText('2 tools')
    await expect(canvas.getByTestId('mcp-row-source')).toHaveText('worfy')
    // Buttons only from the row's actions: the Claude driver offers Reconnect on a failed server alone.
    await expect(tracker.getByRole('button')).toHaveText(['Reconnect'])
    await expect(notes.getByRole('button')).toHaveCount(0)
    await expect(canvas.getByRole('button')).toHaveCount(0)
    await shoot(window, header, popover, 'mcp-popover')

    await tracker.getByRole('button', { name: 'Reconnect' }).click()
    await expect.poll(() => calls().filter((call) => call.kind === 'reconnectMcpServer')).toEqual([{ kind: 'reconnectMcpServer', name: 'example-tracker' }])
    await expect(chip.getByTestId('session-mcp-count')).toHaveText('3/3')
    await expect(chip).not.toHaveAttribute('data-warn', 'true')
    await expect(tracker.getByTestId('mcp-row-status')).toHaveText('connected')
    await expect(tracker.getByRole('button')).toHaveCount(0)
    // Turning a server off would write the user's .claude.json: it is never asked for.
    expect(calls().filter((call) => call.kind === 'toggleMcpServer')).toEqual([])

    // Escape closes the popover; the turn is not interrupted (nothing runs) and the chip keeps the focus.
    await popover.press('Escape')
    await expect(popover).toHaveCount(0)
    await expect(chip).toBeFocused()
  } finally {
    await app.close()
  }
})

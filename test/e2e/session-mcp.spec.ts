import { execFileSync } from 'node:child_process'
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
// status, tools, error and source, Reconnect on the failed one and Turn off for this Session on each
// connected one (ticket 03); opening it lets main take in new servers (one reloadPlugins()). A click on
// Reconnect goes to main (`agent.mcpAction`) and on to the agent: the fake records reconnectMcpServer("example-tracker") in
// WORFY_AGENT_LOG and makes the server connected, so the chip reads «MCP 3/3» and stops warning. The
// header with the open popover is shot in the light and the dark theme; with WORFY_EVIDENCE_DIR set, the
// shots are copied there.
//
// Allow in Project (worfy-mcp-live ticket 05): the Project has a Profile whose list `mcp.allowed` names
// example-notes and worfy-canvas, read through the repository's harness/bin/profile over a temporary Harness
// home (as edit-profile.spec.ts does), and the fake agent leaves out what the list does not name
// (WORFY_AGENT_MCP_ALLOWLIST=profile), as Claude Code's policy tier does. The MCP inventory — the fake agent's
// query with no list — finds example-tracker, so the popover shows it under «Not allowed in this Project» with
// Allow and the line about claude.ai connectors. A click on Allow writes the list through bin/profile-set and
// restarts the Session with the same conversation: the row leaves the group, the Profile names the server, and
// the new process resumed the same conversation.

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

/** The header with the open popover in both themes, as <test output>/session-mcp/<name>-<scheme>.png, copied to the evidence folder (as <ticket>-<name>-<scheme>.png) when one is set. */
async function shoot(window: Page, header: Locator, popover: Locator, name: string, ticket = '04'): Promise<void> {
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
        copyFileSync(path, join(EVIDENCE_DIR, `${ticket}-${name}-${scheme}.png`))
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
    // Opening the popover lets main take in a server allowed since the Session started (ticket 03): between
    // turns of an attended Session, one reloadPlugins(); this script adds none, so the rows stay as they are.
    await expect.poll(() => calls().filter((call) => call.kind === 'reloadPlugins')).toHaveLength(1)
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
    // Buttons only from the row's actions: the Claude driver offers Reconnect on a failed server, and Turn off
    // for this Session on a connected one of an attended Session (ticket 03).
    await expect(tracker.getByRole('button')).toHaveText(['Reconnect'])
    await expect(notes.getByRole('button')).toHaveText(['Turn off for this Session'])
    await expect(canvas.getByRole('button')).toHaveText(['Turn off for this Session'])
    await shoot(window, header, popover, 'mcp-popover')

    await tracker.getByRole('button', { name: 'Reconnect' }).click()
    await expect.poll(() => calls().filter((call) => call.kind === 'reconnectMcpServer')).toEqual([{ kind: 'reconnectMcpServer', name: 'example-tracker' }])
    await expect(chip.getByTestId('session-mcp-count')).toHaveText('3/3')
    await expect(chip).not.toHaveAttribute('data-warn', 'true')
    await expect(tracker.getByTestId('mcp-row-status')).toHaveText('connected')
    await expect(tracker.getByRole('button')).toHaveText(['Turn off for this Session'])
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

const HARNESS_BIN = join(import.meta.dirname, '..', '..', 'harness', 'bin')

/** A Profile for the Project alpha, with its list of MCP servers, and bin/profile and bin/profile-set over it in the Claude home. */
function profileWithList(allowed: readonly string[]): string {
  const harnessHome = join(scratch, 'harness-home')
  const home = join(scratch, 'home')
  const repo = join(scratch, 'alpha')
  for (const dir of [join(claudeHome, 'bin'), join(harnessHome, 'gate'), join(harnessHome, 'projects', 'alpha'), home]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(harnessHome, 'gate', 'config.json'), JSON.stringify({ repos: [{ key: 'alpha', match: repo, profile: 'alpha' }] }))
  const profileJson = join(harnessHome, 'projects', 'alpha', 'profile.json')
  const profile = { schema: 2, name: 'alpha', title: 'Alpha', mode: 'full', commands: { verify: 'make check' }, workflow: { finish: 'local-green' }, mcp: { allowed: allowed } }
  writeFileSync(profileJson, `${JSON.stringify(profile, null, 2)}\n`)
  writeFileSync(join(harnessHome, 'projects', 'alpha', 'rules.md'), '# alpha rules\n')
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd: harnessHome, env: gitEnv })
  git('init', '-q')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
  const env = { HARNESS_HOME: harnessHome, HOME: home, USERPROFILE: home }
  // The app finds both in its Claude home (the old layout); each runs the repository's script over the temporary Harness home.
  for (const script of ['profile', 'profile-set']) {
    writeFileSync(
      join(claudeHome, 'bin', script),
      [
        "const { spawnSync } = require('node:child_process')",
        `const env = { ...process.env, ...${JSON.stringify(env)} }`,
        'for (const name of ["CLAUDE_GATE_CONFIG", "CLAUDE_PROFILES_DIR", "EVAL_HARNESS_HOME"]) delete env[name]',
        `const run = spawnSync(process.execPath, [${JSON.stringify(join(HARNESS_BIN, script))}, ...process.argv.slice(2)], { stdio: 'inherit', env })`,
        'process.exit(run.status ?? 1)',
        '',
      ].join('\n'),
    )
  }
  return profileJson
}

test('Allow in Project: a server the Profile\'s list keeps out leaves «Not allowed» once allowed, in the same Session', async () => {
  const profileJson = profileWithList(['example-notes', 'worfy-canvas'])
  const app = await launchApp({
    env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'session-mcp', WORFY_AGENT_LOG: log, WORFY_AGENT_MCP_ALLOWLIST: 'profile' },
  })
  try {
    const { window } = app
    const view = await openSession(window)
    const header = view.locator('.w-session__header')
    const chip = header.getByTestId('session-mcp')

    await view.getByRole('textbox', { name: 'Message Orchestrator' }).fill('check the servers')
    await view.getByRole('textbox', { name: 'Message Orchestrator' }).press('Enter')
    await expect(view.getByTestId('transcript-turn-done')).toHaveCount(1)

    // The list keeps example-tracker out of the Session: two of two, the third not counted.
    await expect(chip.getByTestId('session-mcp-count')).toHaveText('2/2')
    await expect(chip).toHaveAttribute('title', /1 more not allowed in this Project/u)

    await chip.click()
    const popover = window.getByRole('dialog', { name: 'MCP servers' })
    const group = popover.getByTestId('mcp-not-allowed')
    const tracker = group.locator('[data-testid="mcp-row"][data-name="example-tracker"]')
    await expect(tracker.getByTestId('mcp-row-status')).toHaveText('not allowed')
    await expect(tracker.getByRole('button')).toHaveText(['Allow'])
    await expect(group.getByTestId('mcp-connector-hint')).toBeVisible()
    await shoot(window, header, popover, 'mcp-not-allowed', '05')

    await tracker.getByRole('button', { name: 'Allow' }).click()
    // The row leaves the group: the Session restarted with the list that names it.
    await expect(popover.getByTestId('mcp-not-allowed')).toHaveCount(0)
    const allowed = popover.locator('[data-testid="mcp-row"][data-name="example-tracker"]')
    await expect(allowed.getByTestId('mcp-row-status')).toHaveText('failed')
    await expect(allowed.getByRole('button')).toHaveText(['Reconnect'])
    await expect(chip.getByTestId('session-mcp-count')).toHaveText('2/3')
    const written = JSON.parse(readFileSync(profileJson, 'utf8')) as { mcp: { allowed: string[] } }
    expect(written.mcp.allowed).toEqual(['example-notes', 'worfy-canvas', 'example-tracker'])
    // The same conversation in a new process: the second start resumes the first one's session.
    const starts = calls().filter((call) => call.kind === 'start') as unknown as { resume: string | null }[]
    expect(starts).toHaveLength(2)
    expect(starts[1]?.resume).not.toBeNull()
    expect(calls().filter((call) => call.kind === 'toggleMcpServer')).toEqual([])
  } finally {
    await app.close()
  }
})

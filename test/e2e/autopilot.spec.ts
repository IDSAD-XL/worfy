import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { AUTOPILOT_RUNNING_HINT } from '../../src/main/actions/launch'
import { SELF_PROJECT_MESSAGE } from '../../src/main/autopilot/run'
import { launchApp, repoRoot } from './helpers'

// Autopilot on an Epic frame (worfy-daily ticket 04, ADR-0024) in the built app on the fake agent,
// which records every message it gets (WORFY_AGENT_LOG) and never calls the model. It plays
// `orchestrator`: its first turn holds until it is interrupted, so the run stays in Wave 1 until
// the test stops it. Electron's powerSaveBlocker is replaced in main before the run starts, so the
// test never keeps the Mac awake; the replacement records what the run asked for.
//
// The Project is a git repository in a temporary folder with the Epic `demo`: 01 and 02 ready, 03
// after both. A second Project points at this worktree, worfy's own repository: on this
// development build Autopilot refuses it.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'demo-000000a4'
const SELF = 'worfy-5e1f0000'
const EPIC = 'demo'

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }

let scratch: string

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

const TICKETS = [
  { num: 1, blocked: [] as number[] },
  { num: 2, blocked: [] as number[] },
  { num: 3, blocked: [1, 2] },
]
const nn = (num: number): string => String(num).padStart(2, '0')

function ticketFile({ num, blocked }: (typeof TICKETS)[number]): string {
  const blockers = blocked.length ? blocked.map(nn).join(', ') : '—'
  return [`# ${nn(num)} — Ticket ${num}`, '', 'Type: task', 'Status: open', `Blocked by: ${blockers}`, '', '## Где в коде', '', `- \`src/f${num}.ts\``, ''].join('\n')
}

/** The messages the fake agent got, in order. */
function messages(log: string): string[] {
  if (!existsSync(log)) return []
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { kind: string; text?: string })
    .filter((call) => call.kind === 'message')
    .map((call) => call.text ?? '')
}

/** The kinds of the lines of the only run journal in the data folder. */
function journalKinds(dataDir: string): string[] {
  const dir = join(dataDir, 'autopilot')
  if (!existsSync(dir)) return []
  const files = readdirSync(dir)
  if (files.length !== 1) return [`${files.length} journals`]
  return readFileSync(join(dir, files[0]!), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const event = JSON.parse(line) as { kind: string; reason?: string; wave?: number }
      return [event.kind, event.wave ?? event.reason].filter((part) => part !== undefined).join(' ')
    })
}

const bridgeCall = (window: Page, channel: string, input?: unknown) =>
  window.evaluate(([name, value]) => (globalThis as unknown as { worfy: Bridge }).worfy.invoke(name as string, value), [channel, input] as const)

/** The Epic frame's header in both themes, kept with the test's output for the F-SPEC review. */
async function snapshots(window: Page, header: Locator, name: string): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    await header.screenshot({ path: test.info().outputPath(`${name}-${scheme}.png`) })
  }
  await window.emulateMedia({ colorScheme: null })
}

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-autopilot-')))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

test('Autopilot on an Epic: starts Wave 1, shows its state, refuses Run wave meanwhile, and stops on Stop', async () => {
  const dataDir = join(scratch, 'data')
  const claudeHome = join(scratch, 'claude-home')
  const log = join(scratch, 'agent.jsonl')
  const repo = join(scratch, 'demo')

  const issues = join(repo, '.scratch', EPIC, 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# Demo epic\n')
  for (const ticket of TICKETS) writeFileSync(join(issues, `${nn(ticket.num)}-ticket-${ticket.num}.md`), ticketFile(ticket))
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')

  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: [{ epic: EPIC, hasSpec: true, hasMap: false }],
      tickets: TICKETS.map(({ num, blocked }) => ({
        epic: EPIC,
        num,
        slug: `ticket-${num}`,
        title: `${nn(num)} — Ticket ${num}`,
        statusRaw: 'open',
        state: 'open',
        blockedRaw: blocked.length ? blocked.map(nn).join(', ') : '—',
        blockedNums: blocked,
        blockedParsed: true,
      })),
    }),
  )
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), `#!/bin/sh\ncat '${answer}'\n`)
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)

  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(
    join(dataDir, 'projects.json'),
    JSON.stringify({
      projects: [
        { id: PROJECT, name: 'demo', path: repo },
        { id: SELF, name: 'worfy', path: repoRoot },
      ],
      activeId: PROJECT,
    }),
  )
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 20, y: 20, zoom: 0.8 } }))
  const statusBefore = git(repo, 'status', '--porcelain')

  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'orchestrator', WORFY_AGENT_LOG: log }
  const launched = await launchApp({ env })
  try {
    const { window, app } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1400, 900))
    // keep-awake: recorded, never the real one.
    await app.evaluate(({ powerSaveBlocker }) => {
      const calls: string[] = []
      const started = new Set<number>()
      let next = 100
      ;(globalThis as unknown as { power: string[] }).power = calls
      powerSaveBlocker.start = (type) => {
        next += 1
        started.add(next)
        calls.push(`start ${type}`)
        return next
      }
      powerSaveBlocker.stop = (id) => {
        started.delete(id)
        calls.push('stop')
        return true
      }
      powerSaveBlocker.isStarted = (id) => started.has(id)
    })
    const power = () => app.evaluate(() => [...(globalThis as unknown as { power: string[] }).power])

    const frame = window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`)
    const header = frame.locator('header')
    const autopilot = frame.getByTestId('action-autopilot')
    const stop = frame.getByTestId('action-stop-autopilot')
    const status = frame.getByTestId('autopilot-status')
    const runWave = frame.getByTestId('action-run-wave')
    await expect(autopilot).toBeVisible()
    await expect(window.getByTestId('orchestrator-node')).toBeVisible()

    // Before a run: active, no status line.
    await expect(autopilot).toHaveAttribute('aria-disabled', 'false')
    await expect(autopilot).toHaveText('Autopilot')
    await expect(status).toHaveCount(0)
    await snapshots(window, header, 'autopilot-idle')

    // On worfy's own repository this development build refuses, with the reason.
    const self = await bridgeCall(window, 'autopilot.start', { projectId: SELF, epic: 'worfy-daily' })
    expect(self).toEqual({ ok: false, error: `autopilot.start failed: ${SELF_PROJECT_MESSAGE}` })

    // Start: Wave 1 goes to the Orchestrator, now unattended.
    await autopilot.click()
    await expect(status).toHaveText('Wave 1 · running')
    await expect(stop).toHaveText('Stop autopilot')
    await expect(autopilot).toHaveCount(0)
    await expect.poll(() => messages(log)).toEqual([`/epic-wave волна 1 эпика ${EPIC}`])
    expect(await power()).toEqual(['start prevent-app-suspension'])
    await snapshots(window, header, 'autopilot-running')

    // A second start, and "Run wave" by hand, are refused while the run goes on.
    const twice = await bridgeCall(window, 'autopilot.start', { projectId: PROJECT, epic: EPIC })
    expect(twice).toMatchObject({ ok: false, error: expect.stringContaining('Autopilot is already running') as unknown as string })
    await runWave.click()
    await expect(runWave).toHaveAttribute('data-error', AUTOPILOT_RUNNING_HINT)
    expect(messages(log)).toHaveLength(1)

    // Stop: the run ends with user-stop; keep-awake is released.
    await stop.click()
    await expect(status).toHaveText('stopped: user stop')
    await expect(autopilot).toHaveText('Autopilot')
    expect(await power()).toEqual(['start prevent-app-suspension', 'stop'])
    expect(journalKinds(dataDir)).toEqual(['run-started', 'wave-started 1', 'run-stopped user-stop'])
    await snapshots(window, header, 'autopilot-stopped')

    // worfy wrote nothing into the repository.
    expect(git(repo, 'status', '--porcelain')).toBe(statusBefore)
  } finally {
    await launched.close()
  }
})

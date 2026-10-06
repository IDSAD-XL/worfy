import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launchApp, repoRoot } from './helpers'

// The Limits in the toolbar against the built app, on the fake agent: the script
// test/fixtures/agent-scripts/limits.jsonl sends a rate_limit_event with both windows on turn 1
// and one without utilization and resetsAt on turn 2. Then the app is restarted over the same
// WORFY_DATA_DIR, and finally statusline-limits.json (what scripts/statusline-bridge.sh writes)
// is replaced while the app runs.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

type Bridge = {
  invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }>
  on(channel: string, handler: (payload: unknown) => void): number
}

let scratch: string
let dataDir: string
let project: string

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-limits-')))
  dataDir = join(scratch, 'data')
  project = join(scratch, 'project')
  mkdirSync(dataDir)
  mkdirSync(project)
})

test.afterEach(async () => {
  await removeDir(scratch)
})

/** Plays `turns` turns of the fake script in one Session and waits for each turn's result. */
async function playTurns(window: Page, cwd: string, turns: number): Promise<void> {
  await window.evaluate(
    async ({ cwd, turns }) => {
      const bridge = (globalThis as unknown as { worfy: Bridge }).worfy
      let results = 0
      let onResult = (): void => undefined
      bridge.on('agent.event', (payload) => {
        if ((payload as { event: { type: string } }).event.type === 'result') {
          results++
          onResult()
        }
      })
      const started = await bridge.invoke('agent.start', { cwd })
      if (!started.ok) throw new Error(started.error)
      const { sessionId } = started.value as { sessionId: string }
      for (let turn = 1; turn <= turns; turn++) {
        const done = new Promise<void>((resolve) => {
          onResult = () => {
            if (results >= turn) resolve()
          }
        })
        const sent = await bridge.invoke('agent.send', { sessionId, text: `turn ${turn}` })
        if (!sent.ok) throw new Error(sent.error)
        await done
      }
      await bridge.invoke('agent.close', { sessionId })
    },
    { cwd, turns },
  )
}

const meter = (window: Page) => window.getByTestId('limits-meter')

/** The 7-day reset time in test/fixtures/agent-scripts/limits.jsonl, turn 1 (Unix seconds). */
const FIXTURE_SEVEN_DAY_RESET = '1791795600'

/**
 * The `limits` script with its 7-day reset three days from now, in a scripts folder of the test:
 * the fixture's time is a fixed one, and what turn 2 shows depends on it still being ahead.
 */
function limitsScripts(): string {
  const fixture = readFileSync(join(repoRoot, 'test', 'fixtures', 'agent-scripts', 'limits.jsonl'), 'utf8')
  if (!fixture.includes(FIXTURE_SEVEN_DAY_RESET)) throw new Error('the limits fixture no longer has its 7-day reset time')
  const scripts = join(scratch, 'scripts')
  mkdirSync(scripts, { recursive: true })
  writeFileSync(join(scripts, 'limits.jsonl'), fixture.replaceAll(FIXTURE_SEVEN_DAY_RESET, String(Math.floor(Date.now() / 1000) + 3 * 24 * 3600)))
  return scripts
}

test('rate_limit_event fills the toolbar bars, they survive a restart marked with their age, and the status line file updates them', async () => {
  const scripts = limitsScripts()
  const first = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_AGENT_SCRIPTS: scripts, WORFY_AGENT_SCRIPT: 'limits' } })
  try {
    await expect(meter(first.window)).toHaveText(/Limits\s*no data yet/)

    await playTurns(first.window, project, 1)
    const fiveHour = meter(first.window).getByTestId('limit-five_hour')
    const sevenDay = meter(first.window).getByTestId('limit-seven_day')
    await expect(fiveHour.getByTestId('limit-five_hour-value')).toHaveText('62%')
    await expect(fiveHour.getByTestId('limit-five_hour-note')).toHaveText(/^resets \d\d:\d\d$/)
    await expect(fiveHour.getByRole('meter', { name: '5-hour limit' })).toHaveAttribute('aria-valuenow', '62')
    await expect(fiveHour).toHaveAttribute('data-level', 'working')
    await expect(sevenDay.getByTestId('limit-seven_day-value')).toHaveText('38%')
    await expect(sevenDay.getByTestId('limit-seven_day-note')).toHaveText(/^resets [A-Z][a-z]{2} \d\d:\d\d$/)
    await expect(sevenDay).toHaveAttribute('data-level', 'normal')
    await first.window.getByRole('banner').screenshot({ path: test.info().outputPath('toolbar-limits.png') })

    // Turn 2: an event without utilization and resetsAt; the 7-day bar shows its status in words.
    // It keeps the reset time known from turn 1, which is still ahead (worfy-daily ticket 05:
    // Autopilot waits by it).
    await playTurns(first.window, project, 2)
    await expect(sevenDay.getByTestId('limit-seven_day-value')).toHaveText('limit reached')
    await expect(sevenDay).toHaveAttribute('data-level', 'blocked')
    await expect(sevenDay.getByRole('meter')).toHaveCount(0)
    await expect(sevenDay.getByTestId('limit-seven_day-note')).toHaveText(/^resets [A-Z][a-z]{2} \d\d:\d\d$/)
    await expect(fiveHour.getByTestId('limit-five_hour-value')).toHaveText('62%')
  } finally {
    await first.close()
  }

  // Back-date what was saved by two hours: after the restart the bars carry "as of".
  const file = join(dataDir, 'limits.json')
  const saved = JSON.parse(readFileSync(file, 'utf8')) as { windows: Record<string, { receivedAt: number }> }
  for (const window of Object.values(saved.windows)) window.receivedAt -= 2 * 60 * 60 * 1000
  writeFileSync(file, JSON.stringify(saved))

  const second = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_AGENT_SCRIPTS: scripts, WORFY_AGENT_SCRIPT: 'limits' } })
  try {
    const fiveHour = meter(second.window).getByTestId('limit-five_hour')
    await expect(fiveHour.getByTestId('limit-five_hour-value')).toHaveText('62%')
    await expect(fiveHour.getByTestId('limit-five_hour-note')).toHaveText(/^resets \d\d:\d\d · as of \d\d:\d\d$|^resets \d\d:\d\d · as of [A-Z][a-z]{2} \d\d:\d\d$/)
    await expect(meter(second.window).getByTestId('limit-seven_day-value')).toHaveText('limit reached')

    // The status line bridge's file, replaced by a rename as the script does it.
    const temporary = join(dataDir, '.statusline-limits.json.e2e')
    writeFileSync(temporary, JSON.stringify({ five_hour: { used_percentage: 91, resets_at: 1791202800 }, seven_day: { used_percentage: 9, resets_at: 1791777600 } }))
    renameSync(temporary, join(dataDir, 'statusline-limits.json'))

    await expect(fiveHour.getByTestId('limit-five_hour-value')).toHaveText('91%')
    await expect(fiveHour).toHaveAttribute('data-level', 'blocked')
    await expect(fiveHour.getByTestId('limit-five_hour-note')).toHaveText(/^resets \d\d:\d\d$/)
    await expect(meter(second.window).getByTestId('limit-seven_day-value')).toHaveText('9%')
  } finally {
    await second.close()
  }
})

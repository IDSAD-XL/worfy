import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
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
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-limits-')))
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

/** The DOM the page side of textBoxes uses; the e2e tests are compiled without the DOM library. */
interface PageElement {
  ownerDocument: { createRange(): { selectNodeContents(node: unknown): void; getBoundingClientRect(): { x: number; y: number; width: number; height: number } } }
  querySelectorAll(selector: string): Iterable<PageElement>
  scrollWidth: number
  clientWidth: number
}

interface TextBox {
  x: number
  y: number
  width: number
  height: number
  /** Whether some text of the element is hidden: wider than its box, or ended with an ellipsis. */
  cut: boolean
}

/**
 * The box of each element's text as drawn, not of the element: a line that does not wrap runs
 * past its element's box, and that overflow is what overlaps the next bar.
 */
async function textBoxes<K extends string>(window: Page, elements: Record<K, Locator>): Promise<Record<K, TextBox>> {
  const result = {} as Record<K, TextBox>
  for (const [name, locator] of Object.entries(elements) as [K, Locator][]) {
    result[name] = await locator.evaluate((node) => {
      const element = node as unknown as PageElement
      const range = element.ownerDocument.createRange()
      range.selectNodeContents(element)
      const rect = range.getBoundingClientRect()
      const lines = [element, ...element.querySelectorAll('*')]
      const cut = lines.some((line) => line.scrollWidth > line.clientWidth && line.clientWidth > 0)
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, cut }
    })
  }
  return result
}

const overlap = (a: TextBox, b: TextBox): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

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

  // Back-date what was saved by two days: after the restart the bars are dimmed and their tooltip
  // says "as of" with a weekday; on screen they keep two lines of text, the label and the reset time
  // (worfy-ui ticket 18: no "as of" line).
  const file = join(dataDir, 'limits.json')
  const saved = JSON.parse(readFileSync(file, 'utf8')) as { windows: Record<string, { receivedAt: number }> }
  for (const window of Object.values(saved.windows)) window.receivedAt -= 2 * 24 * 60 * 60 * 1000
  writeFileSync(file, JSON.stringify(saved))

  const second = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_AGENT_SCRIPTS: scripts, WORFY_AGENT_SCRIPT: 'limits' } })
  try {
    const fiveHour = meter(second.window).getByTestId('limit-five_hour')
    const sevenDay = meter(second.window).getByTestId('limit-seven_day')
    await expect(fiveHour.getByTestId('limit-five_hour-value')).toHaveText('62%')
    await expect(sevenDay.getByTestId('limit-seven_day-value')).toHaveText('limit reached')
    // The tooltip keeps the value, so a cut "limit reached" stays readable.
    await expect(fiveHour).toHaveAttribute('title', /^62% · as of [A-Z][a-z]{2} \d\d:\d\d$/)
    await expect(sevenDay).toHaveAttribute('title', /^limit reached · as of [A-Z][a-z]{2} \d\d:\d\d$/)
    for (const bar of [fiveHour, sevenDay]) {
      await expect(bar).toHaveAttribute('data-stale', 'true')
      await expect(bar).not.toContainText('as of')
      expect(Number(await bar.evaluate((node) => (node as unknown as { style: { opacity: string } }).style.opacity))).toBeLessThan(1)
    }

    // The notes fit their bars: the text of the 5-hour note, the 7-day note, the app version and
    // the search field do not overlap, and no note text is cut.
    const boxes = await textBoxes(second.window, {
      fiveHour: fiveHour.getByTestId('limit-five_hour-note'),
      sevenDay: sevenDay.getByTestId('limit-seven_day-note'),
      version: second.window.getByTestId('app-version'),
      search: second.window.locator('.w-toolbar__palette-hint'),
      // "limit reached" in place of a share: on the label's line, whole.
      sevenDayValue: sevenDay.getByTestId('limit-seven_day-value'),
    })
    expect(boxes.sevenDayValue.cut, '"limit reached" is cut').toBe(false)
    expect(boxes.sevenDayValue.height, '"limit reached" is one line').toBeLessThan(20)
    const toolbar = await second.window.getByRole('banner').boundingBox()
    for (const [a, b] of [['fiveHour', 'sevenDay'], ['sevenDay', 'version'], ['sevenDay', 'search'], ['fiveHour', 'version'], ['fiveHour', 'search']] as const) {
      expect(overlap(boxes[a], boxes[b]), `${a} ${JSON.stringify(boxes[a])} and ${b} ${JSON.stringify(boxes[b])}`).toBe(false)
    }
    for (const name of ['fiveHour', 'sevenDay'] as const) {
      expect(boxes[name].cut, `${name} note is cut`).toBe(false)
      expect(boxes[name].y >= toolbar!.y && boxes[name].y + boxes[name].height <= toolbar!.y + toolbar!.height, `${name} note inside the toolbar`).toBe(true)
    }
    // One line under the bar, the reset time; the bar is no taller than a fresh one (the toolbar never grows).
    await expect(fiveHour.getByTestId('limit-five_hour-note')).toHaveText(/^resets \d\d:\d\d$/)
    await expect(sevenDay.getByTestId('limit-seven_day-note')).toHaveText(/^resets [A-Z][a-z]{2} \d\d:\d\d$/)
    const staleHeight = (await fiveHour.boundingBox())!.height
    expect(staleHeight, 'an old bar is two text lines and the meter').toBeLessThanOrEqual(40)
    await second.window.getByRole('banner').screenshot({ path: test.info().outputPath('toolbar-limits-as-of.png') })

    // The status line bridge's file, replaced by a rename as the script does it.
    const temporary = join(dataDir, '.statusline-limits.json.e2e')
    writeFileSync(temporary, JSON.stringify({ five_hour: { used_percentage: 91, resets_at: 1791202800 }, seven_day: { used_percentage: 9, resets_at: 1791777600 } }))
    renameSync(temporary, join(dataDir, 'statusline-limits.json'))

    await expect(fiveHour.getByTestId('limit-five_hour-value')).toHaveText('91%')
    await expect(fiveHour).toHaveAttribute('data-level', 'blocked')
    await expect(fiveHour.getByTestId('limit-five_hour-note')).toHaveText(/^resets \d\d:\d\d$/)
    // Fresh again: no longer dimmed, no tooltip, and the same height as when it was old.
    await expect(fiveHour).not.toHaveAttribute('data-stale', 'true')
    await expect(fiveHour).not.toHaveAttribute('title', /as of/)
    expect((await fiveHour.boundingBox())!.height).toBe(staleHeight)
    await expect(meter(second.window).getByTestId('limit-seven_day-value')).toHaveText('9%')
  } finally {
    await second.close()
  }
})

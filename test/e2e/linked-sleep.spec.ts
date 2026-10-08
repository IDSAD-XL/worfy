// The Project machine stays awake while Linked machines are connected, and says "going to sleep"
// (worfy-link ticket 14), on two built worfy linked by the helper of worfy-link ticket 02.
//
// powerMonitor is Electron's real module: emitting `suspend` in main runs worfy's listeners and
// does not put the Mac to sleep, so this checks worfy's reaction, not the sleep itself.
// powerSaveBlocker is replaced in main by one that records the calls, so no test keeps the Mac
// awake.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, launchLinkedPair, machineIdOf } from './helpers'

test.setTimeout(120_000)

const KEEP_AWAKE = 'Keep this computer awake while linked machines are connected'
const ACCESS = 'Linked machines can work with my Projects'

const row = (window: Page, machineId: string) => window.locator(`[data-testid="machine-row"][data-machine-id="${machineId}"]`)

/** Replaces Electron's powerSaveBlocker in main by one that records the calls; answers the reader of the record. */
async function recordPower(app: ElectronApplication): Promise<() => Promise<string[]>> {
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
  return () => app.evaluate(() => [...(globalThis as unknown as { power: string[] }).power])
}

test('suspend on A: B shows A as sleeping; resume: online again', async () => {
  const pair = await launchLinkedPair()
  try {
    const { a, b, aId } = pair
    await expect(row(b.window, aId)).toHaveAttribute('data-state', 'online')

    await a.app.evaluate(({ powerMonitor }) => {
      powerMonitor.emit('suspend')
    })
    await expect(row(b.window, aId)).toHaveAttribute('data-state', 'sleeping')
    await expect(row(b.window, aId)).toContainText('Sleeping')

    await a.app.evaluate(({ powerMonitor }) => {
      powerMonitor.emit('resume')
    })
    await expect(row(b.window, aId)).toHaveAttribute('data-state', 'online')
    await expect(row(b.window, aId)).toContainText('Online')
  } finally {
    await pair.close()
  }
})

test('A holds one prevent-app-suspension blocker while B is connected and both switches are on', async () => {
  const pair = await launchLinkedPair()
  try {
    const { a, bId } = pair
    const power = await recordPower(a.app)
    await expect(row(a.window, bId)).toHaveAttribute('data-state', 'online')
    // Access is off on a fresh Machine: nothing is held yet.
    expect(await power()).toEqual([])

    await a.window.getByRole('switch', { name: ACCESS }).click()
    await expect.poll(power).toEqual(['start prevent-app-suspension'])
    await a.window.getByRole('switch', { name: KEEP_AWAKE }).click()
    await expect.poll(power).toEqual(['start prevent-app-suspension', 'stop'])
    await a.window.getByRole('switch', { name: KEEP_AWAKE }).click()
    await expect.poll(power).toEqual(['start prevent-app-suspension', 'stop', 'start prevent-app-suspension'])
  } finally {
    await pair.close()
  }
})

test('the keep-awake switch is on on a fresh Machine and stays off across a restart once turned off', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'worfy-link-keep-awake-'))
  try {
    const first = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
    try {
      await machineIdOf(first.window)
      const toggle = first.window.getByRole('switch', { name: KEEP_AWAKE })
      await expect(toggle).toBeVisible()
      await expect(toggle).toHaveAttribute('aria-checked', 'true')
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-checked', 'false')
    } finally {
      await first.close()
    }
    const second = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
    try {
      await machineIdOf(second.window)
      await expect(second.window.getByRole('switch', { name: KEEP_AWAKE })).toHaveAttribute('aria-checked', 'false')
    } finally {
      await second.close()
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

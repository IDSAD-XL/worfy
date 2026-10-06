import { test } from '@playwright/test'
import { launchApp } from './helpers'

// TEMPORARY (worfy-daily/21): prints the CI runner's display and when the window is shown relative
// to a setSize sent right after launch. Removed before the PR leaves draft.
test('probe: display size and the window shown before or after setSize', async () => {
  for (let run = 0; run < 5; run += 1) {
    const launched = await launchApp()
    try {
      const { app, window } = launched
      const state = () =>
        app.evaluate(({ BrowserWindow, screen }) => {
          const w = BrowserWindow.getAllWindows()[0]
          return { visible: w?.isVisible(), bounds: w?.getBounds(), displays: screen.getAllDisplays().map((d) => ({ bounds: d.bounds, workArea: d.workArea, scale: d.scaleFactor })) }
        })
      const before = await state()
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1600, 1000))
            await new Promise((done) => setTimeout(done, 1500))
      const after = await state()
      console.info(`PROBE-DISPLAY run ${run}: before ${JSON.stringify(before)} after ${JSON.stringify(after)} inner ${JSON.stringify(await window.evaluate(() => { const g = globalThis as unknown as { innerWidth: number; innerHeight: number }; return [g.innerWidth, g.innerHeight] }))}`)
    } finally {
      await launched.close()
    }
  }
})

// Starting Autopilot from an Epic frame in an e2e test (worfy-autopilot-queue ticket 09): since that
// ticket the Autopilot button opens the Start Autopilot window (src/renderer/autopilot/StartAutopilotModal.tsx)
// instead of starting the run, and its main button — "Start Autopilot", or "Start when free" while the
// Orchestrator is busy — starts it in the Run mode chosen there. Every test that pressed the button to
// start a run goes through startAutopilot.
import { expect, type Locator, type Page } from '@playwright/test'
import type { RunMode } from '../../src/shared/autopilot/run-mode'

/** The Start Autopilot window of the page. */
export const startWindow = (page: Page): Locator => page.getByTestId('start-autopilot')

export interface StartAutopilotOptions {
  /** The Run mode to choose in the window; absent: the default of Settings → Autopilot, chosen as the window opens. */
  mode?: RunMode
}

/**
 * Presses the Autopilot button (`button`, the `action-autopilot` of an Epic frame), chooses `mode` in the
 * window it opens and presses its main button. Resolves once the window has closed: main has answered,
 * and the run went, waits for the Orchestrator or was refused (the error toast and the button's reason).
 */
export async function startAutopilot(button: Locator, options: StartAutopilotOptions = {}): Promise<void> {
  await button.click()
  const dialog = startWindow(button.page())
  await expect(dialog).toBeVisible()
  if (options.mode !== undefined) {
    const mode = dialog.getByTestId(`start-autopilot-mode-${options.mode}`)
    await mode.click()
    await expect(mode).toHaveAttribute('aria-checked', 'true')
  }
  await dialog.getByTestId('start-autopilot-start').click()
  await expect(dialog).toHaveCount(0)
}

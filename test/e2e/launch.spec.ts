import { realpath } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { launchApp } from './helpers'

test('the app opens a window titled worfy that shows the text worfy', async () => {
  const launched = await launchApp()
  try {
    await expect(launched.window).toHaveTitle('worfy')
    await expect(launched.window.getByText('worfy', { exact: true })).toBeVisible()
  } finally {
    await launched.close()
  }
})

test("Electron's own files go to WORFY_DATA_DIR, not the real Application Support", async () => {
  const launched = await launchApp()
  try {
    const userData = await launched.app.evaluate(({ app }) => app.getPath('userData'))
    expect(await realpath(userData)).toBe(await realpath(launched.dataDir))
  } finally {
    await launched.close()
  }
})

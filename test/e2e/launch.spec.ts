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

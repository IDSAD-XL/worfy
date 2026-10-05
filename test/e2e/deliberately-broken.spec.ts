import { expect, test } from '@playwright/test'
import { launchApp } from './helpers'

// Temporary: proves that a failing e2e test turns the CI check red (ticket worfy-mvp/32).
test('deliberately broken e2e test', async () => {
  const launched = await launchApp()
  try {
    await expect(launched.window).toHaveTitle('not worfy', { timeout: 2_000 })
  } finally {
    await launched.close()
  }
})

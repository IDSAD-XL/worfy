import { readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, repoRoot } from './helpers'

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

test('the window shows the build version of the Harness copy, which main returns over app.version', async () => {
  // The expected value comes from the files of the build, not from the same calls the handler
  // makes: a handler that reports another version (Electron's, say) must fail here. The build
  // writes `<package.json version>+<short SHA>[.dirty]` into out/harness (electron.vite.config.ts).
  const { version } = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as { version: string }
  const manifest = JSON.parse(await readFile(join(repoRoot, 'out', 'harness', '.claude-plugin', 'plugin.json'), 'utf8')) as { version: string }
  expect(manifest.version.startsWith(`${version}+`)).toBe(true)
  expect(manifest.version.slice(version.length)).toMatch(/^\+[0-9a-f]{7,}(\.dirty)?$/)
  const launched = await launchApp()
  try {
    expect(manifest.version).not.toBe(await launched.app.evaluate(() => process.versions.electron))
    await expect(launched.window.getByTestId('app-version')).toHaveText(`v${manifest.version}`)
  } finally {
    await launched.close()
  }
})

test('the renderer reaches main only through window.worfy, and a bad input comes back as {ok:false}', async () => {
  const launched = await launchApp()
  try {
    const result = await launched.window.evaluate(() =>
      (globalThis as unknown as { worfy: { invoke(c: string, i: unknown): Promise<unknown> } }).worfy.invoke('app.version', 42),
    )
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/app\.version: invalid input/) })
    // main is still serving after the bad call
    await expect(launched.window.getByTestId('app-version')).toBeVisible()
    const again = await launched.window.evaluate(() =>
      (globalThis as unknown as { worfy: { invoke(c: string, i?: unknown): Promise<unknown> } }).worfy.invoke('app.version'),
    )
    expect(again).toMatchObject({ ok: true })
  } finally {
    await launched.close()
  }
})

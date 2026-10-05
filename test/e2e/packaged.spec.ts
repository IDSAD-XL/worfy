import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { launchApp } from './helpers'

// These tests drive the packaged worfy.app that `pnpm test:package` builds into dist/.
// They carry the @packaged tag: `pnpm test:e2e` leaves them out, `pnpm test:package` runs only them.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const distDir = join(repoRoot, 'dist')

/** electron-builder writes the .app to dist/mac-arm64/ or dist/mac/, depending on the arch. */
function packagedApp(): string {
  const apps = existsSync(distDir)
    ? readdirSync(distDir)
        .filter((name) => name.startsWith('mac'))
        .map((name) => join(distDir, name, 'worfy.app'))
        .filter((app) => existsSync(app))
    : []
  const [app, ...others] = apps
  if (app === undefined || others.length > 0) {
    throw new Error(`Expected exactly one dist/mac*/worfy.app, found ${apps.length}. Run \`pnpm test:package\`.`)
  }
  return app
}

/** Launches the packaged app through the shared e2e helper, with the same isolated directories. */
function launchPackagedApp(): ReturnType<typeof launchApp> {
  return launchApp({ executablePath: join(packagedApp(), 'Contents', 'MacOS', 'worfy') })
}

test('the packaged worfy.app is ad-hoc signed by electron-builder with the worfy bundle id', { tag: '@packaged' }, () => {
  const app = packagedApp()
  // codesign prints the signature details to stderr.
  const details = spawnSync('codesign', ['-dv', app], { encoding: 'utf8' })
  expect(details.status).toBe(0)
  // The stock Electron binary carries its own linker signature with Identifier=Electron, so the
  // bundle id is what shows that electron-builder signed the app.
  expect(details.stderr).toMatch(/^Identifier=dev\.worfy\.app$/m)
  expect(details.stderr).toMatch(/^Signature=adhoc$/m)
  const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', app], { encoding: 'utf8' })
  expect(verify.stderr).toBe('')
  expect(verify.status).toBe(0)
})

test('the packaged worfy.app starts and shows a window titled worfy', { tag: '@packaged' }, async () => {
  const launched = await launchPackagedApp()
  try {
    expect(await launched.app.evaluate(({ app }) => app.isPackaged)).toBe(true)
    await expect(launched.window).toHaveTitle('worfy')
    await expect(launched.window.getByText('worfy', { exact: true })).toBeVisible()
  } finally {
    await launched.close()
  }
})

test('node-pty loads from the packaged app and runs a command', { tag: '@packaged' }, async () => {
  const launched = await launchPackagedApp()
  try {
    const result = await launched.app.evaluate(async ({ app }) => {
      // The main bundle does not import node-pty yet, so resolve it the way the app will:
      // from the app's own node_modules inside app.asar.
      const { createRequire } = process.getBuiltinModule('node:module')
      const requireFromApp = createRequire(`${app.getAppPath()}/package.json`)
      const pty = requireFromApp('node-pty') as typeof import('node-pty')
      const resolved = requireFromApp.resolve('node-pty')
      const proc = pty.spawn('/bin/echo', ['ok'], { name: 'xterm-color', cols: 80, rows: 24, env: {} })
      let output = ''
      proc.onData((chunk) => {
        output += chunk
      })
      const exitCode = await new Promise<number>((done) => {
        proc.onExit(({ exitCode: code }) => done(code))
      })
      // The binary rebuilt for Electron by postinstall, outside the archive.
      const { existsSync: exists } = process.getBuiltinModule('node:fs')
      const unpackedBinary = `${process.resourcesPath}/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node`
      return { resolved, output: output.trim(), exitCode, unpacked: exists(unpackedBinary) }
    })
    expect(result.resolved).toContain('app.asar')
    expect(result.unpacked).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.output).toBe('ok')
  } finally {
    await launched.close()
  }
})

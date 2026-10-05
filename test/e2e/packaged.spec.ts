import { existsSync, readdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron, expect, test, type ElectronApplication } from '@playwright/test'

// These tests drive the packaged worfy.app that `pnpm test:package` builds into dist/.
// They carry the @packaged tag: `pnpm test:e2e` leaves them out, `pnpm test:package` runs only them.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const distDir = join(repoRoot, 'dist')

/** electron-builder writes the .app to dist/mac-arm64/ or dist/mac/, depending on the arch. */
function packagedExecutable(): string {
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
  return join(app, 'Contents', 'MacOS', 'worfy')
}

interface LaunchedPackagedApp {
  app: ElectronApplication
  close: () => Promise<void>
}

async function launchPackagedApp(): Promise<LaunchedPackagedApp> {
  const dataDir = await mkdtemp(join(tmpdir(), 'worfy-data-'))
  const claudeHome = await mkdtemp(join(tmpdir(), 'worfy-claude-'))
  const cleanDirs = async (): Promise<void> => {
    await rm(dataDir, { recursive: true, force: true })
    await rm(claudeHome, { recursive: true, force: true })
  }

  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  Object.assign(env, { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT: 'fake' })

  try {
    const app = await _electron.launch({ executablePath: packagedExecutable(), env })
    return {
      app,
      close: async () => {
        await app.close()
        await cleanDirs()
      },
    }
  } catch (error) {
    await cleanDirs()
    throw error
  }
}

test('the packaged worfy.app starts and shows a window titled worfy', { tag: '@packaged' }, async () => {
  const launched = await launchPackagedApp()
  try {
    expect(await launched.app.evaluate(({ app }) => app.isPackaged)).toBe(true)
    const window = await launched.app.firstWindow()
    await expect(window).toHaveTitle('worfy')
    await expect(window.getByText('worfy', { exact: true })).toBeVisible()
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

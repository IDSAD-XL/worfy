import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron, type ElectronApplication, type Page } from '@playwright/test'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const mainEntry = join(repoRoot, 'out', 'main', 'index.js')

export interface LaunchedApp {
  app: ElectronApplication
  window: Page
  /** Temporary WORFY_DATA_DIR: the app's own state for this run. */
  dataDir: string
  /** Temporary WORFY_CLAUDE_HOME: stands in for ~/.claude. */
  claudeHome: string
  /** Closes the app and removes both temporary directories. */
  close: () => Promise<void>
}

export interface LaunchOptions {
  /** Extra environment for the app process. */
  env?: Record<string, string>
}

/**
 * Starts the built app (out/) with isolated data and Claude directories and the fake agent.
 * Every e2e test launches the app through this helper.
 */
export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  if (!existsSync(mainEntry)) {
    throw new Error(`The app is not built: ${mainEntry} is missing. Run \`pnpm test:e2e\`, which builds first.`)
  }
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
  Object.assign(env, {
    WORFY_DATA_DIR: dataDir,
    WORFY_CLAUDE_HOME: claudeHome,
    WORFY_AGENT: 'fake',
    ...options.env,
  })

  let app: ElectronApplication
  try {
    app = await _electron.launch({ args: [mainEntry], cwd: repoRoot, env })
  } catch (error) {
    await cleanDirs()
    throw error
  }
  try {
    const window = await app.firstWindow()
    return {
      app,
      window,
      dataDir,
      claudeHome,
      close: async () => {
        await app.close()
        await cleanDirs()
      },
    }
  } catch (error) {
    await app.close().catch(() => undefined)
    await cleanDirs()
    throw error
  }
}

import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, type LaunchedApp, repoRoot } from './helpers'

// The packaged tests drive the stable copy of worfy.app that scripts/install-stable.sh installs:
// into a temporary folder from the dist/ build of `pnpm test:package`, or the copy named by
// WORFY_PACKAGED_APP (for example ~/Applications/worfy-stable.app after `pnpm install:stable`).
// They carry the @packaged tag: `pnpm test:e2e` leaves them out, `pnpm test:package` runs only them.
// The untagged tests at the end run in `pnpm test:e2e` against the unpacked out/ build.

const distDir = join(repoRoot, 'dist')
const installScript = join(repoRoot, 'scripts', 'install-stable.sh')
const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/** electron-builder writes the .app to dist/mac-arm64/ or dist/mac/, depending on the arch. */
function builtApp(): string {
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

/** Runs scripts/install-stable.sh with the dist/ build as the app to copy, so it does not build again. */
function install(target: string): ReturnType<typeof spawnSync> & { stdout: string; stderr: string } {
  const env = { ...process.env, WORFY_STABLE_PREBUILT: builtApp() }
  return spawnSync('bash', [installScript, target], { encoding: 'utf8', env })
}

function executableOf(app: string): string {
  return join(app, 'Contents', 'MacOS', 'worfy')
}

/** Waits for a process to exit; past the deadline it is killed, and its exit is still awaited. */
async function exitWithin(child: ChildProcess, ms: number): Promise<{ exited: boolean; code: number | null }> {
  if (child.exitCode !== null || child.signalCode !== null) return { exited: true, code: child.exitCode }
  const exit = new Promise<number | null>((done) => child.once('exit', (code) => done(code)))
  const timer = new Promise<'timeout'>((done) => setTimeout(() => done('timeout'), ms))
  const first = await Promise.race([exit, timer])
  if (first !== 'timeout') return { exited: true, code: first }
  child.kill('SIGKILL')
  await exit
  return { exited: false, code: null }
}

/**
 * Starts a second process of the same app over the data and Claude folders of a running one,
 * the way a second start of worfy.app or `pnpm dev` would, and reports whether it quit on its own.
 */
async function secondStart(first: LaunchedApp, command: string, args: string[]): Promise<{ exited: boolean; code: number | null }> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  Object.assign(env, {
    WORFY_DATA_DIR: first.dataDir,
    WORFY_CLAUDE_HOME: first.claudeHome,
    WORFY_AGENT: 'fake',
    WORFY_GH: join(repoRoot, 'test', 'fixtures', 'gh', 'gh'),
  })
  const child = spawn(command, args, { cwd: repoRoot, env, stdio: 'ignore' })
  return exitWithin(child, 20_000)
}

/** Calls an IPC channel from the window's page through the preload bridge, as the renderer does. */
const appVersionFromPage = (launched: LaunchedApp): Promise<{ ok: boolean; value?: unknown; error?: string }> =>
  launched.window.evaluate(() =>
    (globalThis as unknown as { worfy: { invoke(channel: string): Promise<{ ok: boolean; value?: unknown; error?: string }> } }).worfy.invoke('app.version'),
  )

const userData = (launched: LaunchedApp): Promise<string> => launched.app.evaluate(({ app }) => app.getPath('userData'))

/** Every window of the app, as the second-instance handler in src/main/index.ts leaves them. */
const windowStates = (launched: LaunchedApp): Promise<{ minimized: boolean; visible: boolean }[]> =>
  launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => ({ minimized: window.isMinimized(), visible: window.isVisible() })))

/**
 * A second start while the first process has its window minimized: the second quits, and the
 * first restores its window instead of staying hidden in the Dock.
 */
async function expectSecondStartRestoresWindow(first: LaunchedApp, command: string, args: string[]): Promise<void> {
  // The window is created hidden and shown once its page is ready; a hidden window does not minimize.
  await expect.poll(() => windowStates(first), { timeout: 10_000 }).toEqual([{ minimized: false, visible: true }])
  await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.minimize())
  await expect.poll(() => windowStates(first), { timeout: 10_000 }).toEqual([expect.objectContaining({ minimized: true })])
  expect(await secondStart(first, command, args)).toEqual({ exited: true, code: 0 })
  await expect.poll(() => windowStates(first), { timeout: 10_000 }).toEqual([{ minimized: false, visible: true }])
}

/**
 * A second start while the first process runs with every window closed (on macOS the app stays
 * up after its last window closes): the second quits, and the first opens a window.
 */
async function expectSecondStartOpensWindow(first: LaunchedApp, command: string, args: string[]): Promise<void> {
  await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
  await expect.poll(() => windowStates(first), { timeout: 10_000 }).toEqual([])
  expect(await secondStart(first, command, args)).toEqual({ exited: true, code: 0 })
  await expect.poll(() => windowStates(first), { timeout: 10_000 }).toEqual([{ minimized: false, visible: true }])
}

/**
 * A folder shaped like worfy.app, enough for scripts/install-stable.sh: it copies the folder and
 * reads the modification time of Contents/Info.plist. The tests below need no packaged build.
 */
function standInApp(dir: string): string {
  const app = join(dir, 'stand-in', 'worfy.app')
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
  writeFileSync(join(app, 'Contents', 'Info.plist'), '<plist version="1.0"><dict/></plist>\n')
  writeFileSync(join(app, 'Contents', 'MacOS', 'worfy'), '')
  return app
}

function runScript(script: string, args: string[], env: Record<string, string>): ReturnType<typeof spawnSync> & { stdout: string; stderr: string } {
  return spawnSync('bash', [script, ...args], { encoding: 'utf8', env: { ...process.env, ...env } })
}

const readJson = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>

test.describe('the stable copy of the packaged app', { tag: '@packaged' }, () => {
  let installDir: string
  let stableApp: string

  test.beforeAll(async () => {
    installDir = await mkdtemp(join(tmpdir(), 'worfy-stable-'))
    const fromEnv = process.env.WORFY_PACKAGED_APP
    if (fromEnv) {
      stableApp = fromEnv
      return
    }
    stableApp = join(installDir, 'worfy-stable.app')
    const result = install(stableApp)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  test.afterAll(async () => {
    await removeDir(installDir)
  })

  test('the copy is ad-hoc signed by electron-builder with the worfy bundle id, untouched by the install', () => {
    // codesign prints the signature details to stderr.
    const details = spawnSync('codesign', ['-dv', stableApp], { encoding: 'utf8' })
    expect(details.status).toBe(0)
    // The stock Electron binary carries its own linker signature with Identifier=Electron, so the
    // bundle id is what shows that electron-builder signed the app.
    expect(details.stderr).toMatch(/^Identifier=dev\.worfy\.app$/m)
    expect(details.stderr).toMatch(/^Signature=adhoc$/m)
    // A file written inside the bundle after signing fails this check.
    const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', stableApp], { encoding: 'utf8' })
    expect(verify.stderr).toBe('')
    expect(verify.status).toBe(0)
  })

  test('the dist/ build and the copy carry the worfy icon, build/icon.icns, not the Electron one', () => {
    const committed = readFileSync(join(repoRoot, 'build', 'icon.icns'))
    for (const app of [builtApp(), stableApp]) {
      const plist = join(app, 'Contents', 'Info.plist')
      const iconFile = spawnSync('plutil', ['-extract', 'CFBundleIconFile', 'raw', '-o', '-', plist], { encoding: 'utf8' })
      expect(iconFile.status, app).toBe(0)
      expect(iconFile.stdout.trim(), app).toBe('icon.icns')
      const bundled = readFileSync(join(app, 'Contents', 'Resources', 'icon.icns'))
      expect(bundled.equals(committed), `${app}/Contents/Resources/icon.icns equals build/icon.icns`).toBe(true)
    }
  })

  test('the copy starts and shows a window titled worfy', async () => {
    const launched = await launchApp({ executablePath: executableOf(stableApp) })
    try {
      expect(await launched.app.evaluate(({ app }) => app.isPackaged)).toBe(true)
      await expect(launched.window).toHaveTitle('worfy')
      await expect(launched.window.getByText('worfy', { exact: true })).toBeVisible()
    } finally {
      await launched.close()
    }
  })

  // ELECTRON_RENDERER_URL left over from `electron-vite dev` in the shell that starts the copy
  // (ticket worfy-daily/16): nothing listens on port 1, so a copy that took the variable would
  // show an empty window. It loads its own bundle and trusts IPC from it.
  test('the copy ignores ELECTRON_RENDERER_URL and loads out/renderer/index.html from its bundle', async () => {
    const launched = await launchApp({ executablePath: executableOf(stableApp), env: { ELECTRON_RENDERER_URL: 'http://127.0.0.1:1' } })
    try {
      expect(await launched.app.evaluate(() => process.env.ELECTRON_RENDERER_URL)).toBe('http://127.0.0.1:1')
      const url = new URL(launched.window.url())
      expect(url.protocol).toBe('file:')
      expect(decodeURIComponent(url.pathname)).toMatch(/\/Contents\/Resources\/app\.asar\/out\/renderer\/index\.html$/)
      await expect(launched.window.getByText('worfy', { exact: true })).toBeVisible()
      expect(await appVersionFromPage(launched)).toMatchObject({ ok: true })
    } finally {
      await launched.close()
    }
  })

  test('node-pty loads from the copy and runs a command', async () => {
    const launched = await launchApp({ executablePath: executableOf(stableApp) })
    try {
      const result = await launched.app.evaluate(async ({ app }) => {
        // The main bundle does not import node-pty yet, so resolve it the way the app will:
        // from the app's own node_modules inside app.asar.
        const { createRequire: requireFrom } = process.getBuiltinModule('node:module')
        const requireFromApp = requireFrom(`${app.getAppPath()}/package.json`)
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

  test('the Claude Code binary of the Agent SDK sits unpacked where the copy runs it', async () => {
    const launched = await launchApp({ executablePath: executableOf(stableApp) })
    try {
      // The path src/main/agent/options.ts builds in the packaged app (ADR-0008); the unit test
      // test/unit/agent-executable.test.ts pins options.ts to this same layout.
      const binary = await launched.app.evaluate(
        () => `${process.resourcesPath}/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`,
      )
      // Running it with --version starts no session and calls no model.
      const version = spawnSync(binary, ['--version'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } })
      expect(version.error).toBeUndefined()
      expect(version.status).toBe(0)
      expect(version.stdout).toMatch(/\d+\.\d+\.\d+/)
    } finally {
      await launched.close()
    }
  })

  test('the copy keeps its state in Application Support/worfy, not in the dev folder', async () => {
    const home = await mkdtemp(join(tmpdir(), 'worfy-home-'))
    try {
      // An empty WORFY_DATA_DIR is ignored, so the app picks its own folder under the temporary HOME.
      const launched = await launchApp({ executablePath: executableOf(stableApp), env: { HOME: home, WORFY_DATA_DIR: '' } })
      try {
        expect(await userData(launched)).toBe(join(home, 'Library', 'Application Support', 'worfy'))
      } finally {
        await launched.close()
      }
    } finally {
      await removeDir(home)
    }
  })

  test('a second start of the copy over the same data folder quits and brings the first one\'s window back', async () => {
    const first = await launchApp({ executablePath: executableOf(stableApp) })
    try {
      await expectSecondStartRestoresWindow(first, executableOf(stableApp), [])
      await expectSecondStartOpensWindow(first, executableOf(stableApp), [])
    } finally {
      await first.close()
    }
  })
})

test.describe('scripts/install-stable.sh', { tag: '@packaged' }, () => {
  let dir: string

  test.beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'worfy-install-'))
  })

  test.afterEach(async () => {
    await removeDir(dir)
  })

  test('installs the copy at the given path and writes the commit and build time next to it', () => {
    const target = join(dir, 'Apps', 'worfy-stable.app')
    const result = install(target)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(existsSync(executableOf(target))).toBe(true)

    const metadata = JSON.parse(readFileSync(join(dir, 'Apps', 'worfy-stable.json'), 'utf8')) as Record<string, unknown>
    const head = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
    expect(metadata.commit).toBe(head)
    expect(typeof metadata.dirty).toBe('boolean')
    expect(metadata.builtAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    expect(metadata.installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    // Nothing is written inside the .app: the copy holds exactly the files of the build.
    expect(spawnSync('diff', ['-rq', builtApp(), target]).status).toBe(0)
  })

  test('a second run replaces the previous copy', () => {
    const target = join(dir, 'worfy-stable.app')
    expect(install(target).status).toBe(0)
    const leftover = join(target, 'Contents', 'leftover-from-the-old-copy')
    writeFileSync(leftover, 'old')

    const again = install(target)
    expect(again.stderr).toBe('')
    expect(again.status).toBe(0)
    expect(existsSync(leftover)).toBe(false)
    expect(existsSync(executableOf(target))).toBe(true)
    // No staging folder is left next to the copy.
    expect(readdirSync(dir).sort()).toEqual(['worfy-stable.app', 'worfy-stable.json'])
  })

  test('refuses with a non-zero exit code while the copy is running, and leaves it in place', async () => {
    const target = join(dir, 'worfy-stable.app')
    expect(install(target).status).toBe(0)
    const before = readFileSync(join(dir, 'worfy-stable.json'), 'utf8')

    const launched = await launchApp({ executablePath: executableOf(target) })
    try {
      const refused = install(target)
      expect(refused.status).not.toBe(0)
      expect(refused.stderr).toContain('is running')
      expect(refused.stderr).toContain(target)
      expect(readFileSync(join(dir, 'worfy-stable.json'), 'utf8')).toBe(before)
      expect(existsSync(executableOf(target))).toBe(true)
    } finally {
      await launched.close()
    }
    // Once the copy has quit, the same command goes through.
    expect(install(target).status).toBe(0)
  })
})

test.describe('dev run of the unpacked build', () => {
  test('keeps its state in Application Support/worfy-dev, apart from the stable copy', async () => {
    const home = await mkdtemp(join(tmpdir(), 'worfy-home-'))
    try {
      // An empty WORFY_DATA_DIR is ignored, so the app picks its own folder under the temporary HOME.
      const launched = await launchApp({ env: { HOME: home, WORFY_DATA_DIR: '' } })
      try {
        expect(await launched.app.evaluate(({ app }) => app.isPackaged)).toBe(false)
        expect(await userData(launched)).toBe(join(home, 'Library', 'Application Support', 'worfy-dev'))
      } finally {
        await launched.close()
      }
    } finally {
      await removeDir(home)
    }
  })

  test('a second dev run over the same data folder quits and restores the first one\'s minimized window', async () => {
    const electron = createRequire(import.meta.url)('electron') as string
    const first = await launchApp()
    try {
      await expectSecondStartRestoresWindow(first, electron, [repoRoot])
    } finally {
      await first.close()
    }
  })

  test('a second dev run over the same data folder opens a window in the first one when it has none', async () => {
    const electron = createRequire(import.meta.url)('electron') as string
    const first = await launchApp()
    try {
      await expectSecondStartOpensWindow(first, electron, [repoRoot])
    } finally {
      await first.close()
    }
  })

  // A dev run takes ELECTRON_RENDERER_URL (ticket worfy-daily/16); a value that is not an http(s)
  // URL fails the start with the error window's text, not with an unhandled exception.
  test('with an ELECTRON_RENDERER_URL that is not a URL stops with exit code 1 and names step loadURL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'worfy-bad-renderer-url-'))
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
    }
    Object.assign(env, {
      WORFY_DATA_DIR: join(root, 'data'),
      WORFY_CLAUDE_HOME: root,
      WORFY_AGENT: 'fake',
      WORFY_GH: join(repoRoot, 'test', 'fixtures', 'gh', 'gh'),
      ELECTRON_RENDERER_URL: 'not a url',
      // The native error window is modal and would hold the process until someone dismisses it.
      WORFY_STARTUP_DIALOG: 'off',
    })
    const electron = createRequire(import.meta.url)('electron') as string
    // Started without Playwright: launchApp waits for a window, and this start must never open one.
    const child = spawn(electron, [repoRoot], { cwd: repoRoot, env, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    try {
      const { exited, code } = await exitWithin(child, 20_000)
      expect(exited, `stderr:\n${stderr}`).toBe(true)
      expect(code, `stderr:\n${stderr}`).toBe(1)
      expect(stderr).toContain('worfy could not start')
      expect(stderr).toContain('Step: loadURL (loading the window from the dev server) failed.')
      expect(stderr).toContain('ELECTRON_RENDERER_URL is not an http(s) URL: "not a url"')
      expect(stderr).not.toContain('Uncaught Exception')
    } finally {
      await removeDir(root)
    }
  })

  test('install-stable.sh refuses a target that is not a .app, before building anything', () => {
    const result = spawnSync('bash', [installScript, join(tmpdir(), 'not-an-app')], { encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('must be a path ending in .app')
  })
})

// The install script against a stand-in app: no packaged build needed, so these run in `pnpm test:e2e`.
test.describe('scripts/install-stable.sh with a stand-in app', () => {
  let dir: string

  test.beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'worfy-install-'))
  })

  test.afterEach(async () => {
    await removeDir(dir)
  })

  test('without an argument installs into ~/Applications/worfy-stable.app, with worfy-stable.json next to it', () => {
    const home = join(dir, 'home')
    mkdirSync(home)
    const result = runScript(installScript, [], { HOME: home, WORFY_STABLE_PREBUILT: standInApp(dir) })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    const applications = join(home, 'Applications')
    expect(readdirSync(applications).sort()).toEqual(['worfy-stable.app', 'worfy-stable.json'])
    expect(existsSync(join(applications, 'worfy-stable.app', 'Contents', 'Info.plist'))).toBe(true)
    const head = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
    expect(readJson(join(applications, 'worfy-stable.json')).commit).toBe(head)
  })

  test('accepts a target path with a trailing slash, as shell completion writes it', () => {
    const result = runScript(installScript, [`${join(dir, 'worfy-stable.app')}/`], { WORFY_STABLE_PREBUILT: standInApp(dir) })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(existsSync(join(dir, 'worfy-stable.app', 'Contents', 'Info.plist'))).toBe(true)
    expect(existsSync(join(dir, 'worfy-stable.json'))).toBe(true)
  })

  test('marks the copy dirty when the tree it was built from has an untracked file', () => {
    // A repository of its own, so the test controls what is committed; the script finds the
    // repository from its own location.
    const repo = join(dir, 'repo')
    mkdirSync(join(repo, 'scripts'), { recursive: true })
    cpSync(installScript, join(repo, 'scripts', 'install-stable.sh'))
    const git = (...args: string[]): string => {
      const result = spawnSync('git', ['-C', repo, '-c', 'user.name=worfy-test', '-c', 'user.email=test@worfy.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8' })
      expect(result.status).toBe(0)
      return result.stdout.trim()
    }
    git('init', '-q', '--initial-branch=main')
    git('add', '.')
    git('commit', '-q', '-m', 'install script')
    const script = join(repo, 'scripts', 'install-stable.sh')
    const target = join(dir, 'Apps', 'worfy-stable.app')
    const env = { WORFY_STABLE_PREBUILT: standInApp(dir) }

    expect(runScript(script, [target], env).status).toBe(0)
    const clean = readJson(join(dir, 'Apps', 'worfy-stable.json'))
    expect(clean).toMatchObject({ commit: git('rev-parse', 'HEAD'), dirty: false })

    writeFileSync(join(repo, 'new-source.ts'), 'export const added = true\n')
    expect(runScript(script, [target], env).status).toBe(0)
    expect(readJson(join(dir, 'Apps', 'worfy-stable.json'))).toMatchObject({ commit: clean.commit, dirty: true })
  })
})

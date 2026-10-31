import { type ChildProcess, execFileSync, spawn, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, test } from '@playwright/test'
import { BUILD_VERSION, buildVersion } from '../../scripts/build-version'
import { launchApp, type LaunchedApp, type ListedProcess, NO_WINDOW_RESTORE, packagedBuild, packagedExecutable as executableOf, packagedResources as resourcesOf, processesWith, repoRoot } from './helpers'
import { DIRECT_START_PROFILE, directStartEnv } from './launch-env'
import { WINDOWS } from './terminal-shell'
import { profileVars, windowsProfileEnv } from '../windows-profile'
import { catScript } from '../harness-node'
import { ms } from '../time-scale'

// The packaged tests drive the stable copy of worfy that scripts/install-stable.mjs installs:
// into a temporary folder from the dist/ build of `pnpm test:package`, or the copy named by
// WORFY_PACKAGED_APP (for example ~/Applications/worfy-stable.app after `pnpm install:stable`).
// On macOS the build and the copy are .app bundles; on Windows they are folders with worfy.exe in
// them (dist\win-unpacked, and a copy such as %LOCALAPPDATA%\worfy-stable).
// They carry the @packaged tag: `pnpm test:e2e` leaves them out, `pnpm test:package` runs only them.
// The untagged tests at the end run in `pnpm test:e2e` against the unpacked out/ build.

/** The name of a stable copy: a .app on macOS, a folder on Windows (scripts/install-stable.mjs). */
const STABLE = WINDOWS ? 'worfy-stable' : 'worfy-stable.app'
const installScript = join(repoRoot, 'scripts', 'install-stable.mjs')
const bridgeScript = join(repoRoot, 'scripts', 'statusline-bridge.sh')
/** The work of the bridge, in Node, next to its entry (worfy-windows ticket 08). */
const bridgeModule = join(repoRoot, 'scripts', 'statusline-bridge.mjs')

// The status line JSON of test/contract/statusline-bridge.test.ts (Claude Code 2.1.284), copied:
// that file runs under vitest and cannot be imported here.
const RATE_LIMITS = { five_hour: { used_percentage: 29, resets_at: 1791202800 }, seven_day: { used_percentage: 9, resets_at: 1791777600 } }
const STATUS = {
  session_id: '00000000-0000-4000-8000-000000000001',
  transcript_path: '/Users/someone/.claude/projects/x/00000000-0000-4000-8000-000000000001.jsonl',
  cwd: '/Users/someone/project',
  model: { id: 'claude-haiku-4-5-20251001', display_name: 'Haiku 4.5' },
  version: '2.1.284',
  cost: { total_cost_usd: 0.001 },
  rate_limits: RATE_LIMITS,
}
const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/**
 * The profile folders every run of scripts/install-stable.mjs here gets on Windows: the temporary
 * ones of direct starts (launch-env.ts), so the folder of worfy's installer it reads,
 * %LOCALAPPDATA%\Programs\worfy, and its default target, %LOCALAPPDATA%\worfy-stable, lie in a
 * temporary folder and never in the user's own profile. Nothing off Windows.
 */
const installProfile = (): Record<string, string> => windowsProfileEnv(DIRECT_START_PROFILE)

/**
 * Runs scripts/install-stable.mjs with the dist/ build as the app to copy, so it does not build
 * again. The target is always a temporary folder of the test: the script swaps out whatever copy
 * is there.
 */
function install(target: string): ReturnType<typeof spawnSync> & { stdout: string; stderr: string } {
  if (!target.startsWith(tmpdir())) throw new Error(`install-stable in a test installs into a temporary folder only, not ${target}`)
  const env = { ...process.env, ...installProfile(), WORFY_STABLE_PREBUILT: packagedBuild() }
  return spawnSync(process.execPath, [installScript, target], { encoding: 'utf8', env })
}

/**
 * The paths under `a` and `b` that differ, as `diff -rq` finds them: on one side only, a file on
 * one side and a folder on the other, or a file whose bytes differ. For Windows, which has no
 * diff of its own (Git Bash brings one, but not every shell the tests run from has it on PATH).
 */
function treeDifferences(a: string, b: string, below = ''): string[] {
  const others = new Map(readdirSync(join(b, below), { withFileTypes: true }).map((entry) => [entry.name, entry]))
  const found: string[] = []
  for (const entry of readdirSync(join(a, below), { withFileTypes: true })) {
    const path = join(below, entry.name)
    const other = others.get(entry.name)
    others.delete(entry.name)
    if (other === undefined || other.isDirectory() !== entry.isDirectory()) found.push(path)
    else if (entry.isDirectory()) found.push(...treeDifferences(a, b, path))
    else if (!readFileSync(join(a, path)).equals(readFileSync(join(b, path)))) found.push(path)
  }
  return [...found, ...[...others.keys()].map((name) => join(below, name))]
}

/**
 * The variables that put the app's default data folder under `home` (dataRoot of
 * src/main/storage/paths.ts): HOME on macOS, APPDATA on Windows. And that folder.
 */
const dataHomeEnv = (home: string): Record<string, string> => (WINDOWS ? { APPDATA: profileVars(home).APPDATA } : { HOME: home })
const defaultDataDir = (home: string, name: string): string => (WINDOWS ? join(profileVars(home).APPDATA, name) : join(home, 'Library', 'Application Support', name))
/** The data folder of the stable copy and of a dev run, as test names say it. */
const DATA_FOLDER = WINDOWS ? '%APPDATA%\\worfy' : 'Application Support/worfy'
/** The folder of process.resourcesPath in a packaged build, as test names say it. */
const RESOURCES = WINDOWS ? 'resources' : 'Contents/Resources'

/**
 * The images of an .ico file: the ICONDIR header holds their count at byte 4, then one 16-byte
 * entry each, with the image's size at +8 and its offset at +12.
 */
function icoImages(file: string): Buffer[] {
  const ico = readFileSync(file)
  return Array.from({ length: ico.readUInt16LE(4) }, (_, index) => {
    const entry = 6 + 16 * index
    const offset = ico.readUInt32LE(entry + 12)
    return ico.subarray(offset, offset + ico.readUInt32LE(entry + 8))
  })
}

/**
 * Off macOS the app quits when its last window closes (window-all-closed in src/main/index.ts), so
 * a running app with no window, which a second start would bring a window back to, does not exist.
 */
const QUITS_WITH_LAST_WINDOW = process.platform !== 'darwin'

/**
 * The processes Chromium started for the run over `dataDir`: their command line has the flag
 * `--user-data-dir=<dataDir>` as one argument, quoted (Windows) or not. A process that only
 * mentions the path elsewhere, or names a folder that merely starts with it, is not one.
 */
function childrenOfRun(dataDir: string): ListedProcess[] {
  const quoted = `--user-data-dir="${dataDir}"`
  const bare = `--user-data-dir=${dataDir}`
  const hasFlag = (commandLine: string): boolean =>
    commandLine.includes(quoted) || commandLine.endsWith(bare) || commandLine.includes(`${bare} `)
  return processesWith(dataDir).filter((listed) => hasFlag(listed.commandLine))
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
  const env = directStartEnv({ dataDir: first.dataDir, claudeHome: first.claudeHome })
  const child = spawn(command, [...args, ...NO_WINDOW_RESTORE], { cwd: repoRoot, env, stdio: 'ignore' })
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
  await expect.poll(() => windowStates(first), { timeout: ms(10_000) }).toEqual([{ minimized: false, visible: true }])
  await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.minimize())
  await expect.poll(() => windowStates(first), { timeout: ms(10_000) }).toEqual([expect.objectContaining({ minimized: true })])
  expect(await secondStart(first, command, args)).toEqual({ exited: true, code: 0 })
  await expect.poll(() => windowStates(first), { timeout: ms(10_000) }).toEqual([{ minimized: false, visible: true }])
}

/**
 * A second start while the first process runs with every window closed (on macOS the app stays
 * up after its last window closes): the second quits, and the first opens a window.
 */
async function expectSecondStartOpensWindow(first: LaunchedApp, command: string, args: string[]): Promise<void> {
  await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
  await expect.poll(() => windowStates(first), { timeout: ms(10_000) }).toEqual([])
  expect(await secondStart(first, command, args)).toEqual({ exited: true, code: 0 })
  await expect.poll(() => windowStates(first), { timeout: ms(10_000) }).toEqual([{ minimized: false, visible: true }])
}

/** The file of a stand-in app (standInApp) whose time install-stable takes for the build time. */
const standInMarker = (app: string): string => (WINDOWS ? join(app, 'worfy.exe') : join(app, 'Contents', 'Info.plist'))

/**
 * A folder shaped like worfy.app, enough for scripts/install-stable.mjs: it copies the folder and
 * reads the modification time of Contents/Info.plist. On Windows a folder shaped like
 * dist\win-unpacked, whose worfy.exe the script looks for and reads the time of. The tests below
 * need no packaged build.
 */
function standInApp(dir: string): string {
  if (WINDOWS) {
    const unpacked = join(dir, 'stand-in', 'win-unpacked')
    mkdirSync(unpacked, { recursive: true })
    writeFileSync(standInMarker(unpacked), '')
    return unpacked
  }
  const app = join(dir, 'stand-in', 'worfy.app')
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
  writeFileSync(join(app, 'Contents', 'Info.plist'), '<plist version="1.0"><dict/></plist>\n')
  writeFileSync(join(app, 'Contents', 'MacOS', 'worfy'), '')
  return app
}

/**
 * Runs a script over a stand-in app. Its registration with Launch Services (install-stable on macOS)
 * runs /usr/bin/true instead of lsregister: the stand-in is no app, and every `pnpm test:e2e` would
 * otherwise leave a record of a deleted temporary copy in the Launch Services of the Mac. On
 * Windows the script gets the temporary profile folders of installProfile; `env` wins over them.
 */
function runScript(script: string, args: string[], env: Record<string, string>): ReturnType<typeof spawnSync> & { stdout: string; stderr: string } {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, WORFY_STABLE_LSREGISTER: '/usr/bin/true', ...installProfile(), ...env } })
}

const readJson = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>

/**
 * Every path in an app.asar archive, from its header: a pickle of the header size (bytes 4–8),
 * then a pickle whose string (length at byte 12) is the JSON tree of `files` from byte 16.
 */
function asarPaths(archive: string): string[] {
  const head = readFileSync(archive)
  const json = head.subarray(16, 16 + head.readUInt32LE(12)).toString('utf8')
  type Entry = { files?: Record<string, Entry> }
  const paths: string[] = []
  const walk = (entry: Entry, prefix: string): void => {
    for (const [name, child] of Object.entries(entry.files ?? {})) {
      paths.push(`${prefix}${name}`)
      walk(child, `${prefix}${name}/`)
    }
  }
  walk(JSON.parse(json) as Entry, '')
  return paths
}

const isExecutable = (path: string): boolean => (statSync(path).mode & 0o111) !== 0

/** The files of bin/ and hooks/ of a Harness folder, without tests/, each with whether it is executable. */
function harnessScripts(dir: string): Record<string, boolean> {
  const scripts: Record<string, boolean> = {}
  for (const sub of ['bin', 'hooks']) {
    for (const entry of readdirSync(join(dir, sub), { withFileTypes: true })) {
      if (entry.isFile()) scripts[`${sub}/${entry.name}`] = isExecutable(join(dir, sub, entry.name))
    }
  }
  return scripts
}

/**
 * The Harness copy of a build next to harness/: the build version as `version`, the scripts as
 * executable as in harness/, and no tests/ folders.
 */
function expectHarnessCopy(copy: string): string {
  const version = readJson(join(copy, '.claude-plugin', 'plugin.json')).version
  expect(version).toEqual(expect.stringMatching(BUILD_VERSION))
  const scripts = harnessScripts(copy)
  expect(scripts).toEqual(harnessScripts(join(repoRoot, 'harness')))
  // Windows has no executable bit (Node reports none for any file there); its Harness scripts
  // run through node or Git Bash, not by their mode.
  if (!WINDOWS) {
    expect(scripts['bin/profile']).toBe(true)
    expect(scripts['hooks/gate.mjs']).toBe(true)
  }
  expect(existsSync(join(copy, 'bin', 'tests'))).toBe(false)
  expect(existsSync(join(copy, 'hooks', 'tests'))).toBe(false)
  return version as string
}

/** git in `cwd` without the GIT_* of a hook that may run the tests, with an author of its own. */
function gitIn(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

const HARNESS_EPIC = 'demo'

/**
 * A `git clone --shared` of this repository at the build commit `sha`, whose origin/main is the
 * build commit itself (`lesson: false`) or a commit in harness/ on top of it (`lesson: true`),
 * with an Epic for the Canvas next to it (untracked: the comparison looks at commits only).
 */
function harnessClone(dir: string, sha: string, lesson: boolean): string {
  const clone = join(dir, lesson ? 'worfy-behind' : 'worfy-current')
  gitIn(dir, 'clone', '-q', '--shared', '--no-checkout', repoRoot, clone)
  gitIn(clone, 'checkout', '-q', '--detach', sha)
  let main = sha
  if (lesson) {
    writeFileSync(join(clone, 'harness', 'LESSON.md'), 'a lesson merged during the run\n')
    gitIn(clone, 'add', 'harness/LESSON.md')
    gitIn(clone, 'commit', '-q', '-m', 'harness: a lesson')
    main = gitIn(clone, 'rev-parse', 'HEAD')
    gitIn(clone, 'checkout', '-q', '--detach', sha)
  }
  gitIn(clone, 'update-ref', 'refs/remotes/origin/main', main)
  const issues = join(clone, '.scratch', HARNESS_EPIC, 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(clone, '.scratch', HARNESS_EPIC, 'spec.md'), '# Demo epic\n')
  writeFileSync(join(issues, '01-ticket-1.md'), ['# 01 — Ticket 1', '', 'Type: task', 'Status: open', 'Blocked by: —', '', '## Где в коде', '', '- `src/f1.ts`', ''].join('\n'))
  return clone
}

/** A Claude home whose epic-status answers the Epic `demo` with one open Ticket, whatever the Project. */
function epicStatusHome(dir: string): string {
  const home = join(dir, 'claude-home')
  mkdirSync(join(home, 'bin'), { recursive: true })
  const answer = join(home, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: [{ epic: HARNESS_EPIC, hasSpec: true, hasMap: false }],
      tickets: [{ epic: HARNESS_EPIC, num: 1, slug: 'ticket-1', title: '01 — Ticket 1', statusRaw: 'open', state: 'open', blockedRaw: '—', blockedNums: [], blockedParsed: true }],
    }),
  )
  writeFileSync(join(home, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(home, 'bin', 'epic-status'), 0o755)
  return home
}

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
    stableApp = join(installDir, STABLE)
    const result = install(stableApp)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  test.afterAll(async () => {
    await removeDir(installDir)
  })

  test('the copy is ad-hoc signed by electron-builder with the worfy bundle id, untouched by the install', () => {
    test.skip(WINDOWS, 'the Windows build is not signed (no certificate until E4, electron-builder.yml): there is no signature to check')
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

  test(`the dist/ build and the copy carry the worfy icon, ${WINDOWS ? 'build/icon.ico' : 'build/icon.icns'}, not the Electron one`, () => {
    if (WINDOWS) {
      // On Windows the icon is build/icon.ico (electron-builder.yml), set into worfy.exe as its
      // icon resources: each of its images, PNG data, is in worfy.exe byte for byte, and none is
      // in the Electron program the build starts from.
      const images = icoImages(join(repoRoot, 'build', 'icon.ico'))
      expect(images.length).toBeGreaterThan(0)
      const electron = readFileSync(createRequire(import.meta.url)('electron') as string)
      for (const app of [packagedBuild(), stableApp]) {
        const program = readFileSync(executableOf(app))
        images.forEach((image, index) => {
          expect(program.includes(image), `${executableOf(app)} holds image ${index} of build/icon.ico`).toBe(true)
          expect(electron.includes(image), `electron.exe does not hold image ${index} of build/icon.ico`).toBe(false)
        })
      }
      return
    }
    const committed = readFileSync(join(repoRoot, 'build', 'icon.icns'))
    for (const app of [packagedBuild(), stableApp]) {
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
      expect(decodeURIComponent(url.pathname)).toMatch(WINDOWS ? /\/resources\/app\.asar\/out\/renderer\/index\.html$/ : /\/Contents\/Resources\/app\.asar\/out\/renderer\/index\.html$/)
      await expect(launched.window.getByText('worfy', { exact: true })).toBeVisible()
      expect(await appVersionFromPage(launched)).toMatchObject({ ok: true })
    } finally {
      await launched.close()
    }
  })

  test('node-pty loads from the copy and runs a command', async () => {
    const launched = await launchApp({ executablePath: executableOf(stableApp) })
    try {
      // On Windows: cmd.exe's echo through ConPTY, and the binary node-pty ships for win32 in
      // prebuilds/ (scripts/postinstall.mjs rebuilds nothing there). With an empty environment
      // cmd.exe exited with 87 (ERROR_INVALID_PARAMETER) in 4 of 6 runs on the PC; with SystemRoot
      // in it, 6 of 6 printed ok.
      const command = WINDOWS
        ? { file: 'cmd.exe', args: ['/d', '/c', 'echo ok'], binary: `prebuilds/win32-${process.arch}/conpty.node`, env: { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' } }
        : { file: '/bin/echo', args: ['ok'], binary: 'build/Release/pty.node', env: {} }
      const result = await launched.app.evaluate(async ({ app }, { file, args, binary, env }) => {
        // The main bundle does not import node-pty yet, so resolve it the way the app will:
        // from the app's own node_modules inside app.asar.
        const { createRequire: requireFrom } = process.getBuiltinModule('node:module')
        const requireFromApp = requireFrom(`${app.getAppPath()}/package.json`)
        const pty = requireFromApp('node-pty') as typeof import('node-pty')
        const resolved = requireFromApp.resolve('node-pty')
        const proc = pty.spawn(file, args, { name: 'xterm-color', cols: 80, rows: 24, env })
        let output = ''
        proc.onData((chunk) => {
          output += chunk
        })
        const exitCode = await new Promise<number>((done) => {
          proc.onExit(({ exitCode: code }) => done(code))
        })
        // The binary outside the archive: rebuilt for Electron by postinstall on macOS, the
        // prebuild node-pty ships on Windows.
        const { existsSync: exists } = process.getBuiltinModule('node:fs')
        const unpackedBinary = `${process.resourcesPath}/app.asar.unpacked/node_modules/node-pty/${binary}`
        return { resolved, output: output.trim(), exitCode, unpacked: exists(unpackedBinary) }
      }, command)
      expect(result.resolved).toContain('app.asar')
      expect(result.unpacked).toBe(true)
      expect(result.exitCode).toBe(0)
      if (WINDOWS) {
        // ConPTY draws the screen with escape sequences around the text: the lines without them.
        // eslint-disable-next-line no-control-regex
        const lines = result.output.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g, '').split(/\r?\n/).map((line) => line.trim())
        expect(lines, JSON.stringify(result.output)).toContain('ok')
      } else {
        expect(result.output).toBe('ok')
      }
    } finally {
      await launched.close()
    }
  })

  test('the Claude Code binary of the Agent SDK sits unpacked where the copy runs it', async () => {
    const launched = await launchApp({ executablePath: executableOf(stableApp) })
    try {
      // The path src/main/agent/options.ts builds in the packaged app (ADR-0008); the unit test
      // test/unit/agent-executable.test.ts pins options.ts to this same layout.
      // On Windows the binary is claude.exe (ADR-0057).
      const binary = await launched.app.evaluate(
        () => `${process.resourcesPath}/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/${process.platform === 'win32' ? 'claude.exe' : 'claude'}`,
      )
      // On Windows the system folder alone on PATH, and temporary profile folders: whatever the
      // binary reads or writes at start stays out of the user's profile.
      const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
      const env = WINDOWS ? { ...installProfile(), SystemRoot: systemRoot, PATH: join(systemRoot, 'System32') } : { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }
      // Running it with --version starts no session and calls no model.
      const version = spawnSync(binary, ['--version'], { encoding: 'utf8', env })
      expect(version.error).toBeUndefined()
      expect(version.status).toBe(0)
      expect(version.stdout).toMatch(/\d+\.\d+\.\d+/)
    } finally {
      await launched.close()
    }
  })

  test(`the copy keeps its state in ${DATA_FOLDER}, not in the dev folder`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'worfy-home-'))
    try {
      // An empty WORFY_DATA_DIR is ignored, so the app picks its own folder under the temporary
      // HOME (on Windows: under the temporary APPDATA, %APPDATA%\worfy).
      const launched = await launchApp({ executablePath: executableOf(stableApp), env: { ...dataHomeEnv(home), WORFY_DATA_DIR: '' } })
      try {
        expect(await userData(launched)).toBe(defaultDataDir(home, 'worfy'))
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
      if (QUITS_WITH_LAST_WINDOW) {
        test.info().annotations.push({ type: 'skip', description: 'second half (a second start opens a window in a copy that has none) skipped: off macOS the app quits when its last window closes (window-all-closed, src/main/index.ts)' })
      } else {
        await expectSecondStartOpensWindow(first, executableOf(stableApp), [])
      }
    } finally {
      await first.close()
    }
  })

  test(`the copy carries the Harness of its build in ${RESOURCES}/harness, outside app.asar, and shows its version`, async () => {
    const resources = resourcesOf(stableApp)
    const version = expectHarnessCopy(join(resources, 'harness'))
    // The plugin worfy's Sessions get inline (worfy-harness ticket 12, src/main/agent/options.ts):
    // named worfy, the name it replaces an installed copy by.
    expect(readJson(join(resources, 'harness', '.claude-plugin', 'plugin.json')).name).toBe('worfy')
    // The copy is also the local marketplace the installer registers (worfy-harness ticket 13,
    // ADR-0048): `worfy-harness`, with the plugin at its root.
    expect(readJson(join(resources, 'harness', '.claude-plugin', 'marketplace.json'))).toMatchObject({ name: 'worfy-harness', plugins: [{ name: 'worfy', source: './' }] })
    // Packaged from this build (not a WORFY_PACKAGED_APP copy): the same files as out/harness,
    // plugin.json with its version included, none dropped by electron-builder.
    if (!process.env.WORFY_PACKAGED_APP) {
      if (WINDOWS) expect(treeDifferences(join(repoRoot, 'out', 'harness'), join(resources, 'harness'))).toEqual([])
      else expect(spawnSync('diff', ['-rq', join(repoRoot, 'out', 'harness'), join(resources, 'harness')], { encoding: 'utf8' }).stdout).toBe('')
    }
    // Not a second time inside the archive: electron-builder.yml excludes out/harness/** from `files`.
    const inArchive = asarPaths(join(resources, 'app.asar'))
    expect(inArchive).toContain('out/main/index.js')
    expect(inArchive.filter((path) => path.startsWith('out/harness'))).toEqual([])
    const launched = await launchApp({ executablePath: executableOf(stableApp) })
    try {
      // The build version, or the same numbered (worfy-update ticket 14) when the copy was built from a
      // checkout with its whole history; a copy given by WORFY_PACKAGED_APP may come from another one.
      const [major, minor] = version.split('.')
      const dirty = version.endsWith('.dirty') ? '\\.dirty' : ''
      await expect(launched.window.getByTestId('app-version')).toHaveText(new RegExp(`^v(${version.replaceAll('.', '\\.').replace('+', '\\+')}|${major}\\.${minor}\\.\\d+${dirty})$`))
      // A packaged app offers the install (worfy-harness ticket 13); the Claude home of launchApp is
      // a sandbox without the plugin, so reading the state runs no `claude` at all.
      await expect(launched.window.getByTestId('harness-text')).toHaveText('Harness not installed')
      await expect(launched.window.getByTestId('harness-action')).toHaveAccessibleName('Install')
    } finally {
      await launched.close()
    }
  })

  // The status line bridge ships in the .app (worfy-harness ticket 15), so the `statusLine` the
  // Harness migration form of ticket 14 proposes, <process.resourcesPath>/statusline-bridge.sh,
  // does not depend on a checkout of the repository.
  test(`the copy carries scripts/statusline-bridge.sh as ${RESOURCES}/statusline-bridge.sh, ${WINDOWS ? '' : 'executable, '}with statusline-bridge.mjs next to it`, () => {
    const bridge = join(resourcesOf(stableApp), 'statusline-bridge.sh')
    const module = join(resourcesOf(stableApp), 'statusline-bridge.mjs')
    expect(existsSync(bridge)).toBe(true)
    // Windows has no executable bit; a Windows `statusLine` runs `node <resources>/statusline-bridge.mjs`
    // (src/main/harness/status-line.ts), not the sh entry.
    if (!WINDOWS) expect(isExecutable(bridge)).toBe(true)
    expect(existsSync(module)).toBe(true)
    // Packaged from this build (not a WORFY_PACKAGED_APP copy): the very files of the repository.
    if (!process.env.WORFY_PACKAGED_APP) {
      expect(readFileSync(bridge).equals(readFileSync(bridgeScript))).toBe(true)
      expect(readFileSync(module).equals(readFileSync(bridgeModule))).toBe(true)
    }
  })

  test(`the bridge in the copy writes rate_limits to ${DATA_FOLDER} and passes stdin to the wrapped command`, async () => {
    const bridge = join(resourcesOf(stableApp), 'statusline-bridge.sh')
    const home = await mkdtemp(join(tmpdir(), 'worfy-bridge-home-'))
    try {
      const dataDir = defaultDataDir(home, 'worfy')
      mkdirSync(dataDir, { recursive: true })
      const input = JSON.stringify(STATUS)
      // Run as Claude Code runs a status line command: the script itself, not `sh <script>`, from
      // a folder that is not the repository, with a HOME of its own and no WORFY_DATA_DIR.
      // On Windows the command is `node <resources>/statusline-bridge.mjs '<command>'`
      // (src/main/harness/status-line.ts), with a profile of its own (USERPROFILE and APPDATA); the
      // bridge runs `cat` through Git Bash, which it finds by the git.exe on PATH or in Program Files.
      const result = WINDOWS
        ? spawnSync(process.execPath, [join(resourcesOf(stableApp), 'statusline-bridge.mjs'), 'cat'], {
            input,
            encoding: 'utf8',
            cwd: home,
            env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? 'C:\\Windows', ProgramFiles: process.env.ProgramFiles ?? 'C:\\Program Files', USERPROFILE: home, ...dataHomeEnv(home) },
          })
        : spawnSync(bridge, ['cat'], { input, encoding: 'utf8', cwd: home, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home } })
      expect(result.error).toBeUndefined()
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      expect(result.stdout).toBe(input)
      expect(readJson(join(dataDir, 'statusline-limits.json'))).toEqual(RATE_LIMITS)
      expect(readdirSync(dataDir)).toEqual(['statusline-limits.json'])
      // The dev data folder does not exist under this HOME, and the bridge does not create it.
      expect(readdirSync(dirname(dataDir))).toEqual(['worfy'])
    } finally {
      await removeDir(home)
    }
  })
  // worfy-harness ticket 21 (ADR-0047): a Project that is a clone of worfy, whose origin/main has
  // a commit in harness/ after the commit this copy was built from, shows the chip on the Epic's
  // Autopilot action; a clone whose origin/main is the build commit does not. Nothing is fetched:
  // the clones' refs are as the test set them.
  test('the Autopilot action shows "Harness in main is newer than the Stable copy" when origin/main has a lesson in harness/ after the build', async () => {
    const version = readJson(join(resourcesOf(stableApp), 'harness', '.claude-plugin', 'plugin.json')).version as string
    const sha = /\+([0-9a-f]+)/.exec(version)?.[1]
    expect(sha, version).toBeDefined()
    const dir = realpathSync.native(await mkdtemp(join(tmpdir(), 'worfy-harness-behind-')))
    try {
      const behind = harnessClone(dir, sha!, true)
      const current = harnessClone(dir, sha!, false)
      const refsBefore = [gitIn(behind, 'for-each-ref'), gitIn(current, 'for-each-ref')]
      const dataDir = join(dir, 'data')
      const ids = { behind: 'worfy-behind-0000b021', current: 'worfy-current-0000c021' }
      for (const id of Object.values(ids)) {
        mkdirSync(join(dataDir, id), { recursive: true })
        writeFileSync(join(dataDir, id, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 20, y: 20, zoom: 0.8 } }))
      }
      writeFileSync(
        join(dataDir, 'projects.json'),
        JSON.stringify({
          projects: [
            { id: ids.behind, name: 'worfy-behind', path: behind },
            { id: ids.current, name: 'worfy-current', path: current },
          ],
          activeId: ids.behind,
        }),
      )
      const launched = await launchApp({ executablePath: executableOf(stableApp), env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: epicStatusHome(dir) } })
      try {
        const { window } = launched
        await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
        const frame = window.locator(`[data-testid="epic-frame"][data-epic="${HARNESS_EPIC}"]`)
        const chip = frame.getByTestId('autopilot-harness-behind')
        await expect(frame.getByTestId('action-autopilot')).toBeVisible({ timeout: ms(20_000) })
        await expect(chip).toBeVisible({ timeout: ms(20_000) })
        await expect(chip).toHaveText('Harness in main is newer than the Stable copy')
        await expect(chip).toHaveAttribute('title', `origin/main has 1 commit in harness/ that this build (${version}) has not. Rebuild the Stable copy with pnpm install:stable between runs`)
        // Whole, inside the header, and over none of its buttons or the Epic's title.
        const header = frame.locator('header')
        const [box, room] = [(await chip.boundingBox())!, (await header.boundingBox())!]
        expect(box.y).toBeGreaterThanOrEqual(room.y)
        expect(box.y + box.height).toBeLessThanOrEqual(room.y + room.height + 0.5)
        expect(box.x).toBeGreaterThanOrEqual(room.x)
        expect(box.x + box.width).toBeLessThanOrEqual(room.x + room.width)
        expect(await chip.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
        for (const other of [header.locator('h2'), ...(await header.locator('button').all())]) {
          const at = await other.boundingBox()
          if (at !== null) expect(box.x < at.x + at.width && at.x < box.x + box.width && box.y < at.y + at.height && at.y < box.y + box.height).toBe(false)
        }
        await expect(frame.getByTestId('action-autopilot')).toBeInViewport()
        await header.screenshot({ path: test.info().outputPath('harness-behind-header.png') })

        // The clone whose origin/main is the build commit: no chip, and main says null.
        type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown }> }
        const call = (channel: string, input: unknown) => window.evaluate(([name, value]) => (globalThis as unknown as { worfy: Bridge }).worfy.invoke(name as string, value), [channel, input] as const)
        expect(await call('projects.select', { id: ids.current })).toMatchObject({ ok: true })
        await expect(frame.getByTestId('action-autopilot')).toBeVisible({ timeout: ms(20_000) })
        // A window in which nothing may happen: main keeps no "compared" mark apart from "not
        // behind" (autopilot.state answers null for both), so nothing shows that the comparison of
        // this clone is over. It answers through autopilot.changed once git has read the clone's refs,
        // a local read with no fetch; 3 s is many times what that read takes.
        await window.waitForTimeout(3000)
        await expect(chip).toHaveCount(0)
        expect(await call('autopilot.state', { projectId: ids.current })).toMatchObject({ ok: true, value: { harnessBehind: null } })
        expect(await call('autopilot.state', { projectId: ids.behind })).toMatchObject({ ok: true, value: { harnessBehind: { harness: version, main: 'origin/main', commits: 1 } } })
      } finally {
        await launched.close()
      }
      // Read only: the clones' refs are as the test left them, and nothing was fetched.
      expect([gitIn(behind, 'for-each-ref'), gitIn(current, 'for-each-ref')]).toEqual(refsBefore)
      expect(existsSync(join(behind, '.git', 'FETCH_HEAD'))).toBe(false)
      expect(existsSync(join(current, '.git', 'FETCH_HEAD'))).toBe(false)
    } finally {
      await removeDir(dir)
    }
  })
})

test.describe('scripts/install-stable.mjs', { tag: '@packaged' }, () => {
  let dir: string

  test.beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'worfy-install-'))
  })

  test.afterEach(async () => {
    await removeDir(dir)
  })

  test('installs the copy at the given path and writes the commit and build time next to it', () => {
    const target = join(dir, 'Apps', STABLE)
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
    if (WINDOWS) expect(treeDifferences(packagedBuild(), target)).toEqual([])
    else expect(spawnSync('diff', ['-rq', packagedBuild(), target]).status).toBe(0)
  })

  test('a second run replaces the previous copy', () => {
    const target = join(dir, STABLE)
    expect(install(target).status).toBe(0)
    const leftover = WINDOWS ? join(target, 'leftover-from-the-old-copy') : join(target, 'Contents', 'leftover-from-the-old-copy')
    writeFileSync(leftover, 'old')

    const again = install(target)
    expect(again.stderr).toBe('')
    expect(again.status).toBe(0)
    expect(existsSync(leftover)).toBe(false)
    expect(existsSync(executableOf(target))).toBe(true)
    // No staging folder is left next to the copy.
    expect(readdirSync(dir).sort()).toEqual([STABLE, 'worfy-stable.json'])
  })

  // A `statusLine` that points at the bridge of the stable copy keeps working when the copy is
  // replaced: the path stays the same and the file stays executable. On Windows the `statusLine`
  // names statusline-bridge.mjs, run by node (src/main/harness/status-line.ts), and there is no
  // executable bit: the path and the file stay the same.
  test(`a second run leaves the status line bridge at the same path${WINDOWS ? '' : ', executable'}`, () => {
    const target = join(dir, STABLE)
    const bridge = join(resourcesOf(target), 'statusline-bridge.sh')
    const module = join(resourcesOf(target), 'statusline-bridge.mjs')
    expect(install(target).status).toBe(0)
    if (WINDOWS) expect(existsSync(module)).toBe(true)
    else expect(isExecutable(bridge)).toBe(true)

    const again = install(target)
    expect(again.stderr).toBe('')
    expect(again.status).toBe(0)
    expect(existsSync(bridge)).toBe(true)
    if (!WINDOWS) expect(isExecutable(bridge)).toBe(true)
    expect(readFileSync(bridge).equals(readFileSync(bridgeScript))).toBe(true)
    expect(readFileSync(module).equals(readFileSync(bridgeModule))).toBe(true)
  })

  test('refuses with a non-zero exit code while the copy is running, and leaves it in place', async () => {
    const target = join(dir, STABLE)
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
  test(`keeps its state in ${DATA_FOLDER}-dev, apart from the stable copy`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'worfy-home-'))
    try {
      // An empty WORFY_DATA_DIR is ignored, so the app picks its own folder under the temporary
      // HOME (on Windows: under the temporary APPDATA, %APPDATA%\worfy-dev).
      const launched = await launchApp({ env: { ...dataHomeEnv(home), WORFY_DATA_DIR: '' } })
      try {
        expect(await launched.app.evaluate(({ app }) => app.isPackaged)).toBe(false)
        expect(await userData(launched)).toBe(defaultDataDir(home, 'worfy-dev'))
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
    test.skip(QUITS_WITH_LAST_WINDOW, 'off macOS the app quits when its last window closes (window-all-closed, src/main/index.ts): no running app is left without a window')
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
    const dataDir = join(root, 'data')
    const env = directStartEnv({
      dataDir,
      claudeHome: root,
      // The native error window is modal and would hold the process until someone dismisses it.
      env: { ELECTRON_RENDERER_URL: 'not a url', WORFY_STARTUP_DIALOG: 'off' },
    })
    const electron = createRequire(import.meta.url)('electron') as string
    // Started without Playwright: launchApp waits for a window, and this start must never open one.
    const child = spawn(electron, [repoRoot, ...NO_WINDOW_RESTORE], { cwd: repoRoot, env, stdio: ['ignore', 'ignore', 'pipe'] })
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
      // No child of Chromium outlives the main process (worfy-windows ticket 95): an app.exit(1)
      // made before Electron's main message loop runs left the network utility process alive on
      // Windows. Each child carries the run's data folder as --user-data-dir (quoted on Windows).
      await new Promise((done) => setTimeout(done, 5_000))
      expect(childrenOfRun(dataDir), 'processes of this run alive 5 s after the main process exited').toEqual([])
    } finally {
      // Only the processes of this run's data folder (a fresh temporary one); a failed run must not
      // leave them for the next test. A failure here is only a warning: it must neither hide the
      // test's own failure nor keep the temporary folder.
      try {
        for (const { pid } of childrenOfRun(dataDir)) {
          try {
            process.kill(pid)
          } catch {
            // Already gone.
          }
        }
      } catch (error) {
        console.warn(`[packaged.spec] could not stop the processes of ${dataDir}`, error)
      }
      await removeDir(root)
    }
  })

  test('install-stable.mjs refuses a target that is not a .app, before building anything', () => {
    // On Windows a target is any folder (the test below has the Windows refusal): a run there
    // would build the app and install it.
    test.skip(WINDOWS, 'a Windows stable copy is a folder, not a .app: the rule does not exist there')
    const result = spawnSync(process.execPath, [installScript, join(tmpdir(), 'not-an-app')], { encoding: 'utf8' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('must be a path ending in .app')
  })

  test('install-stable.mjs on Windows refuses a target whose path starts with the folder of worfy\'s installer, before building anything', async () => {
    test.skip(!WINDOWS, 'the folder of the installer is a Windows rule; the macOS rule is the .app one above')
    const profile = await mkdtemp(join(tmpdir(), 'worfy-install-profile-'))
    try {
      const vars = profileVars(profile)
      const target = join(vars.LOCALAPPDATA, 'Programs', 'worfy-stable')
      // A prebuilt app that is not there: were the target taken, the run would end at it, not build.
      const env = { ...process.env, ...vars, WORFY_STABLE_PREBUILT: join(profile, 'no-build') }
      const result = spawnSync(process.execPath, [installScript, target], { encoding: 'utf8', env })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain(`the target cannot start with the path of the folder the installer of worfy uses (${join(vars.LOCALAPPDATA, 'Programs', 'worfy')})`)
      expect(existsSync(join(vars.LOCALAPPDATA, 'Programs'))).toBe(false)
    } finally {
      await removeDir(profile)
    }
  })
  test('pnpm build copies harness/ into out/harness with the build version, and leaves harness/ untouched', () => {
    const version = expectHarnessCopy(join(repoRoot, 'out', 'harness'))
    expect(version).toBe(buildVersion(repoRoot))
    expect(spawnSync('git', ['-C', repoRoot, 'diff', '--quiet', '--', 'harness']).status).toBe(0)
    expect(readJson(join(repoRoot, 'harness', '.claude-plugin', 'plugin.json'))).not.toHaveProperty('version')
  })

})

// The install script against a stand-in app: no packaged build needed, so these run in `pnpm test:e2e`.
test.describe('scripts/install-stable.mjs with a stand-in app', () => {
  let dir: string

  test.beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'worfy-install-'))
  })

  test.afterEach(async () => {
    await removeDir(dir)
  })

  test(`without an argument installs into ${WINDOWS ? '%LOCALAPPDATA%\\worfy-stable' : '~/Applications/worfy-stable.app'}, with worfy-stable.json next to it`, () => {
    const home = join(dir, 'home')
    mkdirSync(home)
    // On Windows the default is %LOCALAPPDATA%\worfy-stable: the profile folders of this test's home.
    const result = runScript(installScript, [], { HOME: home, ...(WINDOWS ? profileVars(home) : {}), WORFY_STABLE_PREBUILT: standInApp(dir) })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    const applications = WINDOWS ? profileVars(home).LOCALAPPDATA : join(home, 'Applications')
    // On Windows the PowerShell that lists the processes keeps its caches in %LOCALAPPDATA%\Microsoft.
    expect(readdirSync(applications).filter((name) => !(WINDOWS && name === 'Microsoft')).sort()).toEqual([STABLE, 'worfy-stable.json'])
    expect(existsSync(standInMarker(join(applications, STABLE)))).toBe(true)
    const head = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
    expect(readJson(join(applications, 'worfy-stable.json')).commit).toBe(head)
  })

  test('accepts a target path with a trailing slash, as shell completion writes it', () => {
    // PowerShell and cmd.exe complete a folder on Windows with a backslash.
    const result = runScript(installScript, [`${join(dir, STABLE)}${WINDOWS ? '\\' : '/'}`], { WORFY_STABLE_PREBUILT: standInApp(dir) })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
    expect(existsSync(standInMarker(join(dir, STABLE)))).toBe(true)
    expect(existsSync(join(dir, 'worfy-stable.json'))).toBe(true)
  })

  test('marks the copy dirty when the tree it was built from has an untracked file', () => {
    // A repository of its own, so the test controls what is committed; the script finds the
    // repository from its own location.
    const repo = join(dir, 'repo')
    mkdirSync(join(repo, 'scripts'), { recursive: true })
    cpSync(installScript, join(repo, 'scripts', 'install-stable.mjs'))
    const git = (...args: string[]): string => {
      const result = spawnSync('git', ['-C', repo, '-c', 'user.name=worfy-test', '-c', 'user.email=test@worfy.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8' })
      expect(result.status).toBe(0)
      return result.stdout.trim()
    }
    git('init', '-q', '--initial-branch=main')
    git('add', '.')
    git('commit', '-q', '-m', 'install script')
    const script = join(repo, 'scripts', 'install-stable.mjs')
    const target = join(dir, 'Apps', STABLE)
    const env = { WORFY_STABLE_PREBUILT: standInApp(dir) }

    expect(runScript(script, [target], env).status).toBe(0)
    const clean = readJson(join(dir, 'Apps', 'worfy-stable.json'))
    expect(clean).toMatchObject({ commit: git('rev-parse', 'HEAD'), dirty: false })

    writeFileSync(join(repo, 'new-source.ts'), 'export const added = true\n')
    expect(runScript(script, [target], env).status).toBe(0)
    expect(readJson(join(dir, 'Apps', 'worfy-stable.json'))).toMatchObject({ commit: clean.commit, dirty: true })
  })
})

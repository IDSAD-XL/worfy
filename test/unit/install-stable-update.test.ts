// scripts/install-stable.mjs as the helper of an Update (worfy-update ticket 02, ADR-0089 item 4): it
// waits for the running worfy to quit (--wait-pid), keeps the copy it replaces as worfy-stable.previous
// (--keep-previous), rolls back to that copy (--rollback), starts what is at the target afterwards
// (--relaunch) and writes what it did into a file (--result). The functions behind the flags are tested
// in install-stable-functions.test.ts; here the script runs over a stand-in build and stand-in copies.
//
// No test may reach the real Stable copy or its data. inTemp throws outside the test's temporary folder
// and on the places of the real copy, and it checks every path a run is given (the target, --result),
// every path the script renames or removes through the rename and removeFolder it is given, the copies
// and files the tests make, and what --relaunch is asked to start. The script's own writes go past it —
// mkdirSync of the target's folder, unlinkSync of a metadata file, utimesSync of the copy, the file of
// --result — but each lies at the target, next to it or at --result, which inTemp has checked. The home
// the script is given is a temporary folder too, so a default target never resolves to ~/Applications
// or to %LOCALAPPDATA%\worfy-stable.
//
// The installs run in this process, with an empty list of processes, as the deploy-mark cases of
// install-stable-functions.test.ts do; the list of processes for real is tested by install-stable.test.ts.
// A whole install copies the build with ditto off Windows, which Linux does not have: those cases skip
// Linux. A rollback copies nothing, and runs everywhere.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'
import { build, defaultTarget, dir, head, local, metadataPath, REPO, run, targetIn, useStandInBuild, WINDOWS, type Env } from './install-stable-harness'

interface Facts {
  commit: string
  prebuilt: boolean
}
interface Options {
  env: Env
  repo: string
  home?: string
  rename?: (from: string, to: string) => void
  removeFolder?: (path: string) => void
  listing?: (platform: string) => string
  mark?: (facts: Facts) => string | null
  alive?: (pid: number) => boolean
  now?: () => number
  sleep?: (ms: number) => void
  start?: (command: string, args: string[]) => void
}
interface Result {
  ok: boolean
  action: 'install' | 'rollback'
  commit: string | null
  previous: string | null
  reason?: string
  notes: string[]
}
interface WaitClock {
  now?: () => number
  sleep?: (ms: number) => void
  limit?: number
  every?: number
}
interface CopyProcess {
  pid: number | null
  line: string
  outside: boolean
}
const { installStable, previousPaths, WAIT_LIMIT_MS, WAIT_EVERY_MS, waitForCopyToQuit, describeProcess, copyStillRuns, runningCopies, copyProcesses, startedOutside } = (await import(
  pathToFileURL(join(REPO, 'scripts', 'install-stable.mjs')).href
)) as {
  installStable: (argv: string[], options: Options) => string
  previousPaths: (platform: string, target: string) => { copy: string; metadata: string }
  WAIT_LIMIT_MS: number
  WAIT_EVERY_MS: number
  waitForCopyToQuit: (look: () => string[], clock?: WaitClock) => string[]
  describeProcess: (line: string) => string
  copyStillRuns: (running: string[], limit?: number) => string
  runningCopies: (platform: string, targets: string[], listing: string, spell?: (path: string) => string) => string[]
  copyProcesses: (platform: string, targets: string[], listing: string, options?: { spell?: (path: string) => string; own?: Set<number>; worfy?: number }) => CopyProcess[]
  startedOutside: (outside: string[], retry: string) => string
}

/** The places of the real Stable copy and of worfy's data on this machine. */
const REAL = [
  join(homedir(), 'Applications'),
  join(homedir(), 'Library', 'Application Support', 'worfy'),
  ...[process.env.LOCALAPPDATA, join(homedir(), 'AppData', 'Local')].filter((each): each is string => Boolean(each)).map((each) => join(each, 'worfy-stable')),
]

/** The path as given, when it lies in the test's temporary folder and not where the real copy is; throws otherwise. */
const inTemp = (path: string): string => {
  const full = resolve(path).toLowerCase()
  if (REAL.some((real) => full.startsWith(real.toLowerCase()))) throw new Error(`a test reached the place of the real Stable copy: ${path}`)
  if (!full.startsWith(`${dir.toLowerCase()}${sep}`)) throw new Error(`a test reached a path outside its temporary folder: ${path}`)
  return path
}

const started: { command: string; args: string[] }[] = []
const marks: Facts[] = []

/** A run of the script in this process: every path is checked by inTemp, and nothing is started for real. */
const install = (argv: string[], extra: Partial<Options> & { env?: Env } = {}): string => {
  for (let at = 0; at < argv.length; at++) {
    if (!argv[at]!.startsWith('--') && argv[at - 1] !== '--wait-pid') inTemp(argv[at]!)
  }
  const { env, ...rest } = extra
  return installStable(argv, {
    env: { ...process.env, LOCALAPPDATA: local, WORFY_STABLE_PREBUILT: build, WORFY_STABLE_LAUNCH: join(dir, 'launch'), ...env },
    repo: REPO,
    home: join(dir, 'home'),
    rename: (from, to) => renameSync(inTemp(from), inTemp(to)),
    removeFolder: (path) => removeTestTree(inTemp(path)),
    listing: (platform) => (platform === 'win32' ? '[]' : ''),
    mark: (facts) => {
      marks.push(facts)
      return null
    },
    start: (command, args) => {
      started.push({ command, args: args.map(inTemp) })
    },
    ...rest,
  })
}

/** A stand-in copy at `path`: what the script takes for a built worfy, and a file that tells it from another. */
const copyAt = (path: string, which: string): void => {
  mkdirSync(join(inTemp(path), 'Contents'), { recursive: true })
  writeFileSync(join(path, 'worfy.exe'), 'not a real program')
  writeFileSync(join(path, 'Contents', 'Info.plist'), 'not a real plist')
  writeFileSync(join(path, 'which.txt'), which)
}
const which = (path: string): string => readFileSync(join(path, 'which.txt'), 'utf8')
/** The file every whole build has: the script takes a folder without it for no copy. */
const marker = (path: string): string => join(path, WINDOWS ? 'worfy.exe' : join('Contents', 'Info.plist'))
/** A list of processes in which the copy at `target` runs, as `ps` or PowerShell prints it. */
const runningAt = (target: string) => (platform: string): string =>
  platform === 'win32' ? JSON.stringify([{ ProcessId: 4242, Name: 'worfy.exe', ExecutablePath: join(target, 'worfy.exe') }]) : `4242 ${target}/Contents/MacOS/worfy\n`
const read = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'))
const removeFile = (file: string): void => unlinkSync(inTemp(file))
const PLATFORM = process.platform

describe('the paths of the tests of an Update', () => {
  useStandInBuild()

  it('are refused at the places of the real Stable copy and outside the temporary folder, so no test can reach them', () => {
    for (const platform of ['darwin', 'win32']) {
      const real = defaultTarget(platform, process.env, homedir())
      if (platform === PLATFORM) {
        expect(() => inTemp(real)).toThrow('a test reached the place of the real Stable copy')
        expect(() => inTemp(previousPaths(platform, real).copy)).toThrow('a test reached the place of the real Stable copy')
      }
    }
    expect(() => inTemp(join(homedir(), 'Applications', 'worfy-stable.json'))).toThrow('the real Stable copy')
    expect(() => inTemp(join(dir, '..', 'elsewhere'))).toThrow('outside its temporary folder')
    expect(inTemp(targetIn('apps', 'worfy-stable'))).toBe(targetIn('apps', 'worfy-stable'))
  })
})

describe('a rollback to the previous copy (--rollback)', () => {
  useStandInBuild()
  beforeEach(() => {
    started.length = 0
    marks.length = 0
    // The stand-in of Launch Services' tool is a new script each test, which macOS checks before its first run.
    if (PLATFORM === 'darwin') process.env.WORFY_STABLE_LSREGISTER = '/usr/bin/true'
  })

  /** A copy at the target and a previous one next to it, each with its file. */
  const both = () => {
    const target = targetIn('apps', 'worfy-stable')
    const previous = previousPaths(PLATFORM, target)
    const metadata = metadataPath(PLATFORM, target)
    copyAt(target, 'current')
    copyAt(previous.copy, 'previous')
    writeFileSync(inTemp(metadata), JSON.stringify({ commit: 'c'.repeat(40) }))
    writeFileSync(inTemp(previous.metadata), JSON.stringify({ commit: 'b'.repeat(40) }))
    return { target, previous, metadata, folder: join(dir, 'apps') }
  }

  it('puts the previous copy and its file at the target, and removes the copy it rolled back from', () => {
    const { target, previous, metadata, folder } = both()
    const out = install(['--rollback', target])
    expect(which(target)).toBe('previous')
    expect(read(metadata)).toEqual({ commit: 'b'.repeat(40) })
    expect(existsSync(previous.copy)).toBe(false)
    expect(existsSync(previous.metadata)).toBe(false)
    expect(readdirSync(folder).sort()).toEqual([target, metadata].map((path) => path.slice(folder.length + 1)).sort())
    expect(out).toBe(`install-stable: rolled back ${target} to commit bbbbbbb, details in ${metadata}`)
    expect(marks).toEqual([])
  })

  it('without a previous copy refuses and touches nothing; run as a script, it exits with code 1', () => {
    const target = targetIn('apps', 'worfy-stable')
    copyAt(target, 'current')
    const before = readdirSync(join(dir, 'apps')).sort()
    expect(() => install(['--rollback', target])).toThrow(`there is no previous copy at ${previousPaths(PLATFORM, target).copy} to roll back to`)
    expect(readdirSync(join(dir, 'apps')).sort()).toEqual(before)
    expect(which(target)).toBe('current')

    const script = run(['--rollback', target])
    expect(script.status).toBe(1)
    expect(script.stderr).toContain('there is no previous copy at')
    expect(readdirSync(join(dir, 'apps')).sort()).toEqual(before)
  }, ms(60_000))

  it.each([
    ['an empty folder', (path: string) => mkdirSync(inTemp(path), { recursive: true })],
    ['a copy a removal stopped half way', (path: string) => {
      copyAt(path, 'previous')
      removeFile(marker(path))
    }],
  ])('refuses a previous copy that is %s, touches nothing, and names no previous copy', (_name, make) => {
    const target = targetIn('apps', 'worfy-stable')
    const previous = previousPaths(PLATFORM, target)
    const result = join(dir, 'result.json')
    copyAt(target, 'current')
    make(previous.copy)
    const before = readdirSync(join(dir, 'apps')).sort()
    expect(() => install(['--rollback', target, '--result', result])).toThrow(`the previous copy at ${previous.copy} is not a whole worfy`)
    expect(readdirSync(join(dir, 'apps')).sort()).toEqual(before)
    expect(which(target)).toBe('current')
    expect(read(result)).toMatchObject({ ok: false, previous: null })
  })

  it('when the previous copy cannot be moved in, the copy that was there goes back: both are where they were', () => {
    const { target, previous, metadata, folder } = both()
    const before = readdirSync(folder).sort()
    const rename = (from: string, to: string): void => {
      if (from === previous.copy) throw new Error('busy')
      renameSync(inTemp(from), inTemp(to))
    }
    expect(() => install(['--rollback', target], { rename })).toThrow('the copy that was there is back in place')
    expect(which(target)).toBe('current')
    expect(which(previous.copy)).toBe('previous')
    expect(read(metadata)).toEqual({ commit: 'c'.repeat(40) })
    expect(read(previous.metadata)).toEqual({ commit: 'b'.repeat(40) })
    expect(readdirSync(folder).sort()).toEqual(before)
  })

  it('with --relaunch starts the program of WORFY_STABLE_LAUNCH with the target, after a rollback and after a refusal', () => {
    const { target } = both()
    install(['--rollback', target, '--relaunch'])
    expect(started).toEqual([{ command: join(dir, 'launch'), args: [target] }])
    started.length = 0
    expect(() => install(['--rollback', target, '--relaunch'])).toThrow('there is no previous copy')
    expect(started).toEqual([{ command: join(dir, 'launch'), args: [target] }])
  })

  it('with --relaunch starts what is at the target after a refusal of the arguments too: the target given, or the default one', () => {
    const target = targetIn('apps', 'worfy-stable')
    copyAt(target, 'current')
    expect(() => install(['--relaunch', '--bogus', target])).toThrow('unknown option --bogus')
    expect(started).toEqual([{ command: join(dir, 'launch'), args: [target] }])

    started.length = 0
    const fallback = defaultTarget(PLATFORM, { LOCALAPPDATA: local }, join(dir, 'home'))
    copyAt(fallback, 'default')
    expect(() => install(['--relaunch', '--bogus'])).toThrow('unknown option --bogus')
    expect(started).toEqual([{ command: join(dir, 'launch'), args: [fallback] }])
  })

  it('with --relaunch and nothing at the target starts nothing, and says so', () => {
    const target = targetIn('apps', 'worfy-stable')
    const result = join(dir, 'result.json')
    expect(() => install(['--rollback', target, '--relaunch', '--result', result])).toThrow('there is no previous copy')
    expect(started).toEqual([])
    expect((read(result) as Result).notes).toEqual([`nothing is at ${target} to start`])
  })

  it('with --result writes what it did, after a rollback and after a refusal', () => {
    const { target } = both()
    const result = join(dir, 'result.json')
    install(['--rollback', target, '--result', result])
    expect(read(result)).toEqual({ ok: true, action: 'rollback', commit: 'b'.repeat(40), previous: null, notes: [] })
    expect(() => install(['--rollback', target, '--result', result])).toThrow('there is no previous copy')
    expect(read(result)).toEqual({ ok: false, action: 'rollback', commit: null, previous: null, reason: `there is no previous copy at ${previousPaths(PLATFORM, target).copy} to roll back to`, notes: [] })
    expect(readdirSync(dir).filter((name) => name.startsWith('result'))).toEqual(['result.json'])
  })

  it('with --result writes a refusal of its arguments too', () => {
    const result = join(dir, 'result.json')
    expect(() => install(['--rollback', '--keep-previous', '--result', result])).toThrow('--rollback and --keep-previous do not go together')
    expect(read(result)).toEqual({ ok: false, action: 'rollback', commit: null, previous: null, reason: '--rollback and --keep-previous do not go together', notes: [] })
  })

  it('run as a script with --relaunch, starts the program for real, detached', async () => {
    // The program is node, given the target: it runs the index.js of that folder, which writes where it ran.
    const target = targetIn('apps', 'worfy-stable')
    copyAt(target, 'current')
    const launched = join(dir, 'launched.txt')
    writeFileSync(join(target, 'index.js'), `require('node:fs').writeFileSync(${JSON.stringify(launched)}, __dirname)\n`)
    const script = run(['--rollback', target, '--relaunch'], { WORFY_STABLE_LAUNCH: scriptNode() })
    expect(script.status).toBe(1)
    const deadline = Date.now() + ms(10_000)
    while (!existsSync(launched) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 50))
    // Compared as the disk spells both: on Windows a temporary folder may be given by its 8.3 short name.
    expect(realpathSync.native(readFileSync(launched, 'utf8'))).toBe(realpathSync.native(target))
  }, ms(60_000))
})

describe('a wait for the running worfy to quit (--wait-pid)', () => {
  useStandInBuild()
  let child: ChildProcess | undefined
  let orphan: number | undefined
  beforeEach(() => {
    started.length = 0
    marks.length = 0
  })
  afterEach(() => {
    child?.kill()
    child = undefined
    if (orphan !== undefined) {
      try {
        process.kill(orphan)
      } catch {
        // Gone already, as it should be.
      }
      orphan = undefined
    }
  })
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM'
    }
  }

  /** A clock that moves only when the script sleeps, and the pauses it was asked for. */
  const fakeTime = () => {
    const state = { clock: 0, sleeps: [] as number[] }
    return { state, now: () => state.clock, sleep: (wait: number) => void (state.sleeps.push(wait), (state.clock += wait)) }
  }

  it('refuses when the process does not quit in time and the copy at the target runs, and touches nothing', () => {
    child = spawn(scriptNode(), ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' })
    const pid = child.pid!
    const time = fakeTime()
    const target = targetIn('apps', 'worfy-stable')
    copyAt(target, 'current')
    const before = readdirSync(join(dir, 'apps')).sort()
    expect(() => install([target, '--wait-pid', String(pid)], { now: time.now, sleep: time.sleep, listing: runningAt(target) })).toThrow(`process ${pid} is still running after 120 s: nothing was changed`)
    expect(time.state.sleeps).toEqual(Array.from({ length: WAIT_LIMIT_MS / WAIT_EVERY_MS }, () => 500))
    expect(readdirSync(join(dir, 'apps')).sort()).toEqual(before)
    expect(which(target)).toBe('current')
    expect(alive(pid)).toBe(true)
  })

  it('goes on when the process still runs at the limit but no copy at the target runs: Windows gives a number out again', () => {
    child = spawn(scriptNode(), ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' })
    const pid = child.pid!
    const time = fakeTime()
    const target = targetIn('apps', 'worfy-stable')
    const result = join(dir, 'result.json')
    copyAt(target, 'current')
    copyAt(previousPaths(PLATFORM, target).copy, 'previous')
    install(['--rollback', target, '--wait-pid', String(pid), '--result', result], { now: time.now, sleep: time.sleep })
    expect(which(target)).toBe('previous')
    expect(read(result)).toMatchObject({ ok: true, notes: [`process ${pid} still ran after 120 s, but no copy at ${target} runs: it is taken for another program with that number`] })
  })

  // The process waited for is not a child of this one: a child that has quit stays a zombie, which the
  // signal 0 still finds, until this process's event loop reaps it, and the install blocks that loop. So a
  // node starts it detached and quits, as worfy is not the helper's child either.
  it.runIf(PLATFORM !== 'linux')('installs once the process has quit', () => {
    const code = `const c = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1500)'], { detached: true, stdio: 'ignore' }); c.unref(); console.log(c.pid)`
    orphan = Number(execFileSync(scriptNode(), ['-e', code], { encoding: 'utf8' }).trim())
    expect(alive(orphan)).toBe(true)
    const target = targetIn('apps', 'worfy-stable')
    const out = install([target, '--wait-pid', String(orphan)])
    expect(alive(orphan)).toBe(false)
    expect(out).toContain(`install-stable: installed ${target}`)
    expect(existsSync(join(target, WINDOWS ? 'worfy.exe' : join('Contents', 'Info.plist')))).toBe(true)
  }, ms(15_000))
})

// worfy-polish ticket 53: worfy (--wait-pid) quits before the Claude Code of its Sessions, which lies
// inside the copy (app.asar.unpacked). The helper gives the processes of the copy the same limit to quit.
describe('a wait for the processes of the copy after worfy quit (worfy-polish ticket 53)', () => {
  useStandInBuild()
  beforeEach(() => {
    started.length = 0
    marks.length = 0
  })

  /** A clock that moves only when the script sleeps, and the pauses it was asked for. */
  const fakeTime = () => {
    const state = { clock: 0, sleeps: [] as number[] }
    return { state, now: () => state.clock, sleep: (wait: number) => void (state.sleeps.push(wait), (state.clock += wait)) }
  }
  const CHILD = 4243
  /** The list of processes with the Claude Code of a Session inside the copy at `target`, as `ps` or PowerShell prints it. */
  const sessionChildAt = (target: string) => (platform: string): string =>
    platform === 'win32'
      ? JSON.stringify([{ ProcessId: CHILD, Name: 'claude.exe', ExecutablePath: join(target, 'resources', 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-win32-x64', 'claude.exe') }])
      : `${CHILD} ${target}/Contents/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude --resume=s1\n`
  /** The child as the refusal names it. */
  const childNamed = PLATFORM === 'win32' ? `pid ${CHILD} (claude.exe)` : `pid ${CHILD} (claude --resume=s1)`
  /** A listing in which the child runs until `quitsAt` on the clock of `time`. */
  const childUntil = (target: string, time: ReturnType<typeof fakeTime>, quitsAt: number) => (platform: string): string =>
    time.state.clock < quitsAt ? sessionChildAt(target)(platform) : platform === 'win32' ? '[]' : ''
  const gone = (): boolean => false

  it('a process of the copy that quits a few seconds after --wait-pid gives no refusal: the roll back goes on', () => {
    const time = fakeTime()
    const target = targetIn('apps', 'worfy-stable')
    const result = join(dir, 'result.json')
    copyAt(target, 'current')
    copyAt(previousPaths(PLATFORM, target).copy, 'previous')
    install(['--rollback', target, '--wait-pid', '4242', '--result', result], { now: time.now, sleep: time.sleep, alive: gone, listing: childUntil(target, time, 3_000) })
    expect(which(target)).toBe('previous')
    expect(read(result)).toMatchObject({ ok: true, action: 'rollback' })
    // It looked every 500 ms until the child was gone, and no longer.
    expect(time.state.sleeps).toEqual(Array.from({ length: 3_000 / WAIT_EVERY_MS }, () => WAIT_EVERY_MS))
  })

  it.runIf(PLATFORM !== 'linux')('an install waits the same way for a Session child that quits late', { timeout: ms(15_000) }, () => {
    const time = fakeTime()
    const target = targetIn('apps', 'worfy-stable')
    copyAt(target, 'current')
    const out = install([target, '--wait-pid', '4242', '--keep-previous'], { now: time.now, sleep: time.sleep, alive: gone, listing: childUntil(target, time, 5_000) })
    expect(out).toContain(`install-stable: installed ${target}`)
    expect(which(previousPaths(PLATFORM, target).copy)).toBe('current')
  })

  it('a process of the copy that does not quit by the limit gives a refusal that names its pid, and touches nothing', () => {
    const time = fakeTime()
    const target = targetIn('apps', 'worfy-stable')
    const result = join(dir, 'result.json')
    copyAt(target, 'current')
    copyAt(previousPaths(PLATFORM, target).copy, 'previous')
    const before = readdirSync(join(dir, 'apps')).sort()
    const reason = `the stable copy still ran 120 s after worfy quit: quit it, then try again. Nothing was changed. Still running: ${childNamed}`
    expect(() => install(['--rollback', target, '--wait-pid', '4242', '--result', result], { now: time.now, sleep: time.sleep, alive: gone, listing: sessionChildAt(target) })).toThrow(reason)
    expect(read(result)).toMatchObject({ ok: false, reason })
    expect(time.state.sleeps.reduce((sum, each) => sum + each, 0)).toBe(WAIT_LIMIT_MS)
    expect(readdirSync(join(dir, 'apps')).sort()).toEqual(before)
    expect(which(target)).toBe('current')
  })

  it('without --wait-pid a running copy is refused at once, as before', () => {
    const time = fakeTime()
    const target = targetIn('apps', 'worfy-stable')
    copyAt(target, 'current')
    copyAt(previousPaths(PLATFORM, target).copy, 'previous')
    expect(() => install(['--rollback', target], { now: time.now, sleep: time.sleep, listing: sessionChildAt(target) })).toThrow(`the stable copy at ${target} is running`)
    expect(time.state.sleeps).toEqual([])
  })
})

describe('the functions of the wait for the copy (worfy-polish ticket 53), on either system', () => {
  const WIN_TARGET = 'C:\\Users\\dev\\AppData\\Local\\worfy-stable'
  const MAC_TARGET = '/Users/dev/Applications/worfy-stable.app'
  const winListing = (processes: { ProcessId: number; Name: string; ExecutablePath?: string }[]): string => JSON.stringify(processes)
  const claudeExe = { ProcessId: 812, Name: 'claude.exe', ExecutablePath: `${WIN_TARGET}\\resources\\app.asar.unpacked\\node_modules\\@anthropic-ai\\claude-agent-sdk-win32-x64\\claude.exe` }

  it('waitForCopyToQuit answers [] once a Windows listing has no process of the copy, looking every 500 ms', () => {
    const state = { clock: 0, sleeps: [] as number[] }
    const look = (): string[] => runningCopies('win32', [WIN_TARGET], winListing(state.clock < 2_000 ? [claudeExe] : [{ ProcessId: 9, Name: 'explorer.exe', ExecutablePath: 'C:\\Windows\\explorer.exe' }]))
    expect(waitForCopyToQuit(look, { now: () => state.clock, sleep: (wait) => void (state.sleeps.push(wait), (state.clock += wait)) })).toEqual([])
    expect(state.sleeps).toEqual([500, 500, 500, 500])
  })

  it('waitForCopyToQuit answers what still runs at the limit, and waits no longer', () => {
    const state = { clock: 0, sleeps: [] as number[] }
    const look = (): string[] => runningCopies('win32', [WIN_TARGET], winListing([claudeExe]))
    expect(waitForCopyToQuit(look, { now: () => state.clock, sleep: (wait) => void (state.sleeps.push(wait), (state.clock += wait)), limit: 1_200 })).toEqual([`812 ${claudeExe.ExecutablePath}`])
    expect(state.sleeps).toEqual([500, 500, 200])
  })

  it('describeProcess names the pid and the program without the folder of the copy, on macOS and on Windows', () => {
    const [mac] = runningCopies('darwin', [MAC_TARGET], `  4321 ${MAC_TARGET}/Contents/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude --resume=abc\n`)
    expect(describeProcess(mac!)).toBe('pid 4321 (claude --resume=abc)')
    const [helper] = runningCopies('darwin', [MAC_TARGET], `  77 ${MAC_TARGET}/Contents/Frameworks/worfy Helper (Renderer).app/Contents/MacOS/worfy Helper (Renderer) --type=renderer\n`)
    expect(describeProcess(helper!)).toBe('pid 77 (worfy Helper (Renderer) --type=renderer)')
    const [win] = runningCopies('win32', [WIN_TARGET], winListing([claudeExe]))
    expect(describeProcess(win!)).toBe('pid 812 (claude.exe)')
    const [unknown] = runningCopies('win32', [WIN_TARGET], winListing([{ ProcessId: 90, Name: 'worfy.exe' }]))
    expect(describeProcess(unknown!)).toMatch(/^pid 90 \(worfy\.exe \(Windows does not say where it runs from.{0,10}…\)$/u)
    expect(describeProcess(`5 /x/claude --resume=${'a'.repeat(100)}`)).toBe(`pid 5 (claude --resume=${'a'.repeat(43)}…)`)
  })

  it('copyStillRuns says what to do first, names two processes and counts the rest', () => {
    const lines = ['1 /a/claude --resume=x', '2 /a/claude --resume=y', '3 /a/claude --resume=z']
    const reason = copyStillRuns(lines)
    expect(reason).toBe('the stable copy still ran 120 s after worfy quit: quit it, then try again. Nothing was changed. Still running: pid 1 (claude --resume=x), pid 2 (claude --resume=y) and 1 more')
    // A toast shows three lines (src/renderer/toast/toast.css): what to do stays in the first ones.
    expect(reason.indexOf('then try again')).toBeLessThan(80)
  })
})

describe.runIf(PLATFORM !== 'linux')('an install that keeps the copy it replaces (--keep-previous)', { timeout: ms(15_000) }, () => {
  useStandInBuild()
  beforeEach(() => {
    started.length = 0
    marks.length = 0
    if (PLATFORM === 'darwin') process.env.WORFY_STABLE_LSREGISTER = '/usr/bin/true'
  })

  it('moves the earlier copy and its file to worfy-stable.previous; the next such install removes that one first', () => {
    const target = targetIn('apps', 'worfy-stable')
    const folder = join(dir, 'apps')
    const metadata = metadataPath(PLATFORM, target)
    const previous = previousPaths(PLATFORM, target)
    install([target])
    writeFileSync(join(target, 'which.txt'), 'first')
    const first = read(metadata)
    marks.length = 0

    const out = install([target, '--keep-previous'])
    expect(existsSync(join(target, 'which.txt'))).toBe(false)
    expect(which(previous.copy)).toBe('first')
    expect(read(previous.metadata)).toEqual(first)
    expect(out.split('\n')).toEqual([`install-stable: installed ${target} (commit ${head().slice(0, 7)}${(read(metadata) as { dirty: boolean }).dirty ? ', uncommitted changes' : ''}), details in ${metadata}`, `install-stable: the earlier copy is kept at ${previous.copy}`])

    writeFileSync(join(target, 'which.txt'), 'second')
    const second = read(metadata)
    install([target, '--keep-previous'])
    expect(which(previous.copy)).toBe('second')
    expect(read(previous.metadata)).toEqual(second)
    expect(readdirSync(folder).sort()).toEqual([target, metadata, previous.copy, previous.metadata].map((path) => path.slice(folder.length + 1)).sort())
    expect(marks).toEqual([])
  })

  it('moves the copy kept before away from its name before removing it: a removal stopped half way leaves no half copy as the previous one', () => {
    const target = targetIn('apps', 'worfy-stable')
    const previous = previousPaths(PLATFORM, target)
    install([target])
    writeFileSync(join(target, 'which.txt'), 'first')
    install([target, '--keep-previous'])
    writeFileSync(join(target, 'which.txt'), 'second')
    // The removal of the first copy stops half way: its marker is gone, the rest stays.
    const removeFolder = (path: string): void => {
      if (existsSync(join(path, 'which.txt')) && which(path) === 'first') {
        removeFile(marker(path))
        throw new Error('busy')
      }
      removeTestTree(inTemp(path))
    }
    const result = join(dir, 'result.json')
    install([target, '--keep-previous', '--result', result], { removeFolder })
    expect(which(previous.copy)).toBe('second')
    expect(existsSync(marker(previous.copy))).toBe(true)
    const left = readdirSync(join(dir, 'apps')).filter((name) => name.includes('.installing-'))
    expect(left).toHaveLength(1)
    expect(read(result)).toMatchObject({ ok: true, previous: previous.copy })
    expect((read(result) as Result).notes[0]).toMatch(/^the copy kept before could not be removed and is left at .*\.installing-\d+ \(busy\); the next run removes it$/)
  })

  it('without the flag removes the earlier copy as before, and sets the deploy mark', () => {
    const target = targetIn('apps', 'worfy-stable')
    install([target])
    install([target])
    expect(existsSync(previousPaths(PLATFORM, target).copy)).toBe(false)
    expect(readdirSync(join(dir, 'apps')).sort()).toEqual([target, metadataPath(PLATFORM, target)].map((path) => path.slice(join(dir, 'apps').length + 1)).sort())
    expect(marks.map((facts) => facts.commit)).toEqual([head(), head()])
  })

  it('with --result writes the installed commit and the kept copy', () => {
    const target = targetIn('apps', 'worfy-stable')
    const result = join(dir, 'result.json')
    install([target])
    install([target, '--keep-previous', '--result', result])
    expect(read(result)).toEqual({ ok: true, action: 'install', commit: head(), previous: previousPaths(PLATFORM, target).copy, notes: [`the earlier copy is kept at ${previousPaths(PLATFORM, target).copy}`] })
  })
})

// worfy-polish ticket 58: the bundled Codex a user starts in a terminal (the dialog of worfy-polish 54
// gives its path inside the copy) is a process of the copy, but not worfy's. It is not waited for: the
// refusal comes at once and names it. worfy's own processes (Session children, the codex app-server
// worfy started) are waited for as in ticket 53, also once worfy has quit and they lost their parent.
describe('processes of the copy started outside worfy (worfy-polish ticket 58)', () => {
  const MAC = '/Users/dev/Applications/worfy-stable.app'
  const WIN = 'C:\\Users\\dev\\AppData\\Local\\worfy-stable'
  const macCodex = `${MAC}/Contents/Resources/app.asar.unpacked/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`
  const winCodex = `${WIN}\\resources\\app.asar.unpacked\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`
  const macClaude = `${MAC}/Contents/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`
  /** `ps -axo pid=,ppid=,command=` of the given rows. */
  const ps = (rows: [number, number, string][]): string => `${rows.map(([pid, ppid, command]) => `${String(pid).padStart(5)} ${String(ppid).padStart(5)} ${command}`).join('\n')}\n`
  const outsideOf = (found: CopyProcess[]): (number | null)[] => found.filter((each) => each.outside).map((each) => each.pid)
  const ownOf = (found: CopyProcess[]): (number | null)[] => found.filter((each) => !each.outside).map((each) => each.pid)

  it('macOS: a codex whose parent is a shell of a terminal is outside; the children of worfy are its own, before and after it quit', () => {
    const terminal: [number, number, string][] = [
      [300, 1, '/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal'],
      [301, 300, 'login -pf dev'],
      [302, 301, '-zsh'],
      [303, 302, macCodex],
      // An MCP server the terminal Codex started, from the Harness inside the copy: outside too.
      [304, 303, `/usr/local/bin/node ${MAC}/Contents/Resources/harness/bin/qmd-mcp`],
    ]
    const worfy: [number, number, string][] = [
      [500, 1, `${MAC}/Contents/MacOS/worfy`],
      [501, 500, `${MAC}/Contents/Frameworks/worfy Helper (Renderer).app/Contents/MacOS/worfy Helper (Renderer) --type=renderer`],
      [502, 500, `${macClaude} --resume=s1`],
      [503, 500, `${macCodex} app-server`],
      // A tool of the Session runs a script of the copy through a shell: the shell is not of the copy.
      [504, 502, '/bin/bash -c node'],
      [505, 504, `/usr/local/bin/node ${MAC}/Contents/Resources/harness/bin/ticket`],
      // A Terminal card of worfy: its shell is a child of worfy.
      [506, 500, '/bin/zsh -l'],
      [507, 506, macCodex],
    ]
    const running = copyProcesses('darwin', [MAC], ps([...terminal, ...worfy]), { worfy: 500 })
    expect(outsideOf(running)).toEqual([303, 304])
    expect(ownOf(running)).toEqual([500, 501, 502, 503, 505, 507])
    // worfy has quit: launchd took over its children (ppid 1). They are waited for, the terminal Codex is not.
    const after: [number, number, string][] = [
      [502, 1, `${macClaude} --resume=s1`],
      [503, 1, `${macCodex} app-server`],
      [504, 502, '/bin/bash -c node'],
      [505, 504, `/usr/local/bin/node ${MAC}/Contents/Resources/harness/bin/ticket`],
    ]
    expect(outsideOf(copyProcesses('darwin', [MAC], ps([...terminal, ...after]), { worfy: 500 }))).toEqual([303, 304])
    expect(ownOf(copyProcesses('darwin', [MAC], ps([...terminal, ...after]), { worfy: 500 }))).toEqual([502, 503, 505])
    // The shell of the Terminal card outlives worfy for a moment: its Codex was taken for worfy's own while worfy ran.
    const card: [number, number, string][] = [[506, 1, '/bin/zsh -l'], [507, 506, macCodex]]
    expect(outsideOf(copyProcesses('darwin', [MAC], ps(card), { worfy: 500 }))).toEqual([507])
    expect(outsideOf(copyProcesses('darwin', [MAC], ps(card), { worfy: 500, own: new Set([507]) }))).toEqual([])
  })

  it('macOS: the main program of the copy is worfy itself however it was started, and a list without parents is taken for worfy\'s', () => {
    const fromShell = ps([[700, 1, '-zsh'], [701, 700, `${MAC}/Contents/MacOS/worfy`], [702, 701, `${macClaude} --resume=s2`]])
    expect(outsideOf(copyProcesses('darwin', [MAC], fromShell))).toEqual([])
    // `ps -axo pid=,command=`, as before ticket 58: the parent of each is unknown.
    const noParents = `  303 ${macCodex}\n  502 ${macClaude} --resume=s1\n`
    expect(copyProcesses('darwin', [MAC], noParents)).toEqual([
      { pid: 303, line: `303 ${macCodex}`, outside: false },
      { pid: 502, line: `502 ${macClaude} --resume=s1`, outside: false },
    ])
    // The lines runningCopies answers keep the form `pid command`: describeProcess reads them.
    const [line] = runningCopies('darwin', [MAC], ps([[302, 1, '-zsh'], [303, 302, `${macCodex} resume`]]))
    expect(describeProcess(line!)).toBe('pid 303 (codex resume)')
  })

  it('Windows: a codex.exe whose parent is a shell is outside; a child whose parent is gone, or is worfy, is its own', () => {
    const listing = JSON.stringify([
      { ProcessId: 4, ParentProcessId: 0, Name: 'System', ExecutablePath: null },
      { ProcessId: 900, ParentProcessId: 880, Name: 'explorer.exe', ExecutablePath: 'C:\\Windows\\explorer.exe' },
      { ProcessId: 910, ParentProcessId: 900, Name: 'WindowsTerminal.exe', ExecutablePath: 'C:\\Program Files\\WindowsApps\\WindowsTerminal.exe' },
      { ProcessId: 911, ParentProcessId: 910, Name: 'powershell.exe', ExecutablePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' },
      { ProcessId: 912, ParentProcessId: 911, Name: 'codex.exe', ExecutablePath: winCodex },
      // worfy (pid 1200) has quit: Windows keeps the pid of the parent that is gone.
      { ProcessId: 1201, ParentProcessId: 1200, Name: 'claude.exe', ExecutablePath: `${WIN}\\resources\\app.asar.unpacked\\node_modules\\@anthropic-ai\\claude-agent-sdk-win32-x64\\claude.exe` },
      { ProcessId: 1202, ParentProcessId: 1200, Name: 'codex.exe', ExecutablePath: winCodex },
      // A worfy.exe started from Explorer is worfy itself, and its children are its own.
      { ProcessId: 1300, ParentProcessId: 900, Name: 'worfy.exe', ExecutablePath: `${WIN}\\worfy.exe` },
      { ProcessId: 1301, ParentProcessId: 1300, Name: 'codex.exe', ExecutablePath: winCodex },
      // Windows does not say where it runs from: taken for worfy.
      { ProcessId: 1400, ParentProcessId: 911, Name: 'worfy.exe', ExecutablePath: null },
    ])
    const running = copyProcesses('win32', [WIN], listing, { worfy: 1200 })
    expect(outsideOf(running)).toEqual([912])
    expect(ownOf(running)).toEqual([1201, 1202, 1300, 1301, 1400])
    expect(running.find((each) => each.pid === 912)?.line).toBe(`912 ${winCodex}`)
    // While worfy still ran its codex app-server was a child of its pid, whatever the rest of the list.
    const before = JSON.stringify([{ ProcessId: 1200, ParentProcessId: 900, Name: 'worfy.exe', ExecutablePath: `${WIN}\\worfy.exe` }, { ProcessId: 1202, ParentProcessId: 1200, Name: 'codex.exe', ExecutablePath: winCodex }])
    expect(outsideOf(copyProcesses('win32', [WIN], before, { worfy: 1200 }))).toEqual([])
    // A list without ParentProcessId (as before ticket 58): nothing is taken for outside.
    expect(outsideOf(copyProcesses('win32', [WIN], JSON.stringify([{ ProcessId: 912, Name: 'codex.exe', ExecutablePath: winCodex }])))).toEqual([])
  })

  it('Windows: a loop of parents (pids given out again) ends the walk', () => {
    const listing = JSON.stringify([
      { ProcessId: 20, ParentProcessId: 21, Name: 'cmd.exe', ExecutablePath: 'C:\\Windows\\System32\\cmd.exe' },
      { ProcessId: 21, ParentProcessId: 20, Name: 'codex.exe', ExecutablePath: winCodex },
    ])
    expect(outsideOf(copyProcesses('win32', [WIN], listing))).toEqual([21])
  })

  it('startedOutside names the terminal Codex by pid and says what to do first', () => {
    const reason = startedOutside([`303 ${macCodex}`], 'press Restart now again')
    expect(reason).toBe('Codex is open in a terminal (pid 303): close it, then press Restart now again. Nothing was changed.')
    // A toast shows three lines (src/renderer/toast/toast.css) after "worfy was not updated to <version>: ": the advice fits.
    expect(reason.indexOf('Restart now again') + 'Restart now again'.length).toBeLessThan(90)
    expect(startedOutside([`912 ${winCodex}`, `913 ${winCodex}`], 'press Roll back again')).toBe('Codex is open in a terminal (pids 912, 913): close it, then press Roll back again. Nothing was changed.')
    expect(startedOutside([`303 ${macCodex}`, `502 ${macClaude} --resume=s1`], 'run this again')).toBe(
      'a program of the stable copy runs outside worfy, in a terminal perhaps: close it, then run this again. Nothing was changed. Running: pid 303 (codex), pid 502 (claude --resume=s1)',
    )
  })

  describe('in a run of the script', () => {
    useStandInBuild()
    beforeEach(() => {
      started.length = 0
      marks.length = 0
    })
    const fakeTime = () => {
      const state = { clock: 0, sleeps: [] as number[] }
      return { state, now: () => state.clock, sleep: (wait: number) => void (state.sleeps.push(wait), (state.clock += wait)) }
    }
    const WORFY = 4242
    interface Row {
      pid: number
      ppid: number
      program: string
      args?: string
    }
    /** The list of processes as `ps` or PowerShell prints it; `program` lies in the copy at `target` unless it is absolute. */
    const listingOf = (target: string, rows: Row[]) => (platform: string): string => {
      const path = (program: string): string => (program.startsWith('/') || /^[A-Z]:\\/u.test(program) ? program : join(target, ...program.split('/')))
      if (platform === 'win32') return JSON.stringify(rows.map((row) => ({ ProcessId: row.pid, ParentProcessId: row.ppid, Name: row.program.split('/').pop(), ExecutablePath: path(row.program) })))
      return rows.map((row) => `${row.pid} ${row.ppid} ${path(row.program)}${row.args === undefined ? '' : ` ${row.args}`}`).join('\n')
    }
    const codexIn = PLATFORM === 'win32' ? 'resources/app.asar.unpacked/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe' : 'Contents/Resources/app.asar.unpacked/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex'
    const shell = PLATFORM === 'win32' ? 'C:\\Windows\\System32\\cmd.exe' : '/bin/zsh'
    const main = PLATFORM === 'win32' ? 'worfy.exe' : 'Contents/MacOS/worfy'
    const gone = (): boolean => false

    it('a codex of the copy started in a terminal gives a refusal at once, with its pid and what to do, and touches nothing', () => {
      const time = fakeTime()
      const target = targetIn('apps', 'worfy-stable')
      const result = join(dir, 'result.json')
      copyAt(target, 'current')
      copyAt(previousPaths(PLATFORM, target).copy, 'previous')
      const before = readdirSync(join(dir, 'apps')).sort()
      const listing = listingOf(target, [
        { pid: 600, ppid: 1, program: shell },
        { pid: 601, ppid: 600, program: codexIn },
      ])
      const reason = 'Codex is open in a terminal (pid 601): close it, then press Roll back again. Nothing was changed.'
      expect(() => install(['--rollback', target, '--wait-pid', String(WORFY), '--result', result], { now: time.now, sleep: time.sleep, alive: gone, listing })).toThrow(reason)
      expect(read(result)).toMatchObject({ ok: false, reason })
      // At once: no wait for the copy to quit.
      expect(time.state.sleeps).toEqual([])
      expect(readdirSync(join(dir, 'apps')).sort()).toEqual(before)
      expect(which(target)).toBe('current')
    })

    it('the codex app-server worfy started, which quits a few seconds after worfy, is waited for: the roll back goes on', () => {
      const time = fakeTime()
      const target = targetIn('apps', 'worfy-stable')
      copyAt(target, 'current')
      copyAt(previousPaths(PLATFORM, target).copy, 'previous')
      // While worfy runs the app-server is its child; once worfy is gone the app-server has lost its parent.
      let looks = 0
      const listing = (platform: string): string => {
        looks += 1
        if (looks === 1) return listingOf(target, [{ pid: WORFY, ppid: 1, program: main }, { pid: 610, ppid: WORFY, program: codexIn, args: 'app-server' }])(platform)
        if (time.state.clock < 3_000) return listingOf(target, [{ pid: 610, ppid: 1, program: codexIn, args: 'app-server' }])(platform)
        return listingOf(target, [])(platform)
      }
      install(['--rollback', target, '--wait-pid', String(WORFY)], { now: time.now, sleep: time.sleep, alive: gone, listing })
      expect(which(target)).toBe('previous')
      expect(time.state.sleeps).toEqual(Array.from({ length: 3_000 / WAIT_EVERY_MS }, () => WAIT_EVERY_MS))
    })

    it('a codex in a Terminal card of worfy, whose shell outlives worfy for a moment, is waited for, not refused', () => {
      const time = fakeTime()
      const target = targetIn('apps', 'worfy-stable')
      copyAt(target, 'current')
      copyAt(previousPaths(PLATFORM, target).copy, 'previous')
      let looks = 0
      const listing = (platform: string): string => {
        looks += 1
        // The first list is read while worfy still runs: the shell of the card is its child.
        if (looks === 1) return listingOf(target, [{ pid: WORFY, ppid: 1, program: main }, { pid: 620, ppid: WORFY, program: shell }, { pid: 621, ppid: 620, program: codexIn }])(platform)
        if (time.state.clock < 1_000) return listingOf(target, [{ pid: 620, ppid: 1, program: shell }, { pid: 621, ppid: 620, program: codexIn }])(platform)
        return listingOf(target, [])(platform)
      }
      install(['--rollback', target, '--wait-pid', String(WORFY)], { now: time.now, sleep: time.sleep, alive: gone, listing })
      expect(which(target)).toBe('previous')
      expect(time.state.sleeps).toEqual([WAIT_EVERY_MS, WAIT_EVERY_MS])
    })

    it('without --wait-pid a terminal codex is refused at once by name too', () => {
      const target = targetIn('apps', 'worfy-stable')
      copyAt(target, 'current')
      copyAt(previousPaths(PLATFORM, target).copy, 'previous')
      const listing = listingOf(target, [{ pid: 600, ppid: 1, program: shell }, { pid: 601, ppid: 600, program: codexIn }])
      expect(() => install(['--rollback', target], { listing })).toThrow('Codex is open in a terminal (pid 601): close it, then run this again. Nothing was changed.')
      expect(which(target)).toBe('current')
    })
  })
})

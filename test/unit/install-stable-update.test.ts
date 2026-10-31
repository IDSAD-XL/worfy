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
const { installStable, previousPaths, WAIT_LIMIT_MS, WAIT_EVERY_MS } = (await import(pathToFileURL(join(REPO, 'scripts', 'install-stable.mjs')).href)) as {
  installStable: (argv: string[], options: Options) => string
  previousPaths: (platform: string, target: string) => { copy: string; metadata: string }
  WAIT_LIMIT_MS: number
  WAIT_EVERY_MS: number
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

// scripts/install-stable.mjs (worfy-windows ticket 12): the stable copy of worfy on macOS and on
// Windows. The parts that decide by the system take it as a parameter, so both are tested here on
// any machine; so is the swap of the copies, over a stand-in of the file system. Then the script
// itself, over a stand-in build: its refusals on any system, whole installs on macOS and on
// Windows (Linux has neither system's way to copy an app), and what only Windows has, with
// %LOCALAPPDATA% pointed at a temporary folder. A whole install of a real build is run on macOS
// by test/e2e/packaged.spec.ts.
//
// The cases that never run the script are in install-stable-functions.test.ts, and what the two
// files share is in install-stable-harness.ts (worfy-windows ticket 28: the gate's bound of 1000
// lines). Every case that runs the script stays in this one file, so that they run one after
// another: on Windows the script takes a worfy.exe whose path Windows does not give for a running
// copy, and some cases here start a worfy.exe.
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'
import { build, checkTarget, dir, head, installerDir, installStable, junction, leftoverName, links, local, onDisk, REMOVE_ROUNDS, REPO, run, stamp, targetIn, useStandInBuild, WIN_HOME, WINDOWS } from './install-stable-harness'

// The script itself. Its build is a stand-in folder that has what the script looks for on either
// system, and every folder it may write to is a temporary one.
describe('scripts/install-stable.mjs, run over a stand-in build', () => {
  useStandInBuild()

  it('refuses more than one argument before anything is made', () => {
    const two = run([targetIn('one'), targetIn('two')])
    expect(two.status).not.toBe(0)
    expect(two.stderr).toContain('install-stable: expected at most one argument, the target path; got 2')
    expect(readdirSync(dir).sort()).toEqual(['build'])
  }, 60_000)

  it('refuses a build that is not a folder, and one that does not look like a built worfy, and puts nothing at the target', () => {
    const target = targetIn('apps', 'worfy-stable')
    const notAFolder = run([target], { WORFY_STABLE_PREBUILT: join(build, 'worfy.exe') })
    expect(notAFolder.status).not.toBe(0)
    expect(notAFolder.stderr).toContain('install-stable: WORFY_STABLE_PREBUILT is not a folder')
    const empty = join(dir, 'empty')
    mkdirSync(empty)
    const noBuild = run([target], { WORFY_STABLE_PREBUILT: empty })
    expect(noBuild.status).not.toBe(0)
    expect(noBuild.stderr).toContain(`install-stable: ${empty} does not look like a built worfy: there is no ${WINDOWS ? 'worfy.exe' : join('Contents', 'Info.plist')} in it`)
    expect(existsSync(target)).toBe(false)
    expect(readdirSync(join(dir, 'apps'))).toEqual([])
  }, 60_000)

  // A whole install copies with ditto on macOS and with Node on Windows; Linux has neither system's copy.
  describe.runIf(process.platform !== 'linux')('a whole install', () => {
    it('writes the commit, whether the tree was clean, both times and the build it copied next to the copy', () => {
      const target = targetIn('apps', 'worfy-stable')
      // The build was made at another time than the install.
      const built = new Date('2026-01-02T03:04:05.678Z')
      utimesSync(join(build, WINDOWS ? 'worfy.exe' : join('Contents', 'Info.plist')), built, built)
      const result = run([target])
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      const metadata = JSON.parse(readFileSync(join(dir, 'apps', 'worfy-stable.json'), 'utf8')) as Record<string, unknown>
      expect(metadata.builtAt).toBe('2026-01-02T03:04:05Z')
      expect(metadata.installedAt).not.toBe(metadata.builtAt)
      expect(Object.keys(metadata)).toEqual(['commit', 'dirty', 'builtAt', 'installedAt', 'source'])
      expect(metadata).toMatchObject({ commit: head(), source: build, builtAt: stamp(statSync(join(build, WINDOWS ? 'worfy.exe' : join('Contents', 'Info.plist'))).mtimeMs) })
      expect(typeof metadata.dirty).toBe('boolean')
      expect(metadata.installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
      expect(result.stdout).toContain(`install-stable: installed ${target} (commit ${head().slice(0, 7)}`)
      expect(readFileSync(join(target, 'resources', 'app.asar'), 'utf8')).toBe('not a real archive')
    }, 60_000)

    it('replaces an earlier copy: a file that the new build does not have is gone, and nothing is left next to the target', () => {
      const target = targetIn('apps', 'worfy-stable')
      expect(run([target]).status).toBe(0)
      writeFileSync(join(target, 'left-over.txt'), 'from the earlier copy')
      writeFileSync(join(build, 'resources', 'app.asar'), 'the next build')
      const again = run([target])
      expect(again.stderr).toBe('')
      expect(again.status).toBe(0)
      expect(existsSync(join(target, 'left-over.txt'))).toBe(false)
      expect(readFileSync(join(target, 'resources', 'app.asar'), 'utf8')).toBe('the next build')
      // Neither the copy in progress nor the earlier copy set aside.
      expect(readdirSync(join(dir, 'apps')).sort()).toEqual([WINDOWS ? 'worfy-stable' : 'worfy-stable.app', 'worfy-stable.json'].sort())
    }, 60_000)

    /** The name of the copy in its folder, and what an install in this process is given. */
    const NAME = WINDOWS ? 'worfy-stable' : 'worfy-stable.app'
    const inProcess = () => ({ env: { ...process.env, LOCALAPPDATA: local, WORFY_STABLE_PREBUILT: build }, repo: REPO })
    /** A rename that is recorded by the names it moves. */
    const recording = (moves: string[], failing: (from: string) => boolean = () => false) => (from: string, to: string) => {
      moves.push(`${basename(from)} -> ${basename(to)}`)
      if (failing(from)) throw Object.assign(new Error('the move was made to fail'), { code: 'EFAILED' })
      renameSync(from, to)
    }

    it('swaps the copies inside an install: when the new copy cannot be moved in, the earlier one is back, whole, and nothing is left next to it', () => {
      const target = targetIn('apps', 'worfy-stable')
      const apps = join(dir, 'apps')
      expect(run([target]).status).toBe(0)
      const json = readFileSync(join(apps, 'worfy-stable.json'), 'utf8')
      writeFileSync(join(build, 'resources', 'app.asar'), 'the next build')
      const moves: string[] = []
      const rename = recording(moves, (from) => basename(from).includes('.installing-'))
      expect(() => installStable([target], { ...inProcess(), rename })).toThrow(`the new copy could not be put at ${target} (the move was made to fail); the copy that was there is back in place`)
      // Aside first, the new one in, the earlier one back: never a removal before the new copy is in place.
      expect(moves).toEqual([`${NAME} -> ${NAME}.replaced-${process.pid}`, `${NAME}.installing-${process.pid} -> ${NAME}`, `${NAME}.replaced-${process.pid} -> ${NAME}`])
      expect(readFileSync(join(target, 'resources', 'app.asar'), 'utf8')).toBe('not a real archive')
      expect(readdirSync(apps).sort()).toEqual([NAME, 'worfy-stable.json'].sort())
      expect(readFileSync(join(apps, 'worfy-stable.json'), 'utf8')).toBe(json)

      // And when the earlier copy cannot be moved aside, it is not touched at all.
      moves.length = 0
      expect(() => installStable([target], { ...inProcess(), rename: recording(moves, (from) => basename(from) === NAME) })).toThrow('could not be moved aside (the move was made to fail)')
      expect(moves).toEqual([`${NAME} -> ${NAME}.replaced-${process.pid}`])
      expect(readFileSync(join(target, 'resources', 'app.asar'), 'utf8')).toBe('not a real archive')
      expect(readdirSync(apps).sort()).toEqual([NAME, 'worfy-stable.json'].sort())
    }, 60_000)

    it('clears what an interrupted run left only when there is a build to install, and only what is its own', () => {
      const target = targetIn('apps', 'worfy-stable')
      const apps = join(dir, 'apps')
      expect(run([target]).status).toBe(0)
      // A run with a pid that no process has stopped after it had moved the copy aside.
      const dead = 4_194_299
      renameSync(target, join(apps, leftoverName(NAME, 'replaced', dead)))
      mkdirSync(join(apps, leftoverName(NAME, 'installing', dead)))
      writeFileSync(join(apps, leftoverName(NAME, 'installing', dead), 'half.txt'), 'half a copy')
      // Not leftovers of the script: a file of such a name, a folder whose number no process can
      // have, and the unfinished copy of an install that is running (the pid of a living process).
      const mine = [leftoverName(NAME, 'replaced', 4_194_298), leftoverName(NAME, 'replaced', 20261012), leftoverName(NAME, 'installing', process.ppid)]
      writeFileSync(join(apps, mine[0]!), 'a file of mine')
      mkdirSync(join(apps, mine[1]!))
      writeFileSync(join(apps, mine[1]!, 'mine.txt'), 'keep me')
      mkdirSync(join(apps, mine[2]!))
      const all = () => readdirSync(apps).sort()
      const before = all()

      // A run that is refused changes nothing: there is no copy to put in.
      const empty = join(dir, 'empty')
      mkdirSync(empty)
      expect(() => installStable([target], { ...inProcess(), env: { ...inProcess().env, WORFY_STABLE_PREBUILT: empty } })).toThrow('does not look like a built worfy')
      expect(all()).toEqual(before)

      // A leftover with the pid of this very run is one too: no other run has this pid now. Left
      // where it is, it would be copied into and become part of the new copy.
      mkdirSync(join(apps, leftoverName(NAME, 'installing', process.pid)))
      writeFileSync(join(apps, leftoverName(NAME, 'installing', process.pid), 'junk.txt'), 'from a run long gone')

      // A run with a build: the copy that was moved aside goes back first, and is then replaced as any earlier copy.
      const moves: string[] = []
      const line = installStable([target], { ...inProcess(), rename: recording(moves) })
      expect(moves).toEqual([
        `${leftoverName(NAME, 'replaced', dead)} -> ${NAME}`,
        `${NAME} -> ${leftoverName(NAME, 'replaced', process.pid)}`,
        `${leftoverName(NAME, 'installing', process.pid)} -> ${NAME}`,
      ])
      expect(all()).toEqual([NAME, 'worfy-stable.json', ...mine].sort())
      expect(existsSync(join(target, 'junk.txt'))).toBe(false)
      expect(readFileSync(join(apps, mine[0]!), 'utf8')).toBe('a file of mine')
      expect(readFileSync(join(apps, mine[1]!, 'mine.txt'), 'utf8')).toBe('keep me')
      // What is kept for a running install is named, so that a stale one can be removed by hand.
      expect(line).toContain(`install-stable: ${join(apps, mine[2]!)} is left alone: a running process has the pid in its name. If no install is running, remove it by hand`)

      // With a copy at the target, a copy that an interrupted run had moved aside is removed, not put back.
      mkdirSync(join(apps, leftoverName(NAME, 'replaced', dead)))
      writeFileSync(join(apps, leftoverName(NAME, 'replaced', dead), 'old.txt'), 'an older copy')
      moves.length = 0
      installStable([target], { ...inProcess(), rename: recording(moves) })
      expect(moves).toEqual([`${NAME} -> ${leftoverName(NAME, 'replaced', process.pid)}`, `${leftoverName(NAME, 'installing', process.pid)} -> ${NAME}`])
      expect(all()).toEqual([NAME, 'worfy-stable.json', ...mine].sort())
    }, 120_000)

    it('refuses when a name it needs is taken by what it may not clear — a link to a folder of the user, or a file — and touches neither', () => {
      const target = targetIn('apps', 'worfy-stable')
      const apps = join(dir, 'apps')
      expect(run([target]).status).toBe(0)
      writeFileSync(join(build, 'resources', 'app.asar'), 'the next build')
      const staging = join(apps, leftoverName(NAME, 'installing', process.pid))
      const aside = join(apps, leftoverName(NAME, 'replaced', process.pid))
      const mine = join(dir, 'mine')
      mkdirSync(mine)
      writeFileSync(join(mine, 'notes.txt'), 'keep me')
      const untouched = (): void => {
        expect(readFileSync(join(target, 'resources', 'app.asar'), 'utf8')).toBe('not a real archive')
        expect(readdirSync(mine)).toEqual(['notes.txt'])
      }

      // A link under the name of the unfinished copy: the build would be copied through it into the folder it leads to.
      symlinkSync(mine, staging, WINDOWS ? 'junction' : 'dir')
      links.push(staging)
      expect(() => installStable([target], inProcess())).toThrow(`${staging} is in the way`)
      expect(lstatSync(staging).isSymbolicLink()).toBe(true)
      untouched()
      unlinkSync(staging)

      // A link that leads nowhere is in the way all the same: it is there, whatever a look through it says.
      const nowhere = join(dir, 'nowhere')
      mkdirSync(nowhere)
      symlinkSync(nowhere, staging, WINDOWS ? 'junction' : 'dir')
      links.push(staging)
      rmdirSync(nowhere)
      expect(existsSync(staging)).toBe(false)
      expect(() => installStable([target], inProcess())).toThrow(`${staging} is in the way`)
      expect(lstatSync(staging).isSymbolicLink()).toBe(true)
      untouched()
      unlinkSync(staging)

      // A file under that name: it is not removed.
      writeFileSync(staging, 'a file of mine')
      expect(() => installStable([target], inProcess())).toThrow(`${staging} is in the way`)
      expect(readFileSync(staging, 'utf8')).toBe('a file of mine')
      untouched()
      unlinkSync(staging)

      // And under the name of the copy that is moved aside.
      writeFileSync(aside, 'a file of mine')
      expect(() => installStable([target], inProcess())).toThrow(`${aside} is in the way`)
      expect(readFileSync(aside, 'utf8')).toBe('a file of mine')
      expect(existsSync(staging)).toBe(false)
      untouched()
    }, 60_000)

    it('with nothing at the target, what lies at the name of a copy moved aside is not in the way: that name is not used', () => {
      const target = targetIn('apps', 'worfy-stable')
      const apps = join(dir, 'apps')
      mkdirSync(apps)
      const aside = join(apps, leftoverName(NAME, 'replaced', process.pid))
      writeFileSync(aside, 'a file of mine')
      expect(installStable([target], inProcess())).toContain(`install-stable: installed ${target} (commit `)
      expect(readFileSync(aside, 'utf8')).toBe('a file of mine')
      expect(readFileSync(join(target, 'resources', 'app.asar'), 'utf8')).toBe('not a real archive')
    }, 60_000)

    // Review round 2 of PR #257. The checks above come after a copy is installed; on a first
    // install the name of the unfinished copy is the only one the run uses, and it is checked too.
    it('on a first install, with nothing at the target, refuses when the name of its unfinished copy is taken by a link to a folder of the user, or a file: nothing goes through the link, and nothing lands at the target', () => {
      const target = targetIn('apps', 'worfy-stable')
      const apps = join(dir, 'apps')
      mkdirSync(apps)
      const staging = join(apps, leftoverName(NAME, 'installing', process.pid))
      const mine = join(dir, 'mine')
      mkdirSync(mine)
      writeFileSync(join(mine, 'notes.txt'), 'keep me')
      const untouched = (taken: string): void => {
        expect(readdirSync(mine)).toEqual(['notes.txt'])
        expect(readFileSync(join(mine, 'notes.txt'), 'utf8')).toBe('keep me')
        // Neither a copy nor the file that names its build.
        expect(readdirSync(apps)).toEqual([taken])
      }

      // A link: the build would be copied through it into the folder it leads to.
      symlinkSync(mine, staging, WINDOWS ? 'junction' : 'dir')
      links.push(staging)
      // The whole refusal: what is in the way, why, and what to do.
      expect(() => installStable([target], inProcess())).toThrow(`${staging} is in the way: this run needs that name, and what lies there is not a leftover it could clear. Remove it by hand, then run this again.`)
      expect(lstatSync(staging).isSymbolicLink()).toBe(true)
      untouched(basename(staging))
      unlinkSync(staging)

      // A file: it is not removed, and nothing is copied over it.
      writeFileSync(staging, 'a file of mine')
      expect(() => installStable([target], inProcess())).toThrow(`${staging} is in the way`)
      expect(readFileSync(staging, 'utf8')).toBe('a file of mine')
      untouched(basename(staging))
    }, 60_000)

    // A link at the target that leads nowhere is a copy to move aside all the same: the name of
    // the copy moved aside is needed, and a file of the user under it is in the way.
    it('with a link that leads nowhere at the target, refuses when the name of the copy moved aside is taken by a file, and leaves the file and the link', () => {
      const target = targetIn('apps', 'worfy-stable')
      const apps = join(dir, 'apps')
      mkdirSync(apps)
      const nowhere = join(dir, 'nowhere')
      mkdirSync(nowhere)
      symlinkSync(nowhere, target, WINDOWS ? 'junction' : 'dir')
      links.push(target)
      rmdirSync(nowhere)
      expect(existsSync(target)).toBe(false)
      const aside = join(apps, leftoverName(NAME, 'replaced', process.pid))
      writeFileSync(aside, 'a file of mine')
      expect(() => installStable([target], inProcess())).toThrow(`${aside} is in the way`)
      expect(readFileSync(aside, 'utf8')).toBe('a file of mine')
      expect(lstatSync(target).isSymbolicLink()).toBe(true)
      expect(readdirSync(apps).sort()).toEqual([NAME, basename(aside)].sort())
    }, 60_000)

    // Review round 1 of PR #257. A real folder under the name of this run's unfinished copy is a
    // leftover and is cleared — unless it cannot be: then the build must not be copied into it.
    it('refuses when a real folder at the name of its unfinished copy cannot be cleared: the build is not copied into it, and the earlier copy stays whole', async () => {
      const target = targetIn('apps', 'worfy-stable')
      const apps = join(dir, 'apps')
      expect(run([target]).status).toBe(0)
      writeFileSync(join(build, 'resources', 'app.asar'), 'the next build')
      const staging = join(apps, leftoverName(NAME, 'installing', process.pid))
      const locked = join(staging, 'locked')
      mkdirSync(locked, { recursive: true })
      writeFileSync(join(locked, 'junk.txt'), 'from a run long gone')
      // What keeps the folder from going: on Windows a program whose working folder it is; elsewhere
      // a folder nothing may be removed from.
      const holder = WINDOWS ? spawn(process.env['ComSpec'] ?? 'C:/Windows/System32/cmd.exe', ['/d', '/c', 'echo ready& pause'], { cwd: locked, stdio: ['pipe', 'pipe', 'ignore'] }) : null
      if (holder === null) chmodSync(locked, 0o555)
      try {
        if (holder !== null) {
          // The program takes its working folder while it starts, after spawn() has returned: the
          // line it prints says it is running.
          await new Promise((resolve, reject) => {
            holder.stdout.once('data', resolve)
            holder.once('error', reject)
            holder.once('exit', () => reject(new Error('the program that holds the folder ended at once')))
          })
        }
        expect(() => installStable([target], inProcess())).toThrow(`${staging} is in the way`)
        expect(readFileSync(join(target, 'resources', 'app.asar'), 'utf8')).toBe('not a real archive')
        expect(existsSync(join(target, 'locked'))).toBe(false)
        // Nothing of the build went into the folder.
        expect(readdirSync(staging)).toEqual(['locked'])
        expect(readdirSync(apps).sort()).toEqual([NAME, basename(staging), 'worfy-stable.json'].sort())
      } finally {
        if (holder !== null) {
          const gone = new Promise((resolve) => holder.once('exit', resolve))
          holder.kill()
          await gone
        } else chmodSync(locked, 0o755)
      }
    }, 120_000)

    it('names every leftover it clears; of two copies moved aside the first by name goes back, the other is removed', () => {
      const target = targetIn('apps', 'worfy-stable')
      const apps = join(dir, 'apps')
      mkdirSync(apps)
      // Two runs stopped after each had moved a copy aside, one left its unfinished copy as well; nothing is at the target.
      const first = join(apps, leftoverName(NAME, 'replaced', 4_194_298))
      const second = join(apps, leftoverName(NAME, 'replaced', 4_194_299))
      const half = join(apps, leftoverName(NAME, 'installing', 4_194_299))
      for (const path of [second, first, half]) {
        mkdirSync(path)
        writeFileSync(join(path, 'old.txt'), 'of an earlier run')
      }
      const moves: string[] = []
      const line = installStable([target], { ...inProcess(), rename: recording(moves) })
      expect(moves[0]).toBe(`${basename(first)} -> ${NAME}`)
      expect(moves).toHaveLength(3)
      expect(line.split('\n')).toEqual([
        expect.stringContaining(`install-stable: installed ${target} (commit `),
        `install-stable: ${half}, left by an earlier run, is removed`,
        `install-stable: ${first}, a copy an earlier run had moved aside, is back at ${target}`,
        `install-stable: ${second}, left by an earlier run, is removed`,
      ])
      expect(readdirSync(apps).sort()).toEqual([NAME, 'worfy-stable.json'].sort())
      expect(existsSync(join(target, 'old.txt'))).toBe(false)
    }, 60_000)

    it('a copy moved aside that cannot be put back is named, and the install goes on', () => {
      const target = targetIn('apps', 'worfy-stable')
      const apps = join(dir, 'apps')
      mkdirSync(apps)
      const stale = join(apps, leftoverName(NAME, 'replaced', 4_194_299))
      mkdirSync(stale)
      writeFileSync(join(stale, 'old.txt'), 'of an earlier run')
      const moves: string[] = []
      const line = installStable([target], { ...inProcess(), rename: recording(moves, (from) => from === stale) })
      expect(line).toContain(`install-stable: installed ${target} (commit `)
      expect(line).toContain(`install-stable: ${stale}, left by an earlier run, could not be cleared (the move was made to fail): remove it by hand`)
      expect(line).not.toContain('is back at')
      expect(readFileSync(join(stale, 'old.txt'), 'utf8')).toBe('of an earlier run')
      expect(readFileSync(join(target, 'resources', 'app.asar'), 'utf8')).toBe('not a real archive')
    }, 60_000)

    it('a link named like a leftover is somebody\'s own: it stays, and so does the folder it leads to', () => {
      const target = targetIn('apps', 'worfy-stable')
      const apps = join(dir, 'apps')
      mkdirSync(apps)
      const mine = join(dir, 'mine')
      mkdirSync(mine)
      writeFileSync(join(mine, 'notes.txt'), 'keep me')
      const named = [leftoverName(NAME, 'installing', 4_194_299), leftoverName(NAME, 'replaced', 4_194_299)].map((name) => join(apps, name))
      for (const link of named) {
        symlinkSync(mine, link, WINDOWS ? 'junction' : 'dir')
        links.push(link)
      }
      const line = installStable([target], inProcess())
      expect(line.split('\n')).toHaveLength(1)
      for (const link of named) expect(lstatSync(link).isSymbolicLink(), link).toBe(true)
      expect(readdirSync(mine)).toEqual(['notes.txt'])
      expect(readFileSync(join(target, 'resources', 'app.asar'), 'utf8')).toBe('not a real archive')
    }, 60_000)

    it('a move that the system refuses for a moment is tried again on Windows; elsewhere the first refusal ends the run', () => {
      const target = targetIn('apps', 'worfy-stable')
      const apps = join(dir, 'apps')
      let refusals = 1
      const moves: string[] = []
      const rename = (from: string, to: string): void => {
        moves.push(`${basename(from)} -> ${basename(to)}`)
        if (basename(from).includes('.installing-') && refusals-- > 0) throw Object.assign(new Error('busy for a moment'), { code: 'EBUSY' })
        renameSync(from, to)
      }
      const move = `${leftoverName(NAME, 'installing', process.pid)} -> ${NAME}`
      if (WINDOWS) {
        expect(installStable([target], { ...inProcess(), rename })).toContain(`install-stable: installed ${target} (commit `)
        expect(moves).toEqual([move, move])
        expect(readFileSync(join(target, 'resources', 'app.asar'), 'utf8')).toBe('not a real archive')
      } else {
        expect(() => installStable([target], { ...inProcess(), rename })).toThrow(`the new copy could not be put at ${target} (busy for a moment)`)
        expect(moves).toEqual([move])
        expect(readdirSync(apps)).toEqual([])
      }
    }, 60_000)

    // worfy-windows ticket 28, from the review of PR #257. The walk of Windows has five waits for a
    // whole tree; main had five tries for every entry. The script runs the walk again.
    it('on Windows a removal that busy entries stopped is run again, five times at most, and another error ends it at once; elsewhere the walk is not called', () => {
      const target = targetIn('apps', 'worfy-stable')
      const apps = join(dir, 'apps')
      const aside = leftoverName(NAME, 'replaced', process.pid)
      expect(installStable([target], inProcess())).toContain(`install-stable: installed ${target} (commit `)
      /** One more install over the copy that is there; the removal of the copy moved aside fails `refusals` times with `code`. */
      const again = (refusals: number, code: string): { out: string; asked: number } => {
        let asked = 0
        const removeFolder = (path: string): void => {
          if (basename(path) !== aside) return removeTestTree(path)
          asked += 1
          if (refusals-- > 0) throw Object.assign(new Error(`${code}: the copy moved aside is held`), { code })
          removeTestTree(path)
        }
        return { out: installStable([target], { ...inProcess(), removeFolder }), asked }
      }
      if (!WINDOWS) {
        expect(again(99, 'EBUSY')).toMatchObject({ asked: 0 })
        expect(readdirSync(apps).sort()).toEqual([`${NAME}`, 'worfy-stable.json'].sort())
        return
      }
      // Busy three times: the fourth run of the walk removes it, and nothing is said.
      const passed = again(3, 'EBUSY')
      expect(passed.asked).toBe(4)
      expect(passed.out).not.toContain('could not be removed')
      expect(readdirSync(apps).sort()).toEqual([NAME, 'worfy-stable.json'].sort())
      // Busy for good: five runs of the walk, then the copy stays aside for the next install.
      const held = again(99, 'EPERM')
      expect(held.asked).toBe(REMOVE_ROUNDS)
      expect(REMOVE_ROUNDS).toBe(5)
      expect(held.out).toContain(`the earlier copy could not be removed and is left at ${join(apps, aside)} (EPERM: the copy moved aside is held); the next run removes it`)
      expect(readdirSync(apps).sort()).toEqual([NAME, aside, 'worfy-stable.json'].sort())
      removeTestTree(join(apps, aside))
      // An error that is not "busy": the walk is not run again.
      const broken = again(99, 'EIO')
      expect(broken.asked).toBe(1)
      expect(broken.out).toContain('(EIO: the copy moved aside is held)')
    }, 60_000)

    it('when the file that names the build cannot be written, says so; the new copy is in, and no earlier copy stays aside', () => {
      const target = targetIn('apps', 'worfy-stable')
      const apps = join(dir, 'apps')
      expect(run([target]).status).toBe(0)
      rmSync(join(apps, 'worfy-stable.json'))
      mkdirSync(join(apps, 'worfy-stable.json'))
      writeFileSync(join(build, 'resources', 'app.asar'), 'the next build')
      // What the run leaves alone — the unfinished copy of an install that is running — is named also when the run fails.
      const kept = join(apps, leftoverName(NAME, 'installing', process.ppid))
      mkdirSync(kept)
      const json = join(apps, 'worfy-stable.json')
      const failed = run([target])
      expect(failed.status).not.toBe(0)
      expect(failed.stderr).toContain(`install-stable: the copy is installed at ${target}, but ${json} could not be written`)
      // The reason the system gave is in the message; a folder at the path is not a file that names a build.
      expect(failed.stderr).toMatch(/could not be written \(EISDIR[^)]*\): no file names the build of this copy/)
      expect(failed.stderr).toContain(`install-stable: ${kept} is left alone: a running process has the pid in its name`)
      expect(readFileSync(join(target, 'resources', 'app.asar'), 'utf8')).toBe('the next build')
      expect(readdirSync(apps).sort()).toEqual([NAME, basename(kept), 'worfy-stable.json'].sort())

      // A file that is there and cannot be written still names the build that was there before.
      rmdirSync(json)
      writeFileSync(json, '{ "commit": "earlier" }\n')
      chmodSync(json, 0o444)
      try {
        const again = run([target])
        expect(again.status).not.toBe(0)
        expect(again.stderr).toMatch(/could not be written \((EPERM|EACCES)[^)]*\): the file still names the build that was there before/)
        expect(readFileSync(json, 'utf8')).toBe('{ "commit": "earlier" }\n')
      } finally {
        chmodSync(json, 0o644)
      }

      // worfy-windows ticket 28. A link at the path, to a file that cannot be written: the link is
      // not a file that names a build, and what it leads to is neither read nor changed.
      const elsewhere = join(dir, 'elsewhere.json')
      writeFileSync(elsewhere, '{ "commit": "of another copy" }\n')
      chmodSync(elsewhere, 0o444)
      unlinkSync(json)
      symlinkSync(elsewhere, json, 'file')
      try {
        const linked = run([target])
        expect(linked.status).not.toBe(0)
        expect(linked.stderr).toMatch(/could not be written \((EPERM|EACCES)[^)]*\): no file names the build of this copy/)
        expect(lstatSync(json).isSymbolicLink()).toBe(true)
        expect(readFileSync(elsewhere, 'utf8')).toBe('{ "commit": "of another copy" }\n')
      } finally {
        chmodSync(elsewhere, 0o644)
        unlinkSync(json)
      }
    }, 60_000)
  })

  // Not run on the PC this was written on: there the same refusal is tested in the Windows block.
  describe.runIf(!WINDOWS)('off Windows', () => {
    it('refuses while a program of the copy is running — before it looks at the build', async () => {
      const target = targetIn('apps', 'worfy-stable')
      // A real program inside the copy: sleep under the name of the app.
      const program = join(target, 'Contents', 'MacOS', 'worfy')
      mkdirSync(dirname(program), { recursive: true })
      copyFileSync('/bin/sleep', program)
      chmodSync(program, 0o755)
      const child = spawn(program, ['60'], { stdio: 'ignore' })
      try {
        await new Promise((resolve, reject) => {
          child.once('spawn', resolve)
          child.once('error', reject)
        })
        // The build is not one: a run that looked at it first would say so.
        const refused = run([target], { WORFY_STABLE_PREBUILT: join(dir, 'no-such-build') })
        expect(refused.status).not.toBe(0)
        expect(refused.stderr).toContain(`${child.pid} `)
        expect(refused.stderr).toContain(`install-stable: the stable copy at ${target} is running`)
        expect(refused.stderr).not.toContain('WORFY_STABLE_PREBUILT')
      } finally {
        const gone = new Promise((resolve) => child.once('exit', resolve))
        child.kill()
        await gone
      }
    }, 60_000)
  })

  // Not run on the PC this was written on either: there the Windows block has the same case.
  describe.runIf(!WINDOWS)('off Windows, with a build step of the test', () => {
    it('looks for a running copy again after the build: a copy started while the build ran is refused, and stays', async () => {
      // A repository of its own, and a build step of the test: pnpm is never started.
      const repo = join(dir, 'repo')
      mkdirSync(repo)
      writeFileSync(join(repo, 'README.md'), 'a repository\n')
      const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=worfy test', '-c', 'user.email=test@worfy.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
      git('init', '-q')
      git('add', '.')
      git('commit', '-q', '-m', 'a repository')
      const target = targetIn('apps', 'worfy-stable')
      // A real program inside the copy: sleep under the name of the app. It is not running yet.
      const program = join(target, 'Contents', 'MacOS', 'worfy')
      mkdirSync(dirname(program), { recursive: true })
      copyFileSync('/bin/sleep', program)
      chmodSync(program, 0o755)
      const env = { ...process.env, WORFY_STABLE_PREBUILT: '' }
      const builds: string[] = []
      let child: ReturnType<typeof spawn> | undefined
      // The build leaves dist/mac-arm64/worfy.app; a user starts the copy while it runs.
      const build = (platform: string, where: string): void => {
        builds.push(`${platform} ${where}`)
        mkdirSync(join(repo, 'dist', 'mac-arm64', 'worfy.app', 'Contents'), { recursive: true })
        writeFileSync(join(repo, 'dist', 'mac-arm64', 'worfy.app', 'Contents', 'Info.plist'), 'not a real plist')
        child = spawn(program, ['60'], { stdio: 'ignore' })
      }
      try {
        expect(() => installStable([target], { env, repo, build })).toThrow(`the stable copy at ${target} is running`)
        expect(builds).toEqual([`${process.platform} ${repo}`])
        expect(existsSync(program)).toBe(true)
        expect(readdirSync(join(dir, 'apps'))).toEqual([basename(target)])
      } finally {
        if (child !== undefined) {
          const gone = new Promise((resolve) => child?.once('exit', resolve))
          child.kill()
          await gone
        }
      }
    }, 60_000)
  })

  describe.runIf(WINDOWS)('on Windows', () => {
    /** A real program under the name of the app: the command interpreter of Windows. */
    const realProgram = () => readFileSync(process.env['ComSpec'] ?? 'C:/Windows/System32/cmd.exe')

    it('without an argument installs into %LOCALAPPDATA%\\worfy-stable, with worfy-stable.json next to it', () => {
      const result = run([])
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      // (PowerShell, asked for the list of processes, keeps its own folder under %LOCALAPPDATA%.)
      expect(readdirSync(local).filter((name) => name !== 'Microsoft').sort()).toEqual(['worfy-stable', 'worfy-stable.json'])
      expect(readFileSync(join(local, 'worfy-stable', 'worfy.exe'), 'utf8')).toBe('not a real program')
      // The archive is copied as the file it is.
      expect(readFileSync(join(local, 'worfy-stable', 'resources', 'app.asar'), 'utf8')).toBe('not a real archive')
      expect(result.stdout).toContain(`install-stable: installed ${join(local, 'worfy-stable')} (commit ${head().slice(0, 7)}`)
    }, 60_000)

    it('refuses the folder of the installer, a neighbour whose path starts with it, and a folder that is not an earlier copy, and leaves them as they were', () => {
      const installed = run([join(local, 'Programs', 'worfy')])
      expect(installed.status).not.toBe(0)
      expect(installed.stderr).toContain('install-stable: the target cannot be the folder the installer of worfy uses')
      const neighbour = run([join(local, 'Programs', 'worfy-stable')])
      expect(neighbour.status).not.toBe(0)
      expect(neighbour.stderr).toContain('install-stable: the target cannot start with the path of the folder the installer of worfy uses')
      expect(existsSync(join(local, 'Programs'))).toBe(false)

      const mine = join(dir, 'Documents')
      mkdirSync(mine)
      writeFileSync(join(mine, 'letter.txt'), 'keep me')
      const refused = run([mine])
      expect(refused.status).not.toBe(0)
      expect(refused.stderr).toContain('holds no worfy.exe')
      expect(readdirSync(mine)).toEqual(['letter.txt'])
      expect(existsSync(`${mine}.json`)).toBe(false)
    }, 60_000)

    it('refuses the installed worfy under another spelling of its folder, and a worfy the installer put elsewhere', () => {
      // The installer's folder, with what the installer writes into it.
      const installed = join(local, 'Programs', 'worfy')
      mkdirSync(installed, { recursive: true })
      writeFileSync(join(installed, 'worfy.exe'), 'the installed worfy')
      writeFileSync(join(installed, 'Uninstall worfy.exe'), 'its uninstaller')
      for (const spelling of [`\\\\?\\${installed}`, `\\\\.\\${installed}`, installed.toUpperCase(), `//?/${installed.replace(/\\/g, '/')}`]) {
        const refused = run([spelling])
        expect(refused.status, spelling).not.toBe(0)
        expect(refused.stderr, spelling).toContain('install-stable: the target cannot be the folder the installer of worfy uses')
      }
      // A link to it from elsewhere.
      const link = join(dir, 'link-to-installed')
      junction(installed, link)
      expect(run([link]).stderr).toContain('the target cannot be the folder the installer of worfy uses')
      // The spelling through the administrative share stays a path of its own: the uninstaller in the folder tells.
      const share = `\\\\localhost\\${installed[0]}$${installed.slice(2)}`
      if (existsSync(share)) expect(run([share]).stderr).toContain('the installer of worfy put it there')
      // A worfy installed into another folder (/D=…).
      const elsewhere = join(dir, 'Tools', 'worfy-app')
      mkdirSync(elsewhere, { recursive: true })
      writeFileSync(join(elsewhere, 'worfy.exe'), 'the installed worfy')
      writeFileSync(join(elsewhere, 'Uninstall worfy.exe'), 'its uninstaller')
      const moved = run([elsewhere])
      expect(moved.status).not.toBe(0)
      expect(moved.stderr).toContain('the installer of worfy put it there')
      for (const folder of [installed, elsewhere]) expect(readdirSync(folder).sort()).toEqual(['Uninstall worfy.exe', 'worfy.exe'])
    }, 120_000)

    // An 8.3 short name is one more spelling of a folder. This volume gives none to a new folder,
    // so the case takes a name the system has, when it has it. Both calls only read the disk.
    const SHORT = 'C:\\PROGRA~1'
    const long = existsSync(SHORT) ? realpathSync.native(SHORT) : SHORT
    it.runIf(long.toLowerCase() !== SHORT.toLowerCase())('knows the folder of the installer under an 8.3 short name: the disk spells it the long way', () => {
      // The folder below is not there: it is spelled by the nearest one that is.
      const typed = `${SHORT}\\no-such-folder\\Programs\\worfy`
      expect(onDisk(typed)).toBe(`${long}\\no-such-folder\\Programs\\worfy`)
      expect(onDisk(`${SHORT.toLowerCase()}\\no-such-folder`)).toBe(`${long}\\no-such-folder`)
      const env = { LOCALAPPDATA: `${long}\\no-such-folder` }
      // As typed the short spelling is not the installer's folder by its text; as the disk spells it, it is.
      expect(checkTarget('win32', typed, env, WIN_HOME)).toBe(typed)
      expect(() => checkTarget('win32', onDisk(typed), env, WIN_HOME, onDisk(installerDir(env, WIN_HOME)))).toThrow(/cannot be the folder the installer of worfy uses/)
      expect(() => checkTarget('win32', onDisk(`${typed}-2`), env, WIN_HOME, onDisk(installerDir(env, WIN_HOME)))).toThrow(/cannot start with the path/)
      // And the installer's folder itself told by a short name.
      const short = { LOCALAPPDATA: `${SHORT}\\no-such-folder` }
      expect(() => checkTarget('win32', `${long}\\no-such-folder\\Programs\\worfy`, short, WIN_HOME, onDisk(installerDir(short, WIN_HOME)))).toThrow(/cannot be the folder the installer of worfy uses/)
    })

    it('knows the folder of the installer by the spelling of the disk: Programs moved to another folder, with a link left in its place', () => {
      // worfy is not installed yet: the folder of the installer is not there, only the place for it.
      const moved = join(dir, 'MovedPrograms')
      mkdirSync(moved)
      mkdirSync(local)
      junction(moved, join(local, 'Programs'))
      // Typed as the real folder, the target has nothing of %LOCALAPPDATA% in its text.
      const same = run([join(moved, 'worfy')])
      expect(same.status).not.toBe(0)
      expect(same.stderr).toContain('install-stable: the target cannot be the folder the installer of worfy uses')
      const neighbour = run([join(moved, 'worfy-2')])
      expect(neighbour.status).not.toBe(0)
      expect(neighbour.stderr).toContain('install-stable: the target cannot start with the path of the folder the installer of worfy uses')
      expect(readdirSync(moved)).toEqual([])
      // And with worfy installed there.
      mkdirSync(join(moved, 'worfy'))
      expect(run([join(moved, 'worfy')]).stderr).toContain('install-stable: the target cannot be the folder the installer of worfy uses')
      expect(readdirSync(join(moved, 'worfy'))).toEqual([])
    }, 60_000)

    it('a leftover of an earlier run that cannot be cleared is named, and the install goes on', async () => {
      const target = join(dir, 'apps', 'worfy-stable')
      expect(run([target]).status).toBe(0)
      const stale = join(dir, 'apps', leftoverName('worfy-stable', 'installing', 4_194_299))
      mkdirSync(join(stale, 'resources'), { recursive: true })
      // A program of the system whose working folder is inside the leftover: Windows does not let that folder be removed.
      const holder = spawn(process.env['ComSpec'] ?? 'C:/Windows/System32/cmd.exe', ['/d', '/c', 'pause'], { cwd: join(stale, 'resources'), stdio: ['pipe', 'ignore', 'ignore'] })
      try {
        await new Promise((resolve, reject) => {
          holder.once('spawn', resolve)
          holder.once('error', reject)
        })
        writeFileSync(join(build, 'worfy.exe'), 'the next build')
        const result = run([target])
        expect(result.stderr).toBe('')
        expect(result.status).toBe(0)
        expect(result.stdout).toContain(`install-stable: ${stale}, left by an earlier run, could not be cleared`)
        expect(result.stdout).toContain('remove it by hand')
        expect(readFileSync(join(target, 'worfy.exe'), 'utf8')).toBe('the next build')
        expect(existsSync(stale)).toBe(true)
      } finally {
        const gone = new Promise((resolve) => holder.once('exit', resolve))
        holder.kill()
        await gone
      }
    }, 120_000)

    it('removes an earlier copy that holds a read-only file', () => {
      const target = join(dir, 'apps', 'worfy-stable')
      writeFileSync(join(build, 'LICENSE.txt'), 'read me')
      chmodSync(join(build, 'LICENSE.txt'), 0o444)
      expect(run([target]).status).toBe(0)
      const again = run([target])
      expect(again.stderr).toBe('')
      expect(again.stdout).not.toContain('could not be removed')
      expect(readdirSync(join(dir, 'apps')).sort()).toEqual(['worfy-stable', 'worfy-stable.json'])
    }, 60_000)

    it('a junction at the target is replaced as a link: the folder it led to keeps its files', () => {
      const behind = join(dir, 'behind')
      mkdirSync(behind)
      writeFileSync(join(behind, 'worfy.exe'), 'behind the junction')
      writeFileSync(join(behind, 'notes.txt'), 'keep me')
      const target = join(dir, 'apps', 'worfy-stable')
      mkdirSync(join(dir, 'apps'))
      junction(behind, target)
      const result = run([target])
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      expect(lstatSync(target).isSymbolicLink()).toBe(false)
      expect(readFileSync(join(target, 'worfy.exe'), 'utf8')).toBe('not a real program')
      // The junction is gone, not set aside for a later run.
      expect(result.stdout).not.toContain('could not be removed')
      expect(readdirSync(join(dir, 'apps')).sort()).toEqual(['worfy-stable', 'worfy-stable.json'])
      expect(readdirSync(behind).sort()).toEqual(['notes.txt', 'worfy.exe'])
      expect(readFileSync(join(behind, 'worfy.exe'), 'utf8')).toBe('behind the junction')
    }, 60_000)

    it('copies the build from its real folder when it is given as a link: the copy is a folder, not a link to the build', () => {
      const link = join(dir, 'build-link')
      junction(build, link)
      const target = join(dir, 'apps', 'worfy-stable')
      const result = run([target], { WORFY_STABLE_PREBUILT: link })
      expect(result.stderr).toBe('')
      expect(lstatSync(target).isSymbolicLink()).toBe(false)
      writeFileSync(join(build, 'worfy.exe'), 'the build changed afterwards')
      expect(readFileSync(join(target, 'worfy.exe'), 'utf8')).toBe('not a real program')
      // The file next to the copy names the build as it was given.
      expect((JSON.parse(readFileSync(`${target}.json`, 'utf8')) as { source: string }).source).toBe(link)
    }, 60_000)

    it('refuses while a program of the copy is running — before it looks at the build — and leaves the copy in place', async () => {
      const target = join(dir, 'apps', 'worfy-stable')
      // It waits for a key on an input that stays open, until it is stopped below.
      writeFileSync(join(build, 'worfy.exe'), realProgram())
      expect(run([target]).status).toBe(0)
      const child = spawn(join(target, 'worfy.exe'), ['/d', '/c', 'pause'], { stdio: ['pipe', 'ignore', 'ignore'] })
      try {
        await new Promise((resolve, reject) => {
          child.once('spawn', resolve)
          child.once('error', reject)
        })
        // The build is not one: a run that looked at it first would say so.
        const refused = run([target], { WORFY_STABLE_PREBUILT: join(dir, 'no-such-build') })
        expect(refused.status).not.toBe(0)
        expect(refused.stderr).toContain(`${child.pid} `)
        expect(refused.stderr).toContain(`install-stable: the stable copy at ${target} is running`)
        expect(refused.stderr).not.toContain('WORFY_STABLE_PREBUILT')
        // The same copy under another spelling of its folder.
        const spelled = run([`\\\\?\\${target.toUpperCase()}`])
        expect(spelled.status).not.toBe(0)
        expect(spelled.stderr).toContain('is running')
        expect(existsSync(join(target, 'worfy.exe'))).toBe(true)
        // And named through a junction to its folder: Windows shows the program by the real folder.
        const through = join(dir, 'link-to-the-copy')
        junction(target, through)
        const linked = run([through])
        expect(linked.status).not.toBe(0)
        expect(linked.stderr).toContain(`install-stable: the stable copy at ${through} is running`)
        expect(lstatSync(through).isSymbolicLink()).toBe(true)
      } finally {
        const gone = new Promise((resolve) => child.once('exit', resolve))
        child.kill()
        await gone
      }
    }, 120_000)

    it('a copy that cannot be moved aside stays whole, with the file that names its build; nothing of the new copy is left', async () => {
      const target = join(dir, 'apps', 'worfy-stable')
      expect(run([target]).status).toBe(0)
      const before = readFileSync(`${target}.json`, 'utf8')
      // A program of the system whose working folder is inside the copy: Windows does not let the folder be renamed.
      const holder = spawn(process.env['ComSpec'] ?? 'C:/Windows/System32/cmd.exe', ['/d', '/c', 'pause'], { cwd: join(target, 'resources'), stdio: ['pipe', 'ignore', 'ignore'] })
      try {
        await new Promise((resolve, reject) => {
          holder.once('spawn', resolve)
          holder.once('error', reject)
        })
        writeFileSync(join(build, 'worfy.exe'), 'the next build')
        const failed = run([target])
        expect(failed.status).not.toBe(0)
        expect(failed.stderr).toContain(`install-stable: the copy at ${target} could not be moved aside`)
        expect(failed.stderr).toContain('It is left as it was')
        expect(readFileSync(join(target, 'worfy.exe'), 'utf8')).toBe('not a real program')
        expect(readFileSync(join(target, 'resources', 'app.asar'), 'utf8')).toBe('not a real archive')
        expect(readFileSync(`${target}.json`, 'utf8')).toBe(before)
        expect(readdirSync(join(dir, 'apps')).sort()).toEqual(['worfy-stable', 'worfy-stable.json'])
      } finally {
        const gone = new Promise((resolve) => holder.once('exit', resolve))
        holder.kill()
        await gone
      }
    }, 120_000)

    it('with no build given it builds, takes dist\\win-unpacked of the repository, and looks for a running copy again after the build', async () => {
      // A repository of its own, and a build step of the test: pnpm is never started.
      const repo = join(dir, 'repo')
      mkdirSync(repo)
      writeFileSync(join(repo, 'README.md'), 'a repository\n')
      const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=worfy test', '-c', 'user.email=test@worfy.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
      git('init', '-q')
      git('add', '.')
      git('commit', '-q', '-m', 'a repository')
      const target = join(dir, 'apps', 'worfy-stable')
      const env = { ...process.env, LOCALAPPDATA: local, WORFY_STABLE_PREBUILT: '' }
      const builds: string[] = []
      const build = (platform: string, where: string): void => {
        builds.push(`${platform} ${where}`)
        mkdirSync(join(repo, 'dist', 'win-unpacked'), { recursive: true })
        writeFileSync(join(repo, 'dist', 'win-unpacked', 'worfy.exe'), realProgram())
      }
      const line = installStable([target], { env, repo, build })
      expect(builds).toEqual([`win32 ${repo}`])
      expect(line).toContain(`install-stable: installed ${target} (commit ${git('rev-parse', 'HEAD').trim().slice(0, 7)}, uncommitted changes)`)
      expect(readFileSync(join(target, 'worfy.exe')).equals(realProgram())).toBe(true)
      expect(JSON.parse(readFileSync(`${target}.json`, 'utf8'))).toMatchObject({ source: join(repo, 'dist', 'win-unpacked'), commit: git('rev-parse', 'HEAD').trim(), dirty: true })

      // The copy is not running when the script starts; a user starts it while the build runs.
      let child: ReturnType<typeof spawn> | undefined
      const buildWhileTheCopyStarts = (platform: string, where: string): void => {
        build(platform, where)
        child = spawn(join(target, 'worfy.exe'), ['/d', '/c', 'pause'], { stdio: ['pipe', 'ignore', 'ignore'] })
      }
      try {
        expect(() => installStable([target], { env, repo, build: buildWhileTheCopyStarts })).toThrow(`the stable copy at ${target} is running`)
        expect(builds).toHaveLength(2)
        expect(existsSync(join(target, 'worfy.exe'))).toBe(true)
      } finally {
        if (child !== undefined) {
          const gone = new Promise((resolve) => child?.once('exit', resolve))
          child.kill()
          await gone
        }
      }

      // A build that leaves no dist\win-unpacked is an error, and the copy stays.
      removeTestTree(join(repo, 'dist'))
      expect(() => installStable([target], { env, repo, build: () => undefined })).toThrow('expected dist\\win-unpacked after the build, and it is not there')
      expect(existsSync(join(target, 'worfy.exe'))).toBe(true)
    }, 180_000)
  })
})

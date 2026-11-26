// A lighter background build of Update (worfy-polish ticket 156, issue #2252 part 2): how long
// "Update automatically" waits for a quiet main, the priority of the build's steps through the spawn
// seam, and the hash of the files `pnpm install` depends on. No process is started: the spawn and
// the priority calls are fakes.
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { constants, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_QUIET_MS, quietWaitMs, UPDATE_QUIET_MS, updateQuietMs } from '../../src/main/update/auto'
import { BUILD_PRIORITY, dependencyHash, spawnBelowNormal, type BuildPriority } from '../../src/main/update/build'
import { removeTestTree } from '../remove'

const SHA = 'a'.repeat(40)
const NOW = new Date('2026-11-26T04:00:00.000Z')
const minutesAgo = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString()

describe('the wait for a quiet main', () => {
  it('is 20 minutes unless WORFY_UPDATE_QUIET_MINUTES names a whole number of minutes', () => {
    expect(UPDATE_QUIET_MS).toBe(20 * 60_000)
    expect(updateQuietMs({})).toBe(UPDATE_QUIET_MS)
    expect(updateQuietMs({ WORFY_UPDATE_QUIET_MINUTES: '' })).toBe(UPDATE_QUIET_MS)
    expect(updateQuietMs({ WORFY_UPDATE_QUIET_MINUTES: '5' })).toBe(5 * 60_000)
    expect(updateQuietMs({ WORFY_UPDATE_QUIET_MINUTES: '0' })).toBe(0)
    for (const odd of ['-1', '1.5', 'soon', '5m']) expect(updateQuietMs({ WORFY_UPDATE_QUIET_MINUTES: odd }), odd).toBe(UPDATE_QUIET_MS)
  })

  it('is what is left of N minutes after the commit of the head; nothing once it is older, or when its time is not known', () => {
    const quiet = 20 * 60_000
    expect(quietWaitMs({ sha: SHA, version: 'v', quiet: false, committedAt: minutesAgo(5) }, NOW, quiet)).toBe(15 * 60_000)
    expect(quietWaitMs({ sha: SHA, version: 'v', quiet: false, committedAt: minutesAgo(20) }, NOW, quiet)).toBe(0)
    expect(quietWaitMs({ sha: SHA, version: 'v', quiet: false, committedAt: minutesAgo(90) }, NOW, quiet)).toBe(0)
    expect(quietWaitMs({ sha: SHA, version: 'v', quiet: false }, NOW, quiet)).toBe(0)
    expect(quietWaitMs({ sha: SHA, version: 'v', quiet: false, committedAt: minutesAgo(5) }, NOW, 0)).toBe(0)
  })

  it('is 24 hours at most, however many minutes WORFY_UPDATE_QUIET_MINUTES names', () => {
    expect(MAX_QUIET_MS).toBe(24 * 60 * 60_000)
    expect(updateQuietMs({ WORFY_UPDATE_QUIET_MINUTES: String(24 * 60) })).toBe(MAX_QUIET_MS)
    for (const many of ['1441', '35792', '99999999999999999999']) expect(updateQuietMs({ WORFY_UPDATE_QUIET_MINUTES: many }), many).toBe(MAX_QUIET_MS)
  })

  it('never answers more than a timer can wait (2^31 - 1 ms): a longer delay would fire after 1 ms, again and again', () => {
    const fresh = { sha: SHA, version: 'v', quiet: false, committedAt: NOW.toISOString() }
    expect(quietWaitMs(fresh, NOW, 2 ** 32)).toBe(2 ** 31 - 1)
    expect(quietWaitMs(fresh, NOW, MAX_QUIET_MS)).toBe(MAX_QUIET_MS)
  })

  it('never waits longer than N minutes, though the commit is dated in the future (the clocks of GitHub and the machine differ)', () => {
    expect(quietWaitMs({ sha: SHA, version: 'v', quiet: false, committedAt: minutesAgo(-30) }, NOW, 20 * 60_000)).toBe(20 * 60_000)
  })
})

/** A fake child with a pid. */
const child = (pid: number | undefined): ChildProcess => ({ pid }) as ChildProcess

/** Priority calls noted in order, around a spawn that notes itself too. */
function recorder(options: { setFails?: boolean; own?: number } = {}): { priority: BuildPriority; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    priority: {
      get: () => {
        calls.push('get own')
        return options.own ?? 0
      },
      set: (pid, value) => {
        calls.push(`set ${pid} ${value}`)
        if (options.setFails === true) throw new Error('EPERM')
      },
    },
  }
}

describe('the priority of a build step', () => {
  it('is below normal: the same value as nice 10 on macOS and Linux, BELOW_NORMAL on Windows', () => {
    expect(BUILD_PRIORITY).toBe(constants.priority.PRIORITY_BELOW_NORMAL)
    expect(BUILD_PRIORITY).toBe(10)
  })

  it.each(['darwin', 'linux'] as const)('on %s lowers the step right after its spawn: its children inherit the nice value', (platform) => {
    const { priority, calls } = recorder()
    const started = spawnBelowNormal(() => {
      calls.push('spawn')
      return child(4242)
    }, priority, platform)
    expect(calls).toEqual(['spawn', 'set 4242 10'])
    expect(started).toEqual({ child: child(4242), problem: null })
  })

  it('on Windows lowers worfy itself for the spawn and gives its class back: the step is born BELOW_NORMAL, before cmd.exe starts anything', () => {
    const { priority, calls } = recorder({ own: -7 })
    const started = spawnBelowNormal(() => {
      calls.push('spawn')
      return child(4242)
    }, priority, 'win32')
    expect(calls).toEqual(['get own', 'set 0 10', 'spawn', 'set 0 -7'])
    expect(started.problem).toBeNull()
  })

  it('on Windows gives worfy its class back when the spawn throws, and the error goes on', () => {
    const { priority, calls } = recorder()
    expect(() =>
      spawnBelowNormal(() => {
        calls.push('spawn')
        throw new Error('EINVAL')
      }, priority, 'win32'),
    ).toThrow('EINVAL')
    expect(calls).toEqual(['get own', 'set 0 10', 'spawn', 'set 0 0'])
  })

  it.each(['darwin', 'win32'] as const)('on %s a priority that cannot be lowered is a problem to note, and the step runs all the same', (platform) => {
    const { priority, calls } = recorder({ setFails: true })
    const started = spawnBelowNormal(() => {
      calls.push('spawn')
      return child(4242)
    }, priority, platform)
    expect(calls).toContain('spawn')
    expect(started.child).toEqual(child(4242))
    expect(started.problem).toContain('EPERM')
  })

  it('a step that has ended already (ESRCH: no such process) is no problem to note: it no longer competes for the CPU', () => {
    const calls: string[] = []
    const priority: BuildPriority = {
      get: () => 0,
      set: (pid) => {
        calls.push(`set ${pid}`)
        // The shape of os.setPriority's error on a pid that is gone.
        throw Object.assign(new Error('A system error occurred: uv_os_setpriority returned ESRCH (no such process)'), {
          code: 'ERR_SYSTEM_ERROR',
          info: { errno: -3, code: 'ESRCH', message: 'no such process', syscall: 'uv_os_setpriority' },
        })
      },
    }
    expect(spawnBelowNormal(() => child(4242), priority, 'darwin')).toEqual({ child: child(4242), problem: null })
    expect(calls).toEqual(['set 4242'])
  })

  it('a step that never got a pid is not lowered', () => {
    const { priority, calls } = recorder()
    expect(spawnBelowNormal(() => child(undefined), priority, 'darwin').problem).toBeNull()
    expect(calls).toEqual([])
  })
})

describe('the hash of what pnpm install depends on', () => {
  const folders: string[] = []
  afterEach(() => {
    for (const folder of folders.splice(0)) removeTestTree(folder)
  })
  const clone = (files: Record<string, string>): string => {
    const folder = mkdtempSync(join(tmpdir(), 'worfy-update-deps-'))
    folders.push(folder)
    for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text)
    return folder
  }

  it('changes with package.json, pnpm-lock.yaml, pnpm-workspace.yaml and .npmrc, and not with any other file', () => {
    const base = { 'package.json': '{}', 'pnpm-lock.yaml': 'lock: 1', 'pnpm-workspace.yaml': 'allowBuilds: {}' }
    const hash = dependencyHash(clone(base))
    expect(hash).toMatch(/^[0-9a-f]{64}$/u)
    expect(dependencyHash(clone({ ...base, 'README.md': 'other' }))).toBe(hash)
    expect(dependencyHash(clone({ ...base, 'pnpm-lock.yaml': 'lock: 2' }))).not.toBe(hash)
    expect(dependencyHash(clone({ ...base, 'package.json': '{"a":1}' }))).not.toBe(hash)
    expect(dependencyHash(clone({ ...base, 'pnpm-workspace.yaml': 'x' }))).not.toBe(hash)
    expect(dependencyHash(clone({ ...base, '.npmrc': 'x=1' }))).not.toBe(hash)
  })

  it('tells a missing file from an empty one, and one file\'s bytes from another\'s', () => {
    expect(dependencyHash(clone({ 'package.json': '{}' }))).not.toBe(dependencyHash(clone({ 'package.json': '{}', 'pnpm-lock.yaml': '' })))
    expect(dependencyHash(clone({ 'package.json': 'ab' }))).not.toBe(dependencyHash(clone({ 'package.json': 'a', 'pnpm-lock.yaml': 'b' })))
  })
})

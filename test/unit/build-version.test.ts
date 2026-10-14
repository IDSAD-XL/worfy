// scripts/build-version.ts: the `<semver>+<SHA>[.dirty]` string the build writes into its Harness copy.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BUILD_VERSION, buildVersion, formatBuildVersion } from '../../scripts/build-version'
import { removeTestTree } from '../remove'

const dirs: string[] = []
afterEach(() => {
  // Not rmSync: the folder is a git repository, whose objects are read-only files
  // (worfy-windows tickets 23 and 26).
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})

/** A temporary folder with a package.json of the given version; a git repository with one commit when `commit`. */
function checkout(version: string, commit: boolean): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-build-version-')))
  dirs.push(dir)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version }))
  if (commit) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, env })
    git('init', '-q', '-b', 'main')
    git('add', '.')
    git('commit', '-q', '-m', 'init')
  }
  return dir
}

const headOf = (dir: string): string => execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()

describe('formatBuildVersion', () => {
  it('joins the semver and the short SHA with +', () => {
    expect(formatBuildVersion('0.2.0', 'abc1234', false)).toBe('0.2.0+abc1234')
  })

  it('ends with .dirty for a tree with uncommitted changes', () => {
    expect(formatBuildVersion('0.2.0', 'abc1234', true)).toBe('0.2.0+abc1234.dirty')
  })

  it('refuses what is not <major.minor.patch>+<hex SHA of 7 or more>', () => {
    expect(() => formatBuildVersion('0.2', 'abc1234', false)).toThrow(/not <major\.minor\.patch>/)
    expect(() => formatBuildVersion('0.2.0', 'abc123', false)).toThrow(/not <major\.minor\.patch>/)
    expect(() => formatBuildVersion('0.2.0', 'ABC1234', false)).toThrow(/not <major\.minor\.patch>/)
    expect(() => formatBuildVersion('0.2.0', '', false)).toThrow(/not <major\.minor\.patch>/)
  })
})

describe('buildVersion', () => {
  it('reads the version from package.json and the SHA of HEAD of a clean checkout', () => {
    const dir = checkout('0.2.0', true)
    const version = buildVersion(dir)
    expect(version).toBe(`0.2.0+${headOf(dir)}`)
    expect(version).toMatch(/^\d+\.\d+\.\d+\+[0-9a-f]{7,}(\.dirty)?$/)
    expect(version).toMatch(BUILD_VERSION)
  })

  it('adds .dirty when the tree has a changed or an untracked file', () => {
    const changed = checkout('0.2.0', true)
    writeFileSync(join(changed, 'package.json'), JSON.stringify({ name: 'x', version: '0.2.0', description: 'changed' }))
    expect(buildVersion(changed)).toBe(`0.2.0+${headOf(changed)}.dirty`)

    const untracked = checkout('0.2.0', true)
    writeFileSync(join(untracked, 'new.txt'), 'new')
    expect(buildVersion(untracked)).toBe(`0.2.0+${headOf(untracked)}.dirty`)
  })

  it('fails outside a git checkout: a version without a SHA does not tell builds apart', () => {
    const dir = checkout('0.2.0', false)
    expect(() => buildVersion(dir)).toThrow(/is not a git checkout/)
  })

  it('is the version of this repository: package.json 0.3.0', () => {
    expect(buildVersion(join(import.meta.dirname, '..', '..'))).toMatch(/^0\.3\.0\+[0-9a-f]{7,}(\.dirty)?$/)
  })
})

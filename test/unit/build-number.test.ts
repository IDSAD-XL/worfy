// scripts/build-version.ts, buildNumber (worfy-update ticket 14): the number of commits from the
// start of the history to HEAD, which the app shows as `v<major>.<minor>.<N>`. A shallow clone or a
// folder outside git has no number: it is never guessed.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildNumber, buildVersion } from '../../scripts/build-version'
import { removeTestTree } from '../remove'

const dirs: string[] = []
afterEach(() => {
  // Not rmSync: the folders are git repositories, whose objects are read-only files.
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})

const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, env, stdio: 'ignore' })

function folder(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-build-number-')))
  dirs.push(dir)
  return dir
}

/** A git repository with `commits` commits and a package.json of version 0.3.0. */
function repository(commits: number): string {
  const dir = folder()
  git(dir, 'init', '-q', '-b', 'main')
  for (let index = 1; index <= commits; index += 1) {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '0.3.0', index }))
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', `commit ${index}`)
  }
  return dir
}

describe('buildNumber', () => {
  it('counts the commits from the start of the history to HEAD', () => {
    expect(buildNumber(repository(1))).toBe(1)
    expect(buildNumber(repository(3))).toBe(3)
  })

  it('keeps the number of the commit for a tree with uncommitted changes; the version says .dirty', () => {
    const dir = repository(2)
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '0.3.0', index: 'changed' }))
    expect(buildNumber(dir)).toBe(2)
    expect(buildVersion(dir)).toMatch(/\.dirty$/)
  })

  it('has no number in a shallow clone, whose history is cut', () => {
    const source = repository(3)
    const parent = folder()
    git(parent, 'clone', '-q', '--depth', '1', `file://${source}`, 'shallow')
    const shallow = join(parent, 'shallow')
    expect(execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: shallow, env, encoding: 'utf8' }).trim()).toBe('true')
    expect(buildNumber(shallow)).toBeNull()
    // The build version is what it was: the number changes nothing in it.
    expect(buildVersion(shallow)).toMatch(/^0\.3\.0\+[0-9a-f]{7,}$/)
  })

  it('has no number outside a git checkout', () => {
    const dir = folder()
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '0.3.0' }))
    expect(buildNumber(dir)).toBeNull()
  })

  it('has no number in a repository without a commit', () => {
    const dir = folder()
    git(dir, 'init', '-q', '-b', 'main')
    expect(buildNumber(dir)).toBeNull()
  })
})

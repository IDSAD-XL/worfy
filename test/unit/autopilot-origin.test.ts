// The key of an Autopilot run's repository (worfy-link ticket 15): the normalized address of remote
// `origin`, so the forms git takes for one repository give one key, and a folder without an origin
// gives none.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { originKey, readOriginKey } from '../../src/main/autopilot/origin'

describe('originKey', () => {
  it('gives one key for the ssh, scp-like and https forms of one repository', () => {
    const forms = ['git@github.com:IDSAD-XL/worfy.git', 'ssh://git@github.com/IDSAD-XL/worfy.git', 'https://user@GitHub.com/IDSAD-XL/worfy.git/', 'https://github.com/IDSAD-XL/worfy']
    expect(forms.map(originKey)).toEqual(forms.map(() => 'github.com/idsad-xl/worfy'))
  })

  it('drops a port, and keeps the path whole', () => {
    expect(originKey('ssh://git@github.com:22/IDSAD-XL/worfy.git')).toBe('github.com/idsad-xl/worfy')
    expect(originKey('https://gitlab.example.com/group/sub/repo.git')).toBe('gitlab.example.com/group/sub/repo')
  })

  it('another owner or another repository is another key', () => {
    const key = originKey('git@github.com:IDSAD-XL/worfy.git')
    expect(originKey('git@github.com:someone/worfy.git')).not.toBe(key)
    expect(originKey('git@github.com:IDSAD-XL/worfy-docs.git')).not.toBe(key)
    expect(originKey('git@gitlab.com:IDSAD-XL/worfy.git')).not.toBe(key)
  })

  it('an empty address is no key', () => {
    expect(originKey('')).toBeNull()
    expect(originKey('   ')).toBeNull()
  })
})

describe('readOriginKey', () => {
  const dirs: string[] = []
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
  })
  const scratch = (): string => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-origin-')))
    dirs.push(dir)
    return dir
  }
  const git = (cwd: string, ...args: string[]): void => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
    execFileSync('git', ['-c', 'init.defaultBranch=main', ...args], { cwd, env, stdio: 'ignore' })
  }

  it('reads the key of remote origin of the repository at the root', async () => {
    const repo = scratch()
    git(repo, 'init', '-q')
    git(repo, 'remote', 'add', 'origin', 'git@github.com:IDSAD-XL/worfy.git')
    expect(await readOriginKey(repo)).toBe('github.com/idsad-xl/worfy')
    // A folder inside it is the same repository.
    mkdirSync(join(repo, 'src'))
    expect(await readOriginKey(join(repo, 'src'))).toBe('github.com/idsad-xl/worfy')
  })

  it('a repository without origin, a folder outside git and a missing folder have none', async () => {
    const repo = scratch()
    git(repo, 'init', '-q')
    git(repo, 'remote', 'add', 'upstream', 'git@github.com:IDSAD-XL/worfy.git')
    expect(await readOriginKey(repo)).toBeNull()
    expect(await readOriginKey(scratch())).toBeNull()
    expect(await readOriginKey(join(scratch(), 'missing'))).toBeNull()
  })
})

// The guard of every fetch (src/main/workflow/fetch.ts, setFetchGuard) gets the URL git would fetch from, after the
// `url.<base>.insteadOf` rewrites of the repository's configuration, not the raw `remote.origin.url` (follow-up of
// worfy-polish ticket 118, ADR-0107). A real repository in a temporary folder; the guard of the test refuses every
// fetch, so git never talks to a remote.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gitFetch, isLocalRemote, setFetchGuard } from '../../src/main/workflow/fetch'
import { removeTestTree } from '../remove'

let dir: string
let env: NodeJS.ProcessEnv

beforeEach(() => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-fetch-guard-')))
  const clean = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GIT_')))
  env = { ...clean, HOME: dir, USERPROFILE: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(dir, 'gitconfig') }
  writeFileSync(join(dir, 'gitconfig'), '[user]\n\tname = t\n\temail = t@t\n')
})

afterEach(() => removeTestTree(dir))

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim()
}

/** Runs one fetch of `project` with a guard that notes the URL it is shown and refuses; answers that URL. */
async function guardedUrl(project: string): Promise<string | null> {
  const seen: Array<string | null> = []
  const installed = setFetchGuard((_root, url) => {
    seen.push(url)
    throw new Error('refused by the guard')
  })
  try {
    await expect(gitFetch(() => Promise.resolve(env))(project, 'main', new AbortController().signal)).rejects.toThrow('refused by the guard')
  } finally {
    setFetchGuard(installed)
  }
  expect(seen).toHaveLength(1)
  return seen[0]!
}

describe('the fetch guard sees the URL after insteadOf', () => {
  it('a local path that the repository rewrites to an https URL reaches the guard as that https URL, which the test setup refuses', async () => {
    const project = join(dir, 'project')
    git(dir, 'init', '-q', '-b', 'main', project)
    const local = join(dir, 'origin.git')
    git(project, 'remote', 'add', 'origin', local)
    git(project, 'config', 'url.https://example.invalid/demo.git.insteadOf', local)

    const url = await guardedUrl(project)

    expect(url).toBe('https://example.invalid/demo.git')
    // The rule of test/setup-no-remote-fetch.ts: not on the disk, so refused.
    expect(isLocalRemote(url!)).toBe(false)
  })

  it('a remote with no rewrite reaches the guard as it is configured', async () => {
    const project = join(dir, 'plain')
    git(dir, 'init', '-q', '-b', 'main', project)
    const local = join(dir, 'origin.git')
    git(project, 'remote', 'add', 'origin', local)
    expect(await guardedUrl(project)).toBe(local)
  })

  it('a repository without origin shows the guard no URL', async () => {
    const project = join(dir, 'lonely')
    git(dir, 'init', '-q', '-b', 'main', project)
    expect(await guardedUrl(project)).toBeNull()
  })
})

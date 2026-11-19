// The base of a Ticket's changes (pickBase of src/main/changes/base.ts; worfy-changes-view ticket 02): the
// Profile's `worktree.base`; without it the Harness preflight's order — `origin/<default_branch>`, the branch
// `origin/HEAD` points to, `origin/main`; a repository without `origin` in a `local-green` Project takes the local
// branch. The repository is a set of refs the probe answers from.
import { describe, expect, it } from 'vitest'
import { localName, pickBase, safeRef, type RefProbe } from '../../src/main/changes/base'

/** A probe over `refs`: a ref exists when it is listed; `origin/HEAD` points to `head`. */
function repo(refs: string[], head: string | null = null): RefProbe & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    exists: async (ref) => {
      asked.push(ref)
      return refs.includes(ref)
    },
    originHead: async () => head,
    hasOrigin: async () => refs.some((ref) => ref.startsWith('origin/')),
  }
}

describe('the base of the changes', () => {
  it('is worktree.base of the Profile when it exists', async () => {
    expect(await pickBase({ mainBranch: 'origin/develop', finish: 'pr-green-ci' }, repo(['origin/main', 'origin/develop'], 'origin/main'))).toEqual({ ref: 'origin/develop', from: 'worktree.base' })
    expect(await pickBase({ mainBranch: 'main' }, repo(['origin/main', 'main']))).toEqual({ ref: 'main', from: 'worktree.base' })
  })

  it('without worktree.base: origin/<default_branch>, then origin/HEAD, then origin/main', async () => {
    expect(await pickBase({ mainBranch: null, defaultBranch: 'trunk' }, repo(['origin/trunk', 'origin/main'], 'origin/main'))).toEqual({ ref: 'origin/trunk', from: 'default_branch' })
    expect(await pickBase({ mainBranch: null }, repo(['origin/master', 'origin/main'], 'origin/master'))).toEqual({ ref: 'origin/master', from: 'origin/HEAD' })
    expect(await pickBase({}, repo(['origin/main']))).toEqual({ ref: 'origin/main', from: 'origin/main' })
  })

  it('takes the next step when worktree.base names a branch that is not there', async () => {
    expect(await pickBase({ mainBranch: 'origin/gone' }, repo(['origin/main'], 'origin/main'))).toEqual({ ref: 'origin/main', from: 'origin/HEAD' })
  })

  it('without origin and with local-green: the local branch — worktree.base without origin/, then main, then master', async () => {
    const probe = repo(['refs/heads/develop', 'refs/heads/main'])
    expect(await pickBase({ mainBranch: 'origin/develop', finish: 'local-green' }, probe)).toEqual({ ref: 'develop', from: 'local' })
    // origin/develop itself is never asked: the repository has no origin.
    expect(probe.asked).toEqual(['refs/heads/develop'])
    expect(await pickBase({ mainBranch: null, finish: 'local-green' }, repo(['refs/heads/master']))).toEqual({ ref: 'master', from: 'local' })
    expect(await pickBase({ mainBranch: null, finish: 'local-green', defaultBranch: 'trunk' }, repo(['refs/heads/trunk', 'refs/heads/main']))).toEqual({ ref: 'trunk', from: 'local' })
  })

  it('falls back to the local main branch when nothing of origin exists; none at all is no base', async () => {
    expect(await pickBase({ mainBranch: 'origin/main', finish: 'pr-green-ci' }, repo(['refs/heads/main']))).toEqual({ ref: 'main', from: 'local' })
    expect(await pickBase({ mainBranch: 'origin/main' }, repo([]))).toBeNull()
  })

  it('reads a branch name without its remote and refuses a ref that would be an option', () => {
    expect(localName('origin/main')).toBe('main')
    expect(localName('refs/remotes/origin/release/1.0')).toBe('release/1.0')
    expect(safeRef('--output=/tmp/x')).toBe(false)
    expect(safeRef('origin/main')).toBe(true)
  })
})

// The ancestry question to git shared by main (worfy-polish ticket 155, issue #2252, src/main/workflow/git-ancestry.ts):
// `git merge-base --is-ancestor` answers 0 or 1 once per pair of full SHAs for the whole process, one process per pair at a
// time, and at most ANCESTRY_GIT_LIMIT git processes at once. git is a counting stand-in here: it answers from a table and
// holds each call until the test lets it go, so the number of calls in flight can be read at any moment.
import { describe, expect, it } from 'vitest'
import { ancestryFor, ANCESTRY_GIT_LIMIT, GitAncestry } from '../../src/main/workflow/git-ancestry'
import type { GitRunner } from '../../src/main/workflow/stages'

const sha = (n: number): string => n.toString(16).padStart(40, '0')
const STABLE = 'c'.repeat(40)

interface Stub {
  git: GitRunner
  /** Every call, `<cwd> <args>`. */
  calls: string[]
  /** The most calls in flight at once. */
  peak: () => number
  /** Lets every held call answer. */
  release: () => void
  /** Commits each checkout has; a commit missing from it answers 128. */
  has: Map<string, Set<string>>
}

/** A git whose `merge-base --is-ancestor a b` answers 0 when `a` is below `b` in `ancestors`, 1 otherwise; held calls wait. */
function stub({ ancestors = new Set<string>(), hold = false }: { ancestors?: Set<string>; hold?: boolean } = {}): Stub {
  const calls: string[] = []
  const has = new Map<string, Set<string>>()
  let inFlight = 0
  let peak = 0
  let waiting: (() => void)[] = []
  const git: GitRunner = async (cwd, args) => {
    calls.push(`${cwd} ${args.join(' ')}`)
    inFlight += 1
    peak = Math.max(peak, inFlight)
    try {
      if (hold) await new Promise<void>((resolve) => waiting.push(resolve))
      const [, , a, b] = args
      const known = has.get(cwd)
      if (known !== undefined && (!known.has(a!) || !known.has(b!))) return { code: 128, stdout: '' }
      return { code: ancestors.has(`${a} ${b}`) ? 0 : 1, stdout: '' }
    } finally {
      inFlight -= 1
    }
  }
  const release = () => {
    const now = waiting
    waiting = []
    for (const resolve of now) resolve()
  }
  return { git, calls, peak: () => peak, release, has }
}

/** Lets every held call go until `work` ends: the calls a limit queues start only after earlier ones answer. */
async function drain<T>(s: Stub, work: Promise<T>): Promise<T> {
  let done = false
  void work.finally(() => (done = true))
  while (!done) {
    s.release()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return work
}

describe('the ancestry question to git', () => {
  it('asks git once per pair: a second cycle starts no git process; another checkout asks only the pairs that said no', async () => {
    const s = stub({ ancestors: new Set([`${sha(1)} ${STABLE}`]) })
    const ancestry = new GitAncestry(s.git)
    const cycle = (repo: string) => Promise.all([1, 2, 3].map((n) => ancestry.isAncestor(repo, sha(n), STABLE)))
    expect(await cycle('/worfy')).toEqual([0, 1, 1])
    expect(s.calls).toHaveLength(3)
    expect(await cycle('/worfy')).toEqual([0, 1, 1])
    expect(s.calls).toHaveLength(3)
    // A second worktree of the same repository: the yes is shared, each no is asked in its own checkout, once.
    expect(await cycle('/worfy-w16')).toEqual([0, 1, 1])
    expect(s.calls.slice(3)).toEqual([`/worfy-w16 merge-base --is-ancestor ${sha(2)} ${STABLE}`, `/worfy-w16 merge-base --is-ancestor ${sha(3)} ${STABLE}`])
    expect(await cycle('/worfy-w16')).toEqual([0, 1, 1])
    expect(s.calls).toHaveLength(5)
  })

  it('shares a no (1) with no other checkout: a shallow clone may say no where the full history says yes', async () => {
    // `clone --depth 1` and `fetch --depth 1` of an old commit: both commits are there, the path between them is not.
    const answers: Record<string, number> = { '/shallow': 1, '/full': 0 }
    const calls: string[] = []
    const git: GitRunner = async (cwd) => {
      calls.push(cwd)
      return { code: answers[cwd] ?? 128, stdout: '' }
    }
    const ancestry = new GitAncestry(git)
    expect(await ancestry.isAncestor('/shallow', sha(1), STABLE)).toBe(1)
    expect(await ancestry.isAncestor('/full', sha(1), STABLE)).toBe(0)
    // A yes holds in every checkout that has both commits: the shallow clone takes it without a process.
    expect(await ancestry.isAncestor('/shallow', sha(2), STABLE)).toBe(1)
    expect(await ancestry.isAncestor('/full', sha(2), STABLE)).toBe(0)
    expect(await ancestry.isAncestor('/shallow', sha(2), STABLE)).toBe(0)
    expect(calls).toEqual(['/shallow', '/full', '/shallow', '/full'])
  })

  it('takes a no in flight from another checkout as no answer for its own', async () => {
    const s = stub({ hold: true })
    const git: GitRunner = async (cwd, args) => {
      const result = await s.git(cwd, args)
      return cwd === '/full' ? { code: 0, stdout: '' } : result
    }
    const ancestry = new GitAncestry(git)
    const answers = drain(s, Promise.all([ancestry.isAncestor('/shallow', sha(1), STABLE), ancestry.isAncestor('/full', sha(1), STABLE)]))
    expect(await answers).toEqual([1, 0])
    expect(s.calls).toHaveLength(2)
  })

  it('keeps no answer but 0 and 1: a commit the checkout does not have (128) is asked again', async () => {
    const s = stub({ ancestors: new Set([`${sha(1)} ${STABLE}`]) })
    s.has.set('/worfy', new Set([STABLE]))
    const ancestry = new GitAncestry(s.git)
    expect(await ancestry.isAncestor('/worfy', sha(1), STABLE)).toBe(128)
    // The owner pulls: the commit is there now, and git is asked again.
    s.has.set('/worfy', new Set([STABLE, sha(1)]))
    expect(await ancestry.isAncestor('/worfy', sha(1), STABLE)).toBe(0)
    expect(s.calls).toHaveLength(2)
    expect(await ancestry.isAncestor('/worfy', sha(1), STABLE)).toBe(0)
    expect(s.calls).toHaveLength(2)
  })

  it('keeps no answer of a git that could not start', async () => {
    let calls = 0
    const ancestry = new GitAncestry(async () => {
      calls += 1
      return calls === 1 ? { code: null, stdout: '' } : { code: 0, stdout: '' }
    })
    expect(await ancestry.isAncestor('/worfy', sha(1), STABLE)).toBeNull()
    expect(await ancestry.isAncestor('/worfy', sha(1), STABLE)).toBe(0)
    expect(calls).toBe(2)
  })

  it('never keeps the answer for a ref, which moves', async () => {
    const s = stub()
    const ancestry = new GitAncestry(s.git)
    await ancestry.isAncestor('/worfy', sha(1), 'refs/heads/main')
    await ancestry.isAncestor('/worfy', sha(1), 'refs/heads/main')
    expect(s.calls).toHaveLength(2)
  })

  it('keeps the answer for a short SHA only in its own checkout', async () => {
    const s = stub()
    const ancestry = new GitAncestry(s.git)
    await ancestry.isAncestor('/worfy', sha(1), 'ccccccc')
    await ancestry.isAncestor('/worfy', sha(1), 'ccccccc')
    expect(s.calls).toHaveLength(1)
    // In another repository a short SHA may name another commit.
    await ancestry.isAncestor('/other', sha(1), 'ccccccc')
    expect(s.calls).toHaveLength(2)
  })

  it('asks a pair once while it is in flight, from this checkout or another', async () => {
    const s = stub({ hold: true, ancestors: new Set([`${sha(1)} ${STABLE}`]) })
    const ancestry = new GitAncestry(s.git)
    const answers = drain(s, Promise.all([ancestry.isAncestor('/worfy', sha(1), STABLE), ancestry.isAncestor('/worfy', sha(1), STABLE), ancestry.isAncestor('/worfy-w16', sha(1), STABLE)]))
    expect(await answers).toEqual([0, 0, 0])
    expect(s.calls).toEqual([`/worfy merge-base --is-ancestor ${sha(1)} ${STABLE}`])
  })

  it('asks in its own checkout when the one in flight elsewhere did not have the commit', async () => {
    const s = stub({ hold: true, ancestors: new Set([`${sha(1)} ${STABLE}`]) })
    s.has.set('/stale', new Set([STABLE]))
    const ancestry = new GitAncestry(s.git)
    const answers = drain(s, Promise.all([ancestry.isAncestor('/stale', sha(1), STABLE), ancestry.isAncestor('/worfy', sha(1), STABLE)]))
    expect(await answers).toEqual([128, 0])
    expect(s.calls).toHaveLength(2)
  })

  it(`runs at most ${ANCESTRY_GIT_LIMIT} git processes at once, and every question still gets its answer`, async () => {
    const s = stub({ hold: true, ancestors: new Set([`${sha(7)} ${STABLE}`]) })
    const ancestry = new GitAncestry(s.git)
    const questions = Array.from({ length: 40 }, (_, n) => ancestry.isAncestor('/worfy', sha(n), STABLE))
    // Other git commands of the same paths go through the same queue.
    questions.push(ancestry.git('/worfy', ['rev-list', '--count', STABLE]).then((result) => result.code ?? -1))
    const answers = await drain(s, Promise.all(questions))
    expect(answers.filter((code) => code === 0)).toHaveLength(1)
    expect(s.calls).toHaveLength(41)
    expect(s.peak()).toBe(ANCESTRY_GIT_LIMIT)
  })

  it('frees its place in the queue when git throws', async () => {
    let calls = 0
    const ancestry = new GitAncestry(async () => {
      calls += 1
      throw new Error('spawn failed')
    }, 1)
    await expect(ancestry.isAncestor('/worfy', sha(1), STABLE)).rejects.toThrow('spawn failed')
    await expect(ancestry.isAncestor('/worfy', sha(2), STABLE)).rejects.toThrow('spawn failed')
    expect(calls).toBe(2)
  })

  it('gives one shared instance per git runner: the app has one, each test runner its own', () => {
    const a = stub().git
    const b = stub().git
    expect(ancestryFor(a)).toBe(ancestryFor(a))
    expect(ancestryFor(a)).not.toBe(ancestryFor(b))
  })
})

// The ancestry question to git that main asks over and over (worfy-polish ticket 155, issue #2252):
// `git merge-base --is-ancestor <ancestor> <descendant>` for the Stable copy line of Acceptance
// (src/main/acceptance/stable-line.ts), the Deploy Stage (src/main/workflow/stages.ts) and the local merges of the
// Flight Recorder (src/main/flight-recorder/local-verdicts.ts). Every 6 minutes the Acceptance queue asked one per
// merge, per worktree, all at once: 40–80 git processes in one second froze a Windows desktop.
// - An answer 0 (yes) or 1 (no) is kept for the rest of the process. A yes for two full SHAs is kept by the pair alone,
//   for every checkout: a path between two commits found in any history is in the full one too. A no is kept only for
//   its own checkout: a shallow clone (`--depth`) may have both commits but not the path between them, and answers 1
//   where the full history answers 0. A short SHA is kept with its repository (another repository may give it another
//   commit); a ref (`refs/heads/main`) is never kept: it moves.
// - Any other answer is not kept and is asked again next time: 128 (a commit this checkout does not have; worfy never
//   fetches, ADR-0005, but the owner may pull) or null (git could not start or timed out).
// - One process per pair at a time: a question asked while the same pair is in flight waits for that answer. One from
//   another checkout takes its 0, and asks in its own checkout after any other answer.
// - At most ANCESTRY_GIT_LIMIT git processes of these paths at once, in a queue shared by every question and by the other
//   git commands the same paths run through `git`.
// One instance per git runner (ancestryFor): the app's gitRunner has one for the whole process, a test's stand-in its own.
import type { GitRunner } from './stages'

/** The most git processes the ancestry paths run at once (issue #2252 asked for 2–4). */
export const ANCESTRY_GIT_LIMIT = 3

const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u
const SHORT_SHA = /^[0-9a-f]{7,64}$/u

/** A runner that starts at most `limit` calls of `git` at once; the others wait in order. */
function limited(git: GitRunner, limit: number): GitRunner {
  let running = 0
  const waiting: (() => void)[] = []
  return async (cwd, args) => {
    if (running < limit) running += 1
    // The place is handed over by the call that ends, so `running` stays as it is.
    else await new Promise<void>((resolve) => waiting.push(resolve))
    try {
      return await git(cwd, args)
    } finally {
      const next = waiting.shift()
      if (next !== undefined) next()
      else running -= 1
    }
  }
}

export class GitAncestry {
  /** The git runner of these paths, behind the shared limit. */
  readonly git: GitRunner
  /** The answers 0 by pairKey, and 1 by its checkout (repoKey). */
  private readonly answers = new Map<string, 0 | 1>()
  /** The questions in flight, by pairKey: the repository asked in, and the answer to come. */
  private readonly flights = new Map<string, { repo: string; code: Promise<number | null> }>()

  constructor(runner: GitRunner, limit: number = ANCESTRY_GIT_LIMIT) {
    this.git = limited(runner, limit)
  }

  /**
   * `git merge-base --is-ancestor <ancestor> <descendant>` in `repo`: 0 yes, 1 no, 128 a commit `repo` does not have,
   * null when git could not answer. A kept answer starts no process.
   */
  async isAncestor(repo: string, ancestor: string, descendant: string): Promise<number | null> {
    const key = pairKey(repo, ancestor, descendant)
    const known = this.answers.get(key) ?? this.answers.get(repoKey(repo, ancestor, descendant))
    if (known !== undefined) return known
    const flight = this.flights.get(key)
    if (flight !== undefined) {
      const code = await flight.code
      if (flight.repo === repo || code === 0) return code
      // The checkout in flight lacked a commit, or said no and may be a shallow clone: this one may answer otherwise.
      return this.isAncestor(repo, ancestor, descendant)
    }
    const code = this.ask(repo, ancestor, descendant)
    this.flights.set(key, { repo, code })
    try {
      const answer = await code
      if (answer === 0 && keepable(ancestor, descendant)) this.answers.set(key, 0)
      if (answer === 1 && keepable(ancestor, descendant)) this.answers.set(repoKey(repo, ancestor, descendant), 1)
      return answer
    } finally {
      this.flights.delete(key)
    }
  }

  private async ask(repo: string, ancestor: string, descendant: string): Promise<number | null> {
    return (await this.git(repo, ['merge-base', '--is-ancestor', ancestor, descendant])).code
  }
}

/** The key a yes is kept by, and a question in flight: the pair for two full SHAs, the pair in its repository otherwise. */
function pairKey(repo: string, ancestor: string, descendant: string): string {
  if (FULL_SHA.test(ancestor) && FULL_SHA.test(descendant)) return `${ancestor} ${descendant}`
  return repoKey(repo, ancestor, descendant)
}

/** The key a no is kept by: the pair in its repository, whatever the SHAs. */
function repoKey(repo: string, ancestor: string, descendant: string): string {
  return `${repo}\n${ancestor} ${descendant}`
}

/** Whether an answer for the pair may be kept: two SHAs, not a ref. */
function keepable(ancestor: string, descendant: string): boolean {
  return SHORT_SHA.test(ancestor) && SHORT_SHA.test(descendant)
}

const shared = new WeakMap<GitRunner, GitAncestry>()

/** The one GitAncestry of a git runner: the app's gitRunner shares its answers and its limit across main. */
export function ancestryFor(runner: GitRunner): GitAncestry {
  let ancestry = shared.get(runner)
  if (ancestry === undefined) {
    ancestry = new GitAncestry(runner)
    shared.set(runner, ancestry)
  }
  return ancestry
}

// "What's new" (worfy-update ticket 10, spec item 6, owner decision 10, R13): the titles of the PRs
// merged between the copy that runs and the new version. They come from the commits of the one
// comparison `compare/<running>...<new>` of src/main/update/github.ts, never from a request per PR:
// without sign-in GitHub allows 60 requests an hour. A PR lands on `main` as a squash merge, whose
// first line is the PR's title followed by `(#<number>)`; a commit without that ending (a push to
// `main` without a PR) is left out. There is no changelog file.
//
// A comparison lists at most 250 commits; with 250 there may be more, and the answer says so and
// carries the address of the comparison page on github.com. The answer for a pair of SHAs is kept
// for the rest of the run: the commits between two SHAs never change. A read that fails (no network,
// GitHub refused or failed, a commit it does not know) is an Error with the reason and is not kept.
//
// The titles are GitHub's text, written by whoever opened the PR: the window shows them as text only.
import type { WhatsNew, WhatsNewItem } from '../../shared/ipc/update'
import { UPDATE_REPO, type Comparison, type UpdateGitHub } from './github'

/** The most commits GitHub lists in one comparison. */
export const COMPARE_COMMIT_LIMIT = 250

const SHA = /^[0-9a-f]{7,40}$/u
/** The first line of a squash merge: the PR's title, then ` (#<number>)` at the very end. */
const SQUASH_TITLE = /^(\S.*?)\s*\(#(\d{1,9})\)$/u

/** The PR lines of a comparison's commits, oldest first as GitHub lists them: newest first. */
export function pullRequestsOf(commits: Comparison['commits']): { items: WhatsNewItem[]; more: boolean } {
  const items: WhatsNewItem[] = []
  for (const commit of commits) {
    const match = SQUASH_TITLE.exec(commit.message.split('\n', 1)[0]!.trim())
    const number = Number(match?.[2])
    if (match !== null && Number.isSafeInteger(number) && number > 0) items.unshift({ title: match[1]!, number })
  }
  return { items, more: commits.length >= COMPARE_COMMIT_LIMIT }
}

/** The comparison page of two commits on github.com. */
export function compareUrlOf(base: string, head: string): string {
  return `https://github.com/${UPDATE_REPO}/compare/${base}...${head}`
}

export class WhatsNewReader {
  /** The last answer, by `<base>...<head>`. */
  private kept: { key: string; answer: WhatsNew } | undefined

  constructor(private readonly client: UpdateGitHub) {}

  /** The PRs between `base` (the copy that runs) and `head` (the new version, named `version`). */
  async read(base: string, head: string, version: string): Promise<WhatsNew> {
    const from = base.toLowerCase()
    const to = head.toLowerCase()
    if (!SHA.test(from)) throw new Error('this copy of worfy names no commit to compare with')
    if (!SHA.test(to)) throw new Error(`the new version names no commit: ${JSON.stringify(head)}`)
    const key = `${from}...${to}`
    if (this.kept?.key === key) return this.kept.answer
    const read = await this.client.compare(from, to)
    if (!read.ok) throw new Error(`What's new could not be read from GitHub: ${read.reason}`)
    if (read.value === null) throw new Error(`What's new could not be read from GitHub: GitHub does not know ${from.slice(0, 7)} or ${to.slice(0, 7)}`)
    const answer: WhatsNew = { version, ...pullRequestsOf(read.value.commits), compareUrl: compareUrlOf(from, to) }
    this.kept = { key, answer }
    return answer
  }
}

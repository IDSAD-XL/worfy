// What was deployed, for the Deploy Stage (ADR-0067): GitHub Deployments of an environment, or the
// commits of the default branch that carry the commit status `deploy` (worfy: `pnpm install:stable`
// sets it on the commit it installed). Whether a Ticket's merge commit is among them is the caller's
// question to git (`git merge-base --is-ancestor`, src/main/workflow/stages.ts).
//
// Read-only gh, one call per question, at most once per interval (60 s) per repository and
// environment: the caller asks only while a Ticket stands on Deploy. gh runs as the Project's
// account through the PR tracker (`PrTracker.gh`). A failed call is no deploy, and the reason goes
// to the log once until it changes; the next interval asks again.
import { z } from 'zod'

/** A deployed commit and when it was deployed. */
export interface Deployed {
  sha: string
  at: string | null
}

/** `owner/name` of a GitHub repository. */
export interface GithubRepo {
  owner: string
  name: string
}

/** The repository of a PR from its URL, `https://github.com/<owner>/<name>/pull/<N>`; null for any other URL. */
export function repoOfPullUrl(url: string): GithubRepo | null {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/pull\/\d+\/?$/u.exec(url)
  return match ? { owner: match[1]!, name: match[2]! } : null
}

export interface DeploymentReaderOptions {
  /** Runs a read-only gh command in a repository as the Project's account (PrTracker.gh). */
  gh: (root: string, args: readonly string[]) => Promise<string>
  now?: () => number
  intervalMs?: number
  log?: ((message: string) => void) | undefined
}

/** How many Deployments, and how many commits of the default branch, one call looks at. */
export const DEPLOY_WINDOW = 30

const deploymentsSchema = z.array(z.object({ sha: z.string(), created_at: z.string().nullish() }).loose())

const historySchema = z.object({
  data: z.object({
    repository: z.object({
      defaultBranchRef: z
        .object({
          target: z.object({
            history: z.object({
              nodes: z.array(z.object({ oid: z.string(), status: z.object({ context: z.object({ state: z.string(), createdAt: z.string().nullish() }).nullish() }).nullish() })),
            }),
          }),
        })
        .nullish(),
    }),
  }),
})

// shortcut: only the newest DEPLOY_WINDOW commits of the default branch are looked at, so an install more than 30 commits back is not seen; page through `history` when Tickets wait on Deploy that long.
const DEPLOY_MARKS_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { target { ... on Commit { history(first: ${DEPLOY_WINDOW}) { nodes { oid status { context(name: "deploy") { state createdAt } } } } } } }
  }
}`

export class DeploymentReader {
  private readonly cache = new Map<string, { at: number; deployed: Deployed[] }>()
  private readonly logged = new Map<string, string>()
  private readonly now: () => number
  private readonly interval: number

  constructor(private readonly options: DeploymentReaderOptions) {
    this.now = options.now ?? Date.now
    this.interval = options.intervalMs ?? 60_000
  }

  /**
   * The commits deployed to `environment`, newest first: `gh api repos/<o>/<r>/deployments?environment=<env>`.
   * shortcut: a Deployment counts whatever its last status says, read `/deployments/<id>/statuses` when a failed Deployment must not pass Deploy.
   */
  environment(root: string, repo: GithubRepo, environment: string): Promise<Deployed[]> {
    const path = `repos/${repo.owner}/${repo.name}/deployments?environment=${encodeURIComponent(environment)}&per_page=${DEPLOY_WINDOW}`
    return this.cached(`${root}\n${repo.owner}/${repo.name}\nenv:${environment}`, async () => {
      const parsed = deploymentsSchema.parse(JSON.parse(await this.options.gh(root, ['api', path])))
      return parsed.map((deployment) => ({ sha: deployment.sha, at: deployment.created_at ?? null }))
    })
  }

  /** The commits of the default branch with the commit status `deploy: success`, newest first. One GraphQL call. */
  deployMarks(root: string, repo: GithubRepo): Promise<Deployed[]> {
    return this.cached(`${root}\n${repo.owner}/${repo.name}\nstatus`, async () => {
      const stdout = await this.options.gh(root, ['api', 'graphql', '-f', `query=${DEPLOY_MARKS_QUERY}`, '-f', `owner=${repo.owner}`, '-f', `name=${repo.name}`])
      const parsed = historySchema.parse(JSON.parse(stdout))
      const nodes = parsed.data.repository.defaultBranchRef?.target.history.nodes ?? []
      return nodes.flatMap((node) => (node.status?.context?.state === 'SUCCESS' ? [{ sha: node.oid, at: node.status.context.createdAt ?? null }] : []))
    })
  }

  private async cached(key: string, read: () => Promise<Deployed[]>): Promise<Deployed[]> {
    const known = this.cache.get(key)
    const now = this.now()
    if (known && now - known.at < this.interval) return known.deployed
    let deployed: Deployed[] = []
    try {
      deployed = await read()
      this.logged.delete(key)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      if (this.logged.get(key) !== reason) {
        this.logged.set(key, reason)
        ;(this.options.log ?? ((message: string) => console.warn(message)))(`[pipeline] deploys of ${key.split('\n').slice(1).join(' ')} not read: ${reason}`)
      }
    }
    this.cache.set(key, { at: now, deployed })
    return deployed
  }
}

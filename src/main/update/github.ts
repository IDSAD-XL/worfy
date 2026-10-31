// The GitHub API without sign-in, for the Update check (worfy-update ticket 01, ADR-0089 point 1).
// Four reads of the public repository IDSAD-XL/worfy: the head of `main`, the `ci-ok` check on a
// commit, the comparison of two commits, and the `version` of package.json on a commit.
//
// No request ever carries an Authorization header, and GH_TOKEN or GITHUB_TOKEN are never read: the
// user's token is not worfy's to spend (ADR-0089 point 1). Without sign-in GitHub allows 60 requests
// an hour from one address, and a check spends one to four.
//
// Every request goes to WORFY_UPDATE_API (https://api.github.com by default), so a test points the
// client at a local server and nothing else. No network, a refusal (403, 429), a failure of GitHub
// (5xx), a timeout or an answer of an unexpected shape is a read that is skipped with its reason
// (spec R15), never an exception.
import { z } from 'zod'

export const UPDATE_REPO = 'IDSAD-XL/worfy'
export const DEFAULT_UPDATE_API = 'https://api.github.com'
/** How long one request may take before the check is skipped. */
export const UPDATE_REQUEST_TIMEOUT_MS = 15_000
/** The name of the check every push to `main` gets (ADR-0083). */
export const CI_OK = 'ci-ok'

/** A read: its value, or why it was skipped. */
export type Read<T> = { ok: true; value: T } | { ok: false; reason: string }

/** The state of `ci-ok` on a commit: `missing` when the commit has no such check. */
export type CiOkState = 'success' | 'pending' | 'failure' | 'missing'

export interface Comparison {
  status: 'ahead' | 'behind' | 'diverged' | 'identical'
  /** The changed paths; GitHub gives at most 300. */
  files: string[]
  /** The commits from base to head, at most 250; ticket 10 reads their messages. */
  commits: { sha: string; message: string }[]
}

export interface UpdateGitHub {
  /** The SHA of the head of `main`. */
  headOfMain(): Promise<Read<string>>
  ciOk(sha: string): Promise<Read<CiOkState>>
  /** `compare/<base>...<head>`; null when GitHub does not know one of them (404). */
  compare(base: string, head: string): Promise<Read<Comparison | null>>
  /** The `version` of package.json on the commit. */
  packageVersion(sha: string): Promise<Read<string>>
}

type Env = Readonly<Record<string, string | undefined>>

const branchSchema = z.object({ commit: z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/u) }) })
const checkRunsSchema = z.object({
  check_runs: z.array(z.object({ name: z.string(), status: z.string(), conclusion: z.string().nullable() })),
})
const compareSchema = z.object({
  status: z.enum(['ahead', 'behind', 'diverged', 'identical']),
  files: z.array(z.object({ filename: z.string() })).default([]),
  commits: z.array(z.object({ sha: z.string(), commit: z.object({ message: z.string() }) })).default([]),
})
const contentsSchema = z.object({ content: z.string(), encoding: z.literal('base64') })
const packageSchema = z.object({ version: z.string().min(1) })

/** WORFY_UPDATE_API without a slash at the end, or an Error when it is not an http(s) address. */
export function updateApiBase(env: Env = process.env): string {
  const value = env.WORFY_UPDATE_API || DEFAULT_UPDATE_API
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`WORFY_UPDATE_API is not an address: ${value}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`WORFY_UPDATE_API is not an http(s) address: ${value}`)
  return value.replace(/\/+$/u, '')
}

export interface GitHubClientOptions {
  /** WORFY_UPDATE_API is read from it; nothing else. */
  env?: Env
  timeoutMs?: number
  fetch?: typeof fetch
}

const why = (error: unknown): string => (error instanceof Error ? (error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message) : String(error))

/** The client over WORFY_UPDATE_API. */
export function updateGitHub(options: GitHubClientOptions = {}): UpdateGitHub {
  const timeoutMs = options.timeoutMs ?? UPDATE_REQUEST_TIMEOUT_MS
  const doFetch = options.fetch ?? fetch
  const repo = `/repos/${UPDATE_REPO}`

  /** GETs `path` and parses the JSON with `schema`; `missing` answers a 404. */
  async function get<S extends z.ZodType, M = never>(path: string, schema: S, missing?: M): Promise<Read<z.output<S> | M>> {
    let base: string
    try {
      base = updateApiBase(options.env)
    } catch (error) {
      return { ok: false, reason: why(error) }
    }
    let response: Response
    try {
      // Only these headers: never Authorization.
      response = await doFetch(`${base}${path}`, {
        headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'worfy-update' },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError'
      return { ok: false, reason: timedOut ? `GET ${path}: no answer in ${timeoutMs / 1000} s` : `GET ${path}: ${why(error)}` }
    }
    try {
      if (response.status === 404 && missing !== undefined) return { ok: true, value: missing }
      if (!response.ok) return { ok: false, reason: `GET ${path}: HTTP ${response.status}` }
      const parsed = schema.safeParse(await response.json())
      if (!parsed.success) return { ok: false, reason: `GET ${path}: an answer of an unexpected shape` }
      return { ok: true, value: parsed.data }
    } catch (error) {
      return { ok: false, reason: `GET ${path}: ${why(error)}` }
    } finally {
      // A body not read keeps the connection busy.
      if (!response.bodyUsed) await response.body?.cancel().catch(() => undefined)
    }
  }

  const map = <T, U>(read: Read<T>, to: (value: T) => U): Read<U> => (read.ok ? { ok: true, value: to(read.value) } : read)

  return {
    headOfMain: async () => map(await get(`${repo}/branches/main`, branchSchema), (branch) => branch.commit.sha),
    ciOk: async (sha) =>
      map(await get(`${repo}/commits/${sha}/check-runs?check_name=${CI_OK}`, checkRunsSchema), ({ check_runs }): CiOkState => {
        // GitHub lists the latest run of each check first.
        const run = check_runs.find((each) => each.name === CI_OK)
        if (run === undefined) return 'missing'
        if (run.status !== 'completed') return 'pending'
        return run.conclusion === 'success' ? 'success' : 'failure'
      }),
    compare: async (base, head) =>
      map(await get(`${repo}/compare/${base}...${head}`, compareSchema, null), (comparison) =>
        comparison === null
          ? null
          : {
              status: comparison.status,
              files: comparison.files.map((file) => file.filename),
              commits: comparison.commits.map((commit) => ({ sha: commit.sha, message: commit.commit.message })),
            },
      ),
    packageVersion: async (sha) => {
      const read = await get(`${repo}/contents/package.json?ref=${sha}`, contentsSchema)
      if (!read.ok) return read
      try {
        const parsed = packageSchema.safeParse(JSON.parse(Buffer.from(read.value.content, 'base64').toString('utf8')))
        return parsed.success ? { ok: true, value: parsed.data.version } : { ok: false, reason: `package.json on ${sha} has no "version"` }
      } catch (error) {
        return { ok: false, reason: `package.json on ${sha} does not read: ${why(error)}` }
      }
    },
  }
}

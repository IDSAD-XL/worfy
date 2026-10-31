// The GitHub API of the Update tests (worfy-update epic, the conventions for its tickets in
// .scratch/worfy-update/spec.md): a local HTTP server that answers the four reads of src/main/update/github.ts from
// fixtures and records every request it gets, with its headers. A test points WORFY_UPDATE_API at
// `url`; no test of the epic reaches the real GitHub.
//
// It also guards the Stable copy of a test: a path outside the system temporary folder is refused
// (assertTemporaryStableCopy), so no test of the epic touches ~/Applications/worfy-stable.app or
// %LOCALAPPDATA%\worfy-stable.
//
// It lies in test/, not in test/unit or test/contract: the tests of later tickets import it too.
import { realpathSync } from 'node:fs'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { relative, resolve, isAbsolute } from 'node:path'

const REPO = '/repos/IDSAD-XL/worfy'

export interface UpdateStubAnswers {
  /** The head of main. */
  head: string
  /** The ci-ok check run on any commit; null — the commit has none. */
  ciOk?: { status: 'queued' | 'in_progress' | 'completed'; conclusion: string | null } | null
  /** The comparison; 404 — GitHub does not know one of the commits. */
  compare?: { status: 'ahead' | 'behind' | 'diverged' | 'identical'; files: string[]; commits?: { sha: string; message: string }[] } | 404
  /** The `version` of package.json on any commit. */
  version?: string
  /** Every request is answered with this status and an empty JSON object (403, 429, 500…). */
  failWith?: number
}

export interface StubRequest {
  method: string
  /** The path with its query. */
  path: string
  headers: IncomingHttpHeaders
}

export interface UpdateStub {
  /** The address to put in WORFY_UPDATE_API. */
  url: string
  /** Every request the server got, in order. */
  requests: StubRequest[]
  /** The answers; a test may change them between checks. */
  answers: UpdateStubAnswers
  close(): Promise<void>
}

/** The folder is the system temporary folder or lies inside it, as written or as its real path. */
function insideTemp(path: string): boolean {
  const target = resolve(path)
  const temps = new Set([resolve(tmpdir())])
  try {
    temps.add(realpathSync.native(tmpdir()))
  } catch {
    // The temporary folder as written is enough.
  }
  return [...temps].some((temp) => {
    const rel = relative(temp, target)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  })
}

/** Throws when the Stable copy of a test lies outside the system temporary folder. */
export function assertTemporaryStableCopy(path: string): void {
  if (!insideTemp(path)) throw new Error(`update-stub: the Stable copy of a test must lie in the temporary folder ${tmpdir()}, got ${path}`)
}

function answer(answers: UpdateStubAnswers, method: string, path: string): { status: number; body: unknown } {
  if (answers.failWith !== undefined) return { status: answers.failWith, body: { message: `stub: HTTP ${answers.failWith}` } }
  const url = new URL(path, 'http://stub')
  if (method !== 'GET') return { status: 405, body: {} }
  if (url.pathname === `${REPO}/branches/main`) return { status: 200, body: { name: 'main', commit: { sha: answers.head } } }
  if (/^\/repos\/IDSAD-XL\/worfy\/commits\/[0-9a-f]+\/check-runs$/u.test(url.pathname)) {
    const run = answers.ciOk === undefined ? { status: 'completed', conclusion: 'success' } : answers.ciOk
    const runs = run === null || url.searchParams.get('check_name') !== 'ci-ok' ? [] : [{ name: 'ci-ok', ...run }]
    return { status: 200, body: { total_count: runs.length, check_runs: runs } }
  }
  if (url.pathname.startsWith(`${REPO}/compare/`)) {
    const comparison = answers.compare ?? { status: 'ahead', files: ['src/main/index.ts'] }
    if (comparison === 404) return { status: 404, body: { message: 'Not Found' } }
    return {
      status: 200,
      body: {
        status: comparison.status,
        files: comparison.files.map((filename) => ({ filename, status: 'modified' })),
        commits: (comparison.commits ?? []).map((commit) => ({ sha: commit.sha, commit: { message: commit.message } })),
      },
    }
  }
  if (url.pathname === `${REPO}/contents/package.json` && url.searchParams.has('ref')) {
    const content = Buffer.from(JSON.stringify({ name: 'worfy', version: answers.version ?? '0.4.0' })).toString('base64')
    return { status: 200, body: { content, encoding: 'base64' } }
  }
  return { status: 404, body: { message: 'Not Found' } }
}

/**
 * Starts the server on a free port of 127.0.0.1. `stable`: the Stable copy of the test, refused
 * outside the temporary folder. close() ends it and its connections; call it in afterEach.
 */
export async function startUpdateStub(answers: UpdateStubAnswers, options: { stable?: string } = {}): Promise<UpdateStub> {
  if (options.stable !== undefined) assertTemporaryStableCopy(options.stable)
  const requests: StubRequest[] = []
  const stub = { answers }
  const server: Server = createServer((request, response) => {
    const method = request.method ?? 'GET'
    const path = request.url ?? '/'
    requests.push({ method, path, headers: request.headers })
    const { status, body } = answer(stub.answers, method, path)
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    get answers() {
      return stub.answers
    },
    set answers(next) {
      stub.answers = next
    },
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections()
        server.close(() => done())
      }),
  }
}

/** A port of 127.0.0.1 nothing listens on: taken and closed again. */
export async function closedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  await new Promise<void>((done) => server.close(() => done()))
  return port
}

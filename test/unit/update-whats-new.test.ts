// worfy-update ticket 10: "What's new" — the titles of the PRs merged between the copy that runs and
// the Available update, read from the commits of the one comparison GitHub answers (spec R13): the
// first line of a squash merge ends with `(#<number>)`. Newest first, a commit without a number left
// out; 250 commits (all a comparison gives) mean there may be more, and the link to the comparison
// page says so. One answer per pair of SHAs is kept; no network is an error with its reason. GitHub is
// the local server of test/update-stub.ts.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { whatsNewSchema } from '../../src/shared/ipc/update'
import { UpdateService } from '../../src/main/ipc/update'
import { updateGitHub } from '../../src/main/update/github'
import { changeUpdateState } from '../../src/main/update/state'
import { COMPARE_COMMIT_LIMIT, pullRequestsOf, WhatsNewReader } from '../../src/main/update/whats-new'
import { removeTestTree } from '../remove'
import { closedPort, startUpdateStub, type UpdateStub } from '../update-stub'

const RUNNING = '1'.repeat(40)
const HEAD = 'abcdef0' + '2'.repeat(33)
const OTHER = 'fedcba9' + '3'.repeat(33)
const VERSION = '0.6.0+abcdef0'
const COMPARE_PAGE = `https://github.com/IDSAD-XL/worfy/compare/${RUNNING}...${HEAD}`

/** Three commits, oldest first as GitHub lists them: #1, one without a number, #2. */
const THREE = [
  { sha: 'a'.repeat(40), message: 'feat(update): the first change (#1)\n\nThe body of the squash merge.\n\n* a line (#99)' },
  { sha: 'b'.repeat(40), message: 'chore: a commit pushed to main without a PR' },
  { sha: 'c'.repeat(40), message: 'fix(update): the second change (#2)' },
]

let stub: UpdateStub | undefined
const folders: string[] = []

afterEach(async () => {
  await stub?.close()
  stub = undefined
  for (const folder of folders.splice(0)) removeTestTree(folder)
})

const reader = (url: string): WhatsNewReader => new WhatsNewReader(updateGitHub({ env: { WORFY_UPDATE_API: url } }))
/** The requests that are not the one comparison: a read of a PR, of a commit, anything else. */
const otherRequests = (): string[] => (stub?.requests ?? []).map((request) => request.path).filter((path) => !path.startsWith('/repos/IDSAD-XL/worfy/compare/'))

describe('the titles of the PRs in a comparison', () => {
  it('three commits with (#1), (#2) and without a number: two lines, newest first; the commit without a number is left out', () => {
    expect(pullRequestsOf(THREE)).toEqual({
      items: [
        { title: 'fix(update): the second change', number: 2 },
        { title: 'feat(update): the first change', number: 1 },
      ],
      more: false,
    })
  })

  it('reads the number only at the end of the first line; a title with a number inside it keeps it', () => {
    const commits = [
      { sha: 'd'.repeat(40), message: 'Revert "feat: x (#5)" (#6)' },
      { sha: 'e'.repeat(40), message: 'docs: (#7) is not at the end' },
      { sha: 'f'.repeat(40), message: '(#8)' },
      { sha: '0'.repeat(40), message: '  fix: spaces around   (#9)  \r\nbody' },
    ]
    expect(pullRequestsOf(commits).items).toEqual([
      { title: 'fix: spaces around', number: 9 },
      { title: 'Revert "feat: x (#5)"', number: 6 },
    ])
  })

  it('250 commits, all a comparison gives: `more`', () => {
    const commits = Array.from({ length: COMPARE_COMMIT_LIMIT }, (_, at) => ({ sha: at.toString(16).padStart(40, '0'), message: `feat: change ${at} (#${at + 1})` }))
    const { items, more } = pullRequestsOf(commits)
    expect(COMPARE_COMMIT_LIMIT).toBe(250)
    expect(more).toBe(true)
    expect(items).toHaveLength(250)
    expect(items[0]).toEqual({ title: 'feat: change 249', number: 250 })
    expect(pullRequestsOf(commits.slice(1)).more).toBe(false)
  })
})

describe('WhatsNewReader over GitHub', () => {
  it('answers the version, the lines and the comparison page from one comparison, with no request per PR', async () => {
    stub = await startUpdateStub({ head: HEAD, compare: { status: 'ahead', files: ['src/main/x.ts'], commits: THREE } })
    const answer = await reader(stub.url).read(RUNNING, HEAD, VERSION)
    expect(whatsNewSchema.parse(answer)).toEqual({
      version: VERSION,
      items: [
        { title: 'fix(update): the second change', number: 2 },
        { title: 'feat(update): the first change', number: 1 },
      ],
      more: false,
      compareUrl: COMPARE_PAGE,
    })
    expect(stub.requests.map((request) => request.path)).toEqual([`/repos/IDSAD-XL/worfy/compare/${RUNNING}...${HEAD}`])
    expect(otherRequests()).toEqual([])
  })

  it('250 commits: `more` and the link to the comparison page; still one request', async () => {
    const commits = Array.from({ length: 250 }, (_, at) => ({ sha: at.toString(16).padStart(40, '0'), message: `feat: change ${at} (#${at + 1})` }))
    stub = await startUpdateStub({ head: HEAD, compare: { status: 'ahead', files: [], commits } })
    const answer = await reader(stub.url).read(RUNNING, HEAD, VERSION)
    expect(answer.more).toBe(true)
    expect(answer.compareUrl).toBe(COMPARE_PAGE)
    expect(answer.items).toHaveLength(250)
    expect(stub.requests).toHaveLength(1)
    expect(otherRequests()).toEqual([])
  })

  it('keeps the answer for the pair of SHAs: a second read asks GitHub nothing, another head asks again', async () => {
    stub = await startUpdateStub({ head: HEAD, compare: { status: 'ahead', files: [], commits: THREE } })
    const whatsNew = reader(stub.url)
    const first = await whatsNew.read(RUNNING, HEAD, VERSION)
    expect(await whatsNew.read(RUNNING, HEAD, VERSION)).toEqual(first)
    expect(stub.requests).toHaveLength(1)
    await whatsNew.read(RUNNING, OTHER, '0.6.1+fedcba9')
    expect(stub.requests).toHaveLength(2)
  })

  it('no network: an error with its reason, and nothing kept, so the next read asks again', async () => {
    const port = await closedPort()
    const offline = reader(`http://127.0.0.1:${port}`)
    await expect(offline.read(RUNNING, HEAD, VERSION)).rejects.toThrow(/^What's new could not be read from GitHub: GET \/repos\/IDSAD-XL\/worfy\/compare\/.+/u)

    stub = await startUpdateStub({ head: HEAD, compare: { status: 'ahead', files: [], commits: THREE } })
    const shared = updateGitHub({ env: { WORFY_UPDATE_API: stub.url } })
    const whatsNew = new WhatsNewReader(shared)
    stub.answers = { ...stub.answers, failWith: 403 }
    await expect(whatsNew.read(RUNNING, HEAD, VERSION)).rejects.toThrow("What's new could not be read from GitHub: GET /repos/IDSAD-XL/worfy/compare/")
    stub.answers = { head: HEAD, compare: { status: 'ahead', files: [], commits: THREE } }
    expect((await whatsNew.read(RUNNING, HEAD, VERSION)).items).toHaveLength(2)
  })

  it('GitHub does not know one of the commits (404): an error that says so', async () => {
    stub = await startUpdateStub({ head: HEAD, compare: 404 })
    await expect(reader(stub.url).read(RUNNING, HEAD, VERSION)).rejects.toThrow(`GitHub does not know ${RUNNING.slice(0, 7)} or ${HEAD.slice(0, 7)}`)
  })

  it('refuses a commit that is not a SHA before it asks anything: no copy commit, no path in the address', async () => {
    stub = await startUpdateStub({ head: HEAD, compare: { status: 'ahead', files: [], commits: THREE } })
    const whatsNew = reader(stub.url)
    await expect(whatsNew.read('', HEAD, VERSION)).rejects.toThrow('this copy of worfy names no commit to compare with')
    await expect(whatsNew.read('../../pulls', HEAD, VERSION)).rejects.toThrow('this copy of worfy names no commit to compare with')
    expect(stub.requests).toHaveLength(0)
  })
})

describe('the service answers update.whatsNew', () => {
  const service = (url: string, fields: { enabled?: boolean; running?: string } = {}) => {
    const folder = mkdtempSync(join(tmpdir(), 'worfy-whats-new-'))
    folders.push(folder)
    const file = join(folder, 'update', 'state.json')
    return {
      file,
      service: new UpdateService({
        enabled: fields.enabled ?? true,
        running: () => ({ commit: fields.running ?? RUNNING, version: '0.5.0+1111111' }),
        client: updateGitHub({ env: { WORFY_UPDATE_API: url } }),
        stateFile: () => file,
        broadcast: () => undefined,
      }),
    }
  }

  it('compares the running commit with the Available update and names its version', async () => {
    stub = await startUpdateStub({ head: HEAD, compare: { status: 'ahead', files: [], commits: THREE } })
    const { file, service: update } = service(stub.url)
    changeUpdateState((state) => ({ ...state, available: { sha: HEAD, version: VERSION, quiet: false } }), file)
    const answer = await update.whatsNew()
    expect(answer).toMatchObject({ version: VERSION, more: false, compareUrl: COMPARE_PAGE })
    expect(answer.items.map((item) => item.number)).toEqual([2, 1])
  })

  it('a build that runs or is ready names its own commit and version', async () => {
    stub = await startUpdateStub({ head: HEAD, compare: { status: 'ahead', files: [], commits: THREE } })
    const { file, service: update } = service(stub.url)
    changeUpdateState((state) => ({ ...state, available: { sha: OTHER, version: '0.6.1+fedcba9', quiet: false }, build: { phase: 'ready', sha: HEAD, version: VERSION } }), file)
    expect(await update.whatsNew()).toMatchObject({ version: VERSION, compareUrl: COMPARE_PAGE })
  })

  it('without an Available update, or with Update off in this copy: an error with its reason, and GitHub is not asked', async () => {
    stub = await startUpdateStub({ head: HEAD, compare: { status: 'ahead', files: [], commits: THREE } })
    await expect(service(stub.url).service.whatsNew()).rejects.toThrow('there is no Available update to compare with')
    const off = service(stub.url, { enabled: false })
    changeUpdateState((state) => ({ ...state, available: { sha: HEAD, version: VERSION, quiet: false } }), off.file)
    await expect(off.service.whatsNew()).rejects.toThrow('Update is off in this copy of worfy')
    expect(stub.requests).toHaveLength(0)
  })
})

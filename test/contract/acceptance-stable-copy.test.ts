// The Stable copy line and the group Update first (worfy-acceptance ticket 02): src/main/acceptance/service.ts with its
// Stable copy line (src/main/acceptance/stable-line.ts) over the real workflow hub, the stub epic-status of
// test/fixtures/workflow-stub and a temporary git repository whose `origin` names worfy's repository (a string only:
// no fetch runs, the network is not needed). The Stable copy is a temporary folder named by WORFY_UPDATE_STABLE, with
// the file next to it naming a commit of that repository, as scripts/install-stable.mjs writes it. gh is a stand-in
// GhRunner behind the real PR tracker: it gives each PR's merge commit and counts its calls.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AcceptanceService } from '../../src/main/acceptance/service'
import { PrTracker, type GhRunner } from '../../src/main/github/prs'
import { stableCopyPath, stableMetadataPath } from '../../src/main/update/stable-copy'
import type { WorkflowHub } from '../../src/main/workflow/watch'
import type { AcceptanceRow, AcceptanceState } from '../../src/shared/ipc/acceptance'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

vi.mock('electron', () => ({
  app: { on: () => undefined, getPath: () => tmpdir() },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
}))

const WORKFLOW_STUB = join(__dirname, '..', 'fixtures', 'workflow-stub')
const PROJECT = 'worfy-0000000a'
const NOT_IN_CLONE = 'd'.repeat(40)

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim()
}

function ticketText(num: number, pr: number, done: string[]): string {
  const nn = String(num).padStart(2, '0')
  return [`# ${nn} — Ticket ${num}`, '', 'Type: task', 'Status: done 2026-11-22T10:00Z', `PR: #${pr}`, 'Blocked by: —', '', '## Done when', '', ...done, ''].join('\n')
}

const nameOf = (row: AcceptanceRow): string => `${String(row.ticket.num).padStart(2, '0')}${row.kind === 'item' ? `.${row.item.index}` : ''}`
const shape = (state: AcceptanceState): Record<string, string[]> => Object.fromEntries(state.groups.map((group) => [group.group, group.rows.map(nameOf)]))
const lineOf = (state: AcceptanceState, name: string) => {
  const row = state.groups.flatMap((group) => group.rows).find((each) => nameOf(each) === name)
  return row?.kind === 'item' ? row.stable : undefined
}

let scratch: string
let root: string
let hub: WorkflowHub
let services: AcceptanceService[]
let ghCalls: string[]
let savedStable: string | undefined
/** The merge commit of each PR, as GitHub would give it. */
let merges: Map<number, string>
/** The commit the Stable copy runs (the file next to it names it). */
let stableSha: string
let Service: typeof import('../../src/main/acceptance/service').AcceptanceService

const standInGh: GhRunner = async (args) => {
  ghCalls.push(args.join(' '))
  if (args[0] !== 'pr' || args[1] !== 'view') throw new Error(`unexpected gh ${args.join(' ')}`)
  const merge = merges.get(Number(args[2]))
  if (merge === undefined) throw new Error('no pull requests found')
  return JSON.stringify({ number: Number(args[2]), state: 'MERGED', mergeCommit: { oid: merge } })
}

function makeService(): AcceptanceService {
  const tracker = new PrTracker({ run: standInGh })
  const service = new Service(
    { hub, projects: () => [{ id: PROJECT, name: 'worfy', path: root }], dataDir: (id) => join(scratch, 'data', id), stable: { gh: (at, args) => tracker.gh(at, args), update: () => ({ checks: true, available: null }) } },
    { now: () => Date.parse('2026-11-23T12:00:00Z'), tickMs: ms(60_000) },
  )
  services.push(service)
  return service
}

/** The queue once every row of Ready to check and Update first has its line. */
async function settled(service: AcceptanceService): Promise<AcceptanceState> {
  let state: AcceptanceState | undefined
  await vi.waitFor(
    async () => {
      state = await service.get()
      const rows = state.groups.filter((group) => group.group === 'ready' || group.group === 'update').flatMap((group) => group.rows)
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) expect(row.kind === 'item' && row.stable).toBeTruthy()
    },
    { timeout: ms(10_000), interval: 20 },
  )
  return state!
}

beforeEach(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-acceptance-stable-')))
  root = join(scratch, 'worfy')
  const home = join(scratch, 'claude-home')
  mkdirSync(join(home, 'bin'), { recursive: true })
  symlinkSync(join(WORKFLOW_STUB, 'epic-status'), join(home, 'bin', 'epic-status'))
  process.env.STUB_LOG = join(scratch, 'stub-calls.log')
  writeFileSync(process.env.STUB_LOG, '')
  // Three commits of worfy's history: the first two are in the Stable copy, the third is not.
  const issues = join(root, '.scratch', 'demo', 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(root, '.scratch', 'demo', 'spec.md'), '# Demo epic\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'worfy', version: '0.4.0' }))
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'remote', 'add', 'origin', 'https://github.com/IDSAD-XL/worfy.git')
  git(root, 'add', '-A')
  git(root, 'commit', '-qm', 'first')
  const first = git(root, 'rev-parse', 'HEAD')
  git(root, 'commit', '-q', '--allow-empty', '-m', 'second')
  const second = git(root, 'rev-parse', 'HEAD')
  git(root, 'commit', '-q', '--allow-empty', '-m', 'third')
  const third = git(root, 'rev-parse', 'HEAD')
  writeFileSync(join(issues, '01-in.md'), ticketText(1, 11, ['- [ ] (manual) The chip shows the server.']))
  writeFileSync(join(issues, '02-out.md'), ticketText(2, 12, ['- [ ] (manual) Esc keeps the text.']))
  writeFileSync(join(issues, '03-unknown.md'), ticketText(3, 13, ['- [ ] (manual) The toast names the PR.']))
  git(root, 'add', '-A')
  git(root, 'commit', '-qm', 'tickets')
  merges = new Map([
    [11, first],
    [12, third],
    [13, NOT_IN_CLONE],
  ])
  // The Stable copy runs the second commit: the file next to it names it, as install-stable writes it.
  savedStable = process.env.WORFY_UPDATE_STABLE
  process.env.WORFY_UPDATE_STABLE = join(scratch, 'Applications', 'worfy-stable.app')
  mkdirSync(stableCopyPath(), { recursive: true })
  writeFileSync(stableMetadataPath(process.platform, stableCopyPath()), JSON.stringify({ commit: second, builtAt: '2026-11-23T10:00:00Z' }))
  stableSha = second
  ghCalls = []
  services = []
  vi.resetModules()
  const { WorkflowHub: Hub } = await import('../../src/main/workflow/watch')
  hub = new Hub({ claudeHome: home, env: () => Promise.resolve(process.env) })
  ;({ AcceptanceService: Service } = await import('../../src/main/acceptance/service'))
})

afterEach(async () => {
  for (const service of services) await service.stop()
  await hub.closeAll()
  delete process.env.STUB_LOG
  if (savedStable === undefined) delete process.env.WORFY_UPDATE_STABLE
  else process.env.WORFY_UPDATE_STABLE = savedStable
  removeTestTree(scratch)
})

describe('the Stable copy line of the Acceptance queue', () => {
  it('puts a merge in the Stable copy in Ready to check, one that is not in Update first, and an unknown commit "not checked"', async () => {
    const service = makeService()
    const state = await settled(service)
    expect(shape(state)).toMatchObject({ ready: ['01.1', '03.1'], update: ['02.1'] })
    expect(lineOf(state, '01.1')).toEqual({ state: 'in', text: 'In your Stable copy 0.4.2 — the change is there since 0.4.1', update: null })
    expect(lineOf(state, '02.1')).toEqual({ state: 'out', text: 'Not in your Stable copy yet: it runs 0.4.2, the change is in 0.4.3', update: 'waits-ci' })
    expect(lineOf(state, '03.1')).toEqual({
      state: 'not-checked',
      text: `Stable copy not checked: the merge commit ${NOT_IN_CLONE.slice(0, 7)} is not in this checkout`,
      update: null,
    })
    // The snapshot names the Stable copy's commit: the `sha` of a decision checked in it (worfy-acceptance ticket 05).
    expect(state.stableCommit).toBe(stableSha)
    // Nothing is fetched or written in the Project: its working tree is as the test left it.
    expect(git(root, 'status', '--porcelain')).toBe('')
  })

  it('asks gh once per merged PR: a second snapshot after a change of a Ticket file asks nothing again', async () => {
    const service = makeService()
    const changes: AcceptanceState[] = []
    await service.subscribe('window', (next) => changes.push(next))
    await settled(service)
    expect([...ghCalls].sort()).toEqual(['pr view 11 --json number,state,mergeCommit', 'pr view 12 --json number,state,mergeCommit', 'pr view 13 --json number,state,mergeCommit'])
    const sent = changes.length
    writeFileSync(join(root, '.scratch', 'demo', 'issues', '01-in.md'), ticketText(1, 11, ['- [ ] (manual) The chip shows the server.', '- [ ] (manual) And its tools.']))
    await vi.waitFor(() => expect(changes.length).toBeGreaterThan(sent), { timeout: ms(10_000), interval: 20 })
    const after = await settled(service)
    expect(shape(after).ready).toEqual(['01.1', '01.2', '03.1'])
    expect(ghCalls).toHaveLength(3)
  })
})

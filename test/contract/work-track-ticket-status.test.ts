// The changes of Ticket status that Work track reads from git (src/main/work-track/ticket-status.ts;
// worfy-work-track ticket 07), on a real repository in a temporary folder. A Ticket is claimed and done
// on a branch, and the branch is squashed into main: that is two changes at the times of their values,
// not a third change at the time of the squash. A change whose value has no time takes the time of the
// branch commit; with no branch, the time of the main commit. The reader only reads: the repository is
// the same after it, file for file.
//
// HOME of every git call — the test's own and the reader's — is the temporary folder: the tester's
// ~/.gitconfig is never read.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readTicketStatusChanges, readTicketStatusFacts } from '../../src/main/work-track/ticket-status'
import { removeTestTree } from '../remove'

// A Cyrillic slug, as the Ticket files of the project have: the path must come out of git unquoted.
const T07 = '.scratch/ep/issues/07-смены-статуса.md'
const T08 = '.scratch/ep/issues/08-other.md'
const T09 = '.scratch/ep/issues/09-third.md'
const T11 = '.scratch/ep/issues/11-created-blocked.md'
const NOT_A_TICKET = '.scratch/ep/spec.md'

let root: string
let repo: string

/** A Ticket file: the header, then a body long enough that a Status line in it is outside the header. */
function ticket(num: string, status: string, bodyStatus = 'open'): string {
  const body = Array.from({ length: 20 }, (_, i) => `Line ${i + 1} of the body.`)
  return [`# ${num} — A ticket`, '', 'Type: task', `Status: ${status}`, 'Blocked by: —', '', '## What happens', '', ...body, '', `Status: ${bodyStatus}`, ''].join('\n')
}

function git(...args: string[]): string {
  return gitAt({}, ...args)
}

// No auto maintenance: git 2.56 may start it detached after a commit, and its .git/objects/maintenance.lock
// comes and goes while a test compares the repository's files (#1510).
function gitAt(env: Record<string, string>, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', '-c', 'maintenance.auto=false', ...args], {
    cwd: repo,
    env: { ...process.env, HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/** Writes `files` and commits them with the author date `authored` and the committer date `committed`. */
function commit(message: string, files: Record<string, string>, authored: string, committed = authored): string {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true })
    writeFileSync(join(repo, path), text)
  }
  git('add', '-A')
  gitAt({ GIT_AUTHOR_DATE: authored, GIT_COMMITTER_DATE: committed }, 'commit', '-q', '-m', message)
  return git('rev-parse', 'HEAD')
}

/** Every file under `dir`, with its size and modification time: what a write would change. */
function snapshot(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name)
      if (entry.isDirectory()) walk(path)
      else {
        const st = statSync(path)
        out.push(`${relative(dir, path)} ${st.size} ${st.mtimeMs}`)
      }
    }
  }
  walk(dir)
  return out.sort()
}

const sha: Record<string, string> = {}

beforeEach(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-ticket-status-')))
  repo = join(root, 'project')
  mkdirSync(repo)
  vi.stubEnv('HOME', root)
  vi.stubEnv('USERPROFILE', root)
  vi.stubEnv('XDG_CONFIG_HOME', root)
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
  git('init', '-q')

  // Before the period: the Tickets are written, all open.
  sha.c0 = commit('Tickets of ep', { [T07]: ticket('07', 'open'), [T08]: ticket('08', 'open'), [T09]: ticket('09', 'open'), [NOT_A_TICKET]: 'Status: open\n' }, '2026-11-04T09:00:00Z')

  // The branch of Ticket 07: claimed and done with a time in the value; 08 claimed with a date only.
  git('checkout', '-q', '-b', 'ep/07')
  sha.c1 = commit('Claim 07', { [T07]: ticket('07', 'claimed 2026-11-05T07:39Z') }, '2026-11-05T08:17:00Z')
  sha.c2 = commit('Claim 08', { [T08]: ticket('08', 'claimed — 2026-11-05') }, '2026-11-05T08:30:00Z', '2026-11-05T09:30:00Z')
  sha.c3 = commit('Done 07', { [T07]: ticket('07', 'done 2026-11-05T09:10Z'), [NOT_A_TICKET]: 'Status: done 2026-11-05T09:10Z\n' }, '2026-11-05T09:11:00Z')
  git('update-ref', 'refs/remotes/origin/ep/07', 'HEAD')

  // main: the squash of the branch, then changes made on main itself.
  git('checkout', '-q', 'main')
  sha.c4 = commit(
    'Ticket 07 of ep (#12)',
    { [T07]: ticket('07', 'done 2026-11-05T09:10Z'), [T08]: ticket('08', 'claimed — 2026-11-05'), [NOT_A_TICKET]: 'Status: done 2026-11-05T09:10Z\n' },
    '2026-11-05T10:00:00Z',
  )
  sha.c5 = commit('docs: mark 09 done (#13)', { [T09]: ticket('09', 'done 2026-11-05'), [T11]: ticket('11', 'blocked') }, '2026-11-05T11:00:00Z')
  // A Status line in the body, and a value rewritten in the same state: no change of status.
  sha.c6 = commit('Rewrite values', { [T09]: ticket('09', 'done 2026-11-05', 'done 2026-11-05T12:00Z'), [T08]: ticket('08', 'claimed 2026-11-05') }, '2026-11-05T12:00:00Z')
  // A value of an unknown form: no change.
  sha.c7 = commit('Unknown form', { [T08]: ticket('08', 'черновик') }, '2026-11-05T13:00:00Z')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
})

afterEach(() => {
  vi.unstubAllEnvs()
  removeTestTree(root)
})

describe('readTicketStatusChanges', () => {
  it('reads claim and done on a branch squashed into main as two changes at the times of their values', async () => {
    const changes = await readTicketStatusChanges({ repo, since: '2026-11-05T00:00:00Z' })
    expect(changes).toEqual([
      { epic: 'ep', ticket: '07', from: 'open', to: 'claimed', at: '2026-11-05T07:39:00.000Z', timeFrom: 'value', commit: sha.c1 },
      { epic: 'ep', ticket: '08', from: 'open', to: 'claimed', at: '2026-11-05T08:30:00.000Z', timeFrom: 'branch-commit', commit: sha.c2, pr: 12 },
      { epic: 'ep', ticket: '07', from: 'claimed', to: 'done', at: '2026-11-05T09:10:00.000Z', timeFrom: 'value', commit: sha.c3, pr: 12 },
      { epic: 'ep', ticket: '09', from: 'open', to: 'done', at: '2026-11-05T11:00:00.000Z', timeFrom: 'main-commit', commit: sha.c5, pr: 13 },
    ])
  })

  it('takes the main commit when no branch holds the change', async () => {
    git('update-ref', '-d', 'refs/remotes/origin/ep/07')
    const changes = await readTicketStatusChanges({ repo, since: '2026-11-05T00:00:00Z' })
    expect(changes).toEqual([
      { epic: 'ep', ticket: '07', from: 'open', to: 'done', at: '2026-11-05T09:10:00.000Z', timeFrom: 'value', commit: sha.c4, pr: 12 },
      { epic: 'ep', ticket: '08', from: 'open', to: 'claimed', at: '2026-11-05T10:00:00.000Z', timeFrom: 'main-commit', commit: sha.c4, pr: 12 },
      { epic: 'ep', ticket: '09', from: 'open', to: 'done', at: '2026-11-05T11:00:00.000Z', timeFrom: 'main-commit', commit: sha.c5, pr: 13 },
    ])
  })

  it('keeps only the changes of the period', async () => {
    const changes = await readTicketStatusChanges({ repo, since: '2026-11-05T09:00:00Z', until: '2026-11-05T10:30:00Z' })
    expect(changes.map((c) => `${c.ticket} ${c.to} ${c.at}`)).toEqual(['07 done 2026-11-05T09:10:00.000Z'])
    // The branch commits are older than the period, the squash is in it: the squash is still the same
    // changes, not new ones at the time of the squash.
    const later = await readTicketStatusChanges({ repo, since: '2026-11-05T09:45:00Z' })
    expect(later.map((c) => `${c.ticket} ${c.to} ${c.at}`)).toEqual(['09 done 2026-11-05T11:00:00.000Z'])
    expect(await readTicketStatusChanges({ repo, since: '2026-11-06T00:00:00Z' })).toEqual([])
  })

  it('reads a Ticket created already claimed or done as a change from nothing', async () => {
    commit('New ticket done at once', { '.scratch/ep/issues/12-at-once.md': ticket('12', 'done 2026-11-05T13:30Z') }, '2026-11-05T14:00:00Z')
    git('update-ref', 'refs/remotes/origin/main', 'HEAD')
    const changes = await readTicketStatusChanges({ repo, since: '2026-11-05T13:00:00Z' })
    expect(changes).toEqual([{ epic: 'ep', ticket: '12', from: null, to: 'done', at: '2026-11-05T13:30:00.000Z', timeFrom: 'value', commit: git('rev-parse', 'HEAD') }])
  })

  it('reads a time with no zone in the time zone of the commit', async () => {
    commit('Done 09 in local time', { [T09]: ticket('09', 'blocked 2026-11-05 16:05') }, '2026-11-05T16:10:00+02:00')
    git('update-ref', 'refs/remotes/origin/main', 'HEAD')
    const changes = await readTicketStatusChanges({ repo, since: '2026-11-05T13:30:00Z' })
    expect(changes).toEqual([{ epic: 'ep', ticket: '09', from: 'done', to: 'blocked', at: '2026-11-05T14:05:00.000Z', timeFrom: 'value', commit: git('rev-parse', 'HEAD') }])
  })

  it('reads the history of HEAD in a repository with no origin/main', async () => {
    git('update-ref', '-d', 'refs/remotes/origin/main')
    git('update-ref', '-d', 'refs/remotes/origin/ep/07')
    const changes = await readTicketStatusChanges({ repo, since: '2026-11-05T10:30:00Z' })
    expect(changes.map((c) => `${c.ticket} ${c.from} ${c.to}`)).toEqual(['09 open done'])
  })

  it('leaves the repository as it was', async () => {
    // `git status` of the test itself refreshes the index: it runs before the snapshot.
    const status = git('status', '--porcelain')
    const before = snapshot(repo)
    await readTicketStatusChanges({ repo, since: '2026-11-01T00:00:00Z' })
    expect(snapshot(repo)).toEqual(before)
    expect(git('status', '--porcelain')).toBe(status)
  })

  it('fails with the error of git when the folder is not a repository', async () => {
    const empty = join(root, 'empty')
    mkdirSync(empty)
    await expect(readTicketStatusChanges({ repo: empty, since: '2026-11-01T00:00:00Z' })).rejects.toThrow(/git/)
  })
})

describe('readTicketStatusFacts', () => {
  it('gives each change as a ticket-status fact of the git source, a moment', async () => {
    const facts = await readTicketStatusFacts({ repo, since: '2026-11-05T09:00:00Z' })
    expect(facts).toEqual([
      {
        id: `ticket-status:${sha.c3}:ep/07`,
        kind: 'ticket-status',
        start: '2026-11-05T09:10:00.000Z',
        end: '2026-11-05T09:10:00.000Z',
        outcome: 'ok',
        session: null,
        epic: 'ep',
        ticket: '07',
        pr: 12,
        source: 'git',
        title: '07 claimed → done',
      },
      {
        id: `ticket-status:${sha.c5}:ep/09`,
        kind: 'ticket-status',
        start: '2026-11-05T11:00:00.000Z',
        end: '2026-11-05T11:00:00.000Z',
        outcome: 'ok',
        session: null,
        epic: 'ep',
        ticket: '09',
        pr: 13,
        source: 'git',
        title: '09 open → done',
      },
    ])
  })
})

// The writer of the draft of replies (harness/bin/pr-reply-draft, Epic worfy-pr-inbox, ticket 04): skill pr-reply hands
// it the replies of a run on stdin; it checks them with review-draft-lint --reply, writes nothing on a finding, and
// merges them into <Profile folder>/state/pr-inbox/drafts/<owner>-<name>-<pr>.json so that what the person did with an
// earlier draft stays. Every run gets a temporary HARNESS_HOME, HOME and project; the texts are invented.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const CLI = join(process.cwd(), 'harness', 'bin', 'pr-reply-draft')

let root: string
let home: string
let harnessHome: string
let repo: string
let outside: string
let drafts: string
let file: string

beforeAll(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'pr-reply-draft-')))
  home = join(root, 'home')
  harnessHome = join(root, 'hh')
  repo = join(root, 'repo')
  outside = join(root, 'outside')
  for (const dir of [home, join(harnessHome, 'gate'), join(harnessHome, 'projects', 'fp'), join(repo, '.scratch', 'checkout-flow', 'issues'), outside])
    mkdirSync(dir, { recursive: true })
  const init = spawnSync('git', ['init', '-q', repo], { encoding: 'utf8' })
  expect(init.status, init.stderr).toBe(0)
  const entry = { key: 'fp', match: repo, profile: 'fp', pm: 'npm', root: {}, workspace: {} }
  writeFileSync(join(harnessHome, 'gate', 'config.json'), JSON.stringify({ repos: [entry] }))
  writeFileSync(join(harnessHome, 'projects', 'fp', 'profile.json'), JSON.stringify({ schema: 2, name: 'fp', mode: 'full', attribution: 'on', tickets: { root: '.scratch/' } }))
  drafts = join(harnessHome, 'projects', 'fp', 'state', 'pr-inbox', 'drafts')
  file = join(drafts, 'example-org-app-118.json')
})

afterAll(() => {
  removeTestTree(root)
})

interface Run {
  status: number | null
  stdout: string
  stderr: string
}

function write(input: unknown, args: string[] = [], cwd = repo): Run {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, HARNESS_HOME: harnessHome, EVAL_HARNESS_HOME: '' }
  // The gate runs the tests with CLAUDE_GATE_CONFIG naming the registry of this machine; the scripts would read
  // that one instead of the temporary HARNESS_HOME.
  for (const name of ['CLAUDE_GATE_CONFIG', 'CLAUDE_GATE_RESOLVE', 'CLAUDE_PROFILES_DIR', 'CLAUDE_PROFILE_BIN', 'CLAUDE_TICKET_BIN']) delete env[name]
  const run = spawnSync(scriptNode(), [CLI, ...args], { cwd, encoding: 'utf8', env, input: typeof input === 'string' ? input : JSON.stringify(input) })
  return { status: run.status, stdout: run.stdout, stderr: run.stderr }
}

type Item = Record<string, unknown>
const thread = (threadId: string, body: string, more: Item = {}): Item => ({ kind: 'thread', threadId, replyTo: 4211, label: 'needs answer', body, fixPlan: null, state: 'draft', sentUrl: null, ...more })
const conversation = (body: string, more: Item = {}): Item => ({ kind: 'conversation', label: 'FYI', body, fixPlan: null, state: 'draft', sentUrl: null, ...more })
const replies = (items: Item[], more: Item = {}): Item => ({ schema: 1, repo: 'example-org/app', pr: 118, headOid: '0123abc4def5', items, ...more })
const saved = (): { headOid: string; items: Item[] } => JSON.parse(readFileSync(file, 'utf8')) as { headOid: string; items: Item[] }
const reset = (content: unknown | null): void => {
  mkdirSync(drafts, { recursive: true })
  if (content === null) removeTestTree(file)
  else writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
}
const leftovers = (): string[] => (existsSync(drafts) ? readdirSync(drafts).filter((name) => name.endsWith('.tmp')) : [])

describe('pr-reply-draft', () => {
  it('checks the replies and writes the draft file into the Profile folder, with only the fields of the format', { timeout: ms(30_000) }, () => {
    reset(null)
    const run = write(replies([thread('PRRT_a', 'The loop stops after three tries.', { label: 'needs code change', fixPlan: 'Cap it at three in src/cart.ts.' }), conversation('Thanks, renamed.', { threadId: null, replyTo: null })]))
    expect(run.status, run.stdout + run.stderr).toBe(0)
    expect(run.stdout).toBe(`review-draft-lint: clean (2 replies)\npr-reply-draft: wrote ${file}: 2 new, 0 kept as edited, 0 discarded\n`)
    expect(saved()).toEqual(
      replies([
        thread('PRRT_a', 'The loop stops after three tries.', { label: 'needs code change', fixPlan: 'Cap it at three in src/cart.ts.' }),
        { kind: 'conversation', label: 'FYI', body: 'Thanks, renamed.', fixPlan: null, state: 'draft', sentUrl: null },
      ]),
    )
    expect(leftovers()).toEqual([])
  })

  it('writes nothing on a finding of review-draft-lint, names the item by its place in stdin, and leaves an earlier file as it was', { timeout: ms(30_000) }, () => {
    const before = replies([thread('PRRT_a', 'Earlier draft.')])
    reset(before)
    const run = write(replies([thread('PRRT_a', 'Fine.'), thread('PRRT_b', 'Fixed, see checkout-flow/05.')]))
    expect(run.status, run.stdout + run.stderr).toBe(1)
    expect(run.stdout).toBe('items[1]: epic/NN "checkout-flow/05"\n')
    expect(run.stderr).toContain('nothing written')
    expect(saved()).toEqual(before)
    expect(leftovers()).toEqual([])
  })

  it('checks with the limits of the team reviewer when the project has one built', { timeout: ms(30_000) }, () => {
    reset(null)
    const rules = join(harnessHome, 'projects', 'fp', 'state', 'human-review', 'lint.json')
    mkdirSync(join(rules, '..'), { recursive: true })
    writeFileSync(rules, JSON.stringify({ schema: 1, tiers: { nit: { max_chars: 20 } }, forbidden: ['blammo'] }))
    try {
      const long = write(replies([thread('PRRT_a', 'This reply is longer than twenty characters.')]))
      expect(long.status, long.stdout + long.stderr).toBe(1)
      expect(long.stdout).toBe('items[0]: length 44 chars, over 20 of a reply\n')
      const word = write(replies([thread('PRRT_a', 'Blammo, fine.')]))
      expect(word.status, word.stdout + word.stderr).toBe(1)
      expect(existsSync(file)).toBe(false)
    } finally {
      removeTestTree(join(rules, '..'))
    }
    expect(write(replies([thread('PRRT_a', 'This reply is longer than twenty characters.')])).status).toBe(0)
  })

  it('keeps sent and discarded replies, keeps an edited draft of a thread that still waits and drops the new one, replaces the other drafts, and discards those of threads that no longer wait', { timeout: ms(30_000) }, () => {
    reset(
      replies(
        [
          thread('PRRT_sent', 'Posted reply.', { state: 'sent', sentUrl: 'https://example.invalid/r/1' }),
          thread('PRRT_gone', 'Dropped by the person.', { state: 'discarded' }),
          thread('PRRT_edit', 'The person wrote this.', { edited: true }),
          thread('PRRT_plain', 'Old model draft.'),
          thread('PRRT_done', 'Draft of a thread that was answered since.'),
          thread('PRRT_editdone', 'Edited draft of a thread that was resolved since.', { edited: true }),
          conversation('Edited conversation reply.', { edited: true }),
          conversation('Old conversation draft.', { error: 'HTTP 502' }),
        ],
        { headOid: 'aaaaaaa' },
      ),
    )
    const run = write(replies([thread('PRRT_edit', 'New model text for the edited thread.'), thread('PRRT_plain', 'New model draft.'), conversation('New conversation draft.')]))
    expect(run.status, run.stdout + run.stderr).toBe(0)
    expect(run.stdout).toContain(': 2 new, 2 kept as edited, 2 discarded\n')
    const after = saved()
    expect(after.headOid).toBe('0123abc4def5')
    expect(after.items).toEqual([
      thread('PRRT_sent', 'Posted reply.', { state: 'sent', sentUrl: 'https://example.invalid/r/1' }),
      thread('PRRT_gone', 'Dropped by the person.', { state: 'discarded' }),
      thread('PRRT_edit', 'The person wrote this.', { edited: true }),
      thread('PRRT_done', 'Draft of a thread that was answered since.', { state: 'discarded' }),
      thread('PRRT_editdone', 'Edited draft of a thread that was resolved since.', { edited: true, state: 'discarded' }),
      conversation('Edited conversation reply.', { edited: true }),
      thread('PRRT_plain', 'New model draft.'),
      { kind: 'conversation', label: 'FYI', body: 'New conversation draft.', fixPlan: null, state: 'draft', sentUrl: null },
    ])
  })

  it('nothing waits: marks the drafts of an earlier file discarded, keeps sent ones, and writes no file when there is none', { timeout: ms(30_000) }, () => {
    reset(null)
    const none = write(replies([]))
    expect(none.status, none.stdout + none.stderr).toBe(0)
    expect(none.stdout).toBe('review-draft-lint: clean (0 replies)\npr-reply-draft: nothing waits and there is no draft file: nothing written\n')
    expect(existsSync(file)).toBe(false)

    reset(replies([thread('PRRT_a', 'Old draft.'), thread('PRRT_b', 'Edited.', { edited: true }), conversation('Sent.', { state: 'sent', sentUrl: 'https://example.invalid/c/1' })]))
    const run = write(replies([]))
    expect(run.status, run.stdout + run.stderr).toBe(0)
    expect(run.stdout).toContain(': 0 new, 0 kept as edited, 2 discarded\n')
    expect(saved().items.map((item) => item.state)).toEqual(['discarded', 'discarded', 'sent'])
  })

  it.each([
    ['a reply already sent', replies([thread('PRRT_a', 'Fine.', { state: 'sent' })])],
    ['a reply marked edited', replies([thread('PRRT_a', 'Fine.', { edited: true })])],
    ['a reply with a sentUrl', replies([thread('PRRT_a', 'Fine.', { sentUrl: 'https://example.invalid/r/1' })])],
    ['a reply with an error', replies([thread('PRRT_a', 'Fine.', { error: 'HTTP 502' })])],
    ['no items', { schema: 1, repo: 'example-org/app', pr: 118, headOid: '0123abc4def5' }],
    ['a malformed repo', replies([], { repo: 'example-org' })],
    ['a missing headOid', replies([], { headOid: undefined })],
    ['an unknown field', replies([thread('PRRT_a', 'Fine.', { tier: 'nit' })])],
    ['text that is no JSON', 'not json'],
  ])('gives exit 2 for stdin with %s and writes nothing', { timeout: ms(30_000) }, (_what, input) => {
    reset(null)
    const run = write(input)
    expect(run.status, run.stdout + run.stderr).toBe(2)
    expect(existsSync(file)).toBe(false)
  })

  it.each([
    ['not JSON', '{ broken'],
    ['no draft of replies', { items: [{ state: 'pending' }] }],
    ['of another pull request', replies([], { pr: 119 })],
  ])('gives exit 2 and leaves the draft file as it is when it is %s', { timeout: ms(30_000) }, (_what, content) => {
    reset(content)
    const before = readFileSync(file, 'utf8')
    const run = write(replies([thread('PRRT_a', 'Fine.')]))
    expect(run.status, run.stdout + run.stderr).toBe(2)
    expect(run.stderr).toMatch(/^pr-reply-draft: the draft file .* nothing written\n$/)
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('finds the project by -C, refuses a folder of no registered project, and refuses unknown arguments', { timeout: ms(30_000) }, () => {
    reset(null)
    const away = write(replies([thread('PRRT_a', 'Fine.')]), [], outside)
    expect(away.status, away.stdout + away.stderr).toBe(2)
    expect(away.stderr).toContain('is not a registered project')
    const byC = write(replies([thread('PRRT_a', 'Fine.')]), ['-C', repo], outside)
    expect(byC.status, byC.stdout + byC.stderr).toBe(0)
    expect(existsSync(file)).toBe(true)
    expect(write(replies([]), ['--force']).status).toBe(2)
    expect(write(replies([]), ['-C']).status).toBe(2)
  })
})

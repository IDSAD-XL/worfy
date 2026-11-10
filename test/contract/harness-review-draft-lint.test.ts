// The check of a review draft (harness/bin/review-draft-lint, Epic worfy-human-review, ticket 04): the
// length of each comment by its tier, the traces of the workflow in any mode of the project, the lines of
// AI authorship, personal data through lib/privacy.cjs (masked in the output) and the words of
// lint.json.forbidden; and --skill, the check that every rule of a generated SKILL.md points at a section
// of research.md. Every run gets a temporary HARNESS_HOME, HOME and project; the texts are invented.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const CLI = join(process.cwd(), 'harness', 'bin', 'review-draft-lint')

let root: string
let home: string
let harnessHome: string
/** The repository of the Full project `fp` (attribution on), with the epic checkout-flow in its tickets root. */
let repo: string
/** A folder that is in no registered project. */
let outside: string
/** The repository of the Silent project `sp` (attribution off) and its Workflow folder, whose path names a host. */
let silentRepo: string
let workflowFolder: string

// A home folder path with a user name, a host name and an email address that are not stand-ins (lib/privacy.cjs),
// built here so this file does not carry one.
const HOME_PATH = ['', 'Users', 'jdoe', 'proj', 'a.ts'].join('/')
const HOST = ['jdoe', 'MacBook', 'Pro'].join('-')
const EMAIL = ['jdoe', 'corp.io'].join('@')

beforeAll(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'review-draft-lint-')))
  home = join(root, 'home')
  harnessHome = join(root, 'hh')
  repo = join(root, 'repo')
  outside = join(root, 'outside')
  silentRepo = join(root, 'silent-repo')
  workflowFolder = join(root, HOST, 'wf')
  for (const dir of [
    home,
    join(harnessHome, 'gate'),
    join(harnessHome, 'projects', 'fp'),
    join(harnessHome, 'projects', 'sp'),
    join(repo, '.scratch', 'checkout-flow', 'issues'),
    join(workflowFolder, '.scratch', 'billing-sync', 'issues'),
    silentRepo,
    outside,
  ])
    mkdirSync(dir, { recursive: true })
  for (const dir of [repo, silentRepo, workflowFolder]) {
    const init = spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' })
    expect(init.status, init.stderr).toBe(0)
  }
  const entry = (key: string, match: string): object => ({ key, match, profile: key, pm: 'npm', root: {}, workspace: {} })
  writeFileSync(join(harnessHome, 'gate', 'config.json'), JSON.stringify({ repos: [entry('fp', repo), entry('sp', silentRepo)] }))
  writeFileSync(
    join(harnessHome, 'projects', 'fp', 'profile.json'),
    JSON.stringify({ schema: 2, name: 'fp', mode: 'full', attribution: 'on', tickets: { root: '.scratch/' } }),
  )
  writeFileSync(
    join(harnessHome, 'projects', 'sp', 'profile.json'),
    JSON.stringify({
      schema: 2,
      name: 'sp',
      mode: 'silent',
      attribution: 'off',
      workflow: { folder: workflowFolder, finish: 'local-green' },
      tickets: { root: '.scratch/', path: '.scratch/<epic>/issues/NN-*.md', branch: null },
      docs: { adr_dir: 'docs/adr', handoff: { path: 'HANDOFF.md' } },
      numbering: { adr: { dir: 'docs/adr', check: null }, migrations: null },
    }),
  )
})

afterAll(() => {
  removeTestTree(root)
})

interface Run {
  status: number | null
  stdout: string
  stderr: string
}

function lint(args: string[], cwd = repo): Run {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, HARNESS_HOME: harnessHome, EVAL_HARNESS_HOME: '' }
  // The gate runs the tests with CLAUDE_GATE_CONFIG naming the registry of this machine; the scripts would read
  // that one instead of the temporary HARNESS_HOME.
  for (const name of ['CLAUDE_GATE_CONFIG', 'CLAUDE_GATE_RESOLVE', 'CLAUDE_PROFILES_DIR', 'CLAUDE_PROFILE_BIN', 'CLAUDE_TICKET_BIN']) delete env[name]
  const run = spawnSync(scriptNode(), [CLI, ...args], { cwd, encoding: 'utf8', env })
  return { status: run.status, stdout: run.stdout, stderr: run.stderr }
}

let n = 0
/** Writes `content` (an object as JSON, a string as is) into a new file of the temporary folder. */
function file(content: unknown, name = 'draft.json'): string {
  const dir = join(root, `f${++n}`)
  mkdirSync(dir)
  const path = join(dir, name)
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
  return path
}

const RULES = { schema: 1, tiers: { nit: { max_chars: 120 }, argued: { max_chars: 1200 }, approve: { max_chars: 400 } }, forbidden: ['blammo'] }

interface Comment {
  path: string
  line: number
  side: string
  body: string
}

function draft(comments: Array<[string, string]>, body = 'Looks good overall, a few small notes.'): object {
  const list: Comment[] = comments.map(([, text], i) => ({ path: 'src/cart.ts', line: 10 + i, side: 'RIGHT', body: text }))
  return { payload: { event: 'COMMENT', body, comments: list }, tiers: comments.map(([tier]) => tier), body_tier: 'approve' }
}

const CLEAN = draft([
  ['nit', 'nit: this name reads better as `total`'],
  ['argued', 'The retry here runs without a limit; when the server is down the loop never ends. A cap of three attempts would match the other calls.'],
])

describe('review-draft-lint', () => {
  it('finds the traces of the workflow in a Full project with attribution on', { timeout: ms(30_000) }, () => {
    const rules = file(RULES, 'lint.json')
    const run = lint([file(draft([['nit', 'nit: see checkout-flow/05 for the reason']])), '--rules', rules, '-C', repo])
    expect(run.status, run.stdout + run.stderr).toBe(1)
    expect(run.stdout).toContain('epic/NN "checkout-flow/05"')
    const handoff = lint([file(draft([['nit', 'nit: noted in HANDOFF']])), '--rules', rules, '-C', repo])
    expect(handoff.status, handoff.stdout + handoff.stderr).toBe(1)
    expect(handoff.stdout).toContain('HANDOFF')
  })

  it('passes a clean draft with exit 0', { timeout: ms(30_000) }, () => {
    const run = lint([file(CLEAN), '--rules', file(RULES, 'lint.json'), '-C', repo])
    expect(run.status, run.stdout + run.stderr).toBe(0)
  })

  it('gives one finding for each of five problems, exit 1, and never prints the personal value whole', { timeout: ms(30_000) }, () => {
    const long = 'nit: ' + 'this helper could take the list it already has instead of building a new one '.repeat(2)
    const run = lint([
      file(
        draft([
          ['nit', long],
          ['argued', 'The notes for this are in .scratch/notes.md and explain the order of the calls.'],
          ['argued', 'Moved the check up.\n\nCo-Authored-By: Claude <noreply@anthropic.com>'],
          ['argued', `The fixture path ${HOME_PATH} should come from the test folder.`],
          ['argued', 'This blammo of a function wants splitting in two.'],
        ]),
      ),
      '--rules',
      file(RULES, 'lint.json'),
      '-C',
      repo,
    ])
    expect(run.status, run.stdout + run.stderr).toBe(1)
    const lines = run.stdout.trim().split('\n')
    expect(lines, run.stdout).toHaveLength(5)
    expect(lines[0]).toMatch(/^comments\[0\] src\/cart\.ts:10: length \d+ chars, over 120 of tier nit$/)
    expect(lines[1]).toContain('comments[1] src/cart.ts:11: .scratch ".scratch"')
    expect(lines[2]).toContain('comments[2] src/cart.ts:12: Claude attribution "Co-Authored-By: Claude"')
    expect(lines[3]).toContain('comments[3] src/cart.ts:13: personal data home-path "jd…(4)"')
    expect(lines[4]).toContain('comments[4] src/cart.ts:14: forbidden "blammo"')
    expect(run.stdout + run.stderr).not.toContain('jdoe')
  })

  it('checks the body of the review by its tier, and the AI voice', { timeout: ms(30_000) }, () => {
    const run = lint([file(draft([], 'As an AI, I think this is fine.')), '--rules', file(RULES, 'lint.json')], outside)
    expect(run.status, run.stdout + run.stderr).toBe(1)
    expect(run.stdout).toContain('body: AI authorship "As an AI"')
    const tooLong = lint([file(draft([], 'Fine. '.repeat(80))), '--rules', file(RULES, 'lint.json')], outside)
    expect(tooLong.status, tooLong.stdout + tooLong.stderr).toBe(1)
    expect(tooLong.stdout).toMatch(/^body: length \d+ chars, over 400 of tier approve$/m)
  })

  it('outside a registered project still checks the rules that need no project', { timeout: ms(30_000) }, () => {
    const run = lint([file(draft([['nit', 'nit: Ticket 7 has the details']])), '--rules', file(RULES, 'lint.json')], outside)
    expect(run.status, run.stdout + run.stderr).toBe(1)
    expect(run.stdout).toContain('ticket number "Ticket 7"')
    expect(run.stderr).toContain('not a registered project')
  })

  it('gives exit 2 on broken input: JSON, an unknown field of lint.json, a tier lint.json does not name', { timeout: ms(30_000) }, () => {
    const rules = file(RULES, 'lint.json')
    const broken = lint([file('{ "payload": '), '--rules', rules], outside)
    expect(broken.status, broken.stdout + broken.stderr).toBe(2)
    const unknown = lint([file(CLEAN), '--rules', file({ ...RULES, maxLength: 3 }, 'lint.json')], outside)
    expect(unknown.status, unknown.stdout + unknown.stderr).toBe(2)
    expect(unknown.stderr).toContain('maxLength')
    const nested = lint([file(CLEAN), '--rules', file({ ...RULES, tiers: { nit: { max_chars: 9, min_chars: 1 } } }, 'lint.json')], outside)
    expect(nested.status, nested.stdout + nested.stderr).toBe(2)
    expect(nested.stderr).toContain('tiers.nit.min_chars')
    const tier = lint([file(draft([['blocker', 'This drops the data of the user.']])), '--rules', rules], outside)
    expect(tier.status, tier.stdout + tier.stderr).toBe(2)
    expect(tier.stderr).toContain('blocker')
    const count = lint([file({ ...CLEAN, tiers: ['nit'] }), '--rules', rules], outside)
    expect(count.status, count.stdout + count.stderr).toBe(2)
    const noRules = lint([file(CLEAN)], outside)
    expect(noRules.status, noRules.stdout + noRules.stderr).toBe(2)
  })

  it('finds every kind of trace and AI authorship line, each by its rule', { timeout: ms(30_000) }, () => {
    const run = lint([
      file(
        draft([
          ['nit', 'nit: see ADR-0012 for why'],
          ['nit', 'nit: this belongs to checkout-flow'],
          ['argued', 'Moved the check up.\n\nGenerated with [Claude Code](https://claude.com/claude-code)'],
        ]),
      ),
      '--rules',
      file(RULES, 'lint.json'),
      '-C',
      repo,
    ])
    expect(run.status, run.stdout + run.stderr).toBe(1)
    expect(run.stdout.trim().split('\n')).toEqual([
      'comments[0] src/cart.ts:10: ADR number "ADR-0012"',
      'comments[1] src/cart.ts:11: epic name "checkout-flow"',
      'comments[2] src/cart.ts:12: Claude attribution "Generated with [Claude Code"',
    ])
  })

  it('finds the Workflow folder of a Silent project, and masks the host name in that trace', { timeout: ms(30_000) }, () => {
    const run = lint([file(draft([['argued', `The notes are in ${workflowFolder}/notes.md, see billing-sync/03.`]])), '--rules', file(RULES, 'lint.json'), '-C', silentRepo])
    expect(run.status, run.stdout + run.stderr).toBe(1)
    const lines = run.stdout.trim().split('\n')
    expect(lines.filter((l) => l.includes(': Workflow folder path "')), run.stdout).toHaveLength(1)
    expect(lines.filter((l) => l.includes(': epic/NN "billing-sync/03"')), run.stdout).toHaveLength(1)
    expect(lines.filter((l) => l.includes(': personal data host "jd…(16)"')), run.stdout).toHaveLength(1)
    expect(run.stdout + run.stderr).not.toContain(HOST)
  })

  it('masks personal data in the error lines of exit 2', { timeout: ms(30_000) }, () => {
    const run = lint([file(CLEAN), '--rules', file({ ...RULES, [EMAIL]: 1 }, 'lint.json')], outside)
    expect(run.status, run.stdout + run.stderr).toBe(2)
    expect(run.stderr).toContain('unknown field "jd…(12)"')
    expect(run.stdout + run.stderr).not.toContain(EMAIL)
    const tier = lint([file(draft([[EMAIL, 'nit: fine']])), '--rules', file(RULES, 'lint.json')], outside)
    expect(tier.status, tier.stdout + tier.stderr).toBe(2)
    expect(tier.stdout + tier.stderr).not.toContain(EMAIL)
  })

  it('reads a draft and lint.json that start with a UTF-8 byte order mark', { timeout: ms(30_000) }, () => {
    const bom = '\uFEFF'
    const run = lint([file(bom + JSON.stringify(CLEAN)), '--rules', file(bom + JSON.stringify(RULES), 'lint.json')], outside)
    expect(run.status, run.stdout + run.stderr).toBe(0)
  })

  it('counts the length in characters, not in UTF-16 code units', { timeout: ms(30_000) }, () => {
    // 105 characters, 205 code units: under the nit limit of 120.
    const run = lint([file(draft([['nit', 'nit: ' + '\u{1F600}'.repeat(100)]])), '--rules', file(RULES, 'lint.json')], outside)
    expect(run.status, run.stdout + run.stderr).toBe(0)
    const over = lint([file(draft([['nit', 'nit: ' + '\u{1F600}'.repeat(116)]])), '--rules', file(RULES, 'lint.json')], outside)
    expect(over.status, over.stdout + over.stderr).toBe(1)
    expect(over.stdout).toContain('length 121 chars, over 120 of tier nit')
  })

  // --reply (below) must leave the review mode as it was: the clean line, and a comment with an empty body, which a
  // review lets through (only a reply's empty body is a finding).
  it('the review mode still passes an empty comment and says how many texts it read', { timeout: ms(30_000) }, () => {
    const run = lint([file(draft([['nit', '']], '')), '--rules', file(RULES, 'lint.json')], outside)
    expect(run.status, run.stdout + run.stderr).toBe(0)
    expect(run.stdout).toBe('review-draft-lint: clean (1 texts)\n')
    const two = lint([file(CLEAN), '--rules', file(RULES, 'lint.json'), '-C', repo])
    expect(two.stdout).toBe('review-draft-lint: clean (3 texts)\n')
  })

  // The draft of replies of /worfy:pr-reply (worfy-pr-inbox ticket 04): `<Profile folder>/state/pr-inbox/drafts/
  // <owner>-<repo>-<N>.json`, one item per reply, the same rules as a review, one length limit for every reply.
  describe('--reply', () => {
    type Item = Record<string, unknown>
    const thread = (body: string, more: Item = {}): Item => ({ kind: 'thread', threadId: 'PRRT_kwDOAbc1', replyTo: 4211, label: 'needs answer', body, fixPlan: null, state: 'draft', sentUrl: null, ...more })
    const conversation = (body: string, more: Item = {}): Item => ({ kind: 'conversation', label: 'FYI', body, fixPlan: null, state: 'draft', sentUrl: null, ...more })
    const replies = (items: Item[], more: Item = {}): object => ({ schema: 1, repo: 'example-org/app', pr: 118, headOid: '0123abc4def5', items, ...more })
    const CLEAN_REPLIES = replies([
      thread('The retry stops after three attempts: the loop in `fetchCart` counts them.', { label: 'needs code change', fixPlan: 'Cap the loop in src/cart.ts at three attempts.' }),
      conversation('Thanks, the rename is in the latest push.'),
    ])

    it('passes a clean draft of replies with exit 0, without --rules', { timeout: ms(30_000) }, () => {
      const run = lint(['--reply', file(CLEAN_REPLIES), '-C', repo])
      expect(run.status, run.stdout + run.stderr).toBe(0)
      expect(run.stdout).toBe('review-draft-lint: clean (2 replies)\n')
    })

    it('names items[<i>] for a trace, an ADR number, an AI signature and personal data, exit 1', { timeout: ms(30_000) }, () => {
      const run = lint([
        '--reply',
        file(
          replies([
            thread('Fixed, see checkout-flow/05 for the reason.'),
            conversation('Done the way ADR-0012 says.'),
            thread('Moved the check up.\n\nCo-Authored-By: Claude <noreply@anthropic.com>'),
            thread(`The fixture path ${HOME_PATH} should come from the test folder.`),
            conversation('As an AI, I agree with the rename.'),
            thread('Clean one, in the middle of the list.'),
            thread('This blammo of a function wants splitting in two.'),
          ]),
        ),
        '--rules',
        file(RULES, 'lint.json'),
        '-C',
        repo,
      ])
      expect(run.status, run.stdout + run.stderr).toBe(1)
      expect(run.stdout.trim().split('\n')).toEqual([
        'items[0]: epic/NN "checkout-flow/05"',
        'items[1]: ADR number "ADR-0012"',
        'items[2]: Claude attribution "Co-Authored-By: Claude"',
        'items[3]: personal data home-path "jd…(4)"',
        'items[4]: AI authorship "As an AI"',
        'items[6]: forbidden "blammo"',
      ])
      expect(run.stdout + run.stderr).not.toContain('jdoe')
    })

    it('finds the Workflow folder and the epics of a Silent project', { timeout: ms(30_000) }, () => {
      const run = lint(['--reply', file(replies([thread(`The notes are in ${workflowFolder}/notes.md, see billing-sync/03.`)])), '-C', silentRepo])
      expect(run.status, run.stdout + run.stderr).toBe(1)
      const lines = run.stdout.trim().split('\n')
      expect(lines.filter((l) => l.startsWith('items[0]: Workflow folder path "')), run.stdout).toHaveLength(1)
      expect(lines.filter((l) => l === 'items[0]: epic/NN "billing-sync/03"'), run.stdout).toHaveLength(1)
      expect(run.stdout + run.stderr).not.toContain(HOST)
    })

    it('checks only the replies still in draft: a sent one and a discarded one are history', { timeout: ms(30_000) }, () => {
      const run = lint([
        '--reply',
        file(
          replies([
            thread('Fixed, see checkout-flow/05.', { state: 'sent', sentUrl: 'https://github.com/example-org/app/pull/118#discussion_r1' }),
            conversation('Done as ADR-0012 says.', { state: 'discarded' }),
            thread('Clean.'),
          ]),
        ),
        '-C',
        repo,
      ])
      expect(run.status, run.stdout + run.stderr).toBe(0)
      expect(run.stdout).toBe('review-draft-lint: clean (1 replies)\n')
      const draft = lint(['--reply', file(replies([thread('Fixed, see checkout-flow/05.')])), '-C', repo])
      expect(draft.status, draft.stdout + draft.stderr).toBe(1)
    })

    it('holds every reply to one length: 1200 characters by default, the largest tier of --rules with it', { timeout: ms(30_000) }, () => {
      const at = (chars: number): string => 'a'.repeat(chars - 1) + '\u{1F600}'
      expect(lint(['--reply', file(replies([thread(at(1200))])), '-C', outside], outside).status).toBe(0)
      const over = lint(['--reply', file(replies([conversation('x'), thread(at(1201))]))], outside)
      expect(over.status, over.stdout + over.stderr).toBe(1)
      expect(over.stdout).toBe('items[1]: length 1201 chars, over 1200 of a reply\n')
      const rules = file({ schema: 1, tiers: { nit: { max_chars: 120 }, argued: { max_chars: 300 } }, forbidden: [] }, 'lint.json')
      expect(lint(['--reply', file(replies([thread(at(300))])), '--rules', rules], outside).status).toBe(0)
      const overRules = lint(['--reply', file(replies([thread(at(301))])), '--rules', rules], outside)
      expect(overRules.status, overRules.stdout + overRules.stderr).toBe(1)
      expect(overRules.stdout).toBe('items[0]: length 301 chars, over 300 of a reply\n')
    })

    it('finds a reply in draft with an empty body', { timeout: ms(30_000) }, () => {
      const run = lint(['--reply', file(replies([thread('Fine.'), conversation(' \n ')]))], outside)
      expect(run.status, run.stdout + run.stderr).toBe(1)
      expect(run.stdout).toBe('items[1]: empty body\n')
      expect(lint(['--reply', file(replies([conversation('', { state: 'discarded' })]))], outside).status).toBe(0)
    })

    it.each<[string, unknown]>([
      ['not JSON', '{ "schema": 1,'],
      ['a list', []],
      ['schema 2', replies([], { schema: 2 })],
      ['a repo without an owner', replies([], { repo: 'app' })],
      ['a repo with a space', replies([], { repo: 'example-org/my app' })],
      ['pr 0', replies([], { pr: 0 })],
      ['pr as text', replies([], { pr: '118' })],
      ['no headOid', { schema: 1, repo: 'example-org/app', pr: 118, items: [] }],
      ['a headOid that is no sha', replies([], { headOid: 'main' })],
      ['items not a list', replies([], { items: {} })],
      ['an unknown field', replies([], { reviewers: [] })],
      ['an item that is no object', replies(['Fine.' as unknown as Item])],
      ['an unknown kind', replies([thread('Fine.', { kind: 'review' })])],
      ['a thread without threadId', replies([thread('Fine.', { threadId: undefined })])],
      ['a thread with an empty threadId', replies([thread('Fine.', { threadId: '' })])],
      ['a thread without replyTo', replies([thread('Fine.', { replyTo: undefined })])],
      ['a thread with replyTo as text', replies([thread('Fine.', { replyTo: '4211' })])],
      ['a thread with replyTo 0', replies([thread('Fine.', { replyTo: 0 })])],
      ['a conversation with a threadId', replies([conversation('Fine.', { threadId: 'PRRT_x' })])],
      ['a conversation with replyTo', replies([conversation('Fine.', { replyTo: 4211 })])],
      ['an unknown label', replies([thread('Fine.', { label: 'nit' })])],
      ['a body that is no text', replies([thread('Fine.', { body: 7 })])],
      ['a fixPlan that is no text', replies([thread('Fine.', { fixPlan: 7 })])],
      ['an unknown state', replies([thread('Fine.', { state: 'pending' })])],
      ['a sentUrl that is no text', replies([thread('Fine.', { sentUrl: 7 })])],
      ['an unknown field of an item', replies([thread('Fine.', { tier: 'nit' })])],
      ['a review draft', CLEAN],
    ])('gives exit 2 for a draft with %s, and names what is wrong', { timeout: ms(30_000) }, (_what, content) => {
      const run = lint(['--reply', file(content)], outside)
      expect(run.status, run.stdout + run.stderr).toBe(2)
      expect(run.stdout).toBe('')
      expect(run.stderr).toMatch(/^review-draft-lint: (the draft of replies|cannot read)/)
    })

    it('reads the optional edited mark of a reply the person changed, and refuses one that is no true or false', { timeout: ms(30_000) }, () => {
      expect(lint(['--reply', file(replies([thread('Fine.', { edited: true }), conversation('Fine.', { edited: false })]))], outside).status).toBe(0)
      const bad = lint(['--reply', file(replies([thread('Fine.', { edited: 'yes' })]))], outside)
      expect(bad.status, bad.stdout + bad.stderr).toBe(2)
      expect(bad.stderr).toContain('items[0] "edited" must be true or false')
    })

    it('reads the draft of replies from stdin with --reply -', { timeout: ms(30_000) }, () => {
      const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, HARNESS_HOME: harnessHome, EVAL_HARNESS_HOME: '' }
      for (const name of ['CLAUDE_GATE_CONFIG', 'CLAUDE_GATE_RESOLVE', 'CLAUDE_PROFILES_DIR', 'CLAUDE_PROFILE_BIN', 'CLAUDE_TICKET_BIN']) delete env[name]
      const run = spawnSync(scriptNode(), [CLI, '--reply', '-'], { cwd: outside, encoding: 'utf8', env, input: JSON.stringify(replies([thread('Fine.'), conversation('')])) })
      expect(run.status, run.stdout + run.stderr).toBe(1)
      expect(run.stdout).toBe('items[1]: empty body\n')
    })

    it('reads a conversation reply with threadId and replyTo given as null, and the optional error of a failed send', { timeout: ms(30_000) }, () => {
      const run = lint(['--reply', file(replies([conversation('Fine.', { threadId: null, replyTo: null, error: 'HTTP 502' }), thread('Fine.', { error: null })]))], outside)
      expect(run.status, run.stdout + run.stderr).toBe(0)
    })

    it('gives exit 2 for --reply beside a positional draft or --skill, and for broken lint.json', { timeout: ms(30_000) }, () => {
      const draft = file(CLEAN_REPLIES)
      expect(lint(['--reply', draft, draft], outside).status).toBe(2)
      expect(lint(['--reply', draft, '--skill', root], outside).status).toBe(2)
      expect(lint(['--reply'], outside).status).toBe(2)
      const unknown = lint(['--reply', draft, '--rules', file({ ...RULES, maxLength: 3 }, 'lint.json')], outside)
      expect(unknown.status, unknown.stdout + unknown.stderr).toBe(2)
      expect(unknown.stderr).toContain('maxLength')
    })
  })

  describe('--skill', () => {
    function skill(skillMd: string, research: string): string {
      const dir = join(root, `skill${++n}`)
      mkdirSync(dir)
      writeFileSync(join(dir, 'SKILL.md'), skillMd)
      writeFileSync(join(dir, 'research.md'), research)
      return dir
    }
    const RESEARCH = '# Research\n\n## R1 — Bumps go through without comments\n\nText.\n\n## R2 — Nits are one line\n\nText.\n'
    const FULL = [
      '---',
      'name: human-review',
      'description: Review a PR in the voice of the team.',
      '---',
      '',
      '# Human review',
      '',
      '## 2. Triage',
      '',
      '- Approve a dependency bump without comments. [R1]',
      '- A small change of a text needs no comment,',
      '  unless it changes a message the user sees. [R1]',
      '',
      '```text',
      '- an example line in a code block is not a rule',
      '```',
      '',
      '## 5. Voice by tier',
      '',
      '1. A nit is one line. [R2]',
      '   - It starts with `nit:`. [R2]',
      '',
    ].join('\n')

    it('passes a skill whose every rule points at a section of research.md', { timeout: ms(30_000) }, () => {
      const run = lint(['--skill', skill(FULL, RESEARCH)], outside)
      expect(run.status, run.stdout + run.stderr).toBe(0)
    })

    it('finds a rule without a reference and a reference to a missing section', { timeout: ms(30_000) }, () => {
      const broken = FULL.replace('without comments. [R1]', 'without comments.').replace('one line. [R2]', 'one line. [R7]')
      const run = lint(['--skill', skill(broken, RESEARCH)], outside)
      expect(run.status, run.stdout + run.stderr).toBe(1)
      const lines = run.stdout.trim().split('\n')
      expect(lines, run.stdout).toHaveLength(2)
      expect(lines[0]).toMatch(/^SKILL\.md:10: rule without a \[R<n>\] reference/)
      expect(lines[1]).toMatch(/^SKILL\.md:20: \[R7\] — no section "## R7 — …" in research\.md/)
    })

    it('gives exit 2 when SKILL.md or research.md is missing', { timeout: ms(30_000) }, () => {
      const dir = join(root, `skill${++n}`)
      mkdirSync(dir)
      writeFileSync(join(dir, 'SKILL.md'), FULL)
      const run = lint(['--skill', dir], outside)
      expect(run.status, run.stdout + run.stderr).toBe(2)
      expect(run.stderr).toContain('research.md')
    })

    // worfy-human-review 13: a left placeholder of the template is a finding, a `{{` in a quote of the team is not.
    describe('the placeholders of the template', () => {
      const GO_QUOTE = '- Keep table tests in one literal, as `cases := []tc{{name: "a"}}` reads. [R2]'
      const EXAMPLES = (body: string): string => `# Voice examples\n\n## nit\n\n${body}\n`

      it('finds a {{rules: …}} line of SKILL.md and a {{examples: …}} line of voice-examples.md left as the template wrote them', { timeout: ms(30_000) }, () => {
        const left = FULL.replace('## 5. Voice by tier\n', '## 5. Voice by tier\n\n{{rules: one per Voice section with comments}}\n')
        const dir = skill(left, RESEARCH)
        writeFileSync(join(dir, 'voice-examples.md'), EXAMPLES('{{examples: nit}}'))
        const run = lint(['--skill', dir], outside)
        expect(run.status, run.stdout + run.stderr).toBe(1)
        const lines = run.stdout.trim().split('\n')
        expect(lines, run.stdout).toHaveLength(2)
        expect(lines[0]).toMatch(/^SKILL\.md:20: placeholder of the template left: "\{\{rules: /)
        expect(lines[1]).toMatch(/^voice-examples\.md:5: placeholder of the template left: "\{\{examples: nit\}\}"/)
      })

      it('lets a {{ of a quoted Go composite literal through, in a rule, a code block and an example', { timeout: ms(30_000) }, () => {
        const quoted = FULL.replace('- Approve a dependency bump without comments. [R1]', `- Approve a dependency bump without comments. [R1]\n${GO_QUOTE}`).replace(
          '- an example line in a code block is not a rule',
          'm := map[string]int{{"a", 1}}',
        )
        const dir = skill(quoted, RESEARCH)
        writeFileSync(join(dir, 'voice-examples.md'), EXAMPLES('- [acme/shop#3](https://github.com/acme/shop/pull/3#discussion_r1) — reviewer A, 40 chars\n  > nit: `[]T{{Name: "x"}}` can drop the type'))
        const run = lint(['--skill', dir], outside)
        expect(run.status, run.stdout + run.stderr).toBe(0)
      })
    })

    // worfy-human-review 13: a link to a review or a comment is one raw/prs.jsonl holds, never one built by hand.
    describe('--prs: the links against raw/prs.jsonl', () => {
      const PR = 'https://github.com/acme/shop/pull/12'
      const PRS = [
        {
          repo: 'acme/shop',
          number: 12,
          url: PR,
          reviews: [{ id: 'PRR_1', url: `${PR}#pullrequestreview-901`, state: 'APPROVED', body: '', submitted_at: '2026-05-01T00:00:00Z' }],
          threads: [{ path: 'a.go', comments: [{ id: 'PRRC_1', url: `${PR}#discussion_r902`, body: 'nit: name' }] }],
          comments: [{ id: 'IC_1', url: `${PR}#issuecomment-903`, body: 'One question.' }],
        },
      ]
        .map((p) => JSON.stringify(p))
        .join('\n')
      const withLinks = (links: string[]): string =>
        `${RESEARCH}\n## R3 — Review states\n\nNumbers: 1 (analysis)\nComments: ${links.map((l, i) => `[${i + 1}](${l})`).join(', ')}.\n`

      it('passes links that are a url of the pull request, a review, a line or a conversation comment', { timeout: ms(30_000) }, () => {
        const dir = skill(FULL, withLinks([PR, `${PR}#pullrequestreview-901`, `${PR}#discussion_r902`, `${PR}#issuecomment-903`]))
        const run = lint(['--skill', dir, '--prs', file(PRS, 'prs.jsonl')], outside)
        expect(run.status, run.stdout + run.stderr).toBe(0)
      })

      it('refuses a link to a review that raw/prs.jsonl does not hold, in research.md and in voice-examples.md', { timeout: ms(30_000) }, () => {
        const dir = skill(FULL, withLinks([`${PR}#pullrequestreview-901`, `${PR}#pullrequestreview-PRR_1`]))
        writeFileSync(join(dir, 'voice-examples.md'), `# Voice examples\n\n## nit\n\n- [acme/shop#13](https://github.com/acme/shop/pull/13#discussion_r5) — reviewer A, 9 chars\n`)
        const run = lint(['--skill', dir, '--prs', file(PRS, 'prs.jsonl')], outside)
        expect(run.status, run.stdout + run.stderr).toBe(1)
        const lines = run.stdout.trim().split('\n')
        expect(lines, run.stdout).toHaveLength(2)
        expect(lines[0]).toBe(`research.md:14: link not in prs.jsonl: ${PR}#pullrequestreview-PRR_1`)
        expect(lines[1]).toBe('voice-examples.md:5: link not in prs.jsonl: https://github.com/acme/shop/pull/13#discussion_r5')
      })

      it('accepts with --known the links of the research.md of before, which an update keeps', { timeout: ms(30_000) }, () => {
        const old = 'https://github.com/acme/shop/pull/4#discussion_r40'
        const dir = skill(FULL, withLinks([`${PR}#discussion_r902`, old]))
        const run = lint(['--skill', dir, '--prs', file(PRS, 'prs.jsonl'), '--known', file(`## R1 — x\n\nComments: [1](${old})\n`, 'research-before.md')], outside)
        expect(run.status, run.stdout + run.stderr).toBe(0)
      })

      it('accepts a link that a comment of prs.jsonl quotes in its body, so a verbatim quote of it passes', { timeout: ms(30_000) }, () => {
        const quoted = 'https://github.com/other/repo/pull/5'
        const prs = PRS.replace('"body":"One question."', `"body":"Same bug as ${quoted}, see there."`)
        expect(prs).toContain(quoted)
        const dir = skill(FULL, RESEARCH)
        writeFileSync(join(dir, 'voice-examples.md'), `# Voice examples\n\n## heads-up\n\n- [acme/shop#12](${PR}#issuecomment-903) — reviewer A, 40 chars\n  > Same bug as ${quoted}, see there.\n`)
        const run = lint(['--skill', dir, '--prs', file(prs, 'prs.jsonl')], outside)
        expect(run.status, run.stdout + run.stderr).toBe(0)
      })

      it('gives exit 2 for a prs.jsonl that does not read as JSON lines', { timeout: ms(30_000) }, () => {
        const run = lint(['--skill', skill(FULL, RESEARCH), '--prs', file('{"repo": "acme/shop"\n', 'prs.jsonl')], outside)
        expect(run.status, run.stdout + run.stderr).toBe(2)
        expect(run.stderr).toContain('prs.jsonl')
      })
    })
  })
})

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

// A home folder path with a user name that is not a stand-in, built here so this file does not carry one.
const HOME_PATH = ['', 'Users', 'jdoe', 'proj', 'a.ts'].join('/')

beforeAll(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'review-draft-lint-')))
  home = join(root, 'home')
  harnessHome = join(root, 'hh')
  repo = join(root, 'repo')
  outside = join(root, 'outside')
  for (const dir of [home, join(harnessHome, 'gate'), join(harnessHome, 'projects', 'fp'), join(repo, '.scratch', 'checkout-flow', 'issues'), outside])
    mkdirSync(dir, { recursive: true })
  const init = spawnSync('git', ['init', '-q', repo], { encoding: 'utf8' })
  expect(init.status, init.stderr).toBe(0)
  writeFileSync(join(harnessHome, 'gate', 'config.json'), JSON.stringify({ repos: [{ key: 'fp', match: repo, profile: 'fp', pm: 'npm', root: {}, workspace: {} }] }))
  writeFileSync(
    join(harnessHome, 'projects', 'fp', 'profile.json'),
    JSON.stringify({ schema: 2, name: 'fp', mode: 'full', attribution: 'on', tickets: { root: '.scratch/' } }),
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
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    HARNESS_HOME: harnessHome,
    EVAL_HARNESS_HOME: '',
    CLAUDE_PROFILE_BIN: '',
    CLAUDE_TICKET_BIN: '',
  }
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
  })
})

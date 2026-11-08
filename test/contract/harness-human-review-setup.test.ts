// The generator skill /worfy:human-review-setup (Epic worfy-human-review, ticket 06): the order of its steps read
// from the text of harness/skills/human-review-setup/SKILL.md — the script's estimate before any reading of raw/ by
// the model, an explicit "yes", "no" deletes raw/, the short-history branch writes only meta.json — and the format
// of research.md that analyse.md describes, run through `review-draft-lint --skill` on a fixture built from it.
// No model runs and nothing reads GitHub here; every run of the lint gets a temporary HOME and Harness home.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const DIR = join(process.cwd(), 'harness', 'skills', 'human-review-setup')
const LINT = join(process.cwd(), 'harness', 'bin', 'review-draft-lint')
const COVERAGE = join(process.cwd(), 'harness', 'evals', 'lib', 'coverage.json')
const PRIVACY = join(process.cwd(), 'harness', 'lib', 'privacy.cjs')

const read = (name: string): string => readFileSync(join(DIR, name), 'utf8').replace(/\r\n/g, '\n')
const skill = read('SKILL.md')
const analyse = read('analyse.md')

/** The text of the step `## <n>. …` of SKILL.md, up to the next `## ` heading. */
function step(n: number): string {
  const start = skill.search(new RegExp(`^## ${n}\\. `, 'm'))
  expect(start, `no step "## ${n}. " in SKILL.md`).toBeGreaterThan(-1)
  const rest = skill.slice(start + 1)
  const end = rest.search(/^## /m)
  return end === -1 ? skill.slice(start) : skill.slice(start, start + 1 + end)
}

/** The paragraphs and list items of a text, each joined into one line. */
const blocks = (text: string): string[] =>
  text
    .split(/\n(?=\s*\n)|\n(?=\s*(?:[-*]|\d+\.)\s)/)
    .map((b) => b.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

/** The research.md skeleton of analyse.md: the first fenced `markdown` block. */
function skeleton(): string {
  const m = /^```markdown\n([\s\S]*?)^```$/m.exec(analyse)
  expect(m, 'no ```markdown block in analyse.md').not.toBeNull()
  return m?.[1] ?? ''
}

const TIERS = ['let go', 'nit', 'question', 'heads-up', 'followup', 'argued', 'blocker']

describe('SKILL.md of /worfy:human-review-setup', () => {
  it('is called by hand only, under its own name', () => {
    const front = /^---\n([\s\S]*?)\n---\n/.exec(skill)
    expect(front).not.toBeNull()
    expect(front![1]).toMatch(/^name: human-review-setup$/m)
    expect(front![1]).toMatch(/^disable-model-invocation: true$/m)
  })

  it('has steps 1 to 7 in order', () => {
    const at = [1, 2, 3, 4, 5, 6, 7].map((n) => skill.search(new RegExp(`^## ${n}\\. `, 'm')))
    expect(at.every((i) => i > -1), JSON.stringify(at)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
  })

  it('takes the private folder from the profile and points to /worfy:connect-project without one', () => {
    const one = step(1)
    expect(one).toContain('bin/profile" --json')
    expect(one).toContain('_resolved.dir')
    expect(one).toContain('state/human-review/')
    expect(one).toContain('/worfy:connect-project')
  })

  it('runs review-history estimate before any reading of raw/ by the model, and waits for an explicit "yes"', () => {
    const fetch = skill.indexOf('review-history" fetch')
    const estimate = skill.indexOf('review-history" estimate')
    const yes = skill.indexOf('explicit "yes"')
    expect(fetch, 'fetch').toBeGreaterThan(-1)
    expect(estimate, 'estimate').toBeGreaterThan(fetch)
    expect(yes, 'explicit "yes"').toBeGreaterThan(estimate)
    // What the model reads: the comments themselves (prs.jsonl) and the analysis that reads them.
    for (const reading of ['prs.jsonl', 'analyse.md']) {
      const first = skill.indexOf(reading)
      expect(first, reading).toBeGreaterThan(yes)
    }
    // The step itself forbids the model to open raw/ before the answer.
    expect(blocks(step(2)).some((b) => /do not (open|read)[^.]*raw\//i.test(b) && /before/i.test(b))).toBe(true)
  })

  it('says the texts go to the model vendor and shows ignore.json before the question', () => {
    const two = step(2)
    expect(two).toContain('ignore.json')
    expect(two).toMatch(/vendor/i)
    expect(two.indexOf('ignore.json')).toBeLessThan(two.indexOf('explicit "yes"'))
  })

  it('answers anything but "yes" with review-history clean and a stop', () => {
    const no = blocks(step(2)).filter((b) => /"no"/.test(b))
    expect(no.length, step(2)).toBeGreaterThan(0)
    expect(no.some((b) => b.includes('review-history" clean') && /stop/i.test(b)), no.join('\n')).toBe(true)
  })

  it('in the short-history branch writes only meta.json, names "N of 30" and offers /worfy:code-review', () => {
    const three = step(3)
    expect(three).toContain('voice: no (N of 30)')
    expect(three).toContain('N of 30')
    expect(three).toContain('/worfy:code-review')
    expect(three).toContain('review-history" clean')
    expect(blocks(three).some((b) => /only `meta\.json`/.test(b))).toBe(true)
    // The branch never reaches the analysis.
    expect(three).not.toContain('analyse.md')
    expect(three).not.toContain('prs.jsonl')
  })

  it('says so when one reviewer gives 80% or more of the comments', () => {
    expect(skill).toContain('top_share')
    expect(skill).toMatch(/80%/)
  })

  it('holds 5 pull requests out of the analysis and records them in meta.json before step 4', () => {
    const hold = skill.indexOf('held_out')
    expect(hold).toBeGreaterThan(skill.indexOf('explicit "yes"'))
    expect(hold).toBeLessThan(skill.search(/^## 4\. /m))
    expect(skill).toContain('CHANGES_REQUESTED')
    expect(skill).toContain('meta.json')
  })

  it('sends step 4 to analyse.md and marks steps 5 and 6 as not available yet', () => {
    expect(step(4)).toContain('${CLAUDE_PLUGIN_ROOT}/skills/human-review-setup/analyse.md')
    expect(step(5)).toContain('Not available yet: worfy-human-review 07')
    expect(step(6)).toContain('Not available yet: worfy-human-review 08')
  })

  it('in step 7: keep deletes raw/, refuse deletes the private folder', () => {
    const seven = step(7)
    expect(seven).toContain('review-history" clean')
    expect(seven).toMatch(/Refuse/)
    expect(seven).toContain('state/human-review')
  })

  it('says it works in Claude Code sessions only', () => {
    expect(skill).toMatch(/Claude Code/)
    expect(skill).toMatch(/Codex/)
  })
})

describe('analyse.md', () => {
  it('names the seven tiers', () => {
    for (const tier of TIERS) expect(analyse, tier).toContain(`**${tier}**`)
  })

  it('names the signals that a reviewer insisted', () => {
    for (const signal of ['CHANGES_REQUESTED', 'is_resolved', 'is_outdated', 'repeated_remarks']) expect(analyse, signal).toContain(signal)
  })

  it('batches raw/ by area of code and skips the held-out pull requests', () => {
    expect(analyse).toMatch(/Subagent/)
    expect(analyse).toMatch(/top-level folder/)
    expect(analyse).toContain('held_out')
    expect(analyse).toContain('review-history" stats')
  })

  it('has the required sections of research.md in its skeleton', () => {
    const s = skeleton()
    for (const title of [
      'Triage: approved without comments',
      'Triage: small is not safe',
      'Triage: requests to split a pull request',
      'Review states',
      'Theme:',
      'Do not touch:',
      'Voice:',
    ])
      expect(s, title).toMatch(new RegExp(`^## R\\d+ — ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm'))
    for (const tier of TIERS) expect(s, tier).toMatch(new RegExp(`^## R\\d+ — Voice: ${tier}$`, 'm'))
  })

  it('labels reviewers "reviewer A" and keeps logins out', () => {
    expect(analyse).toContain('reviewer A')
    expect(analyse).toMatch(/no login/i)
  })
})

describe('the research.md format against review-draft-lint --skill', () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'human-review-setup-')))
  afterAll(() => removeTestTree(root))

  function lint(dir: string): { status: number | null; out: string } {
    const home = join(root, 'home')
    const harnessHome = join(root, 'hh')
    mkdirSync(home, { recursive: true })
    mkdirSync(harnessHome, { recursive: true })
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, HARNESS_HOME: harnessHome, EVAL_HARNESS_HOME: '' }
    for (const name of ['CLAUDE_GATE_CONFIG', 'CLAUDE_GATE_RESOLVE', 'CLAUDE_PROFILES_DIR', 'CLAUDE_PROFILE_BIN', 'CLAUDE_TICKET_BIN']) delete env[name]
    const run = spawnSync(scriptNode(), [LINT, '--skill', dir], { cwd: root, encoding: 'utf8', env })
    return { status: run.status, out: run.stdout + run.stderr }
  }

  it('every heading of the skeleton is a section the lint finds', { timeout: ms(30_000) }, () => {
    const s = skeleton()
    const numbers = [...s.matchAll(/^## R(\d+) — /gm)].map((m) => Number(m[1]))
    expect(numbers.length).toBeGreaterThanOrEqual(7)
    // Numbered from R1 with no gap.
    expect(numbers).toEqual(numbers.map((_, i) => i + 1))
    const dir = join(root, 'skill')
    mkdirSync(dir)
    writeFileSync(join(dir, 'research.md'), s)
    const rules = numbers.map((n) => `- A rule drawn from section ${n}. [R${n}]`)
    writeFileSync(join(dir, 'SKILL.md'), ['---', 'name: human-review', 'description: Fixture.', '---', '', '## 2. Triage', '', ...rules, ''].join('\n'))
    const ok = lint(dir)
    expect(ok.status, ok.out).toBe(0)
    // And a reference past the last section is a finding: the lint really reads the skeleton's headings.
    writeFileSync(join(dir, 'SKILL.md'), ['## 2. Triage', '', `- A rule. [R${numbers.length + 1}]`, ''].join('\n'))
    const bad = lint(dir)
    expect(bad.status, bad.out).toBe(1)
  })
})

describe('the text of the skill', () => {
  const privacy = createRequire(__filename)(PRIVACY) as { findings: (text: string) => { rule: string }[] }

  it.each(['SKILL.md', 'analyse.md'])('%s carries no personal data and no @login', (name) => {
    const text = read(name)
    expect(privacy.findings(text).map((f) => f.rule)).toEqual([])
    expect(text.match(/(^|[\s(])@[A-Za-z0-9][A-Za-z0-9-]*/g) ?? []).toEqual([])
  })

  it('both files are in the uncovered list of the eval coverage map', () => {
    const map = JSON.parse(readFileSync(COVERAGE, 'utf8')) as { uncovered: Record<string, string> }
    for (const file of ['skills/human-review-setup/SKILL.md', 'skills/human-review-setup/analyse.md'])
      expect(map.uncovered[file], file).toBe('No case yet: worfy-human-review 12 adds cases')
  })
})

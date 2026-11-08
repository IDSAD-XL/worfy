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

const write = read('write.md')
const template = read('template/SKILL.template.md')
const examplesTemplate = read('template/voice-examples.md')
const lintTemplate = read('template/lint.json')

/** The text of the step `## <n>. …` of a skill text, up to the next `## ` heading. */
function sectionOf(text: string, n: number, name: string): string {
  const start = text.search(new RegExp(`^## ${n}\\. `, 'm'))
  expect(start, `no step "## ${n}. " in ${name}`).toBeGreaterThan(-1)
  const rest = text.slice(start + 1)
  const end = rest.search(/^## /m)
  return end === -1 ? text.slice(start) : text.slice(start, start + 1 + end)
}
const step = (n: number): string => sectionOf(skill, n, 'SKILL.md')
const templateStep = (n: number): string => sectionOf(template, n, 'template/SKILL.template.md')

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

  it('sends the verdict voice: no from step 2 to step 3 by its title, before the question', () => {
    expect(skill).toMatch(/^## 3\. Too little history$/m)
    const two = step(2)
    // No numbered sub-items in step 2: "step 3" there can only mean the heading.
    expect(two).not.toMatch(/^\s*\d+\.\s/m)
    const route = blocks(two).find((b) => b.includes('`voice: no (N of 30)`') && b.includes('step 3 (Too little history)'))
    expect(route, two).toBeDefined()
    expect(route).toMatch(/ask nothing/)
    expect(two.indexOf('step 3 (Too little history)')).toBeLessThan(two.indexOf('explicit "yes"'))
  })

  it('picks the held-out pull requests by the role and length of the comments, never their text', () => {
    const two = step(2)
    for (const field of ['reviews[].role', 'reviews[].commit_id', 'threads[].comments[]', '`role` and the length of\n  `body`'])
      expect(two, field).toContain(field)
    expect(two).toMatch(/prints no text/)
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

  it('sends step 4 to analyse.md, step 5 to write.md and the template, and marks step 6 as not available yet', () => {
    expect(step(4)).toContain('${CLAUDE_PLUGIN_ROOT}/skills/human-review-setup/analyse.md')
    expect(step(5)).toContain('${CLAUDE_PLUGIN_ROOT}/skills/human-review-setup/write.md`')
    expect(step(5)).toContain('${CLAUDE_PLUGIN_ROOT}/skills/human-review-setup/template/`')
    expect(step(5)).toContain('review-draft-lint --skill')
    expect(step(5)).not.toMatch(/not available/i)
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

const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'human-review-setup-')))
afterAll(() => removeTestTree(root))

/** review-draft-lint with a temporary HOME and Harness home, outside any registered project. */
function runLint(args: string[]): { status: number | null; out: string } {
  const home = join(root, 'home')
  const harnessHome = join(root, 'hh')
  mkdirSync(home, { recursive: true })
  mkdirSync(join(harnessHome, 'gate'), { recursive: true })
  // An empty registry: the root is no registered project, so the draft check skips epic names (exit 0, a notice).
  writeFileSync(join(harnessHome, 'gate', 'config.json'), JSON.stringify({ repos: [] }))
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, HARNESS_HOME: harnessHome, EVAL_HARNESS_HOME: '' }
  for (const name of ['CLAUDE_GATE_CONFIG', 'CLAUDE_GATE_RESOLVE', 'CLAUDE_PROFILES_DIR', 'CLAUDE_PROFILE_BIN', 'CLAUDE_TICKET_BIN']) delete env[name]
  const run = spawnSync(scriptNode(), [LINT, ...args], { cwd: root, encoding: 'utf8', env })
  return { status: run.status, out: run.stdout + run.stderr }
}
const lint = (dir: string): { status: number | null; out: string } => runLint(['--skill', dir])

describe('the research.md format against review-draft-lint --skill', () => {
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

// The eight steps of the generated skill, decision 10 of the owner (spec, "Generated skill").
const STEPS = ['Load the pull request', 'Triage', 'Checklist by area', 'Verify and grade', 'Voice by tier', 'Review state', 'Draft', 'Show the person']

describe('the template of the generated skill', () => {
  it('is human-review, called by the model too, with the description of the ticket', () => {
    const front = /^---\n([\s\S]*?)\n---\n/.exec(template)
    expect(front).not.toBeNull()
    expect(front![1]).toMatch(/^name: human-review$/m)
    expect(front![1]).toContain("description: Draft a review of a pull request in this team's voice; nothing is posted without the user's yes")
    expect(front![1]).not.toMatch(/disable-model-invocation/)
  })

  it('has the eight steps of the owner decision, in order', () => {
    const headings = [...template.matchAll(/^## (\d+)\. (.+)$/gm)].map((m) => `${m[1]}. ${m[2]}`)
    expect(headings).toEqual(STEPS.map((title, i) => `${i + 1}. ${title}`))
    // No other `## ` heading: a rule under one would sit outside the eight steps.
    expect(template.match(/^## /gm)?.length).toBe(STEPS.length)
  })

  it('grades by the seven tiers of analyse.md, in the same order', () => {
    const fromAnalyse = [...sectionOf(analyse, 3, 'analyse.md').matchAll(/^- \*\*(.+?)\*\* —/gm)].map((m) => m[1])
    const fromTemplate = [...templateStep(4).matchAll(/^\*\*(.+?)\*\* —/gm)].map((m) => m[1])
    expect(fromAnalyse).toEqual(TIERS)
    expect(fromTemplate).toEqual(fromAnalyse)
  })

  it('has a place for rules in steps 2 to 6 and none in steps 1, 7 and 8', () => {
    for (const n of [2, 3, 4, 5, 6]) expect(templateStep(n), `step ${n}`).toMatch(/^\{\{rules: .+\}\}$/m)
    for (const n of [1, 7, 8]) expect(templateStep(n), `step ${n}`).not.toContain('{{')
  })

  it('in step 3 gives the team checklist to /worfy:code-review as one more source of standards', () => {
    const three = templateStep(3)
    expect(three).toContain('/worfy:code-review')
    expect(three).toContain('standards sources')
    expect(three).toMatch(/Standards sub-agent/)
    expect(three).toMatch(/Spec axis/)
  })

  it('in step 4 checks every candidate on the head commit and turns an unchecked one into a question', () => {
    const four = templateStep(4)
    expect(four).toContain('git show <headRefOid>:<path>')
    expect(four).toMatch(/could not confirm there becomes a question/)
  })

  it('in step 7 writes a draft { payload, tiers, body_tier } that review-draft-lint accepts with lint.json', () => {
    const seven = templateStep(7)
    const block = /```json\n([\s\S]*?)\n```/.exec(seven)
    expect(block, seven).not.toBeNull()
    const draft = JSON.parse(block![1]) as Record<string, unknown>
    expect(Object.keys(draft)).toEqual(['payload', 'tiers', 'body_tier'])
    expect(seven).toContain('review-draft-lint "<tmp>/review-<n>.json" --rules "<private folder>/lint.json"')
    const dir = join(root, 'draft')
    mkdirSync(dir)
    writeFileSync(join(dir, 'draft.json'), block![1])
    writeFileSync(join(dir, 'lint.json'), lintTemplate)
    const run = runLint([join(dir, 'draft.json'), '--rules', join(dir, 'lint.json')])
    expect(run.status, run.out).toBe(0)
  })

  it('posts nothing without an explicit "yes", and nothing at all in a session without a person', () => {
    for (const command of ['gh pr review', '--approve', 'gh pr comment', 'gh pr merge']) expect(template, command).not.toContain(command)
    const eight = templateStep(8)
    // The only call that writes to GitHub is in step 8, after the explicit "yes".
    expect(template.match(/gh api/g)?.length, 'gh api outside step 8').toBe(eight.match(/gh api/g)?.length)
    const post = eight.indexOf('gh api --method POST')
    expect(post).toBeGreaterThan(-1)
    expect(eight.indexOf('explicit "yes"')).toBeGreaterThan(-1)
    expect(eight.indexOf('explicit "yes"')).toBeLessThan(post)
    const alone = blocks(eight).filter((b) => /no person/.test(b))
    expect(alone.length, eight).toBeGreaterThan(0)
    for (const b of alone) {
      expect(b).not.toMatch(/gh api|POST/)
      expect(b).toMatch(/stop at the draft/)
      expect(b).toMatch(/post nothing/)
    }
  })

  it('voice-examples.md has a section for each tier, the rule of a third and no logins', () => {
    expect([...examplesTemplate.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual(TIERS)
    for (const tier of TIERS) expect(examplesTemplate, tier).toContain(`{{examples: ${tier}}}`)
    expect(examplesTemplate).toMatch(/three or more reviewers, no reviewer gives more than a third/)
    expect(examplesTemplate).toContain('@someone')
    expect(examplesTemplate).toMatch(/No login anywhere/)
  })

  it('lint.json is schema 1 with a limit for each of the seven tiers and no forbidden words', () => {
    const lintJson = JSON.parse(lintTemplate) as { schema: number; tiers: Record<string, { max_chars: number }>; forbidden: string[] }
    expect(lintJson.schema).toBe(1)
    expect(Object.keys(lintJson.tiers)).toEqual(TIERS)
    for (const tier of TIERS) expect(Number.isInteger(lintJson.tiers[tier]?.max_chars), tier).toBe(true)
    expect(lintJson.forbidden).toEqual([])
  })
})

describe('write.md', () => {
  it('says where the plugin root is, on its third line', () => {
    expect(write.split('\n')[2]).toMatch(/^Plugin root: `<plugin>`/)
  })

  it('builds in raw/skill/ with a copy of research.md, then checks with review-draft-lint --skill', () => {
    expect(write).toContain('raw/skill/')
    expect(write).toMatch(/copy `research\.md` there/)
    expect(write).toContain('"<plugin>/bin/review-draft-lint" --skill "<private folder>/raw/skill"')
    expect(write).toContain('"<plugin>/bin/evidence-check"')
    expect(write.indexOf('--skill "<private folder>/raw/skill"')).toBeLessThan(write.search(/^## 6\. Install$/m))
  })

  it('ends every rule with [R<n>] and changes only the {{…}} lines of the template', () => {
    expect(write).toContain('`[R<n>]`')
    expect(write).toMatch(/Change only the `\{\{…\}\}` lines/)
  })

  it('takes the limits from the 90th percentile and keeps the forbidden words of the person', () => {
    expect(write).toContain('90th percentile')
    expect(write).toMatch(/`forbidden` is the list of the existing/)
  })

  it('installs into .claude/skills/human-review/ and moves the skill before it to previous/', () => {
    const install = write.slice(write.search(/^## 6\. Install$/m))
    expect(install).toContain('<private folder>/.claude/skills/human-review/')
    expect(install).toContain('previous/SKILL-<YYYY-MM-DD>.md')
    expect(install).toContain('`<private folder>/lint.json`, next to `research.md`')
    expect(install.indexOf('previous/')).toBeLessThan(install.indexOf('Copy `raw/skill/SKILL.md`'))
  })
})

describe('a skill written by write.md from a made-up research.md', () => {
  // Made-up logins: they live in raw/reviewers.json only and must not reach the written files.
  const LOGINS = ['quill-otter', 'marsh-fern', 'tide-lamp']
  const LABELS = ['reviewer A', 'reviewer B', 'reviewer C']
  const SECTIONS = [
    'Triage: approved without comments',
    'Triage: small is not safe',
    'Triage: requests to split a pull request',
    'Review states',
    'Theme: src: error handling',
    'Theme: docs: wording',
    'Do not touch: import order',
    ...TIERS.map((tier) => `Voice: ${tier}`),
  ]
  const R = (title: string): number => SECTIONS.indexOf(title) + 1
  const research = [
    '# Research — review history of example',
    '',
    'Window: 2025-11-01 to 2026-11-01, 120 pull requests, 340 substantive comments of the team, 3 reviewers.',
    'Reviewers: reviewer A 0.4, reviewer B 0.35, reviewer C 0.25',
    '',
    ...SECTIONS.flatMap((title, i) => [
      `## R${i + 1} — ${title}`,
      '',
      title.includes('split') ? 'No evidence in the window.' : 'Numbers: 12 of 40 (analysis).',
      'Comments: https://github.com/example/app/pull/7#discussion_r1',
      '',
    ]),
  ].join('\n')

  /** The rules write.md asks for in place of each `{{rules: …}}` line; an unknown place is an error. */
  function rulesFor(place: string): string[] {
    if (place.startsWith('R1 —')) return [`- Approve dependency bumps without a comment: 41 of 44 were (93%). [R${R('Triage: approved without comments')}]`]
    if (place.startsWith('R2 —')) return [`- A small change to a migration still gets a full read: 6 of 9 got changes requested. [R${R('Triage: small is not safe')}]`]
    if (place.startsWith('R3 —'))
      return [`- Ask to split a pull request over 800 changed lines, or one that mixes changes of unrelated kinds (the template's default). [R3]`]
    if (place.startsWith('R4 —'))
      return [`- Approve with nits by default: 71% of reviews were approvals. [R4]`, `- Request changes only for a blocker: 6% of reviews. [R4] [R${R('Voice: blocker')}]`]
    if (place.startsWith('one per Theme section'))
      return [`- src: check that every error is handled or passed on (22% of the area's comments). [R5]`, `- docs: check the wording of headings (15% of the area's comments). [R6]`]
    if (place.startsWith('one per Do not touch section')) return [`- Do not comment on import order: the team withdrew 5 of 5 such remarks. [R7]`]
    if (place.startsWith('one per Voice section'))
      return TIERS.map((tier) => `- ${tier}: median 60, 90th percentile 140 characters; opens with a question; soft register. [R${R(`Voice: ${tier}`)}]`)
    if (place.startsWith('the language')) return [`- Write the draft in English: every quote of the Voice sections is. [R${R('Voice: nit')}] [R${R('Voice: argued')}]`]
    throw new Error(`a {{rules}} place this test does not know: ${place}`)
  }

  const fillSkill = (text: string): string =>
    text
      .split('\n')
      .map((line) => {
        const m = /^\{\{rules: (.+)\}\}$/.exec(line)
        return m ? rulesFor(m[1]!).join('\n') : line
      })
      .join('\n')

  // Made-up comments: three per tier, one from each reviewer, each mentioning another one by login.
  const comments = TIERS.flatMap((tier, t) =>
    LOGINS.map((_, i) => ({
      tier,
      url: `https://github.com/example/app/pull/${10 + t}#discussion_r${100 * t + i}`,
      number: 10 + t,
      reviewer: LABELS[i]!,
      text: `@${LOGINS[(i + 1) % LOGINS.length]} a ${tier} remark, number ${i}`,
    })),
  )
  const fillExamples = (text: string, mask: boolean): string =>
    text.replace(/^\{\{examples: (.+)\}\}$/gm, (_, tier: string) =>
      comments
        .filter((c) => c.tier === tier)
        .map((c) => {
          const quote = mask ? c.text.replace(/@[A-Za-z0-9][A-Za-z0-9-]*/g, '@someone') : c.text
          return `- [example/app#${c.number}](${c.url}) — ${c.reviewer}, ${[...quote].length} chars\n  > ${quote}`
        })
        .join('\n'),
    )

  /** The checks of write.md, step 5, besides the lint: placeholders, logins, mentions, the rule of a third. */
  function writeChecks(files: Record<string, string>): string[] {
    const found: string[] = []
    for (const [name, text] of Object.entries(files)) {
      if (text.includes('{{')) found.push(`${name}: a {{…}} place left`)
      for (const login of LOGINS) if (text.toLowerCase().includes(login)) found.push(`${name}: login ${login}`)
      for (const m of text.matchAll(/(^|[\s(])@([A-Za-z0-9][A-Za-z0-9-]*)/g)) if (m[2] !== 'someone') found.push(`${name}: mention @${m[2]}`)
    }
    const examples = files['voice-examples.md'] ?? ''
    for (const part of examples.split(/^## /m).slice(1)) {
      const labels = [...part.matchAll(/^- \[.+?\]\(.+?\) — (reviewer [A-Z]),/gm)].map((m) => m[1])
      const counts = new Map<string, number>()
      for (const l of labels) counts.set(l!, (counts.get(l!) ?? 0) + 1)
      if (counts.size >= 3) for (const [l, c] of counts) if (c * 3 > labels.length) found.push(`voice-examples.md: ${l} gives ${c} of ${labels.length}`)
    }
    return found
  }

  function build(name: string, skillText: string, examplesText: string): string {
    const dir = join(root, name)
    mkdirSync(dir)
    writeFileSync(join(dir, 'research.md'), research)
    writeFileSync(join(dir, 'SKILL.md'), skillText)
    writeFileSync(join(dir, 'voice-examples.md'), examplesText)
    return dir
  }

  it('passes review-draft-lint --skill with exit 0, and voice-examples.md has no logins', { timeout: ms(30_000) }, () => {
    const skillText = fillSkill(template)
    const examplesText = fillExamples(examplesTemplate, true)
    const dir = build('written', skillText, examplesText)
    const run = lint(dir)
    expect(run.status, run.out).toBe(0)
    const rules = (skillText.match(/\[R\d+\]\s*$/gm) ?? []).length
    expect(run.out).toContain(`clean (${rules} rules,`)
    expect(writeChecks({ 'SKILL.md': skillText, 'voice-examples.md': examplesText })).toEqual([])
    const privacy = createRequire(__filename)(PRIVACY) as { findings: (text: string) => unknown[] }
    expect(privacy.findings(examplesText)).toEqual([])
    // The limits of lint.json filled from the 90th percentile still pass the lint's own check of lint.json.
    const lintJson = JSON.parse(lintTemplate) as { tiers: Record<string, { max_chars: number }> }
    for (const tier of TIERS) lintJson.tiers[tier]!.max_chars = 140
    writeFileSync(join(dir, 'lint.json'), JSON.stringify(lintJson))
    writeFileSync(join(dir, 'empty-draft.json'), JSON.stringify({ payload: { event: 'COMMENT', comments: [] }, tiers: [] }))
    const empty = runLint([join(dir, 'empty-draft.json'), '--rules', join(dir, 'lint.json')])
    expect(empty.status, empty.out).toBe(0)
  })

  it('a rule without [R<n>] is a finding of the lint', { timeout: ms(30_000) }, () => {
    const skillText = fillSkill(template).replace(/ \[R5\]$/m, '')
    expect(skillText).not.toMatch(/\[R5\]$/m)
    const run = lint(build('no-reference', skillText, fillExamples(examplesTemplate, true)))
    expect(run.status, run.out).toBe(1)
    expect(run.out).toContain('rule without a [R<n>] reference: "- src: check that every error')
  })

  it('the fixed text of the template has no list item the lint would take for a rule', { timeout: ms(30_000) }, () => {
    const run = lint(build('bare', template, examplesTemplate))
    expect(run.status, run.out).toBe(0)
    expect(run.out).toContain('clean (0 rules,')
    // And the checks of write.md stop such an unfilled skill.
    expect(writeChecks({ 'SKILL.md': template }).some((f) => f.includes('{{…}} place left'))).toBe(true)
  })

  it('the checks of write.md catch an unmasked login and one reviewer over a third', () => {
    const unmasked = fillExamples(examplesTemplate, false)
    expect(writeChecks({ 'voice-examples.md': unmasked }).some((f) => f.includes('mention @'))).toBe(true)
    const example = (label: string, n: number): string => `- [example/app#${n}](https://github.com/example/app/pull/${n}#discussion_r${n}) — ${label}, 2 chars\n  > ok`
    const tier = (labels: string[]): string => ['## nit', '', ...labels.map(example), ''].join('\n')
    expect(writeChecks({ 'voice-examples.md': tier(['reviewer A', 'reviewer B', 'reviewer C']) })).toEqual([])
    const lopsided = tier(['reviewer A', 'reviewer B', 'reviewer C', 'reviewer A'])
    expect(writeChecks({ 'voice-examples.md': lopsided }).some((f) => f.includes('reviewer A gives'))).toBe(true)
  })
})

describe('the text of the skill', () => {
  const privacy = createRequire(__filename)(PRIVACY) as { findings: (text: string) => { rule: string }[] }

  it.each(['SKILL.md', 'analyse.md', 'write.md', 'template/SKILL.template.md', 'template/voice-examples.md', 'template/lint.json'])('%s carries no personal data and no @login', (name) => {
    const text = read(name)
    expect(privacy.findings(text).map((f) => f.rule)).toEqual([])
    expect(text.match(/(^|[\s(])@[A-Za-z0-9][A-Za-z0-9-]*/g) ?? []).toEqual([])
  })

  it('every file of the skill is in the uncovered list of the eval coverage map', () => {
    const map = JSON.parse(readFileSync(COVERAGE, 'utf8')) as { uncovered: Record<string, string> }
    const files = ['SKILL.md', 'analyse.md', 'write.md', 'template/SKILL.template.md', 'template/voice-examples.md', 'template/lint.json']
    for (const file of files.map((f) => `skills/human-review-setup/${f}`))
      expect(map.uncovered[file], file).toBe('No case yet: worfy-human-review 12 adds cases')
  })
})

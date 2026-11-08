// The generator skill /worfy:human-review-setup (Epic worfy-human-review, tickets 06-08): the order of its steps read
// from the text of harness/skills/human-review-setup/SKILL.md — the script's estimate before any reading of raw/ by
// the model, an explicit "yes", "no" deletes raw/, the short-history branch writes only meta.json — and the format
// of research.md that analyse.md describes, run through `review-draft-lint --skill` on a fixture built from it.
// No model runs and nothing reads GitHub here; every run of the lint gets a temporary HOME and Harness home.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
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
// Read softly: before ticket 08 the file does not exist, and each test of it fails on its own line.
const check = existsSync(join(DIR, 'check.md')) ? read('check.md') : ''
// Read softly as well: before ticket 10 there is no refresh.md.
const refresh = existsSync(join(DIR, 'refresh.md')) ? read('refresh.md') : ''

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

  it('sends step 4 to analyse.md, step 5 to write.md and the template, and step 6 to check.md', () => {
    expect(step(4)).toContain('${CLAUDE_PLUGIN_ROOT}/skills/human-review-setup/analyse.md')
    expect(step(5)).toContain('${CLAUDE_PLUGIN_ROOT}/skills/human-review-setup/write.md`')
    expect(step(5)).toContain('${CLAUDE_PLUGIN_ROOT}/skills/human-review-setup/template/`')
    expect(step(5)).toContain('review-draft-lint --skill')
    // Installed into the private folder of the profile, never into the project's repository.
    expect(step(5)).toContain('`<private folder>/.claude/skills/human-review/`')
    for (const [name, text] of [['SKILL.md', skill], ['write.md', write]]) expect(text, name).not.toContain('<project root>/.claude')
    expect(step(5)).not.toMatch(/not available/i)
    expect(step(6)).toContain('${CLAUDE_PLUGIN_ROOT}/skills/human-review-setup/check.md')
    expect(step(6)).not.toMatch(/not available/i)
  })

  it('in step 7: keep deletes raw/ and records kept_at in meta.json, refuse deletes the private folder', () => {
    const seven = step(7)
    expect(seven).toContain('review-history" clean')
    const keep = blocks(seven).find((b) => b.startsWith('- **Keep**'))
    expect(keep, seven).toBeDefined()
    const clean = keep!.indexOf('review-history" clean')
    expect(clean, keep).toBeGreaterThan(-1)
    expect(keep!.indexOf('`kept_at`'), keep).toBeGreaterThan(clean)
    expect(keep!.indexOf('`meta.json`'), keep).toBeGreaterThan(clean)
    expect(seven).toMatch(/Refuse/)
    expect(seven).toContain('state/human-review')
  })

  it('in step 7 offers three choices after showing the result of the check', () => {
    const seven = step(7)
    const choices = blocks(seven).filter((b) => /^- \*\*(Keep|Build again|Refuse)\*\*/.test(b))
    expect(choices.map((b) => /^- \*\*([^*]+)\*\*/.exec(b)![1]), seven).toEqual(['Keep', 'Build again', 'Refuse'])
    // The check comes first: its total line and its pages are what the person decides on.
    expect(seven).toContain('a rough measure')
    expect(seven).toContain('check/')
    expect(seven.indexOf('a rough measure')).toBeLessThan(seven.indexOf('- **Keep**'))
    // The person's remarks go to step 5 of the next build.
    const again = choices[1]!
    expect(again).toMatch(/remarks/)
    expect(again).toMatch(/step 5/)
    expect(again).toContain('`[R<n>]`')
    // The choice lands in meta.json next to the result of the check.
    expect(seven).toContain('`decision`')
  })

  it('"Refuse" deletes only the private folder, with one command and a literal path', () => {
    const seven = step(7)
    const refuse = blocks(seven).find((b) => b.startsWith('- **Refuse**'))
    expect(refuse, seven).toBeDefined()
    const commands = refuse!.match(/`rm [^`]*`/g) ?? []
    expect(commands, refuse).toEqual(['`rm -rf "<_resolved.dir>/state/human-review"`'])
    // The whole step has no other rm, no shell variable and no glob in a deletion.
    expect(seven.match(/\brm\b/g) ?? [], seven).toHaveLength(1)
    expect(seven).not.toMatch(/rm [^`\n]*(\$|\*)/)
    expect(refuse).toMatch(/literal path/)
    expect(refuse).toMatch(/not a shell variable/)
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
    const example = block?.[1] ?? ''
    const draft = JSON.parse(example) as Record<string, unknown>
    expect(Object.keys(draft)).toEqual(['payload', 'tiers', 'body_tier'])
    expect(seven).toContain('review-draft-lint "<tmp>/review-<n>.json" --rules "<private folder>/lint.json"')
    const dir = join(root, 'draft')
    mkdirSync(dir)
    writeFileSync(join(dir, 'draft.json'), example)
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
    expect(install).toContain('`mkdir -p`')
    expect(install).toContain('previous/SKILL-<stamp>.md')
    expect(install).toContain('YYYY-MM-DDTHH-MM-SS')
    expect(install).toContain('`<private folder>/lint.json`, next to `research.md`')
    expect(install.indexOf('previous/')).toBeLessThan(install.indexOf('Copy `raw/skill/SKILL.md`'))
  })
})

describe('check.md', () => {
  // The text with its line breaks folded, so a phrase may wrap anywhere.
  const flat = check.replace(/\s+/g, ' ')

  it('says where the plugin root is, on its third line', () => {
    expect(check.split('\n')[2]).toMatch(/^Plugin root: `<plugin>`/)
  })

  it('takes the held-out pull requests from meta.json and builds each draft on the commit_id of the first review', () => {
    expect(flat).toContain('`held_out`')
    expect(flat).toContain('`commit_id`')
    expect(flat).toMatch(/the commit the first review of the team saw/)
    // Files at that commit without touching the working tree: no checkout, no worktree.
    expect(flat).toContain('git show "<commit_id>:<path>"')
    expect(flat).toContain('git diff "<base>" "<commit_id>"')
    // A three-dot diff against the base branch is empty after a merge by a merge commit.
    expect(flat).not.toContain('...<commit_id>')
    expect(flat).not.toMatch(/git (checkout|switch|worktree add)/)
    expect(flat).toMatch(/no checkout and no worktree/)
    // The head of the pull request today is not the code the reviewer saw.
    expect(flat).toMatch(/not `gh pr diff`/)
  })

  it('briefs one Subagent per pull request with the text of the new SKILL.md and voice-examples.md, and keeps the answers from it', () => {
    expect(flat).toContain('<private folder>/.claude/skills/human-review/SKILL.md')
    expect(flat).toContain('<private folder>/.claude/skills/human-review/voice-examples.md')
    expect(flat).toMatch(/One Subagent per pull request/)
    expect(flat).toMatch(/pasted in full/)
    // The drafting Subagent never sees what the team said on that pull request.
    expect(flat).toMatch(/never reads `raw\/`/)
    expect(flat).toContain('no `gh` command at all')
  })

  it('keeps the drafting Subagent off the history after commit_id, where the answers to the review lie', () => {
    const rule = blocks(check).find((b) => b.startsWith('- no history after `commit_id`'))
    expect(rule, check).toBeDefined()
    for (const banned of ['no `git log`', '`git log <commit_id>..`', 'no `FETCH_HEAD`', 'no `pull/<n>/head`', 'no `origin/<baseRefName>`'])
      expect(rule, banned).toContain(banned)
  })

  it('puts commit_id in place of headRefOid and into payload.commit_id of the draft', () => {
    expect(flat).toContain('`commit_id`, not `headRefOid`')
    expect(flat).toContain('`commit_id` stands wherever the skill says `headRefOid`')
    expect(flat).toContain('`payload.commit_id` set to `commit_id`')
  })

  it('posts nothing: no gh call with a method that writes, no gh pr review or comment', () => {
    expect(flat).toMatch(/posts nothing/i)
    expect(flat).not.toMatch(/--method\s+(POST|PUT|PATCH|DELETE)|-X\s*(POST|PUT|PATCH|DELETE)/)
    expect(flat).not.toMatch(/gh pr (review|comment)\b/)
    expect(flat).toMatch(/no `gh api` call at all/)
  })

  it('pairs comments by file and lines within ±10, sends pairs and general comments to a judge', () => {
    expect(flat).toMatch(/the same file/)
    expect(flat).toContain('±10')
    expect(flat).toMatch(/at most 10 lines apart/)
    const judge = blocks(check).filter((b) => /judge/i.test(b))
    expect(judge.some((b) => /candidate pair/.test(b)), judge.join('\n')).toBe(true)
    expect(judge.some((b) => /general/.test(b) && /no line/.test(b)), judge.join('\n')).toBe(true)
    // A line pair further apart is never a match, so the judge cannot widen the measure.
    expect(flat).toMatch(/never a match/)
  })

  it('matches one to one, so one draft remark never counts for two remarks of the team', () => {
    expect(flat).toContain('matches one to one')
    expect(flat).toContain('each remark of the team keeps at most one draft remark and each draft remark at most one of the team')
  })

  it('places a remark of the team by path and original_line of the first comment on commit_id, never by the thread line', () => {
    expect(flat).toContain('`original_line`')
    expect(flat).toContain('its `path` and its `original_line`')
    expect(flat).toContain("Never the thread's `line`")
    expect(flat).toContain('whose own `commit_id`, the commit it was written on, is the held-out `commit_id`')
    expect(flat).toContain("the team's `original_line`, the draft's `line`")
    // An outdated thread is no general comment for the judge to pair with anything.
    expect(flat).not.toMatch(/thread whose `line` is empty/)
  })

  it('counts only the comments on commit_id and lists the later rounds apart', () => {
    expect(flat).toContain('the body of a review whose `commit_id` is the held-out `commit_id`')
    expect(flat).toContain('are not in N')
    expect(flat).toContain('`## Later rounds`')
    expect(flat).toContain('not paired and not counted')
    expect(flat).toContain('"later": L')
  })

  it('marks a check after Build again as run on pull requests the person already saw', () => {
    expect(flat).toContain('(after the person saw these PRs)')
    expect(flat).toContain('`seen` is `true`')
    const again = blocks(step(7)).find((b) => b.startsWith('- **Build again**'))
    expect(again).toContain('after the person saw these PRs')
  })

  it('stops a pull request with an empty diff instead of grading an empty draft', () => {
    expect(check).toContain('git merge-base --is-ancestor "<commit_id>" "<base>"; echo "EXIT=$?"')
    expect(check).toContain('git diff --quiet "<base>" "<commit_id>"; echo "EXIT=$?"')
    expect(flat).toContain('this pull request stops here')
    expect(flat).toContain('the reason "empty diff"')
    expect(flat).toContain('An empty draft is never graded')
  })

  it('reports "matched K of N remarks of the team, M extra" per pull request and in total, as a rough measure', () => {
    expect(flat).toContain('matched K of N remarks of the team, M extra')
    expect(flat).toContain('a rough measure')
    expect(flat).toMatch(/per pull request and in total/)
  })

  it('writes check/<PR>.md with the real comments on the left and the draft on the right, without logins', () => {
    expect(flat).toContain('<private folder>/check/<PR>.md')
    expect(flat).toContain("the team's comments on the left and the draft on the right")
    for (const field of ['tier', 'length', 'link']) expect(flat).toContain(field)
    expect(flat).toContain('@someone')
    expect(flat).toMatch(/No login/)
  })

  it('records the result of the check in meta.json under its own key', () => {
    expect(flat).toContain('`meta.json`')
    expect(flat).toContain('`check`')
    expect(flat).toMatch(/Change only this key/)
  })

  it('goes on to step 7 even when there is nothing to check', () => {
    expect(flat).toMatch(/no `held_out`/)
    expect(flat).toContain('step 7 of SKILL.md')
  })
})

describe('refresh.md: the update with --refresh (worfy-human-review ticket 10)', () => {
  const flat = refresh.replace(/\s+/g, ' ')
  const part = (n: number): string => sectionOf(refresh, n, 'refresh.md')
  const choice = (name: string): string => {
    const found = blocks(part(8)).find((b) => b.startsWith(`- **${name}**`))
    expect(found, part(8)).toBeDefined()
    return found!
  }

  it('SKILL.md sends --refresh to refresh.md after step 1, before any fetch of step 2', () => {
    const update = skill.search(/^## Update: `--refresh`$/m)
    expect(update, 'no "## Update: `--refresh`" heading in SKILL.md').toBeGreaterThan(skill.search(/^## 1\. /m))
    expect(update).toBeLessThan(skill.search(/^## 2\. /m))
    const section = skill.slice(update, skill.search(/^## 2\. /m))
    expect(section).toContain('${CLAUDE_PLUGIN_ROOT}/skills/human-review-setup/refresh.md')
    expect(section).toMatch(/instead of steps 2 to 7/)
    expect(skill.split('\n').slice(0, 5).join('\n')).toMatch(/--refresh/)
  })

  it('says where the plugin root is, on its third line, and has steps 1 to 8 in order', () => {
    expect(refresh.split('\n')[2]).toMatch(/^Plugin root: `<plugin>`/)
    const at = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => refresh.search(new RegExp(`^## ${n}\\. `, 'm')))
    expect(at.every((i) => i > -1), JSON.stringify(at)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
  })

  it('takes the date from meta.json: the later of analysed_through and fetched_at; without either it stops', () => {
    const one = part(1)
    const date = blocks(one).find((b) => b.startsWith('- The date the update reads from'))
    expect(date, one).toBeDefined()
    // A whole build after an update keeps the older analysed_through: the later date wins, never the key alone.
    expect(date).toMatch(/the later of two dates/)
    expect(date).toContain('`analysed_through`')
    expect(date).toContain('`fetched_at`')
    expect(date).toMatch(/twice/)
    expect(date).not.toMatch(/`analysed_through`[^.]*when it is there[^.]*else `fetched_at`/)
    expect(blocks(one).some((b) => /neither/i.test(b) && /stop/i.test(b))).toBe(true)
    // No reviewer to update: the first run instead.
    expect(blocks(one).some((b) => b.includes('SKILL.md') && b.includes('/worfy:human-review-setup') && /without `--refresh`/.test(b))).toBe(true)
  })

  it('runs fetch --since and estimate before the analysis, and analyses only after an explicit "yes"', () => {
    const fetch = refresh.indexOf('review-history" fetch --since')
    const estimate = refresh.indexOf('review-history" estimate')
    const yes = refresh.indexOf('explicit "yes"')
    expect(fetch, 'fetch --since').toBeGreaterThan(-1)
    expect(estimate, 'estimate').toBeGreaterThan(fetch)
    expect(yes, 'explicit "yes"').toBeGreaterThan(estimate)
    // Before the answer only scripts read raw/: the estimate, and the count of new comments, which prints no text.
    const fresh = blocks(part(2)).find((b) => b.startsWith('- **New comments.**')) ?? ''
    const model = blocks(refresh).filter((b) => b !== fresh).join('\n')
    const yesInModel = model.indexOf('explicit "yes"')
    for (const reading of ['prs.jsonl', 'analyse.md', 'write.md', 'check.md']) expect(model.indexOf(reading), reading).toBeGreaterThan(yesInModel)
    expect(blocks(part(2)).some((b) => /do not (open|read)[^.]*raw\//i.test(b) && /before/i.test(b))).toBe(true)
  })

  it('without a "yes" changes nothing: raw/ is deleted and the skill, research.md and lint.json stay', () => {
    const no = blocks(part(2)).find((b) => b.startsWith('- **No.**'))
    expect(no, part(2)).toBeDefined()
    expect(no).toContain('review-history" clean')
    expect(no).toMatch(/stop/i)
    expect(no).toMatch(/nothing (else )?changes/i)
    expect(no).toMatch(/session that has no person/)
  })

  it('counts as new only the team comments dated after the date, by a script that prints no text', () => {
    const fresh = blocks(part(2)).find((b) => b.startsWith('- **New comments.**'))
    expect(fresh, part(2)).toBeDefined()
    // A pull request reviewed before the date and merged after it is in the slice with old comments only.
    expect(fresh).toMatch(/updated since `<date>`/)
    expect(fresh).toMatch(/merged after it/)
    for (const field of ['`submitted_at`', '`created_at`', '`role`']) expect(fresh, field).toContain(field)
    expect(fresh).toMatch(/the length only: it prints no text/)
    expect(fresh).toContain('`raw/refresh/new.json`')
    // Counted before the question, so the person is never asked about a slice with nothing new.
    expect(refresh.indexOf('**New comments.**')).toBeLessThan(refresh.indexOf('explicit "yes"'))
  })

  it('with no new comment of the team says so, deletes raw/ and spends no tokens, however many pull requests the slice has', () => {
    const none = blocks(part(2)).find((b) => b.startsWith('- **Nothing new.**'))
    expect(none, part(2)).toBeDefined()
    expect(none).toContain('`"comments": 0`')
    expect(none).toContain('`raw/refresh/new.json`')
    expect(none).toMatch(/No new pull request with a review of the team since/)
    expect(none).toContain('review-history" clean')
    expect(none).toMatch(/no model reads anything/i)
    // The voice line of a slice does not stop an update: the voice was found by the first run.
    expect(part(2)).toMatch(/`voice: no/)
  })

  it('holds 5 new pull requests out of the new slice, in raw/, not over the held_out of meta.json', () => {
    const three = part(3).replace(/\s+/g, ' ')
    expect(three).toMatch(/5 pull requests/)
    // Picked by the new comments only: a pull request with old comments only is never held out.
    expect(three).toMatch(/counting only the new comments/)
    expect(three).toMatch(/whose team comments are all from before `<date>` is never held out/)
    expect(three).toMatch(/`CHANGES_REQUESTED` review of the team submitted after `<date>`/)
    expect(three).toMatch(/first review of the team after `<date>`/)
    expect(three).toContain('`raw/refresh/held_out.json`')
    expect(three).toMatch(/step 2 of SKILL\.md/)
    expect(three).toMatch(/not (in|into) `meta\.json`/)
  })

  it('analyses the new comments together with the research.md of before, keeping the numbers of its sections', () => {
    const four = part(4)
    expect(four).toContain('`<plugin>/skills/human-review-setup/analyse.md`')
    expect(four).toMatch(/section 1, item 1/)
    expect(four).toContain('`raw/refresh/research-before.md`')
    expect(four).toContain('`raw/refresh/research.md`')
    expect(four).toMatch(/never renumber/i)
    expect(four).toMatch(/`created_at`|`submitted_at`/)
  })

  it('writes the draft in raw/skill/ and installs nothing before Accept', () => {
    const five = part(5)
    expect(five).toContain('`<plugin>/skills/human-review-setup/write.md`')
    expect(five).toContain('`raw/skill/`')
    expect(five).toMatch(/section 6[^.]*(does not run|not now)/i)
    expect(five).toMatch(/Accept/)
  })

  it('the diff of the rules names the added, changed and removed rules, each with [R<n>] and its numbers "before → now"', () => {
    const six = part(6)
    for (const kind of ['Added', 'Changed', 'Removed']) expect(six, kind).toContain(`**${kind}**`)
    expect(six).toContain('`[R<n>]`')
    expect(six).toContain('→')
    expect(six).toContain('`raw/refresh/diff.md`')
    // A rule whose references grew is one changed rule: sets that share a number pair before Added and Removed.
    expect(six).toMatch(/share at least one `\[R<n>\]`/)
    expect(six).toMatch(/not a removed one and an added one/)
    expect(six.indexOf('the same set;')).toBeLessThan(six.indexOf('share at least one'))
    // Between the installed skill and the draft.
    expect(six).toContain('`<private folder>/.claude/skills/human-review/SKILL.md`')
    expect(six).toContain('`raw/skill/SKILL.md`')
  })

  it('checks the draft, not the installed skill, on the new held-out pull requests, with its pages kept in raw/', () => {
    const seven = part(7)
    expect(seven).toContain('`<plugin>/skills/human-review-setup/check.md`')
    expect(seven).toContain('`raw/refresh/held_out.json`')
    expect(seven).toContain('`raw/skill/SKILL.md`')
    expect(seven).toContain('`raw/refresh/check/<PR>.md`')
    expect(seven).toContain('`raw/refresh/check.json`')
  })

  it('shows the diff and the check, then offers Accept and Reject', () => {
    const eight = part(8)
    expect(eight).toContain('a rough measure')
    expect(eight.indexOf('diff.md')).toBeLessThan(eight.indexOf('- **Accept**'))
    expect(blocks(eight).filter((b) => /^- \*\*(Accept|Reject)\*\*/.test(b)).map((b) => /^- \*\*([^*]+)\*\*/.exec(b)![1])).toEqual(['Accept', 'Reject'])
  })

  it('"Accept" moves the old files to previous/, puts the new ones in place and records kept_at and analysed_through', () => {
    const accept = choice('Accept')
    expect(accept).toContain('previous/')
    for (const file of ['SKILL.md', 'voice-examples.md', 'research.md', 'lint.json']) expect(accept, file).toContain(file)
    expect(accept.indexOf('previous/')).toBeLessThan(accept.indexOf('raw/skill/SKILL.md'))
    for (const key of ['`kept_at`', '`analysed_through`', '`analysed_pull_requests`', '`held_out`', '`check`', '`decision`']) expect(accept, key).toContain(key)
    // The old pages of the check go aside before the new ones are copied.
    expect(accept).toContain('`previous/check-<stamp>/`')
    expect(accept.indexOf('`previous/check-<stamp>/`')).toBeLessThan(accept.indexOf('pages of `raw/refresh/check/` into `check/`'))
    expect(accept).toContain('review-history" clean')
  })

  it('"Reject" leaves SKILL.md and the rest as they are and only deletes raw/', () => {
    const reject = choice('Reject')
    expect(reject).toContain('review-history" clean')
    expect(reject).not.toContain('previous/')
    expect(reject).toContain('`SKILL.md`, `voice-examples.md`, `research.md`, `lint.json`, `check/` and the keys of `meta.json` above stay as they were')
    // No deletion command anywhere in the update but the script's own clean.
    expect(refresh).not.toMatch(/\brm\s/)
    expect(flat).toMatch(/Without an answer, do what \*\*Reject\*\* does/)
  })
})

describe('the base rule of check.md on a real git history', () => {
  // The commands are taken from the text of check.md and run, with their placeholders filled, in a made-up repository
  // where one pull request branched at A, its reviewed commit C changed f.txt, and the base branch moved on to B.
  const flat = check.replace(/\s+/g, ' ')
  const command = (re: RegExp): string => {
    const m = re.exec(flat)
    expect(m, String(re)).not.toBeNull()
    return m?.[1] ?? ''
  }
  const merged = (): string => command(/`(git merge-base "<mergeCommit>\^1" "<commit_id>")`/)
  const open = (): string => command(/`(git merge-base "origin\/<baseRefName>" "<commit_id>")`/)
  const diff = (): string => command(/`(git diff "<base>" "<commit_id>")`/)
  const guards = (): string[] => [/^(git merge-base --is-ancestor [^;\n]+);/m, /^(git diff --quiet [^;\n]+);/m].map((re) => re.exec(check)?.[1] ?? '')

  const repo = join(root, 'base-rule')
  const env = { ...process.env, GIT_CONFIG_GLOBAL: join(root, 'no-global-git-config'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_PARAMETERS: '' }
  const git = (...args: string[]): { status: number | null; out: string } => {
    const r = spawnSync('git', ['-c', 'user.name=demo', '-c', 'user.email=demo@example.invalid', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, env, encoding: 'utf8' })
    return { status: r.status, out: (r.stdout ?? '').trim() }
  }
  const sha = (...args: string[]): string => {
    const r = git(...args)
    expect(r.status, args.join(' ')).toBe(0)
    return r.out
  }
  /** Runs a command of check.md: its quoted words are arguments, `<name>` placeholders take the given values. */
  const run = (cmd: string, values: Record<string, string>): { status: number | null; out: string } => {
    const words = [...cmd.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!)
    expect(words[0]).toBe('git')
    return git(...words.slice(1).map((w) => w.replace(/<[A-Za-z_]+>/g, (k) => values[k] ?? k)))
  }

  let A = ''
  let C = ''
  const heads: Record<string, string> = {}
  const setUp = (): void => {
    if (A) return
    mkdirSync(repo, { recursive: true })
    sha('init', '-q')
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    sha('add', 'a.txt')
    sha('commit', '-qm', 'A')
    A = sha('rev-parse', 'HEAD')
    sha('switch', '-qc', 'feature')
    writeFileSync(join(repo, 'f.txt'), 'f\n')
    sha('add', 'f.txt')
    sha('commit', '-qm', 'C')
    C = sha('rev-parse', 'HEAD')
    sha('switch', '-q', 'main')
    writeFileSync(join(repo, 'b.txt'), 'b\n')
    sha('add', 'b.txt')
    sha('commit', '-qm', 'B')
    sha('update-ref', 'refs/remotes/origin/main', sha('rev-parse', 'HEAD'))
    // Merged by a merge commit, by a squash, by a rebase.
    sha('switch', '-qc', 'by-merge', 'main')
    sha('merge', '-q', '--no-ff', '-m', 'merge', 'feature')
    heads.merge = sha('rev-parse', 'HEAD')
    sha('switch', '-qc', 'by-squash', 'main')
    sha('merge', '-q', '--squash', 'feature')
    sha('commit', '-qm', 'squash')
    heads.squash = sha('rev-parse', 'HEAD')
    sha('switch', '-qc', 'by-rebase', 'main')
    sha('cherry-pick', 'feature')
    heads.rebase = sha('rev-parse', 'HEAD')
  }

  const expectOneFile = (base: string): void => {
    expect(base).toBe(A)
    const d = run(diff().replace('git diff', 'git diff --name-only'), { '<base>': base, '<commit_id>': C })
    expect(d).toEqual({ status: 0, out: 'f.txt' })
    for (const guard of guards()) expect(run(guard, { '<base>': base, '<commit_id>': C }).status, guard).toBe(1)
  }

  it.each(['merge', 'squash', 'rebase'])('a pull request merged by a %s gets the branch point as its base, and the diff of C', { timeout: ms(30_000) }, (how) => {
    setUp()
    const base = run(merged(), { '<mergeCommit>': heads[how]!, '<commit_id>': C })
    expect(base.status).toBe(0)
    expectOneFile(base.out)
  })

  it('a pull request not merged gets its merge base with the base branch', { timeout: ms(30_000) }, () => {
    setUp()
    const base = run(open(), { '<baseRefName>': 'main', '<commit_id>': C })
    expect(base.status).toBe(0)
    expectOneFile(base.out)
  })

  it('the base branch after a merge commit would give C itself, and the guards of check.md stop it', { timeout: ms(30_000) }, () => {
    setUp()
    // The rule check.md forbids: the merge base of the base branch after the merge and C.
    const wrong = sha('merge-base', heads.merge!, C)
    expect(wrong).toBe(C)
    const [ancestor, quiet] = guards()
    expect(run(ancestor!, { '<base>': wrong, '<commit_id>': C }).status).toBe(0)
    expect(run(quiet!, { '<base>': wrong, '<commit_id>': C }).status).toBe(0)
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

  /** The checks of write.md, step 5, besides the lint (which finds a placeholder of the template left): logins, mentions, the rule of a third. */
  function writeChecks(files: Record<string, string>): string[] {
    const found: string[] = []
    for (const [name, text] of Object.entries(files)) {
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

  it('the fixed text of the template has no list item the lint would take for a rule, and each place left is a finding', { timeout: ms(30_000) }, () => {
    const run = lint(build('bare', template, examplesTemplate))
    // Only the {{…}} places of the template are findings (worfy-human-review 13): no rule without a reference.
    expect(run.status, run.out).toBe(1)
    const lines = run.out.trim().split('\n')
    const places = (template.match(/^\{\{rules: /gm) ?? []).length + (examplesTemplate.match(/^\{\{examples: /gm) ?? []).length
    expect(lines, run.out).toHaveLength(places)
    for (const line of lines) expect(line).toMatch(/^(SKILL|voice-examples)\.md:\d+: placeholder of the template left: "\{\{(rules|examples): /)
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

  it.each(['SKILL.md', 'analyse.md', 'write.md', 'check.md', 'refresh.md', 'template/SKILL.template.md', 'template/voice-examples.md', 'template/lint.json'])('%s carries no personal data and no @login', (name) => {
    const text = read(name)
    expect(privacy.findings(text).map((f) => f.rule)).toEqual([])
    expect(text.match(/(^|[\s(])@[A-Za-z0-9][A-Za-z0-9-]*/g) ?? []).toEqual([])
  })

  // worfy-human-review ticket 12 added the eval cases human-review-setup-*: every file of the skill is checked by one.
  it('every file of the skill is in a case of the eval coverage map, none in its uncovered list', () => {
    const map = JSON.parse(readFileSync(COVERAGE, 'utf8')) as { cases: Record<string, string[]>; uncovered: Record<string, string> }
    const covered = new Set(Object.entries(map.cases).flatMap(([name, rules]) => (name.startsWith('human-review-setup-') ? rules : [])))
    const files = ['SKILL.md', 'analyse.md', 'write.md', 'check.md', 'refresh.md', 'template/SKILL.template.md', 'template/voice-examples.md', 'template/lint.json']
    for (const file of files.map((f) => `skills/human-review-setup/${f}`)) {
      expect(covered.has(file), file).toBe(true)
      expect(map.uncovered[file], file).toBeUndefined()
    }
  })
})

// worfy-human-review 13: the five places where the live run of 2026-11-09 on a public repository went wrong.
describe('the fixes of the live run (worfy-human-review 13)', () => {
  const flat = (text: string): string => text.replace(/\s+/g, ' ')

  it('analyse.md names id, url and submitted_at of reviews[] and takes every link from a url of raw/prs.jsonl', () => {
    const fields = /`reviews\[\]` \(([^)]*)\)/.exec(analyse)
    expect(fields, 'no list of the fields of reviews[]').not.toBeNull()
    for (const f of ['`id`', '`url`', '`submitted_at`', '`state`', '`commit_id`']) expect(fields![1], f).toContain(f)
    expect(flat(analyse)).toMatch(/a link is a `url` of `raw\/prs\.jsonl`, copied as it is: never build a link/i)
    // The script of the check refuses any other link: write.md runs the lint with raw/prs.jsonl, an update with the
    // research.md of before as known links too.
    expect(write).toContain('"<plugin>/bin/review-draft-lint" --skill "<private folder>/raw/skill" --prs "<private folder>/raw/prs.jsonl"')
    expect(flat(refresh)).toContain('--known "<private folder>/raw/refresh/research-before.md"')
  })

  it('analyse.md keeps a plain approval out of the tiers, out of heads-up, and counts it on a line of its own', () => {
    const three = sectionOf(analyse, 3, 'analyse.md')
    const rule = blocks(three).find((b) => b.startsWith('**A plain approval is not a tier.**'))
    expect(rule, three).toBeDefined()
    expect(rule).toContain('LGTM')
    expect(rule).toMatch(/tested/)
    expect(rule).toMatch(/never heads-up/)
    expect(rule).toContain('"tier": "approval"')
    // Not in any Voice section, not in lint.json; R4 carries the count.
    const five = sectionOf(analyse, 5, 'analyse.md')
    expect(flat(five)).toMatch(/plain approvals .*apart/)
    expect(flat(analyse)).toMatch(/\*\*Review states\*\*[^\n]*plain approvals/)
    // The estimate shows them too, and the judge of the check takes them out of N.
    expect(flat(skill)).toContain('plain approvals of the team')
    expect(flat(check)).toMatch(/`approval`[^.]*is not a remark/)
  })

  it('check.md lets the drafting Subagent only read: git diff, git show, git grep and files, never run the code of the repository', () => {
    const two = sectionOf(check, 2, 'check.md')
    const rule = blocks(two).find((b) => b.startsWith('- only reading:'))
    expect(rule, two).toBeDefined()
    for (const allowed of ['`git diff "<base>" "<commit_id>"`', '`git show "<commit_id>:<path>"`', '`git grep -n <pattern> "<commit_id>"`']) expect(rule, allowed).toContain(allowed)
    expect(rule).toMatch(/never runs the code of the repository/)
    for (const banned of ['no build', 'no test', 'no package manager', 'no script of the repository']) expect(rule, banned).toContain(banned)
  })

  describe('a shallow clone is found before the analysis and fetched in full, or the run stops', () => {
    const two = sectionOf(skill, 2, 'SKILL.md')
    const block = /```bash\n((?:.*\n)*?)```/g
    const commands = [...two.matchAll(block)].flatMap((m) => m[1]!.trim().split('\n'))
    const shallowCmd = commands.find((c) => c.includes('--is-shallow-repository'))
    const unshallowCmd = commands.find((c) => c.includes('--unshallow'))

    it('the step names both commands, before the hold-out and the analysis, and a stop with the command to run by hand', () => {
      expect(shallowCmd, two).toBe('git rev-parse --is-shallow-repository; echo "EXIT=$?"')
      expect(unshallowCmd, two).toBe('git fetch --unshallow origin; echo "EXIT=$?"')
      const rule = blocks(two).find((b) => b.startsWith('**Full history.**'))
      expect(rule, two).toBeDefined()
      expect(two.indexOf('**Full history.**')).toBeLessThan(two.indexOf('hold 5 pull requests out'))
      const stop = blocks(two).find((b) => /`git fetch --unshallow` failed/.test(b))
      expect(stop, two).toBeDefined()
      expect(stop).toMatch(/review-history" clean/)
      expect(stop).toMatch(/stop/i)
    })

    const dir = join(root, 'shallow')
    const env = { ...process.env, GIT_CONFIG_GLOBAL: join(root, 'no-global-git-config'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_PARAMETERS: '' }
    const git = (cwd: string, ...args: string[]): { status: number | null; out: string } => {
      const r = spawnSync('git', ['-c', 'user.name=demo', '-c', 'user.email=demo@example.invalid', '-c', 'init.defaultBranch=main', '-c', 'commit.gpgsign=false', '-c', 'protocol.file.allow=always', ...args], { cwd, env, encoding: 'utf8' })
      return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() }
    }
    /** A command of SKILL.md or check.md without its `; echo "EXIT=$?"`: quoted words are arguments, `<name>` takes its value. */
    const run = (cwd: string, cmd: string, values: Record<string, string> = {}): { status: number | null; out: string } => {
      const words = [...cmd.replace(/; echo "EXIT=\$\?"$/, '').matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!)
      expect(words[0]).toBe('git')
      return git(cwd, ...words.slice(1).map((w) => w.replace(/<[A-Za-z_]+>/g, (k) => values[k] ?? k)))
    }
    /** check.md's fetch of the pull request's head and its base branch. */
    const checkFetch = check.split('\n').find((l) => l.startsWith('git fetch origin "pull/<n>/head"'))
    /**
     * An origin with main A-B, a base branch release A-C and pull request 7 (refs/pull/7/head) A-D on release, and a
     * clone as `git clone --depth 1` makes it: of main only, one commit deep.
     */
    const shallowClone = (name: string): { clone: string; head: string } => {
      const origin = join(dir, `${name}-origin`)
      const clone = join(dir, `${name}-clone`)
      mkdirSync(origin, { recursive: true })
      const ok = (cwd: string, ...args: string[]): string => {
        const r = git(cwd, ...args)
        expect(r.status, `${args.join(' ')}: ${r.out}`).toBe(0)
        return r.out
      }
      ok(origin, 'init', '-q')
      for (const [file, from] of [['a', null], ['b', null], ['c', 'release'], ['d', 'pr']] as const) {
        if (from) ok(origin, 'switch', '-qc', from, 'main~1')
        writeFileSync(join(origin, `${file}.txt`), `${file}\n`)
        ok(origin, 'add', `${file}.txt`)
        ok(origin, 'commit', '-qm', file)
      }
      const head = ok(origin, 'rev-parse', 'HEAD')
      ok(origin, 'update-ref', 'refs/pull/7/head', head)
      ok(origin, 'switch', '-q', 'main')
      ok(origin, 'branch', '-qD', 'pr')
      ok(dir, 'clone', '-q', '--depth', '1', pathToFileURL(origin).href, clone)
      return { clone, head }
    }

    it('in a default shallow clone the base of a pull request on another branch is found after the step and the fetch of check.md', { timeout: ms(60_000) }, () => {
      const { clone, head } = shallowClone('fetch')
      expect(run(clone, shallowCmd!).out).toBe('true')
      const fetched = run(clone, unshallowCmd!)
      expect(fetched.status, fetched.out).toBe(0)
      expect(run(clone, shallowCmd!).out).toBe('false')
      // A default clone fetches main only: the fetch of check.md must still give origin/<baseRefName>.
      expect(checkFetch, check).toBeDefined()
      const pr = run(clone, checkFetch!, { '<n>': '7', '<baseRefName>': 'release' })
      expect(pr.status, pr.out).toBe(0)
      const base = git(clone, 'merge-base', 'origin/release', head)
      expect(base.status, base.out).toBe(0)
      expect(base.out).toBe(git(clone, 'rev-parse', 'origin/main~1').out)
      // Any other failure of git merge-base (128 for a missing ref) skips the pull request too.
      expect(flat(check)).toMatch(/A `git merge-base` that still exits non-zero[^.]*: this pull request goes into `skipped`/)
    })

    it('when the origin cannot be read the fetch fails with a non-zero exit, which the step turns into a stop', { timeout: ms(60_000) }, () => {
      const { clone } = shallowClone('gone')
      expect(git(clone, 'remote', 'set-url', 'origin', pathToFileURL(join(dir, 'no-such-origin')).href).status).toBe(0)
      const fetched = run(clone, unshallowCmd!)
      expect(fetched.status, fetched.out).not.toBe(0)
      expect(run(clone, shallowCmd!).out).toBe('true')
    })
  })

  it('the eval grader of a template place left takes the places of the template, not a {{ of a quote', () => {
    const grader = readFileSync(join(process.cwd(), 'harness', 'evals', 'human-review-setup-full', 'graders', 'no-template-left.md'), 'utf8')
    const m = /^pattern: '(.*)'$/m.exec(grader)
    expect(m, grader).not.toBeNull()
    const re = new RegExp(m![1]!)
    for (const place of template.match(/^\{\{rules: .*$/gm) ?? []) expect(re.test(place), place).toBe(true)
    expect(re.test('{{examples: nit}}')).toBe(true)
    expect(re.test('  > nit: `cases := []tc{{name: "a"}}` reads better')).toBe(false)
    expect(re.test('m := map[string]int{{"a", 1}}')).toBe(false)
  })

  it('write.md leaves the {{ of a quote alone: only a placeholder of the template is a finding, and the lint finds it', () => {
    const five = flat(sectionOf(write, 5, 'write.md'))
    expect(five).not.toMatch(/no `\{\{` left/)
    expect(five).toMatch(/no placeholder of the template is left/)
    expect(five).toMatch(/a `\{\{` inside a quote[^.]*is no finding/i)
  })
})

// The retro skill of the Harness classifies a failure before it looks for duplicates: a class
// confirmed by the project's lessons README, an outcome (a check or "no lesson: <reason>"), and an
// environment failure goes to the project's risks section instead of being dropped. The skill is
// shared by every project of the Harness, so its text names no path of this repository.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SKILL = join(__dirname, '..', '..', 'harness', 'skills', 'retro', 'SKILL.md')
const text = readFileSync(SKILL, 'utf8')

interface Step {
  number: number
  title: string
  body: string
}

// Steps of "## Procedure" are top-level list items of the form `N. **Title.** body`.
const procedureSteps = (): Step[] => {
  const procedure = text.split(/^## Procedure$/m)[1]?.split(/^## /m)[0] ?? ''
  const starts = [...procedure.matchAll(/^(\d+)\. \*\*([^*]+?)\.?\*\*/gm)]
  return starts.map((match, i) => ({
    number: Number(match[1]),
    title: match[2] ?? '',
    body: procedure.slice(match.index, starts[i + 1]?.index ?? procedure.length),
  }))
}

const step = (title: string): Step => {
  const found = procedureSteps().find((each) => each.title.startsWith(title))
  if (!found) throw new Error(`no step "${title}" in ${SKILL}`)
  return found
}

describe('harness/skills/retro/SKILL.md', () => {
  it('numbers the procedure steps 1, 2, 3… without gaps', () => {
    const numbers = procedureSteps().map((each) => each.number)
    expect(numbers.length).toBeGreaterThan(0)
    expect(numbers).toEqual(numbers.map((_, i) => i + 1))
  })

  it('has a Classify step right after "Filter hard" and right before "Check for duplicates"', () => {
    const titles = procedureSteps().map((each) => each.title)
    const filter = titles.findIndex((title) => title.startsWith('Filter hard'))
    expect(filter).toBeGreaterThanOrEqual(0)
    expect(titles[filter + 1]).toMatch(/^Classify/)
    expect(titles[filter + 2]).toMatch(/^Check for duplicates/)
  })

  it('classifies by the README classes, confirms the class and ends in a check or "no lesson: <reason>"', () => {
    const body = step('Classify').body
    expect(body).toMatch(/README\.md/)
    expect(body).toMatch(/class/i)
    expect(body).toMatch(/confirm/i)
    for (const check of ['test', 'hook', 'eval case']) expect(body).toContain(check)
    expect(body).toContain('no lesson: <reason>')
  })

  it('does not drop an environment failure: risks section, or a "how to recognize" lesson when it repeats', () => {
    expect(step('Filter hard').body).not.toMatch(/environment hiccups/i)
    const body = step('Classify').body
    expect(body).toMatch(/environment failure/i)
    expect(body).toMatch(/risks/i)
    expect(body).toMatch(/how to recognize/i)
  })

  // The skill names the line by what it is, not by one project's label: the Harness shell test
  // keeps Cyrillic out of skill texts (harness/bin/tests/harness-home.test.sh, section 6).
  it('writes the check line the README requires in repo mode, under the README label', () => {
    const repoMode = step('Write the entry').body.split(/^ {3}Repo mode:/m)[1] ?? ''
    expect(repoMode).toMatch(/README\.md/)
    expect(repoMode).toMatch(/requires a check line/)
    expect(repoMode).toMatch(/label the README/)
    expect(repoMode).toContain(`outcome of step ${step('Classify').number}`)
  })

  it('names no path of the worfy repository: the skill is shared by every project', () => {
    for (const path of ['docs/lessons', 'HANDOFF.md', '.scratch']) expect(text, path).not.toContain(path)
  })
})

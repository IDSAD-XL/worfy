// The CI workflow (.github/workflows/ci.yml) runs only when dispatched: once on main per Wave
// (ADR-0068, profile workflow.ci "batch"), never on a pull request or a push. A dispatch from a
// Wave asks for `job=check` and must never start the macOS runner, which costs ten times a Linux
// one. The project has no YAML parser, so the workflow is read as text, the way
// windows-tests-workflow.test.ts reads its workflow: block style, one key per line, `#` only at
// the start of comment lines.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const WORKFLOW = join(__dirname, '..', '..', '.github', 'workflows', 'ci.yml')

/** The workflow without its comment lines and blank lines. */
const code = (): string[] =>
  readFileSync(WORKFLOW, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))

const indent = (line: string): number => line.length - line.trimStart().length

/** The lines nested under the line that reads exactly `header`; there must be one such line. */
function under(lines: string[], header: string): string[] {
  expect(lines.filter((line) => line === header), `lines that read "${header}"`).toHaveLength(1)
  const nested: string[] = []
  for (const line of lines.slice(lines.indexOf(header) + 1)) {
    if (indent(line) <= indent(header)) break
    nested.push(line)
  }
  return nested
}

/** The keys one level down in a block: its least indented lines, up to the colon. */
function keys(block: string[]): string[] {
  const least = Math.min(...block.map(indent))
  return block.filter((line) => indent(line) === least).map((line) => line.trim().replace(/:.*$/, ''))
}

/** The value of `key:` among the direct children of a block. */
function value(block: string[], key: string): string | undefined {
  const least = Math.min(...block.map(indent))
  const line = block.find((l) => indent(l) === least && l.trim().startsWith(`${key}:`))
  return line?.trim().slice(key.length + 1).trim()
}

describe('ci.yml: dispatched only, the macOS job only on request', () => {
  it('has no pull_request, push or schedule trigger: workflow_dispatch is the only one', () => {
    expect(keys(under(code(), 'on:'))).toEqual(['workflow_dispatch'])
  })

  it('takes a job input: check by default, or full-macos', () => {
    const input = under(under(under(code(), 'on:'), '    inputs:'), '      job:')
    expect(value(input, 'type')).toBe('choice')
    expect(value(input, 'default')).toBe('check')
    expect(under(input, '        options:').map((l) => l.trim())).toEqual(['- check', '- full-macos'])
  })

  it('runs check only on job == check and full-macos only on job == full-macos', () => {
    const jobs = under(code(), 'jobs:')
    expect(keys(jobs)).toEqual(['check', 'full-macos'])
    expect(value(under(jobs, '  check:'), 'if')).toBe("inputs.job == 'check'")
    expect(value(under(jobs, '  full-macos:'), 'if')).toBe("inputs.job == 'full-macos'")
    expect(value(under(jobs, '  check:'), 'runs-on')).toBe('ubuntu-latest')
    expect(value(under(jobs, '  full-macos:'), 'runs-on')).toBe('macos-latest')
  })

  it('lets a newer dispatch of the same job on the same branch cancel the older one', () => {
    const group = under(code(), 'concurrency:')
    expect(value(group, 'group')).toBe('${{ github.workflow }}-${{ github.ref }}-${{ inputs.job }}')
    expect(value(group, 'cancel-in-progress')).toBe('true')
  })
})

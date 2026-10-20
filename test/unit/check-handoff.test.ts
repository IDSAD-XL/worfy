// scripts/check-handoff.mjs: the form of the state file HANDOFF.md (owner's decision H4) — at most
// 150 lines and 15360 bytes, no line over 300 characters, exactly the sections of the repository's
// scripts/doc-headings.json in order (or of the file given with --headings).
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'

const SCRIPT = join(import.meta.dirname, '..', '..', 'scripts', 'check-handoff.mjs')
const CONFIG = join(import.meta.dirname, '..', '..', 'scripts', 'doc-headings.json')
// The sections the repository's own HANDOFF.md has: the script reads them from scripts/doc-headings.json.
const SECTIONS: readonly string[] = (JSON.parse(readFileSync(CONFIG, 'utf8')) as { handoff: { sections: string[] } }).handoff.sections
const ENGLISH = ['Now', 'Waiting for the owner', 'Risks and debts', 'Next', 'Where the rest is'] as const

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})

/** Runs the script on a temporary HANDOFF.md with these lines; `pnpm test` runs under Electron as Node, so the child does too. */
function check(lines: string[], eol = '\n', args: readonly string[] = []): { status: number | null; stdout: string; stderr: string; file: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-check-handoff-')))
  dirs.push(dir)
  const file = join(dir, 'HANDOFF.md')
  writeFileSync(file, lines.map((line) => `${line}${eol}`).join(''))
  const run = spawnSync(process.execPath, [SCRIPT, ...args, file], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, file }
}

/** A HANDOFF.md of the right form: a title and the five sections, one line each. */
function good(sections: readonly string[] = SECTIONS): string[] {
  return ['# HANDOFF', '', ...sections.flatMap((title) => [`## ${title}`, '', `- an item of the section ${title}`, ''])]
}

/** `good()` padded with short lines inside the last section up to `total` lines. */
function padded(total: number): string[] {
  const lines = good()
  while (lines.length < total) lines.push(`- line ${lines.length + 1}`)
  return lines
}

/** `good()` padded with ASCII lines of at most 200 characters so the file is exactly `bytes` bytes. */
function sized(bytes: number): string[] {
  const lines = good()
  const size = (): number => Buffer.byteLength(`${lines.join('\n')}\n`)
  while (bytes - size() > 201) lines.push('a'.repeat(200))
  lines.push('a'.repeat(bytes - size() - 1))
  return lines
}

describe('check-handoff', () => {
  it('passes a file of the right form and prints one line with its lines and bytes', () => {
    const lines = good()
    const { status, stdout, stderr } = check(lines)
    expect(stderr).toBe('')
    expect(status).toBe(0)
    const bytes = Buffer.byteLength(`${lines.join('\n')}\n`)
    expect(stdout).toBe(`handoff: ok (${lines.length} lines, ${bytes} bytes)\n`)
  })

  it('passes exactly 150 lines, a line of exactly 300 Cyrillic characters, and ## inside a code block', () => {
    const lines = good()
    lines.splice(4, 0, '```bash', '## not a section but a comment in code', '```')
    while (lines.length < 149) lines.push(`- line ${lines.length + 1}`)
    lines.push('ж'.repeat(300))
    expect(lines).toHaveLength(150)
    const { status, stdout } = check(lines)
    expect(status).toBe(0)
    expect(stdout).toMatch(/^handoff: ok \(150 lines, \d+ bytes\)\n$/)
  })

  it('fails on more than 150 lines and points at line 151', () => {
    const { status, stdout, stderr, file } = check(padded(151))
    expect(status).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain(`${file}:151: the file is longer than 150 lines (151)`)
  })

  it('fails on more than 15360 bytes even when lines and line count are within limits', () => {
    // 30 lines of 290 Cyrillic characters: under 300 characters each, 580 bytes each, ~17 KB in all.
    const lines = good()
    for (let i = 0; i < 30; i++) lines.push('я'.repeat(290))
    const { status, stderr, file } = check(lines)
    expect(status).toBe(1)
    expect(stderr.split('\n').some((line) => line.startsWith(`${file}:`) && /^:\d+: the file is larger than 15360 bytes \(\d+\)/.test(line.slice(file.length)))).toBe(true)
    expect(stderr).not.toContain('line is longer')
    expect(stderr).not.toContain('file is longer')
  })

  it('passes exactly 15360 bytes and fails on 15361', () => {
    const atLimit = sized(15360)
    expect(Buffer.byteLength(`${atLimit.join('\n')}\n`)).toBe(15360)
    const pass = check(atLimit)
    expect(pass.stderr).toBe('')
    expect(pass.status).toBe(0)
    expect(pass.stdout).toBe(`handoff: ok (${atLimit.length} lines, 15360 bytes)\n`)

    const overLimit = sized(15361)
    expect(Buffer.byteLength(`${overLimit.join('\n')}\n`)).toBe(15361)
    const fail = check(overLimit)
    expect(fail.status).toBe(1)
    expect(fail.stderr).toContain(`${fail.file}:${overLimit.length}: the file is larger than 15360 bytes (15361)`)
  })

  it('counts the bytes and the lines of a CRLF working copy as git stores them, with LF', () => {
    // On Windows with core.autocrlf the file on disk ends its lines with CRLF: one more byte per line
    // than in git. The limit is on what git stores.
    const atLimit = sized(15360)
    const pass = check(atLimit, '\r\n')
    expect(pass.stderr).toBe('')
    expect(pass.status).toBe(0)
    expect(pass.stdout).toBe(`handoff: ok (${atLimit.length} lines, 15360 bytes)\n`)

    const overLimit = sized(15361)
    const fail = check(overLimit, '\r\n')
    expect(fail.status).toBe(1)
    expect(fail.stderr).toContain(`${fail.file}:${overLimit.length}: the file is larger than 15360 bytes (15361)`)

    // A line of exactly 300 characters stays within the limit: the CR is not one of its characters.
    const long = good()
    long.push('ж'.repeat(300))
    expect(check(long, '\r\n').status).toBe(0)
    // A lone CR inside a line is not a line end and is counted as it is.
    const lone = good()
    lone.push('a\rb')
    const loneRun = check(lone)
    expect(loneRun.stdout).toBe(`handoff: ok (${lone.length} lines, ${Buffer.byteLength(`${lone.join('\n')}\n`)} bytes)\n`)
  })

  it('prints the size on disk for a file with bytes that are not UTF-8', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-check-handoff-')))
    dirs.push(dir)
    const file = join(dir, 'HANDOFF.md')
    const bytes = Buffer.concat([Buffer.from(`${good().join('\n')}\n`), Buffer.from([0xff, 0xfe, 0x0a])])
    writeFileSync(file, bytes)
    const run = spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    expect(run.status).toBe(0)
    expect(run.stdout).toBe(`handoff: ok (${good().length + 1} lines, ${bytes.length} bytes)\n`)
  })

  it('fails on a line longer than 300 characters and names that line', () => {
    const lines = good()
    lines.push('ж'.repeat(301))
    const { status, stderr, file } = check(lines)
    expect(status).toBe(1)
    expect(stderr).toContain(`${file}:${lines.length}: the line is longer than 300 characters (301)`)
  })

  it.each([
    ['an extra section', [...SECTIONS.slice(0, 4), 'Wave 5', SECTIONS[4]!], 'section "Wave 5" is not one of the 5 allowed'],
    ['a missing section', SECTIONS.filter((title) => title !== SECTIONS[2]), `:1: no section "${SECTIONS[2]}"`],
    ['sections out of order', [SECTIONS[1]!, SECTIONS[0]!, ...SECTIONS.slice(2)], `section "${SECTIONS[0]}" is out of place`],
    ['a repeated section', [...SECTIONS, SECTIONS[3]!], `section "${SECTIONS[3]}" repeats (first at line`],
  ])('fails on %s among the second-level headings', (_case, sections, message) => {
    const { status, stderr } = check(good(sections))
    expect(status).toBe(1)
    expect(stderr).toContain(message)
  })

  it('reads the sections from the file given with --headings: English ones pass, the repository\'s are then unknown', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-check-handoff-')))
    dirs.push(dir)
    const config = join(dir, 'headings.json')
    writeFileSync(config, JSON.stringify({ handoff: { sections: ENGLISH } }))
    const english = check(good(ENGLISH), '\n', ['--headings', config])
    expect(english.stderr).toBe('')
    expect(english.status).toBe(0)
    const repository = check(good(), '\n', ['--headings', config])
    expect(repository.status).toBe(1)
    expect(repository.stderr).toContain(`section "${SECTIONS[0]}" is not one of the 5 allowed: "Now", "Waiting for the owner"`)
    expect(repository.stderr).toContain(':1: no section "Now" (heading "## Now")')
    // Without --headings the repository's own config is read: English sections are not its sections.
    expect(check(good(ENGLISH)).status).toBe(1)
  })

  it.each([
    ['a missing file', null, 'cannot be read'],
    ['a file that is not JSON', '{', 'is not JSON'],
    ['no handoff.sections', '{"handoff":{}}', 'handoff.sections is a list of section names'],
    ['an empty list', '{"handoff":{"sections":[]}}', 'handoff.sections is a list of section names'],
    ['a blank name', '{"handoff":{"sections":["Now"," "]}}', 'handoff.sections is a list of section names'],
  ])('exits 2 when the headings config is %s', (_case, text, message) => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-check-handoff-')))
    dirs.push(dir)
    const config = join(dir, 'headings.json')
    if (text !== null) writeFileSync(config, text)
    const { status, stdout, stderr } = check(good(), '\n', ['--headings', config])
    expect(status).toBe(2)
    expect(stdout).toBe('')
    expect(stderr).toContain(config)
    expect(stderr).toContain(message)
  })

  it('exits 2 when the file cannot be read', () => {
    const run = spawnSync(process.execPath, [SCRIPT, join(tmpdir(), 'worfy-check-handoff-missing', 'HANDOFF.md')], {
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
    expect(run.status).toBe(2)
    expect(run.stderr).toContain('cannot be read')
  })
})

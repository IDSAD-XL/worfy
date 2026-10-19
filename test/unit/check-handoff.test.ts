// scripts/check-handoff.mjs: the form of the state file HANDOFF.md (owner's decision H4) — at most
// 150 lines and 15360 bytes, no line over 300 characters, exactly the five sections in order.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'

const SCRIPT = join(import.meta.dirname, '..', '..', 'scripts', 'check-handoff.mjs')
const SECTIONS = ['Сейчас в работе', 'Ждёт владельца', 'Риски и долги', 'Дальше', 'Где остальное'] as const

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})

/** Runs the script on a temporary HANDOFF.md with these lines; `pnpm test` runs under Electron as Node, so the child does too. */
function check(lines: string[], eol = '\n'): { status: number | null; stdout: string; stderr: string; file: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-check-handoff-')))
  dirs.push(dir)
  const file = join(dir, 'HANDOFF.md')
  writeFileSync(file, lines.map((line) => `${line}${eol}`).join(''))
  const run = spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, file }
}

/** A HANDOFF.md of the right form: a title and the five sections, one line each. */
function good(sections: readonly string[] = SECTIONS): string[] {
  return ['# HANDOFF', '', ...sections.flatMap((title) => [`## ${title}`, '', `- пункт раздела «${title}»`, ''])]
}

/** `good()` padded with short lines inside the last section up to `total` lines. */
function padded(total: number): string[] {
  const lines = good()
  while (lines.length < total) lines.push(`- строка ${lines.length + 1}`)
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
    expect(stdout).toBe(`handoff: ok (${lines.length} строк, ${bytes} байт)\n`)
  })

  it('passes exactly 150 lines, a line of exactly 300 Cyrillic characters, and ## inside a code block', () => {
    const lines = good()
    lines.splice(4, 0, '```bash', '## не раздел, а комментарий в коде', '```')
    while (lines.length < 149) lines.push(`- строка ${lines.length + 1}`)
    lines.push('ж'.repeat(300))
    expect(lines).toHaveLength(150)
    const { status, stdout } = check(lines)
    expect(status).toBe(0)
    expect(stdout).toMatch(/^handoff: ok \(150 строк, \d+ байт\)\n$/)
  })

  it('fails on more than 150 lines and points at line 151', () => {
    const { status, stdout, stderr, file } = check(padded(151))
    expect(status).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain(`${file}:151: файл длиннее 150 строк (151)`)
  })

  it('fails on more than 15360 bytes even when lines and line count are within limits', () => {
    // 30 lines of 290 Cyrillic characters: under 300 characters each, 580 bytes each, ~17 KB in all.
    const lines = good()
    for (let i = 0; i < 30; i++) lines.push('я'.repeat(290))
    const { status, stderr, file } = check(lines)
    expect(status).toBe(1)
    expect(stderr.split('\n').some((line) => line.startsWith(`${file}:`) && /^:\d+: файл больше 15360 байт \(\d+\)/.test(line.slice(file.length)))).toBe(true)
    expect(stderr).not.toContain('строка длиннее')
    expect(stderr).not.toContain('файл длиннее')
  })

  // Windows: 13 s, 2x the 6.2 s it ran in the full run on the PC (2026-10-19), where it hit the 5 s limit; 0.8 s with six other files.
  it('passes exactly 15360 bytes and fails on 15361', () => {
    const atLimit = sized(15360)
    expect(Buffer.byteLength(`${atLimit.join('\n')}\n`)).toBe(15360)
    const pass = check(atLimit)
    expect(pass.stderr).toBe('')
    expect(pass.status).toBe(0)
    expect(pass.stdout).toBe(`handoff: ok (${atLimit.length} строк, 15360 байт)\n`)

    const overLimit = sized(15361)
    expect(Buffer.byteLength(`${overLimit.join('\n')}\n`)).toBe(15361)
    const fail = check(overLimit)
    expect(fail.status).toBe(1)
    expect(fail.stderr).toContain(`${fail.file}:${overLimit.length}: файл больше 15360 байт (15361)`)
  }, process.platform === 'win32' ? 13_000 : undefined)

  it('counts the bytes and the lines of a CRLF working copy as git stores them, with LF', () => {
    // On Windows with core.autocrlf the file on disk ends its lines with CRLF: one more byte per line
    // than in git. The limit is on what git stores.
    const atLimit = sized(15360)
    const pass = check(atLimit, '\r\n')
    expect(pass.stderr).toBe('')
    expect(pass.status).toBe(0)
    expect(pass.stdout).toBe(`handoff: ok (${atLimit.length} строк, 15360 байт)\n`)

    const overLimit = sized(15361)
    const fail = check(overLimit, '\r\n')
    expect(fail.status).toBe(1)
    expect(fail.stderr).toContain(`${fail.file}:${overLimit.length}: файл больше 15360 байт (15361)`)

    // A line of exactly 300 characters stays within the limit: the CR is not one of its characters.
    const long = good()
    long.push('ж'.repeat(300))
    expect(check(long, '\r\n').status).toBe(0)
    // A lone CR inside a line is not a line end and is counted as it is.
    const lone = good()
    lone.push('a\rb')
    const loneRun = check(lone)
    expect(loneRun.stdout).toBe(`handoff: ok (${lone.length} строк, ${Buffer.byteLength(`${lone.join('\n')}\n`)} байт)\n`)
  })

  it('prints the size on disk for a file with bytes that are not UTF-8', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-check-handoff-')))
    dirs.push(dir)
    const file = join(dir, 'HANDOFF.md')
    const bytes = Buffer.concat([Buffer.from(`${good().join('\n')}\n`), Buffer.from([0xff, 0xfe, 0x0a])])
    writeFileSync(file, bytes)
    const run = spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    expect(run.status).toBe(0)
    expect(run.stdout).toBe(`handoff: ok (${good().length + 1} строк, ${bytes.length} байт)\n`)
  })

  it('fails on a line longer than 300 characters and names that line', () => {
    const lines = good()
    lines.push('ж'.repeat(301))
    const { status, stderr, file } = check(lines)
    expect(status).toBe(1)
    expect(stderr).toContain(`${file}:${lines.length}: строка длиннее 300 символов (301)`)
  })

  it.each([
    ['an extra section', [...SECTIONS.slice(0, 4), 'Wave 5', SECTIONS[4]], 'раздел «Wave 5» не из пяти разрешённых'],
    ['a missing section', SECTIONS.filter((title) => title !== 'Риски и долги'), ':1: нет раздела «Риски и долги»'],
    ['sections out of order', [SECTIONS[1], SECTIONS[0], ...SECTIONS.slice(2)], 'раздел «Сейчас в работе» не на своём месте'],
    ['a repeated section', [...SECTIONS, 'Дальше'], 'раздел «Дальше» повторяется (первый — строка'],
  ])('fails on %s among the second-level headings', (_case, sections, message) => {
    const { status, stderr } = check(good(sections))
    expect(status).toBe(1)
    expect(stderr).toContain(message)
  })

  it('exits 2 when the file cannot be read', () => {
    const run = spawnSync(process.execPath, [SCRIPT, join(tmpdir(), 'worfy-check-handoff-missing', 'HANDOFF.md')], {
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
    expect(run.status).toBe(2)
    expect(run.stderr).toContain('не читается')
  })
})

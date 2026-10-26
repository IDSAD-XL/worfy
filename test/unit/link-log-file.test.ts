// The link's journal in a file (worfy-link ticket 36; src/main/link/log-file.ts): `[link]` lines
// with their time, rotation by size within a total limit, and no token or pairing code in the file.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LINK_LOG_FILE, LinkLogFile, redactSecrets, teeLinkConsole } from '../../src/main/link/log-file'
import { removeTestTree } from '../remove'

let dir: string
let undo: (() => void) | undefined

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'worfy-link-log-')), 'link')
})

afterEach(() => {
  undo?.()
  undo = undefined
  vi.restoreAllMocks()
  removeTestTree(join(dir, '..'))
})

const read = (name = LINK_LOG_FILE): string => readFileSync(join(dir, name), 'utf8')

describe('the link journal in a file', () => {
  it('copies the [link] lines printed through console, with their time, and nothing else', () => {
    const printed: string[] = []
    for (const method of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void printed.push(String(args[0])))
    undo = teeLinkConsole(new LinkLogFile({ dir, now: () => Date.parse('2026-10-27T08:00:00.000Z') }))

    console.warn('[link] Machine %s is no longer linked', '11111111-2222-4333-8444-555555555555')
    console.log('[link] this Machine woke up')
    console.error('[terminal] not a link line')
    console.info({ text: '[link] not a string first' })

    expect(read()).toBe(
      '2026-10-27T08:00:00.000Z [link] Machine 11111111-2222-4333-8444-555555555555 is no longer linked\n2026-10-27T08:00:00.000Z [link] this Machine woke up\n',
    )
    // The console still prints every line.
    expect(printed).toHaveLength(4)
    // The file is this user's only.
    if (process.platform !== 'win32') expect(statSync(join(dir, LINK_LOG_FILE)).mode & 0o777).toBe(0o600)

    const wrapped = console.warn
    undo()
    undo = undefined
    expect(console.warn).not.toBe(wrapped)
    console.warn('[link] after the undo')
    expect(read()).not.toContain('after the undo')
  })

  it('the undo under another wrapper leaves that wrapper in place and stops copying', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    undo = teeLinkConsole(new LinkLogFile({ dir }))
    const ours = console.warn
    const theirs = (...args: unknown[]): void => ours(...args)
    console.warn = theirs
    try {
      console.warn('[link] while both wrap')
      undo()
      undo = undefined
      expect(console.warn).toBe(theirs)
      console.warn('[link] after the undo')
      expect(read()).toContain('while both wrap')
      expect(read()).not.toContain('after the undo')
    } finally {
      console.warn = ours
    }
  })

  it('rotates by size and keeps at most the given number of old files', () => {
    const log = new LinkLogFile({ dir, maxBytes: 200, files: 2 })
    for (let index = 0; index < 40; index += 1) log.write(`[link] line ${String(index).padStart(2, '0')} ${'x'.repeat(40)}`)

    expect(readdirSync(dir).sort()).toEqual([LINK_LOG_FILE, `${LINK_LOG_FILE}.1`, `${LINK_LOG_FILE}.2`])
    for (const name of readdirSync(dir)) expect(statSync(join(dir, name)).size).toBeLessThanOrEqual(200)
    // The newest line is in the file, the ones before it in .1, then .2; the oldest are gone.
    expect(read()).toContain('line 39')
    expect(read(`${LINK_LOG_FILE}.1`)).not.toContain('line 39')
    expect(read(`${LINK_LOG_FILE}.2`)).not.toContain('line 00')
    const all = [read(`${LINK_LOG_FILE}.2`), read(`${LINK_LOG_FILE}.1`), read()].join('')
    const numbers = [...all.matchAll(/line (\d\d)/g)].map((match) => Number(match[1]))
    expect(numbers).toEqual([...numbers].sort((x, y) => x - y))
    expect(numbers.at(-1)).toBe(39)
  })

  it('a rotation that fails (EBUSY on Windows) keeps the lines in the current file, says so once, and is tried again', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let busy = true
    const log = new LinkLogFile({
      dir,
      maxBytes: 200,
      rename: (from, to) => {
        if (busy) throw Object.assign(new Error(`EBUSY: resource busy or locked, rename '${from}'`), { code: 'EBUSY' })
        renameSync(from, to)
      },
    })
    for (let index = 0; index < 10; index += 1) log.write(`[link] line ${index} ${'x'.repeat(40)}`)

    expect(readdirSync(dir)).toEqual([LINK_LOG_FILE])
    expect(read()).toContain('line 0 ')
    expect(read()).toContain('line 9 ')
    expect(statSync(join(dir, LINK_LOG_FILE)).size).toBeGreaterThan(200)
    expect(warn.mock.calls.filter(([text]) => String(text).includes('could not rotate'))).toHaveLength(1)

    busy = false
    log.write('[link] line 10')
    expect(readdirSync(dir).sort()).toEqual([LINK_LOG_FILE, `${LINK_LOG_FILE}.1`])
    expect(read()).toContain('line 10')
    expect(read(`${LINK_LOG_FILE}.1`)).toContain('line 9 ')
  })

  it('never writes a token or a pairing code, and leaves Machine ids, ports and times alone', () => {
    const token = 'q3V_k9-Zr2xLm8NpT4wYb6cHd1eFg7jKs5aUo0iRvEt'
    const log = new LinkLogFile({ dir })
    log.write(`[link] sent Authorization: Bearer ${token} to 192.168.1.20:52000`)
    log.write(`[link] a pairing attempt with code 482913 failed; token ${token}`)
    log.write('[link] Machine 12345678-1234-4123-8123-123456789012 (PC) answered at 192.168.1.20:52000 at 2026-10-27T08:00:00.000Z')

    const text = read()
    expect(text).not.toContain(token)
    expect(text).not.toContain('482913')
    expect(text).toContain('Bearer [redacted]')
    expect(text).toContain('code [code] failed')
    expect(text).toContain('Machine 12345678-1234-4123-8123-123456789012 (PC) answered at 192.168.1.20:52000 at 2026-10-27T08:00:00.000Z')
    expect(redactSecrets('[link] port 52000, pid 4242')).toBe('[link] port 52000, pid 4242')
  })

  it('a file that cannot be written stops the journal with one warning, never an exception', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    // Where the folder should be there is a file: nothing can be created in it.
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'not-a-folder'), '')
    const log = new LinkLogFile({ dir: join(dir, 'not-a-folder', 'link') })
    expect(() => {
      log.write('[link] one')
      log.write('[link] two')
    }).not.toThrow()
    expect(existsSync(join(dir, 'not-a-folder', 'link'))).toBe(false)
    expect(warn.mock.calls.filter(([text]) => String(text).includes('cannot be written'))).toHaveLength(1)
  })
})

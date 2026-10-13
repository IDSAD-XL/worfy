import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { readJsonFile, writeJsonFile } from '../../src/main/storage/json-file'
import { removeTestTree } from '../remove'

// node:fs as it is, except that writeFileSync is a spy: one test makes a write stop halfway.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, writeFileSync: vi.fn(actual.writeFileSync) }
})

const schema = z.object({ name: z.string(), count: z.number().int() })

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worfy-json-file-'))
  file = join(dir, 'state.json')
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  removeTestTree(dir)
})

const now = () => new Date('2026-10-05T07:08:09.010Z')
const ASIDE = 'state.json.unreadable-2026-10-05T07-08-09-010Z'

describe('readJsonFile', () => {
  it('sets an unparsable file aside as <name>.unreadable-<time> and reports nothing saved', () => {
    writeFileSync(file, '{ "name": "half-written')
    expect(readJsonFile(file, schema, { now })).toBeUndefined()
    expect(existsSync(file)).toBe(false)
    expect(readFileSync(join(dir, ASIDE), 'utf8')).toBe('{ "name": "half-written')
  })

  it('sets aside a file that parses but does not match the schema', () => {
    writeFileSync(file, JSON.stringify({ name: 'x', count: 'many' }))
    expect(readJsonFile(file, schema, { now })).toBeUndefined()
    expect(readdirSync(dir)).toEqual([ASIDE])
  })

  it('never overwrites an earlier set-aside file with the same time', () => {
    writeFileSync(file, 'first')
    readJsonFile(file, schema, { now })
    writeFileSync(file, 'second')
    readJsonFile(file, schema, { now })
    expect(readdirSync(dir).sort()).toEqual([ASIDE, `${ASIDE}-1`])
    expect(readFileSync(join(dir, ASIDE), 'utf8')).toBe('first')
    expect(readFileSync(join(dir, `${ASIDE}-1`), 'utf8')).toBe('second')
  })

  it('returns undefined for a missing file and creates nothing', () => {
    expect(readJsonFile(file, schema)).toBeUndefined()
    expect(readdirSync(dir)).toEqual([])
  })

  it('throws on a read error other than a missing file, and neither sets the path aside nor touches it', () => {
    // A directory where the file should be: readFileSync fails with EISDIR.
    mkdirSync(join(file, 'child'), { recursive: true })
    expect(() => readJsonFile(file, schema, { now })).toThrow(/EISDIR/)
    expect(readdirSync(dir)).toEqual(['state.json'])
    expect(readdirSync(file)).toEqual(['child'])
  })

  it.skipIf(process.getuid?.() === 0)('throws when the file cannot be read for lack of permission, and keeps it', () => {
    writeFileSync(file, JSON.stringify({ name: 'saved', count: 1 }))
    chmodSync(file, 0o000)
    try {
      expect(() => readJsonFile(file, schema, { now })).toThrow(/EACCES/)
    } finally {
      chmodSync(file, 0o644)
    }
    expect(readdirSync(dir)).toEqual(['state.json'])
    expect(readJsonFile(file, schema)).toStrictEqual({ name: 'saved', count: 1 })
  })

  it('returns the parsed value, without keys the schema does not declare', () => {
    writeFileSync(file, JSON.stringify({ name: 'x', count: 2, secret: 'kept-out' }))
    expect(readJsonFile(file, schema)).toStrictEqual({ name: 'x', count: 2 })
  })
})

describe('writeJsonFile', () => {
  it('writes a value that reads back, creating the directory', () => {
    const nested = join(dir, 'a', 'b', 'state.json')
    writeJsonFile(nested, schema, { name: 'x', count: 1 })
    expect(readJsonFile(nested, schema)).toStrictEqual({ name: 'x', count: 1 })
  })

  it('writes only the keys the schema declares', () => {
    writeJsonFile(file, schema, { name: 'x', count: 1, secret: 'kept-out' } as z.input<typeof schema>)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toStrictEqual({ name: 'x', count: 1 })
  })

  it('refuses a value outside the schema and leaves the existing file as it was', () => {
    writeJsonFile(file, schema, { name: 'x', count: 1 })
    const before = readFileSync(file, 'utf8')
    expect(() => writeJsonFile(file, schema, { name: 'x', count: 1.5 })).toThrow(/state\.json/)
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(readdirSync(dir)).toEqual(['state.json'])
  })

  it('replaces the file through a temporary file and a rename, leaving no temporary file behind', () => {
    writeJsonFile(file, schema, { name: 'x', count: 1 })
    writeJsonFile(file, schema, { name: 'y', count: 2 })
    expect(readdirSync(dir)).toEqual(['state.json'])
    expect(readJsonFile(file, schema)).toStrictEqual({ name: 'y', count: 2 })
  })

  it('leaves the old file whole when a write stops halfway', async () => {
    const fs = await import('node:fs')
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
    writeJsonFile(file, schema, { name: 'old', count: 1 })
    const before = readFileSync(file, 'utf8')
    // The next write puts half of its text wherever it was asked to, then fails (a full disk).
    vi.mocked(fs.writeFileSync).mockImplementationOnce((path, data) => {
      const text = String(data)
      actual.writeFileSync(path, text.slice(0, text.length >> 1))
      throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' })
    })
    expect(() => writeJsonFile(file, schema, { name: 'a much longer new value', count: 2 })).toThrow(/ENOSPC/)
    expect(vi.mocked(fs.writeFileSync).mock.calls.at(-1)?.[0]).not.toBe(file)
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(readdirSync(dir)).toEqual(['state.json'])
  })

  it('removes the temporary file when the final rename fails', () => {
    // A non-empty directory where the file should go: the temporary file is written, then the
    // rename over the directory fails.
    const blocked = join(dir, 'blocked.json')
    mkdirSync(join(blocked, 'child'), { recursive: true })
    expect(() => writeJsonFile(blocked, schema, { name: 'new', count: 1 })).toThrow()
    expect(readdirSync(dir)).toEqual(['blocked.json'])
    expect(readdirSync(blocked)).toEqual(['child'])
  })
})

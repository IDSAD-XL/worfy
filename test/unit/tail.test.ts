import { appendFile, mkdtemp, rm, truncate, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readNewLines, type TailCursor } from '../../src/main/claude-home/tail'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'worfy-tail-'))
  file = join(dir, 'session.jsonl')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('readNewLines', () => {
  it('keeps a half-written last line for the next read, then returns it once', async () => {
    await writeFile(file, '{"n":1}\n{"n":2')
    const first = await readNewLines(file)
    expect(first.lines).toEqual(['{"n":1}'])
    expect(first.reset).toBe(false)
    expect(first.cursor.offset).toBe(Buffer.byteLength('{"n":1}\n'))

    // Nothing new yet: the half line is still waiting and is not returned twice.
    expect((await readNewLines(file, first.cursor)).lines).toEqual([])

    await appendFile(file, '}\n{"n":3}\n')
    const second = await readNewLines(file, first.cursor)
    expect(second.lines).toEqual(['{"n":2}', '{"n":3}'])
    expect((await readNewLines(file, second.cursor)).lines).toEqual([])
  })

  it('returns only what was appended after the cursor', async () => {
    await writeFile(file, '{"n":1}\n')
    const first = await readNewLines(file)
    await appendFile(file, '{"n":2}\n')
    const second = await readNewLines(file, first.cursor)
    expect(second.lines).toEqual(['{"n":2}'])
    expect(second.reset).toBe(false)
  })

  it('does not split a multi-byte character that straddles two reads', async () => {
    const line = JSON.stringify({ text: 'проект ✓' })
    const bytes = Buffer.from(`${line}\n`)
    // Cut inside the "✓" (three bytes in UTF-8).
    const cut = bytes.indexOf(Buffer.from('✓')) + 1
    await writeFile(file, bytes.subarray(0, cut))
    const first = await readNewLines(file)
    expect(first.lines).toEqual([])
    await appendFile(file, bytes.subarray(cut))
    expect((await readNewLines(file, first.cursor)).lines).toEqual([line])
  })

  it('rereads from the start when the file was truncated', async () => {
    await writeFile(file, '{"n":1}\n{"n":2}\n')
    const first = await readNewLines(file)
    await truncate(file, 0)
    await appendFile(file, '{"n":9}\n')
    const second = await readNewLines(file, first.cursor)
    expect(second.reset).toBe(true)
    expect(second.lines).toEqual(['{"n":9}'])
  })

  // APFS gives a new file a new inode; ext4 on the Linux CI runner reuses the freed one at once.
  // worfy runs on macOS only; the Mac runs this in every gate.
  it.skipIf(process.platform !== 'darwin')('rereads from the start when the file was replaced by a new one', async () => {
    await writeFile(file, '{"n":1}\n')
    const first = await readNewLines(file)
    await unlink(file)
    // Longer than before, so the offset alone would not notice the replacement.
    await writeFile(file, '{"n":7}\n{"n":8}\n{"n":9}\n')
    const second = await readNewLines(file, first.cursor)
    expect(second.reset).toBe(true)
    expect(second.lines).toEqual(['{"n":7}', '{"n":8}', '{"n":9}'])
  })

  it('rereads from the start when the byte before the cursor is no longer a line end', async () => {
    await writeFile(file, '{"n":1}\n')
    const first = await readNewLines(file)
    // Same file, rewritten in place with different content of a larger size.
    await writeFile(file, '{"changed":true}\n')
    const second = await readNewLines(file, first.cursor)
    expect(second.reset).toBe(true)
    expect(second.lines).toEqual(['{"changed":true}'])
  })

  it('reads a large backlog in bounded chunks without losing or repeating lines', async () => {
    const all = Array.from({ length: 500 }, (_, n) => JSON.stringify({ n, pad: 'x'.repeat(200) }))
    await writeFile(file, `${all.join('\n')}\n`)
    const seen: string[] = []
    let cursor: TailCursor | undefined
    for (let round = 0; round < 100; round += 1) {
      const chunk = await readNewLines(file, cursor, { maxBytes: 4096 })
      if (chunk.lines.length === 0) break
      expect(chunk.more || chunk.cursor.offset === Buffer.byteLength(`${all.join('\n')}\n`)).toBe(true)
      seen.push(...chunk.lines)
      cursor = chunk.cursor
    }
    expect(seen).toEqual(all)
  })

  it('returns a line longer than maxBytes whole', async () => {
    const long = JSON.stringify({ text: 'y'.repeat(10_000) })
    await writeFile(file, `${long}\n{"n":2}\n`)
    const chunk = await readNewLines(file, undefined, { maxBytes: 1024 })
    expect(chunk.lines[0]).toBe(long)
  })

  it('counts the bytes it read: the whole file first, then the appended lines and the byte before the cursor', async () => {
    const file = join(dir, 'counted.jsonl')
    await writeFile(file, '{"n":1}\n{"n":2}\n')
    const first = await readNewLines(file)
    expect(first.bytesRead).toBe(16)
    await appendFile(file, '{"n":3}\n')
    expect((await readNewLines(file, first.cursor)).bytesRead).toBe(1 + 8)
  })

  it('treats a missing file as empty', async () => {
    const chunk = await readNewLines(join(dir, 'absent.jsonl'))
    expect(chunk).toEqual({ lines: [], cursor: { offset: 0, fileId: null }, reset: false, more: false, bytesRead: 0 })
  })
})

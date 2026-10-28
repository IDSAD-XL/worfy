import { appendFile, mkdtemp, rm, truncate, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fileFacts, readLinesBefore, readNewLines, type TailCursor } from '../../src/main/claude-home/tail'

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

  // Not on Linux: ext4 on the CI runner gives a new file the inode just freed, so the file id does
  // not change. APFS gives a new inode. NTFS takes the freed file record again but raises its
  // sequence number, which is part of the id Node reports as `ino`. worfy runs on macOS and
  // Windows; the Mac and the Windows PC run this in every gate.
  it.skipIf(process.platform === 'linux')('rereads from the start when the file was replaced by a new one', async () => {
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
    expect(chunk).toEqual({ lines: [], offsets: [], cursor: { offset: 0, fileId: null }, reset: false, more: false, bytesRead: 0 })
  })

  it('gives the byte offset of each line it returns, CRLF and empty lines included in the count', async () => {
    await writeFile(file, '{"n":1}\r\n\n{"n":2}\n')
    const first = await readNewLines(file)
    expect(first.lines).toEqual(['{"n":1}', '{"n":2}'])
    expect(first.offsets).toEqual([0, 10])
    await appendFile(file, '{"n":3}\n')
    expect((await readNewLines(file, first.cursor)).offsets).toEqual([18])
  })

  it('counts offsets in bytes, not characters: a line of two-byte characters moves the next one by its bytes', async () => {
    // '\u0436' is two bytes in UTF-8: the first line is 14 characters and 19 bytes with its line end.
    const wide = `{"t":"${'\u0436'.repeat(5)}"}`
    await writeFile(file, `${wide}\n{"n":2}\n`)
    const chunk = await readNewLines(file)
    expect(chunk.lines).toEqual([wide, '{"n":2}'])
    expect(chunk.offsets).toEqual([0, Buffer.byteLength(`${wide}\n`)])
    expect(chunk.offsets[1]).toBe(19)
  })
})

// The window read from the end of a transcript (worfy-ui ticket 21).
describe('readLinesBefore', () => {
  /** Lines `{"n":N}` padded to `width` bytes with their line end. */
  const padded = (count: number, width = 100, eol = '\n') =>
    Array.from({ length: count }, (_, n) => {
      const head = `{"n":${n},"pad":"`
      return `${head}${'x'.repeat(width - head.length - 2 - eol.length)}"}${eol}`
    })

  it('reads the window at the end, drops the line cut at its start, and names where that line starts', async () => {
    const all = padded(100)
    await writeFile(file, all.join(''))
    // 250 bytes: lines 98 and 99 whole, line 97 cut in half.
    const chunk = await readLinesBefore(file, { windowBytes: 250 })
    expect(chunk.lines).toEqual([all[98]?.trimEnd(), all[99]?.trimEnd()])
    expect(chunk.offsets).toEqual([9800, 9900])
    expect(chunk.start).toBe(9800)
    expect(chunk.cursor.offset).toBe(10_000)
    expect(chunk.reset).toBe(false)
    expect(chunk.bytesRead).toBe(251)
  })

  it('keeps a line that starts exactly at the window', async () => {
    const all = padded(10)
    await writeFile(file, all.join(''))
    const chunk = await readLinesBefore(file, { windowBytes: 300 })
    expect(chunk.lines).toHaveLength(3)
    expect(chunk.start).toBe(700)
    expect(chunk.lines[0]).toBe(all[7]?.trimEnd())
  })

  it('reads a file smaller than the window whole, and an empty file as nothing', async () => {
    const all = padded(5)
    await writeFile(file, all.join(''))
    const chunk = await readLinesBefore(file, { windowBytes: 4096 })
    expect(chunk.lines).toHaveLength(5)
    expect(chunk.start).toBe(0)
    expect(chunk.bytesRead).toBe(500)
    await writeFile(file, '')
    expect(await readLinesBefore(file, { windowBytes: 4096 })).toMatchObject({ lines: [], offsets: [], start: 0, cursor: { offset: 0 }, reset: false })
    expect(await readLinesBefore(join(dir, 'absent.jsonl'), { windowBytes: 4096 })).toMatchObject({ lines: [], start: 0, cursor: { offset: 0, fileId: null } })
  })

  it('reads CRLF lines without the carriage return, at the right offsets', async () => {
    const all = padded(10, 100, '\r\n')
    await writeFile(file, all.join(''))
    const chunk = await readLinesBefore(file, { windowBytes: 250 })
    expect(chunk.lines).toEqual([all[8]?.slice(0, -2), all[9]?.slice(0, -2)])
    expect(chunk.offsets).toEqual([800, 900])
  })

  it('leaves a half-written last line to the forward reader: the cursor stops before it', async () => {
    const all = padded(10)
    await writeFile(file, `${all.join('')}{"n":10,"half`)
    const chunk = await readLinesBefore(file, { windowBytes: 300 })
    expect(chunk.lines.at(-1)).toBe(all[9]?.trimEnd())
    expect(chunk.cursor.offset).toBe(1000)
    await appendFile(file, '"}\n')
    expect((await readNewLines(file, chunk.cursor)).lines).toEqual(['{"n":10,"half"}'])
  })

  it('grows back over a line longer than the window, so the window before a long line returns it whole', async () => {
    // Lines 0..19 of 100 bytes, then one line of 5011 bytes, then a short one.
    const long = `{"long":"${'y'.repeat(5000)}"}`
    await writeFile(file, `${padded(20).join('')}${long}\n{"n":2}\n`)
    const tail = await readLinesBefore(file, { windowBytes: 1000 })
    expect(tail.lines).toEqual(['{"n":2}'])
    expect(tail.start).toBe(2000 + long.length + 1)
    // 3000 bytes hold no start of a line before the long one; the window doubles to 6000 and does.
    const earlier = await readLinesBefore(file, { windowBytes: 3000, before: { offset: tail.start, fileId: tail.cursor.fileId } })
    expect(earlier.lines.at(-1)).toBe(long)
    expect(earlier.start).toBe(1100)
    expect(earlier.lines).toHaveLength(10)
  })

  it('the window at the end whose only line is longer than the window grows back to that line', async () => {
    const long = `{"long":"${'y'.repeat(5000)}"}`
    await writeFile(file, `${padded(20).join('')}${long}\n`)
    const tail = await readLinesBefore(file, { windowBytes: 3000 })
    expect(tail.lines.at(-1)).toBe(long)
    expect(tail.start).toBe(1100)
  })

  it('walks back window by window over the whole file without a gap or a repeat', async () => {
    const all = padded(500, 37)
    await writeFile(file, all.join(''))
    const seen: string[] = []
    let chunk = await readLinesBefore(file, { windowBytes: 1000 })
    seen.unshift(...chunk.lines)
    for (let round = 0; round < 100 && chunk.start > 0; round += 1) {
      chunk = await readLinesBefore(file, { windowBytes: 1000, before: { offset: chunk.start, fileId: chunk.cursor.fileId } })
      seen.unshift(...chunk.lines)
    }
    expect(seen).toEqual(all.map((line) => line.trimEnd()))
  })

  it('answers reset when the window\'s end no longer starts a line of the same file', async () => {
    const all = padded(10)
    await writeFile(file, all.join(''))
    const tail = await readLinesBefore(file, { windowBytes: 300 })
    const before = { offset: tail.start, fileId: tail.cursor.fileId }
    expect((await readLinesBefore(file, { windowBytes: 300, before: { ...before, fileId: 'other:file' } })).reset).toBe(true)
    await writeFile(file, 'x'.repeat(2000))
    expect((await readLinesBefore(file, { windowBytes: 300, before })).reset).toBe(true)
    await truncate(file, 100)
    expect((await readLinesBefore(file, { windowBytes: 300, before })).reset).toBe(true)
  })

  it('answers reset when the file is gone and the window had a start inside it', async () => {
    const all = padded(10)
    await writeFile(file, all.join(''))
    const tail = await readLinesBefore(file, { windowBytes: 300 })
    await unlink(file)
    const chunk = await readLinesBefore(file, { windowBytes: 300, before: { offset: tail.start, fileId: tail.cursor.fileId } })
    expect(chunk).toMatchObject({ lines: [], offsets: [], reset: true })
  })

  it('counts offsets in bytes, not characters, reading back', async () => {
    // Each line holds two-byte characters ('\u0436'): 4 lines of 19 bytes each.
    const wide = (n: number) => `{"${n}":"${'\u0436'.repeat(5)}"}`
    await writeFile(file, [0, 1, 2, 3].map((n) => `${wide(n)}\n`).join(''))
    expect(Buffer.byteLength(`${wide(0)}\n`)).toBe(19)
    const chunk = await readLinesBefore(file, { windowBytes: 40 })
    expect(chunk.lines).toEqual([wide(2), wide(3)])
    expect(chunk.offsets).toEqual([38, 57])
    expect(chunk.start).toBe(38)
  })
})

describe('fileFacts', () => {
  // NTFS file ids have 64 bits; these two differ by one and round to one number.
  const big = 2n ** 60n
  const handle = (ino: bigint) => ({
    stat: (options?: { bigint?: boolean }) =>
      Promise.resolve(options?.bigint ? { dev: 7n, ino, size: 12n } : { dev: 7, ino: Number(ino), size: 12 }),
  })

  it('tells apart two files whose ids differ beyond the precision of a number', async () => {
    expect(Number(big + 1n)).toBe(Number(big + 2n))
    const first = await fileFacts(handle(big + 1n) as never)
    const second = await fileFacts(handle(big + 2n) as never)
    expect(first).toStrictEqual({ fileId: `7:${big + 1n}`, size: 12 })
    expect(second.fileId).not.toBe(first.fileId)
  })
})

// Find in the part of a transcript the Session view has not read (worfy-ui ticket 26,
// src/main/claude-home/transcript-find.ts), and the fields find counts in
// (src/shared/transcript/find.ts): the byte where each line with matches starts, only lines that end
// before `before`, the latest lines only with the rest counted in `skipped`, a line written with JSON
// escapes still searched, and a turn of the event loop between slices of the file.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findInTranscript } from '../../src/main/claude-home/transcript-find'
import type { AgentEvent } from '../../src/shared/agent/events'
import { countMatches, eventFindTexts, eventMatches, findNeedle } from '../../src/shared/transcript/find'
import { mainThreadEvents, timedEvent } from '../../src/shared/transcript/parse'
import { removeTestTree } from '../remove'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})

function file(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'worfy-transcript-find-'))
  dirs.push(dir)
  const path = join(dir, 'session.jsonl')
  writeFileSync(path, text)
  return path
}

const user = (text: string, sidechain = false): string => JSON.stringify({ type: 'user', isSidechain: sidechain, uuid: 'u', timestamp: '2026-10-23T10:00:00.000Z', message: { role: 'user', content: text } })
const assistant = (content: unknown[]): string => JSON.stringify({ type: 'assistant', isSidechain: false, uuid: 'a', timestamp: '2026-10-23T10:00:01.000Z', message: { id: 'm', role: 'assistant', model: 'claude-opus-5-5', content } })
const result = (id: string, text: string): string => JSON.stringify({ type: 'user', isSidechain: false, uuid: 'r', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } })

/** The byte where line `index` of `lines` starts, written with `\n` ends. */
const offsetOf = (lines: readonly string[], index: number): number => Buffer.byteLength(lines.slice(0, index).map((line) => `${line}\n`).join(''))

describe('the fields find counts in', () => {
  it('ignores case, finds Cyrillic, counts several matches in one text, without overlaps', () => {
    expect(findNeedle('  Zebra ')).toBe('zebra')
    expect(findNeedle('z')).toBe('')
    expect(countMatches('ZEBRA zebra Zebra', 'zebra')).toBe(3)
    // The Russian word for zebra in two cases: case is ignored for Cyrillic too.
    expect(countMatches('Зебра и ЗЕБРА', findNeedle('зебра'))).toBe(2)
    expect(countMatches('aaaa', 'aa')).toBe(2)
    expect(countMatches('anything', '')).toBe(0)
  })

  it("looks in the text, a tool's name and line, a hook's name and output; not in a tool's result, a Subagent's thread or an interruption", () => {
    const events: AgentEvent[] = [
      { type: 'notice', kind: 'user', text: 'find the zebra' },
      { type: 'notice', kind: 'user', text: '[Request interrupted by user] zebra' },
      { type: 'text', text: 'a zebra', messageId: 'm', parentToolUseId: null, synthetic: false },
      { type: 'text', text: 'zebra of a Subagent', messageId: 'm', parentToolUseId: 'toolu_1', synthetic: false },
      { type: 'thinking', text: 'zebra?', messageId: 'm', parentToolUseId: null },
      { type: 'tool_use', id: 't', name: 'Bash', input: { command: 'grep zebra src\nsecond zebra line' }, parentToolUseId: null },
      { type: 'tool_result', toolUseId: 't', content: 'zebra zebra zebra', isError: false, parentToolUseId: null },
      { type: 'hook', hookEvent: 'Stop', hookName: 'zebra-hook', exitCode: 0, outcome: 'success', stdout: 'zebra out', stderr: '' },
    ]
    expect(events.map((event) => eventMatches(event, 'zebra'))).toEqual([1, 0, 1, 0, 1, 1, 0, 2])
    expect(eventFindTexts(events[5]!)).toEqual(['Bash', 'grep zebra src'])
  })
})

describe('findInTranscript', () => {
  const lines = [
    user('Where is the Zebra?'),
    assistant([{ type: 'tool_use', id: 't1', name: 'Grep', input: { pattern: 'zebra' } }]),
    result('t1', 'zebra.ts: zebra zebra'),
    assistant([{ type: 'text', text: 'zebra here, and ZEBRA there' }]),
    user('nothing to find'),
    user('one more zebra'),
  ]

  it('answers the byte of each line with matches and its count, only before `before`, case ignored', async () => {
    const path = file(lines.map((line) => `${line}\n`).join(''))
    const all = await findInTranscript(path, 'zebra', Number.MAX_SAFE_INTEGER, mainThreadEvents)
    expect(all).toEqual({
      found: true,
      hits: [
        { offset: 0, count: 1 },
        { offset: offsetOf(lines, 1), count: 1 },
        { offset: offsetOf(lines, 3), count: 2 },
        { offset: offsetOf(lines, 5), count: 1 },
      ],
      total: 5,
      skipped: 0,
    })
    // Up to the start of line 5: that line is the view's first, not searched here.
    const part = await findInTranscript(path, 'zebra', offsetOf(lines, 5), mainThreadEvents)
    expect(part.hits.map((hit) => hit.offset)).toEqual([0, offsetOf(lines, 1), offsetOf(lines, 3)])
    expect(part.total).toBe(4)
    expect(await findInTranscript(path, 'zebra', 0, mainThreadEvents)).toEqual({ found: true, hits: [], total: 0, skipped: 0 })
  })

  it('leaves out a line not ended before `before`, reads CRLF lines and lines with two-byte characters at their bytes', async () => {
    const crlf = [user('Где зебра?'), user('zebra and зебра'), user('half zebra')]
    const text = `${crlf[0]}\r\n${crlf[1]}\r\n${crlf[2]}`
    const path = file(text)
    const second = Buffer.byteLength(`${crlf[0]}\r\n`)
    const found = await findInTranscript(path, findNeedle('ЗЕБРА'), Buffer.byteLength(text), mainThreadEvents)
    expect(found.hits).toEqual([
      { offset: 0, count: 1 },
      { offset: second, count: 1 },
    ])
  })

  it('searches a line whose text JSON wrote with escapes', async () => {
    // The Russian word for zebra written as \u escapes, and a path written with \/: the raw line shows neither.
    const escaped = '{"type":"user","isSidechain":false,"uuid":"u","message":{"role":"user","content":"\\u0437\\u0435\\u0431\\u0440\\u0430 in src\\/zebra.ts"}}'
    const path = file(`${escaped}\n`)
    expect((await findInTranscript(path, findNeedle('зебра'), 1e9, mainThreadEvents)).total).toBe(1)
    expect((await findInTranscript(path, 'src/zebra', 1e9, mainThreadEvents)).total).toBe(1)
    // A quote is written escaped too: the query is then looked for in every line, parsed.
    const quoted = file(`${user('say "zebra" twice: "zebra"')}\n`)
    expect((await findInTranscript(quoted, '"zebra"', 1e9, mainThreadEvents)).total).toBe(2)
  })

  it("counts a Subagent's file with every record its own, and the Session's file without the old sidechain records", async () => {
    const path = file(`${user('zebra of the Subagent', true)}\n${user('zebra of the Session')}\n`)
    expect((await findInTranscript(path, 'zebra', 1e9, mainThreadEvents)).total).toBe(1)
    expect((await findInTranscript(path, 'zebra', 1e9, (entries) => entries.map(timedEvent))).total).toBe(2)
  })

  it('gives only the latest lines and counts the matches of the earlier ones in `skipped`', async () => {
    const many = Array.from({ length: 10 }, (_, n) => user(`zebra ${n} zebra`))
    const path = file(many.map((line) => `${line}\n`).join(''))
    const found = await findInTranscript(path, 'zebra', 1e9, mainThreadEvents, { slice: 1024 * 1024, hits: 3 })
    expect(found.hits.map((hit) => hit.offset)).toEqual([offsetOf(many, 7), offsetOf(many, 8), offsetOf(many, 9)])
    expect(found.skipped).toBe(14)
    expect(found.total).toBe(20)
  })

  it('reads a line longer than a slice whole, and gives the event loop a turn between slices', async () => {
    const long = user(`zebra ${'x'.repeat(5000)} zebra`)
    const many = [...Array.from({ length: 40 }, (_, n) => user(`line ${n} zebra`)), long]
    const path = file(many.map((line) => `${line}\n`).join(''))
    let turns = 0
    let ticking = true
    const tick = () => {
      if (!ticking) return
      turns += 1
      setImmediate(tick)
    }
    setImmediate(tick)
    const found = await findInTranscript(path, 'zebra', 1e9, mainThreadEvents, { slice: 256, hits: 1000 })
    ticking = false
    expect(found.total).toBe(42)
    expect(found.hits.at(-1)).toEqual({ offset: offsetOf(many, 40), count: 2 })
    // Each slice of 256 bytes ends with a turn: the file is over 6 KB.
    expect(turns).toBeGreaterThanOrEqual(10)
  })

  it('answers found: false for a missing file', async () => {
    expect(await findInTranscript(join(tmpdir(), 'worfy-no-such-transcript.jsonl'), 'zebra', 100, mainThreadEvents)).toEqual({ found: false, hits: [], total: 0, skipped: 0 })
  })
})

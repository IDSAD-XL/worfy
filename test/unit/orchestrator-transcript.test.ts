// The model and the last status block of an Orchestrator's transcript, read from the end of the
// file (src/main/agent/orchestrator-transcript.ts). Records follow the shape of real transcripts
// (test/fixtures/claude-home/README.md); a small chunk size cuts lines between chunks.
import { mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readTranscriptFacts } from '../../src/main/agent/orchestrator-transcript'

// readLinesBefore as it is, with a hook a test sets to change the file right after the next window
// is read: a Session that deletes or replaces its transcript between two reads.
const afterWindow = vi.hoisted(() => ({ hook: null as ((file: string) => void) | null }))
vi.mock('../../src/main/claude-home/tail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/claude-home/tail')>()
  return {
    ...actual,
    readLinesBefore: async (...args: Parameters<typeof actual.readLinesBefore>) => {
      const window = await actual.readLinesBefore(...args)
      const { hook } = afterWindow
      afterWindow.hook = null
      hook?.(args[0])
      return window
    },
  }
})

const BLOCK_OWN = ['— Этап: worfy-mvp · волна 5', '— Сейчас: тикет 08 в работе', '— Дальше: PR', '— Жду: ничего'].join('\n')
const BLOCK_OLDER = ['— Этап: worfy-mvp · волна 4', '— Сейчас: старое', '— Дальше: старое', '— Жду: ничего'].join('\n')
const BLOCK_SUBAGENT = ['— Этап: не оркестратор', '— Сейчас: subagent', '— Дальше: ничего', '— Жду: ничего'].join('\n')
const BLOCK_SYNTHETIC = ['— Этап: не оркестратор', '— Сейчас: synthetic', '— Дальше: ничего', '— Жду: ничего'].join('\n')

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worfy-orchestrator-transcript-'))
})

afterEach(async () => {
  afterWindow.hook = null
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

let uuid = 0
const assistant = (model: string, content: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'assistant',
    uuid: `00000000-0000-4000-8000-${String((uuid += 1)).padStart(12, '0')}`,
    timestamp: '2026-10-05T10:00:00.000Z',
    isSidechain: false,
    sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    message: { id: `msg_${uuid}`, type: 'message', role: 'assistant', model, content },
    ...extra,
  })
const text = (value: string) => ({ type: 'text', text: value })
const user = (value: string) => JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: value } })

function transcript(lines: string[], tail = ''): string {
  const file = join(dir, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl')
  writeFileSync(file, `${lines.join('\n')}\n${tail}`)
  return file
}

/** An Orchestrator's answers, then what must not count: a Subagent's and Claude Code's own text, a tool call, a half-written line. */
const LINES = [
  user('прогони волну 4'),
  assistant('claude-opus-4-1', [text(`Готово.\n\n${BLOCK_OLDER}`)]),
  user('прогони волну 5'),
  assistant('claude-opus-5-5', [text(`Было:\n${BLOCK_OLDER}`), text(`Стало:\n${BLOCK_OLDER}\n\n${BLOCK_OWN}`), text('Без блока.')]),
  assistant('claude-opus-5-5', [text(`Отчёт.\n${BLOCK_SUBAGENT}`)], { isSidechain: true, agentId: 'a1' }),
  assistant('<synthetic>', [text(`API Error.\n${BLOCK_SYNTHETIC}`)]),
  user('дальше'),
  assistant('claude-sonnet-5', [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }]),
]
const HALF_LINE = '{"type":"assistant","message":{"model":"claude-half","content":[{"type":"text","text":"— Этап: half'

describe('readTranscriptFacts', () => {
  it.each([
    ['in one read', undefined],
    ['across chunks that cut lines and multi-byte letters', 7],
    ['across chunks of a few lines', 512],
  ])("takes the model of the last answer and the Orchestrator's own last block, %s", async (_label, chunkBytes) => {
    const file = transcript(LINES, HALF_LINE)
    expect(await readTranscriptFacts(file, chunkBytes === undefined ? {} : { chunkBytes })).toStrictEqual({
      model: 'claude-sonnet-5',
      statusBlock: BLOCK_OWN,
    })
  })

  it("ignores a status block in the user's prompt: only the Orchestrator's answers count", async () => {
    const block = ['— Этап: из промпта', '— Сейчас: промпт', '— Дальше: ничего', '— Жду: ничего'].join('\n')
    const lines = [
      ...LINES,
      user(`Вот блок:\n${block}`),
      JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: [{ type: 'text', text: `Блок в тексте:\n${block}` }] } }),
    ]
    expect(await readTranscriptFacts(transcript(lines))).toStrictEqual({ model: 'claude-sonnet-5', statusBlock: BLOCK_OWN })
  })

  it('answers nulls for a transcript without answers, and for an empty file', async () => {
    expect(await readTranscriptFacts(transcript([user('привет')]), { chunkBytes: 16 })).toStrictEqual({ model: null, statusBlock: null })
    const empty = join(dir, 'empty.jsonl')
    writeFileSync(empty, '')
    expect(await readTranscriptFacts(empty)).toStrictEqual({ model: null, statusBlock: null })
  })

  it('finds a block far before the end, in the first line of the file', async () => {
    const file = transcript([assistant('claude-opus-5-5', [text(BLOCK_OWN)]), ...Array.from({ length: 50 }, (_, index) => user(`сообщение ${index}`))])
    expect(await readTranscriptFacts(file, { chunkBytes: 100 })).toStrictEqual({ model: 'claude-opus-5-5', statusBlock: BLOCK_OWN })
  })

  it('gives the answer of a whole read when a line longer than the window lies across the boundary of two windows', async () => {
    // The answer with the block is ~1.5 KB: every window size below cuts it, and windows grow back over it.
    const long = assistant('claude-opus-5-5', [text(`${'Длинный отчёт. '.repeat(50)}\n\n${BLOCK_OWN}`)])
    const file = transcript([user('старт'), long, user('дальше'), assistant('claude-sonnet-5', [text('x'.repeat(700))]), user('конец')])
    const whole = await readTranscriptFacts(file, { chunkBytes: 1024 * 1024 })
    expect(whole).toStrictEqual({ model: 'claude-sonnet-5', statusBlock: BLOCK_OWN })
    for (const chunkBytes of [1, 7, 64, 200, 777, 1500]) {
      expect(await readTranscriptFacts(file, { chunkBytes }), `chunkBytes ${chunkBytes}`).toStrictEqual(whole)
    }
  })

  it('takes a complete last line written without a line end', async () => {
    const file = transcript([user('старт')], assistant('claude-opus-5-5', [text(BLOCK_OWN)]))
    for (const chunkBytes of [undefined, 16]) {
      expect(await readTranscriptFacts(file, chunkBytes === undefined ? {} : { chunkBytes })).toStrictEqual({ model: 'claude-opus-5-5', statusBlock: BLOCK_OWN })
    }
  })

  it('rejects for a missing file, as before', async () => {
    await expect(readTranscriptFacts(join(dir, 'missing.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps the answer of the window when the file is replaced by another one before its tail is read', async () => {
    const lines = [user('старт'), assistant('claude-opus-5-5', [text(BLOCK_OWN)])]
    const file = transcript(lines)
    const other = assistant('claude-other', [text(BLOCK_OLDER)])
    afterWindow.hook = (path) => {
      // The new file holds the old bytes and one more line after them: its tail from the old offset is that line.
      const next = join(dir, 'next.jsonl')
      writeFileSync(next, `${lines.join('\n')}\n${other}\n`)
      renameSync(next, path)
    }
    expect(await readTranscriptFacts(file)).toStrictEqual({ model: 'claude-opus-5-5', statusBlock: BLOCK_OWN })
  })

  it('keeps the answer of the window when the file is deleted before its tail is read', async () => {
    const file = transcript([user('старт'), assistant('claude-opus-5-5', [text(BLOCK_OWN)])])
    afterWindow.hook = (path) => rmSync(path)
    expect(await readTranscriptFacts(file)).toStrictEqual({ model: 'claude-opus-5-5', statusBlock: BLOCK_OWN })
  })

  it('writes nothing next to the transcript', async () => {
    const file = transcript(LINES)
    await readTranscriptFacts(file, { chunkBytes: 64 })
    expect(readdirSync(dir)).toEqual(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl'])
  })
})

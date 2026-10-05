// The model and the last status block of an Orchestrator's transcript, read from the end of the
// file (src/main/agent/orchestrator-transcript.ts). Records follow the shape of real transcripts
// (test/fixtures/claude-home/README.md); a small chunk size cuts lines between chunks.
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readTranscriptFacts } from '../../src/main/agent/orchestrator-transcript'

const BLOCK_OWN = ['— Этап: worfy-mvp · волна 5', '— Сейчас: тикет 08 в работе', '— Дальше: PR', '— Жду: ничего'].join('\n')
const BLOCK_OLDER = ['— Этап: worfy-mvp · волна 4', '— Сейчас: старое', '— Дальше: старое', '— Жду: ничего'].join('\n')
const BLOCK_SUBAGENT = ['— Этап: не оркестратор', '— Сейчас: subagent', '— Дальше: ничего', '— Жду: ничего'].join('\n')
const BLOCK_SYNTHETIC = ['— Этап: не оркестратор', '— Сейчас: synthetic', '— Дальше: ничего', '— Жду: ничего'].join('\n')

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worfy-orchestrator-transcript-'))
})

afterEach(async () => {
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

  it('writes nothing next to the transcript', async () => {
    const file = transcript(LINES)
    await readTranscriptFacts(file, { chunkBytes: 64 })
    expect(readdirSync(dir)).toEqual(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl'])
  })
})

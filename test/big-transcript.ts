// A large Claude Code transcript for tests of how a Session's history opens (worfy-ui ticket 21):
// an Orchestrator's file grows to tens of megabytes, with long tool results and a line or two over
// a megabyte. The file is written at test time into the test's own temporary folder; nothing this
// size is committed.
//
// Every turn is four records: the prompt «Prompt number N», a tool call, its result (a few
// kilobytes; every 200th one 200 KB) and the answer «Answer number N». One result in the middle of
// the file and one among the last turns are over 1 MB.
import { appendFileSync, closeSync, openSync, writeSync } from 'node:fs'

export interface BigTranscript {
  /** Size of the file in bytes. */
  size: number
  /** How many turns it holds; the last is `turns - 1`. */
  turns: number
}

export interface BigTranscriptOptions {
  sessionId: string
  /** The cwd every record names: the Project the transcript belongs to. */
  cwd: string
  /** The size to reach, roughly; 40 MB by default. */
  bytes?: number
  /** Line end; `\r\n` writes the file as a Windows editor would. */
  eol?: string
  /** The answer of turn N; «Answer number N» by default. Find tests (worfy-ui ticket 26) put a word in some. */
  answer?: (turn: number) => string
}

const BIG_RESULT = 1_200_000

/** Writes the transcript to `file` and says how many turns it holds. */
export function writeBigTranscript(file: string, options: BigTranscriptOptions): BigTranscript {
  const { sessionId, cwd } = options
  const target = options.bytes ?? 40 * 1024 * 1024
  const eol = options.eol ?? '\n'
  const answerOf = options.answer ?? ((turn: number) => `Answer number ${turn}`)
  const fd = openSync(file, 'w')
  let size = 0
  let turn = 0
  let bigMiddle = false
  let bigNearEnd = false
  const start = Date.parse('2026-10-01T00:00:00.000Z')
  try {
    while (size < target) {
      const at = new Date(start + turn * 1000).toISOString()
      const base = { isSidechain: false, timestamp: at, cwd, sessionId }
      let resultBytes = 1500 + ((turn * 7919) % 5000)
      if (turn % 200 === 199) resultBytes = 200_000
      if (!bigMiddle && size > target / 2) {
        resultBytes = BIG_RESULT
        bigMiddle = true
      } else if (!bigNearEnd && size > target - 2 * 1024 * 1024) {
        resultBytes = BIG_RESULT
        bigNearEnd = true
      }
      const records = [
        { ...base, type: 'user', uuid: `u${turn}`, message: { role: 'user', content: `Prompt number ${turn}` } },
        {
          ...base,
          type: 'assistant',
          uuid: `t${turn}`,
          message: { id: `msg_t${turn}`, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'tool_use', id: `tool_${turn}`, name: 'Bash', input: { command: `echo ${turn}` } }] },
        },
        { ...base, type: 'user', uuid: `r${turn}`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `tool_${turn}`, content: 'x'.repeat(resultBytes) }] } },
        { ...base, type: 'assistant', uuid: `a${turn}`, message: { id: `msg_a${turn}`, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: answerOf(turn) }] } },
      ]
      const text = records.map((record) => JSON.stringify(record) + eol).join('')
      size += writeSync(fd, text)
      turn += 1
    }
  } finally {
    closeSync(fd)
  }
  return { size, turns: turn }
}

/**
 * The marked turns of the find e2e tests (worfy-ui ticket 26): a transcript of `bytes` written by
 * test/big-transcript.ts whose answer of turn 2 holds the Russian word for zebra, and after it one
 * more turn that says it twice — at the end of the file, so the view holds it, while turn 2 lies
 * behind «Load earlier».
 */
export function writeMarkedTranscript(file: string, sessionId: string, cwd: string, bytes: number): void {
  // The Russian word is the query of the tests: find ignores case for Cyrillic too.
  writeBigTranscript(file, { sessionId, cwd, bytes, answer: (turn) => (turn === 2 ? 'Answer number 2: the зебра hides here' : `Answer number ${turn}`) })
  const base = { isSidechain: false, timestamp: '2026-10-23T10:00:00.000Z', cwd, sessionId }
  const tail = [
    { ...base, type: 'user', uuid: 'u-find', message: { role: 'user', content: 'Where is the Зебра now?' } },
    { ...base, type: 'assistant', uuid: 'a-find', message: { id: 'msg_find', model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: 'The зебра is in the garden.' }] } },
  ]
  appendFileSync(file, tail.map((record) => `${JSON.stringify(record)}\n`).join(''))
}

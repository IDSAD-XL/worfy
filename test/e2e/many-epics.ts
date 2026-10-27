// A Project with many Epics and Tickets and a long Sessions history (worfy-link ticket 33): what a
// Project of a working team looks like after months, for the measure of the first opening of such
// a Project on a Linked machine (test/e2e/linked-opening.spec.ts).
//
// - manyEpicsStatus: the answer of `epic-status --json` (src/main/workflow/reader.ts) for `epics`
//   Epics of `tickets` Tickets each. Every Epic has open Tickets, so every frame is open and laid
//   out by ELK; a third of the Tickets are done, a few in work, and every third waits for the one
//   before it, so ELK routes "Blocked by" edges too.
// - writeSessionHistory: `sessions` transcripts of a few turns each in a Claude home, under the
//   folder Claude Code names after `cwd`.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ManyEpicsOptions {
  epics?: number
  tickets?: number
}

export const MANY_EPICS = 20
export const TICKETS_PER_EPIC = 15

const pad = (num: number): string => String(num).padStart(2, '0')

export function manyEpicsStatus({ epics = MANY_EPICS, tickets = TICKETS_PER_EPIC }: ManyEpicsOptions = {}) {
  const names = Array.from({ length: epics }, (_, at) => `epic-${pad(at + 1)}`)
  return {
    ref: 'main',
    epics: names.map((epic, at) => ({ epic, hasSpec: true, hasMap: false, title: `Epic ${at + 1}: a goal of the team` })),
    tickets: names.flatMap((epic) =>
      Array.from({ length: tickets }, (_, at) => {
        const num = at + 1
        const state = num % 3 === 1 ? 'done' : num % 7 === 0 ? 'work' : 'open'
        const blockedNums = num % 3 === 0 ? [num - 1] : []
        return {
          epic,
          num,
          slug: `ticket-${num}`,
          title: `${pad(num)} — Ticket ${num} of ${epic}, a title long enough for two lines of a card`,
          statusRaw: state === 'work' ? 'claimed' : state,
          state,
          blockedRaw: blockedNums.length > 0 ? String(blockedNums[0]) : '—',
          blockedNums,
          blockedParsed: true,
        }
      }),
    ),
  }
}

/** The name Claude Code gives the folder of `cwd`'s Sessions: every character outside [A-Za-z0-9] is `-`. */
export const claudeProjectFolder = (cwd: string): string => cwd.replace(/[^A-Za-z0-9]/g, '-')

/** Writes `sessions` transcripts of `turns` user and assistant messages each for the Project at `cwd`. */
export function writeSessionHistory(claudeHome: string, cwd: string, sessions = 60, turns = 20): void {
  const folder = join(claudeHome, 'projects', claudeProjectFolder(cwd))
  mkdirSync(folder, { recursive: true })
  const start = Date.parse('2026-09-01T09:00:00.000Z')
  for (let n = 0; n < sessions; n += 1) {
    const sessionId = `${pad(n % 100)}${'0'.repeat(6)}-0000-4000-8000-${String(n).padStart(12, '0')}`
    const lines: string[] = []
    for (let turn = 0; turn < turns; turn += 1) {
      const timestamp = new Date(start + n * 3_600_000 + turn * 60_000).toISOString()
      const base = { timestamp, cwd, gitBranch: 'main', isSidechain: false, sessionId }
      lines.push(JSON.stringify({ ...base, type: 'user', uuid: `${sessionId}-u${turn}`, message: { role: 'user', content: `Session ${n}, question ${turn}: what is left in the epic?` } }))
      lines.push(
        JSON.stringify({
          ...base,
          type: 'assistant',
          uuid: `${sessionId}-a${turn}`,
          message: { role: 'assistant', model: 'claude', content: [{ type: 'text', text: `Answer ${turn} of Session ${n}. ${'The tickets are moving. '.repeat(20)}` }] },
        }),
      )
    }
    writeFileSync(join(folder, `${sessionId}.jsonl`), `${lines.join('\n')}\n`)
  }
}

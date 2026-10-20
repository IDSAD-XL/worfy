/// <reference types="vite/client" />
// ELK for the Epic frames, in one Web Worker per window (ADR-0037). The worker is elkjs's own
// worker script, emitted by the build as a file of its own — not a `blob:`, which the renderer's
// CSP (`script-src 'self'`, src/renderer/index.html) refuses — and spoken to through elkjs's API.
// Graphs are built and answers read here, in the renderer (layout.ts); only ELK runs in the worker.
// "Tidy up" packs its rectangles through the same worker (`elkEngine`, pack.ts, ../tidy.ts).
//
// One request per Epic whose layout inputs changed; an answer to a request that a newer one for
// the same Epic replaced is dropped. Answers go into a store the Epic node source reads
// (sources/epics.ts): until an Epic's first answer it shows the synchronous `layoutEpic`, and
// while a newer request is out it keeps the last answer's places. ELK fails the same way on the
// same inputs and a request is not sent again for them, so a failed request is answered with the
// synchronous `layoutEpic`: the frame shows every Ticket, and the frames' arrangement, which waits
// for every frame's answer (ADR-0075), is not held up by it.
//
// Without a Worker (jsdom in the tests) nothing is requested unless a test passes its own ELK
// through `setElkEngine`.
import ELK from 'elkjs/lib/elk-api.js'
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url&no-inline'
import { create } from 'zustand'
import type { Ticket } from '../../../shared/workflow/types'
import { doneOnlyInBranch } from '../../../shared/workflow/waves'
import { layoutEpic, type EpicLayout, type LayoutTicket } from '../epic-layout'
import { layoutEpicElk, type ElkEngine } from './layout'

/** ELK's layouts of an open frame, for the inputs named by `key`. */
export interface ElkAnswer {
  key: string
  /** With the done stack folded. */
  folded: EpicLayout
  /** With the done stack open; the same object as `folded` when the Epic has no done Ticket. */
  open: EpicLayout
}

export interface ElkRequest {
  /** The layout inputs, as a string: a request with the key of the last one is not sent again. */
  key: string
  tickets: readonly LayoutTicket[]
  name: string
}

/** Per Project, per Epic, ELK's last answer. */
export const useElkAnswers = create<Readonly<Record<string, Readonly<Record<string, ElkAnswer>>>>>(() => ({}))

let engine: ElkEngine | null | undefined
let sequence = 0
/** Per `<projectId>|<epic>`, the latest request sent. */
const latest = new Map<string, { key: string; seq: number }>()

function defaultEngine(): ElkEngine | null {
  if (typeof Worker === 'undefined') return null
  return new ELK({ workerFactory: () => new Worker(elkWorkerUrl, { name: 'worfy-epic-layout' }) })
}

/**
 * The window's ELK, in its Web Worker; null without a Worker, unless a test set one. "Tidy up"
 * (canvas/tidy.ts) packs its rectangles here too, so the window keeps one worker.
 */
export function elkEngine(): ElkEngine | null {
  if (engine === undefined) engine = defaultEngine()
  return engine
}

/** Replaces the ELK the requests go to (tests); null sends nothing. Forgets every request and answer. */
export function setElkEngine(next: ElkEngine | null): void {
  engine = next
  latest.clear()
  useElkAnswers.setState({}, true)
}

/**
 * The key of an Epic's layout inputs: what ELK's answer depends on. A Ticket done only in its
 * unmerged branch is not a closed blocker for the ready Wave (waves.ts), so the merge of that
 * branch, which changes nothing but `fromBranch`, changes the key too.
 */
export function elkKey(tickets: readonly (LayoutTicket & Partial<Pick<Ticket, 'fromBranch'>>)[], name: string): string {
  return JSON.stringify([
    name,
    [...tickets]
      .sort((a, b) => a.num - b.num)
      .map((t) => [t.num, t.state, doneOnlyInBranch(t), t.blockedRaw, t.blockedNums, t.blockedParsed, t.files, t.filesListed]),
  ])
}

/** Asks ELK for an Epic's layout unless the last request for it had the same inputs. */
export function requestEpicLayout(projectId: string, epic: string, request: ElkRequest): void {
  const id = `${projectId}|${epic}`
  if (latest.get(id)?.key === request.key) return
  const elk = elkEngine()
  if (elk === null) return
  const seq = (sequence += 1)
  latest.set(id, { key: request.key, seq })
  const hasDone = request.tickets.some((t) => t.state === 'done')
  const input = { tickets: request.tickets, name: request.name }
  const folded = layoutEpicElk({ ...input, doneExpanded: false }, elk)
  const open = hasDone ? layoutEpicElk({ ...input, doneExpanded: true }, elk) : folded
  const answer = (foldedLayout: EpicLayout, openLayout: EpicLayout) =>
    useElkAnswers.setState((state) => ({ ...state, [projectId]: { ...state[projectId], [epic]: { key: request.key, folded: foldedLayout, open: openLayout } } }))
  Promise.all([folded, open]).then(
    ([foldedLayout, openLayout]) => {
      // A newer request for this Epic is out, or the engine was replaced: this answer is stale.
      if (latest.get(id)?.seq !== seq) return
      answer(foldedLayout, openLayout)
    },
    (error: unknown) => {
      if (latest.get(id)?.seq !== seq) return
      console.error(`ELK could not lay out Epic ${epic}`, error)
      // The same inputs are not asked again: the synchronous layout answers for them.
      const syncFolded = layoutEpic({ ...input, collapsed: false, doneExpanded: false })
      answer(syncFolded, hasDone ? layoutEpic({ ...input, collapsed: false, doneExpanded: true }) : syncFolded)
    },
  )
}

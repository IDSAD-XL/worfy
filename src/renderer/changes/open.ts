// Opening the Changes view of a Ticket (worfy-changes-view ticket 08; the owner's decision D1 of 2026-11-21): the diff of
// the Ticket over the whole main area, as the Pull requests view shows a PR — not a Node on the Canvas. Three entries
// open it: the button Changes on the Ticket card (canvas/actions/Changes.tsx), Open changes of the Command palette
// (palette/commands.ts), and the block of a comment on code in a sent message (session/QuotedPrompt.tsx), which also asks
// for its line. The view (ChangesView.tsx) has one button back — to the view it was opened from — and Esc does the same.
//
// What the view shows lives here, not in the Layout: the Ticket, the view to go back to, and the scope last picked for
// each Ticket, kept while the window lives (the owner's decision 3 of ticket 08: after a restart the view starts at
// All changes again). Opening reads git only, so a read-only screen opens it too.
//
// Kept free of React and of the Node registry: the palette lives in the toolbar, which does not load the Canvas's
// modules (find/canvas-requests.ts).
import { create } from 'zustand'
import type { ChangesScope } from '../../shared/changes/types'
import type { Ticket } from '../../shared/workflow/types'
import { showsChanges } from '../canvas/ticket-card'
import { setView, useNavigation } from '../session/navigation'

/** What the Changes view shows: the Ticket. Part 2 adds a Session and a PR. */
export interface ChangesSubject {
  epic: string
  num: number
}

/** The view the button back of the Changes view returns to. */
export type ChangesBack = 'canvas' | 'session'

const ref = ({ epic, num }: ChangesSubject): string => `${epic}/${String(num).padStart(2, '0')}`

/**
 * Whether the Ticket has something for Changes to read, from the Ticket alone: the worktree branch its status came
 * from, its `Branch:` line, or work on it (a claimed Ticket has its branch) — the cards the layout gives the room of
 * the button (showsChanges of canvas/ticket-card.ts). main gives the final answer (`changes.scopes`): a Ticket whose
 * branch is gone shows that in the view.
 */
export const hasChangesSubject = (ticket: Pick<Ticket, 'state' | 'fromBranch' | 'branch'>): boolean => showsChanges(ticket)

/** The tooltip of the button and the detail of the palette row. */
export const changesTitle = (subject: ChangesSubject): string => `Open the changes of ${ref(subject)}: its diff against the base`

interface ChangesViewState {
  /** The Project of the Ticket shown; null until the view is first opened. */
  projectId: string | null
  subject: ChangesSubject | null
  back: ChangesBack
  /** Counts the openings: each one puts the focus on the view. */
  opened: number
  /** The scope last picked, by `<projectId>:<epic>/<num>`; absent — All changes. */
  scopes: Readonly<Record<string, ChangesScope>>
}

export const useChangesView = create<ChangesViewState>(() => ({ projectId: null, subject: null, back: 'canvas', opened: 0, scopes: {} }))

const scopeKeyOf = (projectId: string, { epic, num }: ChangesSubject): string => `${projectId}:${epic}/${num}`

/** All changes: one object, so a selector of the store gives the same value each time. */
const ALL: ChangesScope = { kind: 'all' }

/** The scope the view keeps for the Ticket; All changes when it keeps none. */
export function changesScopeFor(scopes: ChangesViewState['scopes'], projectId: string, subject: ChangesSubject): ChangesScope {
  return scopes[scopeKeyOf(projectId, subject)] ?? ALL
}

/** Keeps the scope picked for the Ticket while the window lives. */
export function setChangesScope(projectId: string, subject: ChangesSubject, scope: ChangesScope): void {
  useChangesView.setState((state) => ({ scopes: { ...state.scopes, [scopeKeyOf(projectId, subject)]: scope } }))
}

/**
 * Shows the Changes of the Ticket over the whole main area. `back` — the view its button back returns to: the Canvas
 * from the card and the palette, the Session view from a message of the Session view.
 */
export function openChanges(projectId: string, subject: ChangesSubject, back: ChangesBack = 'canvas'): void {
  useLineRequests.setState({ request: null })
  useChangesView.setState((state) => ({ projectId, subject: { epic: subject.epic, num: subject.num }, back, opened: state.opened + 1 }))
  setView('changes')
}

/** The button back and Esc: the view the Changes view was opened from. */
export function closeChanges(): void {
  if (useNavigation.getState().view === 'changes') setView(useChangesView.getState().back)
}

// ── a line asked for from a sent message ────────────────────────────────────

/** A line of a Ticket's diff that a block of a sent message asks Changes to show (ticket 05). */
export interface LineRequest extends ChangesSubject {
  projectId: string
  path: string
  side: 'old' | 'new'
  line: number
  seq: number
}

export const useLineRequests = create<{ request: LineRequest | null }>(() => ({ request: null }))
let lastSeq = 0

/**
 * The block of a comment on code in a sent message (session/QuotedPrompt.tsx): opens the Ticket's Changes view and
 * leaves the line for it to bring into view once its files are read (lineRequestFor). Back goes to the view the
 * message was in: the Session view, else the Canvas.
 */
export function openChangesAtLine(projectId: string, subject: ChangesSubject, at: { path: string; side: 'old' | 'new'; line: number }): void {
  const back: ChangesBack = useNavigation.getState().view === 'session' ? 'session' : 'canvas'
  openChanges(projectId, subject, back)
  lastSeq += 1
  useLineRequests.setState({ request: { projectId, epic: subject.epic, num: subject.num, ...at, seq: lastSeq } })
}

/** The line asked for the Ticket shown; null when there is none. Another opening of the view drops it. */
export function lineRequestFor(request: LineRequest | null, projectId: string, subject: ChangesSubject): LineRequest | null {
  if (request === null || request.projectId !== projectId || request.epic !== subject.epic || request.num !== subject.num) return null
  return request
}

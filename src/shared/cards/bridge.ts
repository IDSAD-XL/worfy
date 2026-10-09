// The Card API (CONTEXT.md, «Карточка»; ticket 26): the messages a Card and worfy exchange with
// postMessage. A Card has no Node and no IPC: everything it may ask of worfy is one of CARD_OPS,
// each checked here with zod at the boundary, and the answer goes back to the Card's own frame.
//
//   Card → worfy   {type: 'worfy.request', requestId, op, args}
//   worfy → Card   {type: 'worfy.response', requestId, ok: true, data}
//                  {type: 'worfy.response', requestId, ok: false, error, canceled?: true}
//                  {type: 'worfy.event', event: 'workflow', data}       after workflow.subscribe
//   worfy → Card   {type: 'worfy.request', requestId, op: 'card.text'}   the Card's visible text (31)
//   Card → worfy   {type: 'worfy.response', requestId, ok: true, data: {text}}
//
// The workflow is read-only for a Card (ADR-0002): there is no operation that changes a Ticket, an
// Epic or anything else of the workflow. A Card's own data is a JSON value of at most
// CARD_DATA_LIMIT_BYTES, kept by main in the Project's data folder (ADR-0005).
import { z } from 'zod'
import { pullOfTicket, worktreeOfTicket, type ChecksSnapshot } from '../ipc/checks'
import type { WorkflowModel } from '../workflow/types'
import { waveNumbers } from '../workflow/waves'

/** Largest Card data, as UTF-8 bytes of its compact JSON. */
export const CARD_DATA_LIMIT_BYTES = 1024 * 1024
/** Longest text `session.ask` passes to a Session. */
export const ASK_TEXT_LIMIT = 10_000
/** Longest visible text of a Card that `card.text` returns; longer text is cut. */
export const CARD_TEXT_LIMIT = 100_000

/** Every operation a Card may ask for. None of them writes the workflow. */
export const CARD_OPS = ['data.get', 'data.set', 'session.ask', 'workflow.get', 'workflow.subscribe'] as const
export type CardOp = (typeof CARD_OPS)[number]

const requestIdSchema = z.string().min(1).max(64)

/** The length of a JSON value's compact form in UTF-8 bytes. */
export function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

/** A Card's own data: any JSON value up to CARD_DATA_LIMIT_BYTES. */
export const cardDataSchema = z
  .json()
  .refine((value) => jsonByteLength(value) <= CARD_DATA_LIMIT_BYTES, `Card data is limited to ${CARD_DATA_LIMIT_BYTES} bytes of JSON`)
export type CardData = z.output<typeof cardDataSchema>

export const askTextSchema = z.string().trim().min(1, 'the text is empty').max(ASK_TEXT_LIMIT, `the text is limited to ${ASK_TEXT_LIMIT} characters`)

const noArgs = z.object({}).optional()

export const cardRequestSchema = z.discriminatedUnion('op', [
  z.object({ type: z.literal('worfy.request'), requestId: requestIdSchema, op: z.literal('data.get'), args: noArgs }),
  z.object({ type: z.literal('worfy.request'), requestId: requestIdSchema, op: z.literal('data.set'), args: z.object({ value: cardDataSchema }) }),
  z.object({ type: z.literal('worfy.request'), requestId: requestIdSchema, op: z.literal('session.ask'), args: z.object({ text: askTextSchema }) }),
  z.object({ type: z.literal('worfy.request'), requestId: requestIdSchema, op: z.literal('workflow.get'), args: noArgs }),
  z.object({ type: z.literal('worfy.request'), requestId: requestIdSchema, op: z.literal('workflow.subscribe'), args: noArgs }),
])
export type CardRequest = z.output<typeof cardRequestSchema>

export type ParsedCardRequest =
  | { ok: true; request: CardRequest }
  /** `requestId` is null when the message names none: such a message gets no answer. */
  | { ok: false; requestId: string | null; error: string }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** Whether a message is a request at all: of the request type, with a usable id. */
export function isCardRequestShape(data: unknown): data is { type: 'worfy.request'; requestId: string } {
  return isRecord(data) && data.type === 'worfy.request' && requestIdSchema.safeParse(data.requestId).success
}

/**
 * Checks a message from a Card. The request that comes back is the parsed one: keys the protocol
 * does not declare are gone. A value zod cannot even walk (nested too deep) is refused, not thrown.
 */
export function parseCardRequest(data: unknown): ParsedCardRequest {
  const requestId = isCardRequestShape(data) ? data.requestId : null
  try {
    const parsed = cardRequestSchema.safeParse(data)
    if (parsed.success) return { ok: true, request: parsed.data }
    return { ok: false, requestId, error: `invalid request: ${z.prettifyError(parsed.error)}` }
  } catch (error) {
    return { ok: false, requestId, error: `invalid request: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export const cardResponseSchema = z.discriminatedUnion('ok', [
  z.object({ type: z.literal('worfy.response'), requestId: requestIdSchema, ok: z.literal(true), data: z.unknown() }),
  z.object({
    type: z.literal('worfy.response'),
    requestId: requestIdSchema,
    ok: z.literal(false),
    error: z.string(),
    canceled: z.literal(true).optional(),
  }),
])
export type CardResponse = z.output<typeof cardResponseSchema>

export const okResponse = (requestId: string, data: unknown): CardResponse => ({ type: 'worfy.response', requestId, ok: true, data })
export const errorResponse = (requestId: string, error: string): CardResponse => ({ type: 'worfy.response', requestId, ok: false, error })
/** The user said no to `session.ask`. */
export const canceledResponse = (requestId: string): CardResponse => ({
  type: 'worfy.response',
  requestId,
  ok: false,
  canceled: true,
  error: 'The user did not send the message',
})

// ── worfy → Card ─────────────────────────────────────────────────────────────

/** The request for a Card's visible text (ticket 31, search over the Canvas). */
export const cardTextRequest = (requestId: string) => ({ type: 'worfy.request', requestId, op: 'card.text' }) as const

/** A Card's answer to `card.text`; longer text is cut to CARD_TEXT_LIMIT, not refused. */
export const cardTextResponseSchema = z.object({
  type: z.literal('worfy.response'),
  requestId: requestIdSchema,
  ok: z.literal(true),
  data: z.object({ text: z.string().transform((text) => text.slice(0, CARD_TEXT_LIMIT)) }),
})

// ── the workflow snapshot ────────────────────────────────────────────────────

const gateSchema = z.enum(['green', 'red', 'unverified', 'none'])

/** One Ticket as a Card sees it. */
export const snapshotTicketSchema = z.object({
  epic: z.string(),
  num: z.number().int().nonnegative(),
  title: z.string(),
  state: z.enum(['open', 'work', 'blocked', 'done', 'none']),
  /** Numbers of the Tickets it waits for. */
  blockedBy: z.array(z.number().int().nonnegative()),
  /** Its Wave, as the spec's "Волны" table counts it; null for done or in-work Tickets and those that never get ready. */
  wave: z.number().int().positive().nullable(),
  /** The gate of its worktree; null when it has none. */
  gate: gateSchema.nullable(),
  pr: z.object({ number: z.number().int().positive(), state: z.enum(['OPEN', 'CLOSED', 'MERGED']), url: z.string() }).nullable(),
  ci: z.enum(['passing', 'failing', 'running']).nullable(),
})
export type SnapshotTicket = z.output<typeof snapshotTicketSchema>

/** What `workflow.get` and `workflow.subscribe` give a Card: a copy, for reading only. */
export const workflowSnapshotSchema = z.object({
  epics: z.array(z.object({ epic: z.string(), title: z.string().nullable() })),
  tickets: z.array(snapshotTicketSchema),
  /** Why there are no Epics and Tickets (epic-status failed); null when the read worked. */
  error: z.string().nullable(),
})
export type WorkflowSnapshot = z.output<typeof workflowSnapshotSchema>

/** The snapshot of a Project's workflow model and checks; `checks` may not have arrived yet. */
export function workflowSnapshot(model: WorkflowModel, checks: ChecksSnapshot | undefined): WorkflowSnapshot {
  const waves = new Map<string, Map<number, number>>()
  for (const { epic } of model.epics) waves.set(epic, waveNumbers(model.tickets, epic))
  const tickets = model.tickets.map((ticket): SnapshotTicket => {
    const worktree = checks ? worktreeOfTicket(checks, ticket, model.tickets) : null
    const pull = checks?.gh.available ? pullOfTicket(checks, ticket) : null
    return {
      epic: ticket.epic,
      num: ticket.num,
      title: ticket.title,
      state: ticket.state,
      blockedBy: [...ticket.blockedNums],
      wave: (waves.get(ticket.epic) ?? waveNumbers(model.tickets, ticket.epic)).get(ticket.num) ?? null,
      gate: worktree ? worktree.gate.outcome : null,
      pr: pull ? { number: pull.number, state: pull.state, url: pull.url } : null,
      ci: pull?.ci ?? null,
    }
  })
  return {
    epics: model.epics.map((epic) => ({ epic: epic.epic, title: epic.title })),
    tickets,
    error: model.error?.message ?? null,
  }
}

/** The snapshot when the workflow could not be read at all. */
export const failedSnapshot = (error: string): WorkflowSnapshot => ({ epics: [], tickets: [], error })

/** Sent to a Card that subscribed, each time the snapshot changes. */
export const workflowEvent = (snapshot: WorkflowSnapshot) => ({ type: 'worfy.event', event: 'workflow', data: snapshot }) as const

// ── addresses ────────────────────────────────────────────────────────────────

/** A machine label: 32 hex characters, the last part of the host of a Card of a Linked machine. */
export const MACHINE_LABEL_PATTERN = /^[0-9a-f]{32}$/

const MACHINE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The machine label of Machine `machineId` (worfy-link ticket 10): the id itself, a UUID, without
 * its dashes and in lower case — 32 hex characters, one DNS label. Not a hash: two Linked machines
 * have two ids, so they never share a label and with it the origin (and the storage) of their
 * Cards, whatever id a Machine picks for itself. null for an id that is not a UUID.
 */
export function machineLabel(machineId: string): string | null {
  return MACHINE_ID.test(machineId) ? machineId.replaceAll('-', '').toLowerCase() : null
}

const CARD_ADDRESS = /^worfy-card:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.([0-9a-f]{8})(?:\.([0-9a-f]{32}))?(?=\/|$)/

/**
 * The origin of a Card's frame from its address (ADR-0012): `worfy-card://<card id>.<project
 * label>` for a Card of this Machine, `worfy-card://<card id>.<project label>.<machine label>` for
 * a Card of a Linked machine (worfy-link ticket 10), whose `machineLabel` is then set. null for any
 * other URL. Built by hand: the URL API gives no origin for a custom scheme.
 */
export function cardOriginOf(url: string): { origin: string; cardId: string; machineLabel?: string } | null {
  const match = CARD_ADDRESS.exec(url)
  if (!match?.[1] || !match[2]) return null
  const [origin, cardId, , machine] = match
  return machine === undefined ? { origin, cardId } : { origin, cardId, machineLabel: machine }
}

/**
 * The address a window shows a Card of Linked machine M at: M's own address of the Card
 * (`cards.get` there) with M's machine label added to the host, so the frame gets an origin no
 * Card of this Machine has, and this Machine's main fetches its files from M. null when `url` is
 * not the address of a Card of M's own (a form a window must not put into a frame) or the label is
 * not one.
 */
export function linkedCardUrl(url: string, label: string | null): string | null {
  const address = cardOriginOf(url)
  if (address === null || address.machineLabel !== undefined || label === null || !MACHINE_LABEL_PATTERN.test(label)) return null
  return `${address.origin}.${label}${url.slice(address.origin.length)}`
}

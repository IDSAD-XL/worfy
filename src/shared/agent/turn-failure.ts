// Which turn failure is transient (worfy-retry ticket 01): a pure reading of a turn's end (the
// `result` event, src/shared/agent/events.ts) that says whether the turn failed on a temporary
// API error worth continuing after a pause, failed otherwise, or did not fail.
//
// The caller asks the Limits first (`LimitsWait.hitOf`, src/main/autopilot/limits-wait.ts): a
// refusal by the Limits has its own path (wait for the reset), and this function does not decide
// it. A refusal that slipped past `hitOf` is still never transient here: 429 and every
// rate-limit shape read as `other`.
//
// Claude Code reports the kind only in the error text, after its own retries ran out (10 by
// default in 2.1.289, each one a `system/api_retry` message). The text is read at its start only
// — the status after `API Error: `, the error `type` of the JSON body, or a fixed phrase —
// never anywhere in the whole text, so a tool output quoting an error does not count. The shapes
// are those of Claude Code 2.1.289 and of the older `API Error: <status> {json}` form the
// fixtures use. Codex names the kind in `terminalReason` (its `codexErrorInfo` key, `errorKind`
// in src/main/vendors/codex/items.ts); its error text does not count. Any shape not listed is
// `other`: the run stops, as it did before this module.

export type TransientError = 'api-500' | 'api-502' | 'api-503' | 'api-504' | 'overloaded' | 'connection' | 'timeout' | 'stream'

export type TurnFailure = { kind: 'none' } | { kind: 'transient'; error: TransientError } | { kind: 'other' }

/** What the function reads of a turn's end: the Vendor of its Session and the `result` event's fields. */
export interface TurnEndInput {
  vendor: string
  isError: boolean
  interrupted: boolean
  /** The turn's error text, or null. */
  error: string | null
  terminalReason: string | null
}

const NONE: TurnFailure = { kind: 'none' }
const OTHER: TurnFailure = { kind: 'other' }
const transient = (error: TransientError): TurnFailure => ({ kind: 'transient', error })

/** The `codexErrorInfo` keys of a temporary failure (CodexErrorInfo.ts). */
const CODEX_TRANSIENT: ReadonlyMap<string, TransientError> = new Map([
  ['serverOverloaded', 'overloaded'],
  ['internalServerError', 'api-500'],
  ['httpConnectionFailed', 'connection'],
  ['responseStreamConnectionFailed', 'connection'],
  ['responseStreamDisconnected', 'stream'],
  // Codex's own stream retries ran out.
  ['responseTooManyFailedAttempts', 'stream'],
])

const API_ERROR = 'API Error'

/** HTTP statuses after `API Error: ` that are temporary. */
const STATUS_TRANSIENT: ReadonlyMap<string, TransientError> = new Map([
  ['500', 'api-500'],
  ['502', 'api-502'],
  ['503', 'api-503'],
  ['504', 'api-504'],
  ['529', 'overloaded'],
])

/** Error types of the Anthropic API JSON body that are temporary. */
const TYPE_TRANSIENT: ReadonlyMap<string, TransientError> = new Map([
  ['overloaded_error', 'overloaded'],
  ['api_error', 'api-500'],
])

/** Fixed phrases right after `API Error: ` (Claude Code 2.1.289 and older). */
const PHRASES: ReadonlyArray<readonly [RegExp, TransientError]> = [
  [/^Repeated 529 Overloaded errors\b/, 'overloaded'],
  // An error event inside the response stream has no HTTP status: Claude Code gives the API's
  // own message alone.
  [/^Overloaded$/, 'overloaded'],
  [/^Internal server error$/, 'api-500'],
  [/^Request timed out\b/, 'timeout'],
  [/^No response from API\b/, 'timeout'],
  [/^Connection closed before the response finished\b/, 'stream'],
  [/^Connection error\./, 'connection'],
  [/^Connection dropped \(/, 'connection'],
  [/^Connection lost while your computer was asleep\b/, 'connection'],
  // Only the plain form: `Unable to connect to API (<code>)` is Claude Code's branch for codes it
  // does not know (EPROTO, ERR_INVALID_URL, …), and `Unable to connect to API: SSL …` a certificate
  // problem; neither passes with time.
  [/^Unable to connect to API\./, 'connection'],
  [/^Can't reach the API server\b/, 'connection'],
  [/^No internet route\b/, 'connection'],
]

/** `Connection to the API was lost (<code>)`: the codes that are a refusal by the network's setup, not a drop. */
const LOST_REFUSED: ReadonlySet<string> = new Set(['ECONNREFUSED', 'ConnectionRefused', 'ERR_PROXY_TUNNEL'])

function claudeFailure(error: string | null): TurnFailure {
  const text = (error ?? '').trim()
  // 2.1.289 reports a client timeout without the prefix.
  if (/^Request timed out\b/.test(text)) return transient('timeout')
  if (!text.startsWith(`${API_ERROR}: `)) return OTHER
  const rest = text.slice(API_ERROR.length + 2)
  const status = /^(\d{3})\b/.exec(rest)?.[1] ?? null
  if (status !== null) {
    // A 4xx status is not temporary whatever its body says; a 5xx with an overloaded body is.
    if (!status.startsWith('5')) return OTHER
    const kind = jsonErrorType(rest) === 'overloaded_error' ? 'overloaded' : STATUS_TRANSIENT.get(status)
    return kind === undefined ? OTHER : transient(kind)
  }
  if (rest.startsWith('{')) {
    const type = jsonErrorType(rest)
    const kind = type === null ? undefined : TYPE_TRANSIENT.get(type)
    return kind === undefined ? OTHER : transient(kind)
  }
  const lost = /^Connection to the API was lost\b(?: \(([^)]*)\))?/.exec(rest)
  if (lost !== null) return lost[1] !== undefined && LOST_REFUSED.has(lost[1]) ? OTHER : transient('connection')
  for (const [phrase, kind] of PHRASES) if (phrase.test(rest)) return transient(kind)
  return OTHER
}

/**
 * The `error.type` of the API's JSON body on the first line (`overloaded_error`, `api_error`, …),
 * or null. Read by its field rather than parsed, so a body Claude Code cut short still counts.
 */
function jsonErrorType(rest: string): string | null {
  const line = rest.split('\n', 1)[0] ?? ''
  return /"type"\s*:\s*"([a-z_]+_error)"/.exec(line)?.[1] ?? null
}

/** How the turn `end` failed: none (it did not), transient (a temporary API error) or other. */
export function turnFailureKind(end: TurnEndInput): TurnFailure {
  if (!end.isError || end.interrupted) return NONE
  switch (end.vendor) {
    case 'claude':
      return claudeFailure(end.error)
    case 'codex': {
      const kind = end.terminalReason === null ? undefined : CODEX_TRANSIENT.get(end.terminalReason)
      return kind === undefined ? OTHER : transient(kind)
    }
    default:
      return OTHER
  }
}

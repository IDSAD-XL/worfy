// Which turn failure is transient (worfy-retry ticket 01): the error shapes Claude Code 2.1.289 and the
// older fixtures report, the Codex `codexErrorInfo` kinds, and what stays a stop as today.
import { describe, expect, it } from 'vitest'
import { turnFailureKind, type TurnEndInput } from '../../src/shared/agent/turn-failure'

const claude = (error: string | null, extra: Partial<TurnEndInput> = {}): TurnEndInput => ({
  vendor: 'claude',
  isError: true,
  interrupted: false,
  error,
  terminalReason: 'api_error',
  ...extra,
})
const codex = (terminalReason: string | null, error: string | null = 'Codex reported an error.', extra: Partial<TurnEndInput> = {}): TurnEndInput => ({
  vendor: 'codex',
  isError: true,
  interrupted: false,
  error,
  terminalReason,
  ...extra,
})

const SERVER_SIDE = 'This is a server-side issue, usually temporary — try again in a moment.'

describe('turnFailureKind: Claude Code', () => {
  it('reads a 529 with overloaded_error as transient overloaded', () => {
    const text = 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'
    expect(turnFailureKind(claude(text))).toEqual({ kind: 'transient', error: 'overloaded' })
  })

  it.each([
    ['API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}', 'api-500'],
    [`API Error: 500 Internal server error. ${SERVER_SIDE}`, 'api-500'],
    [`API Error: 502 Bad Gateway. ${SERVER_SIDE}`, 'api-502'],
    [`API Error: 503 Service Unavailable. ${SERVER_SIDE}`, 'api-503'],
    [`API Error: 504 Gateway Timeout. ${SERVER_SIDE}`, 'api-504'],
    [`API Error: 529 Overloaded. ${SERVER_SIDE}`, 'overloaded'],
    ['API Error: 529 overloaded', 'overloaded'],
    ['API Error: Repeated 529 Overloaded errors. The API is at capacity — this is usually temporary. Try again in a moment.', 'overloaded'],
    // The JSON type alone, when the text has no status.
    ['API Error: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', 'overloaded'],
    ['API Error: {"type":"error","error":{"type":"api_error","message":"Internal server error"}}', 'api-500'],
    // A 5xx status with an overloaded body.
    ['API Error: 503 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}', 'overloaded'],
    // A 5xx status keeps its own kind when the overloaded body is not on the first line.
    ['API Error: 503 Service Unavailable\n{"type":"error","error":{"type":"overloaded_error"}}', 'api-503'],
    // An error event inside the response stream: no status, the API's message alone (2.1.289).
    ['API Error: Overloaded', 'overloaded'],
    ['API Error: Internal server error', 'api-500'],
    ['API Error: Connection error.', 'connection'],
    ['API Error: Connection dropped (ECONNRESET)', 'connection'],
    ['API Error: Unable to connect to API. Check your internet connection', 'connection'],
    ["API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)", 'connection'],
    ['API Error: No internet route — check your connection or VPN (ENETUNREACH)', 'connection'],
    ['API Error: Connection to the API was lost (ECONNRESET). This is usually temporary — try again.', 'connection'],
    ['API Error: Connection to the API was lost (StreamTruncated). This is usually temporary — try again.', 'connection'],
    ['API Error: Connection to the API was lost (ENOTFOUND). This is usually temporary — try again.', 'connection'],
    ['API Error: Connection to the API was lost', 'connection'],
    ['API Error: Connection lost while your computer was asleep', 'connection'],
    ['API Error: Connection closed before the response finished', 'stream'],
    ['Request timed out', 'timeout'],
    ['API Error: Request timed out.', 'timeout'],
    ['API Error: Request timed out. Check your internet connection and proxy settings', 'timeout'],
    ['API Error: No response from API (waited 1m 0s). If a proxy or gateway on your network holds responses until they complete, raise API_TIMEOUT_MS', 'timeout'],
  ])('%s → transient %s', (text, error) => {
    expect(turnFailureKind(claude(text))).toEqual({ kind: 'transient', error })
  })

  it('ignores whitespace around the text', () => {
    expect(turnFailureKind(claude('\n  API Error: 503 Service Unavailable.\n'))).toEqual({ kind: 'transient', error: 'api-503' })
  })

  it.each([
    'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Bad request"}}',
    'API Error: 400 due to tool use concurrency issues. Run /rewind to recover the conversation.',
    'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
    'Please run /login · API Error: 401 {"type":"error","error":{"type":"authentication_error"}}',
    'API Error: 403 {"type":"error","error":{"type":"permission_error","message":"Forbidden"}}',
    'API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"model: x"}}',
    'API Error: 413 request_too_large',
    'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Rate limited"}}',
    'API Error: Server is temporarily limiting requests (not your usage limit) · this may be a temporary capacity issue.',
    'API Error: 501 Not Implemented',
    // A 4xx status wins over an api_error type in its JSON.
    'API Error: 400 {"type":"error","error":{"type":"api_error","message":"odd"}}',
    'API Error: 400 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
    // The JSON type counts on the first line only.
    'API Error: {"type":"error",\n"error":{"type":"api_error","message":"Internal server error"}}',
    // A 529 on one model comes as a rate_limit error (Q4: not transient).
    'Opus is experiencing high load, please use /model to switch to Sonnet',
    'Opus is experiencing high load. Switch to Sonnet.',
    // Claude Code's branch for connection codes it does not know: TLS and setup errors.
    'API Error: Unable to connect to API (EPROTO)',
    'API Error: Unable to connect to API (ERR_SSL_PACKET_LENGTH_TOO_LONG)',
    'API Error: Unable to connect to API (ERR_INVALID_URL)',
    // A refusal by the network's setup under the lost-connection text.
    'API Error: Connection to the API was lost (ECONNREFUSED). This is usually temporary — try again.',
    'API Error: Connection to the API was lost (ConnectionRefused). This is usually temporary — try again.',
    'API Error: Connection to the API was lost (ERR_PROXY_TUNNEL). This is usually temporary — try again.',
    'API Error: Unable to connect to API: SSL certificate verification failed (UNABLE_TO_VERIFY_LEAF_SIGNATURE)',
    'API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)',
    "API Error: Couldn't connect through your proxy (ERR_PROXY_TUNNEL)",
    'API Error',
    'API Error: something new',
    'Not logged in · Please run /login',
    'Prompt is too long',
    'The turn failed.',
    // Codes and words later in the text do not count: only the start of the text does.
    'Tool failed: API Error: 500 {"type":"error","error":{"type":"api_error"}}',
    'Error: the server said 503 and then Connection error.',
    'API Error: Could not load bedrock credentials · Connection error.',
    'API Error: The proxy said: Connection closed before the response finished',
    // Whole words and whole messages only.
    'API Error: Request timed outage',
    'API Error: Overloaded with requests from your organization',
    'API Error: Internal server error in the proxy',
    '',
  ])('%s → other', (text) => {
    expect(turnFailureKind(claude(text))).toEqual({ kind: 'other' })
  })

  it('reads a failed turn without an error text as other', () => {
    expect(turnFailureKind(claude(null))).toEqual({ kind: 'other' })
  })

  it.each([
    "You've hit your limit · resets 3pm",
    "You've hit your limit · resets 3pm (Europe/Kiev)",
    'Claude AI usage limit reached|1791184200',
    'API Error: rate_limit',
  ])('does not take the Limits refusal %s for transient', (text) => {
    expect(turnFailureKind(claude(text)).kind).not.toBe('transient')
  })
})

describe('turnFailureKind: Codex', () => {
  it.each([
    ['serverOverloaded', 'overloaded'],
    ['internalServerError', 'api-500'],
    ['httpConnectionFailed', 'connection'],
    ['responseStreamConnectionFailed', 'connection'],
    ['responseStreamDisconnected', 'stream'],
    ['responseTooManyFailedAttempts', 'stream'],
  ])('%s → transient %s', (reason, error) => {
    expect(turnFailureKind(codex(reason))).toEqual({ kind: 'transient', error })
  })

  it.each(['contextWindowExceeded', 'modelNotFound', 'usageLimitExceeded', 'rateLimitExceeded', 'unauthorized', 'badRequest', 'cyberPolicy', 'sandboxError', 'other', 'failed', 'error', 'somethingNew', 'constructor', 'toString'])(
    '%s → other',
    (reason) => {
      expect(turnFailureKind(codex(reason))).toEqual({ kind: 'other' })
    },
  )

  it('reads a failed turn without a terminal reason as other', () => {
    expect(turnFailureKind(codex(null))).toEqual({ kind: 'other' })
  })

  it('goes by the terminal reason only, not by the error text', () => {
    expect(turnFailureKind(codex('contextWindowExceeded', 'API Error: 529 {"type":"error","error":{"type":"overloaded_error"}}'))).toEqual({ kind: 'other' })
    expect(turnFailureKind(codex('badRequest', 'stream disconnected before completion: Connection error.'))).toEqual({ kind: 'other' })
    expect(turnFailureKind(codex('serverOverloaded', 'Bad request: your input is invalid'))).toEqual({ kind: 'transient', error: 'overloaded' })
    expect(turnFailureKind(codex('responseStreamDisconnected', null))).toEqual({ kind: 'transient', error: 'stream' })
  })
})

describe('turnFailureKind: turns that did not fail', () => {
  it('reads a successful turn as none, for both Vendors', () => {
    expect(turnFailureKind(claude(null, { isError: false, terminalReason: 'completed' }))).toEqual({ kind: 'none' })
    expect(turnFailureKind(codex('completed', null, { isError: false }))).toEqual({ kind: 'none' })
  })

  it('reads an interrupted turn as none, even with a transient-looking error', () => {
    expect(turnFailureKind(claude('API Error: 500 Internal server error.', { interrupted: true, terminalReason: 'aborted_streaming' }))).toEqual({ kind: 'none' })
    expect(turnFailureKind(codex('serverOverloaded', 'The turn was interrupted.', { interrupted: true }))).toEqual({ kind: 'none' })
  })

  it('reads a failed turn of an unknown Vendor as other', () => {
    expect(turnFailureKind({ vendor: 'gemini', isError: true, interrupted: false, error: 'API Error: 500 Internal server error.', terminalReason: 'serverOverloaded' })).toEqual({ kind: 'other' })
  })
})

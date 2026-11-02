// JSON-RPC 2.0 with a Codex app-server over lines of stdio (worfy-multi-vendor ticket 19). A pure
// module: lines come in through receive(), lines go out through the `write` it is given; the process
// around it is app-server.ts. The app-server speaks JSON-RPC without the "jsonrpc" field, one JSON
// message per line, and so does this client.
//
// Every incoming message is checked against the JSON Schema of the pinned Codex
// (protocol/json/, generated in ticket 17; schema.ts): a notification and a server→client request
// against the branch of their method in ServerNotification and ServerRequest, the result of an answer
// against the response of the method it answers, when the bundle has one. A message that fails the
// check, or names a method the pinned version does not have, becomes an `unknown` event and a log
// line, never an exception: the app-server is experimental and has no promise of compatibility
// between versions (ticket 02, the main risk). A line that is not JSON becomes an `error` event.
import type { ValidateFunction } from 'ajv'
import type { ClientNotification } from './protocol/ts/ClientNotification'
import type { ClientRequest } from './protocol/ts/ClientRequest'
import type { RequestId } from './protocol/ts/RequestId'
import type { ServerNotification } from './protocol/ts/ServerNotification'
import type { ServerRequest } from './protocol/ts/ServerRequest'
import bundle from './protocol/json/codex_app_server_protocol.schemas.json'
import { codexAjv } from './schema'

/** How long a request waits for its answer by default. */
export const REQUEST_TIMEOUT_MS = 60_000

/** The JSON-RPC error codes worfy sends back. */
export const METHOD_NOT_FOUND = -32601
export const INVALID_PARAMS = -32602

/** What comes out of the app-server, in worfy's hands. */
export type CodexRpcEvent =
  | { type: 'notification'; notification: ServerNotification }
  /** A server→client request: answer it with respond() or respondError() and its id. */
  | { type: 'request'; request: ServerRequest }
  /**
   * A message the JSON Schema of the pinned Codex does not know: its method (null for an answer or a
   * message without one), what failed the check, and the line itself.
   */
  | { type: 'unknown'; method: string | null; problems: string[]; line: string }
  /** A line that is not a JSON message. */
  | { type: 'error'; message: string; line: string }

/** The error a request is rejected with when the app-server answers it with a JSON-RPC error. */
export class CodexRpcError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    readonly rpcMessage: string,
    readonly data?: unknown,
  ) {
    super(`Codex app-server refused ${method}: ${rpcMessage} (code ${code})`)
    this.name = 'CodexRpcError'
  }
}

/** A method of a client request, and its params. */
export type ClientMethod = ClientRequest['method']
export type ParamsOf<M extends ClientMethod> = Extract<ClientRequest, { method: M }>['params']

/** Whether `incoming` passes the schema of the pinned Codex: the problems, empty when it does. */
export interface CodexSchemaCheck {
  notification(message: unknown, method: string): string[] | null
  request(message: unknown, method: string): string[] | null
  /** The problems of the result of an answer to `method`; empty when the bundle has no response schema for it. */
  result(result: unknown, method: string): string[]
}

export interface CodexRpcOptions {
  /** Sends one line to the app-server (the newline included). */
  write: (line: string) => void
  /** Every event, in the order the lines came. */
  onEvent: (event: CodexRpcEvent) => void
  /** A line of the log: what the schema refused, an answer nobody waits for; console.warn by default. */
  log?: (line: string) => void
  /** How long a request waits for its answer; REQUEST_TIMEOUT_MS by default. */
  timeoutMs?: number
  /** The check of incoming messages; the JSON Schema of the pinned Codex by default. */
  schema?: CodexSchemaCheck
}

interface Pending {
  method: string
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const isId = (value: unknown): value is RequestId => typeof value === 'string' || typeof value === 'number'

/** A JSON-RPC client of one app-server process. */
export class CodexRpc {
  private nextId = 1
  private readonly pending = new Map<RequestId, Pending>()
  private failure: Error | undefined
  private readonly log: (line: string) => void
  private readonly timeoutMs: number
  private readonly schema: CodexSchemaCheck

  constructor(private readonly options: CodexRpcOptions) {
    this.log = options.log ?? ((line) => console.warn(`[codex] ${line}`))
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
    this.schema = options.schema ?? codexSchemaCheck()
  }

  /**
   * Sends a request and settles with its result: rejects with CodexRpcError on a JSON-RPC error, on a
   * result the schema refuses, after the time limit, and once fail() was called.
   */
  request<R = unknown, M extends ClientMethod = ClientMethod>(method: M, params: ParamsOf<M>, timeoutMs = this.timeoutMs): Promise<R> {
    if (this.failure !== undefined) return Promise.reject(this.failure)
    const id = this.nextId++
    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex app-server did not answer ${method} (request ${id}) within ${timeoutMs} ms`))
      }, timeoutMs)
      this.pending.set(id, { method, resolve: resolve as (result: unknown) => void, reject, timer })
      this.send(params === undefined ? { id, method } : { id, method, params })
    })
  }

  /** Sends a notification. */
  notify(method: ClientNotification['method']): void {
    if (this.failure === undefined) this.send({ method })
  }

  /** Answers a server→client request. */
  respond(id: RequestId, result: unknown): void {
    if (this.failure === undefined) this.send({ id, result })
  }

  /** Refuses a server→client request with a JSON-RPC error. */
  respondError(id: RequestId, code: number, message: string): void {
    if (this.failure === undefined) this.send({ id, error: { code, message } })
  }

  /** How many requests wait for their answer. */
  get waiting(): number {
    return this.pending.size
  }

  /**
   * The app-server is gone (its process exited or its pipe broke): every waiting request is rejected
   * with `error`, and every later one at once. Called once; later calls change nothing.
   */
  fail(error: Error): void {
    if (this.failure !== undefined) return
    this.failure = error
    for (const [id, waiting] of this.pending) {
      clearTimeout(waiting.timer)
      this.pending.delete(id)
      waiting.reject(error)
    }
  }

  /** Takes one line of the app-server's stdout. Never throws. */
  receive(line: string): void {
    const text = line.trim()
    if (text === '') return
    let message: unknown
    try {
      message = JSON.parse(text)
    } catch (error) {
      this.emit({ type: 'error', message: `not JSON: ${(error as Error).message}`, line: text })
      return
    }
    if (!isObject(message)) return this.unknown(null, ['not a JSON-RPC message: not an object'], text)
    const method = message.method
    if (typeof method === 'string') {
      if (message.id === undefined) return this.takeNotification(message, method, text)
      return this.takeRequest(message, method, text)
    }
    if (isId(message.id) && ('result' in message || 'error' in message)) return this.takeAnswer(message, message.id, text)
    this.unknown(null, ['not a JSON-RPC message: no method, and not an answer'], text)
  }

  private takeNotification(message: Json, method: string, line: string): void {
    const problems = this.schema.notification(message, method)
    if (problems === null) return this.unknown(method, [`${method} is not a notification of the pinned Codex`], line)
    if (problems.length > 0) return this.unknown(method, problems, line)
    this.emit({ type: 'notification', notification: message as unknown as ServerNotification })
  }

  /** A request worfy cannot read is refused, so the app-server does not wait for its answer. */
  private takeRequest(message: Json, method: string, line: string): void {
    const id = message.id
    const problems = isId(id) ? this.schema.request(message, method) : ['the id is neither a string nor a number']
    if (problems === null || problems.length > 0) {
      this.unknown(method, problems ?? [`${method} is not a request of the pinned Codex`], line)
      if (isId(id)) this.respondError(id, problems === null ? METHOD_NOT_FOUND : INVALID_PARAMS, problems === null ? `worfy does not know ${method}` : `worfy cannot read ${method}: ${problems.join('; ')}`)
      return
    }
    this.emit({ type: 'request', request: message as unknown as ServerRequest })
  }

  private takeAnswer(message: Json, id: RequestId, line: string): void {
    const waiting = this.pending.get(id)
    if (waiting === undefined) return this.unknown(null, [`an answer to ${JSON.stringify(id)}, which no request waits for`], line)
    this.pending.delete(id)
    clearTimeout(waiting.timer)
    if ('error' in message) {
      const error = message.error
      if (!isObject(error) || typeof error.code !== 'number' || typeof error.message !== 'string') {
        this.unknown(waiting.method, ['the error of the answer is not a JSON-RPC error'], line)
        waiting.reject(new Error(`Codex app-server answered ${waiting.method} with an error worfy cannot read: ${line}`))
        return
      }
      waiting.reject(new CodexRpcError(waiting.method, error.code, error.message, error.data))
      return
    }
    const problems = this.schema.result(message.result, waiting.method)
    if (problems.length > 0) {
      this.unknown(waiting.method, problems, line)
      waiting.reject(new Error(`Codex app-server answered ${waiting.method} with a result the pinned Codex does not have: ${problems.join('; ')}`))
      return
    }
    waiting.resolve(message.result)
  }

  private unknown(method: string | null, problems: string[], line: string): void {
    this.log(`a message of the app-server is not in the schema of the pinned Codex${method === null ? '' : ` (${method})`}: ${problems.join('; ')}`)
    this.emit({ type: 'unknown', method, problems, line })
  }

  private emit(event: CodexRpcEvent): void {
    this.options.onEvent(event)
  }

  private send(message: Json): void {
    this.options.write(`${JSON.stringify(message)}\n`)
  }
}

// --- The JSON Schema of the pinned Codex -----------------------------------------------------------

interface Branch {
  properties: { method: { enum: [string] }; params?: { $ref?: string } }
}

interface Bundle {
  definitions: Record<string, unknown> & { v2: Record<string, unknown> } & Record<'ClientRequest' | 'ServerNotification' | 'ServerRequest', { oneOf: Branch[] }>
}

/** How many problems of one message the log names; the rest are counted. */
const PROBLEMS_SHOWN = 5

let shared: CodexSchemaCheck | undefined

/**
 * The check against the bundle of the pinned Codex. One for the whole process: the bundle is compiled
 * once, the schema of each method the first time a message of it comes.
 */
export function codexSchemaCheck(): CodexSchemaCheck {
  shared ??= schemaCheck(bundle as unknown as Bundle)
  return shared
}

function schemaCheck(schemas: Bundle): CodexSchemaCheck {
  const ajv = codexAjv()
  ajv.addSchema(schemas, 'codex')
  const compiled = new Map<string, ValidateFunction | undefined>()
  const get = (pointer: string): ValidateFunction | undefined => {
    if (!compiled.has(pointer)) compiled.set(pointer, ajv.getSchema(`codex#${pointer}`))
    return compiled.get(pointer)
  }
  /** The pointer of the branch of each method of a union. */
  const branches = (union: 'ClientRequest' | 'ServerNotification' | 'ServerRequest'): Map<string, number> =>
    new Map(schemas.definitions[union].oneOf.map((branch, index) => [branch.properties.method.enum[0], index]))
  const notifications = branches('ServerNotification')
  const requests = branches('ServerRequest')
  const clientRequests = branches('ClientRequest')
  const problemsOf = (validate: ValidateFunction | undefined, value: unknown): string[] => {
    if (validate === undefined || validate(value)) return []
    const errors = (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? 'fails the schema'}`)
    return errors.length > PROBLEMS_SHOWN ? [...errors.slice(0, PROBLEMS_SHOWN), `and ${errors.length - PROBLEMS_SHOWN} more`] : errors
  }
  const branchCheck = (union: 'ServerNotification' | 'ServerRequest', methods: Map<string, number>) => (message: unknown, method: string): string[] | null => {
    const index = methods.get(method)
    return index === undefined ? null : problemsOf(get(`/definitions/${union}/oneOf/${index}`), message)
  }
  /** `#/definitions/v2/ThreadStartParams` → `/definitions/v2/ThreadStartResponse`, when the bundle has it. */
  const responseOf = (method: string): string | undefined => {
    const index = clientRequests.get(method)
    const ref = index === undefined ? undefined : schemas.definitions.ClientRequest.oneOf[index]?.properties.params?.$ref
    if (ref === undefined || !ref.endsWith('Params')) return undefined
    const path = ref.replace(/^#/, '').replace(/Params$/, 'Response')
    const [, , ...names] = path.split('/')
    let at: unknown = schemas.definitions
    for (const name of names) at = isObject(at) ? at[name] : undefined
    return at === undefined ? undefined : path
  }
  return {
    notification: branchCheck('ServerNotification', notifications),
    request: branchCheck('ServerRequest', requests),
    result: (result, method) => {
      const response = responseOf(method)
      return response === undefined ? [] : problemsOf(get(response), result)
    },
  }
}

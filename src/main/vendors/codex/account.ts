// The account part of the Codex driver (ADR-0094 item 2; worfy-multi-vendor ticket 21): who is signed
// in to Codex (`account/read`) and the ChatGPT sign-in (`account/login/start {type: "chatgpt"}`). Each
// ask starts its own short-lived `codex app-server` (app-server.ts) and closes it after the answer: there
// is no shared process (spec, the process of a Session).
//
// worfy offers only the ChatGPT sign-in, never an API key (spec, "Never"), and keeps no tokens: Codex
// keeps them in its own home (ADR-0009). worfy writes nothing into CODEX_HOME or a Project's repository
// (ADR-0005): it only looks whether CODEX_HOME exists, and the process runs in worfy's own empty folder
// (<WORFY_DATA_DIR>/terminal-ai, as the Limits probe of Claude does).
//
// The index of the driver imports this file while the Session registry loads: the app, the app-server
// client and its JSON Schema are loaded at the call.
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AccountConnection, AccountPart, LoginAttempt } from '../account'
import type { CodexAppServerOptions } from './app-server'
import type { AccountLoginCompletedNotification } from './protocol/ts/v2/AccountLoginCompletedNotification'
import type { GetAccountResponse } from './protocol/ts/v2/GetAccountResponse'
import type { LoginAccountResponse } from './protocol/ts/v2/LoginAccountResponse'
import type { ClientMethod, CodexRpcEvent, ParamsOf } from './rpc'

/** How long one ask of the account or the Limits may wait for its answer. */
export const CODEX_ASK_TIMEOUT_MS = 30 * 1000

/** How long a sign-in may stay open in the browser before worfy cancels it and closes its process. */
export const LOGIN_TIMEOUT_MS = 10 * 60 * 1000

/** What the account and the Limits need of one app-server: its requests, the end of its process, its close. */
export interface CodexAsk {
  request<R = unknown, M extends ClientMethod = ClientMethod>(method: M, params: ParamsOf<M>, timeoutMs?: number): Promise<R>
  /** Calls `listener` once the process is gone; at once when it already is. */
  onExit(listener: () => void): void
  /** Ends the process; settles once it has exited, never rejects. */
  close(): Promise<void>
}

/** Starts an app-server past its handshake; `onEvent` gets its notifications and requests. */
export type StartCodex = (onEvent: (event: CodexRpcEvent) => void) => Promise<CodexAsk>

/** Where an app-server for an ask starts and what it runs on; the rest of CodexAppServerOptions. */
export type CodexAskOptions = Omit<CodexAppServerOptions, 'onEvent'>

/** A StartCodex over CodexAppServer (app-server.ts) with `options`. */
export function codexAskStarter(options: CodexAskOptions): StartCodex {
  return async (onEvent) => {
    const [{ CodexAppServer }, { hasExited }] = await Promise.all([import('./app-server'), import('../../agent/session/process')])
    const server = await CodexAppServer.start({ ...options, onEvent })
    return {
      request: (method, params, timeoutMs) => server.request(method, params, timeoutMs),
      onExit: (listener) => {
        if (hasExited(server.process)) listener()
        else server.process.once('exit', () => listener())
      },
      close: () => server.close(),
    }
  }
}

/**
 * The app's StartCodex: the pinned Codex (or the fake under WORFY_CODEX=fake) in
 * <WORFY_DATA_DIR>/terminal-ai, with the environment of the app.
 */
export const appCodexStarter: StartCodex = async (onEvent) => {
  const [{ app }, { dataRoot }, { assistDir }] = await Promise.all([import('electron'), import('../../storage/paths'), import('../../terminal-ai/options')])
  const cwd = assistDir(dataRoot())
  mkdirSync(cwd, { recursive: true })
  const runtime = { packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform, arch: process.arch }
  return codexAskStarter({ runtime, appPath: app.getAppPath(), clientVersion: app.getVersion(), cwd })(onEvent)
}

/** Whether the app can start a Codex: the pinned binary of this build, or the fake under WORFY_CODEX=fake. */
export const appCodexInBuild = async (): Promise<boolean> => {
  const [{ app }, { codexInBuild }] = await Promise.all([import('electron'), import('./launch')])
  return codexInBuild({ runtime: { packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform, arch: process.arch }, appPath: app.getAppPath() })
}

/** The folder Codex keeps its sign-in in: CODEX_HOME, else ~/.codex (as Codex itself picks it). */
export const codexHomeOf = (env: Readonly<Record<string, string | undefined>> = process.env): string => env.CODEX_HOME || join(homedir(), '.codex')

/**
 * Starts an app-server with `start`, runs `use` on it and closes it (useCodex). Nothing starts when
 * `signal` is already aborted.
 */
export async function withCodex<T>(start: StartCodex, signal: AbortSignal | undefined, use: (ask: CodexAsk) => Promise<T>): Promise<T> {
  signal?.throwIfAborted()
  return useCodex(await start(() => undefined), signal, use)
}

/**
 * Runs `use` on a started app-server and closes it, also when `use` fails. An abort of `signal` rejects
 * with its reason at once and closes the process: no request is left waiting.
 */
export async function useCodex<T>(ask: CodexAsk, signal: AbortSignal | undefined, use: (ask: CodexAsk) => Promise<T>): Promise<T> {
  let onAbort = (): void => undefined
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal?.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
  try {
    signal?.throwIfAborted()
    // Promise.race subscribes to both, so a `use` that rejects after the abort leaves no unhandled rejection.
    return await Promise.race([use(ask), aborted])
  } finally {
    signal?.removeEventListener('abort', onAbort)
    await ask.close()
  }
}

const notSignedIn = (): AccountConnection => ({ provider: 'openai', signedIn: false, email: null, plan: null })

/**
 * The connection an answer of `account/read` describes. Only the ChatGPT sign-in counts: an API key or a
 * cloud provider's credentials are a sign-in worfy never uses (spec, "Never").
 */
export function codexConnectionOf(answer: GetAccountResponse): AccountConnection {
  const account = answer.account
  if (account?.type !== 'chatgpt') return notSignedIn()
  return { provider: 'openai', signedIn: true, email: account.email, plan: account.planType }
}

/** Asks `account/read` of a running app-server. */
export async function readCodexAccount(ask: CodexAsk): Promise<AccountConnection> {
  return codexConnectionOf(await ask.request<GetAccountResponse>('account/read', { refreshToken: false }, CODEX_ASK_TIMEOUT_MS))
}

export interface CodexAccountOptions {
  /** appCodexStarter by default; tests start the fake. */
  start?: StartCodex
  /** Opens the sign-in page in the browser: Electron's shell.openExternal by default; tests replace it. */
  openUrl?: (url: string) => Promise<void>
  /** The folder Codex keeps its sign-in in; codexHomeOf() by default. */
  codexHome?: () => string
  /** Where the one line about a Codex that does not start goes; console.debug by default. */
  log?: (message: string, error?: unknown) => void
  loginTimeoutMs?: number
  /** Whether this build can start a Codex: appCodexInBuild by default. */
  inBuild?: () => Promise<boolean>
}

const openWithShell = async (url: string): Promise<void> => {
  const { shell } = await import('electron')
  await shell.openExternal(url)
}

/** The account part of the Codex driver over `options`. */
export function codexAccountPart(options: CodexAccountOptions = {}): AccountPart {
  const start = options.start ?? appCodexStarter
  const openUrl = options.openUrl ?? openWithShell
  const codexHome = options.codexHome ?? (() => codexHomeOf())
  const log = options.log ?? ((message, error) => console.debug(message, ...(error === undefined ? [] : [error])))
  const loginTimeoutMs = options.loginTimeoutMs ?? LOGIN_TIMEOUT_MS
  return {
    /**
     * One connection. Not signed in, without an exception, when Codex has no home folder yet (it was
     * never run, so nothing is started) or its app-server does not start (no Codex for this platform);
     * rejects when the app-server started but did not answer.
     */
    async check(signal) {
      signal?.throwIfAborted()
      if (!existsSync(codexHome())) return [notSignedIn()]
      let started: CodexAsk
      try {
        started = await start(() => undefined)
      } catch (error) {
        log('[codex] the app-server did not start: Codex counts as not signed in', error)
        return [notSignedIn()]
      }
      return [await useCodex(started, signal, readCodexAccount)]
    },
    startLogin: () => startCodexLogin(start, openUrl, loginTimeoutMs),
    inBuild: options.inBuild ?? appCodexInBuild,
  }
}

/**
 * The ChatGPT sign-in: on its own app-server, `account/read` (a Codex already signed in is not signed in
 * again), `account/login/start {type: "chatgpt"}`, the page it names opened by `openUrl`, then the wait
 * for `account/login/completed` of that sign-in and `account/read` again. The process is closed once
 * the sign-in is over, failed, cancelled or timed out.
 */
async function startCodexLogin(start: StartCodex, openUrl: (url: string) => Promise<void>, timeoutMs: number): Promise<LoginAttempt> {
  // The notification can come in the same chunk of stdout as the answer to account/login/start, before
  // that answer is read here: every one is kept from the start.
  const completions: AccountLoginCompletedNotification[] = []
  let wake = (): void => undefined
  const ask = await start((event) => {
    if (event.type !== 'notification' || event.notification.method !== 'account/login/completed') return
    completions.push(event.notification.params)
    wake()
  })
  let loginId: string
  let url: string
  try {
    const before = await readCodexAccount(ask)
    if (before.signedIn) throw new Error(`Codex is already signed in${before.email === null ? '' : ` as ${before.email}`}`)
    const started = await ask.request<LoginAccountResponse>('account/login/start', { type: 'chatgpt' }, CODEX_ASK_TIMEOUT_MS)
    if (started.type !== 'chatgpt') throw new Error(`Codex started a sign-in of another kind: ${started.type}`)
    ;({ loginId, authUrl: url } = started)
    await openUrl(url)
  } catch (error) {
    await ask.close()
    throw error
  }

  let settled = false
  let stop: (reason: Error) => void = () => undefined
  const over = new Promise<AccountLoginCompletedNotification>((resolve, reject) => {
    stop = reject
    const look = (): void => {
      const done = completions.find((completion) => completion.loginId === loginId || completion.loginId === null)
      if (done !== undefined) resolve(done)
    }
    wake = look
    look()
    ask.onExit(() => reject(new Error('the Codex app-server exited before the sign-in was over')))
  })
  const cancel = (reason: Error): void => {
    if (settled) return
    ask.request('account/login/cancel', { loginId }, CODEX_ASK_TIMEOUT_MS).catch(() => undefined)
    stop(reason)
  }
  const timer = setTimeout(() => cancel(new Error(`the Codex sign-in was not completed within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs)
  const completed = (async () => {
    try {
      const done = await over.finally(() => {
        settled = true
      })
      if (!done.success) throw new Error(`the Codex sign-in failed: ${done.error ?? 'Codex gave no reason'}`)
      return [await readCodexAccount(ask)]
    } finally {
      clearTimeout(timer)
      await ask.close()
    }
  })()
  return { start: { kind: 'url', url }, completed, cancel: () => cancel(new Error('the Codex sign-in was cancelled')) }
}

/** The account part of the app's Codex driver. */
export const codexAccount: AccountPart = codexAccountPart()

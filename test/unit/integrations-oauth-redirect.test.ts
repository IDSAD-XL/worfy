// The redirect of an OAuth sign-in (worfy-integrations ticket 05): the window catches
// http://127.0.0.1/worfy-oauth/<id> with its own request hook, the system browser's sign-in comes back to a loopback
// listener on a random port (RFC 8252). Each takes only the redirect of its own Integration and its own `state`; the
// window lets no worfy redirect reach 127.0.0.1; the listener closes after its answer and after 10 minutes.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isSignInRedirect, listenLoopback, redirectOutcome, SIGN_IN_TIMEOUT_MS, windowOpener, type WindowElectron } from '../../src/main/integrations/auth/oauth'

const ID = 'a1b2c3d4e5f60718'
const OTHER = 'ffeeddccbbaa0099'
const STATE = 'state-of-this-sign-in'

afterEach(() => {
  vi.useRealTimers()
})

describe('redirectOutcome', () => {
  it('takes the code of its own Integration and state', () => {
    expect(redirectOutcome(`http://127.0.0.1/worfy-oauth/${ID}?code=c-1&state=${STATE}`, ID, STATE)).toEqual({ code: 'c-1' })
    expect(redirectOutcome(`http://127.0.0.1:5123/worfy-oauth/${ID}?state=${STATE}&code=c-2`, ID, STATE, 5123)).toEqual({ code: 'c-2' })
  })

  it('brings the service’s refusal', () => {
    expect(redirectOutcome(`http://127.0.0.1/worfy-oauth/${ID}?error=access_denied&state=${STATE}`, ID, STATE)).toEqual({ error: 'access_denied' })
    expect(redirectOutcome(`http://127.0.0.1/worfy-oauth/${ID}?error=x&error_description=Not+allowed&state=${STATE}`, ID, STATE)).toEqual({ error: 'Not allowed' })
  })

  it.each([
    ['another Integration', `http://127.0.0.1/worfy-oauth/${OTHER}?code=c&state=${STATE}`],
    ['another state', `http://127.0.0.1/worfy-oauth/${ID}?code=c&state=other`],
    ['no state', `http://127.0.0.1/worfy-oauth/${ID}?code=c`],
    ['a path past the id', `http://127.0.0.1/worfy-oauth/${ID}/x?code=c&state=${STATE}`],
    ['an id with more after it', `http://127.0.0.1/worfy-oauth/${ID}x?code=c&state=${STATE}`],
    ['localhost', `http://localhost/worfy-oauth/${ID}?code=c&state=${STATE}`],
    ['https', `https://127.0.0.1/worfy-oauth/${ID}?code=c&state=${STATE}`],
    ['a port the window has not', `http://127.0.0.1:8080/worfy-oauth/${ID}?code=c&state=${STATE}`],
    ['not a URL', 'nothing'],
  ])('is not its sign-in’s: %s', (_case, url) => {
    expect(redirectOutcome(url, ID, STATE)).toBeNull()
  })

  it('on the listener, only its own port', () => {
    expect(redirectOutcome(`http://127.0.0.1:5124/worfy-oauth/${ID}?code=c&state=${STATE}`, ID, STATE, 5123)).toBeNull()
    expect(redirectOutcome(`http://127.0.0.1/worfy-oauth/${ID}?code=c&state=${STATE}`, ID, STATE, 5123)).toBeNull()
  })

  it('tells every worfy redirect from a page of the service', () => {
    expect(isSignInRedirect(`http://127.0.0.1/worfy-oauth/${OTHER}?code=c`)).toBe(true)
    expect(isSignInRedirect('http://127.0.0.1:9/worfy-oauth/x')).toBe(true)
    expect(isSignInRedirect('https://auth.example.test/authorize?redirect_uri=http://127.0.0.1/worfy-oauth/x')).toBe(false)
    expect(isSignInRedirect('http://127.0.0.1/other')).toBe(false)
  })
})

/** A stand-in of Electron with one window: the test plays its page's requests through the partition's hook. */
function fakeElectron() {
  let hook: ((details: { url: string }, callback: (response: { cancel?: boolean }) => void) => void) | null = null
  const closedListeners: (() => void)[] = []
  const state = { destroyed: false, loaded: [] as string[], partitions: [] as string[] }
  const electron: WindowElectron = {
    session: {
      fromPartition: (partition) => {
        state.partitions.push(partition)
        return { webRequest: { onBeforeRequest: (listener) => void (hook = listener) } }
      },
    },
    BrowserWindow: class {
      readonly webContents = {}
      async loadURL(url: string): Promise<void> {
        state.loaded.push(url)
      }
      on(_event: 'closed', listener: () => void): void {
        closedListeners.push(listener)
      }
      isDestroyed(): boolean {
        return state.destroyed
      }
      destroy(): void {
        state.destroyed = true
      }
    },
  }
  /** A request of the page: whether the hook cancelled it; null when no hook is on. */
  const request = (url: string): boolean | null => {
    if (hook === null) return null
    let cancelled = false
    hook({ url }, (response) => (cancelled = response.cancel === true))
    return cancelled
  }
  return { electron, state, request, close: () => closedListeners.forEach((listener) => listener()), hooked: () => hook !== null }
}

const open = (fake: ReturnType<typeof fakeElectron>, timeoutMs = SIGN_IN_TIMEOUT_MS) =>
  windowOpener(fake.electron)({ authorizationUrl: new URL('https://auth.example.test/authorize?x=1'), id: ID, state: STATE, partition: `persist:integration-${ID}`, title: 'Sign in', timeoutMs })

describe('the sign-in window', () => {
  it('opens the page on the Integration’s partition and ends with the code of its own redirect only', async () => {
    const fake = fakeElectron()
    const wait = open(fake)
    expect(fake.state.partitions).toEqual([`persist:integration-${ID}`])
    expect(fake.state.loaded).toEqual(['https://auth.example.test/authorize?x=1'])
    // The service's own pages load.
    expect(fake.request('https://auth.example.test/login')).toBe(false)
    // Another Integration's redirect, and this one's with another state: cancelled, the wait goes on.
    expect(fake.request(`http://127.0.0.1/worfy-oauth/${OTHER}?code=c&state=${STATE}`)).toBe(true)
    expect(fake.request(`http://127.0.0.1/worfy-oauth/${ID}?code=c&state=forged`)).toBe(true)
    expect(fake.hooked()).toBe(true)
    // Its own: cancelled too — nothing reaches 127.0.0.1 — and the wait ends with its code.
    expect(fake.request(`http://127.0.0.1/worfy-oauth/${ID}?code=the-code&state=${STATE}`)).toBe(true)
    await expect(wait.outcome).resolves.toEqual({ code: 'the-code' })
    expect(fake.hooked()).toBe(false)
    wait.close()
    expect(fake.state.destroyed).toBe(true)
  })

  it('closed by the person ends the wait with an error', async () => {
    const fake = fakeElectron()
    const wait = open(fake)
    fake.close()
    await expect(wait.outcome).rejects.toThrow(/closed before the sign-in finished/u)
    expect(fake.hooked()).toBe(false)
  })

  it('ends after 10 minutes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const fake = fakeElectron()
    const wait = open(fake)
    vi.advanceTimersByTime(SIGN_IN_TIMEOUT_MS - 1)
    expect(fake.hooked()).toBe(true)
    vi.advanceTimersByTime(1)
    await expect(wait.outcome).rejects.toThrow(/did not finish in 10 minutes/u)
    expect(fake.hooked()).toBe(false)
    expect(SIGN_IN_TIMEOUT_MS).toBe(10 * 60 * 1000)
  })
})

describe('the loopback listener', () => {
  it('listens on 127.0.0.1 on a random port, answers 404 to anything but its redirect, and closes after its answer', async () => {
    const wait = await listenLoopback({ id: ID, state: STATE, timeoutMs: SIGN_IN_TIMEOUT_MS })
    const port = Number(new URL(wait.redirectUrl).port)
    expect(wait.redirectUrl).toBe(`http://127.0.0.1:${port}/worfy-oauth/${ID}`)
    expect(port).toBeGreaterThan(0)
    for (const path of [`/worfy-oauth/${OTHER}?code=c&state=${STATE}`, `/worfy-oauth/${ID}?code=c&state=forged`, '/']) {
      expect((await fetch(`http://127.0.0.1:${port}${path}`)).status).toBe(404)
      expect(wait.listening()).toBe(true)
    }
    const answer = await fetch(`${wait.redirectUrl}?code=the-code&state=${STATE}`)
    expect(answer.status).toBe(200)
    expect(await answer.text()).toMatch(/Signed in/u)
    await expect(wait.outcome).resolves.toEqual({ code: 'the-code' })
    expect(wait.listening()).toBe(false)
    await expect(fetch(`${wait.redirectUrl}?code=again&state=${STATE}`)).rejects.toThrow()
  })

  it('closes after 10 minutes without a redirect', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const wait = await listenLoopback({ id: ID, state: STATE, timeoutMs: SIGN_IN_TIMEOUT_MS })
    vi.advanceTimersByTime(SIGN_IN_TIMEOUT_MS - 1)
    expect(wait.listening()).toBe(true)
    vi.advanceTimersByTime(1)
    await expect(wait.outcome).rejects.toThrow(/did not finish in 10 minutes/u)
    expect(wait.listening()).toBe(false)
    vi.useRealTimers()
    await expect(fetch(`${wait.redirectUrl}?code=late&state=${STATE}`)).rejects.toThrow()
  })
})

// The Browser profiles this window knows (src/renderer/browser/profiles.ts, worfy-browser ticket
// 14): «New browser» reads them with browserProfilesNow and writes the only one into the new Node.
// A list kept from an earlier read must not be given out while a new read is unanswered or after it
// failed: the Project may have more profiles by now, and the Node would be put under the wrong one.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserProfile } from '../../src/shared/browser/profiles'

type Answer = { ok: true; value: { profiles: BrowserProfile[] } } | { ok: false; error: string }

const main = vi.hoisted(() => ({ answers: [] as ((answer: Answer) => void)[] }))
vi.mock('../../src/renderer/ipc', () => ({
  invoke: () => new Promise<Answer>((resolve) => main.answers.push(resolve)),
  subscribe: () => () => undefined,
  hasPreloadBridge: () => (globalThis as { worfy?: unknown }).worfy !== undefined,
}))

const { browserProfilesNow, reloadBrowserProfiles } = await import('../../src/renderer/browser/profiles')

const profile = (id: string): BrowserProfile => ({ id, name: id, origins: [], autopilot: false })
const answer = (...ids: string[]): Answer => ({ ok: true, value: { profiles: ids.map(profile) } })
/** Answers the oldest read still waiting, and lets its handler run. */
async function reply(with_: Answer): Promise<void> {
  main.answers.shift()?.(with_)
  await new Promise((resolve) => setImmediate(resolve))
}

describe('the profiles «New browser» reads (browserProfilesNow)', () => {
  // The answers queue is shared by the tests: a read one test leaves unanswered would be answered by
  // the next test's reply, and that test would fail for nothing. The test that left it fails here.
  afterEach(() => {
    const left = main.answers.length
    main.answers.length = 0
    expect(left, 'reads this test left unanswered (answer each with reply)').toBe(0)
  })

  it('is undefined before the first answer, then the answered list', async () => {
    expect(browserProfilesNow('a')).toBeUndefined()
    reloadBrowserProfiles('a')
    expect(browserProfilesNow('a')).toBeUndefined()
    await reply(answer('default'))
    expect(browserProfilesNow('a')?.map(({ id }) => id)).toEqual(['default'])
  })

  it('is undefined while a new read is unanswered, not the list kept from before', async () => {
    reloadBrowserProfiles('b')
    await reply(answer('x-aaaaaa'))
    expect(browserProfilesNow('b')?.map(({ id }) => id)).toEqual(['x-aaaaaa'])
    reloadBrowserProfiles('b')
    expect(browserProfilesNow('b'), 'the read is pending').toBeUndefined()
    await reply(answer('x-aaaaaa', 'y-bbbbbb'))
    expect(browserProfilesNow('b')?.map(({ id }) => id)).toEqual(['x-aaaaaa', 'y-bbbbbb'])
  })

  it('is undefined after the last read failed, and when only an older read was answered', async () => {
    reloadBrowserProfiles('c')
    await reply(answer('x-aaaaaa'))
    reloadBrowserProfiles('c')
    await reply({ ok: false, error: 'main said no' })
    expect(browserProfilesNow('c'), 'the last read failed').toBeUndefined()
    reloadBrowserProfiles('c')
    reloadBrowserProfiles('c')
    await reply(answer('x-aaaaaa'))
    expect(browserProfilesNow('c'), 'the older of two reads answered').toBeUndefined()
    await reply(answer('x-aaaaaa', 'y-bbbbbb'))
    expect(browserProfilesNow('c')?.map(({ id }) => id)).toEqual(['x-aaaaaa', 'y-bbbbbb'])
  })

  it('keeps each Project apart: a read of one leaves the other\'s list given out', async () => {
    reloadBrowserProfiles('d')
    await reply(answer('default'))
    reloadBrowserProfiles('e')
    expect(browserProfilesNow('d')?.map(({ id }) => id)).toEqual(['default'])
    expect(browserProfilesNow('e')).toBeUndefined()
    await reply(answer('z-cccccc'))
  })
})

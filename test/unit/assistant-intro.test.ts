// The introduction of the Assistant in main (worfy-assistant ticket 16; owner's decisions 10, 12 and 19; stories 27–30):
// the one offer to turn it on, and the introduction the first time it is turned on — who it is, what it does and can,
// a question about the work hours and the sources, and a card «before → after» with the first setup. On the way in: the
// switch, the answer to the offer, the claude.ai connectors main lists without a model, the settings, the Guide's
// language. On the way out: the offer as the window reads it, the messages of the conversation, the proposal of the
// setup, the setting the offer turns on. Nothing runs a model or Claude Code.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { AssistantScheduleSettings } from '../../src/shared/assistant/schedule/settings'
import type { SettingsChange } from '../../src/shared/assistant/settings-change'
import type { GuideLanguage } from '../../src/shared/settings/app-settings'
import { AssistantIntro, introStateFile, introStatePath, memoryIntroState, type IntroConnector, type IntroState } from '../../src/main/assistant/intro/intro'
import { removeTree } from '../../src/main/storage/remove'

const temp = mkdtempSync(join(tmpdir(), 'worfy-assistant-intro-'))
afterAll(() => removeTree(temp))

const SLACK: IntroConnector = { name: 'claude.ai Slack', status: 'connected' }
const JIRA: IntroConnector = { name: 'claude.ai Atlassian', status: 'connected' }

interface Said {
  text: string
  proposalId: string | null
}

function harness(
  options: {
    on?: boolean
    state?: IntroState
    connectors?: () => Promise<readonly IntroConnector[]>
    language?: GuideLanguage
    settings?: AssistantScheduleSettings
    noticeAllowed?: boolean
  } = {},
) {
  let on = options.on ?? false
  const said: Said[] = []
  const proposals: { title: string; why: string; change: SettingsChange }[] = []
  const calls: string[] = []
  const store = memoryIntroState(options.state)
  const intro = new AssistantIntro({
    store,
    on: () => on,
    turnOn: () => {
      calls.push('turn on')
      on = true
    },
    noticeAllowed: () => options.noticeAllowed ?? true,
    language: () => options.language ?? 'en',
    machine: () => 'Mac',
    connectors: options.connectors ?? (() => Promise.resolve([SLACK, JIRA])),
    settings: () => options.settings ?? {},
    timeZone: () => 'Europe/Berlin',
    propose: (draft) => {
      proposals.push(draft)
      return { id: `proposal-${proposals.length}` }
    },
    say: (text, proposalId) => void said.push({ text, proposalId }),
    changed: () => void calls.push('changed'),
    log: () => undefined,
  })
  return { intro, said, proposals, calls, store, turn: (next: boolean) => void (on = next) }
}

describe('the one offer to turn the Assistant on', () => {
  it('stands while the Assistant is off and the person has not answered, with its message for an updated user', () => {
    const { intro } = harness()
    expect(intro.offer()).toEqual({ owed: true, notice: true })
  })

  it('declined, it is never offered again — not in the section, not in a message', () => {
    const { intro, calls } = harness()
    intro.answer('declined')
    expect(intro.offer()).toEqual({ owed: false, notice: false })
    expect(calls).toEqual(['changed'])
  })

  it('the message for an updated user shows once; the offer itself stays in the section', () => {
    const { intro } = harness()
    intro.answer('seen')
    expect(intro.offer()).toEqual({ owed: true, notice: false })
  })

  it('accepted, it turns the Assistant on, as its switch in Settings does, and the offer ends', () => {
    const { intro, calls } = harness()
    intro.answer('accepted')
    expect(calls).toEqual(['turn on', 'changed'])
    expect(intro.offer()).toEqual({ owed: false, notice: false })
  })

  it('is not offered while the Assistant is on, nor once it has introduced itself and was turned off again', async () => {
    const { intro, turn } = harness({ on: true })
    expect(intro.offer().owed).toBe(false)
    await intro.started(false)
    turn(false)
    expect(intro.offer()).toEqual({ owed: false, notice: false })
  })

  it('under WORFY_ASSISTANT_OFFER_AUTO=0 (the e2e runs) the message for an updated user does not show by itself', () => {
    const { intro } = harness({ noticeAllowed: false })
    expect(intro.offer()).toEqual({ owed: true, notice: false })
  })

  it('kept in its file under worfy\'s data folder: a new start reads the answer', () => {
    const file = introStatePath(join(temp, 'kept'))
    expect(file).toBe(join(temp, 'kept', 'assistant', 'intro.json'))
    const first = new AssistantIntro({ ...harnessDeps(), store: introStateFile(file) })
    first.answer('declined')
    const again = new AssistantIntro({ ...harnessDeps(), store: introStateFile(file) })
    expect(again.offer().owed).toBe(false)
  })
})

/** The deps of a bare intro, for the tests that only read and answer the offer. */
function harnessDeps() {
  return {
    on: () => false,
    turnOn: () => undefined,
    noticeAllowed: () => true,
    language: () => 'en' as const,
    machine: () => 'Mac' as const,
    connectors: () => Promise.resolve([]),
    settings: () => ({}),
    timeZone: () => 'UTC',
    propose: () => ({ id: 'p' }),
    say: () => undefined,
    changed: () => undefined,
  }
}

describe('the introduction, the first time the Assistant is turned on', () => {
  it('says who it is, what it does and what it can, then asks the work hours and the sources, with the first setup as a card', async () => {
    const { intro, said, proposals } = harness()
    intro.answer('accepted')
    await intro.started(false)
    expect(said).toHaveLength(3)
    expect(said[0]?.text).toMatch(/I’m Assistant/u)
    expect(said[1]?.text).toMatch(/what waits for you and why/u)
    expect(said[1]?.text).toMatch(/feature pages/u)
    expect(said[2]?.text).toMatch(/work hours/u)
    expect(said[2]?.text).toMatch(/I see Slack and Jira connected in claude\.ai, so I need no tokens from you/u)
    expect(said.slice(0, 2).every((each) => each.proposalId === null)).toBe(true)
    expect(said[2]?.proposalId).toBe('proposal-1')
    expect(proposals).toEqual([
      {
        title: 'Set up Assistant',
        why: expect.stringMatching(/work hours/u),
        change: {
          workHours: { days: ['mon', 'tue', 'wed', 'thu', 'fri'], windows: [{ from: 540, to: 1080 }], timeZone: 'Europe/Berlin' },
          checks: { slack: { enabled: true }, jira: { enabled: true } },
        },
      },
    ])
  })

  it('turned on first in Settings → Assistant, it introduces itself too', async () => {
    const { intro, said, turn } = harness()
    turn(true)
    await intro.started(false)
    expect(said).toHaveLength(3)
  })

  it('introduces itself once: a second start, or one at the next start of worfy, says nothing', async () => {
    const { intro, said, store } = harness()
    await intro.started(false)
    await intro.started(false)
    const next = new AssistantIntro({ ...harnessDeps(), on: () => true, store, say: (text) => void said.push({ text, proposalId: null }) })
    await next.started(true)
    expect(said).toHaveLength(3)
  })

  it('two starts at once write one introduction', async () => {
    const { intro, said } = harness()
    await Promise.all([intro.started(false), intro.started(false)])
    expect(said).toHaveLength(3)
  })

  it('on at the start of worfy with nothing recorded — turned on before the introduction existed — it does not introduce itself', async () => {
    const { intro, said, proposals } = harness({ on: true })
    await intro.started(true)
    expect(said).toEqual([])
    expect(proposals).toEqual([])
    expect(intro.offer().owed).toBe(false)
  })

  it('turned on, and worfy quit before the introduction was written: it comes at the next start', async () => {
    const owed: IntroState = { offer: 'accepted', noticeShown: false, introduction: 'owed' }
    const { intro, said } = harness({ on: true, state: owed })
    await intro.started(true)
    expect(said).toHaveLength(3)
  })

  it('turned on by the person while the Assistant could not start, then worfy restarted: the introduction still comes', async () => {
    const { intro, store, said } = harness()
    intro.owe()
    const next = new AssistantIntro({ ...harnessDeps(), on: () => true, store, say: (text) => void said.push({ text, proposalId: null }) })
    await next.started(true)
    expect(said).toHaveLength(3)
  })

  it('owed once it was introduced changes nothing', async () => {
    const { intro, said, store } = harness()
    await intro.started(false)
    intro.owe()
    expect(store.read().introduction).toBe('done')
    expect(said).toHaveLength(3)
  })

  it('a source not connected in claude.ai: it says where to connect it there, asks no token, and leaves its check off', async () => {
    const { intro, said, proposals } = harness({ connectors: () => Promise.resolve([SLACK, { name: 'claude.ai Atlassian', status: 'needs-auth' }]) })
    await intro.started(false)
    const text = said[2]?.text ?? ''
    expect(text).toMatch(/I see Slack connected in claude\.ai/u)
    expect(text).toMatch(/Jira is not connected in claude\.ai/u)
    expect(text).toMatch(/claude\.ai → Settings → Connectors/u)
    expect(text).not.toMatch(/(?:paste|send|give|enter)[^.]*\btoken/iu)
    expect(proposals[0]?.change.checks).toEqual({ slack: { enabled: true } })
  })

  it('no connector at all: both sources are named with where to connect them; the card sets only the work hours', async () => {
    const { intro, said, proposals } = harness({ connectors: () => Promise.resolve([]) })
    await intro.started(false)
    expect(said[2]?.text).toMatch(/Slack and Jira are not connected in claude\.ai/u)
    expect(proposals[0]?.change).toEqual({ workHours: { days: ['mon', 'tue', 'wed', 'thu', 'fri'], windows: [{ from: 540, to: 1080 }], timeZone: 'Europe/Berlin' } })
  })

  it('the connectors could not be read: it says so, and where to connect them, without guessing', async () => {
    const { intro, said } = harness({ connectors: () => Promise.reject(new Error('Claude Code is not installed')) })
    await intro.started(false)
    expect(said).toHaveLength(3)
    expect(said[2]?.text).toMatch(/could not read your claude\.ai connectors/u)
    expect(said[2]?.text).toMatch(/claude\.ai → Settings → Connectors/u)
  })

  it('what the person chose already stays out of the card; with nothing left to set there is no card, only the question', async () => {
    const settings: AssistantScheduleSettings = {
      assistantSchedule: { workHours: { days: ['mon'], windows: [{ from: 600, to: 900 }] }, checks: { slack: { enabled: true }, jira: { enabled: true } } },
    }
    const { intro, said, proposals } = harness({ settings })
    await intro.started(false)
    expect(proposals).toEqual([])
    expect(said[2]?.proposalId).toBeNull()
    expect(said[2]?.text).toMatch(/work hours/u)
  })

  it('speaks the language of the Guide', async () => {
    const { intro, said, proposals } = harness({ language: 'ru' })
    await intro.started(false)
    expect(said[0]?.text).toMatch(/Привет, я Assistant/u)
    expect(said[2]?.text).toMatch(/claude\.ai/u)
    expect(proposals[0]?.title).toBe('Настроить Assistant')
  })
})

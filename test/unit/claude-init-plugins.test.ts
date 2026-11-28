// A Claude Session whose Harness did not load says so (worfy-harness-guarantees ticket 07).
//
// system/init's `plugins` and `plugin_errors`, in the forms the spike of ticket 01 recorded on Claude Code 2.1.322
// (test/fixtures/sdk-messages/init-plugin-errors.jsonl: an intact copy of harness/, a hooks.json that is not JSON, a
// missing hook script, `engines` unmet and met), reach worfy's `init` event; the one with an error of the Harness —
// named by the copy's FOLDER with `@inline`, not by `worfy` — gives the notice "Harness did not load", and the
// others give none. The Claude driver's handle sends that notice once, after the first system/init of its process.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { QueryFactory, QueryHandle } from '../../src/main/agent/session'
import { HARNESS_NOTICE_CONSEQUENCE, HARNESS_NOTICE_TITLE, harnessLoadProblems, harnessNotice } from '../../src/main/vendors/claude/harness-hooks'
import { claudeSessions } from '../../src/main/vendors/claude/session'
import type { SessionStart } from '../../src/main/vendors/session'
import type { AgentEvent } from '../../src/shared/agent/events'
import { sdkMessageToEvents } from '../../src/shared/vendors/claude/events'

type Message = Record<string, unknown>

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'sdk-messages', 'init-plugin-errors.jsonl')
const [intact, brokenHooksJson, missingHookScript, enginesUnmet, enginesMet] = readFileSync(FIXTURE, 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as Record<string, unknown>) as [Message, Message, Message, Message, Message]

type Init = Extract<AgentEvent, { type: 'init' }>

function initOf(message: unknown): Init {
  const [event] = sdkMessageToEvents(message)
  if (event?.type !== 'init') throw new Error(`not an init: ${JSON.stringify(event)}`)
  return event
}

/** The folder of the Harness copy a fixture line ran with, as worfy would have given it inline. */
const givenOf = (message: Record<string, unknown>): string => (message.plugins as { path: string }[])[0]!.path

describe('system/init tells the plugins and their load errors', () => {
  it('reads `plugins` and `plugin_errors` of the spike fixture into the init event', () => {
    expect(initOf(intact)).toMatchObject({ plugins: [{ name: 'worfy', path: '<tmp>/harness-intact' }], pluginErrors: [] })
    expect(initOf(brokenHooksJson)).toMatchObject({
      plugins: [{ name: 'worfy', path: '<tmp>/harness-broken-hooks-json' }],
      pluginErrors: [{ plugin: 'harness-broken-hooks-json@inline', type: 'hook-load-failed', message: 'Hook load failed: JSON Parse error: Unexpected EOF' }],
    })
  })

  it('an init without `plugins` says nothing of them; entries of another shape are dropped, not the init', () => {
    const without = Object.fromEntries(Object.entries(intact).filter(([key]) => key !== 'plugins'))
    expect(initOf(without)).toMatchObject({ type: 'init', sdkSessionId: intact.session_id })
    expect(initOf(without)).not.toHaveProperty('plugins')
    expect(initOf(without)).not.toHaveProperty('pluginErrors')
    const odd = initOf({ ...brokenHooksJson, plugins: 'all of them' })
    expect(odd).toMatchObject({ type: 'init', sdkSessionId: brokenHooksJson.session_id })
    expect(odd).not.toHaveProperty('plugins')
    const someErrors = initOf({ ...brokenHooksJson, plugin_errors: [{ plugin: 7 }, { plugin: 'x@inline', type: 'generic-error' }] })
    expect(someErrors).toMatchObject({ pluginErrors: [{ plugin: 'x@inline', type: 'generic-error', message: '' }] })
  })
})

describe('harnessLoadProblems: what went wrong with the Harness worfy gave', () => {
  it('a hooks.json that is not JSON: the error of the copy`s folder counts, whether or not the query told the folder', () => {
    const problem = { type: 'hook-load-failed', message: 'Hook load failed: JSON Parse error: Unexpected EOF' }
    expect(harnessLoadProblems(initOf(brokenHooksJson), givenOf(brokenHooksJson))).toEqual([problem])
    expect(harnessLoadProblems(initOf(brokenHooksJson), undefined)).toEqual([problem])
  })

  it('the intact copy, a missing hook script and `engines` give no problem: system/init does not tell them', () => {
    for (const message of [intact, missingHookScript, enginesUnmet, enginesMet]) expect(harnessLoadProblems(initOf(message), givenOf(message))).toEqual([])
  })

  it('the plugin worfy missing counts only when worfy gave it; an error of another plugin never counts', () => {
    const none = initOf({ ...intact, plugins: [{ name: 'plugin-1', path: '/plugins/plugin-1' }], plugin_errors: [{ plugin: 'plugin-1@market', type: 'generic-error', message: 'broken' }] })
    expect(harnessLoadProblems(none, '/app/Resources/harness')).toEqual([{ type: 'not-loaded', message: 'Claude Code did not load the plugin worfy from /app/Resources/harness.' }])
    expect(harnessLoadProblems(none, null)).toEqual([])
    expect(harnessLoadProblems(none, undefined)).toEqual([])
    // A directory entry that failed before it had a name: worfy passes no inline plugin but the Harness.
    const unnamed = initOf({ ...intact, plugins: [], plugin_errors: [{ plugin: 'inline[0]', type: 'manifest-validation-error', message: 'bad manifest' }] })
    expect(harnessLoadProblems(unnamed, '/app/Resources/harness')).toEqual([
      { type: 'not-loaded', message: 'Claude Code did not load the plugin worfy from /app/Resources/harness.' },
      { type: 'manifest-validation-error', message: 'bad manifest' },
    ])
  })

  it('an init that does not list `plugins` checks nothing', () => {
    const without = Object.fromEntries(Object.entries(brokenHooksJson).filter(([key]) => key !== 'plugins'))
    expect(harnessLoadProblems(initOf(without), '/app/Resources/harness')).toEqual([])
  })
})

describe('the notice "Harness did not load"', () => {
  it('names the plugin, the error type and Claude Code`s message, and says what does not hold; Copy details carries the facts', () => {
    const init = initOf(brokenHooksJson)
    const notice = harnessNotice(harnessLoadProblems(init, givenOf(brokenHooksJson)), { given: givenOf(brokenHooksJson), init })
    expect(notice).toMatchObject({
      type: 'notice',
      kind: 'notification',
      title: HARNESS_NOTICE_TITLE,
      text: `worfy · hook-load-failed: Hook load failed: JSON Parse error: Unexpected EOF\n${HARNESS_NOTICE_CONSEQUENCE}`,
      action: 'open-health',
    })
    expect(HARNESS_NOTICE_TITLE).toBe('Harness did not load')
    expect(HARNESS_NOTICE_CONSEQUENCE).toBe('Guards and the gate do not hold in this Session.')
    expect(notice?.details).toContain('Claude Code: 2.1.322')
    expect(notice?.details).toContain('Harness given inline: <tmp>/harness-broken-hooks-json')
    expect(notice?.details).toContain('Plugin error: harness-broken-hooks-json@inline · hook-load-failed: Hook load failed: JSON Parse error: Unexpected EOF')
    expect(harnessNotice([], { given: undefined, init })).toBeNull()
  })
})

/** A query that plays `messages` and ends; every control call answers at once. */
function playing(messages: readonly unknown[]): QueryHandle {
  const own = {
    async *[Symbol.asyncIterator]() {
      for (const message of messages) yield message
    },
    close: () => undefined,
  }
  return new Proxy(own, {
    // Not a thenable: the factory resolves to it.
    get: (target, key) => (key in target ? target[key as keyof typeof target] : key === 'then' ? undefined : () => Promise.resolve(key === 'mcpServerStatus' ? [] : {})),
  }) as unknown as QueryHandle
}

const START: SessionStart = {
  cwd: '/repo',
  settings: { model: null, effort: null, permissionMode: 'default' },
  unattended: false,
  orchestrator: false,
  permissions: { ask: () => Promise.reject(new Error('nothing is asked')) } as unknown as SessionStart['permissions'],
  refused: () => undefined,
  stderr: () => undefined,
  spawned: () => undefined,
}

/** Every event of a Claude Session whose query plays `messages` and was told `given` as its Harness. */
async function eventsOf(messages: readonly unknown[], given: string | null): Promise<AgentEvent[]> {
  const factory: QueryFactory = (request) => {
    request.harnessGiven?.(given)
    return Promise.resolve(playing(messages))
  }
  const handle = await claudeSessions(factory, { model: () => null, effort: () => null }).start(START)
  const events: AgentEvent[] = []
  try {
    for await (const event of handle.events) events.push(event)
  } catch {
    // The query ended: "Claude Code exited".
  }
  return events
}

describe('the Claude driver`s handle', () => {
  it('sends the notice right after the first system/init with an error of the Harness, once for the process', async () => {
    const events = await eventsOf([brokenHooksJson, brokenHooksJson], givenOf(brokenHooksJson))
    const kinds = events.filter((event) => event.type === 'init' || event.type === 'notice').map((event) => (event.type === 'notice' ? `notice:${event.title ?? ''}` : event.type))
    expect(kinds).toEqual(['init', `notice:${HARNESS_NOTICE_TITLE}`, 'init'])
  })

  it('an init of an intact Harness gives no notice', async () => {
    const events = await eventsOf([intact], givenOf(intact))
    expect(events.some((event) => event.type === 'init')).toBe(true)
    expect(events.filter((event) => event.type === 'notice')).toEqual([])
  })
})

// The translation of Agent SDK messages into worfy's events lives in the Claude driver's own module
// (src/shared/vendors/claude/events.ts, worfy-multi-vendor ticket 14). Every recorded SDK message
// (test/fixtures/sdk-messages/) gives the events it gave before the move:
// test/fixtures/sdk-events/claude.json was written by sdkMessageToEvents of src/shared/agent/events.ts
// before ticket 14, each message received at AT. It pins the translation: a change of the translation
// on purpose, or new recorded messages, write the record anew in the same pull request.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as model from '../../src/shared/agent/events'
import { sdkMessageToEvents } from '../../src/shared/vendors/claude/events'

const MESSAGES = join(import.meta.dirname, '..', 'fixtures', 'sdk-messages')
const BEFORE = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'sdk-events', 'claude.json'), 'utf8')) as Record<string, unknown[]>
const AT = 1_790_000_000_000

const recorded = readdirSync(MESSAGES)
  .filter((name) => name.endsWith('.jsonl'))
  .sort()

describe('the Claude translation of SDK messages', () => {
  it('has a record of the events before the move for every recorded file, and only those', () => {
    expect(Object.keys(BEFORE).sort()).toEqual(recorded)
  })

  it.each(recorded)('%s gives the same events as before the move', (file) => {
    const messages = readFileSync(join(MESSAGES, file), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as unknown)
    expect(messages.map((message) => sdkMessageToEvents(message, AT))).toEqual(BEFORE[file])
  })

  it('every event it gives is one of the model', () => {
    for (const events of Object.values(BEFORE)) for (const each of events.flat()) expect(model.agentEvent.safeParse(each).success).toBe(true)
  })

  it('leaves only the model in src/shared/agent/events.ts', () => {
    expect(Object.keys(model)).not.toContain('sdkMessageToEvents')
    expect(Object.keys(model)).not.toContain('toolResultText')
    expect(Object.keys(model)).not.toContain('contextUsageOf')
  })
})

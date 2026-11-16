// The answer of the invisible agent to a question about lines of a Code story (worfy-code-stories ticket 12,
// src/main/stories/ask.ts): an answer that does not fit its schema is a failure with the reason, and a Stop while the
// agent answers keeps nothing. The Vendor is stood in.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { readAskAnswer, StoryAsker } from '../../src/main/stories/ask'
import { storySchema, type Story } from '../../src/shared/stories/schema'
import type { Capabilities } from '../../src/shared/vendors/capabilities'

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'code-story-answers')
const HEAD = 'a'.repeat(40)
const STORY: Story = storySchema.parse({
  kind: 'pr',
  header: { title: 'Cart total in cents', epic: 'demo-cart', ticket: '04', pr: 212, language: 'ru', commit: HEAD },
  ...(JSON.parse(readFileSync(join(FIXTURES, 'pr-ru.json'), 'utf8')) as object),
})

describe('the answer of the invisible agent', () => {
  it('refuses an answer that does not fit its schema, with the reason', () => {
    const missing = readAskAnswer({ answer: 'x', lines: [] })
    expect(missing).toMatchObject({ ok: false })
    expect(!missing.ok && missing.reason).toMatch(/source/u)
    const unsupported = readAskAnswer({ answer: 'x', source: 'none', lines: [{ path: 'src/cart.ts', from: 1, to: 2 }] })
    expect(!unsupported.ok && unsupported.reason).toMatch(/no lines/u)
    const outside = readAskAnswer({ answer: 'x', source: 'code', lines: [{ path: '../secret.txt', from: 1, to: 1 }] })
    expect(!outside.ok && outside.reason).toMatch(/inside the checkout/u)
    expect(readAskAnswer({ answer: 'x', source: 'code', lines: [{ path: 'src/cart.ts', from: 3, to: 4 }] })).toEqual({ ok: true, answer: { answer: 'x', source: 'code', lines: [{ path: 'src/cart.ts', from: 3, to: 4 }] } })
  })

  const can = { oneShotToolFree: true, unsupported: {} } as unknown as Capabilities
  const request = {
    questionId: 'q-1',
    folder: '/checkout',
    dataDir: '/data',
    key: 'demo-cart/stories/04-cart-total.md',
    vendor: 'claude' as const,
    story: STORY,
    about: { step: 2, path: 'src/cart.ts', from: 13, to: 14 },
    code: 'x',
    question: 'Why?',
  }
  const material = () => Promise.resolve({ diff: null, prText: null, ticket: null, verdicts: [], missing: [] })

  it('answers a failure with the reason for an answer that does not fit, and keeps nothing', async () => {
    const save = vi.fn()
    const asker = new StoryAsker({
      oneShot: () => () => Promise.resolve({ text: '', structured: { answer: 'x' } }),
      capabilities: () => Promise.resolve(can),
      runDir: () => join(FIXTURES, 'no-such-run-dir-is-made-here'),
      material,
      commit: () => Promise.resolve(HEAD),
      save,
      mkdir: () => undefined,
    })
    const outcome = await asker.ask(request, () => undefined)
    expect(outcome.status).toBe('failed')
    expect(outcome.status === 'failed' && outcome.reason).toMatch(/^The answer does not fit: .*source/u)
    expect(save).not.toHaveBeenCalled()
  })

  it('keeps nothing when it is stopped while the agent answers', async () => {
    const save = vi.fn()
    let started: () => void = () => undefined
    const running = new Promise<void>((resolve) => (started = resolve))
    const asker = new StoryAsker({
      oneShot: () => (_prompt, options) =>
        new Promise((resolve) => {
          started()
          // The agent answers anyway once it is stopped: the answer comes too late to be kept.
          options.signal?.addEventListener('abort', () => resolve({ text: '', structured: { answer: 'late', source: 'story', lines: [] } }))
        }),
      capabilities: () => Promise.resolve(can),
      runDir: () => '/run',
      material,
      commit: () => Promise.resolve(HEAD),
      save,
      mkdir: () => undefined,
    })
    const outcome = asker.ask(request, () => undefined)
    await running
    expect(asker.stop('q-1')).toBe(true)
    await expect(outcome).resolves.toEqual({ status: 'stopped' })
    expect(save).not.toHaveBeenCalled()
    expect(asker.stop('q-1')).toBe(false)
  })

  it('answers Stopped, not Failed, when the Vendor rejects on Stop, as the Claude driver does', async () => {
    const save = vi.fn()
    let started: () => void = () => undefined
    const running = new Promise<void>((resolve) => (started = resolve))
    const asker = new StoryAsker({
      oneShot: () => (_prompt, options) =>
        new Promise((_resolve, reject) => {
          started()
          options.signal?.addEventListener('abort', () => reject(new Error('the request was stopped')))
        }),
      capabilities: () => Promise.resolve(can),
      runDir: () => '/run',
      material,
      commit: () => Promise.resolve(HEAD),
      save,
      mkdir: () => undefined,
    })
    const outcome = asker.ask(request, () => undefined)
    await running
    expect(asker.stop('q-1')).toBe(true)
    await expect(outcome).resolves.toEqual({ status: 'stopped' })
    expect(save).not.toHaveBeenCalled()
  })

  it('takes a Stop while it still reads what the Vendor can do: nothing is asked, nothing kept', async () => {
    const save = vi.fn()
    const oneShot = vi.fn()
    let answerCapabilities: (value: Capabilities) => void = () => undefined
    const asker = new StoryAsker({
      oneShot: () => oneShot,
      capabilities: () => new Promise((resolve) => (answerCapabilities = resolve)),
      runDir: () => '/run',
      material,
      commit: () => Promise.resolve(HEAD),
      save,
      mkdir: () => undefined,
    })
    const outcome = asker.ask(request, () => undefined)
    expect(asker.stop('q-1')).toBe(true)
    answerCapabilities(can)
    await expect(outcome).resolves.toEqual({ status: 'stopped' })
    expect(oneShot).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })
})

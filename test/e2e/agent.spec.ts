import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from './helpers'

// The agent channels in the running app, over the real preload and webContents, on the fake
// agent (WORFY_AGENT=fake, set by launchApp): no call reaches Claude Code.

interface Envelope {
  sessionId: string
  event: { type: string; state?: string; text?: string; isError?: boolean }
}

test('a Session started from the renderer streams its events back: busy, result, idle', async () => {
  const project = await mkdtemp(join(tmpdir(), 'worfy-e2e-project-'))
  const launched = await launchApp({ env: { WORFY_AGENT_SCRIPT: 'turn' } })
  try {
    const envelopes = await launched.window.evaluate(async (cwd) => {
      const bridge = (window as unknown as { worfy: import('../../src/shared/ipc/channels').WorfyBridge }).worfy
      const received: Envelope[] = []
      const done = new Promise<void>((resolve) => {
        bridge.on('agent.event', (payload) => {
          const envelope = payload as Envelope
          received.push(envelope)
          if (envelope.event.type === 'state' && envelope.event.state === 'idle' && received.some((e) => e.event.type === 'result')) resolve()
        })
      })
      const started = await bridge.invoke('agent.start', { cwd })
      if (!started.ok) throw new Error(started.error)
      const { sessionId } = started.value as { sessionId: string }
      const sent = await bridge.invoke('agent.send', { sessionId, text: 'hello' })
      if (!sent.ok) throw new Error(sent.error)
      await done
      return received
    }, project)

    const states = envelopes.flatMap((e) => (e.event.type === 'state' ? [e.event.state] : []))
    expect(states.slice(-2)).toEqual(['busy', 'idle'])
    expect(envelopes.find((e) => e.event.type === 'result')?.event).toMatchObject({ isError: false })
    expect(envelopes.find((e) => e.event.type === 'text')?.event.text).toBe('Hello from the fake agent')
    const renamed = envelopes.find((e) => e.event.type === 'renamed')
    expect(renamed?.sessionId).toMatch(/^[0-9a-f-]{36}$/)
  } finally {
    await launched.close()
    await rm(project, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

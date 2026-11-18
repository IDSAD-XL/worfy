// The line a compaction leaves in the Session view (worfy-continuity ticket 12), on the fake agent
// (scenario compacted.jsonl): each system/compact_boundary of Claude Code reaches the Session's events
// as a notice "Context compacted (<trigger>) · <before> → <after>", in its place among the turn's
// events. Never the real Claude Code.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeReleases, fakeQueryFactory } from '../../src/main/agent/fake-query'
import { SessionRegistry } from '../../src/main/agent/session'
import type { AgentEvent } from '../../src/shared/agent/events'

const scriptsDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')

let cwd: string
let emptyHome: string
let registry: SessionRegistry | null = null

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'worfy-compacted-'))
  emptyHome = await mkdtemp(join(tmpdir(), 'worfy-compacted-home-'))
  vi.stubEnv('WORFY_CLAUDE_HOME', emptyHome)
})

afterEach(async () => {
  registry?.closeAll()
  registry = null
  vi.unstubAllEnvs()
  await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  await rm(emptyHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('a compaction in the Session view', () => {
  it('shows a line with the trigger and the tokens, and without the second number when Claude Code does not tell it', async () => {
    registry = new SessionRegistry(fakeQueryFactory({ scriptsDir, script: 'compacted', releases: new FakeReleases() }), () => null, () => null)
    const events: AgentEvent[] = []
    const session = registry.start(cwd, undefined, (_id, event) => events.push(event))
    const results = () => events.filter((event) => event.type === 'result')
    const shown = () => events.filter((event) => event.type === 'notice' || event.type === 'text').map((event) => (event.type === 'notice' ? `${event.kind}: ${event.text}` : `text: ${event.text}`))
    await vi.waitFor(() => expect(session.state).toBe('idle'))

    session.send('one')
    await vi.waitFor(() => expect(results()).toHaveLength(1))
    session.send('two')
    await vi.waitFor(() => expect(results()).toHaveLength(2))

    expect(shown()).toEqual(['notification: Context compacted (auto) · 812K → 41K', 'text: after the compaction', 'notification: Context compacted (manual) · 150K'])
  })
})

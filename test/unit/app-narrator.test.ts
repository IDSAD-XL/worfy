// The narrator the app gives a Product Session (src/main/agent/app-narrator.ts, worfy-product-session ticket 32):
// with the switch of Settings → Sessions off in the stored app settings, it asks nothing; turned on, it asks the
// fake agent (WORFY_AGENT=fake, test/fixtures/agent-scripts/narrator.jsonl). Never a real model.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { NarratorClock } from '../../src/main/agent/narrator'
import type { AgentEvent } from '../../src/shared/agent/events'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined } }))

const scriptsDir = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')

/** A clock the test moves by hand; its timers fire as it passes them. */
class ManualClock implements NarratorClock {
  time = 0
  private timers: { at: number; run: () => void }[] = []
  now = (): number => this.time
  setTimeout = (run: () => void, ms: number): unknown => {
    const timer = { at: this.time + ms, run }
    this.timers.push(timer)
    return timer
  }
  clearTimeout = (timer: unknown): void => {
    this.timers = this.timers.filter((each) => each !== timer)
  }
  advance(ms: number): void {
    this.time += ms
    for (const due of this.timers.filter((timer) => timer.at <= this.time)) {
      this.timers = this.timers.filter((timer) => timer !== due)
      due.run()
    }
  }
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'worfy-app-narrator-'))
  vi.resetModules()
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const read: AgentEvent = { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'map.md' }, parentToolUseId: null }

it('asks nothing while the stored live summary is off, and asks once it is turned on', async () => {
  const log = join(dir, 'agent.log')
  const env = { WORFY_AGENT: 'fake', WORFY_AGENT_SCRIPTS: scriptsDir, WORFY_AGENT_LOG: log, WORFY_DATA_DIR: join(dir, 'data'), WORFY_NARRATOR_FIRST_MS: '1000', WORFY_NARRATOR_EVERY_MS: '1000' }
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  const { appSettingsStore } = await import('../../src/main/settings/store')
  const { appNarrator } = await import('../../src/main/agent/app-narrator')
  appSettingsStore().set({ productSession: { liveSummary: false } })
  const emitted: string[][] = []
  const clock = new ManualClock()
  const narrator = appNarrator((lines) => emitted.push([...lines]), { clock })

  narrator.event({ type: 'prompt', text: 'Check the roadmap' })
  narrator.event(read)
  for (let step = 0; step < 5; step += 1) {
    clock.advance(1000)
    narrator.event({ type: 'tool_result', toolUseId: 't1', content: 'ok', isError: false, parentToolUseId: null })
  }
  await new Promise((done) => setTimeout(done, 50))
  expect(emitted).toEqual([])
  await expect(readFile(log, 'utf8')).rejects.toThrow()

  appSettingsStore().set({ productSession: { liveSummary: true } })
  clock.advance(1000)
  narrator.event(read)
  await vi.waitFor(() => expect(emitted).toEqual([['Reads the roadmap draft to check it against the critic before answering']]))
  const calls = (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as { narrator?: boolean; kind: string; settings?: { model: string } })
  expect(calls.filter((call) => call.kind === 'start')).toMatchObject([{ narrator: true, settings: { model: 'claude-haiku-4-5' } }])
  narrator.close()
})
